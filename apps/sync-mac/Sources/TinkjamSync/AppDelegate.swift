import AppKit
import Network
import ServiceManagement
import SystemConfiguration
import UserNotifications

/// What the menu says, one at a time.
enum Phase: Equatable {
    case settingUp(String, Double?)
    case connecting(String?)
    case awaitingApproval(URL)
    case connected
    case notConnected(String?)
    case stopped(String)
}

/// Preference keys. A test copy with its own home keeps its own, so it never changes the real one's.
private enum Defaults {
    private static let suffix = Paths.resolve().isDefault ? "" : "@" + Paths.resolve().base.path
    static let disconnected = "DisconnectedByPerson" + suffix
    static let startAtLogin = "StartAtLogin"
    static let lastSyncCheck = "LastSyncUpdateCheck" + suffix
    static let lastAppCheck = "LastAppUpdateCheck" + suffix
}

/// Runs everything: setup, the one Sync, the menu, updates.
final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuDelegate {
    private let paths = Paths.resolve()
    private lazy var log = LogFile(url: paths.log)
    private var statusItem: NSStatusItem!
    private let menu = NSMenu()
    private lazy var setupWindow = SetupWindow()
    private var lockFile: Int32 = -1

    private var phase: Phase = .settingUp("Starting…", nil) { didSet { if phase != oldValue { phaseChanged(from: oldValue) } } }
    private var phaseSince = Date()
    private var child: SyncChild?
    private var busy = false            // setup or an update is running; no second one starts
    private var loginPath: String?
    private var restarts: [Date] = []
    private var restartWork: DispatchWorkItem?
    private var statusTimer: Timer?
    private var updateTimer: Timer?
    private var openedApprovalThisSession = false
    private var approvedThisRun = false
    private var portBusyThisRun = false
    private var heldThisRun: SyncLine?
    private var stagedApp: AppUpdater.Staged?
    private var manualAppVersion: String?
    private var updateNote: String?
    private var pathMonitor: NWPathMonitor?
    private var online = true
    private var signalSource: DispatchSourceSignal?
    private var lastLoggedStatus = ""
    private var waitingForNetwork = false

    // MARK: Launch and quit

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard takeHomeLock() else {
            // Another copy already runs this home's Sync; one is all there may be.
            NSApp.terminate(nil)
            return
        }
        if offerMoveToApplications() { return }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        statusItem.button?.image = Mark.menuBarImage()
        statusItem.button?.setAccessibilityLabel("Tinkjam Sync")
        menu.delegate = self
        menu.autoenablesItems = false
        statusItem.menu = menu
        rebuildMenu()
        UNUserNotificationCenter.current().delegate = self

        // `kill <pid>` (install.sh, an update) quits the same way as the menu, so Sync stops too.
        signal(SIGTERM, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        source.setEventHandler { onMainRunLoop { NSApp.terminate(nil) } }
        source.resume()
        signalSource = source

        NSAppleEventManager.shared().setEventHandler(self, andSelector: #selector(handleURL(_:reply:)),
                                                     forEventClass: AEEventClass(kInternetEventClass),
                                                     andEventID: AEEventID(kAEGetURL))
        watchNetwork()
        log.app("Tinkjam Sync for Mac \(Machine.appVersion) started (home \(paths.base.path))")
        applyLoginItemPreference()
        Task { await bootstrap() }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in
            Task { await self?.checkForUpdates(manual: false) }
        }
        // A laptop that sleeps through the hour asks on waking, once Wi-Fi is back.
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification,
                                                          object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
                Task { await self?.checkForUpdates(manual: false) }
            }
        }
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let child else { return .terminateNow }
        log.app("Quitting: stopping Tinkjam Sync")
        restartWork?.cancel()
        statusTimer?.invalidate()
        let log = self.log
        let paths = self.paths
        // AppKit waits in a nested event loop, which does not run main-actor tasks when quitting
        // started inside one, so the stop runs elsewhere and the reply comes through the run loop.
        Task.detached {
            await child.stop()
            ChildRecord.clear(paths)
            log.app("Tinkjam Sync stopped")
            onMainRunLoop { NSApp.reply(toApplicationShouldTerminate: true) }
        }
        return .terminateLater
    }

    private func takeHomeLock() -> Bool {
        try? FileManager.default.createDirectory(at: paths.base, withIntermediateDirectories: true)
        lockFile = open(paths.lock.path, O_CREAT | O_RDWR | O_CLOEXEC, 0o644)
        guard lockFile >= 0 else { return false }
        // The copy an update or a move replaces may still be letting go of it.
        for _ in 0..<50 {
            if flock(lockFile, LOCK_EX | LOCK_NB) == 0 { return true }
            usleep(200_000)
        }
        log.app("Another copy of Tinkjam Sync already runs; this one quits")
        return false
    }

    // MARK: Setup

    /// First launch does everything: Node, the Sync package, taking over an older Sync, starting.
    @MainActor
    private func bootstrap() async {
        guard !busy else { return }
        busy = true
        defer { busy = false }
        waitingForNetwork = false
        let firstRun = !NodeRuntime.isInstalled(paths) || !SyncPackage.isInstalled(paths)
        if firstRun { presentSetupWindow() }
        do {
            if loginPath == nil {
                phase = .settingUp("Getting ready…", nil)
                loginPath = await Task.detached { LoginShell.path() }.value
            }
            if !NodeRuntime.isInstalled(paths) {
                phase = .settingUp("Downloading Node.js…", 0)
                try await NodeRuntime.install(paths, log: log) { fraction in
                    DispatchQueue.main.async { self.phase = .settingUp("Downloading Node.js…", fraction) }
                }
            }
            var staged: URL?
            if !SyncPackage.isInstalled(paths) {
                phase = .settingUp("Downloading Tinkjam Sync…", nil)
                let release = try await SyncPackage.latestRelease()
                staged = try await SyncPackage.stage(release, paths: paths, log: log) { step, fraction in
                    DispatchQueue.main.async { self.phase = .settingUp(step, fraction) }
                }
                UserDefaults.standard.set(Date(), forKey: Defaults.lastSyncCheck)
            }
            try await takeOver(staged: staged)
            if UserDefaults.standard.bool(forKey: Defaults.disconnected) {
                phase = .notConnected(nil)
            } else {
                startSync()
            }
            Task { await checkForUpdates(manual: false) }
        } catch {
            let failure = SetupError.from(error, doing: "setting up")
            log.app("Setup stopped: \(failure.message)")
            phase = .stopped(failure.message)
            if failure.offline {
                // Back online sooner is caught by the network monitor; this covers a server outage.
                waitingForNetwork = true
                DispatchQueue.main.asyncAfter(deadline: .now() + 300) { [weak self] in
                    guard let self, self.waitingForNetwork, case .stopped = self.phase else { return }
                    Task { await self.bootstrap() }
                }
            }
        }
    }

    /// Ends every other Sync of this home before this app starts its own: the npx-installed login
    /// item (the package's own `--uninstall`, which keeps the account connected) and any Sync a
    /// terminal or an agent still runs (`--stop-running`). Then puts a staged package in place.
    @MainActor
    private func takeOver(staged: URL?) async throws {
        let items = Legacy.loginItems(paths)
        let loaded = Legacy.jobLoaded(paths)
        var root = staged
        if !items.isEmpty || loaded {
            phase = .settingUp("Moving Tinkjam Sync into this app…", nil)
            log.app("Taking over from the older Tinkjam Sync: \(items.map(\.path).joined(separator: ", "))")
            // `--uninstall` deletes `<home>/app`, so it runs from a staged copy that then replaces it.
            if root == nil { root = try SyncPackage.stageCopyOfInstalled(paths) }
            let result = await run(paths.node, [Paths.launcher(in: root!).path, "--uninstall", "--base-dir", paths.base.path],
                                   environment: nodeEnvironment(), timeout: 120)
            log.app("--uninstall: \(result.tail(8))")
            if Legacy.jobLoaded(paths) { Legacy.bootOutJob() }
            if !Legacy.loginItems(paths).isEmpty || Legacy.jobLoaded(paths) {
                throw SetupError("Could not remove the older Tinkjam Sync login item. Show log has the details.")
            }
        }
        if let orphan = await ChildRecord.endOrphan(paths) { log.app("Ended a Tinkjam Sync left from an earlier run: \(orphan)") }
        let entryRoot = root ?? paths.app
        if !SyncPackage.supportsAppMode(in: entryRoot) {
            // Packages with `--app` end any other Sync themselves when they start.
            let result = await run(paths.node, [Paths.serverEntry(in: entryRoot).path, "sync", "--stop-running",
                                                "--base-dir", paths.base.path],
                                   environment: nodeEnvironment(), timeout: 60)
            if !result.output.isEmpty { log.app("--stop-running: \(result.tail(4))") }
        }
        if let root {
            try SyncPackage.activate(root, paths: paths)
            log.app("Tinkjam Sync \(SyncPackage.installedVersion(in: paths.app) ?? "?") is installed in \(paths.app.path)")
        }
    }

    private func nodeEnvironment() -> [String: String] {
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = (loginPath ?? "/usr/bin:/bin:/usr/sbin:/sbin") + ":" + paths.nodeHome.appendingPathComponent("bin").path
        environment["T3CODE_HOME"] = paths.base.path
        environment["T3CODE_HOSTED_APP_URL"] = Config.hostedAppURL.absoluteString
        environment["TINKJAM_SYNC_URL"] = Config.syncPackageURL.absoluteString
        return environment
    }

    // MARK: The one Sync

    private func startSync() {
        guard child == nil else { return }
        restartWork = nil
        approvedThisRun = false
        portBusyThisRun = false
        heldThisRun = nil
        let appMode = SyncPackage.supportsAppMode(in: paths.app)
        let sync = SyncChild(paths: paths, appMode: appMode, path: loginPath ?? "/usr/bin:/bin:/usr/sbin:/sbin")
        do {
            try sync.start(
                onLine: { [weak self] line in DispatchQueue.main.async { self?.received(line) } },
                onExit: { [weak self, weak sync] status, how in
                    guard let self, let sync, self.child === sync else { return }
                    self.syncExited(status, how: how, stopping: sync.stopping)
                })
        } catch {
            phase = .stopped("Tinkjam Sync could not start: \(error.localizedDescription)")
            return
        }
        child = sync
        ChildRecord.write(sync.pid, paths: paths)
        log.app("Started Tinkjam Sync (pid \(sync.pid)\(appMode ? ", --app" : ""))")
        phase = .connecting(nil)
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in self?.pollStatus() }
    }

    private func stopSync() async {
        statusTimer?.invalidate()
        restartWork?.cancel()
        restartWork = nil
        guard let sync = child else { return }
        await sync.stop()
        child = nil
        ChildRecord.clear(paths)
        log.app("Stopped Tinkjam Sync (pid \(sync.pid))")
    }

    private func received(_ line: String) {
        log.write(line)
        switch SyncLine.classify(line) {
        case .approvalURL(let url):
            phase = .awaitingApproval(url)
            if !openedApprovalThisSession {
                openedApprovalThisSession = true
                NSWorkspace.shared.open(url)
                presentSetupWindow()
                UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
            }
        case .approved:
            approvedThisRun = true
            phase = .connecting(nil)
        case .connected:
            markConnected()
        case .portBusy:
            portBusyThisRun = true
        case .heldInBackground, .heldElsewhere:
            heldThisRun = SyncLine.classify(line)
        case .other:
            break
        }
    }

    private func pollStatus() {
        guard let child, phase != .connected else { return }
        guard let status = SyncStatus.read(paths), status.pid == child.pid else { return }
        if status.status == "reachable" {
            markConnected()
        } else if case .connecting(let previous) = phase, let reason = status.reason, reason != previous {
            // A check that names no reason keeps the last one, so the menu does not flicker.
            phase = .connecting(reason)
        }
    }

    private func markConnected() {
        let wasWaiting: Bool
        if case .connected = phase { return }
        wasWaiting = approvedThisRun
        phase = .connected
        statusTimer?.invalidate()
        if wasWaiting {
            let content = UNMutableNotificationContent()
            content.title = "This Mac is connected to Tinkjam"
            content.body = "Your agents here are now available on your boards."
            UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: "connected", content: content, trigger: nil))
        }
    }

    /// Sync never exits by itself while it works, so an exit is either the end of an approval
    /// wait, something holding the approval port or this home, or a crash to restart.
    private func syncExited(_ status: Int32, how: String, stopping: Bool) {
        child = nil
        statusTimer?.invalidate()
        if stopping { return }
        log.app("Tinkjam Sync exited (\(how))")
        if portBusyThisRun {
            phase = .stopped("Port \(Config.approvalPort) is in use by another app, so this Mac can't be approved. Quit that app, then choose Retry.")
            return
        }
        // Sync keeps its sign-in request across a restart, so the open approval page still works.
        if case .awaitingApproval = phase {
            scheduleRestart(reason: "the approval wait ended")
            return
        }
        if heldThisRun != nil {
            // Another Sync started after the takeover (an agent ran the old installer again).
            Task { @MainActor in
                do { try await takeOver(staged: nil); scheduleRestart(reason: "another Tinkjam Sync was running") } catch {
                    phase = .stopped((error as? SetupError)?.message ?? error.localizedDescription)
                }
            }
            return
        }
        scheduleRestart(reason: "it stopped unexpectedly (\(how))")
    }

    /// 2, 4, 8, 16, 32 seconds; the sixth exit within ten minutes stops it until Retry.
    private func scheduleRestart(reason: String) {
        let now = Date()
        restarts = restarts.filter { now.timeIntervalSince($0) < 600 }
        guard restarts.count < 5 else {
            phase = .stopped("Tinkjam Sync stopped 5 times in 10 minutes; the last time \(reason). Show Log has the details.")
            restarts = []
            return
        }
        let delay = pow(2.0, Double(restarts.count + 1))
        restarts.append(now)
        phase = .connecting("Restarting in \(Int(delay)) seconds: \(reason)")
        let work = DispatchWorkItem { [weak self] in self?.startSync() }
        restartWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // MARK: Updates

    @MainActor
    private func checkForUpdates(manual: Bool) async {
        let defaults = UserDefaults.standard
        let due = { (key: String) in
            manual || Date().timeIntervalSince(defaults.object(forKey: key) as? Date ?? .distantPast) >= Config.updateCheckInterval
        }
        if manual { updateNote = "Checking for updates…"; rebuildMenu() }
        var notes: [String] = []
        if due(Defaults.lastAppCheck), stagedApp == nil {
            do {
                switch try await AppUpdater.check(log: log) {
                case .upToDate: manualAppVersion = nil
                case .staged(let staged): stagedApp = staged
                case .manual(let version): manualAppVersion = version
                }
                defaults.set(Date(), forKey: Defaults.lastAppCheck)
            } catch {
                log.app("App update check: \((error as? SetupError)?.message ?? error.localizedDescription)")
                if manual { notes.append((error as? SetupError)?.message ?? error.localizedDescription) }
            }
        }
        if due(Defaults.lastSyncCheck), !busy, SyncPackage.isInstalled(paths) {
            do {
                if try await updateSyncIfNewer(interruptingAgents: manual) {
                    defaults.set(Date(), forKey: Defaults.lastSyncCheck)
                }
            } catch {
                let message = (error as? SetupError)?.message ?? error.localizedDescription
                log.app("Sync update: \(message)")
                if manual { notes.append(message) }
            }
        }
        if manual {
            updateNote = notes.first ?? (stagedApp == nil && manualAppVersion == nil ? "Everything is up to date." : nil)
            rebuildMenu()
        }
    }

    /// Installs the newer Sync beside the running one, then swaps with a few seconds' gap. Unless
    /// asked, it never stops an agent mid-answer: false means it waits for a later check.
    @MainActor
    private func updateSyncIfNewer(interruptingAgents: Bool) async throws -> Bool {
        let release = try await SyncPackage.latestRelease()
        let installed = SyncPackage.installedVersion(in: paths.app)
        guard SyncPackage.isNewer(release.version, than: installed) else { return true }
        if !interruptingAgents, child?.agentsRunning == true {
            log.app("Tinkjam Sync \(release.version) installs once no agent is running")
            return false
        }
        busy = true
        defer { busy = false }
        log.app("Updating Tinkjam Sync from \(installed ?? "?") to \(release.version)")
        let staging = try await SyncPackage.stage(release, paths: paths, log: log) { _, _ in }
        let wasRunning = child != nil
        await stopSync()
        try await takeOver(staged: staging)
        if wasRunning { startSync() }
        return true
    }

    private func restartToUpdate() {
        guard let staged = stagedApp else { return }
        Task { @MainActor in
            await stopSync()
            do {
                log.app("Restarting to install Tinkjam Sync for Mac \(staged.version)")
                try AppUpdater.launchSwap(staged, log: paths.log)
                onMainRunLoop { NSApp.terminate(nil) }
            } catch {
                phase = .stopped("Could not install the new version: \(error.localizedDescription)")
                startSync()
            }
        }
    }

    // MARK: Network

    private func watchNetwork() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self else { return }
                let nowOnline = path.status == .satisfied
                defer { self.online = nowOnline }
                // Back online after a failed download: try again without being asked.
                if nowOnline, !self.online, self.waitingForNetwork, case .stopped = self.phase {
                    Task { await self.bootstrap() }
                }
            }
        }
        monitor.start(queue: .global(qos: .utility))
        pathMonitor = monitor
    }

    // MARK: Login item

    /// In /Applications or ~/Applications: where an app may start at login and replace itself.
    private var isInApplications: Bool {
        let parent = Bundle.main.bundleURL.deletingLastPathComponent().standardizedFileURL.path
        return parent == "/Applications" || parent == NSHomeDirectory() + "/Applications"
    }

    private var wantsStartAtLogin: Bool {
        UserDefaults.standard.object(forKey: Defaults.startAtLogin) as? Bool ?? true
    }

    /// "Start at login" is a preference (on unless turned off) applied to whichever copy runs,
    /// so it follows the app when it is moved or replaced. A copy outside Applications, or one
    /// running a test home, never registers itself.
    private func applyLoginItemPreference() {
        let service = SMAppService.mainApp
        do {
            if !wantsStartAtLogin {
                if service.status == .enabled { try service.unregister() }
            } else if paths.isDefault, isInApplications, service.status != .enabled, service.status != .requiresApproval {
                try service.register()
            }
            let names: [SMAppService.Status: String] = [.enabled: "enabled", .notRegistered: "notRegistered",
                                                        .requiresApproval: "requiresApproval", .notFound: "notFound"]
            log.app("Start at login: \(wantsStartAtLogin ? "on" : "off") (SMAppService.mainApp.status = \(names[service.status] ?? "unknown"))")
        } catch {
            log.app("Could not change Start at login: \(error.localizedDescription)")
        }
    }

    @objc private func toggleLoginItem() {
        if SMAppService.mainApp.status == .requiresApproval {
            SMAppService.openSystemSettingsLoginItems()
            return
        }
        setStartAtLogin(SMAppService.mainApp.status != .enabled)
    }

    private func setStartAtLogin(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: Defaults.startAtLogin)
        applyLoginItemPreference()
        if on, SMAppService.mainApp.status != .enabled, !isInApplications {
            alert("Tinkjam Sync can start at login once it is in Applications",
                  "Drag it to your Applications folder, open it from there, and it will start at login.")
        }
        rebuildMenu()
    }

    /// Opened from the disk image or Downloads: offer to move into Applications first, as most
    /// Mac apps do, since only there can it start at login and update itself.
    private func offerMoveToApplications() -> Bool {
        guard paths.isDefault, !isInApplications, !UserDefaults.standard.bool(forKey: "SkipMoveToApplications") else { return false }
        let ask = NSAlert()
        ask.messageText = "Move Tinkjam Sync to your Applications folder?"
        ask.informativeText = "It needs to be in Applications to start when you log in and to keep itself up to date."
        ask.addButton(withTitle: "Move to Applications")
        ask.addButton(withTitle: "Not Now")
        NSApp.activate(ignoringOtherApps: true)
        guard ask.runModal() == .alertFirstButtonReturn else { return false }
        let fm = FileManager.default
        let source = Bundle.main.bundleURL
        let folder = fm.isWritableFile(atPath: "/Applications") ? URL(fileURLWithPath: "/Applications")
            : fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications")
        let destination = folder.appendingPathComponent(source.lastPathComponent)
        do {
            try fm.createDirectory(at: folder, withIntermediateDirectories: true)
            if fm.fileExists(atPath: destination.path) { try fm.trashItem(at: destination, resultingItemURL: nil) }
            try fm.copyItem(at: source, to: destination)
            // A copy in Downloads goes to the Trash; one on the disk image or quarantined stays put.
            if !source.path.contains("/AppTranslocation/"), !source.path.hasPrefix("/Volumes/"),
               fm.isWritableFile(atPath: source.deletingLastPathComponent().path) {
                try? fm.trashItem(at: source, resultingItemURL: nil)
            }
            try spawnDetachedScript("while kill -0 \(getpid()) 2>/dev/null; do sleep 0.2; done; /usr/bin/open \"$1\"",
                                    ["move", destination.path], output: paths.log)
            log.app("Moved to \(destination.path); opening it from there")
            onMainRunLoop { NSApp.terminate(nil) }
            return true
        } catch {
            alert("Could not move Tinkjam Sync", "\(error.localizedDescription)\n\nDrag it to the Applications folder yourself, then open it from there.")
            return false
        }
    }

    // MARK: Actions

    @objc private func openTinkjam() { NSWorkspace.shared.open(Config.hostedAppURL) }

    @objc private func openApprovalAgain() {
        if case .awaitingApproval(let url) = phase { NSWorkspace.shared.open(url) }
    }

    @objc private func connect() {
        UserDefaults.standard.set(false, forKey: Defaults.disconnected)
        openedApprovalThisSession = false
        restarts = []
        if child == nil { startSync() }
    }

    @objc private func disconnect() {
        let confirm = NSAlert()
        confirm.messageText = "Disconnect this Mac from Tinkjam?"
        confirm.informativeText = "Your boards will no longer reach the agents on this Mac until you connect it again. You will need to approve it in your browser to reconnect."
        confirm.addButton(withTitle: "Disconnect")
        confirm.addButton(withTitle: "Cancel")
        confirm.buttons.first?.hasDestructiveAction = true
        NSApp.activate(ignoringOtherApps: true)
        guard confirm.runModal() == .alertFirstButtonReturn else { return }
        Task { @MainActor in
            phase = .settingUp("Disconnecting…", nil)
            await stopSync()
            let result = await run(paths.node, [Paths.serverEntry(in: paths.app).path, "sync", "--disconnect",
                                                "--base-dir", paths.base.path],
                                   environment: nodeEnvironment(), timeout: 120)
            log.app("--disconnect: \(result.tail(4))")
            // Only a finished disconnect keeps Sync off; otherwise Retry or a relaunch connects again.
            if result.succeeded { UserDefaults.standard.set(true, forKey: Defaults.disconnected) }
            phase = result.succeeded ? .notConnected(nil) : .stopped("Could not disconnect: \(result.tail(1))")
        }
    }

    @objc private func retry() {
        UserDefaults.standard.removeObject(forKey: Defaults.disconnected)
        restarts = []
        openedApprovalThisSession = false
        if NodeRuntime.isInstalled(paths), SyncPackage.isInstalled(paths), child == nil, !busy {
            Task { @MainActor in
                do { try await takeOver(staged: nil); startSync() } catch {
                    phase = .stopped((error as? SetupError)?.message ?? error.localizedDescription)
                }
            }
        } else {
            Task { await bootstrap() }
        }
    }

    @objc private func showLog() {
        if !FileManager.default.fileExists(atPath: paths.log.path) { log.app("Log opened") }
        // Console shows a log as it grows; fall back to whatever opens text.
        let console = URL(fileURLWithPath: "/System/Applications/Utilities/Console.app")
        NSWorkspace.shared.open([paths.log], withApplicationAt: console, configuration: NSWorkspace.OpenConfiguration()) { _, error in
            if error != nil { DispatchQueue.main.async { NSWorkspace.shared.open(self.paths.log) } }
        }
    }

    @objc private func checkForUpdatesClicked() { Task { await checkForUpdates(manual: true) } }
    @objc private func restartToUpdateClicked() { restartToUpdate() }
    @objc private func downloadUpdate() { NSWorkspace.shared.open(Config.downloadPageURL) }
    @objc private func quit() { onMainRunLoop { NSApp.terminate(nil) } }

    /// `tinkjam-sync://connect`, `…/check-for-updates`, `…/restart-to-update`, `…/start-at-login?enabled=0|1`,
    /// `…/quit`, `…/menu`, `…/disconnect` (asks first): the menu's
    /// actions for scripts and agents, which `open` can reach without any permission.
    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let text = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let url = URL(string: text) else { return }
        log.app("Opened \(text)")
        switch url.host ?? "" {
        case "connect": if case .notConnected = phase { connect() } else if case .stopped = phase { retry() }
        case "check-for-updates": checkForUpdatesClicked()
        case "restart-to-update": restartToUpdate()
        case "quit": quit()
        case "disconnect": if case .connected = phase { disconnect() }
        case "start-at-login":
            // tinkjam-sync://start-at-login?enabled=0 (or 1)
            let enabled = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first { $0.name == "enabled" }?.value
            setStartAtLogin(enabled != "0" && enabled != "false")
        case "menu":
            // Opens the menu for a few seconds, for screenshots and for showing someone where it is.
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.menu.cancelTracking() }
            statusItem.button?.performClick(nil)
        default: break
        }
    }

    private func alert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    // MARK: Menu

    private func phaseChanged(from old: Phase) {
        if case .settingUp(let step, _) = phase, case .settingUp(let oldStep, _) = old, step == oldStep {
            // Only the progress moved.
        } else {
            let (title, _, detail) = statusText()
            let line = "Status: \(title)\(detail.map { " (\($0))" } ?? "")"
            if line != lastLoggedStatus { log.app(line) }
            lastLoggedStatus = line
        }
        phaseSince = Date()
        if case .connected = phase { restarts = restarts.filter { Date().timeIntervalSince($0) < 600 } }
        statusItem?.button?.appearsDisabled = phase != .connected
        rebuildMenu()
        updateSetupWindow()
    }

    private var computerName: String {
        (SCDynamicStoreCopyComputerName(nil, nil) as String?) ?? Host.current().localizedName ?? "This Mac"
    }

    private func statusText() -> (String, NSColor, String?) {
        switch phase {
        case .settingUp(let step, let fraction):
            let percent = fraction.map { " \(Int($0 * 100))%" } ?? ""
            return ("Setting up…", .systemBlue, step + percent)
        case .connecting(let reason):
            // The specific reason once it has been waiting a while; a restart says so at once.
            let waited = Date().timeIntervalSince(phaseSince) > 20 || (reason?.hasPrefix("Restarting") ?? false)
            return ("Connecting…", .systemOrange, waited ? reason : nil)
        case .awaitingApproval:
            return ("Waiting for you to approve in your browser…", .systemOrange, nil)
        case .connected:
            return ("Connected", .systemGreen, nil)
        case .notConnected(let note):
            return ("Not connected", .systemGray, note)
        case .stopped(let message):
            return ("Stopped", .systemRed, message)
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) { rebuildMenu() }

    private func rebuildMenu() {
        menu.removeAllItems()
        let (title, color, detail) = statusText()
        let status = NSMenuItem(title: title, action: nil, keyEquivalent: "")
        status.image = Mark.statusDot(color)
        status.isEnabled = false
        menu.addItem(status)
        if let detail, !detail.isEmpty {
            menu.addItem(note(detail))
        }
        menu.addItem(note(computerName))
        menu.addItem(.separator())

        menu.addItem(item("Open Tinkjam", #selector(openTinkjam)))
        switch phase {
        case .awaitingApproval:
            menu.addItem(item("Open Again", #selector(openApprovalAgain)))
        case .notConnected:
            menu.addItem(item("Connect…", #selector(connect)))
        case .stopped:
            menu.addItem(item("Retry", #selector(retry)))
        case .connected, .connecting:
            menu.addItem(item("Disconnect this Mac…", #selector(disconnect)))
        case .settingUp:
            break
        }
        menu.addItem(.separator())

        let login = item("Start at Login", #selector(toggleLoginItem))
        switch SMAppService.mainApp.status {
        case .enabled: login.state = .on
        case .requiresApproval: login.title = "Start at Login (allow in System Settings)"; login.state = .mixed
        default: login.state = .off
        }
        menu.addItem(login)
        menu.addItem(item("Show Log", #selector(showLog)))
        menu.addItem(.separator())

        let syncVersion = SyncPackage.installedVersion(in: paths.app).map { " · Sync \($0)" } ?? ""
        menu.addItem(note("Version \(Machine.appVersion)\(syncVersion)"))
        if let staged = stagedApp {
            menu.addItem(item("Restart to Update (\(staged.version))", #selector(restartToUpdateClicked)))
        } else if let version = manualAppVersion {
            menu.addItem(item("A new version is available (\(version)): Download", #selector(downloadUpdate)))
        }
        if let updateNote { menu.addItem(note(updateNote)) }
        menu.addItem(item("Check for Updates", #selector(checkForUpdatesClicked)))
        menu.addItem(.separator())
        menu.addItem(item("Quit Tinkjam Sync", #selector(quit), key: "q"))
    }

    private func item(_ title: String, _ action: Selector, key: String = "") -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        return item
    }

    private func note(_ text: String) -> NSMenuItem {
        let item = NSMenuItem(title: text, action: nil, keyEquivalent: "")
        item.isEnabled = false
        item.indentationLevel = 1
        if text.count > 60 {
            // Long reasons wrap instead of stretching the menu across the screen.
            let style = NSMutableParagraphStyle()
            style.lineBreakMode = .byWordWrapping
            item.attributedTitle = NSAttributedString(string: wrap(text, width: 56), attributes: [
                .font: NSFont.menuFont(ofSize: 12), .foregroundColor: NSColor.secondaryLabelColor, .paragraphStyle: style,
            ])
        }
        return item
    }

    private func wrap(_ text: String, width: Int) -> String {
        var lines: [String] = []
        var line = ""
        for word in text.split(separator: " ") {
            if line.count + word.count + 1 > width, !line.isEmpty { lines.append(line); line = "" }
            line += (line.isEmpty ? "" : " ") + word
        }
        if !line.isEmpty { lines.append(line) }
        return lines.joined(separator: "\n")
    }

    // MARK: Setup window

    /// The phase is often set before the window shows, so fill it in as it appears.
    private func presentSetupWindow() {
        setupWindow.present()
        updateSetupWindow()
    }

    private func updateSetupWindow() {
        guard setupWindow.isVisible else { return }
        switch phase {
        case .settingUp(let step, let fraction):
            setupWindow.show(title: "Setting up Tinkjam Sync",
                             detail: "\(step)\nThis happens once and takes a minute or two.",
                             progress: .some(fraction))
        case .connecting(let reason):
            setupWindow.show(title: "Connecting this Mac…", detail: reason ?? "This takes a few seconds.", progress: .some(nil))
        case .awaitingApproval(let url):
            setupWindow.show(title: "Approve this Mac in your browser",
                             detail: "A Tinkjam page opened in your browser. Sign in there and press Connect. This window updates by itself.",
                             button: "Open the Page Again") { NSWorkspace.shared.open(url) }
        case .connected:
            setupWindow.show(title: "This Mac is connected",
                             detail: "Tinkjam Sync runs from the menu bar (the icon at the top right of your screen) and starts when you log in. You can close this window.",
                             button: "Done") { [weak self] in self?.setupWindow.close() }
        case .notConnected(let note):
            setupWindow.show(title: "This Mac is not connected", detail: note ?? "", button: "Connect…") { [weak self] in self?.connect() }
        case .stopped(let message):
            setupWindow.show(title: "Tinkjam Sync stopped", detail: message, button: "Retry") { [weak self] in self?.retry() }
        }
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }
}

/// Runs `work` from the main run loop in every mode, outside any main-queue job, which is where
/// AppKit expects `terminate` and the reply to `applicationShouldTerminate`.
func onMainRunLoop(_ work: @escaping @MainActor () -> Void) {
    RunLoop.main.perform(inModes: [.common, .modalPanel, .eventTracking]) { MainActor.assumeIsolated { work() } }
    CFRunLoopWakeUp(CFRunLoopGetMain())
}
