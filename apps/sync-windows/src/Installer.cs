using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;

namespace TinkjamSync
{
    /// <summary>
    /// The same exe installs itself: per user, no administrator, into %LocalAppData%\Programs\Tinkjam Sync,
    /// with a Start menu shortcut and an entry in Apps (HKCU), then starts the installed copy.
    /// </summary>
    public static class Installer
    {
        const string UninstallRoot = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\";

        /// <summary>Started as the downloaded installer rather than the installed app.</summary>
        public static bool LooksLikeSetup() =>
            Path.GetFileName(Application.ExecutablePath).IndexOf("setup", StringComparison.OrdinalIgnoreCase) >= 0;

        public static int Install(Home home, AppArgs args)
        {
            Log.Init(home);
            var self = Application.ExecutablePath;
            var launch = home.PassThrough();
            // After an update nobody is waiting to connect: the new copy starts as it does at log-in.
            if (args.AfterUpdate) launch.Add("--autostart");
            var launchArgs = CommandLine.Join(launch);
            try
            {
                if (!Instance.RequestQuit(home, TimeSpan.FromSeconds(30)))
                    throw new IOException("the running Tinkjam Sync did not close.");
                Directory.CreateDirectory(home.InstallDir);
                if (!Home.SamePath(self, home.InstalledExe)) Replace(self, home.InstalledExe);
                Native.RemoveDownloadMark(home.InstalledExe);
                CreateShortcut(home.ShortcutPath, home.InstalledExe, CommandLine.Join(home.PassThrough()));
                WriteUninstallEntry(home);
                Log.App("Installed Tinkjam Sync " + AppInfo.Version + " in " + home.InstallDir);
                Launch(home.InstalledExe, launchArgs);
                return 0;
            }
            catch (Exception error)
            {
                Log.App("Install failed: " + error);
                // The copy that was installed before still works: an update that fails must not leave nothing running.
                try
                {
                    if (File.Exists(home.InstalledExe) && !Instance.Running(home)) Launch(home.InstalledExe, launchArgs);
                }
                catch (Exception relaunch) { Log.App("Couldn't start the installed copy again: " + relaunch.Message); }
                if (!args.Silent)
                    MessageBox.Show(
                        "Tinkjam Sync couldn't be installed on this computer.\n\nRestart your computer, then open the installer again. If your computer is managed by your workplace, it may not allow new apps: ask whoever looks after it.",
                        "Tinkjam Sync", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        /// <summary>Puts `source` at `target`, keeping the old file until the new one is in place.</summary>
        static void Replace(string source, string target)
        {
            var staged = target + ".new";
            var old = target + ".old";
            File.Copy(source, staged, true);
            Retrying(() => { if (File.Exists(old)) File.Delete(old); });
            var hadOld = File.Exists(target);
            if (hadOld) Retrying(() => File.Move(target, old));
            try
            {
                Retrying(() => File.Move(staged, target));
            }
            catch (Exception)
            {
                if (hadOld && !File.Exists(target)) File.Move(old, target);
                TryDelete(staged);
                throw;
            }
            TryDelete(old);
        }

        public static int Uninstall(Home home, AppArgs args)
        {
            Log.Init(home);
            var node = FindNode(home);
            var connected = node != null && File.Exists(home.ServerEntry);
            var disconnect = false;
            if (connected && !args.Silent)
            {
                var answer = MessageBox.Show(
                    "Tinkjam Sync is being removed from this computer.\n\nAlso disconnect this computer from your Tinkjam account, so your boards no longer list it?\n\nChoose No only if you are about to install Tinkjam Sync again.",
                    "Tinkjam Sync", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button1);
                disconnect = answer == DialogResult.Yes;
            }

            Action work = () =>
            {
                Instance.RequestQuit(home, TimeSpan.FromSeconds(30));
                RunKey.Remove(home.RunValueName);
                if (disconnect) Disconnect(home, node);
                TryDelete(home.ShortcutPath);
                using (var root = Registry.CurrentUser.OpenSubKey(UninstallRoot, true))
                    root?.DeleteSubKeyTree(home.UninstallKeyName, false);
                // What the app downloaded goes; the log stays, and the account connection unless it was just removed.
                foreach (var dir in new[] { home.AppDir, home.RuntimeDir }) TryDeleteDir(dir);
                TryDelete(home.SettingsPath);
                TryDelete(home.TrayStatePath);
                Log.App("Uninstalled Tinkjam Sync");
            };
            if (args.Silent) work();
            else WithProgress(disconnect ? "Disconnecting and removing Tinkjam Sync…" : "Removing Tinkjam Sync…", work);

            if (!args.Silent)
                MessageBox.Show("Tinkjam Sync was removed.", "Tinkjam Sync", MessageBoxButtons.OK, MessageBoxIcon.Information);

            var self = Application.ExecutablePath;
            if (Home.SamePath(Path.GetDirectoryName(self), home.InstallDir))
            {
                // A running exe cannot delete itself; a hidden cmd keeps trying for a minute after this exits.
                var folder = "\"" + home.InstallDir.TrimEnd('\\') + "\"";
                var command = "/c for /l %i in (1,1,30) do (if exist " + folder + " (rd /s /q " + folder + " 2>nul & ping -n 3 127.0.0.1 >nul))";
                Process.Start(new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "cmd.exe"), command)
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = Path.GetTempPath(),
                });
            }
            else
            {
                TryDeleteDir(home.InstallDir);
            }
            return 0;
        }

        /// <summary>A small window that says what is happening while `work` runs off the UI thread.</summary>
        static void WithProgress(string text, Action work)
        {
            using (var form = new Form())
            {
                var scale = form.DeviceDpi / 96f;
                Func<int, int> px = value => (int)Math.Round(value * scale);
                form.Text = "Tinkjam Sync";
                form.FormBorderStyle = FormBorderStyle.FixedDialog;
                form.ControlBox = false;
                form.StartPosition = FormStartPosition.CenterScreen;
                form.AutoScaleMode = AutoScaleMode.None;
                form.Font = SystemFonts.MessageBoxFont;
                form.AutoSize = true;
                form.AutoSizeMode = AutoSizeMode.GrowAndShrink;
                var layout = new TableLayoutPanel
                {
                    ColumnCount = 1,
                    AutoSize = true,
                    AutoSizeMode = AutoSizeMode.GrowAndShrink,
                    Padding = new Padding(px(20), px(16), px(20), px(18)),
                };
                layout.Controls.Add(new Label { Text = text, AutoSize = true, MaximumSize = new Size(px(360), 0), Margin = new Padding(0, 0, 0, px(12)) });
                layout.Controls.Add(new ProgressBar { Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 40, Size = new Size(px(360), px(8)), Margin = new Padding(0) });
                form.Controls.Add(layout);
                form.Shown += (s, e) => Task.Run(() =>
                {
                    try { work(); }
                    catch (Exception error) { Log.App("Uninstall step failed: " + error); }
                    try { form.BeginInvoke((Action)form.Close); } catch (Exception) { }
                });
                form.ShowDialog();
            }
        }

        /// <summary>
        /// Starts the installed app as the desktop's own child, through the running Explorer, so an
        /// installer run from an agent's terminal never leaves Sync inside that terminal's process tree.
        /// Explorer passes no arguments, so a copy that needs them starts directly.
        /// </summary>
        static void Launch(string exe, string arguments)
        {
            var session = Process.GetCurrentProcess().SessionId;
            var shell = arguments.Length == 0 && Array.Exists(Process.GetProcessesByName("explorer"), p => p.SessionId == session);
            Process.Start(shell
                ? new ProcessStartInfo(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Windows), "explorer.exe"), CommandLine.Quote(exe)) { UseShellExecute = false }
                : new ProcessStartInfo(exe, arguments) { UseShellExecute = false, WorkingDirectory = Path.GetDirectoryName(exe) });
        }

        static string FindNode(Home home)
        {
            if (!Directory.Exists(home.RuntimeDir)) return null;
            foreach (var dir in Directory.GetDirectories(home.RuntimeDir, "node-v*"))
            {
                var node = Path.Combine(dir, "node.exe");
                if (File.Exists(node)) return node;
            }
            return null;
        }

        static void Disconnect(Home home, string node)
        {
            try
            {
                var info = new ProcessStartInfo(node, CommandLine.Join(new[] { home.ServerEntry, "sync", "--disconnect", "--base-dir", home.BaseDir }))
                {
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WorkingDirectory = home.BaseDir,
                };
                info.EnvironmentVariables["T3CODE_HOME"] = home.BaseDir;
                info.EnvironmentVariables["T3CODE_HOSTED_APP_URL"] = SyncEngine.AppUrl;
                info.EnvironmentVariables["TINKJAM_SYNC_URL"] = SyncEngine.SyncUrl;
                info.EnvironmentVariables["TINKJAM_SYNC_FROM_APP"] = "1";
                if (NodeEnv.MayUseSystemCa(Environment.GetEnvironmentVariable("NODE_OPTIONS"))) info.EnvironmentVariables["NODE_USE_SYSTEM_CA"] = "1";
                using (var process = Process.Start(info))
                {
                    if (!process.WaitForExit(60_000)) process.Kill();
                    process.WaitForExit(5000);
                    Log.App("Disconnect on uninstall ended" + (process.HasExited ? " with exit code " + process.ExitCode : " late"));
                }
            }
            catch (Exception error) { Log.App("Couldn't disconnect on uninstall: " + error.Message); }
        }

        static void WriteUninstallEntry(Home home)
        {
            var passThrough = home.PassThrough();
            var uninstall = new List<string> { home.InstalledExe, "/uninstall" };
            uninstall.AddRange(passThrough);
            var quiet = new List<string>(uninstall) { "/silent" };
            using (var key = Registry.CurrentUser.CreateSubKey(UninstallRoot + home.UninstallKeyName))
            {
                key.SetValue("DisplayName", home.Suffix == "" ? "Tinkjam Sync" : "Tinkjam Sync (" + home.Suffix + ")");
                key.SetValue("DisplayVersion", AppInfo.ShortVersion);
                key.SetValue("Publisher", "Tinkjam");
                key.SetValue("DisplayIcon", home.InstalledExe + ",0");
                key.SetValue("InstallLocation", home.InstallDir);
                key.SetValue("UninstallString", CommandLine.Join(uninstall));
                key.SetValue("QuietUninstallString", CommandLine.Join(quiet));
                key.SetValue("URLInfoAbout", "https://tinkjam.com");
                key.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
                key.SetValue("EstimatedSize", (int)Math.Max(1, new FileInfo(home.InstalledExe).Length / 1024), RegistryValueKind.DWord);
                key.SetValue("NoModify", 1, RegistryValueKind.DWord);
                key.SetValue("NoRepair", 1, RegistryValueKind.DWord);
            }
        }

        static void CreateShortcut(string path, string target, string arguments)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var shellType = Type.GetTypeFromProgID("WScript.Shell");
            dynamic shell = Activator.CreateInstance(shellType);
            try
            {
                dynamic shortcut = shell.CreateShortcut(path);
                shortcut.TargetPath = target;
                shortcut.Arguments = arguments;
                shortcut.WorkingDirectory = Path.GetDirectoryName(target);
                shortcut.IconLocation = target + ",0";
                shortcut.Description = "Connects this computer's agents to Tinkjam";
                shortcut.Save();
            }
            finally
            {
                System.Runtime.InteropServices.Marshal.FinalReleaseComObject(shell);
            }
        }

        static void Retrying(Action action)
        {
            for (var attempt = 0; ; attempt++)
            {
                try { action(); return; }
                catch (Exception error) when ((error is IOException || error is UnauthorizedAccessException) && attempt < 20)
                {
                    Thread.Sleep(500);
                }
            }
        }

        static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch (Exception) { }
        }

        static void TryDeleteDir(string path)
        {
            try
            {
                if (!Directory.Exists(path)) return;
                foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
                    File.SetAttributes(file, FileAttributes.Normal);
                Directory.Delete(path, true);
            }
            catch (Exception error) { Log.App("Couldn't remove " + path + ": " + error.Message); }
        }
    }
}
