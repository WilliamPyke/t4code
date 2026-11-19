using System;
using System.Collections.Generic;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace TinkjamSync
{
    /// <summary>
    /// What windows.json and sync.json name is installed only when Tinkjam's release key signed it,
    /// not because trellium.org served it. Same rule and keys as scripts/sync-package/updateCheck.ts;
    /// `node scripts/sign-release.ts public` prints them.
    /// </summary>
    public static class ReleaseSignature
    {
        /// <summary>keyId to the P-256 key as a CNG ECCPUBLICBLOB (base64). The second is held back for rotation.</summary>
        public static readonly Dictionary<string, string> PublicKeys = new Dictionary<string, string>
        {
            ["ef314cdf2274b761"] = "RUNTMSAAAAA5aFaGlpERe+lpSUGPRsIz0lnTCa5qs2zUPUsIolcpv7KsIz2RJedQYeQTMpWPm5J6uvfyvxKLjzyXTeW3OXvC",
            ["abba1fb4c21713ca"] = "RUNTMSAAAABSAaQjgDiG5lDObGBd9xFcsDcqwgHz/mSiMxA4lGNXBUDhFCMeTyVAPsq9VlyUSg92MzWhQPZ9PLtzBb7XOaHf",
        };

        static readonly string[] SignedFields = { "version", "build", "url", "sha256", "minimumSystemVersion" };

        /// <summary>The exact text the signature covers; null when a field is not one line of text.</summary>
        public static string Canonical(string kind, Dictionary<string, object> manifest)
        {
            if (manifest == null) return null;
            var lines = new List<string> { "tinkjam-release-v1", "kind=" + kind };
            foreach (var field in SignedFields)
            {
                var text = "";
                if (manifest.TryGetValue(field, out var value) && value != null)
                {
                    text = value as string;
                    if (text == null || text.IndexOf('\n') >= 0 || text.IndexOf('\r') >= 0) return null;
                }
                lines.Add(field + "=" + text);
            }
            return string.Join("\n", lines);
        }

        public static bool Verify(string kind, Dictionary<string, object> manifest) => Verify(kind, manifest, PublicKeys);

        public static bool Verify(string kind, Dictionary<string, object> manifest, IDictionary<string, string> keys)
        {
            var canonical = Canonical(kind, manifest);
            var keyId = Json.Text(manifest, "keyId");
            var signature = Json.Text(manifest, "signature");
            if (canonical == null || keyId == null || signature == null || !keys.TryGetValue(keyId, out var blob)) return false;
            try
            {
                var raw = Convert.FromBase64String(signature);
                if (raw.Length != 64) return false;
                using (var key = CngKey.Import(Convert.FromBase64String(blob), CngKeyBlobFormat.EccPublicBlob))
                using (var ecdsa = new ECDsaCng(key))
                    return ecdsa.VerifyData(Encoding.UTF8.GetBytes(canonical), raw, HashAlgorithmName.SHA256);
            }
            catch (Exception) { return false; }
        }
    }

    /// <summary>sync.tgz unpacked as the package itself: only npm's `package/` folder, plain files and folders.</summary>
    public static class PackageArchive
    {
        public static bool SafeName(string name) =>
            name != null && name.StartsWith("package/", StringComparison.Ordinal) &&
            name.IndexOf('\\') < 0 && name.IndexOf(':') < 0 && !name.Split('/').Any(part => part == "..");

        /// <summary>A line of tar's long listing: a file starts with -, a folder with d; links say so.</summary>
        public static bool PlainEntry(string line) =>
            line.Length > 0 && (line[0] == '-' || line[0] == 'd') && !line.Contains(" link to ") && !line.Contains(" -> ");

        public static bool SafeListing(IList<string> names, IList<string> longListing) =>
            names.Count > 0 && names.Count == longListing.Count && names.All(SafeName) && longListing.All(PlainEntry);
    }

    /// <summary>npm installs exactly the package's npm-shrinkwrap.json, with no install scripts but the two native ones.</summary>
    public static class NpmCommands
    {
        public static string[] Ci(string npmCli, string packageDir, string cache) => new[]
        {
            npmCli, "ci", "--prefix", packageDir, "--omit=dev", "--ignore-scripts",
            "--no-audit", "--no-fund", "--loglevel=error", "--cache", cache,
        };

        public static string[] Rebuild(string npmCli, string packageDir, string cache) => new[]
        {
            npmCli, "rebuild", "koffi", "node-pty", "--prefix", packageDir, "--loglevel=error", "--cache", cache,
        };
    }
}
