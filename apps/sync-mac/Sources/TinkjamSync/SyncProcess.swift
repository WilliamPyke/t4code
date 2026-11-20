import Foundation

/// What one line of Sync's output means to the app. Sync's words are for people; the app keys
/// on the few that change what it shows, and on `TINKJAM_SYNC_APPROVE_URL` from `sync --app`.
enum SyncLine: Equatable {
    case approvalURL(URL)
    case approved
    case connected
    case portBusy
    case heldInBackground
    case heldElsewhere
    case other

    static func classify(_ raw: String) -> SyncLine {
        let line = raw.trimmingCharacters(in: .whitespaces)
        // Only Sync's own page on this Mac is ever opened, whatever a line of output says.
        if line.hasPrefix("TINKJAM_SYNC_APPROVE_URL "),
           let url = URL(string: String(line.dropFirst("TINKJAM_SYNC_APPROVE_URL ".count))),
           url.scheme == "http", url.host == "127.0.0.1", url.port != nil {
            return .approvalURL(url)
        }
        // Packages without `--app` print the bare link on its own indented line.
        if line.range(of: #"^http://127\.0\.0\.1:\d+/?$"#, options: .regularExpression) != nil, let url = URL(string: line) {
            return .approvalURL(url)
        }
        if line == "Approved." { return .approved }
        if line.hasPrefix("Connected.") { return .connected }
        if line.contains("EADDRINUSE") && line.contains("\(Config.approvalPort)") { return .portBusy }
        if line.contains("already running in the background") { return .heldInBackground }
        if line.contains("Tinkjam Sync is already running") { return .heldElsewhere }
        return .other
    }
}

/// `<home>/userdata/sync-status.json`, which Sync rewrites while it waits to be reachable and,
/// in newer packages, every 30 seconds after that. `checkedAt` is the ISO time of that check.
struct SyncStatus: Decodable {
    let pid: Int32?
    let status: String
    let reason: String?
    let cause: String?
    let checkedAt: String?

    static func read(_ paths: Paths) -> SyncStatus? {
        guard let data = try? Data(contentsOf: paths.status) else { return nil }
        return try? JSONDecoder().decode(SyncStatus.self, from: data)
    }
}

/// The one Sync this app runs: `node …/dist/bin.mjs sync --base-dir <home> [--app]`. Its stdin is
/// a pipe this app holds; with `--app`, Sync exits when it closes, so even a crash of the app
/// leaves no Sync behind.
final class SyncChild {
    let process = Process()
    private let stdin = Pipe()
    private let output = Pipe()
    private var buffer = Data()
    private(set) var stopping = false
    /// Sync's descendants (cloudflared) by pid and executable, refreshed while it runs, so a
    /// crash of Sync itself does not leave its tunnel helper running on its own.
    private var descendants: [pid_t: String] = [:]
    private var watcher: DispatchSourceTimer?
    private let watchQueue = DispatchQueue(label: "org.trellium.tinkjam-sync-app.watch")

    init(paths: Paths, appMode: Bool, path: String) {
        process.executableURL = paths.node
        process.arguments = [Paths.serverEntry(in: paths.app).path, "sync", "--base-dir", paths.base.path]
            + (appMode ? ["--app"] : [])
        var environment = ProcessInfo.processInfo.environment
        // The person's agents first, then this app's Node for anything that only needs a node.
        environment["PATH"] = path + ":" + paths.nodeHome.appendingPathComponent("bin").path
        environment["T3CODE_HOME"] = paths.base.path
        environment["T3CODE_HOSTED_APP_URL"] = Config.hostedAppURL.absoluteString
        environment["TINKJAM_SYNC_URL"] = Config.syncPackageURL.absoluteString
        environment["TINKJAM_SYNC_APP"] = Machine.appVersion
        process.environment = environment
        process.currentDirectoryURL = paths.base
        process.standardInput = stdin
        process.standardOutput = output
        process.standardError = output
    }

    var pid: pid_t { process.processIdentifier }

    /// Something besides its tunnel helper runs under Sync: an agent session, which Sync ends 30
    /// minutes after that agent's last turn.
    var agentsRunning: Bool {
        watchQueue.sync {
            recordDescendants()
            return descendants.values.contains { !$0.hasSuffix("/cloudflared") }
        }
    }

    /// The executables of what runs under Sync besides its tunnel helper, for naming the agent.
    var agentExecutables: [String] {
        watchQueue.sync {
            recordDescendants()
            return descendants.values.filter { !$0.hasSuffix("/cloudflared") }
        }
    }

    /// Lines arrive on a background queue; exit on the main queue.
    /// `onExit` gets a description such as "exit code 1" or "signal 9".
    func start(onLine: @escaping (String) -> Void, onExit: @escaping (Int32, String) -> Void) throws {
        output.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard let self else { return }
            if data.isEmpty {
                handle.readabilityHandler = nil
                if !self.buffer.isEmpty { onLine(String(decoding: self.buffer, as: UTF8.self)) }
                self.buffer.removeAll()
                return
            }
            self.buffer.append(data)
            while let newline = self.buffer.firstIndex(of: 0x0A) {
                let line = self.buffer[self.buffer.startIndex..<newline]
                self.buffer.removeSubrange(self.buffer.startIndex...newline)
                onLine(String(decoding: line, as: UTF8.self).trimmingCharacters(in: CharacterSet(charactersIn: "\r")))
            }
        }
        process.terminationHandler = { [weak self] process in
            let status = process.terminationStatus
            let how = process.terminationReason == .uncaughtSignal ? "signal \(status)" : "exit code \(status)"
            guard let self else { return DispatchQueue.main.async { onExit(status, how) } }
            self.watchQueue.async {
                self.watcher?.cancel()
                if !self.stopping { self.endLeftovers() }
                DispatchQueue.main.async { onExit(status, how) }
            }
        }
        try process.run()
        let timer = DispatchSource.makeTimerSource(queue: watchQueue)
        timer.schedule(deadline: .now() + 1, repeating: 5)
        timer.setEventHandler { [weak self] in self?.recordDescendants() }
        timer.resume()
        watcher = timer
    }

    private func recordDescendants() {
        guard ProcessTree.isAlive(pid) else { return }
        var found: [pid_t: String] = [:]
        for pid in ProcessTree.descendants(of: pid) {
            if let path = ProcessTree.executable(of: pid) { found[pid] = path }
        }
        descendants = found
    }

    /// Ends what Sync had started if it is still the same program, now orphaned.
    private func endLeftovers() {
        for (pid, path) in descendants where ProcessTree.isAlive(pid) && ProcessTree.parent(of: pid) == 1
            && ProcessTree.executable(of: pid) == path {
            kill(pid, SIGTERM)
        }
        descendants = [:]
    }

    /// SIGTERM lets Sync close its tunnel helper itself; whatever is left after `grace` is killed.
    func stop(grace: TimeInterval = 10) async {
        stopping = true
        watcher?.cancel()
        guard process.isRunning else { return }
        let root = pid
        let tree = ProcessTree.descendants(of: root)
        kill(root, SIGTERM)
        let deadline = Date().addingTimeInterval(grace)
        while process.isRunning && Date() < deadline {
            try? await Task.sleep(nanoseconds: 200_000_000)
        }
        if process.isRunning { kill(root, SIGKILL) }
        // Only the pids that were this Sync's descendants when it was asked to stop.
        for pid in tree where ProcessTree.isAlive(pid) { kill(pid, SIGKILL) }
        try? stdin.fileHandleForWriting.close()
    }
}

/// `<home>/sync-app-child.json`: the pid of the Sync this app started. If the app was killed
/// (crash, force quit) and its Sync lived on, the next launch ends that Sync, and only when it is
/// still this app's Node and has been orphaned (its parent is launchd).
enum ChildRecord {
    private static func file(_ paths: Paths) -> URL { paths.base.appendingPathComponent("sync-app-child.json") }

    static func write(_ pid: pid_t, paths: Paths) {
        try? JSONSerialization.data(withJSONObject: ["pid": Int(pid)]).write(to: file(paths))
    }

    static func clear(_ paths: Paths) { try? FileManager.default.removeItem(at: file(paths)) }

    static func endOrphan(_ paths: Paths) async -> String? {
        defer { clear(paths) }
        guard let data = try? Data(contentsOf: file(paths)),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let number = json["pid"] as? Int else { return nil }
        let pid = pid_t(number)
        guard ProcessTree.isAlive(pid), ProcessTree.parent(of: pid) == 1,
              ProcessTree.executable(of: pid) == paths.node.resolvingSymlinksInPath().path else { return nil }
        let tree = ProcessTree.descendants(of: pid)
        kill(pid, SIGTERM)
        for _ in 0..<50 where ProcessTree.isAlive(pid) { try? await Task.sleep(nanoseconds: 200_000_000) }
        if ProcessTree.isAlive(pid) { kill(pid, SIGKILL) }
        for child in tree where ProcessTree.isAlive(child) { kill(child, SIGKILL) }
        return "pid \(pid) and \(tree.count) process(es) it started"
    }
}
