import AppKit
import Network
import ServiceManagement
import SystemConfiguration
import UserNotifications

/// What the menu says, one at a time.
enum Phase: Equatable {
    case settingUp(String, Double?)
    /// Something short the person asked for, such as disconnecting.
    case working(String)
    case connecting(String?)
    case awaitingApproval(URL)
    case connected
    /// Was connected; Sync is running but boards cannot reach this Mac right now.
    case reconnecting(String)
    case notConnected(String?)
    case stopped(String)
}

/// Preference keys. A test copy with its own home keeps its own, so it never changes the real one's.
private enum Defaults {
    private static let suffix = Paths.resolve().isDefault ? "" : "@" + Paths.resolve().base.path
    static let disconnected = "DisconnectedByPerson" + suffix
    static let startAtLogin = "StartAtLogin" + suffix
    static let lastSyncCheck = "LastSyncUpdateCheck" + suffix
    static let lastAppCheck = "LastAppUpdateCheck" + suffix
    /// The version a bundle swap was started for, and the one whose swap did not take.
    static let appSwapAttempt = "AppSwapAttempt"
    static let failedAppSwap = "FailedAppSwap"
}

private enum SyncUpdate {
    case current
    case installed
    case waitingForAgent
    case notNow
}

/// Runs everything: setup, the one Sync, the menu bar panel, updates.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private static let showRequest = Notification.Name("org.trellium.tinkjam-sync-app.show")

    private let paths = Paths.resolve()
    private lazy var log = LogFile(url: paths.log)
    private var statusItem: NSStatusItem!
    private lazy var panel = MenuPanel(delegate: self)
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
    private var connectedOnce = false
    private var approvedThisRun = false
    private var portBusyThisRun = false
    private var heldThisRun: SyncLine?
    private var stagedApp: AppUpdater.Staged?
    private var swapping = false
    private var manualAppVersion: String?
    private var updateNote: String?
    private var checkingUpdates = false
    private var manualCheckRunning = false
    private var pathMonitor: NWPathMonitor?
    private var online = true
    private var signalSource: DispatchSourceSignal?
    private var lastLoggedStatus = ""
    private var retryWork: DispatchWorkItem?
    private var retryArmed = false
    private var failedTries = 0
    private var attentionNotified = false
    private var shownFailureWindow = false
    private var lastStamp: String?
    private var heartbeatSeen = false
    private let stampWithFraction: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
    private let stampPlain = ISO8601DateFormatter()

    // MARK: Launch and quit

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard takeHomeLock() else {
            // Another copy already runs this home's Sync; one is all there may be.
            NSApp.terminate(nil)
            return
        }
        if offerMoveToApplications() { return }
        noteLastSwap()
        if applyStagedAppAtLaunch() { return }
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.squareLength)
        if let button = statusItem.button {
            button.image = Mark.menuBarImage()
            button.setAccessibilityLabel("Tinkjam Sync")
            button.target = self
            button.action = #selector(statusItemClicked)
            _ = button.sendAction(on: [.leftMouseDown, .rightMouseDown])
        }
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
        // A second copy opened for the same home asks this one to show itself, then quits.
        DistributedNotificationCenter.default().addObserver(forName: AppDelegate.showRequest, object: nil,
                                                            queue: .main) { [weak self] note in
            guard let self, (note.object as? String) == self.paths.base.path else { return }
            self.presentSetupWindow(activate: true)
        }
        watchNetwork()
        log.app("Tinkjam Sync for Mac \(Machine.appIdentity) started (home \(paths.base.path))")
        applyLoginItemPreference()
        Task { await bootstrap() }
        updateTimer = Timer.scheduledTimer(withTimeInterval: 60 * 60, repeats: true) { [weak self] _ in
            Task { await self?.checkForUpdates(manual: false) }
        }
        // A laptop that sleeps through the hour asks on waking, once Wi-Fi is back.
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification,
                                                          object: nil, queue: .main) { [weak self] _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) {
                self?.retryAutomatically()
                Task { await self?.checkForUpdates(manual: false) }
            }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        presentSetupWindow(activate: true)
        return false
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        guard let child else { return .terminateNow }
        log.app("Quitting: stopping Tinkjam Sync")
        restartWork?.cancel()
        retryWork?.cancel()
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
        for attempt in 0..<50 {
            if flock(lockFile, LOCK_EX | LOCK_NB) == 0 { return true }
            if attempt == 5 {
                // Still held after a second: a copy that is staying. It shows itself in answer.
                DistributedNotificationCenter.default().postNotificationName(
                    AppDelegate.showRequest, object: paths.base.path, userInfo: nil, deliverImmediately: true)
            }
            usleep(200_000)
        }
        log.app("Another copy of Tinkjam Sync already runs; this one quits")
        return false
    }

    // MARK: Setup

    /// First launch does everything: Node, the Sync package, taking over an older Sync, starting.
    /// An automatic retry never opens the setup window in front of what the person is doing.
    @MainActor
    private func bootstrap(automatic: Bool = false) async {
        guard !busy else {
            if case .stopped = phase { armRetry(after: 60) }
            return
        }
        busy = true
        defer { busy = false }
        disarmRetry()
        let firstRun = !NodeRuntime.isInstalled(paths) || !SyncPackage.isInstalled(paths)
        if firstRun, !automatic { presentSetupWindow(activate: true) }
        do {
            if loginPath == nil {
                phase = .settingUp("Getting ready…", nil)
                loginPath = await Task.detached { LoginShell.path() }.value
            }
            if !NodeRuntime.isInstalled(paths) {
                phase = .settingUp("Downloading what Tinkjam Sync needs…", 0)
                try await NodeRuntime.install(paths, log: log) { fraction in
                    DispatchQueue.main.async { self.showProgress("Downloading what Tinkjam Sync needs…", fraction) }
                }
            }
            var staged: URL?
            if !SyncPackage.isInstalled(paths) {
                phase = .settingUp("Downloading Tinkjam Sync…", nil)
                let release = try await SyncPackage.latestRelease()
                staged = try await SyncPackage.stage(release, paths: paths, log: log) { step, fraction in
                    DispatchQueue.main.async { self.showProgress(step, fraction) }
                }
                UserDefaults.standard.set(Date(), forKey: Defaults.lastSyncCheck)
            }
            try await takeOver(staged: staged)
            shownFailureWindow = false
            if UserDefaults.standard.bool(forKey: Defaults.disconnected) {
                phase = .notConnected(nil)
            } else {
                startSync()
            }
            Task { await checkForUpdates(manual: false) }
        } catch {
            let failure = SetupError.from(error, doing: "setting up")
            log.app("Setup stopped: \(failure.logLine)")
            giveUp(failure.message, offline: failure.offline)
            if firstRun, !setupWindow.isVisible, !shownFailureWindow {
                shownFailureWindow = true
                presentSetupWindow(activate: false)
            }
        }
    }

    /// Whole percents only, and only while setup is what the menu shows.
    private func showProgress(_ step: String, _ fraction: Double?) {
        guard case .settingUp = phase else { return }
        var whole: Double?
        if let fraction { whole = (fraction * 100).rounded() / 100 }
        phase = .settingUp(step, whole)
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
            if case .settingUp = phase { phase = .settingUp("Replacing the older Tinkjam Sync…", nil) }
            log.app("Taking over from the older Tinkjam Sync: \(items.map(\.path).joined(separator: ", "))")
            // `--uninstall` deletes `<home>/app`, so it runs from a staged copy that then replaces it.
            if root == nil { root = try SyncPackage.stageCopyOfInstalled(paths) }
            let result = await run(paths.node, [Paths.launcher(in: root!).path, "--uninstall", "--base-dir", paths.base.path],
                                   environment: nodeEnvironment(), timeout: 120)
            log.app("--uninstall: \(result.tail(8))")
            if Legacy.jobLoaded(paths) { Legacy.bootOutJob() }
            if !Legacy.loginItems(paths).isEmpty || Legacy.jobLoaded(paths) {
                throw SetupError(Plain.olderCopy, detail: "the older Tinkjam Sync login item could not be removed")
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

    // MARK: Giving up, and trying again without being asked

    /// Shows why it is not working and tries again later, on waking and when the network returns.
    /// The person is told once, and only when waiting will not fix it.
    private func giveUp(_ message: String, offline: Bool = false, needsPerson: Bool = false) {
        phase = .stopped(message)
        armRetry(after: offline ? Config.offlineRetryInterval : Config.slowRetryInterval)
        if !offline { failedTries += 1 }
        guard needsPerson || failedTries >= 4, !attentionNotified else { return }
        attentionNotified = true
        notify(id: "attention", title: "Tinkjam Sync needs your attention", body: message)
    }

    private func armRetry(after delay: TimeInterval) {
        retryWork?.cancel()
        retryArmed = true
        let work = DispatchWorkItem { [weak self] in self?.retryAutomatically() }
        retryWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    private func disarmRetry() {
        retryWork?.cancel()
        retryWork = nil
        retryArmed = false
    }

    private func retryAutomatically() {
        guard retryArmed, child == nil, case .stopped = phase else { return }
        if busy {
            armRetry(after: 60)
            return
        }
        log.app("Trying again")
        startOver(automatic: true)
    }

    private func startOver(automatic: Bool) {
        disarmRetry()
        restarts = []
        guard NodeRuntime.isInstalled(paths), SyncPackage.isInstalled(paths) else {
            Task { await bootstrap(automatic: automatic) }
            return
        }
        guard child == nil else { return }
        if busy {
            armRetry(after: 60)
            return
        }
        busy = true
        phase = .connecting(Plain.startingAgain)
        Task { @MainActor in
            defer { busy = false }
            do {
                try await takeOver(staged: nil)
                if UserDefaults.standard.bool(forKey: Defaults.disconnected) {
                    phase = .notConnected(nil)
                } else {
                    startSync()
                }
            } catch {
                let failure = SetupError.from(error, doing: "starting again")
                log.app("Could not start again: \(failure.logLine)")
                giveUp(failure.message, offline: failure.offline)
            }
        }
    }

    // MARK: The one Sync

    private func startSync() {
        guard child == nil, !UserDefaults.standard.bool(forKey: Defaults.disconnected) else { return }
        disarmRetry()
        restartWork = nil
        approvedThisRun = false
        portBusyThisRun = false
        heldThisRun = nil
        lastStamp = nil
        heartbeatSeen = false
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
            log.app("Tinkjam Sync could not start: \(error.localizedDescription)")
            giveUp(Plain.couldNotStart)
            return
        }
        child = sync
        ChildRecord.write(sync.pid, paths: paths)
        let version = SyncPackage.installedVersion(in: paths.app) ?? "?"
        log.app("Started Tinkjam Sync \(version) (pid \(sync.pid)\(appMode ? ", --app" : ""))")
        phase = .connecting(nil)
        pollStatus(every: 2)
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
            guard !openedApprovalThisSession else { break }
            openedApprovalThisSession = true
            if connectedOnce {
                // It was connected earlier in this run, so nobody is sitting in front of setup.
                notify(id: "approve", title: "This Mac needs approving again",
                       body: "Click here to open the approval page, then sign in and press Connect.")
            } else {
                NSWorkspace.shared.open(url)
                presentSetupWindow(activate: true)
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

    private func pollStatus(every seconds: TimeInterval) {
        statusTimer?.invalidate()
        statusTimer = Timer.scheduledTimer(withTimeInterval: seconds, repeats: true) { [weak self] _ in self?.pollStatus() }
    }

    private func pollStatus() {
        guard let child else { return }
        guard let status = SyncStatus.read(paths), status.pid == child.pid else { return }
        switch phase {
        case .connecting(let previous):
            if status.status == "reachable" {
                markConnected()
                return
            }
            // A check that names no reason keeps the last one, so the menu does not flicker.
            if !online {
                phase = .connecting(Plain.noInternet)
            } else if let reason = Plain.connecting(cause: status.cause) {
                phase = .connecting(reason)
            } else if previous == Plain.noInternet {
                phase = .connecting(nil)
            }
        case .connected, .reconnecting:
            updateConnection(status)
        default:
            break
        }
    }

    /// After the first "connected", the status file keeps saying whether boards can still reach
    /// this Mac. Its age only counts once it has been seen to change: packages from before the
    /// 30-second rewrite stop at the first "reachable", and theirs is trusted as it stands.
    private func updateConnection(_ status: SyncStatus) {
        if let stamp = status.checkedAt {
            if let last = lastStamp, last != stamp { heartbeatSeen = true }
            lastStamp = stamp
        }
        var problem: String?
        if !online {
            problem = Plain.noInternet
        } else if status.status != "reachable" {
            problem = Plain.connecting(cause: status.cause) ?? Plain.stillTrying
        } else if heartbeatSeen, let stamp = status.checkedAt, let checked = date(fromStamp: stamp),
                  Date().timeIntervalSince(checked) > Config.statusStaleAfter {
            problem = Plain.stillTrying
        }
        if let problem {
            phase = .reconnecting(problem)
        } else {
            phase = .connected
        }
    }

    private func date(fromStamp stamp: String) -> Date? {
        stampWithFraction.date(from: stamp) ?? stampPlain.date(from: stamp)
    }

    private func markConnected() {
        connectedOnce = true
        openedApprovalThisSession = false
        failedTries = 0
        attentionNotified = false
        if case .connected = phase { return }
        phase = .connected
        pollStatus(every: 15)
        if approvedThisRun {
            approvedThisRun = false
            notify(id: "connected", title: "This Mac is connected to Tinkjam",
                   body: "Your agents here are now available on your boards.")
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
            log.app("Port \(Config.approvalPort) is in use by another app, so this Mac can't be approved")
            giveUp(Plain.portBusy, needsPerson: true)
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
                do {
                    try await takeOver(staged: nil)
                    scheduleRestart(reason: "another Tinkjam Sync was running")
                } catch {
                    let failure = SetupError.from(error, doing: "taking over")
                    log.app("Could not take over: \(failure.logLine)")
                    giveUp(failure.message, offline: failure.offline)
                }
            }
            return
        }
        scheduleRestart(reason: "it stopped unexpectedly (\(how))")
    }

    /// 2, 4, 8, 16, 32 seconds; the sixth exit within ten minutes waits for the slow retry.
    private func scheduleRestart(reason: String) {
        let now = Date()
        restarts = restarts.filter { now.timeIntervalSince($0) < 600 }
        guard restarts.count < 5 else {
            log.app("Tinkjam Sync stopped 5 times in 10 minutes; the last time \(reason)")
            restarts = []
            giveUp(Plain.keepsStopping)
            return
        }
        let delay = pow(2.0, Double(restarts.count + 1))
        restarts.append(now)
        log.app("Restarting in \(Int(delay)) seconds: \(reason)")
        phase = .connecting(Plain.startingAgain)
        let work = DispatchWorkItem { [weak self] in self?.startSync() }
        restartWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: work)
    }

    // MARK: Updates

    /// One check at a time. Only a click on the menu item may ask to stop a working agent.
    @MainActor
    private func checkForUpdates(manual: Bool, mayAsk: Bool = true) async {
        guard !checkingUpdates else { return }
        checkingUpdates = true
        defer { checkingUpdates = false }
        let defaults = UserDefaults.standard
        let due = { (key: String) in
            manual || Date().timeIntervalSince(defaults.object(forKey: key) as? Date ?? .distantPast) >= Config.updateCheckInterval
        }
        if manual {
            manualCheckRunning = true
            updateNote = "Checking for updates…"
            refreshPanel()
        }
        var failed = false
        var waitingForAgent = false
        if due(Defaults.lastAppCheck), stagedApp == nil {
            do {
                switch try await AppUpdater.check(log: log) {
                case .upToDate: manualAppVersion = nil
                case .staged(let staged): stagedApp = staged
                case .manual(let version): manualAppVersion = version
                }
                defaults.set(Date(), forKey: Defaults.lastAppCheck)
            } catch {
                log.app("App update check: \((error as? SetupError)?.logLine ?? error.localizedDescription)")
                failed = true
            }
        }
        if due(Defaults.lastSyncCheck), !busy, NodeRuntime.isInstalled(paths), SyncPackage.isInstalled(paths) {
            do {
                var outcome = try await updateSyncIfNewer(interruptingAgents: false)
                if outcome == .waitingForAgent, manual, mayAsk,
                   agentIsWorking("Updating now stops what it is doing. Tinkjam Sync can update by itself when the agent finishes.",
                                  wait: "Update When It Finishes", proceed: "Update Now") {
                    outcome = try await updateSyncIfNewer(interruptingAgents: true)
                }
                switch outcome {
                case .current, .installed: defaults.set(Date(), forKey: Defaults.lastSyncCheck)
                case .waitingForAgent: waitingForAgent = true
                case .notNow: break
                }
            } catch {
                log.app("Sync update: \((error as? SetupError)?.logLine ?? error.localizedDescription)")
                failed = true
            }
        }
        if manual {
            manualCheckRunning = false
            if failed {
                updateNote = Plain.updateCheckFailed
            } else if waitingForAgent {
                updateNote = "The update installs when the agent finishes."
            } else if stagedApp == nil && manualAppVersion == nil {
                updateNote = "Everything is up to date."
            } else {
                updateNote = nil
            }
            refreshPanel()
        }
        applyStagedAppIfIdle()
    }

    /// Installs the newer Sync beside the running one, then swaps with a few seconds' gap. Unless
    /// asked, it never stops an agent mid-answer or a person mid-approval. Afterwards Sync runs
    /// again unless the person disconnected this Mac, also when the swap failed.
    @MainActor
    private func updateSyncIfNewer(interruptingAgents: Bool) async throws -> SyncUpdate {
        let release = try await SyncPackage.latestRelease()
        let installed = SyncPackage.installedVersion(in: paths.app)
        guard SyncPackage.isNewer(release.version, than: installed) else { return .current }
        guard !busy else { return .notNow }
        if let deferral = syncUpdateDeferral(release, interruptingAgents: interruptingAgents) { return deferral }
        busy = true
        defer { busy = false }
        log.app("Updating Tinkjam Sync from \(installed ?? "?") to \(release.version)")
        let staging = try await SyncPackage.stage(release, paths: paths, log: log) { _, _ in }
        defer { try? FileManager.default.removeItem(at: staging) }
        if let deferral = syncUpdateDeferral(release, interruptingAgents: interruptingAgents) { return deferral }
        await stopSync()
        do {
            try await takeOver(staged: staging)
        } catch {
            if !UserDefaults.standard.bool(forKey: Defaults.disconnected), SyncPackage.isInstalled(paths) {
                log.app("The update was not installed; starting the Tinkjam Sync that was here")
                restarts = []
                startSync()
            }
            throw error
        }
        if !UserDefaults.standard.bool(forKey: Defaults.disconnected) {
            restarts = []
            startSync()
        }
        return .installed
    }

    private func syncUpdateDeferral(_ release: SyncRelease, interruptingAgents: Bool) -> SyncUpdate? {
        if case .working = phase { return .notNow }
        guard !interruptingAgents else { return nil }
        if child?.agentsRunning == true {
            log.app("Tinkjam Sync \(release.version) installs once no agent is running")
            return .waitingForAgent
        }
        if case .awaitingApproval = phase { return .notNow }
        return nil
    }

    /// The version a swap was started for is this copy's when it worked. One that did not take is
    /// remembered, so it is not tried again without a click.
    private func noteLastSwap() {
        let defaults = UserDefaults.standard
        guard let attempt = defaults.string(forKey: Defaults.appSwapAttempt) else { return }
        defaults.removeObject(forKey: Defaults.appSwapAttempt)
        if attempt == Machine.appIdentity {
            defaults.removeObject(forKey: Defaults.failedAppSwap)
        } else {
            defaults.set(attempt, forKey: Defaults.failedAppSwap)
            log.app("The update to \(attempt) was not installed; this is still \(Machine.appIdentity)")
        }
    }

    /// A copy outside Applications (a test build) only replaces itself on a click.
    private func mayInstallUnasked(_ staged: AppUpdater.Staged) -> Bool {
        isInApplications && staged.identity != UserDefaults.standard.string(forKey: Defaults.failedAppSwap)
    }

    /// A launch is the cheapest moment to update: nothing runs yet.
    private func applyStagedAppAtLaunch() -> Bool {
        guard let staged = AppUpdater.stagedOnDisk(log: log) else { return false }
        stagedApp = staged
        guard mayInstallUnasked(staged) else { return false }
        do {
            try beginSwap(staged)
            return true
        } catch {
            log.app("Could not install the new version: \(error.localizedDescription)")
            UserDefaults.standard.set(staged.identity, forKey: Defaults.failedAppSwap)
            return false
        }
    }

    private func applyStagedAppIfIdle() {
        guard let staged = stagedApp, !busy, !swapping, child?.agentsRunning != true,
              !setupWindow.isVisible, mayInstallUnasked(staged) else { return }
        switch phase {
        case .connected, .reconnecting, .notConnected, .stopped:
            restartToUpdate()
        default:
            break
        }
    }

    private func beginSwap(_ staged: AppUpdater.Staged) throws {
        log.app("Restarting to install Tinkjam Sync for Mac \(staged.identity)")
        UserDefaults.standard.set(staged.identity, forKey: Defaults.appSwapAttempt)
        UserDefaults.standard.synchronize()
        do {
            try AppUpdater.launchSwap(staged, log: paths.log)
        } catch {
            UserDefaults.standard.removeObject(forKey: Defaults.appSwapAttempt)
            throw error
        }
        onMainRunLoop { NSApp.terminate(nil) }
    }

    private func restartToUpdate() {
        guard let staged = stagedApp, !swapping else { return }
        swapping = true
        Task { @MainActor in
            await stopSync()
            do {
                try beginSwap(staged)
            } catch {
                swapping = false
                log.app("Could not install the new version: \(error.localizedDescription)")
                UserDefaults.standard.set(staged.identity, forKey: Defaults.failedAppSwap)
                if !UserDefaults.standard.bool(forKey: Defaults.disconnected),
                   NodeRuntime.isInstalled(paths), SyncPackage.isInstalled(paths) {
                    startSync()
                }
            }
        }
    }

    // MARK: Network

    private func watchNetwork() {
        let monitor = NWPathMonitor()
        monitor.pathUpdateHandler = { [weak self] path in
            DispatchQueue.main.async {
                guard let self else { return }
                let wasOnline = self.online
                self.online = path.status == .satisfied
                // Back online after giving up: try again without being asked.
                if self.online, !wasOnline { self.retryAutomatically() }
                self.pollStatus()
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
        guard paths.isDefault else { return }
        let service = SMAppService.mainApp
        do {
            if !wantsStartAtLogin {
                if service.status == .enabled { try service.unregister() }
            } else if isInApplications, service.status != .enabled, service.status != .requiresApproval {
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
        guard paths.isDefault else {
            setStartAtLogin(!wantsStartAtLogin)
            return
        }
        if SMAppService.mainApp.status == .requiresApproval {
            SMAppService.openSystemSettingsLoginItems()
            return
        }
        setStartAtLogin(SMAppService.mainApp.status != .enabled)
    }

    private func setStartAtLogin(_ on: Bool) {
        UserDefaults.standard.set(on, forKey: Defaults.startAtLogin)
        applyLoginItemPreference()
        if on, paths.isDefault, SMAppService.mainApp.status != .enabled, !isInApplications {
            alert("Tinkjam Sync can start at login once it is in Applications",
                  "Drag it to your Applications folder, open it from there, and it will start at login.")
        }
        refreshPanel()
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
            // A copy that kept the download's quarantine mark would be run from a hidden
            // read-only place again, and would ask to be moved again.
            let cleared = runBlocking(URL(fileURLWithPath: "/usr/bin/xattr"),
                                      ["-dr", "com.apple.quarantine", destination.path], timeout: 30)
            if !cleared.succeeded { log.app("xattr: \(cleared.tail(2))") }
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
        connectedOnce = false
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
            UserDefaults.standard.set(true, forKey: Defaults.disconnected)
            disarmRetry()
            phase = .working("Disconnecting…")
            await stopSync()
            let result = await run(paths.node, [Paths.serverEntry(in: paths.app).path, "sync", "--disconnect",
                                                "--base-dir", paths.base.path],
                                   environment: nodeEnvironment(), timeout: 120)
            log.app("--disconnect: \(result.tail(4))")
            let stillListed = !result.succeeded || result.output.contains("Could not remove this computer")
            phase = .notConnected(stillListed ? Plain.stillListed : nil)
        }
    }

    @objc private func retry() {
        UserDefaults.standard.removeObject(forKey: Defaults.disconnected)
        openedApprovalThisSession = false
        connectedOnce = false
        startOver(automatic: false)
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

    @objc private func restartToUpdateClicked() {
        if child?.agentsRunning == true,
           !agentIsWorking("Restarting now stops what it is doing. Tinkjam Sync can update by itself when the agent finishes.",
                           wait: "Update When It Finishes", proceed: "Restart Now") { return }
        restartToUpdate()
    }

    @objc private func downloadUpdate() { NSWorkspace.shared.open(Config.downloadPageURL) }

    @objc private func quit() {
        if child?.agentsRunning == true,
           !agentIsWorking("Quitting now stops what it is doing, and your boards can no longer reach this Mac.",
                           wait: "Keep Running", proceed: "Quit Anyway") { return }
        onMainRunLoop { NSApp.terminate(nil) }
    }

    /// True when the person chose to go ahead although an agent is working.
    private func agentIsWorking(_ text: String, wait: String, proceed: String) -> Bool {
        let ask = NSAlert()
        ask.messageText = "An agent is working on this Mac"
        ask.informativeText = text
        ask.addButton(withTitle: wait)
        ask.addButton(withTitle: proceed)
        NSApp.activate(ignoringOtherApps: true)
        return ask.runModal() == .alertSecondButtonReturn
    }

    /// `tinkjam-sync://connect`, `…/disconnect` (asks first), `…/check-for-updates` (never stops
    /// an agent), `…/show`, `…/menu`. Any web page or app can open these links, so nothing here
    /// quits the app, changes a setting or interrupts work without the person agreeing.
    @objc private func handleURL(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let text = event.paramDescriptor(forKeyword: keyDirectObject)?.stringValue,
              let url = URL(string: text) else { return }
        let action = url.host ?? ""
        log.app("Opened tinkjam-sync://\(action)")
        switch action {
        case "connect":
            if case .notConnected = phase { connect() } else if case .stopped = phase { retry() }
        case "disconnect":
            switch phase {
            case .connected, .reconnecting: disconnect()
            default: break
            }
        case "check-for-updates":
            Task { await checkForUpdates(manual: true, mayAsk: false) }
        case "show":
            presentSetupWindow(activate: true)
        case "menu":
            // Opens the panel for a few seconds, for screenshots and for showing someone where it is.
            panel.open(from: statusItem.button)
            DispatchQueue.main.asyncAfter(deadline: .now() + 8) { self.panel.close() }
        default:
            break
        }
    }

    private func alert(_ title: String, _ text: String) {
        let alert = NSAlert()
        alert.messageText = title
        alert.informativeText = text
        NSApp.activate(ignoringOtherApps: true)
        alert.runModal()
    }

    /// Asks for permission the first time; without it, the menu and the window still say it.
    private func notify(id: String, title: String, body: String) {
        let center = UNUserNotificationCenter.current()
        center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
            guard granted else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            center.add(UNNotificationRequest(identifier: id, content: content, trigger: nil))
        }
    }

    // MARK: Menu

    private func phaseChanged(from old: Phase) {
        if case .settingUp(let step, _) = phase, case .settingUp(let oldStep, _) = old, step == oldStep {
            // Only the progress moved.
            refreshPanel()
            updateSetupWindow()
            return
        }
        let (title, _, detail) = statusText()
        let line = "Status: \(title)\(detail.map { " (\($0))" } ?? "")"
        if line != lastLoggedStatus { log.app(line) }
        lastLoggedStatus = line
        phaseSince = Date()
        if case .connected = phase { restarts = restarts.filter { Date().timeIntervalSince($0) < 600 } }
        statusItem?.button?.appearsDisabled = phase != .connected
        refreshPanel()
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
        case .working(let what):
            return (what, .systemBlue, nil)
        case .connecting(let reason):
            // The specific reason once it has been waiting a while; these two say so at once.
            let atOnce = reason == Plain.startingAgain || reason == Plain.noInternet
            let waited = Date().timeIntervalSince(phaseSince) > 20
            return ("Connecting…", .systemOrange, atOnce || waited ? reason : nil)
        case .awaitingApproval:
            return ("Waiting for you to approve in your browser…", .systemOrange, nil)
        case .connected:
            return ("Connected", .systemGreen, nil)
        case .reconnecting(let why):
            return ("Reconnecting…", .systemOrange, why)
        case .notConnected(let note):
            return ("Not connected", .systemGray, note)
        case .stopped(let message):
            return ("Can't connect right now", .systemRed, message)
        }
    }

    @objc private func statusItemClicked() { panel.toggle(from: statusItem.button) }

    private func refreshPanel() {
        if panel.isVisible { panel.refresh() }
    }

    /// The agents Sync can start here, and whether one is running under it now.
    private func agentRows() -> ([PanelAgent], String?) {
        let installed = AgentKind.installed(path: loginPath ?? LoginShell.fallback)
        let running = child?.agentExecutables ?? []
        var attributed = false
        let rows = installed.map { kind -> PanelAgent in
            if running.contains(where: { kind.matches(executable: $0) }) {
                attributed = true
                return PanelAgent(kind: kind, state: "In use", tone: .busy)
            }
            if case .connected = phase { return PanelAgent(kind: kind, state: "Ready", tone: .good) }
            return PanelAgent(kind: kind, state: "Installed", tone: .idle)
        }
        // An agent Node runs shows only as `node`, so it cannot be named.
        let note = !running.isEmpty && !attributed ? "An agent is in use on this Mac." : nil
        return (rows, note)
    }

    private func shortStatus() -> (String, PanelTone) {
        switch phase {
        case .settingUp: return ("Setting up…", .busy)
        case .working(let what): return (what, .busy)
        case .connecting: return ("Connecting…", .busy)
        case .awaitingApproval: return ("Waiting for approval", .busy)
        case .connected: return ("Connected", .good)
        case .reconnecting: return ("Reconnecting…", .busy)
        case .notConnected: return ("Not connected", .idle)
        case .stopped: return ("Can't connect", .bad)
        }
    }

    private func updateStatusLine() -> String? {
        if manualCheckRunning { return "Checking…" }
        if stagedApp != nil || manualAppVersion != nil { return "Update available" }
        if UserDefaults.standard.object(forKey: Defaults.lastAppCheck) != nil { return "Up to date" }
        return nil
    }
}

extension AppDelegate: MenuPanelDelegate {
    func panelModel() -> PanelModel {
        var model = PanelModel()
        model.computer = computerName
        (model.status, model.tone) = shortStatus()
        switch phase {
        case .awaitingApproval:
            model.detail = "Approve this Mac on the page that opened in your browser."
            model.actionTitle = "Open the Approval Page Again"
            model.actionCommand = .openApproval
        case .notConnected:
            model.detail = statusText().2
            model.actionTitle = "Connect…"
            model.actionCommand = .connect
        case .stopped:
            model.detail = statusText().2
            model.actionTitle = "Retry"
            model.actionCommand = .retry
        case .connected, .connecting, .reconnecting:
            model.detail = statusText().2
            model.canDisconnect = true
        case .settingUp, .working:
            model.detail = statusText().2
        }
        (model.agents, model.agentNote) = agentRows()
        if paths.isDefault {
            switch SMAppService.mainApp.status {
            case .enabled: model.loginState = .on
            case .requiresApproval:
                model.loginTitle = "Start at Login (allow in System Settings)"
                model.loginState = .mixed
            default: model.loginState = .off
            }
        } else {
            model.loginState = wantsStartAtLogin ? .on : .off
        }
        model.version = "Version \(Machine.appVersion)"
        model.updateStatus = updateStatusLine()
        if let staged = stagedApp {
            model.updateTitle = "Restart to Update (\(staged.version))"
            model.updateCommand = .restartToUpdate
        } else if let version = manualAppVersion {
            model.updateTitle = "Download Version \(version)"
            model.updateCommand = .downloadUpdate
        }
        // "Checking…" already says what the note would.
        if !manualCheckRunning { model.updateNote = updateNote }
        return model
    }

    func panelPerform(_ command: PanelCommand) {
        switch command {
        case .openTinkjam: openTinkjam()
        case .openApproval: openApprovalAgain()
        case .connect: connect()
        case .retry: retry()
        case .disconnect: disconnect()
        case .toggleLogin: toggleLoginItem()
        case .showLog: showLog()
        case .checkForUpdates: checkForUpdatesClicked()
        case .restartToUpdate: restartToUpdateClicked()
        case .downloadUpdate: downloadUpdate()
        case .quit: quit()
        }
    }

    /// The answer to a check has been read once the panel closes; it would be stale the next day.
    func panelDidClose() {
        if !manualCheckRunning { updateNote = nil }
    }
}

extension AppDelegate {
    // MARK: Setup window

    /// The phase is often set before the window shows, so fill it in as it appears.
    private func presentSetupWindow(activate: Bool) {
        setupWindow.present(activate: activate)
        updateSetupWindow()
    }

    /// The three steps of the first-run window, each from the real state: what is installed, which
    /// agents are on the login PATH, and the phase of the connection.
    private func updateSetupWindow() {
        guard setupWindow.isVisible else { return }
        let installed = NodeRuntime.isInstalled(paths) && SyncPackage.isInstalled(paths)
        let agents = AgentKind.installed(path: loginPath ?? LoginShell.fallback)
        var model = SetupModel()
        model.agents = agents
        var install = SetupModel.Step(title: "Tinkjam Sync installed", state: .done)
        var found = SetupModel.Step(title: "Find Claude and Codex", state: .waiting)
        var account = SetupModel.Step(title: "Connect to your account", state: .waiting)
        var action: (() -> Void)?

        if !installed {
            install.title = "Install Tinkjam Sync"
            install.state = .active
        } else if agents.isEmpty {
            found.title = "No Claude or Codex found"
            found.detail = "Install Claude Code or Codex on this Mac to use it from your boards."
        } else {
            found.title = "Found " + agents.map(\.name).joined(separator: " and ")
            found.state = .done
        }

        switch phase {
        case .settingUp(let step, let fraction):
            if installed {
                account.state = .active
                account.detail = step
            } else {
                install.detail = step
                model.showsProgress = true
                model.progress = fraction
            }
        case .working(let what):
            account.state = .active
            account.detail = what
        case .connecting:
            account.state = .active
            account.detail = statusText().2
        case .awaitingApproval(let url):
            account.state = .active
            model.buttonTitle = "Connect"
            action = { NSWorkspace.shared.open(url) }
        case .connected:
            model.title = "This Mac is connected"
            account.title = "Connected to your account"
            account.state = .done
            account.detail = "Tinkjam Sync runs from the menu bar."
            model.buttonTitle = "Done"
            action = { [weak self] in self?.setupWindow.close() }
        case .reconnecting(let why):
            account.state = .active
            account.detail = why
        case .notConnected(let note):
            account.state = .active
            account.detail = note
            model.buttonTitle = "Connect"
            action = { [weak self] in self?.connect() }
        case .stopped(let message):
            if installed { account.state = .failed } else { install.state = .failed }
            model.error = message
            model.buttonTitle = "Retry"
            action = { [weak self] in self?.retry() }
        }
        if !installed { install.state = install.state == .failed ? .failed : .active }
        model.steps = [install, found, account]
        setupWindow.show(model, action: action)
    }
}

extension AppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification,
                                withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        completionHandler([.banner, .sound])
    }

    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse,
                                withCompletionHandler completionHandler: @escaping () -> Void) {
        let identifier = response.notification.request.identifier
        DispatchQueue.main.async {
            self.notificationClicked(identifier)
            completionHandler()
        }
    }

    private func notificationClicked(_ identifier: String) {
        if identifier == "approve", case .awaitingApproval(let url) = phase {
            NSWorkspace.shared.open(url)
        } else if identifier != "connected" {
            presentSetupWindow(activate: true)
        }
    }
}

/// Runs `work` from the main run loop in every mode, outside any main-queue job, which is where
/// AppKit expects `terminate` and the reply to `applicationShouldTerminate`.
func onMainRunLoop(_ work: @escaping @MainActor () -> Void) {
    RunLoop.main.perform(inModes: [.common, .modalPanel, .eventTracking]) { MainActor.assumeIsolated { work() } }
    CFRunLoopWakeUp(CFRunLoopGetMain())
}
