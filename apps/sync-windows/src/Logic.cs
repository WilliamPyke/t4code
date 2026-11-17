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

    public enum Phase { SettingUp, Approving, Connecting, Connected, NotConnected, Stopped }

    /// <summary>What the tray shows. The engine fills it; MenuModel turns it into words.</summary>
    public sealed class AppView
    {
        public Phase Phase = Phase.SettingUp;
        public string Detail;
        public string ComputerName = "";
        public bool StartWithWindows = true;
        public string Version = "";
        public string UpdateVersion;
        public bool Busy;
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

    public static class MenuModel
    {
        public static string StatusLine(AppView view)
        {
            switch (view.Phase)
            {
                case Phase.SettingUp: return view.Detail == null ? "Setting up…" : "Setting up… " + view.Detail;
                case Phase.Approving: return "Waiting for you to approve in your browser…";
                case Phase.Connecting: return view.Detail == null ? "Connecting…" : "Connecting… " + view.Detail;
                case Phase.Connected: return "Connected";
                case Phase.NotConnected: return view.Detail == null ? "Not connected" : "Not connected: " + view.Detail;
                default: return "Stopped: " + (view.Detail ?? "unknown reason");
            }
        }

        /// <summary>Windows cuts a tray tooltip at 63 characters (and .NET Framework throws past it).</summary>
        public static string Tooltip(AppView view)
        {
            var text = "Tinkjam Sync: " + StatusLine(view);
            return text.Length <= 63 ? text : text.Substring(0, 62) + "…";
        }

        public static bool Colored(AppView view) => view.Phase == Phase.Connected;

        public static List<MenuEntry> Items(AppView view)
        {
            var items = new List<MenuEntry>
            {
                new MenuEntry { Id = "status", Text = StatusLine(view), Enabled = false },
                new MenuEntry { Id = "computer", Text = "This computer: " + view.ComputerName, Enabled = false },
                MenuEntry.Sep(),
            };
            if (view.Phase == Phase.Approving) items.Add(new MenuEntry { Id = "open-again", Text = "Open again" });
            if (view.Phase == Phase.Stopped) items.Add(new MenuEntry { Id = "retry", Text = "Retry", Enabled = !view.Busy });
            items.Add(new MenuEntry { Id = "open", Text = "Open Tinkjam" });
            if (view.Phase == Phase.NotConnected || view.Phase == Phase.Stopped)
                items.Add(new MenuEntry { Id = "connect", Text = "Connect…", Enabled = !view.Busy });
            else if (view.Phase == Phase.Connected || view.Phase == Phase.Connecting)
                items.Add(new MenuEntry { Id = "disconnect", Text = "Disconnect this computer…", Enabled = !view.Busy });
            items.Add(MenuEntry.Sep());
            items.Add(new MenuEntry { Id = "autostart", Text = "Start with Windows", Checked = view.StartWithWindows });
            items.Add(new MenuEntry { Id = "log", Text = "Show log" });
            items.Add(view.UpdateVersion != null
                ? new MenuEntry { Id = "update", Text = "Restart to update (version " + view.UpdateVersion + ")" }
                : new MenuEntry { Id = "update", Text = "Version " + view.Version + " · Check for updates" });
            items.Add(MenuEntry.Sep());
            items.Add(new MenuEntry { Id = "exit", Text = "Exit" });
            return items;
        }

        /// <summary>The whole tray as text, for the log and --dump-state.</summary>
        public static string Describe(AppView view)
        {
            var lines = new List<string>
            {
                "phase: " + view.Phase,
                "tooltip: " + Tooltip(view),
                "icon: " + (Colored(view) ? "color" : "grey"),
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
    }

    public static class StatusFile
    {
        /// <summary>sync-status.json as Sync writes it, if it was written by `pid`.</summary>
        public static SyncStatus Parse(string json, int pid)
        {
            try
            {
                var value = new JavaScriptSerializer().DeserializeObject(json) as Dictionary<string, object>;
                if (value == null || !value.TryGetValue("pid", out var owner) || Convert.ToInt64(owner) != pid) return null;
                var reachable = value.TryGetValue("status", out var status) && "reachable".Equals(status as string);
                value.TryGetValue("reason", out var reason);
                return new SyncStatus { Reachable = reachable, Reason = reason as string };
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
