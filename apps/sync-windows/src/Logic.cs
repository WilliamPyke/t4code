using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;

namespace TinkjamSync
{
    // Everything here is pure (or reads one file it is given) so --self-test can cover it.

    public enum Phase { SettingUp, Approving, Connecting, Connected, Reconnecting, NotConnected, Disconnecting, Stopped }

    public enum TrayIcon { Color, Grey, Attention }

    /// <summary>What the tray shows. The engine fills it; MenuModel turns it into words.</summary>
    public sealed class AppView
    {
        public Phase Phase = Phase.SettingUp;
        public string Detail;
        public int? Percent;
        public string ComputerName = "";
        public bool StartWithWindows = true;
        public string Version = "";
        public string UpdateVersion;
        public bool Busy;
        public bool CheckingForUpdates;
    }

    public sealed class MenuEntry
    {
        public string Id;
        public string Text;
        public bool Enabled = true;
        public bool Checked;
        public bool Separator => Id == "-";
        public static MenuEntry Sep() => new MenuEntry { Id = "-", Text = "" };
    }

    /// <summary>What the person reads when something is in the way. The raw cause goes to the log.</summary>
    public static class Words
    {
        public const string Offline = "Can't reach the internet.";
        public const string Restricted =
            "This network is blocking part of Tinkjam Sync. On a work network or VPN, try another network, or ask whoever runs it to allow tinkjam.com, trellium.org, nodejs.org and registry.npmjs.org.";
        public const string ServerTrouble = "Tinkjam's servers aren't answering right now.";
        public const string Damaged = "The download didn't arrive in one piece.";
        public const string DiskFull = "This computer's disk is full, so Tinkjam Sync can't finish setting up. Free up some space.";
        public const string InstallFailed = "Tinkjam Sync couldn't finish installing.";
        public const string Unexpected = "Something went wrong while setting up Tinkjam Sync.";
        public const string CouldNotStart = "Tinkjam Sync couldn't start.";
        public const string KeepsStopping = "Tinkjam Sync keeps stopping.";
        public const string SignInPageBlocked =
            "Another program on this computer is in the way of the sign-in page. Restart your computer.";
        public const string CantCheckConnection = "Couldn't check whether this computer is connected.";
        public const string FindTheIcon = "Its icon is near the clock: click the ^ arrow if you don't see it.";

        public static string Capitalized(string text) =>
            string.IsNullOrEmpty(text) ? "" : char.ToUpper(text[0]) + text.Substring(1);
    }

    public static class MenuModel
    {
        public static string Title(AppView view)
        {
            switch (view.Phase)
            {
                case Phase.SettingUp: return "Setting up…";
                case Phase.Approving: return "Waiting for you to approve in your browser…";
                case Phase.Connecting: return "Connecting…";
                case Phase.Connected: return "Connected";
                case Phase.Reconnecting: return "Reconnecting…";
                case Phase.NotConnected: return "Not connected";
                case Phase.Disconnecting: return "Disconnecting…";
                default: return "Stopped";
            }
        }

        public static string DetailText(AppView view)
        {
            if (string.IsNullOrWhiteSpace(view.Detail)) return null;
            return view.Percent == null ? view.Detail : view.Detail + " (" + view.Percent + "%)";
        }

        public static string StatusLine(AppView view)
        {
            var detail = DetailText(view);
            if (detail == null) return Title(view);
            var stated = view.Phase == Phase.Stopped || view.Phase == Phase.NotConnected;
            return Title(view) + (stated ? ": " : " ") + detail;
        }

        /// <summary>Windows cuts a tray tooltip at 63 characters (and .NET Framework throws past it).</summary>
        public static string Tooltip(AppView view)
        {
            var text = "Tinkjam Sync: " + StatusLine(view);
            return text.Length <= 63 ? text : text.Substring(0, 62) + "…";
        }

        public static TrayIcon Icon(AppView view)
        {
            switch (view.Phase)
            {
                case Phase.Connected: return TrayIcon.Color;
                case Phase.Approving:
                case Phase.Stopped: return TrayIcon.Attention;
                default: return TrayIcon.Grey;
            }
        }

        public static List<string> Wrap(string text, int width)
        {
            var lines = new List<string>();
            var line = "";
            foreach (var word in (text ?? "").Split(new[] { ' ' }, StringSplitOptions.RemoveEmptyEntries))
            {
                if (line.Length > 0 && line.Length + word.Length + 1 > width) { lines.Add(line); line = ""; }
                line += (line.Length == 0 ? "" : " ") + word;
            }
            if (line.Length > 0) lines.Add(line);
            return lines;
        }

        public static List<MenuEntry> Items(AppView view)
        {
            var items = new List<MenuEntry> { new MenuEntry { Id = "status", Text = Title(view), Enabled = false } };
            foreach (var line in Wrap(DetailText(view), 48))
                items.Add(new MenuEntry { Id = "detail", Text = line, Enabled = false });
            items.Add(new MenuEntry { Id = "computer", Text = "This computer: " + view.ComputerName, Enabled = false });
            items.Add(MenuEntry.Sep());
            if (view.Phase == Phase.Approving) items.Add(new MenuEntry { Id = "open-again", Text = "Open the approval page again" });
            if (view.Phase == Phase.Stopped) items.Add(new MenuEntry { Id = "retry", Text = "Try again", Enabled = !view.Busy });
            items.Add(new MenuEntry { Id = "open", Text = "Open Tinkjam" });
            if (view.Phase == Phase.NotConnected)
                items.Add(new MenuEntry { Id = "connect", Text = "Connect…", Enabled = !view.Busy });
            else if (view.Phase == Phase.Connected || view.Phase == Phase.Connecting || view.Phase == Phase.Reconnecting)
                items.Add(new MenuEntry { Id = "disconnect", Text = "Disconnect this computer…", Enabled = !view.Busy });
            items.Add(MenuEntry.Sep());
            items.Add(new MenuEntry { Id = "autostart", Text = "Start with Windows", Checked = view.StartWithWindows });
            items.Add(new MenuEntry { Id = "log", Text = "Show technical log" });
            if (view.CheckingForUpdates)
                items.Add(new MenuEntry { Id = "update", Text = "Checking for updates…", Enabled = false });
            else if (view.UpdateVersion != null)
                items.Add(new MenuEntry { Id = "update", Text = "Restart to update to version " + view.UpdateVersion });
            else
                items.Add(new MenuEntry { Id = "update", Text = "Version " + view.Version + " · Check for updates" });
            items.Add(MenuEntry.Sep());
            items.Add(new MenuEntry { Id = "exit", Text = "Quit Tinkjam Sync" });
            return items;
        }

        /// <summary>The whole tray as text, for the log and --dump-state.</summary>
        public static string Describe(AppView view)
        {
            var lines = new List<string>
            {
                "phase: " + view.Phase,
                "tooltip: " + Tooltip(view),
                "icon: " + Icon(view).ToString().ToLowerInvariant(),
                "menu:",
            };
            foreach (var item in Items(view))
            {
                if (item.Separator) { lines.Add("  ----"); continue; }
                lines.Add("  " + (item.Checked ? "[x] " : "") + item.Text + (item.Enabled ? "" : " (disabled)"));
            }
            return string.Join(Environment.NewLine, lines);
        }
    }

    public static class NodeEnv
    {
        /// <summary>Whether to ask Node for Windows' certificates: not when the person's own
        /// NODE_OPTIONS already picks a certificate store, which Node refuses to combine.</summary>
        public static bool MayUseSystemCa(string nodeOptions) =>
            !Regex.IsMatch(nodeOptions ?? "", @"--use-(openssl|bundled|system)-ca(?![A-Za-z-])");
    }

    public static class Versions
    {
        // Same scheme as the Sync package: <major>.<minor>.<patch>+<yyyymmddhhmm>.
        static readonly Regex Pattern = new Regex(@"^(\d+)\.(\d+)\.(\d+)(?:\+(\d{1,14}))?$");

        /// <summary>Whether `latest` is newer than `own`. Anything unreadable counts as not newer.</summary>
        public static bool IsNewer(string own, string latest)
        {
            if (latest == null) return false;
            var theirs = Pattern.Match(latest.Trim());
            if (!theirs.Success) return false;
            if (own == null) return true;
            var mine = Pattern.Match(own.Trim());
            if (!mine.Success) return true;
            for (var part = 1; part <= 3; part++)
            {
                var difference = long.Parse(theirs.Groups[part].Value).CompareTo(long.Parse(mine.Groups[part].Value));
                if (difference != 0) return difference > 0;
            }
            return string.CompareOrdinal(theirs.Groups[4].Value, mine.Groups[4].Value) > 0;
        }

        /// <summary>The version without its build stamp, as a person reads it.</summary>
        public static string Short(string version) => (version ?? "").Split('+')[0];
    }

    public static class Checksum
    {
        public static string Sha256File(string path)
        {
            using (var sha = SHA256.Create())
            using (var stream = File.OpenRead(path))
                return string.Concat(sha.ComputeHash(stream).Select(b => b.ToString("x2")));
        }

        public static bool Matches(string path, string expectedHex) =>
            !string.IsNullOrWhiteSpace(expectedHex) &&
            string.Equals(Sha256File(path), expectedHex.Trim(), StringComparison.OrdinalIgnoreCase);

        public static bool LooksValid(string hex) => hex != null && Regex.IsMatch(hex.Trim(), "^[0-9a-fA-F]{64}$");
    }

    /// <summary>Restarts after a crash: 2, 4, 8, 16 seconds; a fifth crash within ten minutes stops.</summary>
    public static class Backoff
    {
        public const int Limit = 5;
        public static readonly TimeSpan Window = TimeSpan.FromMinutes(10);

        /// <summary>The wait before the next start, or null to stop. `crashes` includes the latest.</summary>
        public static TimeSpan? Next(IEnumerable<DateTime> crashes, DateTime now)
        {
            var recent = crashes.Count(at => at <= now && now - at < Window);
            if (recent >= Limit) return null;
            return TimeSpan.FromSeconds(Math.Min(2 * Math.Pow(2, Math.Max(0, recent - 1)), 60));
        }
    }

    public sealed class SyncStatus
    {
        public bool Reachable;
        public string Reason;
        /// <summary>When Sync last checked. Sync packages that stop writing once connected leave it out.</summary>
        public DateTime? CheckedAt;
    }

    public enum Health { Unknown, Reachable, Unreachable, Stale }

    public static class StatusFile
    {
        // Sync rewrites the file every 30 seconds; several missed turns mean it is stuck or asleep.
        public static readonly TimeSpan StaleAfter = TimeSpan.FromSeconds(150);

        /// <summary>sync-status.json as Sync writes it, if it was written by `pid`.</summary>
        public static SyncStatus Parse(string json, int pid)
        {
            try
            {
                var value = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                if (value == null || !value.TryGetValue("pid", out var owner) || Convert.ToInt64(owner) != pid) return null;
                var reachable = value.TryGetValue("status", out var status) && "reachable".Equals(status as string);
                value.TryGetValue("reason", out var reason);
                DateTime? checkedAt = null;
                if (value.TryGetValue("checkedAt", out var at) && at is string text &&
                    DateTime.TryParse(text, System.Globalization.CultureInfo.InvariantCulture,
                        System.Globalization.DateTimeStyles.AdjustToUniversal | System.Globalization.DateTimeStyles.AssumeUniversal, out var parsed))
                    checkedAt = parsed;
                return new SyncStatus { Reachable = reachable, Reason = reason as string, CheckedAt = checkedAt };
            }
            catch (Exception)
            {
                return null;
            }
        }

        public static SyncStatus Read(string path, int pid)
        {
            try { return Parse(File.ReadAllText(path), pid); }
            catch (IOException) { return null; }
            catch (UnauthorizedAccessException) { return null; }
        }

        /// <summary>An answer with no time is trusted as it stands; one with an old time is stale.</summary>
        public static Health HealthOf(SyncStatus status, DateTime utcNow)
        {
            if (status == null) return Health.Unknown;
            if (status.CheckedAt != null && utcNow - status.CheckedAt.Value > StaleAfter) return Health.Stale;
            return status.Reachable ? Health.Reachable : Health.Unreachable;
        }
    }

    public sealed class ProcessRow
    {
        public int Pid, ParentPid;
        public string Name;
    }

    public static class Agents
    {
        // What Sync runs for itself: its tunnel helper, and the console host Windows adds to a child.
        static readonly string[] Helpers = { "cloudflared.exe", "cloudflared", "conhost.exe" };

        /// <summary>Whether anything besides Sync's own helpers runs under `root`: an agent at work.</summary>
        public static bool Running(IEnumerable<ProcessRow> rows, int root)
        {
            var all = rows.ToList();
            var seen = new HashSet<int> { root };
            var queue = new Queue<int>();
            queue.Enqueue(root);
            while (queue.Count > 0)
            {
                var parent = queue.Dequeue();
                foreach (var row in all.Where(row => row.ParentPid == parent && seen.Add(row.Pid)))
                {
                    if (!Helpers.Contains(row.Name ?? "", StringComparer.OrdinalIgnoreCase)) return true;
                    queue.Enqueue(row.Pid);
                }
            }
            return false;
        }
    }

    public enum NetworkTrouble { None, Offline, Restricted }

    public static class Failures
    {
        static readonly string[] OfflineSigns = { "ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ENETDOWN", "getaddrinfo" };
        static readonly string[] RestrictedSigns =
        {
            "SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT", "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED",
            "DEPTH_ZERO_SELF_SIGNED_CERT", "ERR_TLS", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "ESOCKETTIMEDOUT",
            "E403", "E407", "407 Proxy", "EPROXY", "ERR_SOCKET_TIMEOUT", "fetch failed",
        };

        /// <summary>What Node or npm's own words say about the network, if anything.</summary>
        public static NetworkTrouble Classify(string output)
        {
            var text = output ?? "";
            if (OfflineSigns.Any(sign => text.IndexOf(sign, StringComparison.OrdinalIgnoreCase) >= 0)) return NetworkTrouble.Offline;
            if (RestrictedSigns.Any(sign => text.IndexOf(sign, StringComparison.OrdinalIgnoreCase) >= 0)) return NetworkTrouble.Restricted;
            return NetworkTrouble.None;
        }
    }

    public static class PathList
    {
        /// <summary>PATH lists joined in order, each folder once.</summary>
        public static string Merge(params string[] lists)
        {
            var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            var folders = new List<string>();
            foreach (var list in lists)
                foreach (var entry in (list ?? "").Split(';'))
                {
                    var folder = entry.Trim();
                    if (folder.Length == 0 || !seen.Add(folder.TrimEnd('\\'))) continue;
                    folders.Add(folder);
                }
            return string.Join(";", folders);
        }
    }

    public enum SyncExit { NotConnected, AlreadyRunning, Crashed }

    /// <summary>What Sync's own words on its terminal or in its log mean for the tray.</summary>
    public static class SyncOutput
    {
        static readonly Regex ApprovalUrl = new Regex(@"^\s+(http://127\.0\.0\.1:\d+\S*)\s*$");
        static readonly Regex ComputerName = new Regex(@"^To connect (.+) to Tinkjam, open this link");

        public static string ParseApprovalUrl(string line) =>
            line == null ? null : ApprovalUrl.Match(line) is var m && m.Success ? m.Groups[1].Value : null;

        public static string ParseComputerName(string line) =>
            line == null ? null : ComputerName.Match(line.Trim()) is var m && m.Success ? m.Groups[1].Value : null;

        /// <summary>Why a background Sync ended, from the end of its log.</summary>
        public static SyncExit Classify(int exitCode, string logTail)
        {
            var tail = logTail ?? "";
            if (exitCode == 0 && tail.Contains("is not connected to Tinkjam")) return SyncExit.NotConnected;
            if (exitCode == 0 && tail.Contains("already running in the background")) return SyncExit.AlreadyRunning;
            return SyncExit.Crashed;
        }
    }

    public static class CommandLine
    {
        /// <summary>One argument as CommandLineToArgvW splits it (the package's windowsArg).</summary>
        public static string Quote(string value)
        {
            if (value.Length > 0 && value.IndexOfAny(new[] { ' ', '\t', '\n', '\v', '"' }) < 0) return value;
            var quoted = Regex.Replace(value, @"(\\*)""", m => m.Groups[1].Value + m.Groups[1].Value + "\\\"");
            quoted = Regex.Replace(quoted, @"(\\+)$", m => m.Groups[1].Value + m.Groups[1].Value);
            return "\"" + quoted + "\"";
        }

        public static string Join(IEnumerable<string> args) => string.Join(" ", args.Select(Quote));
    }

    public static class Names
    {
        /// <summary>The Sync package's suffix for a home other than the default (service.ts serviceNames).</summary>
        public static string HomeSuffix(string baseDir)
        {
            var name = Path.GetFileName(baseDir.TrimEnd('\\', '/')).ToLowerInvariant();
            var suffix = Regex.Replace(name, "[^a-z0-9]+", "-").Trim('-');
            return suffix.Length == 0 ? "custom" : suffix;
        }
    }

    public static class Json
    {
        public static Dictionary<string, object> Parse(string text) =>
            new JavaScriptSerializer().DeserializeObject(text) as Dictionary<string, object>;

        public static string Text(Dictionary<string, object> value, string key) =>
            value != null && value.TryGetValue(key, out var found) ? found as string : null;

        public static string Write(object value) => new JavaScriptSerializer().Serialize(value);

        public static byte[] Utf8(string text) => new UTF8Encoding(false).GetBytes(text);
    }
}
