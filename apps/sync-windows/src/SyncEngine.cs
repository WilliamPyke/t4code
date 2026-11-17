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
using WinFormsTimer = System.Windows.Forms.Timer;

namespace TinkjamSync
{
    /// <summary>
    /// Gets Sync onto this computer and keeps exactly one running as a hidden child. Sync itself is the
    /// published package (https://trellium.org/sync.tgz) run by a private Node; this only drives it.
    /// Everything runs on the UI thread except the waits, so state needs no locks.
    /// </summary>
    public sealed class SyncEngine : IDisposable
    {
        public const string AppUrl = "https://app.trellium.org";
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

        static string SyncManifestUrl => Env("TINKJAM_SYNC_PACKAGE_MANIFEST") ?? "https://trellium.org/sync.json";
        static string AppManifestUrl => Env("TINKJAM_SYNC_UPDATE_URL") ?? "https://trellium.org/downloads/windows.json";

        static string Env(string name)
        {
            var value = Environment.GetEnvironmentVariable(name);
            return string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        }

        readonly Home home;
        readonly Settings settings;
        readonly SynchronizationContext ui;
        readonly JobObject job = new JobObject();
        readonly WinFormsTimer poll = new WinFormsTimer { Interval = 2000 };
        readonly WinFormsTimer restart = new WinFormsTimer();
        readonly WinFormsTimer retry = new WinFormsTimer { Interval = 60_000 };
        readonly WinFormsTimer daily = new WinFormsTimer { Interval = 24 * 60 * 60 * 1000 };
        readonly List<DateTime> crashes = new List<DateTime>();

        public readonly AppView View = new AppView();
        public readonly bool Interactive;
        public string ApprovalUrl { get; private set; }
        public bool Downloading { get; private set; }
        public int? SyncPid => sync == null ? (int?)null : syncPid;
        public event Action Changed;
        /// <summary>A toast: title, text, and whether clicking it should connect.</summary>
        public event Action<string, string, bool> Notify;

        string nodeExe;
        Process sync;
        int syncPid;
        DateTime syncStartedAt;
        bool approvedThisRun, tookOver, shuttingDown;
        string updatePath;

        public SyncEngine(Home home, Settings settings, bool interactive)
        {
            this.home = home;
            this.settings = settings;
            Interactive = interactive;
            ui = SynchronizationContext.Current;
            View.Version = AppInfo.Version;
            View.StartWithWindows = settings.StartWithWindows;
            View.ComputerName = Dns.GetHostName();
            poll.Tick += (s, e) => Poll();
            restart.Tick += (s, e) => { restart.Stop(); if (sync == null && !View.Busy) StartSync(); };
            retry.Tick += (s, e) => { retry.Stop(); if (View.Phase == Phase.Stopped) Retry(); };
            daily.Tick += async (s, e) => await CheckForUpdates(false);
        }

        // ---- What the tray asks for ----

        public async void Start()
        {
            await Exclusive(() => Bring(Interactive, Interactive));
            daily.Start();
            await Task.Delay(TimeSpan.FromSeconds(15));
            if (!shuttingDown) await CheckForUpdates(false);
        }

        public async void Retry()
        {
            crashes.Clear();
            tookOver = false;
            await Exclusive(() => Bring(true, true));
        }

        public void Connect() => Retry();

        public void OpenApproval()
        {
            if (ApprovalUrl != null) OpenUrl(ApprovalUrl);
        }

        public async void Disconnect()
        {
            await Exclusive(async () =>
            {
                await StopSync();
                Set(Phase.NotConnected, "disconnecting…");
                var code = await Run(new[] { home.ServerEntry, "sync", "--disconnect", "--base-dir", home.BaseDir });
                Alive();
                Set(Phase.NotConnected, null);
                if (code == 0) Notify?.Invoke("Disconnected", "This computer is no longer connected to your Tinkjam account.", false);
                else Notify?.Invoke("Couldn't disconnect", "Something went wrong; the log says what.", false);
            });
        }

        public void SetStartWithWindows(bool enabled)
        {
            settings.StartWithWindows = enabled;
            View.StartWithWindows = enabled;
            try { settings.Save(); } catch (Exception error) { Log.App("Couldn't save settings: " + error.Message); }
            ApplyStartWithWindows();
            Changed?.Invoke();
        }

        public bool UpdateReady => updatePath != null && File.Exists(updatePath);

        /// <summary>Runs the downloaded installer; it asks this copy to quit, replaces it and starts the new one.</summary>
        public void ApplyUpdate()
        {
            if (!UpdateReady) return;
            Log.App("Starting the update to " + View.UpdateVersion);
            var args = new List<string> { "/install", "/silent" };
            args.AddRange(home.PassThrough());
            Process.Start(new ProcessStartInfo(updatePath, CommandLine.Join(args)) { UseShellExecute = false });
        }

        public void Shutdown()
        {
            shuttingDown = true;
            foreach (var timer in new[] { poll, restart, retry, daily }) timer.Stop();
            var running = sync;
            sync = null;
            job.Terminate();
            try { running?.WaitForExit(5000); } catch (Exception) { }
            Log.App("Exited; Tinkjam Sync stopped.");
        }

        public void Dispose()
        {
            job.Dispose();
            foreach (var timer in new[] { poll, restart, retry, daily }) timer.Dispose();
        }

        // ---- The setup ----

        async Task Exclusive(Func<Task> work)
        {
            if (View.Busy || shuttingDown) return;
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
                Downloading = false;
                Set(Phase.Stopped, error.Offline ? error.Message + " It tries again in a minute." : error.Message);
                if (error.Offline) retry.Start();
            }
            catch (Exception error)
            {
                Log.App("Unexpected error: " + error);
                Downloading = false;
                Set(Phase.Stopped, error.Message);
            }
            finally
            {
                View.Busy = false;
                Changed?.Invoke();
            }
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
            await EnsureRuntime();
            await EnsurePackage();
            ApplyStartWithWindows();
            if (connectFirst && !await ConnectOnly(openBrowser)) return;
            StartSync();
        }

        async Task EnsureRuntime()
        {
            var arch = Native.MachineArch();
            var name = "node-v" + NodeVersion + "-win-" + arch;
            var dir = Path.Combine(home.RuntimeDir, name);
            nodeExe = Path.Combine(dir, "node.exe");
            if (File.Exists(nodeExe)) return;

            Log.App("Getting Node.js " + NodeVersion + " (" + arch + ")");
            Downloading = true;
            var zip = Path.Combine(home.RuntimeDir, "download", name + ".zip");
            await Net.Download("https://nodejs.org/dist/v" + NodeVersion + "/" + name + ".zip", zip, "download Tinkjam Sync",
                percent => ui.Post(_ => Set(Phase.SettingUp, "downloading (" + percent + "%)"), null));
            Alive();
            Set(Phase.SettingUp, "checking the download…");
            if (!await Task.Run(() => Checksum.Matches(zip, NodeSha256[arch])))
            {
                TryDelete(zip);
                throw new SetupException("the download was damaged (its checksum did not match). Press Retry.");
            }
            Set(Phase.SettingUp, "unpacking…");
            await Task.Run(() =>
            {
                var partial = dir + ".partial";
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
            if (File.Exists(home.ServerEntry) && settings.SyncVersion != null)
            {
                if (OldIntegrationPresent()) await TakeOverExisting();
                return;
            }
            // First run: a fresh copy, which also clears out whatever an earlier `npx … --install` set up.
            await InstallPackage(takeover: true, quiet: false);
        }

        /// <summary>What the npx-installed background Sync leaves: its Run value and its start script.</summary>
        bool OldIntegrationPresent() =>
            RunKey.Get(home.PackageRunValueName) != null ||
            File.Exists(Path.Combine(home.BaseDir, "start-sync.js")) ||
            File.Exists(Path.Combine(home.BaseDir, "sync-service.pid"));

        async Task InstallPackage(bool takeover, bool quiet)
        {
            void Say(string detail) { if (!quiet) Set(Phase.SettingUp, detail); }
            Say("getting Tinkjam Sync…");
            var manifest = await Net.GetJson(SyncManifestUrl, "download Tinkjam Sync");
            var version = Json.Text(manifest, "version");
            var url = Json.Text(manifest, "url") ?? SyncUrl;
            if (!AllowedUrl(url)) throw new SetupException("Tinkjam Sync's download address looks wrong (" + url + ").");
            Alive();
            await Task.Run(() =>
            {
                DeleteDir(home.StagingDir);
                Directory.CreateDirectory(home.StagingDir);
                File.WriteAllText(Path.Combine(home.StagingDir, "package.json"), "{\"name\":\"tinkjam-sync-app\",\"private\":true}\n");
            });
            var tarball = Path.Combine(home.StagingDir, "sync.tgz");
            Downloading = !quiet;
            await Net.Download(url + (version == null ? "" : "?v=" + Uri.EscapeDataString(version)), tarball, "download Tinkjam Sync",
                percent => { if (!quiet) ui.Post(_ => Set(Phase.SettingUp, "downloading Tinkjam Sync (" + percent + "%)"), null); });
            Alive();
            Say("installing…");
            var npm = Path.Combine(Path.GetDirectoryName(nodeExe), "node_modules", "npm", "bin", "npm-cli.js");
            var code = await Run(new[]
            {
                npm, "install", "--prefix", home.StagingDir, "--no-audit", "--no-fund", "--omit=dev", "--loglevel=error",
                "--cache", Path.Combine(home.RuntimeDir, "npm-cache"), tarball,
            }, timeout: TimeSpan.FromMinutes(10), nodeFirstOnPath: true);
            Alive();
            var stagedLauncher = Home.LauncherIn(home.StagingDir);
            if (code != 0 || !File.Exists(stagedLauncher))
                throw new SetupException("Tinkjam Sync could not be installed (npm exited with " + code + "). Press Retry, or open the log.");
            TryDelete(tarball);
            var installed = await PackageVersion(stagedLauncher) ?? version;

            await StopSync();
            if (takeover) await TakeOverWith(stagedLauncher);
            Say("finishing…");
            await Task.Run(() => Swap());
            settings.SyncVersion = installed;
            settings.Save();
            Downloading = false;
            Log.App("Tinkjam Sync " + installed + " installed in " + home.AppDir);
        }

        /// <summary>
        /// A copy of the installed package runs its own `--uninstall`: it ends any other Sync of this
        /// home and removes the login items earlier installs made. It also deletes the package it ran
        /// from, so it runs from a staged copy that then takes its place.
        /// </summary>
        async Task TakeOverExisting()
        {
            Set(Phase.SettingUp, "replacing the older Tinkjam Sync…");
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

        void Swap()
        {
            var old = Path.Combine(home.RuntimeDir, "app-old");
            DeleteDir(old);
            if (Directory.Exists(home.AppDir)) Retrying(() => Directory.Move(home.AppDir, old));
            Retrying(() => Directory.Move(home.StagingDir, home.AppDir));
            DeleteDir(old);
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

        // ---- Connecting and running ----

        /// <summary>Sync's own --connect-only: returns at once when connected, else serves the approval page.</summary>
        async Task<bool> ConnectOnly(bool openBrowser)
        {
            Set(Phase.Connecting, null);
            string lastLine = null;
            var sawUrl = false;
            var code = await Run(new[] { home.ServerEntry, "sync", "--connect-only", "--base-dir", home.BaseDir }, line => ui.Post(_ =>
            {
                if (shuttingDown) return;
                if (line.Trim().Length > 0) lastLine = line.Trim();
                var name = SyncOutput.ParseComputerName(line);
                if (name != null) View.ComputerName = name;
                var url = SyncOutput.ParseApprovalUrl(line);
                if (url != null)
                {
                    sawUrl = true;
                    ApprovalUrl = url;
                    Set(Phase.Approving, null);
                    if (openBrowser) OpenUrl(url);
                    Notify?.Invoke("Approve in your browser", "Sign in to Tinkjam and press Connect to connect " + View.ComputerName + ".", false);
                }
                else if (line.StartsWith("Getting ready"))
                {
                    Set(Phase.Connecting, "getting ready (a one-time download)…");
                }
            }, null), TimeSpan.FromMinutes(35));
            Alive();
            ApprovalUrl = null;
            if (code == 0)
            {
                approvedThisRun |= sawUrl;
                return true;
            }
            if (!sawUrl && !PortFree(ApprovalPort))
                throw new SetupException("port " + ApprovalPort + " is in use by another program, so the sign-in page can't open. Close it, then press Retry.");
            if (sawUrl)
            {
                Set(Phase.NotConnected, "the approval wasn't finished");
                return false;
            }
            throw new SetupException("couldn't check this computer's connection (" + (lastLine ?? "exit code " + code) + ").");
        }

        void StartSync()
        {
            if (shuttingDown) return;
            TryDelete(Path.Combine(home.BaseDir, "sync-starts.json"));
            Log.App("Starting Tinkjam Sync");
            Process process = null;
            try
            {
                process = Spawn(new[] { home.ServerEntry, "sync", "--background", "--base-dir", home.BaseDir }, null, false);
            }
            catch (Exception error)
            {
                Set(Phase.Stopped, "Tinkjam Sync couldn't start (" + error.Message + ").");
                return;
            }
            sync = process;
            syncPid = process.Id;
            syncStartedAt = DateTime.UtcNow;
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
                    await Exclusive(async () => { await TakeOverExisting(); StartSync(); });
                    break;
                case SyncExit.AlreadyRunning:
                    Set(Phase.Stopped, "another Tinkjam Sync is running on this computer.");
                    break;
                default:
                    var now = DateTime.UtcNow;
                    crashes.Add(now);
                    var wait = Backoff.Next(crashes, now);
                    if (wait == null)
                    {
                        Set(Phase.Stopped, "Tinkjam Sync keeps stopping (exit code " + code + "). Press Retry, or open the log.");
                        Notify?.Invoke("Tinkjam Sync stopped", "It kept stopping. Open the tray menu to retry.", false);
                        break;
                    }
                    Set(Phase.Connecting, "restarting in " + (int)wait.Value.TotalSeconds + " seconds…");
                    restart.Interval = (int)wait.Value.TotalMilliseconds;
                    restart.Start();
                    break;
            }
        }

        void Poll()
        {
            if (sync == null) { poll.Stop(); return; }
            var status = StatusFile.Read(home.StatusPath, syncPid);
            if (status != null && status.Reachable)
            {
                poll.Stop();
                if (View.Phase != Phase.Connected)
                {
                    Set(Phase.Connected, null);
                    if (approvedThisRun || Interactive)
                        Notify?.Invoke("Connected", "Your agents on " + View.ComputerName + " are now available on your Tinkjam boards.", false);
                    approvedThisRun = false;
                }
                return;
            }
            var slow = DateTime.UtcNow - syncStartedAt > SlowAfter;
            Set(Phase.Connecting, slow && status?.Reason != null ? "waiting on: " + status.Reason : null);
        }

        async Task StopSync()
        {
            var running = sync;
            sync = null;
            poll.Stop();
            restart.Stop();
            if (running == null) return;
            Log.App("Stopping Tinkjam Sync");
            job.Terminate();
            await Task.Run(() => { try { running.WaitForExit(10000); } catch (Exception) { } });
        }

        // ---- Updates ----

        public async Task CheckForUpdates(bool manual)
        {
            try
            {
                var manifest = await Net.GetJson(AppManifestUrl, "check for updates");
                var version = Json.Text(manifest, "version");
                var url = Json.Text(manifest, "url");
                var sha = Json.Text(manifest, "sha256");
                if (Versions.IsNewer(AppInfo.Version, version) && AllowedUrl(url))
                {
                    if (View.UpdateVersion != version || !UpdateReady)
                    {
                        var path = Path.Combine(Path.GetTempPath(), "TinkjamSyncSetup-" + Regex.Replace(version, "[^0-9A-Za-z.]", "-") + ".exe");
                        await Net.Download(url, path, "download the update", null);
                        if (!Checksum.Matches(path, sha))
                        {
                            TryDelete(path);
                            throw new SetupException("the update download was damaged (checksum mismatch); it tries again tomorrow.");
                        }
                        updatePath = path;
                        View.UpdateVersion = version;
                        Log.App("Update " + version + " downloaded and verified");
                        Changed?.Invoke();
                        Notify?.Invoke("Update ready", "Choose \"Restart to update\" in the Tinkjam Sync menu to update to version " + version + ".", false);
                    }
                }
                else if (manual)
                {
                    Notify?.Invoke("Tinkjam Sync is up to date", "Version " + AppInfo.Version + ".", false);
                }
            }
            catch (SetupException error)
            {
                Log.App("Update check: " + error.Message);
                if (manual) Notify?.Invoke("Couldn't check for updates", error.Message, false);
            }
            await RefreshPackage();
        }

        /// <summary>A newer Sync package replaces the installed one, with Sync stopped only for the swap.</summary>
        async Task RefreshPackage()
        {
            if (View.Busy || shuttingDown || nodeExe == null || View.Phase == Phase.SettingUp || View.Phase == Phase.Approving) return;
            string latest;
            try
            {
                latest = Json.Text(await Net.GetJson(SyncManifestUrl, "check for a newer Tinkjam Sync"), "version");
            }
            catch (SetupException error)
            {
                Log.App("Sync update check: " + error.Message);
                return;
            }
            if (!Versions.IsNewer(settings.SyncVersion, latest)) return;
            Log.App("Updating Tinkjam Sync from " + settings.SyncVersion + " to " + latest);
            var wasRunning = sync != null;
            var phase = View.Phase;
            await Exclusive(async () =>
            {
                await InstallPackage(takeover: false, quiet: true);
                if (wasRunning) StartSync();
                else Set(phase, View.Detail);
            });
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
            var path = Environment.GetEnvironmentVariable("PATH") ?? "";
            // Agents Sync starts are found on PATH; the person's own Node, if any, stays theirs.
            info.EnvironmentVariables["PATH"] = nodeFirstOnPath ? nodeDir + ";" + path : path + ";" + nodeDir;
            info.EnvironmentVariables["T3CODE_HOME"] = home.BaseDir;
            info.EnvironmentVariables["T3CODE_HOSTED_APP_URL"] = AppUrl;
            info.EnvironmentVariables["TINKJAM_SYNC_URL"] = SyncUrl;
            info.EnvironmentVariables["npm_config_update_notifier"] = "false";
            info.EnvironmentVariables["NO_COLOR"] = "1";
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

        void Set(Phase phase, string detail)
        {
            if (View.Phase == phase && View.Detail == detail) return;
            var phaseChanged = View.Phase != phase;
            View.Phase = phase;
            View.Detail = detail;
            if (phaseChanged || phase == Phase.Stopped) Log.App("Now: " + MenuModel.StatusLine(View));
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
