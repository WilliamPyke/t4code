using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Threading;
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
            try
            {
                if (!Instance.RequestQuit(home, TimeSpan.FromSeconds(30)))
                    throw new IOException("the running Tinkjam Sync did not close.");
                Directory.CreateDirectory(home.InstallDir);
                if (!Home.SamePath(self, home.InstalledExe))
                {
                    var staged = home.InstalledExe + ".new";
                    File.Copy(self, staged, true);
                    Retrying(() =>
                    {
                        if (File.Exists(home.InstalledExe)) File.Delete(home.InstalledExe);
                        File.Move(staged, home.InstalledExe);
                    });
                }
                var launchArgs = CommandLine.Join(home.PassThrough());
                CreateShortcut(home.ShortcutPath, home.InstalledExe, launchArgs);
                WriteUninstallEntry(home);
                Log.App("Installed Tinkjam Sync " + AppInfo.Version + " in " + home.InstallDir);
                Launch(home.InstalledExe, launchArgs);
                return 0;
            }
            catch (Exception error)
            {
                Log.App("Install failed: " + error);
                if (!args.Silent)
                    MessageBox.Show("Tinkjam Sync could not be installed: " + error.Message, "Tinkjam Sync", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return 1;
            }
        }

        public static int Uninstall(Home home, AppArgs args)
        {
            Log.Init(home);
            Instance.RequestQuit(home, TimeSpan.FromSeconds(30));
            RunKey.Remove(home.RunValueName);

            var node = FindNode(home);
            var connected = node != null && File.Exists(home.ServerEntry);
            if (connected && !args.Silent)
            {
                var answer = MessageBox.Show(
                    "Tinkjam Sync is being removed from this computer.\n\nAlso disconnect this computer from your Tinkjam account?",
                    "Tinkjam Sync", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
                if (answer == DialogResult.Yes) Disconnect(home, node);
            }

            TryDelete(home.ShortcutPath);
            using (var root = Registry.CurrentUser.OpenSubKey(UninstallRoot, true))
                root?.DeleteSubKeyTree(home.UninstallKeyName, false);
            // What the app downloaded goes; the account connection and the log stay for a reinstall.
            foreach (var dir in new[] { home.AppDir, home.RuntimeDir }) TryDeleteDir(dir);
            TryDelete(home.SettingsPath);
            TryDelete(home.TrayStatePath);
            Log.App("Uninstalled Tinkjam Sync");

            var self = Application.ExecutablePath;
            if (Home.SamePath(Path.GetDirectoryName(self), home.InstallDir))
            {
                // A running exe cannot delete itself; a hidden cmd removes the folder once this exits.
                var command = "/c ping -n 3 127.0.0.1 >nul & rd /s /q " + CommandLine.Quote(home.InstallDir);
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
            if (!args.Silent)
                MessageBox.Show("Tinkjam Sync was removed.", "Tinkjam Sync", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        /// <summary>
        /// Starts the installed app as the desktop's own child, through the running Explorer, so an
        /// installer run from an agent's terminal never leaves Sync inside that terminal's process tree.
        /// Explorer passes no arguments, so a test home (which needs them) starts directly.
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
            var info = new ProcessStartInfo(node, CommandLine.Join(new[] { home.ServerEntry, "sync", "--disconnect", "--base-dir", home.BaseDir }))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                WorkingDirectory = home.BaseDir,
            };
            info.EnvironmentVariables["T3CODE_HOME"] = home.BaseDir;
            info.EnvironmentVariables["T3CODE_HOSTED_APP_URL"] = SyncEngine.AppUrl;
            info.EnvironmentVariables["TINKJAM_SYNC_URL"] = SyncEngine.SyncUrl;
            using (var process = Process.Start(info))
            {
                if (!process.WaitForExit(60_000)) process.Kill();
                Log.App("Disconnect on uninstall ended with exit code " + process.ExitCode);
            }
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
                key.SetValue("DisplayVersion", AppInfo.Version);
                key.SetValue("Publisher", "Tinkjam");
                key.SetValue("DisplayIcon", home.InstalledExe + ",0");
                key.SetValue("InstallLocation", home.InstallDir);
                key.SetValue("UninstallString", CommandLine.Join(uninstall));
                key.SetValue("QuietUninstallString", CommandLine.Join(quiet));
                key.SetValue("URLInfoAbout", "https://trellium.org");
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
