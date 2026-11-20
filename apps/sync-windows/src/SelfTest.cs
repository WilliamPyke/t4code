using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;

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

        static Dictionary<string, object> With(Dictionary<string, object> manifest, string key, object value)
        {
            manifest[key] = value;
            return manifest;
        }

        static bool KeyImports(string blob)
        {
            try
            {
                using (var key = CngKey.Import(Convert.FromBase64String(blob), CngKeyBlobFormat.EccPublicBlob)) return key.KeySize == 256;
            }
            catch (Exception) { return false; }
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
            Check("system certificates by default", NodeEnv.MayUseSystemCa(null));
            Check("own certificate choice kept", !NodeEnv.MayUseSystemCa("--max-old-space-size=4096 --use-openssl-ca"));
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
            // Health: an answer with no time is trusted; one Sync stopped refreshing is stale.
            var timed = StatusFile.Parse("{\"pid\":7,\"status\":\"reachable\",\"checkedAt\":\"2026-11-17T11:59:30.000Z\"}", 7);
            Check("status checkedAt read as UTC", timed?.CheckedAt == now.AddSeconds(-30) && timed.CheckedAt.Value.Kind == DateTimeKind.Utc);
            Check("fresh reachable", StatusFile.HealthOf(timed, now) == Health.Reachable);
            Check("stale reachable", StatusFile.HealthOf(timed, now.AddMinutes(5)) == Health.Stale);
            Check("no checkedAt trusted", StatusFile.HealthOf(StatusFile.Parse("{\"pid\":7,\"status\":\"reachable\"}", 7), now.AddDays(3)) == Health.Reachable);
            Check("unreachable", StatusFile.HealthOf(parsed, now) == Health.Unreachable);
            Check("no status unknown", StatusFile.HealthOf(null, now) == Health.Unknown);

            // Agents: anything under Sync besides its own helpers.
            Func<int, int, string, ProcessRow> row = (pid, parent, name) => new ProcessRow { Pid = pid, ParentPid = parent, Name = name };
            var idle = new[] { row(10, 1, "node.exe"), row(11, 10, "cloudflared.exe"), row(12, 10, "conhost.exe"), row(20, 1, "claude.exe") };
            Check("helpers are not agents", !Agents.Running(idle, 10));
            Check("a child is an agent", Agents.Running(idle.Concat(new[] { row(13, 10, "cmd.exe") }), 10));
            Check("a grandchild is an agent", Agents.Running(idle.Concat(new[] { row(14, 12, "claude.exe") }), 10));

            // What Node and npm say about the network.
            Check("offline", Failures.Classify("npm error code ENOTFOUND") == NetworkTrouble.Offline);
            Check("restricted", Failures.Classify("npm error code SELF_SIGNED_CERT_IN_CHAIN") == NetworkTrouble.Restricted);
            Check("other failure", Failures.Classify("npm error code EBADENGINE") == NetworkTrouble.None);

            Check("path merge", PathList.Merge(@"C:\a;C:\b\", @"c:\B; C:\c", null) == @"C:\a;C:\b\;C:\c");
            Check("sha looks valid", Checksum.LooksValid(new string('a', 64)) && !Checksum.LooksValid("abc") && !Checksum.LooksValid(null));
            Check("short version", Versions.Short("0.1.1+202611181200") == "0.1.1");

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
            Check("connected colored", MenuModel.Icon(view) == TrayIcon.Color);
            view.Phase = Phase.Reconnecting;
            Check("reconnecting menu", ids() == "status,computer,-,open,disconnect,-,autostart,log,update,-,exit");
            Check("reconnecting grey", MenuModel.Icon(view) == TrayIcon.Grey && MenuModel.StatusLine(view) == "Reconnecting…");
            view.Phase = Phase.Approving;
            Check("approving menu", ids() == "status,computer,-,open-again,open,-,autostart,log,update,-,exit");
            Check("approving tooltip", MenuModel.Tooltip(view) == "Tinkjam Sync: Waiting for you to approve in your browser…");
            Check("approving asks for attention", MenuModel.Icon(view) == TrayIcon.Attention);
            view.Phase = Phase.Stopped;
            view.Detail = Words.SignInPageBlocked + " It tries again in 15 minutes, or choose Try again.";
            Check("stopped menu", ids().StartsWith("status,detail,detail,") && ids().EndsWith(",computer,-,retry,open,-,autostart,log,update,-,exit"));
            Check("stopped detail wraps", MenuModel.Items(view).Where(i => i.Id == "detail").All(i => i.Text.Length <= 48));
            Check("stopped status", MenuModel.StatusLine(view).StartsWith("Stopped: Another program"));
            Check("stopped asks for attention", MenuModel.Icon(view) == TrayIcon.Attention);
            Check("tooltip fits 63", MenuModel.Tooltip(view).Length <= 63);
            view.Phase = Phase.NotConnected;
            view.Detail = null;
            Check("not connected menu", ids() == "status,computer,-,open,connect,-,autostart,log,update,-,exit");
            view.Phase = Phase.SettingUp;
            view.Detail = "downloading";
            view.Percent = 37;
            Check("progress in words", MenuModel.StatusLine(view) == "Setting up… downloading (37%)");
            view.Percent = null;
            view.Phase = Phase.Connecting;
            view.Detail = "this is taking longer than usual; it keeps trying";
            Check("slow connecting says so", MenuModel.StatusLine(view) == "Connecting… this is taking longer than usual; it keeps trying");
            view.Busy = true;
            Check("busy disables disconnect", !MenuModel.Items(view).First(i => i.Id == "disconnect").Enabled);
            Check("version item", MenuModel.Items(view).First(i => i.Id == "update").Text == "Version 0.1.0 · Check for updates");
            view.UpdateVersion = "0.2.0";
            Check("update ready item", MenuModel.Items(view).First(i => i.Id == "update").Text == "Restart to update to version 0.2.0");
            view.CheckingForUpdates = true;
            Check("checking item", MenuModel.Items(view).First(i => i.Id == "update").Text == "Checking for updates…" && !MenuModel.Items(view).First(i => i.Id == "update").Enabled);
            Check("autostart checked", MenuModel.Items(view).First(i => i.Id == "autostart").Checked);
            Check("capitalized copes with nothing", Words.Capitalized("") == "" && Words.Capitalized(null) == "" && Words.Capitalized("ab") == "Ab");

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
            var parsedArgs = AppArgs.Parse(new[] { "/uninstall", "/SILENT", "--after-update", "--base-dir", @"C:\x" });
            Check("args", parsedArgs.Uninstall && parsedArgs.Silent && parsedArgs.AfterUpdate && parsedArgs.BaseDir == @"C:\x");

            // Release signatures: a vector from scripts/sign-release.ts with a throwaway test key.
            var testKeys = new Dictionary<string, string>
            {
                ["08b7216114b5e5ea"] = "RUNTMSAAAABzGR8OQYmSAU223Ty9t6pk4CwZ9lzzbo14lnSTJs3S+KxE4R6BP/G7p5bWppsqN17CfsHMpGziX1yMd9XhZD5z",
            };
            Func<Dictionary<string, object>> signed = () => new Dictionary<string, object>
            {
                ["kind"] = "windows",
                ["version"] = "0.1.2+202611200000",
                ["url"] = "https://trellium.org/downloads/TinkjamSyncSetup.exe?v=0.1.2%2B202611200000",
                ["sha256"] = string.Concat(Enumerable.Repeat("ab", 32)),
                ["keyId"] = "08b7216114b5e5ea",
                ["signature"] = "9ux4cvEM2s+3O/PBMtfl4/SdrWbV1/n27UnLMeWZrXHU5zX+AhN9zZOMeVA73nonUbkbffgNRx+jndyqIGEE1w==",
            };
            Check("signature verifies", ReleaseSignature.Verify("windows", signed(), testKeys));
            Check("signature null field is empty", ReleaseSignature.Verify("windows", With(signed(), "build", null), testKeys));
            Check("signature other kind refused", !ReleaseSignature.Verify("sync", signed(), testKeys));
            Check("signature tampered version refused", !ReleaseSignature.Verify("windows", With(signed(), "version", "0.1.3+202611200000"), testKeys));
            Check("signature tampered sha refused", !ReleaseSignature.Verify("windows", With(signed(), "sha256", new string('c', 64)), testKeys));
            Check("signature added field refused", !ReleaseSignature.Verify("windows", With(signed(), "minimumSystemVersion", "10"), testKeys));
            Check("signature missing refused", !ReleaseSignature.Verify("windows", With(signed(), "signature", null), testKeys));
            Check("signature garbage refused", !ReleaseSignature.Verify("windows", With(signed(), "signature", "nope"), testKeys));
            Check("signature unknown key refused", !ReleaseSignature.Verify("windows", With(signed(), "keyId", "ffffffffffffffff"), testKeys));
            Check("signature wrong key refused", !ReleaseSignature.Verify("windows", With(signed(), "keyId", "ef314cdf2274b761")));
            Check("signature line break refused", ReleaseSignature.Canonical("windows", With(signed(), "url", "https://x\nsha256=y")) == null);
            Check("release keys import", ReleaseSignature.PublicKeys.Count == 2 && ReleaseSignature.PublicKeys.Values.All(KeyImports));

            // The package archive and npm.
            Check("archive file", PackageArchive.SafeName("package/dist/bin.mjs") && PackageArchive.SafeName("package/"));
            Check("archive outside package", !PackageArchive.SafeName("other/x") && !PackageArchive.SafeName("/package/x"));
            Check("archive dot dot", !PackageArchive.SafeName("package/../x") && !PackageArchive.SafeName("package/a/../../x"));
            Check("archive drive or backslash", !PackageArchive.SafeName("package/C:x") && !PackageArchive.SafeName("package\\..\\x"));
            Check("archive plain", PackageArchive.PlainEntry("-rw-r--r--  0 0      0         123 Nov 19 18:55 package/x") && PackageArchive.PlainEntry("drwxr-xr-x  0 0      0           0 Nov 19 18:55 package/"));
            Check("archive links", !PackageArchive.PlainEntry("lrwxr-xr-x  0 0 0 0 Nov 19 18:55 package/x -> /etc") && !PackageArchive.PlainEntry("-rw-r--r--  0 0 0 0 Nov 19 18:55 package/x link to package/y") && !PackageArchive.PlainEntry("hrw-r--r-- package/x"));
            Check("archive listing", PackageArchive.SafeListing(new[] { "package/", "package/a" }, new[] { "d", "-" }) && !PackageArchive.SafeListing(new[] { "package/a" }, new[] { "-", "-" }) && !PackageArchive.SafeListing(new string[0], new string[0]));
            Check("npm ci", string.Join(" ", NpmCommands.Ci("npm.js", @"C:\s\node_modules\tinkjam-sync", @"C:\c")) == @"npm.js ci --prefix C:\s\node_modules\tinkjam-sync --omit=dev --ignore-scripts --no-audit --no-fund --loglevel=error --cache C:\c");
            Check("npm rebuild", string.Join(" ", NpmCommands.Rebuild("npm.js", "p", "c")) == "npm.js rebuild koffi node-pty --prefix p --loglevel=error --cache c");
            Check("package layout", Home.LauncherIn(@"C:\a") == @"C:\a\node_modules\tinkjam-sync\bin\tinkjam-sync.mjs" && defaults.ServerEntry == Path.Combine(defaults.AppDir, @"node_modules\tinkjam-sync\dist\bin.mjs"));

            // The setup window's words.
            Check("problem drops retry soon", Words.Problem(Words.Offline + Words.RetriesSoon) == Words.Offline);
            Check("problem drops retry later", Words.Problem(Words.KeepsStopping + Words.RetriesLater) == Words.KeepsStopping);
            Check("problem without detail", Words.Problem(null) == Words.Unexpected);
            Check("found one", Words.Found(new[] { "Claude" }) == "Found Claude");
            Check("found two", Words.Found(new[] { "Claude", "Codex" }, " on this PC") == "Found Claude and Codex on this PC");
            Check("found three", Words.Found(new[] { "Claude", "Codex", "Cursor" }) == "Found Claude, Codex and Cursor");
            Check("found none", Words.Found(new string[0]) == null && Words.Found(null) == null);

            // Install steps: the runtime, then Tinkjam Sync, then the account.
            var setup = new AppView { Phase = Phase.SettingUp };
            Check("step 1 at start", InstallSteps.Of(setup) == 1 && InstallSteps.Caption(setup) == "Getting ready" && InstallSteps.Done(setup) == 0);
            setup.Detail = "downloading";
            setup.Percent = 50;
            Check("step 1 download", InstallSteps.Of(setup) == 1 && InstallSteps.Caption(setup) == "Downloading (50%)" && Math.Abs(InstallSteps.Done(setup) - 1 / 6.0) < 1e-9);
            setup.Detail = "downloading Tinkjam Sync";
            setup.Percent = 100;
            Check("step 2 download", InstallSteps.Of(setup) == 2 && Math.Abs(InstallSteps.Done(setup) - 2 / 3.0) < 1e-9);
            setup.Percent = null;
            setup.Detail = "installing (this can take a few minutes)";
            Check("step 2 install", InstallSteps.Of(setup) == 2 && Math.Abs(InstallSteps.Done(setup) - 1 / 3.0) < 1e-9);
            Check("percent clamped", InstallSteps.Done(new AppView { Phase = Phase.SettingUp, Detail = "unpacking", Percent = 250 }) <= 1 / 3.0 + 1e-9);
            Check("step 3 connecting", InstallSteps.Of(new AppView { Phase = Phase.Approving }) == 3);

            // The panel's words.
            var panelView = new AppView { Phase = Phase.Connected };
            Check("panel connected", PanelModel.Status(panelView) == "Connected" && PanelModel.StatusTone(panelView) == Tone.Good && PanelModel.Notice(panelView) == null);
            panelView.Phase = Phase.Stopped;
            panelView.Detail = Words.Offline + Words.RetriesSoon;
            Check("panel stopped", PanelModel.StatusTone(panelView) == Tone.Attention && PanelModel.Notice(panelView) == Words.Offline);
            panelView.Phase = Phase.Approving;
            panelView.Detail = null;
            Check("panel approving", PanelModel.Status(panelView) == "Not connected" && PanelModel.Notice(panelView) == MenuModel.Title(panelView));
            panelView.Phase = Phase.Connecting;
            panelView.Detail = "restarting in 4 seconds";
            Check("panel connecting detail", PanelModel.Notice(panelView) == "Restarting in 4 seconds.");
            Check("update unknown", PanelModel.UpdateText(panelView) == "Check for updates");
            panelView.UpToDate = true;
            Check("update up to date", PanelModel.UpdateText(panelView) == "Up to date");
            panelView.UpdateVersion = "0.2.0";
            Check("update ready", PanelModel.UpdateText(panelView) == "Restart to update");
            panelView.CheckingForUpdates = true;
            Check("update checking", PanelModel.UpdateText(panelView) == "Checking for updates…");

            // Agents: found by their command on PATH, working by their executable under Sync.
            var onDisk = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { @"C:\npm\codex.cmd", @"C:\Users\x\.local\bin\claude.exe", @"C:\tools\grok" };
            var found = AgentCatalog.Installed(new[] { @"C:\Users\x\.local\bin", " ", @"""C:\npm""", @"C:\tools" }, new[] { ".EXE", ".CMD" }, onDisk.Contains);
            Check("agents found in catalogue order", string.Join(",", found.Select(a => a.Id)) == "claude,codex");
            Check("agents none", AgentCatalog.Installed(new[] { @"C:\x" }, new[] { ".exe" }, _ => false).Count == 0);
            Check("agents path errors ignored", AgentCatalog.Installed(new[] { "bad|dir" }, new[] { ".exe" }, _ => throw new ArgumentException()).Count == 0);
            var tree = new[] { row(10, 1, "node.exe"), row(11, 10, "cmd.exe"), row(12, 11, "Codex.exe"), row(13, 10, "cloudflared.exe"), row(20, 1, "claude.exe") };
            var busy = AgentCatalog.Working(tree, 10);
            Check("working under sync only", busy.SetEquals(new[] { "codex" }));
            Check("working none", AgentCatalog.Working(tree, 99).Count == 0);

            // Theme: AppsUseLightTheme 0 is dark; anything missing is light.
            Check("theme dark", ThemeSetting.IsDark(0) && ThemeSetting.IsDark(0L) && ThemeSetting.IsDark("0") && ThemeSetting.IsDark(new byte[] { 0, 0, 0, 0 }));
            Check("theme light", !ThemeSetting.IsDark(1) && !ThemeSetting.IsDark(null) && !ThemeSetting.IsDark("yes") && !ThemeSetting.IsDark(new byte[] { 1, 0, 0, 0 }));

            // The panel's place: over the icon, beside the taskbar on each edge, inside the work area.
            var screen = new System.Drawing.Rectangle(0, 0, 1920, 1080);
            var panelSize = new System.Drawing.Size(340, 500);
            var bottomWork = new System.Drawing.Rectangle(0, 0, 1920, 1032);
            Check("edge bottom", Placement.TaskbarEdge(screen, bottomWork, Edge.Top) == Edge.Bottom);
            Check("place bottom, clamped right", Placement.Panel(bottomWork, Edge.Bottom, new System.Drawing.Point(1850, 1056), panelSize, 12) == new System.Drawing.Point(1568, 520));
            Check("place bottom, centred on icon", Placement.Panel(bottomWork, Edge.Bottom, new System.Drawing.Point(900, 1056), panelSize, 12) == new System.Drawing.Point(730, 520));
            var topWork = new System.Drawing.Rectangle(0, 48, 1920, 1032);
            Check("edge top", Placement.TaskbarEdge(screen, topWork, Edge.Bottom) == Edge.Top);
            Check("place top", Placement.Panel(topWork, Edge.Top, new System.Drawing.Point(1850, 24), panelSize, 12) == new System.Drawing.Point(1568, 60));
            var leftWork = new System.Drawing.Rectangle(62, 0, 1858, 1080);
            Check("edge left", Placement.TaskbarEdge(screen, leftWork, Edge.Bottom) == Edge.Left);
            Check("place left, clamped low", Placement.Panel(leftWork, Edge.Left, new System.Drawing.Point(30, 1040), panelSize, 12) == new System.Drawing.Point(74, 568));
            var rightWork = new System.Drawing.Rectangle(0, 0, 1858, 1080);
            Check("edge right", Placement.TaskbarEdge(screen, rightWork, Edge.Bottom) == Edge.Right);
            Check("place right", Placement.Panel(rightWork, Edge.Right, new System.Drawing.Point(1890, 300), panelSize, 12) == new System.Drawing.Point(1506, 50));
            Check("edge auto-hide falls back", Placement.TaskbarEdge(screen, screen, Edge.Left) == Edge.Left);
            // 150% on a second screen to the left, in its own (negative) coordinates: 340x500 is 510x750 there.
            var second = new System.Drawing.Rectangle(-2560, 0, 2560, 1440);
            var secondWork = new System.Drawing.Rectangle(-2560, 0, 2560, 1368);
            Check("place 150% second screen", Placement.Panel(secondWork, Placement.TaskbarEdge(second, secondWork, Edge.Top), new System.Drawing.Point(-60, 1404), new System.Drawing.Size(510, 750), 18) == new System.Drawing.Point(-528, 600));
            Check("place panel taller than screen stays on it", Placement.Panel(bottomWork, Edge.Bottom, new System.Drawing.Point(1850, 1056), new System.Drawing.Size(340, 2000), 12).Y == 12);

            Console.WriteLine("self-test: " + passed + " passed, " + failed + " failed");
            return failed == 0 ? 0 : 1;
        }
    }
}
