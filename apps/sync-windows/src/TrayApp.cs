using System;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.IO;
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
        readonly Icon colorIcon, greyIcon;
        readonly SynchronizationContext ui;
        readonly EventWaitHandle[] listeners;
        SetupWindow window;
        bool balloonConnects, closed, windowShown;
        string lastDescription;

        public TrayApp(Home home, Settings settings, AppArgs args)
        {
            this.home = home;
            ui = SynchronizationContext.Current;
            var size = SystemInformation.SmallIconSize.Width;
            colorIcon = MarkIcon.Draw(size, false);
            greyIcon = MarkIcon.Draw(size, true);
            tray = new NotifyIcon { Icon = greyIcon, Text = "Tinkjam Sync", ContextMenuStrip = menu, Visible = true };
            tray.MouseUp += (s, e) => { if (e.Button == MouseButtons.Left) ShowMenu(); };
            tray.BalloonTipClicked += (s, e) => { if (balloonConnects) engine.Connect(); };

            engine = new SyncEngine(home, settings, interactive: !args.Autostart);
            engine.Changed += Render;
            engine.Notify += (title, text, connects) =>
            {
                balloonConnects = connects;
                tray.ShowBalloonTip(5000, title, text, ToolTipIcon.None);
            };
            listeners = new[]
            {
                Instance.Listen(home, "show", () => ui.Post(_ => OnSecondLaunch(), null)),
                Instance.Listen(home, "dump", () => ui.Post(_ => WriteDump(), null)),
                Instance.Listen(home, "quit", () => ui.Post(_ => Quit(), null)),
            };
            Render();
            engine.Start();
        }

        void Render()
        {
            if (closed) return;
            var view = engine.View;
            tray.Icon = MenuModel.Colored(view) ? colorIcon : greyIcon;
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

        void BuildMenu()
        {
            menu.SuspendLayout();
            menu.Items.Clear();
            foreach (var entry in MenuModel.Items(engine.View))
            {
                if (entry.Separator) { menu.Items.Add(new ToolStripSeparator()); continue; }
                var item = new ToolStripMenuItem(entry.Text) { Enabled = entry.Enabled, Checked = entry.Checked };
                if (entry.Id == "status") item.Font = new Font(item.Font, FontStyle.Bold);
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
                        "Disconnect this computer from your Tinkjam account?\n\nIts agents will no longer be available on your boards until you connect it again.",
                        "Tinkjam Sync", MessageBoxButtons.OKCancel, MessageBoxIcon.Question, MessageBoxDefaultButton.Button2);
                    if (answer == DialogResult.OK) engine.Disconnect();
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
            if (window != null && !window.IsDisposed) { window.Activate(); return; }
            balloonConnects = false;
            tray.ShowBalloonTip(5000, "Tinkjam Sync is running", MenuModel.StatusLine(view) + ". Its menu is in the tray, by the clock.", ToolTipIcon.None);
        }

        void ShowMenu()
        {
            // NotifyIcon opens its menu on right-click only; this is the same call for left-click.
            typeof(NotifyIcon).GetMethod("ShowContextMenu", BindingFlags.Instance | BindingFlags.NonPublic)?.Invoke(tray, null);
        }

        /// <summary>A small window for the first setup and the approval, so nobody hunts for the tray.</summary>
        void UpdateWindow()
        {
            var view = engine.View;
            var wanted = engine.Interactive && !windowShown && (engine.Downloading || view.Phase == Phase.Approving);
            if (wanted)
            {
                windowShown = true;
                window = new SetupWindow(engine);
                window.Show();
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

    sealed class SetupWindow : Form
    {
        readonly SyncEngine engine;
        readonly Label heading = new Label { AutoSize = false, Dock = DockStyle.Top, Height = 34 };
        readonly Label detail = new Label { AutoSize = false, Dock = DockStyle.Top, Height = 44 };
        readonly ProgressBar bar = new ProgressBar { Dock = DockStyle.Top, Height = 14, Style = ProgressBarStyle.Marquee, MarqueeAnimationSpeed = 40 };
        readonly Button action = new Button { AutoSize = true, Anchor = AnchorStyles.Right | AnchorStyles.Bottom };
        readonly System.Windows.Forms.Timer closeLater = new System.Windows.Forms.Timer { Interval = 6000 };
        string actionId;

        public SetupWindow(SyncEngine engine)
        {
            this.engine = engine;
            Text = "Tinkjam Sync";
            Icon = MarkIcon.Draw(32, false);
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoScaleMode = AutoScaleMode.Font;
            Font = SystemFonts.MessageBoxFont;
            ClientSize = new Size(440, 150);
            Padding = new Padding(18, 14, 18, 14);
            heading.Font = new Font(Font.FontFamily, Font.Size * 1.35f, FontStyle.Bold);
            var buttons = new Panel { Dock = DockStyle.Bottom, Height = 34 };
            action.Location = new Point(buttons.Width - 100, 4);
            buttons.Controls.Add(action);
            buttons.Resize += (s, e) => action.Left = buttons.ClientSize.Width - action.Width;
            Controls.Add(buttons);
            Controls.Add(bar);
            Controls.Add(new Panel { Dock = DockStyle.Top, Height = 6 });
            Controls.Add(detail);
            Controls.Add(heading);
            action.Click += (s, e) =>
            {
                if (actionId == "open-again") engine.OpenApproval();
                else if (actionId == "retry") engine.Retry();
                else Close();
            };
            closeLater.Tick += (s, e) => { closeLater.Stop(); Close(); };
            FormClosed += (s, e) => closeLater.Dispose();
            Render();
        }

        public void Render()
        {
            var view = engine.View;
            string title, text, button;
            switch (view.Phase)
            {
                case Phase.Approving:
                    title = "Approve in your browser";
                    text = "A page opened in your browser. Sign in to Tinkjam and press Connect to connect " + view.ComputerName + ".";
                    button = "Open again";
                    actionId = "open-again";
                    break;
                case Phase.Connected:
                    title = "Connected";
                    text = "Tinkjam Sync runs in the tray, by the clock, and starts with Windows. You can close this window.";
                    button = "Close";
                    actionId = "close";
                    if (!closeLater.Enabled) closeLater.Start();
                    break;
                case Phase.Stopped:
                    title = "Tinkjam Sync stopped";
                    text = char.ToUpper(view.Detail[0]) + view.Detail.Substring(1);
                    button = "Retry";
                    actionId = "retry";
                    break;
                case Phase.NotConnected:
                    title = "Not connected";
                    text = "Use Connect… in the Tinkjam Sync menu in the tray when you're ready.";
                    button = "Close";
                    actionId = "close";
                    break;
                default:
                    title = "Setting up Tinkjam Sync…";
                    text = MenuModel.StatusLine(view);
                    button = "Hide";
                    actionId = "close";
                    break;
            }
            heading.Text = title;
            detail.Text = text;
            action.Text = button;
            action.Enabled = !(actionId == "retry" && view.Busy);
            var busy = view.Phase == Phase.SettingUp || view.Phase == Phase.Connecting || view.Phase == Phase.Approving;
            bar.Visible = busy;
            bar.MarqueeAnimationSpeed = busy ? 40 : 0;
        }

        public string Describe() => heading.Text + " | " + detail.Text + " | [" + action.Text + "]";
    }

    /// <summary>The Tinkjam mark (apps/web/public/tinkjam-mark.svg) drawn at the tray's own size.</summary>
    static class MarkIcon
    {
        public static Icon Draw(int size, bool grey)
        {
            Color jam = Color.FromArgb(0xDB, 0x2D, 0x55), note = Color.FromArgb(0xFF, 0xC8, 0x3D), cream = Color.FromArgb(0xFF, 0xF7, 0xEC);
            if (grey)
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
