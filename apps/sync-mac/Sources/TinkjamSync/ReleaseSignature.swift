import CryptoKit
import Foundation

/// What mac.json and sync.json name is installed only when Tinkjam's release key signed it, not
/// because trellium.org served it. Same rule and keys as scripts/sync-package/updateCheck.ts and
/// apps/sync-windows/src/ReleaseSignature.cs; `node scripts/sign-release.ts public` prints them.
enum ReleaseSignature {
    /// keyId to the P-256 key's raw x||y (base64). The second is held back for rotation.
    static let publicKeys: [String: String] = [
        "ef314cdf2274b761": "OWhWhpaREXvpaUlBj0bCM9JZ0wmuarNs1D1LCKJXKb+yrCM9kSXnUGHkEzKVj5uSerr38r8Si488l03ltzl7wg==",
        "abba1fb4c21713ca": "UgGkI4A4huZQzmxgXfcRXLA3KsIB8/5kojMQOJRjVwVA4RQjHk8lQD7KvVZclEoPdjM1oUD2fTy7cwW+1zmh3w==",
    ]

    /// The exact text the signature covers, fields in this order; nil when one holds a line break.
    static func canonical(kind: String, version: String, build: String?, url: String, sha256: String?,
                          minimumSystemVersion: String?) -> String? {
        let fields = [("version", version), ("build", build ?? ""), ("url", url), ("sha256", sha256 ?? ""),
                      ("minimumSystemVersion", minimumSystemVersion ?? "")]
        if fields.contains(where: { $0.1.contains("\n") || $0.1.contains("\r") }) { return nil }
        return (["tinkjam-release-v1", "kind=\(kind)"] + fields.map { "\($0.0)=\($0.1)" }).joined(separator: "\n")
    }

    static func isValid(kind: String, version: String, build: String?, url: String, sha256: String?,
                        minimumSystemVersion: String?, keyId: String?, signature: String?,
                        keys: [String: String] = publicKeys) -> Bool {
        guard let keyId, let signature, let encoded = keys[keyId],
              let text = canonical(kind: kind, version: version, build: build, url: url, sha256: sha256,
                                   minimumSystemVersion: minimumSystemVersion),
              let raw = Data(base64Encoded: encoded), let signed = Data(base64Encoded: signature), signed.count == 64,
              let key = try? P256.Signing.PublicKey(rawRepresentation: raw),
              let ecdsa = try? P256.Signing.ECDSASignature(rawRepresentation: signed)
        else { return false }
        return key.isValidSignature(ecdsa, for: Data(text.utf8))
    }
}

/// sync.tgz unpacked as the package itself: only npm's `package/` folder, plain files and folders.
enum PackageArchive {
    static func safeName(_ name: String) -> Bool {
        name.hasPrefix("package/") && !name.contains("\\") && !name.contains(":")
            && !name.split(separator: "/", omittingEmptySubsequences: false).contains("..")
    }

    /// A line of tar's long listing: a file starts with -, a folder with d; links say so.
    static func plainEntry(_ line: String) -> Bool {
        guard let first = line.first, first == "-" || first == "d" else { return false }
        return !line.contains(" link to ") && !line.contains(" -> ")
    }

    static func safeListing(names: [String], longListing: [String]) -> Bool {
        !names.isEmpty && names.count == longListing.count && names.allSatisfy(safeName) && longListing.allSatisfy(plainEntry)
    }
}

/// npm installs exactly the package's npm-shrinkwrap.json, with no install scripts but the two native ones.
enum NpmCommands {
    static func ci(_ npmCLI: String, _ cache: String) -> [String] {
        [npmCLI, "ci", "--omit=dev", "--ignore-scripts",
         "--no-audit", "--no-fund", "--loglevel=error", "--cache", cache]
    }

    static func rebuild(_ npmCLI: String, _ cache: String) -> [String] {
        [npmCLI, "rebuild", "koffi", "node-pty", "--loglevel=error", "--cache", cache]
    }
}
