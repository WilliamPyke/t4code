using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace TinkjamSync
{
    /// <summary>The tray icon and its panel. All it knows is the engine's view.</summary>
    public sealed class TrayApp : ApplicationContext
    {
        readonly Home home;
        readonly SyncEngine engine;
        readonly NotifyIcon tray;
        readonly TrayPanel panel = new TrayPanel();
        readonly Dictionary<TrayIcon, Icon> icons = new Dictionary<TrayIcon, Icon>();
        readonly SynchronizationContext ui;
        readonly EventWaitHandle[] listeners;
        readonly System.Windows.Forms.Timer workingPoll = new System.Windows.Forms.Timer { Interval = 2000 };
        SetupWindow window;
        List<AgentKind> agents;
        HashSet<string> working = new HashSet<string>();
        bool balloonConnects, closed, scanning;
        int windowRequestsSeen;
        string lastDescription;

        public TrayApp(Home home, Settings settings, AppArgs args)
        {
            this.home = home;
            ui = SynchronizationContext.Current;
            var size = SystemInformation.SmallIconSize.Width;
            foreach (TrayIcon kind in Enum.GetValues(typeof(TrayIcon))) icons[kind] = MarkIcon.Draw(size, kind);
            tray = new NotifyIcon { Icon = icons[TrayIcon.Grey], Text = "Tinkjam Sync", Visible = true };
            // Left or right, a click opens the panel; a click while it is open (which already hid it) leaves it shut.
            tray.MouseUp += (s, e) => { if (e.Button == MouseButtons.Left || e.Button == MouseButtons.Right) TogglePanel(); };
            tray.BalloonTipClicked += (s, e) => { if (balloonConnects) engine.Connect(); };
            panel.Command += OnCommand;
            panel.VisibleChanged += (s, e) =>
            {
                workingPoll.Enabled = panel.Visible;
                if (panel.Visible) RefreshWorking();
            };
            workingPoll.Tick += (s, e) => RefreshWorking();

            engine = new SyncEngine(home, settings, interactive: !args.Autostart);
            engine.Changed += Render;
            engine.Notify += Balloon;
            listeners = new[]
            {
                Instance.Listen(home, "show", () => ui.Post(_ => OnSecondLaunch(), null)),
                Instance.Listen(home, "dump", () => ui.Post(_ => WriteDump(), null)),
                Instance.Listen(home, "quit", () => ui.Post(_ => Quit(), null)),
            };
            ScanAgents();
            Render();
            engine.Start();
        }

        void Balloon(string title, string text, bool connects)
        {
            if (closed) return;
            balloonConnects = connects;
            try { tray.ShowBalloonTip(5000, title, text, ToolTipIcon.None); }
            catch (Exception error) { Log.App("Couldn't show a notification: " + error.Message); }
        }

        void Render()
        {
            if (closed) return;
            var view = engine.View;
            tray.Icon = icons[MenuModel.Icon(view)];
            tray.Text = MenuModel.Tooltip(view);
            panel.Update(view, agents, working);
            var description = MenuModel.Describe(view);
            if (description != lastDescription)
            {
                lastDescription = description;
                WriteDump();
            }
            UpdateWindow();
        }

        /// <summary>Which agents' commands are on PATH; off the UI thread, then shown.</summary>
        void ScanAgents()
        {
            if (scanning) return;
            scanning = true;
            Task.Run(() => AgentScan.Installed()).ContinueWith(task =>
            {
                scanning = false;
                if (closed) return;
                if (task.Status == TaskStatus.RanToCompletion) agents = task.Result;
                else agents = agents ?? new List<AgentKind>();
                Render();
            }, TaskScheduler.FromCurrentSynchronizationContext());
        }

        void RefreshWorking()
        {
            var next = AgentScan.Working(engine.SyncPid);
            if (next.SetEquals(working)) return;
            working = next;
            panel.Update(engine.View, agents, working);
        }

        void TogglePanel()
        {
            if (panel.Visible) { panel.HidePanel(); return; }
            if ((DateTime.UtcNow - panel.HiddenAt).TotalMilliseconds < 300) return;
            var rect = Win.TrayIconRect(tray);
            var at = rect == null ? Cursor.Position : new Point(rect.Value.Left + rect.Value.Width / 2, rect.Value.Top + rect.Value.Height / 2);
            ScanAgents();
            panel.Update(engine.View, agents, working);
            panel.ShowAt(at);
        }

        void OnCommand(string id)
        {
            switch (id)
            {
                case "open-again": engine.OpenApproval(); break;
                case "retry": engine.Retry(); break;
                case "connect": engine.Connect(); break;
                case "open": SyncEngine.OpenUrl(SyncEngine.AppUrl); break;
                case "disconnect":
                    var answer = MessageBox.Show(
                        "Disconnect this computer from your Tinkjam account?\n\nYour boards won't be able to use the agents on this computer until you connect it again.",
                        "Tinkjam Sync", MessageBoxButtons.YesNo, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
                    if (answer == DialogResult.Yes) engine.Disconnect();
                    break;
                case "autostart": engine.SetStartWithWindows(!engine.View.StartWithWindows); break;
                case "log":
                    try { Process.Start(new ProcessStartInfo("notepad.exe", CommandLine.Quote(home.LogPath)) { UseShellExecute = true }); }
                    catch (Exception error) { Log.App("Couldn't open the log: " + error.Message); }
                    break;
                case "update":
                    if (engine.UpdateReady) engine.ApplyUpdate();
                    else _ = engine.CheckForUpdates(true);
                    break;
                // Cancel stops the setup: Sync and its downloads end with the app; the next start begins again.
                case "cancel":
                case "exit": Quit(); break;
            }
        }

        /// <summary>Someone started the app again: retry if it stopped, else say where it is.</summary>
        void OnSecondLaunch()
        {
            var view = engine.View;
            if (!view.Busy && (view.Phase == Phase.Stopped || view.Phase == Phase.NotConnected))
            {
                engine.Retry();
                return;
            }
            if (window != null && !window.IsDisposed) { window.ComeForward(); return; }
            Balloon("Tinkjam Sync is running", MenuModel.Title(view).TrimEnd('…') + ". " + Words.FindTheIcon, false);
        }

        /// <summary>A window for the first setup and the approval, so nobody hunts for the tray.</summary>
        void UpdateWindow()
        {
            if (engine.WindowRequests != windowRequestsSeen)
            {
                windowRequestsSeen = engine.WindowRequests;
                if (window == null || window.IsDisposed)
                {
                    window = new SetupWindow(engine.View, agents);
                    window.Command += OnCommand;
                    window.Place();
                    window.Show();
                }
                window.ComeForward();
            }
            if (window != null && !window.IsDisposed) window.Update(engine.View, agents);
        }

        void WriteDump()
        {
            try
            {
                var text = MenuModel.Describe(engine.View) +
                           Environment.NewLine + "sync pid: " + (engine.SyncPid?.ToString() ?? "none") +
                           Environment.NewLine + "agents: " + (agents == null ? "looking" : string.Join(", ", agents.Select(a => a.Name + (working.Contains(a.Id) ? " (working)" : "")))) +
                           Environment.NewLine + "window: " + (window != null && !window.IsDisposed && window.Visible ? window.Describe() : "none") +
                           Environment.NewLine + (panel.Visible ? panel.Describe() : "panel: closed");
                Directory.CreateDirectory(Path.GetDirectoryName(home.TrayStatePath));
                File.WriteAllText(home.TrayStatePath, text);
            }
            catch (Exception) { }
        }

        void Quit()
        {
            if (closed) return;
            closed = true;
            engine.Shutdown();
            tray.Visible = false;
            tray.Dispose();
            workingPoll.Dispose();
            foreach (var listener in listeners) listener.Dispose();
            try { File.Delete(home.TrayStatePath); } catch (Exception) { }
            if (window != null && !window.IsDisposed) window.Close();
            panel.Dispose();
            engine.Dispose();
            ExitThread();
        }
    }

    /// <summary>What is on this PC, read where Sync would find it.</summary>
    static class AgentScan
    {
        public static List<AgentKind> Installed()
        {
            var exts = (Environment.GetEnvironmentVariable("PATHEXT") ?? ".COM;.EXE;.BAT;.CMD").Split(';').ToList();
            return AgentCatalog.Installed(EnvPath.Current().Split(';'), exts, File.Exists);
        }

        public static HashSet<string> Working(int? syncPid)
        {
            if (syncPid == null) return new HashSet<string>();
            try { return AgentCatalog.Working(Native.Processes(), syncPid.Value); }
            catch (Exception) { return new HashSet<string>(); }
        }
    }

    /// <summary>
    /// The tray mark at the tray's own size: the single-colour glyph (stem and crossbar) in white on a
    /// tile, as the frame draws it. Cobalt when connected, grey otherwise, and a sun dot cut into the
    /// corner when something waits for the person. A tile reads on light and dark taskbars alike.
    /// </summary>
    static class MarkIcon
    {
        public static Icon Draw(int size, TrayIcon kind)
        {
            var tile = kind == TrayIcon.Color ? Color.FromArgb(0x2F, 0x5B, 0xEA) : Color.FromArgb(0x7C, 0x77, 0x85);
            using (var bitmap = new Bitmap(size, size, System.Drawing.Imaging.PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bitmap))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.ScaleTransform(size / 64f, size / 64f);
                    Ink.FillRound(g, tile, new RectangleF(0, 0, 64, 64), 15);
                    using (var pen = new Pen(Color.White, 9) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                    {
                        using (var stem = new GraphicsPath())
                        {
                            stem.AddLine(37, 12, 37, 39);
                            stem.AddArc(17, 29, 20, 20, 0, 90);
                            stem.AddLine(27, 49, 22, 49);
                            g.DrawPath(pen, stem);
                        }
                        g.DrawLine(pen, 22, 24, 52, 24);
                    }
                    if (kind == TrayIcon.Attention)
                    {
                        // A clear ring keeps the dot apart from the tile on any taskbar colour.
                        g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceCopy;
                        using (var clear = new SolidBrush(Color.Transparent)) g.FillEllipse(clear, 30, 30, 36, 36);
                        g.CompositingMode = System.Drawing.Drawing2D.CompositingMode.SourceOver;
                        using (var dot = new SolidBrush(Color.FromArgb(0xFF, 0xC8, 0x3D))) g.FillEllipse(dot, 36, 36, 28, 28);
                    }
                }
                return Icon.FromHandle(bitmap.GetHicon());
            }
        }
    }
}
