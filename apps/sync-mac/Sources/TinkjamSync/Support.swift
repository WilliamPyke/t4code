import CryptoKit
import Foundation

/// A failure worded for the person, shown in the menu and the setup window.
struct SetupError: LocalizedError {
    let message: String
    /// Set for network failures, so the app tries again sooner and when the Mac is back online.
    var offline = false
    /// The technical cause, for the log only.
    var detail: String?
    init(_ message: String, offline: Bool = false, detail: String? = nil) {
        self.message = message
        self.offline = offline
        self.detail = detail
    }
    var errorDescription: String? { message }
    var logLine: String {
        if let detail { return "\(message) [\(detail)]" }
        return message
    }

    static func from(_ error: Error, doing what: String) -> SetupError {
        if let setup = error as? SetupError { return setup }
        let ns = error as NSError
        let raw = "\(what): \(ns.domain) \(ns.code) \(error.localizedDescription)"
        if isOutOfSpace(ns) { return SetupError(Plain.diskFull, detail: raw) }
        if let url = error as? URLError {
            switch url.code {
            case .notConnectedToInternet, .networkConnectionLost, .dataNotAllowed, .internationalRoamingOff:
                return SetupError(Plain.offline, offline: true, detail: raw)
            case .secureConnectionFailed, .serverCertificateUntrusted, .serverCertificateHasBadDate,
                 .serverCertificateNotYetValid, .serverCertificateHasUnknownRoot:
                return SetupError(Plain.networkSignIn, offline: true, detail: raw)
            default:
                return SetupError(Plain.unreachable, offline: true, detail: raw)
            }
        }
        return SetupError(Plain.setupFailed, detail: raw)
    }

    private static func isOutOfSpace(_ error: NSError) -> Bool {
        if error.domain == NSCocoaErrorDomain && error.code == NSFileWriteOutOfSpaceError { return true }
        if error.domain == NSPOSIXErrorDomain && error.code == Int(ENOSPC) { return true }
        if let underlying = error.userInfo[NSUnderlyingErrorKey] as? NSError { return isOutOfSpace(underlying) }
        return false
    }
}

struct RunResult {
    let status: Int32
    let output: String
    var succeeded: Bool { status == 0 }
    /// The last lines, for the log and for a failure message.
    func tail(_ lines: Int = 6) -> String {
        output.split(whereSeparator: \.isNewline).suffix(lines).joined(separator: "\n")
    }
}

/// Runs a program to the end off the main thread, collecting stdout and stderr together.
func run(_ executable: URL, _ arguments: [String], environment: [String: String]? = nil,
         currentDirectory: URL? = nil, timeout: TimeInterval = 600) async -> RunResult {
    await withCheckedContinuation { continuation in
        DispatchQueue.global(qos: .userInitiated).async {
            continuation.resume(returning: runBlocking(executable, arguments, environment: environment,
                                                       currentDirectory: currentDirectory, timeout: timeout))
        }
    }
}

func runBlocking(_ executable: URL, _ arguments: [String], environment: [String: String]? = nil,
                 currentDirectory: URL? = nil, timeout: TimeInterval = 600) -> RunResult {
    let process = Process()
    process.executableURL = executable
    process.arguments = arguments
    if let environment { process.environment = environment }
    if let currentDirectory { process.currentDirectoryURL = currentDirectory }
    let pipe = Pipe()
    process.standardOutput = pipe
    process.standardError = pipe
    process.standardInput = FileHandle.nullDevice
    let collected = OutputBox()
    let exited = DispatchSemaphore(value: 0)
    let drained = DispatchSemaphore(value: 0)
    let reader = pipe.fileHandleForReading
    reader.readabilityHandler = { handle in
        let data = handle.availableData
        if data.isEmpty {
            handle.readabilityHandler = nil
            drained.signal()
        } else {
            collected.append(data)
        }
    }
    process.terminationHandler = { _ in exited.signal() }
    do { try process.run() } catch {
        reader.readabilityHandler = nil
        return RunResult(status: -1, output: "Could not start \(executable.lastPathComponent): \(error.localizedDescription)")
    }
    var timedOut = false
    if exited.wait(timeout: .now() + timeout) == .timedOut {
        timedOut = true
        process.terminate()
        // An interactive shell may ignore SIGTERM.
        if exited.wait(timeout: .now() + 3) == .timedOut {
            kill(process.processIdentifier, SIGKILL)
            _ = exited.wait(timeout: .now() + 3)
        }
    }
    // Something the program started may hold the pipe open for good, so its end is not waited for.
    if drained.wait(timeout: .now() + 2) == .timedOut { reader.readabilityHandler = nil }
    let output = String(decoding: collected.value, as: UTF8.self)
    if timedOut || process.isRunning { return RunResult(status: -2, output: output) }
    return RunResult(status: process.terminationStatus, output: output)
}

private final class OutputBox {
    private let lock = NSLock()
    private var data = Data()

    func append(_ more: Data) {
        lock.lock()
        data.append(more)
        lock.unlock()
    }

    var value: Data {
        lock.lock()
        defer { lock.unlock() }
        return data
    }
}

/// Downloads to a file with progress; fails on any HTTP status other than 2xx.
final class FileDownload: NSObject, URLSessionDownloadDelegate {
    private let destination: URL
    private let progress: (Double?) -> Void
    private var continuation: CheckedContinuation<Void, Error>?
    private var moveError: Error?

    private init(destination: URL, progress: @escaping (Double?) -> Void) {
        self.destination = destination
        self.progress = progress
    }

    static func fetch(_ url: URL, to destination: URL, progress: @escaping (Double?) -> Void = { _ in }) async throws {
        let download = FileDownload(destination: destination, progress: progress)
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 60
        configuration.waitsForConnectivity = false
        let session = URLSession(configuration: configuration, delegate: download, delegateQueue: nil)
        defer { session.finishTasksAndInvalidate() }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            download.continuation = continuation
            session.downloadTask(with: url).resume()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask,
                    didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        progress(totalBytesExpectedToWrite > 0 ? Double(totalBytesWritten) / Double(totalBytesExpectedToWrite) : nil)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        if let http = downloadTask.response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
            moveError = SetupError(Plain.serverTrouble, offline: true,
                                   detail: "the server answered \(http.statusCode) for \(downloadTask.originalRequest?.url?.absoluteString ?? "a download")")
            return
        }
        do {
            try FileManager.default.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            try? FileManager.default.removeItem(at: destination)
            try FileManager.default.moveItem(at: location, to: destination)
        } catch {
            moveError = error
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error ?? moveError { continuation?.resume(throwing: error) } else { continuation?.resume() }
        continuation = nil
    }
}

/// Small JSON documents (sync.json, mac.json), never cached.
func fetchJSON<T: Decodable>(_ type: T.Type, from url: URL) async throws -> T {
    var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalAndRemoteCacheData, timeoutInterval: 20)
    request.setValue("Tinkjam Sync for Mac/\(Machine.appVersion)", forHTTPHeaderField: "User-Agent")
    let (data, response) = try await URLSession.shared.data(for: request)
    if let http = response as? HTTPURLResponse, !(200..<300).contains(http.statusCode) {
        throw SetupError(Plain.serverTrouble, offline: true,
                         detail: "the server answered \(http.statusCode) for \(url.absoluteString)")
    }
    return try JSONDecoder().decode(T.self, from: data)
}

/// The first of `urls` that answers; the last one's failure when none does.
func fetchJSON<T: Decodable>(_ type: T.Type, fromFirstOf urls: [URL]) async throws -> T {
    var failure: Error = SetupError(Plain.serverTrouble, offline: true, detail: "no address to ask")
    for url in urls {
        do { return try await fetchJSON(type, from: url) } catch { failure = error }
    }
    throw failure
}

func sha256(of file: URL) throws -> String {
    let handle = try FileHandle(forReadingFrom: file)
    defer { try? handle.close() }
    var hasher = SHA256()
    while let chunk = try handle.read(upToCount: 1 << 20), !chunk.isEmpty { hasher.update(data: chunk) }
    return hasher.finalize().map { String(format: "%02x", $0) }.joined()
}

/// `<home>/logs/sync.log`: Sync's own lines and the app's, with the time, rotated at 5 MB like
/// the background Sync's log.
final class LogFile {
    let url: URL
    private let queue = DispatchQueue(label: "org.trellium.tinkjam-sync-app.log")
    private let formatter = ISO8601DateFormatter()

    init(url: URL) {
        self.url = url
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    }

    func write(_ line: String) {
        let stamped = "[\(formatter.string(from: Date()))] \(line)\n"
        queue.async { [url] in
            let fm = FileManager.default
            try? fm.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if let size = (try? fm.attributesOfItem(atPath: url.path))?[.size] as? Int, size > 5 * 1024 * 1024 {
                let old = url.appendingPathExtension("1")
                try? fm.removeItem(at: old)
                try? fm.moveItem(at: url, to: old)
            }
            if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
            guard let handle = try? FileHandle(forWritingTo: url) else { return }
            defer { try? handle.close() }
            _ = try? handle.seekToEnd()
            try? handle.write(contentsOf: Data(stamped.utf8))
        }
    }

    func app(_ line: String) { write("app: \(line)") }
}

/// Starts `/bin/sh -c script args…` in a session of its own, so it outlives this app whether
/// Finder or a login item started it; what it prints goes to `output`.
func spawnDetachedScript(_ script: String, _ arguments: [String], output: URL) throws {
    var attributes: posix_spawnattr_t? = nil
    posix_spawnattr_init(&attributes)
    defer { posix_spawnattr_destroy(&attributes) }
    posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_SETSID | POSIX_SPAWN_CLOEXEC_DEFAULT))
    var actions: posix_spawn_file_actions_t? = nil
    posix_spawn_file_actions_init(&actions)
    defer { posix_spawn_file_actions_destroy(&actions) }
    posix_spawn_file_actions_addopen(&actions, 0, "/dev/null", O_RDONLY, 0)
    posix_spawn_file_actions_addopen(&actions, 1, output.path, O_WRONLY | O_CREAT | O_APPEND, 0o644)
    posix_spawn_file_actions_adddup2(&actions, 1, 2)
    let argv: [UnsafeMutablePointer<CChar>?] = (["/bin/sh", "-c", script] + arguments).map { strdup($0) } + [nil]
    defer { argv.forEach { free($0) } }
    var pid: pid_t = 0
    let status = posix_spawn(&pid, "/bin/sh", &actions, &attributes, argv, environ)
    guard status == 0 else {
        throw SetupError(Plain.setupFailed, detail: "posix_spawn /bin/sh: \(String(cString: strerror(status)))")
    }
}

/// Process table via sysctl, for ending Sync's whole tree (Sync itself and its cloudflared).
enum ProcessTree {
    static func descendants(of root: pid_t) -> [pid_t] {
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0]
        var size = 0
        guard sysctl(&mib, 4, nil, &size, nil, 0) == 0 else { return [] }
        let stride = MemoryLayout<kinfo_proc>.stride
        var procs = [kinfo_proc](repeating: kinfo_proc(), count: size / stride + 32)
        size = procs.count * stride
        guard sysctl(&mib, 4, &procs, &size, nil, 0) == 0 else { return [] }
        let rows = procs.prefix(size / stride).map { ($0.kp_proc.p_pid, $0.kp_eproc.e_ppid) }
        var result: [pid_t] = []
        var queue = [root]
        while let next = queue.first {
            queue.removeFirst()
            for (pid, ppid) in rows where ppid == next && pid != next && !result.contains(pid) {
                result.append(pid)
                queue.append(pid)
            }
        }
        return result
    }

    static func isAlive(_ pid: pid_t) -> Bool { kill(pid, 0) == 0 || errno == EPERM }

    static func parent(of pid: pid_t) -> pid_t? {
        var info = kinfo_proc()
        var size = MemoryLayout<kinfo_proc>.stride
        var mib: [Int32] = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid]
        guard sysctl(&mib, 4, &info, &size, nil, 0) == 0, size > 0 else { return nil }
        return info.kp_eproc.e_ppid
    }

    static func executable(of pid: pid_t) -> String? {
        var buffer = [CChar](repeating: 0, count: 4096)
        guard proc_pidpath(pid, &buffer, UInt32(buffer.count)) > 0 else { return nil }
        return URL(fileURLWithPath: String(cString: buffer)).resolvingSymlinksInPath().path
    }
}

/// The PATH a Terminal window would have. Sync starts the person's agents (claude, codex) by
/// name, and an app opened from Finder or at log-in gets only /usr/bin:/bin:/usr/sbin:/sbin.
enum LoginShell {
    static func path() -> String {
        let fallback = ["/opt/homebrew/bin", "/usr/local/bin", "\(NSHomeDirectory())/.local/bin",
                        "/usr/bin", "/bin", "/usr/sbin", "/sbin"].joined(separator: ":")
        let shell = ProcessInfo.processInfo.environment["SHELL"].flatMap { $0.isEmpty ? nil : $0 } ?? "/bin/zsh"
        let marker = "__TINKJAM_PATH__"
        let result = runBlocking(URL(fileURLWithPath: shell),
                                 ["-ilc", "printf '\(marker)%s\(marker)' \"$PATH\""], timeout: 8)
        let parts = result.output.components(separatedBy: marker)
        guard parts.count >= 3, !parts[1].isEmpty else { return fallback }
        var seen = Set<String>()
        return (parts[1].split(separator: ":").map(String.init) + fallback.split(separator: ":").map(String.init))
            .filter { !$0.isEmpty && seen.insert($0).inserted }
            .joined(separator: ":")
    }
}
