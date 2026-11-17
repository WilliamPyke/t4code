import Foundation

/// `https://trellium.org/downloads/mac.json`, published with each build by `scripts/build.sh`:
///
///     { "version": "1.0.1", "url": "https://trellium.org/downloads/Tinkjam-Sync-mac.zip",
///       "sha256": "<hex of the zip>", "minimumSystemVersion": "13.0" }
struct AppRelease: Decodable {
    let version: String
    let url: String
    let sha256: String
    let minimumSystemVersion: String?
}

/// The app updates itself: download the zip, check its SHA-256 and signature, unpack it beside
/// the caches, and swap bundles only when the person chooses "Restart to Update".
enum AppUpdater {
    struct Staged {
        let version: String
        let bundle: URL
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

    private static var workDir: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appendingPathComponent(Config.bundleIdentifier).appendingPathComponent("update")
    }

    static func check(log: LogFile) async throws -> Outcome {
        let release: AppRelease
        do { release = try await fetchJSON(AppRelease.self, from: Config.appManifestURL) } catch {
            throw SetupError.from(error, doing: "checking for a new version of the app")
        }
        guard isNewer(release.version, than: Machine.appVersion) else { return .upToDate }
        if let minimum = release.minimumSystemVersion {
            let parts = minimum.split(separator: ".").compactMap { Int($0) }
            let required = OperatingSystemVersion(majorVersion: parts.first ?? 0,
                                                  minorVersion: parts.count > 1 ? parts[1] : 0, patchVersion: 0)
            if !ProcessInfo.processInfo.isOperatingSystemAtLeast(required) { return .upToDate }
        }
        let installed = Bundle.main.bundleURL
        guard FileManager.default.isWritableFile(atPath: installed.deletingLastPathComponent().path),
              FileManager.default.isWritableFile(atPath: installed.path)
        else { return .manual(release.version) }
        guard let url = URL(string: release.url) else { return .manual(release.version) }

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
            throw SetupError("The new version of the app did not match its checksum, so it was not installed.")
        }
        try fm.createDirectory(at: unpacked, withIntermediateDirectories: true)
        let ditto = await run(URL(fileURLWithPath: "/usr/bin/ditto"), ["-x", "-k", zip.path, unpacked.path])
        try? fm.removeItem(at: zip)
        let bundle = unpacked.appendingPathComponent(installed.lastPathComponent)
        guard ditto.succeeded, let candidate = Bundle(url: bundle),
              candidate.bundleIdentifier == Config.bundleIdentifier,
              (candidate.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) == release.version
        else {
            throw SetupError("The new version of the app was not a Tinkjam Sync build, so it was not installed.")
        }
        // A broken or altered bundle fails this; a Developer ID build must also come from our team.
        let verify = await run(URL(fileURLWithPath: "/usr/bin/codesign"), ["--verify", "--deep", "--strict", bundle.path])
        guard verify.succeeded else {
            log.app("codesign --verify failed: \(verify.tail())")
            throw SetupError("The new version of the app has a broken signature, so it was not installed.")
        }
        if let ours = teamIdentifier(Bundle.main.bundleURL), teamIdentifier(bundle) != ours {
            throw SetupError("The new version of the app was signed by someone else, so it was not installed.")
        }
        log.app("Tinkjam Sync for Mac \(release.version) is ready; it installs on Restart to Update")
        return .staged(Staged(version: release.version, bundle: bundle))
    }

    private static func teamIdentifier(_ bundle: URL) -> String? {
        let info = runBlocking(URL(fileURLWithPath: "/usr/bin/codesign"), ["-dv", bundle.path], timeout: 30)
        guard let line = info.output.split(separator: "\n").first(where: { $0.hasPrefix("TeamIdentifier=") }) else { return nil }
        let team = String(line.dropFirst("TeamIdentifier=".count))
        return team == "not set" ? nil : team
    }

    /// Starts a small script that waits for this app to quit, swaps the bundles and opens the new
    /// one. Call it after Sync has stopped, then terminate.
    static func launchSwap(_ staged: Staged) throws {
        let installed = Bundle.main.bundleURL.path
        let backup = workDir.appendingPathComponent("previous.app").path
        let script = """
        while kill -0 \(getpid()) 2>/dev/null; do sleep 0.2; done
        rm -rf "$3"
        if mv "$1" "$3" && mv "$2" "$1"; then rm -rf "$3"; else [ -d "$1" ] || mv "$3" "$1"; fi
        open "$1"
        """
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/sh")
        process.arguments = ["-c", script, "tinkjam-sync-update", installed, staged.bundle.path, backup]
        process.standardInput = FileHandle.nullDevice
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try process.run()
    }
}
