using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

namespace TinkjamSync
{
    /// <summary>The tray icon and its menu. All it knows is the engine's view.</summary>
    public sealed class TrayApp : ApplicationContext
    {
        readonly Home home;
        readonly SyncEngine engine;
        readonly NotifyIcon tray;
        readonly ContextMenuStrip menu = new ContextMenuStrip();
        readonly Dictionary<TrayIcon, Icon> icons = new Dictionary<TrayIcon, Icon>();
        readonly SynchronizationContext ui;
        readonly EventWaitHandle[] listeners;
        Font statusFont;
        SetupWindow window;
        bool balloonConnects, closed;
        int windowRequestsSeen;
        string lastDescription;

        public TrayApp(Home home, Settings settings, AppArgs args)
        {
            this.home = home;
            ui = SynchronizationContext.Current;
            var size = SystemInformation.SmallIconSize.Width;
            foreach (TrayIcon kind in Enum.GetValues(typeof(TrayIcon))) icons[kind] = MarkIcon.Draw(size, kind);
            tray = new NotifyIcon { Icon = icons[TrayIcon.Grey], Text = "Tinkjam Sync", ContextMenuStrip = menu, Visible = true };
            tray.MouseUp += (s, e) => { if (e.Button == MouseButtons.Left) ShowMenu(); };
            tray.BalloonTipClicked += (s, e) => { if (balloonConnects) engine.Connect(); };

            engine = new SyncEngine(home, settings, interactive: !args.Autostart);
            engine.Changed += Render;
            engine.Notify += Balloon;
            listeners = new[]
            {
                Instance.Listen(home, "show", () => ui.Post(_ => OnSecondLaunch(), null)),
                Instance.Listen(home, "dump", () => ui.Post(_ => WriteDump(), null)),
                Instance.Listen(home, "quit", () => ui.Post(_ => Quit(), null)),
            };
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
            BuildMenu();
            var description = MenuModel.Describe(view);
            if (description != lastDescription)
            {
                lastDescription = description;
                WriteDump();
            }
            UpdateWindow();
        }

        /// <summary>The same items keep their place and only change their words, so an open menu does not jump.</summary>
        void BuildMenu()
        {
            var entries = MenuModel.Items(engine.View);
            var same = menu.Items.Count == entries.Count &&
                       entries.Select(entry => entry.Id).SequenceEqual(menu.Items.Cast<ToolStripItem>().Select(item => item.Tag as string));
            if (same)
            {
                for (var i = 0; i < entries.Count; i++)
                {
                    if (!(menu.Items[i] is ToolStripMenuItem item)) continue;
                    if (item.Text != entries[i].Text) item.Text = entries[i].Text;
                    item.Enabled = entries[i].Enabled;
                    item.Checked = entries[i].Checked;
                }
                return;
            }
            menu.SuspendLayout();
            var old = menu.Items.Cast<ToolStripItem>().ToList();
            menu.Items.Clear();
            foreach (var item in old) item.Dispose();
            foreach (var entry in entries)
            {
                if (entry.Separator) { menu.Items.Add(new ToolStripSeparator { Tag = entry.Id }); continue; }
                var item = new ToolStripMenuItem(entry.Text) { Enabled = entry.Enabled, Checked = entry.Checked, Tag = entry.Id };
                if (entry.Id == "status") item.Font = statusFont ?? (statusFont = new Font(item.Font, FontStyle.Bold));
                var id = entry.Id;
                item.Click += (s, e) => OnMenu(id);
                menu.Items.Add(item);
            }
            menu.ResumeLayout();
        }

        void OnMenu(string id)
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

        void ShowMenu()
        {
            // NotifyIcon opens its menu on right-click only; this is the same call for left-click.
            typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(tray, null);
        }

        /// <summary>A small window for the first setup and the approval, so nobody hunts for the tray.</summary>
        void UpdateWindow()
        {
            if (engine.WindowRequests != windowRequestsSeen)
            {
                windowRequestsSeen = engine.WindowRequests;
                if (window == null || window.IsDisposed)
                {
                    window = new SetupWindow(engine);
                    window.Show();
                }
                window.ComeForward();
            }
            if (window != null && !window.IsDisposed) window.Render();
        }

        void WriteDump()
        {
            try
            {
                var text = MenuModel.Describe(engine.View) +
                           Environment.NewLine + "sync pid: " + (engine.SyncPid?.ToString() ?? "none") +
                           Environment.NewLine + "window: " + (window != null && !window.IsDisposed && window.Visible ? window.Describe() : "none");
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
            foreach (var listener in listeners) listener.Dispose();
            try { File.Delete(home.TrayStatePath); } catch (Exception) { }
            if (window != null && !window.IsDisposed) window.Close();
            engine.Dispose();
            ExitThread();
        }
    }

    /// <summary>Sized from the text and the screen's scaling, so nothing is cut off at 150% or 200%.</summary>
    sealed class SetupWindow : Form
    {
        readonly SyncEngine engine;
        readonly Label heading = new Label { AutoSize = true };
        readonly Label detail = new Label { AutoSize = true };
        readonly ProgressBar bar = new ProgressBar { MarqueeAnimationSpeed = 40 };
        readonly Button action = new Button { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink };
        string actionId;

        public SetupWindow(SyncEngine engine)
        {
            this.engine = engine;
            Text = "Tinkjam Sync";
            Icon = MarkIcon.Draw(32, TrayIcon.Color);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.None;
            Font = SystemFonts.MessageBoxFont;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;

            var scale = DeviceDpi / 96f;
            Func<int, int> px = value => (int)Math.Round(value * scale);
            var width = px(420);
            heading.Font = new Font(Font.FontFamily, Font.Size * 1.35f, FontStyle.Bold);
            heading.MaximumSize = detail.MaximumSize = new Size(width, 0);
            heading.Margin = new Padding(0, 0, 0, px(8));
            detail.Margin = new Padding(0, 0, 0, px(12));
            bar.Size = new Size(width, px(8));
            bar.Margin = new Padding(0, 0, 0, px(12));
            action.Padding = new Padding(px(10), px(3), px(10), px(3));
            action.MinimumSize = new Size(px(96), px(30));
            action.Anchor = AnchorStyles.Right;
            action.Margin = new Padding(0);

            var layout = new TableLayoutPanel
            {
                ColumnCount = 1,
                AutoSize = true,
                AutoSizeMode = AutoSizeMode.GrowAndShrink,
                Padding = new Padding(px(20), px(16), px(20), px(16)),
                MinimumSize = new Size(width + px(40), 0),
            };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            foreach (var control in new Control[] { heading, detail, bar, action })
            {
                layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
                layout.Controls.Add(control);
            }
            Controls.Add(layout);
            AcceptButton = action;
            action.Click += (s, e) =>
            {
                if (actionId == "open-again") engine.OpenApproval();
                else if (actionId == "retry") engine.Retry();
                else if (actionId == "connect") engine.Connect();
                else Close();
            };
            Render();
        }

        /// <summary>The app is started by Explorer, so its window can open behind the browser or a folder.</summary>
        public void ComeForward()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            TopMost = true;
            Activate();
            TopMost = false;
        }

        public void Render()
        {
            var view = engine.View;
            var step = MenuModel.DetailText(view);
            string title, text, button;
            switch (view.Phase)
            {
                case Phase.SettingUp:
                    title = "Setting up Tinkjam Sync";
                    text = Words.Capitalized(view.Detail ?? "getting ready") + "…\nThis happens once and takes a few minutes. You can keep using your computer.";
                    button = "Hide";
                    actionId = "close";
                    break;
                case Phase.Approving:
                    title = "Approve in your browser";
                    text = "A Tinkjam page opened in your browser. Sign in there and press Connect to connect " + view.ComputerName + ". This window updates by itself.";
                    button = "Open the page again";
                    actionId = "open-again";
                    break;
                case Phase.Connected:
                    title = "This computer is connected";
                    text = "Tinkjam Sync keeps running in the background and starts with Windows. " + Words.FindTheIcon + " You can close this window.";
                    button = "Done";
                    actionId = "close";
                    break;
                case Phase.Stopped:
                    title = "Tinkjam Sync needs your attention";
                    text = step ?? Words.Unexpected;
                    button = "Try again";
                    actionId = "retry";
                    break;
                case Phase.NotConnected:
                    title = "This computer is not connected";
                    text = (step == null ? "" : step + " ") + "Connect it when you're ready.";
                    button = "Connect";
                    actionId = "connect";
                    break;
                case Phase.Disconnecting:
                    title = "Disconnecting…";
                    text = "This takes a few seconds.";
                    button = "Hide";
                    actionId = "close";
                    break;
                default:
                    title = view.Phase == Phase.Reconnecting ? "Reconnecting this computer…" : "Connecting this computer…";
                    text = step == null ? "This takes a few seconds." : Words.Capitalized(step) + ".";
                    button = "Hide";
                    actionId = "close";
                    break;
            }
            if (heading.Text != title) heading.Text = title;
            if (detail.Text != text) detail.Text = text;
            if (action.Text != button) action.Text = button;
            action.Enabled = !((actionId == "retry" || actionId == "connect") && view.Busy);
            var working = view.Phase == Phase.SettingUp || view.Phase == Phase.Connecting || view.Phase == Phase.Reconnecting ||
                          view.Phase == Phase.Approving || view.Phase == Phase.Disconnecting;
            bar.Visible = working;
            var measured = working && view.Percent != null;
            var style = measured ? ProgressBarStyle.Continuous : ProgressBarStyle.Marquee;
            if (bar.Style != style) bar.Style = style;
            if (measured) bar.Value = Math.Max(0, Math.Min(100, view.Percent.Value));
        }

        public string Describe() => heading.Text + " | " + detail.Text + " | [" + action.Text + "]";
    }

    /// <summary>The Tinkjam mark (apps/web/public/tinkjam-mark.svg) drawn at the tray's own size.</summary>
    static class MarkIcon
    {
        public static Icon Draw(int size, TrayIcon kind)
        {
            Color jam = Color.FromArgb(0xDB, 0x2D, 0x55), note = Color.FromArgb(0xFF, 0xC8, 0x3D), cream = Color.FromArgb(0xFF, 0xF7, 0xEC);
            if (kind != TrayIcon.Color)
            {
                jam = Color.FromArgb(0x8A, 0x86, 0x8E);
                note = Color.FromArgb(0xD6, 0xD3, 0xD9);
                cream = Color.FromArgb(0xF4, 0xF2, 0xF5);
            }
            using (var bitmap = new Bitmap(size, size))
            {
                using (var g = Graphics.FromImage(bitmap))
                {
                    g.SmoothingMode = SmoothingMode.AntiAlias;
                    g.ScaleTransform(size / 64f, size / 64f);
                    using (var jamBrush = new SolidBrush(jam))
                    using (var background = RoundRect(0, 0, 64, 64, 15))
                        g.FillPath(jamBrush, background);
                    using (var pen = new Pen(cream, 9) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                    using (var stem = new GraphicsPath())
                    {
                        stem.AddLine(37, 12, 37, 39);
                        stem.AddArc(17, 29, 20, 20, 0, 90);
                        stem.AddLine(27, 49, 22, 49);
                        g.DrawPath(pen, stem);
                    }
                    using (var noteBrush = new SolidBrush(note))
                    {
                        using (var bar = RoundRect(20, 20, 32, 10, 5)) g.FillPath(noteBrush, bar);
                        g.FillEllipse(noteBrush, 16 - 5.2f, 49 - 5.2f, 10.4f, 10.4f);
                    }
                    if (kind == TrayIcon.Attention)
                    {
                        // An amber dot in the corner: something here waits for the person.
                        using (var ring = new SolidBrush(Color.White)) g.FillEllipse(ring, 34, 34, 30, 30);
                        using (var dot = new SolidBrush(Color.FromArgb(0xF5, 0x9E, 0x0B))) g.FillEllipse(dot, 38, 38, 22, 22);
                    }
                }
                return Icon.FromHandle(bitmap.GetHicon());
            }
        }

        static GraphicsPath RoundRect(float x, float y, float width, float height, float radius)
        {
            var d = radius * 2;
            var path = new GraphicsPath();
            path.AddArc(x, y, d, d, 180, 90);
            path.AddArc(x + width - d, y, d, d, 270, 90);
            path.AddArc(x + width - d, y + height - d, d, d, 0, 90);
            path.AddArc(x, y + height - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }
    }
}
