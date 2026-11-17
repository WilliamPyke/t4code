using System;
using System.IO;
using System.Linq;

namespace TinkjamSync
{
    /// <summary>`TinkjamSync.exe --self-test`: the pure parts, run by the build before it packages.</summary>
    static class SelfTest
    {
        static int passed, failed;

        static void Check(string name, bool ok)
        {
            if (ok) passed++;
            else { failed++; Console.WriteLine("FAIL " + name); }
        }

        public static int Run()
        {
            // Versions: the Sync package's scheme, and anything unreadable is not newer.
            Check("newer build stamp", Versions.IsNewer("0.1.7+202611171847", "0.1.7+202611181200"));
            Check("older build stamp", !Versions.IsNewer("0.1.7+202611181200", "0.1.7+202611171847"));
            Check("same version", !Versions.IsNewer("0.1.7+202611171847", "0.1.7+202611171847"));
            Check("minor beats stamp", Versions.IsNewer("0.1.9+202612010000", "0.2.0+202601010000"));
            Check("numeric not text", Versions.IsNewer("0.9.0", "0.10.0"));
            Check("stamp beats none", Versions.IsNewer("0.1.0", "0.1.0+202601010000"));
            Check("garbage latest", !Versions.IsNewer("0.1.0", "latest"));
            Check("null latest", !Versions.IsNewer("0.1.0", null));
            Check("nothing installed", Versions.IsNewer(null, "0.1.0"));

            // Checksums.
            var file = Path.GetTempFileName();
            try
            {
                File.WriteAllText(file, "abc");
                const string abc = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
                Check("sha256 of abc", Checksum.Sha256File(file) == abc);
                Check("sha256 match ignores case and spaces", Checksum.Matches(file, " " + abc.ToUpperInvariant() + "\n"));
                Check("sha256 mismatch", !Checksum.Matches(file, abc.Replace('a', 'b')));
                Check("sha256 empty never matches", !Checksum.Matches(file, ""));
            }
            finally { File.Delete(file); }

            // Backoff: 2, 4, 8, 16 seconds; the fifth crash in ten minutes stops; old crashes drop out.
            var now = new DateTime(2026, 11, 17, 12, 0, 0, DateTimeKind.Utc);
            Func<int, DateTime[]> crashes = n => Enumerable.Range(0, n).Select(i => now.AddSeconds(-30 * i)).ToArray();
            Check("first crash waits 2s", Backoff.Next(crashes(1), now) == TimeSpan.FromSeconds(2));
            Check("fourth crash waits 16s", Backoff.Next(crashes(4), now) == TimeSpan.FromSeconds(16));
            Check("fifth crash stops", Backoff.Next(crashes(5), now) == null);
            Check("old crashes forgotten", Backoff.Next(new[] { now.AddMinutes(-30), now.AddMinutes(-20), now.AddMinutes(-15), now.AddMinutes(-11), now }, now) == TimeSpan.FromSeconds(2));

            // The status file Sync writes, only trusted from the Sync this app started.
            const string waiting = "{\"pid\":4242,\"status\":\"unreachable\",\"reason\":\"The tunnel is not routed yet\",\"cause\":\"tunnel-pending\",\"fix\":\"x\"}";
            var parsed = StatusFile.Parse(waiting, 4242);
            Check("status waiting", parsed != null && !parsed.Reachable && parsed.Reason == "The tunnel is not routed yet");
            Check("status reachable", StatusFile.Parse("{\"pid\":7,\"status\":\"reachable\"}", 7)?.Reachable == true);
            Check("status other pid ignored", StatusFile.Parse(waiting, 99) == null);
            Check("status garbage ignored", StatusFile.Parse("{nope", 4242) == null);

            // Sync's words.
            Check("approval url", SyncOutput.ParseApprovalUrl("  http://127.0.0.1:34338") == "http://127.0.0.1:34338");
            Check("approval url only on its own line", SyncOutput.ParseApprovalUrl("open http://127.0.0.1:34338 now") == null);
            Check("computer name", SyncOutput.ParseComputerName("To connect William's PC to Tinkjam, open this link. It says what") == "William's PC");
            Check("exit not connected", SyncOutput.Classify(0, "[x] This computer is not connected to Tinkjam, so Tinkjam Sync stopped.") == SyncExit.NotConnected);
            Check("exit already running", SyncOutput.Classify(0, "Tinkjam Sync is already running in the background (pid 5).") == SyncExit.AlreadyRunning);
            Check("exit crash", SyncOutput.Classify(1, "is not connected to Tinkjam") == SyncExit.Crashed);
            Check("silent clean exit is a crash", SyncOutput.Classify(0, "") == SyncExit.Crashed);

            // The tray for each state.
            var view = new AppView { ComputerName = "PC", Version = "0.1.0" };
            Func<string> ids = () => string.Join(",", MenuModel.Items(view).Select(i => i.Id));
            view.Phase = Phase.Connected;
            Check("connected menu", ids() == "status,computer,-,open,disconnect,-,autostart,log,update,-,exit");
            Check("connected colored", MenuModel.Colored(view));
            view.Phase = Phase.Approving;
            Check("approving menu", ids() == "status,computer,-,open-again,open,-,autostart,log,update,-,exit");
            Check("approving tooltip", MenuModel.Tooltip(view) == "Tinkjam Sync: Waiting for you to approve in your browser…");
            Check("approving grey", !MenuModel.Colored(view));
            view.Phase = Phase.Stopped;
            view.Detail = "port 34338 is in use by another program, so the sign-in page can't open.";
            Check("stopped menu", ids() == "status,computer,-,retry,open,connect,-,autostart,log,update,-,exit");
            Check("stopped status", MenuModel.StatusLine(view).StartsWith("Stopped: port 34338"));
            Check("tooltip fits 63", MenuModel.Tooltip(view).Length <= 63);
            view.Phase = Phase.NotConnected;
            view.Detail = null;
            Check("not connected menu", ids() == "status,computer,-,open,connect,-,autostart,log,update,-,exit");
            view.Phase = Phase.Connecting;
            view.Detail = "waiting on: The tunnel is not routed yet";
            Check("slow connecting says why", MenuModel.StatusLine(view) == "Connecting… waiting on: The tunnel is not routed yet");
            view.Busy = true;
            Check("busy disables disconnect", !MenuModel.Items(view).First(i => i.Id == "disconnect").Enabled);
            view.UpdateVersion = "0.2.0";
            Check("update ready item", MenuModel.Items(view).First(i => i.Id == "update").Text == "Restart to update (version 0.2.0)");
            Check("autostart checked", MenuModel.Items(view).First(i => i.Id == "autostart").Checked);

            // Command lines and names.
            Check("quote plain", CommandLine.Quote(@"C:\x\node.exe") == @"C:\x\node.exe");
            Check("quote spaces", CommandLine.Quote(@"C:\Program Files\x") == "\"C:\\Program Files\\x\"");
            Check("quote trailing backslash", CommandLine.Quote(@"C:\a b\") == "\"C:\\a b\\\\\"");
            Check("quote inner quote", CommandLine.Quote("a\"b") == "\"a\\\"b\"");
            Check("quote empty", CommandLine.Quote("") == "\"\"");
            Check("home suffix", Names.HomeSuffix(@"C:\Temp\TJ Win_Test\") == "tj-win-test");
            Check("home suffix fallback", Names.HomeSuffix(@"C:\Temp\___") == "custom");
            var testHome = Home.Resolve(new AppArgs { BaseDir = Path.Combine(Path.GetTempPath(), "tj-selftest-home") });
            Check("test home names", testHome.RunValueName == "TinkjamSync (tj-selftest-home)" && testHome.MutexName == @"Local\TinkjamSync.tj-selftest-home");
            Check("never the package's name", !testHome.RunValueName.StartsWith("Tinkjam Sync"));
            var defaults = Home.Resolve(new AppArgs { BaseDir = Home.DefaultBaseDir() });
            Check("default names", defaults.Suffix == "" && defaults.RunValueName == "TinkjamSync" && defaults.PassThrough().Count == 0);
            var parsedArgs = AppArgs.Parse(new[] { "/uninstall", "/SILENT", "--base-dir", @"C:\x" });
            Check("args", parsedArgs.Uninstall && parsedArgs.Silent && parsedArgs.BaseDir == @"C:\x");

            Console.WriteLine("self-test: " + passed + " passed, " + failed + " failed");
            return failed == 0 ? 0 : 1;
        }
    }
}
