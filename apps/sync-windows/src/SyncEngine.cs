using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.Win32;
using WinFormsTimer = System.Windows.Forms.Timer;

namespace TinkjamSync
{
    /// <summary>
    /// Gets Sync onto this computer and keeps exactly one running as a hidden child. Sync itself is the
    /// published package (https://tinkjam.com/sync.tgz) run by a private Node; this only drives it.
    /// Everything runs on the UI thread except the waits, so state needs no locks.
    /// </summary>
    public sealed class SyncEngine : IDisposable
    {
        public const string AppUrl = "https://app.tinkjam.com";
        // The tarball's address as signed manifests name it: still trellium.org, which every copy out
        // there and every network that was told to allow it reaches (tinkjam.com serves it too).
        public const string SyncUrl = "https://trellium.org/sync.tgz";
        public const int ApprovalPort = 34338;
        const string NodeVersion = "24.22.3";
        // From https://nodejs.org/dist/v24.22.3/SHASUMS256.txt
        static readonly Dictionary<string, string> NodeSha256 = new Dictionary<string, string>
        {
            ["x64"] = "e612af99f626ab415ea225af6bce5c971feb448cb5cae250bb1c3fa50c5f7d9f",
            ["arm64"] = "b3cc74a295b39d4f273271e96f58c06dd2b35757ca12abec64c7d0598b434f14",
        };
        static readonly TimeSpan SlowAfter = TimeSpan.FromSeconds(90);
        static readonly TimeSpan DisconnectTimeout = TimeSpan.FromMinutes(2);

        // Each manifest from tinkjam.com, else the same file on trellium.org; an override stands alone.
        static string[] SyncManifestUrls => Addresses(Env("TINKJAM_SYNC_PACKAGE_MANIFEST"), "/sync.json");
        static string[] AppManifestUrls => Addresses(Env("TINKJAM_SYNC_UPDATE_URL"), "/downloads/windows.json");

        static string[] Addresses(string overridden, string path) =>
            overridden != null ? new[] { overridden } : new[] { "https://tinkjam.com" + path, "https://trellium.org" + path };

        static string Env(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        sealed class Staged
        {
            public string Launcher, Version;
        }

        readonly Home home;
        readonly Settings settings;
        readonly SynchronizationContext ui;
        readonly JobObject job = new JobObject();
        readonly WinFormsTimer poll = new WinFormsTimer { Interval = 2000 };
        readonly WinFormsTimer restart = new WinFormsTimer();
        readonly WinFormsTimer retry = new WinFormsTimer { Interval = 60_000 };
        readonly WinFormsTimer slowRetry = new WinFormsTimer { Interval = 15 * 60_000 };
        readonly WinFormsTimer hourly = new WinFormsTimer { Interval = 60 * 60_000 };
        readonly WinFormsTimer afterResume = new WinFormsTimer { Interval = 30_000 };
        readonly List<DateTime> crashes = new List<DateTime>();

        public readonly AppView View = new AppView();
        public readonly bool Interactive;
        public string ApprovalUrl { get; private set; }
        /// <summary>Goes up each time the setup window should come forward.</summary>
        public int WindowRequests { get; private set; }
        public int? SyncPid => sync == null ? (int?)null : syncPid;
        public event Action Changed;
        /// <summary>A toast: title, text, and whether clicking it should connect or try again.</summary>
        public event Action<string, string, bool> Notify;

        string nodeExe, systemProxy;
        Process sync;
        int syncPid, step;
        DateTime syncStartedAt;
        bool approvedThisRun, tookOver, shuttingDown, everReachable, announceConnected, connectWanted;
        bool restartWhenFree, stopNotified, checkingForUpdates;
        string updatePath, updateSha, loggedReason;

        public SyncEngine(Home home, Settings settings, bool interactive)
        {
            this.home = home;
            this.settings = settings;
            Interactive = interactive;
            announceConnected = interactive;
            connectWanted = interactive;
            ui = SynchronizationContext.Current;
            View.Version = AppInfo.ShortVersion;
            View.StartWithWindows = settings.StartWithWindows;
            View.ComputerName = Dns.GetHostName();
            View.Installed = !FirstRun;
            poll.Tick += (s, e) => Poll();
            restart.Tick += (s, e) =>
            {
                restart.Stop();
                if (sync != null) return;
                if (View.Busy) { restartWhenFree = true; return; }
                StartSync();
            };
            retry.Tick += (s, e) => { retry.Stop(); if (View.Phase == Phase.Stopped) RetryQuietly(); };
            slowRetry.Tick += (s, e) => { slowRetry.Stop(); if (View.Phase == Phase.Stopped) RetryQuietly(); };
            hourly.Tick += async (s, e) => await CheckForUpdates(false);
            afterResume.Tick += async (s, e) =>
            {
                afterResume.Stop();
                if (View.Phase == Phase.Stopped) RetryQuietly();
                await CheckForUpdates(false);
            };
            SystemEvents.PowerModeChanged += OnPowerModeChanged;
        }

        bool FirstRun => !File.Exists(home.ServerEntry) || settings.SyncVersion == null;

        // ---- What the tray asks for ----

        public async void Start()
        {
            ClearOldDownloads();
            if (Interactive && FirstRun) WindowRequests++;
            await Exclusive(async () =>
            {
                if (settings.Disconnected && !FirstRun)
                {
                    await EnsureRuntime();
                    Set(Phase.NotConnected, null);
                    return;
                }
                await Bring(Interactive, Interactive);
            });
            hourly.Start();
            await Task.Delay(TimeSpan.FromSeconds(15));
            if (!shuttingDown) await CheckForUpdates(false);
        }

        /// <summary>The person asked: connect if needed, in the open, with the window forward.</summary>
        public async void Retry()
        {
            if (View.Busy || shuttingDown) return;
            crashes.Clear();
            tookOver = false;
            stopNotified = false;
            connectWanted = true;
            if (settings.Disconnected)
            {
                settings.Disconnected = false;
                SaveSettings();
            }
            WindowRequests++;
            await Exclusive(() => Bring(true, true));
        }

        public void Connect() => Retry();

        /// <summary>A timer or a wake from sleep asked: no window, and no browser unless setup still owes one.</summary>
        async void RetryQuietly()
        {
            crashes.Clear();
            tookOver = false;
            await Exclusive(() => Bring(connectWanted, connectWanted));
        }

        public void OpenApproval()
        {
            if (ApprovalUrl != null) OpenUrl(ApprovalUrl);
        }

        public async void Disconnect()
        {
            if (View.Busy || shuttingDown) return;
            View.Busy = true;
            Changed?.Invoke();
            var wasRunning = sync != null || restart.Enabled || restartWhenFree;
            var phase = View.Phase;
            var detail = View.Detail;
            try
            {
                await StopSync();
                Set(Phase.Disconnecting, null);
                var code = await Run(new[] { home.ServerEntry, "sync", "--disconnect", "--base-dir", home.BaseDir }, timeout: DisconnectTimeout);
                Alive();
                if (code == 0)
                {
                    settings.Disconnected = true;
                    SaveSettings();
                    Set(Phase.NotConnected, null);
                    Notify?.Invoke("Disconnected", "This computer is no longer connected to your Tinkjam account.", false);
                    return;
                }
                Log.App("Disconnecting ended with exit code " + code);
            }
            catch (OperationCanceledException) when (shuttingDown) { return; }
            catch (Exception error)
            {
                Log.App("Disconnecting failed: " + error);
            }
            finally
            {
                View.Busy = false;
                Changed?.Invoke();
            }
            Notify?.Invoke("Couldn't disconnect", "This computer is still connected to your Tinkjam account. Check your internet connection, then try again.", false);
            if (wasRunning) StartSync();
            else Set(phase, detail);
        }

        public void SetStartWithWindows(bool enabled)
        {
            settings.StartWithWindows = enabled;
            View.StartWithWindows = enabled;
            SaveSettings();
            ApplyStartWithWindows();
            Changed?.Invoke();
        }

        void SaveSettings()
        {
            try { settings.Save(); } catch (Exception error) { Log.App("Couldn't save settings: " + error.Message); }
        }

        public bool UpdateReady => updatePath != null && File.Exists(updatePath);

        /// <summary>Runs the downloaded installer; it asks this copy to quit, replaces it and starts the new one.</summary>
        public bool ApplyUpdate()
        {
            if (!UpdateReady) return false;
            try
            {
                // The file sat on disk since it was checked; only the one that was published runs.
                if (!Checksum.Matches(updatePath, updateSha))
                {
                    Log.App("The downloaded update no longer matches what was published; discarding it");
                    TryDelete(updatePath);
                    updatePath = null;
                    View.UpdateVersion = null;
                    Changed?.Invoke();
                    return false;
                }
                Log.App("Starting the update to " + View.UpdateVersion);
                var args = new List<string> { "/install", "/silent", "--after-update" };
                args.AddRange(home.PassThrough());
                Process.Start(new ProcessStartInfo(updatePath, CommandLine.Join(args)) { UseShellExecute = false });
                return true;
            }
            catch (Exception error)
            {
                Log.App("Couldn't start the update: " + error.Message);
                return false;
            }
        }

        public void Shutdown()
        {
            shuttingDown = true;
            foreach (var timer in Timers) timer.Stop();
            var running = sync;
            sync = null;
            job.Terminate();
            try { running?.WaitForExit(5000); } catch (Exception) { }
            Log.App("Exited; Tinkjam Sync stopped.");
        }

        public void Dispose()
        {
            SystemEvents.PowerModeChanged -= OnPowerModeChanged;
            job.Dispose();
            foreach (var timer in Timers) timer.Dispose();
        }

        WinFormsTimer[] Timers => new[] { poll, restart, retry, slowRetry, hourly, afterResume };

        void OnPowerModeChanged(object sender, PowerModeChangedEventArgs e)
        {
            if (e.Mode != PowerModes.Resume) return;
            // Wi-Fi takes a moment to come back after a wake.
            ui.Post(_ => { if (!shuttingDown) { afterResume.Stop(); afterResume.Start(); } }, null);
        }

        // ---- The setup ----

        async Task<bool> Exclusive(Func<Task> work)
        {
            if (View.Busy || shuttingDown) return false;
            View.Busy = true;
            Changed?.Invoke();
            try
            {
                await work();
            }
            catch (OperationCanceledException) when (shuttingDown) { }
            catch (SetupException error)
            {
                Log.App("Stopped: " + error.Message);
                Stop(error.Message, error.RetrySoon);
            }
            catch (Exception error)
            {
                Log.App("Unexpected error: " + error);
                Stop(error is IOException && ((error.HResult & 0xFFFF) == 0x70 || (error.HResult & 0xFFFF) == 0x27) ? Words.DiskFull : Words.Unexpected, false);
            }
            finally
            {
                View.Busy = false;
                StartPendingRestart();
                Changed?.Invoke();
            }
            return true;
        }

        /// <summary>A restart that came due while something else held the app runs once that is done.</summary>
        void StartPendingRestart()
        {
            if (!restartWhenFree) return;
            restartWhenFree = false;
            if (sync == null && !shuttingDown) StartSync();
        }

        /// <summary>Stopped, with when it tries again by itself. One toast until it next connects or the person retries.</summary>
        void Stop(string message, bool retrySoon)
        {
            Set(Phase.Stopped, message + (retrySoon ? Words.RetriesSoon : Words.RetriesLater));
            retry.Stop();
            slowRetry.Stop();
            if (shuttingDown) return;
            (retrySoon ? retry : slowRetry).Start();
            if (retrySoon || stopNotified) return;
            stopNotified = true;
            Notify?.Invoke("Tinkjam Sync needs your attention", message + " Click here to try again.", true);
        }

        void Alive()
        {
            if (shuttingDown) throw new OperationCanceledException();
        }

        /// <summary>Runtime, package, login item, connection, then Sync: whatever is missing, in order.</summary>
        async Task Bring(bool connectFirst, bool openBrowser)
        {
            await StopSync();
            Set(Phase.SettingUp, null);
            systemProxy = await Task.Run(() => Net.SystemProxy());
            await EnsureRuntime();
            await EnsurePackage();
            ApplyStartWithWindows();
            if (connectFirst)
            {
                var connected = await ConnectOnly(openBrowser);
                connectWanted = false;
                if (!connected) return;
            }
            StartSync();
        }

        /// <summary>A download's percent, shown only while that download is still the current step.</summary>
        Action<int> Progress(string detail)
        {
            var mine = ++step;
            return percent => ui.Post(_ => { if (step == mine && View.Phase == Phase.SettingUp) Set(Phase.SettingUp, detail, percent); }, null);
        }

        async Task EnsureRuntime()
        {
            var arch = Native.MachineArch();
            var name = "node-v" + NodeVersion + "-win-" + arch;
            var dir = Path.Combine(home.RuntimeDir, name);
            nodeExe = Path.Combine(dir, "node.exe");
            if (File.Exists(nodeExe)) return;

            Log.App("Getting Node.js " + NodeVersion + " (" + arch + ")");
            Set(Phase.SettingUp, "downloading");
            var zip = Path.Combine(home.RuntimeDir, "download", name + ".zip");
            await Net.Download("https://nodejs.org/dist/v" + NodeVersion + "/" + name + ".zip", zip, "download Node.js", Progress("downloading"));
            step++;
            Alive();
            Set(Phase.SettingUp, "checking the download");
            if (!await Task.Run(() => Checksum.Matches(zip, NodeSha256[arch])))
            {
                Log.App("The Node.js download did not match its SHA-256");
                TryDelete(zip);
                throw new SetupException(Words.Damaged);
            }
            Set(Phase.SettingUp, "unpacking");
            await Task.Run(() =>
            {
                // A short folder: Node's own files nest deep, and older Windows stops at 260 characters.
                var partial = Path.Combine(home.RuntimeDir, "x");
                DeleteDir(partial);
                ZipFile.ExtractToDirectory(zip, partial);
                Directory.Move(Path.Combine(partial, name), dir);
                DeleteDir(partial);
                TryDelete(zip);
                foreach (var old in Directory.GetDirectories(home.RuntimeDir, "node-v*"))
                    if (!Home.SamePath(old, dir)) DeleteDir(old);
            });
            Alive();
        }

        async Task EnsurePackage()
        {
            if (!FirstRun)
            {
                if (OldIntegrationPresent()) await TakeOverExisting();
                return;
            }
            // First run: a fresh copy, which also clears out whatever an earlier `npx … --install` set up.
            Set(Phase.SettingUp, "getting Tinkjam Sync");
            var staged = await StagePackage(await Net.GetJson(SyncManifestUrls, "read sync.json"), quiet: false);
            await StopSync();
            await TakeOverWith(staged.Launcher);
            Set(Phase.SettingUp, "finishing");
            await Task.Run(() => Swap());
            settings.SyncVersion = staged.Version;
            SaveSettings();
            Log.App("Tinkjam Sync " + staged.Version + " installed in " + home.AppDir);
        }

        /// <summary>What the npx-installed background Sync leaves: its Run value and its start script.</summary>
        bool OldIntegrationPresent() =>
            RunKey.Get(home.PackageRunValueName) != null ||
            File.Exists(Path.Combine(home.BaseDir, "start-sync.js")) ||
            File.Exists(Path.Combine(home.BaseDir, "sync-service.pid"));

        /// <summary>
        /// Downloads and checks the package sync.json names, unpacks it into the staging folder and
        /// installs exactly its npm-shrinkwrap.json there. The running one is untouched.
        /// </summary>
        async Task<Staged> StagePackage(Dictionary<string, object> manifest, bool quiet)
        {
            void Say(string detail) { if (!quiet) Set(Phase.SettingUp, detail); }
            var version = Json.Text(manifest, "version");
            var url = Json.Text(manifest, "url") ?? SyncUrl;
            var sha = Json.Text(manifest, "sha256");
            if (!AllowedUrl(url) || !Checksum.LooksValid(sha))
            {
                Log.App("sync.json names no usable download (url " + url + ", sha256 " + (sha ?? "missing") + ")");
                throw new SetupException(Words.ServerTrouble);
            }
            if (!ReleaseSignature.Verify("sync", manifest))
            {
                Log.App("sync.json for " + (version ?? "?") + " is not signed with Tinkjam's release key; not installed");
                throw new SetupException(Words.ServerTrouble);
            }
            Alive();
            await Task.Run(() =>
            {
                DeleteDir(home.StagingDir);
                Directory.CreateDirectory(home.StagingDir);
            });
            var tarball = Path.Combine(home.StagingDir, "sync.tgz");
            await Net.Download(url + (version == null ? "" : "?v=" + Uri.EscapeDataString(version)), tarball, "download Tinkjam Sync",
                quiet ? null : Progress("downloading Tinkjam Sync"));
            step++;
            Alive();
            if (!await Task.Run(() => Checksum.Matches(tarball, sha)))
            {
                Log.App("The Tinkjam Sync download did not match the SHA-256 in sync.json (" + sha + ")");
                await Task.Run(() => DeleteDir(home.StagingDir));
                throw new SetupException(Words.Damaged);
            }
            Say("installing (this can take a few minutes)");
            var packageDir = Home.PackageIn(home.StagingDir);
            if (!await Task.Run(() => Unpack(tarball, packageDir)))
            {
                await Task.Run(() => DeleteDir(home.StagingDir));
                throw new SetupException(Words.InstallFailed);
            }
            TryDelete(tarball);
            Alive();
            var cache = Path.Combine(home.RuntimeDir, "npm-cache");
            var npm = Path.Combine(Path.GetDirectoryName(nodeExe), "node_modules", "npm", "bin", "npm-cli.js");
            var output = new StringBuilder();
            Action<string> collect = line => { lock (output) { if (output.Length < 20000) output.AppendLine(line); } };
            var code = await Run(NpmCommands.Ci(npm, packageDir, cache), collect, TimeSpan.FromMinutes(10), nodeFirstOnPath: true);
            if (code == 0) code = await Run(NpmCommands.Rebuild(npm, packageDir, cache), collect, TimeSpan.FromMinutes(5), nodeFirstOnPath: true);
            await Task.Run(() => { try { DeleteDir(cache); } catch (Exception) { } });
            Alive();
            var stagedLauncher = Home.LauncherIn(home.StagingDir);
            if (code != 0 || !File.Exists(stagedLauncher))
            {
                Log.App("npm ci ended with exit code " + code);
                string said;
                lock (output) said = output.ToString();
                switch (Failures.Classify(said))
                {
                    case NetworkTrouble.Offline: throw new SetupException(Words.Offline, retrySoon: true);
                    case NetworkTrouble.Restricted: throw new SetupException(Words.Restricted, retrySoon: true);
                    default: throw new SetupException(Words.InstallFailed);
                }
            }
            return new Staged { Launcher = stagedLauncher, Version = await PackageVersion(stagedLauncher) ?? version };
        }

        /// <summary>
        /// Windows' own tar (10 1803 and later) unpacks npm's `package/` folder as `target`, after
        /// the listing shows only plain files and folders inside it. It refuses `..` and absolute paths too.
        /// </summary>
        static bool Unpack(string tarball, string target)
        {
            var tar = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.System), "tar.exe");
            if (!File.Exists(tar))
            {
                Log.App("Windows' own tar.exe is missing; it comes with Windows 10 version 1803 and later");
                return false;
            }
            var names = Tool(tar, "-tzf", tarball);
            var longListing = Tool(tar, "-tvzf", tarball);
            if (names == null || longListing == null || !PackageArchive.SafeListing(names, longListing))
            {
                Log.App("sync.tgz holds something besides the package's own files and folders; not installed");
                return false;
            }
            Directory.CreateDirectory(target);
            if (Tool(tar, "-xzf", tarball, "-C", target, "--strip-components", "1") == null) return false;
            foreach (var entry in Directory.EnumerateFileSystemEntries(target, "*", SearchOption.AllDirectories))
            {
                if ((File.GetAttributes(entry) & FileAttributes.ReparsePoint) == 0) continue;
                Log.App("sync.tgz unpacked a link (" + entry + "); not installed");
                return false;
            }
            return true;
        }

        /// <summary>Runs a program to its end: its output lines, or null when it failed.</summary>
        static List<string> Tool(string exe, params string[] args)
        {
            var info = new ProcessStartInfo(exe, CommandLine.Join(args))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using (var process = Process.Start(info))
            {
                var error = process.StandardError.ReadToEndAsync();
                var output = process.StandardOutput.ReadToEnd();
                if (!process.WaitForExit(120_000))
                {
                    try { process.Kill(); } catch (Exception) { }
                    Log.App(Path.GetFileName(exe) + " did not finish");
                    return null;
                }
                if (process.ExitCode != 0)
                {
                    Log.App(Path.GetFileName(exe) + " ended with exit code " + process.ExitCode + ": " + error.Result.Trim());
                    return null;
                }
                return output.Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries).ToList();
            }
        }

        /// <summary>
        /// A copy of the installed package runs its own `--uninstall`: it ends any other Sync of this
        /// home and removes the login items earlier installs made. It also deletes the package it ran
        /// from, so it runs from a staged copy that then takes its place.
        /// </summary>
        async Task TakeOverExisting()
        {
            Set(Phase.SettingUp, "replacing the older Tinkjam Sync");
            await StopSync();
            await Task.Run(() =>
            {
                DeleteDir(home.StagingDir);
                CopyDir(home.AppDir, home.StagingDir);
            });
            await TakeOverWith(Home.LauncherIn(home.StagingDir));
            await Task.Run(() => Swap());
        }

        async Task TakeOverWith(string launcher)
        {
            Log.App("Removing older Tinkjam Sync setups (the package's --uninstall)");
            await Run(new[] { launcher, "--uninstall", "--base-dir", home.BaseDir }, timeout: TimeSpan.FromMinutes(3));
            Alive();
            // That also removes Run values that name this home, which a test home's own value does.
            ApplyStartWithWindows();
        }

        /// <summary>The staged package takes the installed one's place; if it can't, the installed one goes back.</summary>
        void Swap()
        {
            var old = Path.Combine(home.RuntimeDir, "app-old");
            DeleteDir(old);
            var hadOld = Directory.Exists(home.AppDir);
            if (hadOld) Retrying(() => Directory.Move(home.AppDir, old));
            try
            {
                Retrying(() => Directory.Move(home.StagingDir, home.AppDir));
            }
            catch (Exception)
            {
                if (hadOld && !Directory.Exists(home.AppDir)) Retrying(() => Directory.Move(old, home.AppDir));
                throw;
            }
            try { DeleteDir(old); } catch (Exception error) { Log.App("Couldn't remove " + old + ": " + error.Message); }
        }

        async Task<string> PackageVersion(string launcher)
        {
            string version = null;
            await Run(new[] { launcher, "--version" }, line =>
            {
                var match = Regex.Match(line, @"^Tinkjam Sync (\S+)");
                if (match.Success) version = match.Groups[1].Value;
            }, TimeSpan.FromSeconds(30));
            return version;
        }

        void ApplyStartWithWindows()
        {
            try
            {
                if (!settings.StartWithWindows)
                {
                    RunKey.Remove(home.RunValueName);
                    return;
                }
                var args = new List<string> { System.Windows.Forms.Application.ExecutablePath, "--autostart" };
                args.AddRange(home.PassThrough());
                RunKey.Set(home.RunValueName, CommandLine.Join(args));
            }
            catch (Exception error)
            {
                Log.App("Couldn't change Start with Windows: " + error.Message);
            }
        }

        /// <summary>Leftovers of earlier versions: update installers in the temp folder, and npm's cache.</summary>
        void ClearOldDownloads()
        {
            var cache = Path.Combine(home.RuntimeDir, "npm-cache");
            Task.Run(() =>
            {
                try
                {
                    foreach (var file in Directory.GetFiles(Path.GetTempPath(), "TinkjamSyncSetup-*.exe")) TryDelete(file);
                    DeleteDir(cache);
                }
                catch (Exception) { }
            });
        }

        // ---- Connecting and running ----

        /// <summary>Sync's own --connect-only: returns at once when connected, else serves the approval page.</summary>
        async Task<bool> ConnectOnly(bool openBrowser)
        {
            Set(Phase.Connecting, null);
            var output = new StringBuilder();
            var sawUrl = false;
            var code = await Run(new[] { home.ServerEntry, "sync", "--connect-only", "--base-dir", home.BaseDir }, line => ui.Post(_ =>
            {
                if (shuttingDown) return;
                if (output.Length < 20000) output.AppendLine(line);
                var name = SyncOutput.ParseComputerName(line);
                if (name != null) View.ComputerName = name;
                var url = SyncOutput.ParseApprovalUrl(line);
                if (url != null)
                {
                    sawUrl = true;
                    ApprovalUrl = url;
                    if (openBrowser) WindowRequests++;
                    Set(Phase.Approving, null);
                    if (openBrowser) OpenUrl(url);
                    Notify?.Invoke("Approve in your browser", "Sign in to Tinkjam and press Connect to connect " + View.ComputerName + ".", false);
                }
                else if (line.StartsWith("Getting ready"))
                {
                    Set(Phase.Connecting, "getting ready (a one-time download)");
                }
            }, null), TimeSpan.FromMinutes(35));
            Alive();
            ApprovalUrl = null;
            if (code == 0)
            {
                approvedThisRun |= sawUrl;
                return true;
            }
            if (sawUrl)
            {
                Set(Phase.NotConnected, "The approval wasn't finished.");
                return false;
            }
            Log.App("Checking the connection ended with exit code " + code);
            if (!PortFree(ApprovalPort))
            {
                Log.App("Port " + ApprovalPort + " is in use by another program");
                throw new SetupException(Words.SignInPageBlocked);
            }
            switch (Failures.Classify(output.ToString()))
            {
                case NetworkTrouble.Offline: throw new SetupException(Words.Offline, retrySoon: true);
                case NetworkTrouble.Restricted: throw new SetupException(Words.Restricted, retrySoon: true);
                default: throw new SetupException(Words.CantCheckConnection);
            }
        }

        void StartSync()
        {
            if (shuttingDown) return;
            restart.Stop();
            restartWhenFree = false;
            TryDelete(Path.Combine(home.BaseDir, "sync-starts.json"));
            Log.App("Starting Tinkjam Sync");
            Process process = null;
            try
            {
                process = Spawn(new[] { home.ServerEntry, "sync", "--background", "--base-dir", home.BaseDir }, null, false);
            }
            catch (Exception error)
            {
                Log.App("Tinkjam Sync couldn't start: " + error);
                Stop(Words.CouldNotStart, false);
                return;
            }
            sync = process;
            syncPid = process.Id;
            syncStartedAt = DateTime.UtcNow;
            everReachable = false;
            loggedReason = null;
            process.Exited += (s, e) =>
            {
                try { process.WaitForExit(); } catch (Exception) { }
                var code = ExitCode(process);
                ui.Post(_ => OnSyncExit(process, code), null);
            };
            process.EnableRaisingEvents = true;
            Set(Phase.Connecting, null);
            poll.Start();
        }

        async void OnSyncExit(Process process, int code)
        {
            if (process != sync || shuttingDown) return;
            sync = null;
            poll.Stop();
            var since = Log.Tail(home.LogPath);
            var marker = since.LastIndexOf("[app] Starting Tinkjam Sync", StringComparison.Ordinal);
            var kind = SyncOutput.Classify(code, marker < 0 ? since : since.Substring(marker));
            Log.App("Tinkjam Sync ended (exit code " + code + ", " + kind + ")");
            switch (kind)
            {
                case SyncExit.NotConnected:
                    Set(Phase.NotConnected, null);
                    Notify?.Invoke("Tinkjam Sync isn't connected", "Click here to connect this computer to your Tinkjam account.", true);
                    break;
                case SyncExit.AlreadyRunning when !tookOver:
                    tookOver = true;
                    if (!await Exclusive(async () => { await TakeOverExisting(); StartSync(); }))
                    {
                        tookOver = false;
                        Set(Phase.Connecting, null);
                        restartWhenFree = true;
                    }
                    break;
                case SyncExit.AlreadyRunning:
                    Log.App("Another Tinkjam Sync still holds this home after the takeover");
                    Stop("Another copy of Tinkjam Sync is running on this computer.", false);
                    break;
                default:
                    var now = DateTime.UtcNow;
                    crashes.Add(now);
                    var wait = Backoff.Next(crashes, now);
                    if (wait == null)
                    {
                        crashes.Clear();
                        Stop(Words.KeepsStopping, false);
                        break;
                    }
                    Set(Phase.Connecting, "restarting in " + (int)wait.Value.TotalSeconds + " seconds");
                    restart.Interval = (int)wait.Value.TotalMilliseconds;
                    restart.Start();
                    break;
            }
        }

        /// <summary>Sync's own answer, every two seconds for as long as it runs, so "Connected" stays true.</summary>
        void Poll()
        {
            if (sync == null) { poll.Stop(); return; }
            var status = StatusFile.Read(home.StatusPath, syncPid);
            var health = StatusFile.HealthOf(status, DateTime.UtcNow);
            if (health == Health.Reachable)
            {
                if (View.Phase == Phase.Connected) return;
                var first = !everReachable;
                everReachable = true;
                Set(Phase.Connected, null);
                if (first && (approvedThisRun || announceConnected))
                    Notify?.Invoke("Connected", "Your agents on " + View.ComputerName + " are now available on your Tinkjam boards.", false);
                approvedThisRun = false;
                announceConnected = false;
                return;
            }
            if (everReachable)
            {
                // A file caught mid-write reads as nothing; only a real answer changes what is shown.
                if (health != Health.Unknown) Set(Phase.Reconnecting, null);
                return;
            }
            var slow = DateTime.UtcNow - syncStartedAt > SlowAfter;
            if (slow && status?.Reason != null && status.Reason != loggedReason)
            {
                loggedReason = status.Reason;
                Log.App("Still connecting; Tinkjam Sync is waiting on: " + status.Reason);
            }
            Set(Phase.Connecting, slow ? "this is taking longer than usual; it keeps trying" : null);
        }

        async Task StopSync()
        {
            var running = sync;
            sync = null;
            poll.Stop();
            restart.Stop();
            restartWhenFree = false;
            if (running == null) return;
            Log.App("Stopping Tinkjam Sync");
            job.Terminate();
            await Task.Run(() => { try { running.WaitForExit(10000); } catch (Exception) { } });
        }

        /// <summary>An agent is at work under Sync. When that can't be told, it counts as yes.</summary>
        bool AgentsRunning()
        {
            if (sync == null) return false;
            try { return Agents.Running(Native.Processes(), syncPid); }
            catch (Exception error)
            {
                Log.App("Couldn't list processes: " + error.Message);
                return true;
            }
        }

        // ---- Updates ----

        public async Task CheckForUpdates(bool manual)
        {
            if (checkingForUpdates || shuttingDown) return;
            checkingForUpdates = true;
            if (manual)
            {
                View.CheckingForUpdates = true;
                Changed?.Invoke();
            }
            try
            {
                if (await CheckForAppUpdate(manual)) return;
                await RefreshPackage(manual);
            }
            catch (Exception error)
            {
                Log.App("Update check: " + error);
            }
            finally
            {
                checkingForUpdates = false;
                View.CheckingForUpdates = false;
                Changed?.Invoke();
            }
        }

        /// <summary>True when the app is on its way out to be replaced.</summary>
        async Task<bool> CheckForAppUpdate(bool manual)
        {
            try
            {
                var manifest = await Net.GetJson(AppManifestUrls, "check for updates");
                var version = Json.Text(manifest, "version");
                var url = Json.Text(manifest, "url");
                var sha = Json.Text(manifest, "sha256");
                if (!Versions.IsNewer(AppInfo.Version, version) || !AllowedUrl(url) || !Checksum.LooksValid(sha))
                {
                    // Only a readable version that is not newer says "Up to date"; a garbled manifest says nothing.
                    View.UpToDate = Versions.IsNewer("0.0.0", version) && !Versions.IsNewer(AppInfo.Version, version);
                    await Task.Run(() => { try { DeleteDir(home.UpdateDir); } catch (Exception) { } });
                    if (manual) Notify?.Invoke("Tinkjam Sync is up to date", "You have version " + AppInfo.ShortVersion + ".", false);
                    return false;
                }
                if (!ReleaseSignature.Verify("windows", manifest))
                {
                    Log.App("windows.json offers " + version + " but is not signed with Tinkjam's release key; it tries again at the next check");
                    if (manual) Notify?.Invoke("Couldn't check for updates", Words.ServerTrouble + " It tries again within the hour.", false);
                    return false;
                }
                var path = Path.Combine(home.UpdateDir, "TinkjamSyncSetup-" + Regex.Replace(version, "[^0-9A-Za-z.]", "-") + ".exe");
                // One already downloaded and intact is kept, so a new log-in downloads nothing again.
                if (!await Task.Run(() => File.Exists(path) && Checksum.Matches(path, sha)))
                {
                    await Task.Run(() => { try { DeleteDir(home.UpdateDir); } catch (Exception) { } });
                    await Net.Download(url, path, "download the update", null);
                    if (!await Task.Run(() => Checksum.Matches(path, sha)))
                    {
                        TryDelete(path);
                        Log.App("The update download did not match its SHA-256; it tries again at the next check");
                        if (manual) Notify?.Invoke("Couldn't get the update", Words.Damaged + " It tries again within the hour.", false);
                        return false;
                    }
                    Log.App("Update " + version + " downloaded and verified");
                }
                updatePath = path;
                updateSha = sha;
                View.UpToDate = false;
                View.UpdateVersion = Versions.Short(version);
                Changed?.Invoke();
                if (shuttingDown) return false;
                // One try by itself per version: an installer that fails would otherwise restart the app forever.
                if (settings.UpdateAttempted != version && !View.Busy && !AgentsRunning())
                {
                    settings.UpdateAttempted = version;
                    SaveSettings();
                    if (ApplyUpdate()) return true;
                }
                Log.App("Update " + version + " waits for Restart to update, or for the agents to finish");
                if (manual)
                    Notify?.Invoke("Update ready", "It installs by itself once your agents finish. To install it now, choose \"Restart to update\" in the Tinkjam Sync menu.", false);
            }
            catch (SetupException error)
            {
                if (manual) Notify?.Invoke("Couldn't check for updates", error.Message, false);
            }
            return false;
        }

        /// <summary>
        /// A newer Sync package replaces the installed one, with Sync stopped only for the swap and
        /// never while an agent works. A failure leaves what was running as it was.
        /// </summary>
        async Task RefreshPackage(bool manual)
        {
            if (View.Busy || shuttingDown || nodeExe == null || FirstRun) return;
            if (View.Phase == Phase.SettingUp || View.Phase == Phase.Approving || View.Phase == Phase.Disconnecting) return;
            Dictionary<string, object> manifest;
            try
            {
                manifest = await Net.GetJson(SyncManifestUrls, "check for a newer Tinkjam Sync");
            }
            catch (SetupException)
            {
                return;
            }
            // The same manifest is staged, so the version compared is the one installed: never a downgrade.
            var latest = Json.Text(manifest, "version");
            if (!Versions.IsNewer(settings.SyncVersion, latest) || View.Busy || shuttingDown) return;
            if (AgentsRunning())
            {
                Log.App("Tinkjam Sync " + latest + " installs once no agent is running");
                if (manual) Notify?.Invoke("Update ready", "A newer Tinkjam Sync installs by itself once your agents finish.", false);
                return;
            }
            Log.App("Updating Tinkjam Sync from " + settings.SyncVersion + " to " + latest);
            View.Busy = true;
            Changed?.Invoke();
            try
            {
                systemProxy = await Task.Run(() => Net.SystemProxy());
                var staged = await StagePackage(manifest, quiet: true);
                if (shuttingDown) return;
                if (AgentsRunning())
                {
                    Log.App("An agent started meanwhile; the newer Tinkjam Sync waits for the next check");
                    return;
                }
                var wasRunning = sync != null || restart.Enabled || restartWhenFree;
                await StopSync();
                try
                {
                    await Task.Run(() => Swap());
                    settings.SyncVersion = staged.Version;
                    SaveSettings();
                    Log.App("Tinkjam Sync " + staged.Version + " installed in " + home.AppDir);
                }
                catch (Exception error)
                {
                    Log.App("Couldn't put the newer Tinkjam Sync in place; keeping the one installed: " + error.Message);
                }
                if (wasRunning && File.Exists(home.ServerEntry)) StartSync();
            }
            catch (OperationCanceledException) when (shuttingDown) { }
            catch (Exception error)
            {
                Log.App("Tinkjam Sync update did not finish; the installed one keeps running: " + error.Message);
            }
            finally
            {
                View.Busy = false;
                StartPendingRestart();
                Changed?.Invoke();
            }
        }

        // ---- Processes ----

        Process Spawn(IEnumerable<string> args, Action<string> onLine, bool nodeFirstOnPath)
        {
            var info = new ProcessStartInfo(nodeExe, CommandLine.Join(args))
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
                WorkingDirectory = Directory.Exists(home.BaseDir) ? home.BaseDir : Path.GetTempPath(),
            };
            var nodeDir = Path.GetDirectoryName(nodeExe);
            var path = EnvPath.Current();
            var env = info.EnvironmentVariables;
            // Agents Sync starts are found on PATH; the person's own Node, if any, stays theirs.
            env["PATH"] = nodeFirstOnPath ? nodeDir + ";" + path : path + ";" + nodeDir;
            env["T3CODE_HOME"] = home.BaseDir;
            env["T3CODE_HOSTED_APP_URL"] = AppUrl;
            env["TINKJAM_SYNC_URL"] = SyncUrl;
            env["TINKJAM_SYNC_FROM_APP"] = "1";
            env["npm_config_update_notifier"] = "false";
            env["NO_COLOR"] = "1";
            // Node trusts only its own certificate list and uses no proxy unless told: on a work
            // network, Windows' certificates and proxy are the ones that work.
            if (NodeEnv.MayUseSystemCa(env.ContainsKey("NODE_OPTIONS") ? env["NODE_OPTIONS"] : null)) env["NODE_USE_SYSTEM_CA"] = "1";
            if (systemProxy != null)
            {
                foreach (var name in new[] { "HTTPS_PROXY", "HTTP_PROXY" })
                    if (!env.ContainsKey(name)) env[name] = systemProxy;
                if (!env.ContainsKey("NO_PROXY")) env["NO_PROXY"] = "localhost,127.0.0.1,::1";
                env["NODE_USE_ENV_PROXY"] = "1";
            }
            var process = new Process { StartInfo = info };
            DataReceivedEventHandler forward = (s, e) =>
            {
                if (e.Data == null) return;
                Log.Sync(e.Data);
                onLine?.Invoke(e.Data);
            };
            process.OutputDataReceived += forward;
            process.ErrorDataReceived += forward;
            Directory.CreateDirectory(home.BaseDir);
            process.Start();
            try { job.Add(process); }
            catch (Exception error) { Log.App("Couldn't tie a process to the app (" + error.Message + ")"); }
            process.StandardInput.Close();
            process.BeginOutputReadLine();
            process.BeginErrorReadLine();
            return process;
        }

        /// <summary>Runs one Node command to its end and returns its exit code.</summary>
        async Task<int> Run(IEnumerable<string> args, Action<string> onLine = null, TimeSpan? timeout = null, bool nodeFirstOnPath = false)
        {
            var done = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
            var process = Spawn(args, onLine, nodeFirstOnPath);
            process.EnableRaisingEvents = true;
            process.Exited += (s, e) =>
            {
                try { process.WaitForExit(); } catch (Exception) { }
                done.TrySetResult(ExitCode(process));
            };
            if (process.HasExited) done.TrySetResult(ExitCode(process));
            if (timeout != null)
            {
                var _ = Task.Delay(timeout.Value).ContinueWith(t =>
                {
                    try { if (!process.HasExited) process.Kill(); } catch (Exception) { }
                });
            }
            return await done.Task;
        }

        static int ExitCode(Process process)
        {
            try { return process.ExitCode; } catch (Exception) { return -1; }
        }

        // ---- Small helpers ----

        void Set(Phase phase, string detail, int? percent = null)
        {
            View.Installed = !FirstRun;
            if (View.Phase == phase && View.Detail == detail && View.Percent == percent) return;
            var worthLogging = View.Phase != phase || (phase == Phase.Stopped && View.Detail != detail);
            View.Phase = phase;
            View.Detail = detail;
            View.Percent = percent;
            if (phase != Phase.Stopped)
            {
                retry.Stop();
                slowRetry.Stop();
            }
            if (phase == Phase.Connected) stopNotified = false;
            if (worthLogging) Log.App("Now: " + MenuModel.StatusLine(View));
            Changed?.Invoke();
        }

        static bool AllowedUrl(string url) =>
            url != null && (url.StartsWith("https://", StringComparison.OrdinalIgnoreCase) ||
                            url.StartsWith("http://127.0.0.1:", StringComparison.OrdinalIgnoreCase));

        static bool PortFree(int port)
        {
            try
            {
                var listener = new TcpListener(IPAddress.Loopback, port);
                listener.Start();
                listener.Stop();
                return true;
            }
            catch (SocketException) { return false; }
        }

        public static void OpenUrl(string url)
        {
            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); }
            catch (Exception error) { Log.App("Couldn't open " + url + ": " + error.Message); }
        }

        static void TryDelete(string path)
        {
            try { if (File.Exists(path)) File.Delete(path); } catch (Exception) { }
        }

        static void DeleteDir(string path)
        {
            if (!Directory.Exists(path)) return;
            Retrying(() =>
            {
                // Read-only files (npm leaves a few) block a recursive delete.
                foreach (var file in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
                    File.SetAttributes(file, FileAttributes.Normal);
                Directory.Delete(path, true);
            });
        }

        static void CopyDir(string from, string to)
        {
            foreach (var dir in Directory.EnumerateDirectories(from, "*", SearchOption.AllDirectories))
                Directory.CreateDirectory(Path.Combine(to, dir.Substring(from.Length + 1)));
            Directory.CreateDirectory(to);
            foreach (var file in Directory.EnumerateFiles(from, "*", SearchOption.AllDirectories))
                File.Copy(file, Path.Combine(to, file.Substring(from.Length + 1)), true);
        }

        /// <summary>A file Sync just let go of can stay locked for a moment (antivirus, indexer).</summary>
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
    }
}
