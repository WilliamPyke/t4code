import Foundation

/// The app's private Node.js, under `<home>/runtime`. Nothing on the Mac is assumed.
enum NodeRuntime {
    private static var marker: String { "\(Config.nodeVersion)-darwin-\(Machine.nodeArch)" }
    private static func markerFile(_ paths: Paths) -> URL { paths.runtime.appendingPathComponent("installed") }

    static func isInstalled(_ paths: Paths) -> Bool {
        FileManager.default.isExecutableFile(atPath: paths.node.path)
            && (try? String(contentsOf: markerFile(paths), encoding: .utf8)) == marker
    }

    static func install(_ paths: Paths, log: LogFile, progress: @escaping (Double?) -> Void) async throws {
        let fm = FileManager.default
        let name = "node-\(Config.nodeVersion)-darwin-\(Machine.nodeArch)"
        let url = URL(string: "https://nodejs.org/dist/\(Config.nodeVersion)/\(name).tar.xz")!
        let downloads = paths.runtime.appendingPathComponent("downloads")
        let tarball = downloads.appendingPathComponent("\(name).tar.xz")
        let unpack = paths.runtime.appendingPathComponent(".unpack")
        defer {
            try? fm.removeItem(at: downloads)
            try? fm.removeItem(at: unpack)
        }
        log.app("Downloading Node.js \(Config.nodeVersion) (\(Machine.nodeArch)) from \(url.absoluteString)")
        do {
            try await FileDownload.fetch(url, to: tarball, progress: progress)
        } catch {
            throw SetupError.from(error, doing: "downloading Node.js")
        }
        progress(nil)
        let actual = try sha256(of: tarball)
        guard actual == Config.nodeSHA256[Machine.nodeArch] else {
            log.app("Node.js checksum mismatch: expected \(Config.nodeSHA256[Machine.nodeArch] ?? "?"), got \(actual)")
            throw SetupError(Plain.damaged, detail: "Node.js checksum mismatch")
        }
        try? fm.removeItem(at: unpack)
        try fm.createDirectory(at: unpack, withIntermediateDirectories: true)
        let untar = await run(URL(fileURLWithPath: "/usr/bin/tar"), ["-xJf", tarball.path, "-C", unpack.path])
        guard untar.succeeded else {
            log.app("tar failed: \(untar.tail())")
            throw SetupError(untar.output.contains("No space left") ? Plain.diskFull : Plain.setupFailed,
                             detail: "could not unpack Node.js: \(untar.tail(1))")
        }
        try? fm.removeItem(at: paths.nodeHome)
        try fm.moveItem(at: unpack.appendingPathComponent(name), to: paths.nodeHome)
        let check = await run(paths.node, ["--version"], timeout: 30)
        guard check.succeeded, check.output.trimmingCharacters(in: .whitespacesAndNewlines) == Config.nodeVersion else {
            throw SetupError(Plain.setupFailed, detail: "Node.js was unpacked but does not run: \(check.tail(1))")
        }
        // Older runtimes this app kept go once the new one works.
        for item in (try? fm.contentsOfDirectory(atPath: paths.runtime.path)) ?? []
        where item.hasPrefix("node-") && item != name {
            try? fm.removeItem(at: paths.runtime.appendingPathComponent(item))
        }
        try marker.write(to: markerFile(paths), atomically: true, encoding: .utf8)
        log.app("Node.js \(Config.nodeVersion) is ready at \(paths.nodeHome.path)")
    }
}

/// sync.json, published beside sync.tgz. A release without `sha256`, or not signed with the
/// release key, is never installed.
struct SyncRelease: Decodable {
    let version: String
    let url: String
    let sha256: String?
    let build: String?
    let minimumSystemVersion: String?
    let keyId: String?
    let signature: String?

    var isSigned: Bool {
        ReleaseSignature.isValid(kind: "sync", version: version, build: build, url: url, sha256: sha256,
                                 minimumSystemVersion: minimumSystemVersion, keyId: keyId, signature: signature)
    }
}

/// The published Tinkjam Sync package, unpacked as `<home>/app/node_modules/tinkjam-sync` (the
/// launcher's `--install` layout) with exactly its npm-shrinkwrap.json installed by the private Node's npm.
enum SyncPackage {
    static func isInstalled(_ paths: Paths) -> Bool {
        FileManager.default.fileExists(atPath: Paths.serverEntry(in: paths.app).path)
    }

    /// The version baked into the installed launcher, e.g. `0.1.7+202611171847`.
    static func installedVersion(in root: URL) -> String? {
        guard let text = try? String(contentsOf: Paths.launcher(in: root), encoding: .utf8),
              let range = text.range(of: #"const SYNC_VERSION = "([^"]+)""#, options: .regularExpression)
        else { return nil }
        return String(text[range]).components(separatedBy: "\"").dropFirst().first
    }

    /// Whether this copy has `sync --app` (packages built after the Mac app was added).
    static func supportsAppMode(in root: URL) -> Bool {
        guard let data = try? Data(contentsOf: Paths.package(in: root).appendingPathComponent("package.json")),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let sync = json["tinkjamSync"] as? [String: Any],
              let features = sync["features"] as? [String]
        else { return false }
        return features.contains("app")
    }

    /// `0.1.7+202611171847`: the semver first, then the build time.
    static func isNewer(_ candidate: String, than installed: String?) -> Bool {
        guard let installed else { return true }
        func parts(_ version: String) -> ([Int], String) {
            let pieces = version.split(separator: "+", maxSplits: 1).map(String.init)
            let numbers = (pieces.first ?? "").split(separator: ".").map { Int($0.prefix { $0.isNumber }) ?? 0 }
            return (numbers, pieces.count > 1 ? pieces[1] : "")
        }
        let (a, aBuild) = parts(candidate)
        let (b, bBuild) = parts(installed)
        for index in 0..<max(a.count, b.count) {
            let x = index < a.count ? a[index] : 0
            let y = index < b.count ? b[index] : 0
            if x != y { return x > y }
        }
        return aBuild.count != bBuild.count ? aBuild.count > bBuild.count : aBuild > bBuild
    }

    static func latestRelease() async throws -> SyncRelease {
        do { return try await fetchJSON(SyncRelease.self, from: Config.syncManifestURL) } catch {
            throw SetupError.from(error, doing: "checking for Tinkjam Sync")
        }
    }

    /// Downloads and installs a release into `<home>/app-staging`, leaving the running copy alone.
    static func stage(_ release: SyncRelease, paths: Paths, log: LogFile,
                      progress: @escaping (String, Double?) -> Void) async throws -> URL {
        let fm = FileManager.default
        guard let expected = release.sha256?.lowercased(), !expected.isEmpty else {
            throw SetupError(Plain.serverTrouble, detail: "sync.json names no sha256 for \(release.version); not installed")
        }
        guard release.isSigned else {
            throw SetupError(Plain.serverTrouble,
                             detail: "sync.json for \(release.version) is not signed with Tinkjam's release key; not installed")
        }
        let staging = paths.staging
        let downloads = paths.runtime.appendingPathComponent("downloads")
        let tarball = downloads.appendingPathComponent("sync.tgz")
        let npmCache = paths.runtime.appendingPathComponent("npm-cache")
        defer {
            try? fm.removeItem(at: downloads)
            // npm's cache would double what Sync takes on disk for nothing after the install.
            try? fm.removeItem(at: npmCache)
        }
        try? fm.removeItem(at: staging)
        try fm.createDirectory(at: staging, withIntermediateDirectories: true)
        // A pinned version in the URL, as the launcher's update notice does, so no cache serves an older one.
        // sync.json names the tarball; plain http only for a local test server.
        let published = URL(string: release.url).flatMap { $0.scheme == "https" || $0.host == "127.0.0.1" ? $0 : nil }
            ?? Config.syncPackageURL
        var components = URLComponents(url: published, resolvingAgainstBaseURL: false)!
        components.queryItems = [URLQueryItem(name: "v", value: release.version)]
        log.app("Downloading Tinkjam Sync \(release.version)")
        do {
            try await FileDownload.fetch(components.url!, to: tarball) { progress("Downloading Tinkjam Sync…", $0) }
        } catch {
            try? fm.removeItem(at: staging)
            throw SetupError.from(error, doing: "downloading Tinkjam Sync")
        }
        let actual = try sha256(of: tarball)
        guard actual == expected else {
            log.app("Tinkjam Sync checksum mismatch: expected \(expected), got \(actual)")
            try? fm.removeItem(at: staging)
            throw SetupError(Plain.damaged, detail: "Tinkjam Sync checksum mismatch")
        }
        progress("Installing Tinkjam Sync…", nil)
        let environment = [
            "PATH": "\(paths.nodeHome.appendingPathComponent("bin").path):/usr/bin:/bin:/usr/sbin:/sbin",
            "HOME": NSHomeDirectory(),
            "npm_config_cache": npmCache.path,
            "npm_config_update_notifier": "false",
            "npm_config_fund": "false",
            "npm_config_audit": "false",
        ]
        let packageDir = Paths.package(in: staging)
        if let problem = await unpack(tarball, into: packageDir) {
            try? fm.removeItem(at: staging)
            throw SetupError(Plain.setupFailed, detail: problem)
        }
        var install = await run(paths.node, NpmCommands.ci(paths.npmCLI.path, packageDir.path, npmCache.path),
                                environment: environment, currentDirectory: packageDir, timeout: 900)
        if install.succeeded {
            install = await run(paths.node, NpmCommands.rebuild(paths.npmCLI.path, packageDir.path, npmCache.path),
                                environment: environment, currentDirectory: packageDir, timeout: 300)
        }
        if !install.output.isEmpty { log.app("npm: \(install.tail(20))") }
        guard install.succeeded, fm.fileExists(atPath: Paths.serverEntry(in: staging).path) else {
            try? fm.removeItem(at: staging)
            let offline = install.output.contains("ENOTFOUND") || install.output.contains("EAI_AGAIN")
                || install.output.contains("ECONNREFUSED") || install.output.contains("ETIMEDOUT")
            let detail = "npm ci ended with \(install.status)"
            if install.output.contains("ENOSPC") { throw SetupError(Plain.diskFull, detail: detail) }
            throw offline
                ? SetupError(Plain.offline, offline: true, detail: detail)
                : SetupError(Plain.setupFailed, detail: detail)
        }
        return staging
    }

    /// macOS's tar unpacks npm's `package/` folder as `target`, after the listing shows only plain
    /// files and folders inside it. It refuses `..` and absolute paths too. Returns what went wrong.
    private static func unpack(_ tarball: URL, into target: URL) async -> String? {
        let tar = URL(fileURLWithPath: "/usr/bin/tar")
        let names = await run(tar, ["-tzf", tarball.path], timeout: 120)
        let longListing = await run(tar, ["-tvzf", tarball.path], timeout: 120)
        let lines = { (result: RunResult) in result.output.split(whereSeparator: \.isNewline).map(String.init) }
        guard names.succeeded, longListing.succeeded,
              PackageArchive.safeListing(names: lines(names), longListing: lines(longListing))
        else { return "sync.tgz holds something besides the package's own files and folders" }
        do { try FileManager.default.createDirectory(at: target, withIntermediateDirectories: true) } catch {
            return "could not make \(target.path): \(error.localizedDescription)"
        }
        let untar = await run(tar, ["-xzf", tarball.path, "-C", target.path, "--strip-components", "1"], timeout: 300)
        guard untar.succeeded else { return "could not unpack sync.tgz: \(untar.tail(1))" }
        let entries = FileManager.default.enumerator(at: target, includingPropertiesForKeys: [.isSymbolicLinkKey])
        while let entry = entries?.nextObject() as? URL {
            if (try? entry.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink) == true {
                return "sync.tgz unpacked a link (\(entry.path))"
            }
        }
        return nil
    }

    /// A staged copy of what is installed now (APFS clones it, so it costs no space).
    static func stageCopyOfInstalled(_ paths: Paths) throws -> URL {
        try? FileManager.default.removeItem(at: paths.staging)
        try FileManager.default.copyItem(at: paths.app, to: paths.staging)
        return paths.staging
    }

    /// Makes the staged copy the installed one. Sync must not be running from `app` now.
    /// The copy it replaces is set aside first and put back if the swap fails.
    static func activate(_ staging: URL, paths: Paths) throws {
        let fm = FileManager.default
        let previous = paths.base.appendingPathComponent("app-previous")
        try? fm.removeItem(at: previous)
        let hadApp = fm.fileExists(atPath: paths.app.path)
        if hadApp { try fm.moveItem(at: paths.app, to: previous) }
        do {
            try fm.moveItem(at: staging, to: paths.app)
        } catch {
            if hadApp { try? fm.moveItem(at: previous, to: paths.app) }
            throw error
        }
        DispatchQueue.global(qos: .utility).async { try? FileManager.default.removeItem(at: previous) }
    }
}

/// The npx-installed Sync: its LaunchAgent and any Sync it, a terminal or an agent left running.
enum Legacy {
    private static var launchAgents: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/LaunchAgents")
    }

    /// LaunchAgents the package's own `--uninstall` would remove for this home: its own label, and
    /// leftovers that run Tinkjam Sync under another name (the package's `classifyLoginItem`).
    static func loginItems(_ paths: Paths) -> [URL] {
        let ownLabel = paths.isDefault ? Config.legacyLaunchdLabel : nil
        let files = (try? FileManager.default.contentsOfDirectory(at: launchAgents, includingPropertiesForKeys: nil)) ?? []
        return files.filter { file in
            guard file.pathExtension == "plist" else { return false }
            let name = file.deletingPathExtension().lastPathComponent
            if let ownLabel, name == ownLabel { return true }
            if name.lowercased().hasPrefix("org.trellium.tinkjam-sync") { return false } // another home's
            guard let text = try? String(contentsOf: file, encoding: .utf8).lowercased() else { return false }
            return text.contains("trellium.org/sync.tgz") || text.contains("tinkjam-sync")
                || text.contains(paths.base.path.lowercased())
        }
    }

    /// Whether launchd still has the old job loaded, even with its plist gone.
    static func jobLoaded(_ paths: Paths) -> Bool {
        guard paths.isDefault else { return false }
        return runBlocking(URL(fileURLWithPath: "/bin/launchctl"),
                           ["print", "gui/\(getuid())/\(Config.legacyLaunchdLabel)"], timeout: 10).succeeded
    }

    static func bootOutJob() {
        _ = runBlocking(URL(fileURLWithPath: "/bin/launchctl"),
                        ["bootout", "gui/\(getuid())/\(Config.legacyLaunchdLabel)"], timeout: 30)
    }
}
