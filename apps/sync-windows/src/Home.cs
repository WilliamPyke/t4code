using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace TinkjamSync
{
    public sealed class AppArgs
    {
        public bool Install, Uninstall, Silent, Autostart, AfterUpdate, DumpState, SelfTest, PrintVersion, Quit;
        public string BaseDir, InstallDir;
        /// <summary>--preview-ui: shows the window and the panel for one state, and does nothing else.</summary>
        public bool PreviewUi, PreviewSettings, PreviewInstalled;
        public string PreviewPhase, PreviewDetail, PreviewUpdate, PreviewTheme, PreviewShot;
        public int? PreviewPercent;
        public int PreviewTabs;
        public float? PreviewScale;

        public static AppArgs Parse(string[] argv)
        {
            var args = new AppArgs();
            for (var i = 0; i < argv.Length; i++)
            {
                var arg = argv[i];
                var flag = arg.StartsWith("/") ? "--" + arg.Substring(1) : arg;
                switch (flag.ToLowerInvariant())
                {
                    case "--install": args.Install = true; break;
                    case "--uninstall": args.Uninstall = true; break;
                    case "--silent": case "--s": case "--quiet": args.Silent = true; break;
                    case "--autostart": args.Autostart = true; break;
                    case "--after-update": args.AfterUpdate = true; break;
                    case "--dump-state": args.DumpState = true; break;
                    case "--self-test": args.SelfTest = true; break;
                    case "--version": args.PrintVersion = true; break;
                    case "--quit": args.Quit = true; break;
                    case "--base-dir": if (i + 1 < argv.Length) args.BaseDir = argv[++i]; break;
                    case "--install-dir": if (i + 1 < argv.Length) args.InstallDir = argv[++i]; break;
                    case "--preview-ui": args.PreviewUi = true; break;
                    case "--preview-settings": args.PreviewSettings = true; break;
                    case "--preview-installed": args.PreviewInstalled = true; break;
                    case "--preview-phase": if (i + 1 < argv.Length) args.PreviewPhase = argv[++i]; break;
                    case "--preview-detail": if (i + 1 < argv.Length) args.PreviewDetail = argv[++i]; break;
                    case "--preview-update": if (i + 1 < argv.Length) args.PreviewUpdate = argv[++i]; break;
                    case "--preview-theme": if (i + 1 < argv.Length) args.PreviewTheme = argv[++i]; break;
                    case "--preview-shot": if (i + 1 < argv.Length) args.PreviewShot = argv[++i]; break;
                    case "--preview-percent": if (i + 1 < argv.Length && int.TryParse(argv[++i], out var percent)) args.PreviewPercent = percent; break;
                    case "--preview-tabs": if (i + 1 < argv.Length && int.TryParse(argv[++i], out var tabs)) args.PreviewTabs = tabs; break;
                    case "--preview-scale":
                        if (i + 1 < argv.Length && float.TryParse(argv[++i], System.Globalization.NumberStyles.Float, System.Globalization.CultureInfo.InvariantCulture, out var scale) && scale >= 1 && scale <= 4)
                            args.PreviewScale = scale;
                        break;
                }
            }
            return args;
        }
    }

    /// <summary>
    /// Where this copy keeps everything, and the names it registers. A home other than the default
    /// (--base-dir or TINKJAM_SYNC_HOME) gets its own names, so a test never touches the real ones.
    /// </summary>
    public sealed class Home
    {
        public const string DefaultRunValue = "TinkjamSync";
        public string BaseDir, InstallDir, Suffix;
        public bool IsDefault, IsDefaultInstallDir;

        public static string DefaultBaseDir() =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".tinkjam");

        public static string DefaultInstallDir() =>
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "Tinkjam Sync");

        public static Home Resolve(AppArgs args)
        {
            var chosen = args.BaseDir;
            if (string.IsNullOrWhiteSpace(chosen)) chosen = Environment.GetEnvironmentVariable("TINKJAM_SYNC_HOME");
            if (string.IsNullOrWhiteSpace(chosen)) chosen = DefaultBaseDir();
            var baseDir = Path.GetFullPath(chosen.Trim());
            var isDefault = SamePath(baseDir, DefaultBaseDir());
            var installDir = string.IsNullOrWhiteSpace(args.InstallDir) ? DefaultInstallDir() : Path.GetFullPath(args.InstallDir.Trim());
            return new Home
            {
                BaseDir = baseDir,
                IsDefault = isDefault,
                Suffix = isDefault ? "" : Names.HomeSuffix(baseDir),
                InstallDir = installDir,
                IsDefaultInstallDir = SamePath(installDir, DefaultInstallDir()),
            };
        }

        public static bool SamePath(string a, string b) =>
            string.Equals(Path.GetFullPath(a).TrimEnd('\\'), Path.GetFullPath(b).TrimEnd('\\'), StringComparison.OrdinalIgnoreCase);

        string Tagged(string name, string separator) => Suffix == "" ? name : name + separator + Suffix;

        // Never "Tinkjam Sync": the package's --uninstall treats that Run value name as its own.
        public string RunValueName => Suffix == "" ? DefaultRunValue : DefaultRunValue + " (" + Suffix + ")";
        public string UninstallKeyName => Tagged("TinkjamSync", "-");
        public string MutexName => @"Local\" + Tagged("TinkjamSync", ".");
        public string EventName(string kind) => MutexName + "." + kind;
        public string ShortcutPath => Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.Programs),
            Suffix == "" ? "Tinkjam Sync.lnk" : "Tinkjam Sync (" + Suffix + ").lnk");

        /// <summary>The Run value the npx-installed Sync made (service.ts serviceNames).</summary>
        public string PackageRunValueName => Suffix == "" ? "Tinkjam Sync" : "Tinkjam Sync (" + Suffix + ")";

        public string InstalledExe => Path.Combine(InstallDir, "TinkjamSync.exe");
        public string LogPath => Path.Combine(BaseDir, "logs", "sync.log");
        public string TrayStatePath => Path.Combine(BaseDir, "logs", "tray-state.txt");
        public string StatusPath => Path.Combine(BaseDir, "userdata", "sync-status.json");
        public string RuntimeDir => Path.Combine(BaseDir, "runtime");
        public string StagingDir => Path.Combine(RuntimeDir, "sync-staging");
        public string UpdateDir => Path.Combine(RuntimeDir, "update");
        public string AppDir => Path.Combine(BaseDir, "app");
        public string ServerEntry => Path.Combine(PackageIn(AppDir), "dist", "bin.mjs");
        /// <summary>The package, with its own dependencies in its node_modules.</summary>
        public static string PackageIn(string appDir) => Path.Combine(appDir, "node_modules", "tinkjam-sync");
        public static string LauncherIn(string appDir) => Path.Combine(PackageIn(appDir), "bin", "tinkjam-sync.mjs");
        public string SettingsPath => Path.Combine(BaseDir, "sync-app.json");

        /// <summary>Arguments that keep a relaunched copy on this same home and install folder.</summary>
        public List<string> PassThrough()
        {
            var args = new List<string>();
            if (!IsDefault) { args.Add("--base-dir"); args.Add(BaseDir); }
            if (!IsDefaultInstallDir) { args.Add("--install-dir"); args.Add(InstallDir); }
            return args;
        }
    }

    public sealed class Settings
    {
        public bool StartWithWindows = true;
        /// <summary>The person chose Disconnect: nothing connects again until they choose Connect.</summary>
        public bool Disconnected;
        /// <summary>The app version this copy already tried to update to by itself.</summary>
        public string UpdateAttempted;
        public string SyncVersion;
        readonly string path;

        Settings(string path) { this.path = path; }

        public static Settings Load(Home home)
        {
            var settings = new Settings(home.SettingsPath);
            try
            {
                var value = Json.Parse(File.ReadAllText(home.SettingsPath));
                if (value != null && value.TryGetValue("startWithWindows", out var start) && start is bool b) settings.StartWithWindows = b;
                if (value != null && value.TryGetValue("disconnected", out var off) && off is bool d) settings.Disconnected = d;
                settings.SyncVersion = Json.Text(value, "syncVersion");
                settings.UpdateAttempted = Json.Text(value, "updateAttempted");
            }
            catch (Exception) { }
            return settings;
        }

        public void Save()
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllText(path, Json.Write(new Dictionary<string, object>
            {
                ["startWithWindows"] = StartWithWindows,
                ["disconnected"] = Disconnected,
                ["updateAttempted"] = UpdateAttempted,
                ["syncVersion"] = SyncVersion,
            }));
        }
    }

    public static class EnvPath
    {
        const string MachineKey = @"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

        /// <summary>
        /// PATH as a program started now would get it. This app's own copy dates from log-in, so an
        /// agent installed since then is only on the registry's.
        /// </summary>
        public static string Current()
        {
            string machine = null, user = null;
            try
            {
                using (var key = Registry.LocalMachine.OpenSubKey(MachineKey)) machine = key?.GetValue("Path") as string;
                using (var key = Registry.CurrentUser.OpenSubKey("Environment")) user = key?.GetValue("Path") as string;
            }
            catch (Exception) { }
            return PathList.Merge(machine, user, Environment.GetEnvironmentVariable("PATH"));
        }
    }

    public static class RunKey
    {
        const string Key = @"Software\Microsoft\Windows\CurrentVersion\Run";

        public static string Get(string name)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(Key)) return key?.GetValue(name) as string;
        }

        public static void Set(string name, string command)
        {
            using (var key = Registry.CurrentUser.CreateSubKey(Key)) key.SetValue(name, command, RegistryValueKind.String);
        }

        public static void Remove(string name)
        {
            using (var key = Registry.CurrentUser.OpenSubKey(Key, true)) key?.DeleteValue(name, false);
        }
    }

    /// <summary>The app's own lines go into Sync's log, so "Show log" tells the whole story.</summary>
    public static class Log
    {
        static readonly object Gate = new object();
        static string path;

        public static void Init(Home home)
        {
            path = home.LogPath;
            try { Directory.CreateDirectory(Path.GetDirectoryName(path)); } catch (Exception) { }
        }

        public static void App(string message) => Write("[app] " + message);
        public static void Sync(string line) => Write("[sync] " + line);

        static void Write(string line)
        {
            if (path == null) return;
            lock (Gate)
            {
                try
                {
                    // Sync appends to the same file, and renames it when it grows; share everything.
                    using (var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete))
                    {
                        var bytes = Encoding.UTF8.GetBytes("[" + DateTime.UtcNow.ToString("yyyy-MM-ddTHH:mm:ss.fffZ") + "] " + line + "\n");
                        stream.Write(bytes, 0, bytes.Length);
                    }
                }
                catch (Exception) { }
            }
        }

        public static string Tail(string logPath, int maxBytes = 8192)
        {
            try
            {
                using (var stream = new FileStream(logPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
                {
                    var start = Math.Max(0, stream.Length - maxBytes);
                    stream.Seek(start, SeekOrigin.Begin);
                    var buffer = new byte[stream.Length - start];
                    var read = stream.Read(buffer, 0, buffer.Length);
                    return Encoding.UTF8.GetString(buffer, 0, read);
                }
            }
            catch (Exception) { return ""; }
        }
    }

    /// <summary>One copy per home: the first holds a mutex; later launches signal it by named events.</summary>
    public static class Instance
    {
        public static bool Signal(Home home, string kind)
        {
            if (!EventWaitHandle.TryOpenExisting(home.EventName(kind), out var handle)) return false;
            using (handle) handle.Set();
            return true;
        }

        public static bool Running(Home home)
        {
            if (!Mutex.TryOpenExisting(home.MutexName, out var mutex)) return false;
            mutex.Dispose();
            return true;
        }

        public static EventWaitHandle Listen(Home home, string kind, Action onSignal)
        {
            var handle = new EventWaitHandle(false, EventResetMode.AutoReset, home.EventName(kind));
            ThreadPool.RegisterWaitForSingleObject(handle, (state, timedOut) => onSignal(), null, Timeout.Infinite, false);
            return handle;
        }

        /// <summary>Asks the running copy to stop Sync and exit, and waits until it has.</summary>
        public static bool RequestQuit(Home home, TimeSpan timeout)
        {
            if (!Mutex.TryOpenExisting(home.MutexName, out var mutex)) return true;
            using (mutex)
            {
                Signal(home, "quit");
                try
                {
                    if (!mutex.WaitOne(timeout)) return false;
                }
                catch (AbandonedMutexException) { }
                mutex.ReleaseMutex();
                return true;
            }
        }

        public static int DumpState(Home home)
        {
            var before = File.Exists(home.TrayStatePath) ? File.GetLastWriteTimeUtc(home.TrayStatePath) : DateTime.MinValue;
            if (!Signal(home, "dump"))
            {
                Console.WriteLine("Tinkjam Sync is not running for " + home.BaseDir);
                return 1;
            }
            for (var waited = 0; waited < 5000; waited += 100)
            {
                Thread.Sleep(100);
                if (File.Exists(home.TrayStatePath) && File.GetLastWriteTimeUtc(home.TrayStatePath) > before)
                {
                    Thread.Sleep(100);
                    Console.WriteLine(File.ReadAllText(home.TrayStatePath));
                    return 0;
                }
            }
            Console.WriteLine("Tinkjam Sync did not answer.");
            return 1;
        }
    }
}
