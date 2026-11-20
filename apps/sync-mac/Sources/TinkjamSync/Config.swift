import Foundation

/// Fixed addresses and pins. Each URL can be overridden with a user default of the same name
/// (for example `-SyncManifestURL http://127.0.0.1:8000/sync.json` as a launch argument), which
/// is how the app is tested against a local server.
enum Config {
    static let bundleIdentifier = "org.trellium.tinkjam-sync-app"
    static let hostedAppURL = url("HostedAppURL", "https://app.tinkjam.com")
    /// The tarball's address as signed manifests name it: still trellium.org, which every copy out
    /// there and every network told to allow it reaches (tinkjam.com serves the same file).
    static let syncPackageURL = url("SyncPackageURL", "https://trellium.org/sync.tgz")
    /// Each manifest from tinkjam.com, else the same file on trellium.org; an override stands alone.
    static let syncManifestURLs = urls("SyncManifestURL", "/sync.json")
    static let appManifestURLs = urls("AppManifestURL", "/downloads/mac.json")
    static let downloadPageURL = url("DownloadPageURL", "https://tinkjam.com/downloads/Tinkjam-Sync.dmg")

    /// The npx-installed Sync's LaunchAgent for the default home.
    static let legacyLaunchdLabel = "org.trellium.tinkjam-sync"

    /// Sync's approval page listens here; another app holding it blocks connecting.
    static let approvalPort = 34338

    /// Node.js for Sync, kept by the app under `<home>/runtime`. Current LTS; the hashes are from
    /// https://nodejs.org/dist/v26.13.1/SHASUMS256.txt. Bump all three together.
    static let nodeVersion = "v26.13.1"
    static let nodeSHA256: [String: String] = [
        "arm64": "af6202f5370a3a5209e85dc543758dfd9f44c8726626a236730cd603a67a8559",
        "x64": "2693310b2820f9350d29524f21344e1c623875bab773457d55b2aceb9670716f",
    ]

    /// Background checks for a newer Sync or app happen at most this often; an hourly timer and
    /// waking from sleep ask. A little under an hour, so a timer that fires early still counts.
    static let updateCheckInterval: TimeInterval = 55 * 60

    /// After giving up, the app tries again this often by itself; sooner when the cause was the network.
    static let slowRetryInterval: TimeInterval = 15 * 60
    static let offlineRetryInterval: TimeInterval = 5 * 60

    /// Sync rewrites sync-status.json every 30 seconds once connected; older than this, it is not trusted.
    static let statusStaleAfter: TimeInterval = 120

    private static func urls(_ key: String, _ path: String) -> [URL] {
        if let value = UserDefaults.standard.string(forKey: key), let url = URL(string: value) {
            return [url]
        }
        return ["https://tinkjam.com", "https://trellium.org"].map { URL(string: $0 + path)! }
    }

    private static func url(_ key: String, _ fallback: String) -> URL {
        if let value = UserDefaults.standard.string(forKey: key), let url = URL(string: value) {
            return url
        }
        return URL(string: fallback)!
    }
}

/// Where everything lives. The home is `~/.tinkjam`, shared with the npx-installed Sync so an
/// existing connection carries over; `-BaseDirectory <dir>` points a test copy somewhere else.
struct Paths {
    let base: URL

    static func resolve() -> Paths {
        if let custom = UserDefaults.standard.string(forKey: "BaseDirectory"), !custom.isEmpty {
            let expanded = (custom as NSString).expandingTildeInPath
            return Paths(base: URL(fileURLWithPath: expanded).standardizedFileURL)
        }
        return Paths(base: defaultBase)
    }

    static var defaultBase: URL {
        FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".tinkjam")
    }

    /// Only the default home owns the login item and the old LaunchAgent; a test copy leaves both alone.
    var isDefault: Bool { base.standardizedFileURL.path == Paths.defaultBase.standardizedFileURL.path }

    var runtime: URL { base.appendingPathComponent("runtime") }
    var nodeHome: URL { runtime.appendingPathComponent("node-\(Config.nodeVersion)-darwin-\(Machine.nodeArch)") }
    var node: URL { nodeHome.appendingPathComponent("bin/node") }
    var npmCLI: URL { nodeHome.appendingPathComponent("lib/node_modules/npm/bin/npm-cli.js") }
    var app: URL { base.appendingPathComponent("app") }
    var staging: URL { base.appendingPathComponent("app-staging") }
    var log: URL { base.appendingPathComponent("logs/sync.log") }
    var status: URL { base.appendingPathComponent("userdata/sync-status.json") }
    var lock: URL { base.appendingPathComponent("sync-app.lock") }

    /// The package inside an install root (`app` or `app-staging`).
    static func package(in root: URL) -> URL { root.appendingPathComponent("node_modules/tinkjam-sync") }
    static func serverEntry(in root: URL) -> URL { package(in: root).appendingPathComponent("dist/bin.mjs") }
    static func launcher(in root: URL) -> URL { package(in: root).appendingPathComponent("bin/tinkjam-sync.mjs") }
}

enum Machine {
    /// Apple silicon gets the arm64 Node even when this binary runs under Rosetta.
    static let nodeArch: String = {
        var value: Int32 = 0
        var size = MemoryLayout<Int32>.size
        if sysctlbyname("hw.optional.arm64", &value, &size, nil, 0) == 0, value == 1 { return "arm64" }
        return "x64"
    }()

    static var appVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0.0.0"
    }

    static var appBuild: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "0"
    }

    static var appIdentity: String { "\(appVersion) (\(appBuild))" }
}
