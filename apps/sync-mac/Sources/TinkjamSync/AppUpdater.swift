import Foundation

/// `https://tinkjam.com/downloads/mac.json` (else the same file on trellium.org), published with each build by `scripts/build.sh`:
///
///     { "version": "1.0.1", "url": "https://trellium.org/downloads/Tinkjam-Sync-mac.zip",
///       "sha256": "<hex of the zip>", "minimumSystemVersion": "13.0" }
struct AppRelease: Decodable {
    let version: String
    let build: String?
    let url: String
    let sha256: String
    let minimumSystemVersion: String?
    /// Tinkjam's release key over the fields above (`scripts/sign-release.ts`); unsigned is refused.
    let keyId: String?
    let signature: String?

    var isSigned: Bool {
        ReleaseSignature.isValid(kind: "mac", version: version, build: build, url: url, sha256: sha256,
                                 minimumSystemVersion: minimumSystemVersion, keyId: keyId, signature: signature)
    }
}

/// The app updates itself: download the zip, check its SHA-256 and signature, unpack it beside
/// the caches, and swap bundles when no agent is running or the person chooses "Restart to Update".
enum AppUpdater {
    struct Staged {
        let version: String
        let build: String
        let bundle: URL
        /// Matches `Machine.appIdentity` of the copy it becomes.
        var identity: String { "\(version) (\(build))" }
    }

    enum Outcome {
        case upToDate
        case staged(Staged)
        /// A newer build exists but this copy cannot replace itself (for example, a folder it
        /// cannot write to): the menu offers the download instead.
        case manual(String)
    }

    static func isNewer(_ candidate: String, than current: String) -> Bool {
        candidate.compare(current, options: .numeric) == .orderedDescending
    }

    private static func isNewerThanRunning(version: String, build: String) -> Bool {
        isNewer(version, than: Machine.appVersion)
            || (version == Machine.appVersion && isNewer(build, than: Machine.appBuild))
    }

    private static var workDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Config.bundleIdentifier).appendingPathComponent("update")
    }

    /// Names the version whose checked bundle waits in `workDir`, so a later launch can use it.
    private static var recordFile: URL { workDir.appendingPathComponent("staged.json") }

    private static var canReplaceInstalled: Bool {
        let installed = Bundle.main.bundleURL
        return FileManager.default.isWritableFile(atPath: installed.deletingLastPathComponent().path)
            && FileManager.default.isWritableFile(atPath: installed.path)
    }

    private static func info(of bundle: URL) -> (identifier: String, version: String, build: String)? {
        guard let plist = NSDictionary(contentsOf: bundle.appendingPathComponent("Contents/Info.plist")),
              let identifier = plist["CFBundleIdentifier"] as? String,
              let version = plist["CFBundleShortVersionString"] as? String,
              let build = plist["CFBundleVersion"] as? String
        else { return nil }
        return (identifier, version, build)
    }

    /// A broken or altered bundle fails this; a Developer ID build must also come from our team.
    private static func signatureProblem(of bundle: URL) -> String? {
        let verify = runBlocking(URL(fileURLWithPath: "/usr/bin/codesign"),
                                 ["--verify", "--deep", "--strict", bundle.path], timeout: 120)
        guard verify.succeeded else { return "codesign --verify failed: \(verify.tail())" }
        if let ours = teamIdentifier(Bundle.main.bundleURL), teamIdentifier(bundle) != ours {
            return "signed by another team"
        }
        return nil
    }

    /// The bundle an earlier check downloaded and verified, if it is still intact and still newer
    /// than this copy. Anything else found there is removed.
    static func stagedOnDisk(log: LogFile) -> Staged? {
        guard let data = try? Data(contentsOf: recordFile) else { return nil }
        guard canReplaceInstalled,
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: String],
              let version = json["version"]
        else {
            try? FileManager.default.removeItem(at: workDir)
            return nil
        }
        let bundle = workDir.appendingPathComponent(version)
            .appendingPathComponent(Bundle.main.bundleURL.lastPathComponent)
        guard let found = info(of: bundle), found.identifier == Config.bundleIdentifier, found.version == version,
              isNewerThanRunning(version: found.version, build: found.build)
        else {
            try? FileManager.default.removeItem(at: workDir)
            return nil
        }
        if let problem = signatureProblem(of: bundle) {
            log.app("The downloaded app update is no longer usable: \(problem)")
            try? FileManager.default.removeItem(at: workDir)
            return nil
        }
        return Staged(version: found.version, build: found.build, bundle: bundle)
    }

    static func check(log: LogFile) async throws -> Outcome {
        let release: AppRelease
        do { release = try await fetchJSON(AppRelease.self, fromFirstOf: Config.appManifestURLs) } catch {
            throw SetupError.from(error, doing: "checking for a new version of the app")
        }
        guard isNewerThanRunning(version: release.version, build: release.build ?? "") else { return .upToDate }
        if let minimum = release.minimumSystemVersion {
            let parts = minimum.split(separator: ".").compactMap { Int($0) }
            let required = OperatingSystemVersion(majorVersion: parts.first ?? 0,
                                                  minorVersion: parts.count > 1 ? parts[1] : 0, patchVersion: 0)
            if !ProcessInfo.processInfo.isOperatingSystemAtLeast(required) { return .upToDate }
        }
        guard release.isSigned else {
            throw SetupError(Plain.updateCheckFailed,
                             detail: "mac.json for \(release.version) is not signed with Tinkjam's release key; not installed")
        }
        guard canReplaceInstalled, let url = URL(string: release.url) else { return .manual(release.version) }
        if let staged = stagedOnDisk(log: log), staged.version == release.version,
           release.build == nil || release.build == staged.build {
            return .staged(staged)
        }

        let fm = FileManager.default
        try? fm.removeItem(at: workDir)
        let zip = workDir.appendingPathComponent("update.zip")
        let unpacked = workDir.appendingPathComponent(release.version)
        log.app("Downloading Tinkjam Sync for Mac \(release.version)")
        do { try await FileDownload.fetch(url, to: zip) } catch {
            throw SetupError.from(error, doing: "downloading the new version of the app")
        }
        guard try sha256(of: zip) == release.sha256.lowercased() else {
            try? fm.removeItem(at: workDir)
            throw SetupError(Plain.updateCheckFailed, detail: "the new version of the app did not match its checksum")
        }
        try fm.createDirectory(at: unpacked, withIntermediateDirectories: true)
        let ditto = await run(URL(fileURLWithPath: "/usr/bin/ditto"), ["-x", "-k", zip.path, unpacked.path])
        try? fm.removeItem(at: zip)
        let bundle = unpacked.appendingPathComponent(Bundle.main.bundleURL.lastPathComponent)
        guard ditto.succeeded, let found = info(of: bundle),
              found.identifier == Config.bundleIdentifier, found.version == release.version,
              release.build == nil || found.build == release.build,
              isNewerThanRunning(version: found.version, build: found.build)
        else {
            try? fm.removeItem(at: workDir)
            throw SetupError(Plain.updateCheckFailed, detail: "the new version of the app was not a Tinkjam Sync build")
        }
        if let problem = signatureProblem(of: bundle) {
            try? fm.removeItem(at: workDir)
            throw SetupError(Plain.updateCheckFailed, detail: "the new version of the app was not installed: \(problem)")
        }
        let record = try JSONSerialization.data(withJSONObject: ["version": found.version, "build": found.build])
        try record.write(to: recordFile)
        log.app("Tinkjam Sync for Mac \(found.version) (\(found.build)) is ready to install")
        return .staged(Staged(version: found.version, build: found.build, bundle: bundle))
    }

    private static func teamIdentifier(_ bundle: URL) -> String? {
        let info = runBlocking(URL(fileURLWithPath: "/usr/bin/codesign"), ["-dv", bundle.path], timeout: 30)
        guard let line = info.output.split(separator: "\n").first(where: { $0.hasPrefix("TeamIdentifier=") }) else { return nil }
        let team = String(line.dropFirst("TeamIdentifier=".count))
        return team == "not set" ? nil : team
    }

    /// Starts a small script that waits for this app to quit, swaps the bundles and opens the new
    /// one. Call it after Sync has stopped, then terminate.
    static func launchSwap(_ staged: Staged, log: URL) throws {
        let installed = Bundle.main.bundleURL.path
        let backup = workDir.appendingPathComponent("previous.app").path
        // Opens the new copy before tidying up, and asks again if Launch Services is not ready.
        let script = """
        say() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] app: $*"; }
        while kill -0 \(getpid()) 2>/dev/null; do sleep 0.2; done
        rm -rf "$3"
        if mv "$1" "$3" && mv "$2" "$1"; then say "Installed the new version"; else [ -d "$1" ] || mv "$3" "$1"; say "Could not replace $1; opening it as it was"; fi
        for attempt in 1 2 3 4 5; do /usr/bin/open "$1" && break; say "Could not open $1 (attempt $attempt)"; sleep 2; done
        rm -rf "$3"
        """
        try spawnDetachedScript(script, ["tinkjam-sync-update", installed, staged.bundle.path, backup], output: log)
    }
}
