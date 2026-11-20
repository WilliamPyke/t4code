using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Windows.Forms;

namespace TinkjamSync
{
    /// <summary>
    /// `--preview-ui`: the real window and panel for one state given on the command line, for design
    /// review and screenshots. It holds no mutex, reads no home, starts nothing, writes no setting and
    /// touches no network, so it runs beside an installed Tinkjam Sync without either noticing.
    /// The agents shown are this PC's real ones.
    /// </summary>
    static class Preview
    {
        public static int Run(AppArgs args)
        {
            Native.AttachParentConsole();
            if (args.PreviewTheme != null) Appearance.DarkOverride = args.PreviewTheme.Equals("dark", StringComparison.OrdinalIgnoreCase);
            Appearance.ScaleOverride = args.PreviewScale;
            var view = new AppView
            {
                Phase = Enum.TryParse<Phase>(args.PreviewPhase ?? "SettingUp", true, out var phase) ? phase : Phase.SettingUp,
                Detail = args.PreviewDetail,
                Percent = args.PreviewPercent,
                ComputerName = System.Net.Dns.GetHostName(),
                Version = AppInfo.ShortVersion,
                Installed = args.PreviewInstalled,
            };
            switch (args.PreviewUpdate)
            {
                case "checking": view.CheckingForUpdates = true; break;
                case "uptodate": view.UpToDate = true; break;
                case null: break;
                default: view.UpdateVersion = args.PreviewUpdate; break;
            }
            var agents = AgentScan.Installed();
            Console.WriteLine("agents on this PC: " + string.Join(", ", agents.ConvertAll(a => a.Name)));

            var window = new SetupWindow(view, agents) { TopMost = true };
            var panel = new TrayPanel { StayOpen = true, SettingsOpen = args.PreviewSettings };
            Action<string> command = id =>
            {
                Console.WriteLine("pressed: " + id + " (preview: nothing happens)");
                if (id == "autostart") view.StartWithWindows = !view.StartWithWindows;
                if (id == "exit" || id == "cancel" || id == "done") Application.ExitThread();
                window.Update(view, agents);
                panel.Update(view, agents, new HashSet<string>());
            };
            window.Command += command;
            panel.Command += command;
            window.FormClosed += (s, e) => { if (!panel.Visible) Application.ExitThread(); };
            panel.VisibleChanged += (s, e) => { if (!panel.Visible && (window.IsDisposed || !window.Visible)) Application.ExitThread(); };

            window.Place();
            window.Show();
            panel.Update(view, agents, new HashSet<string>());
            panel.ShowAt(TrayAnchor());

            // Real key presses into the panel, to see the focus ring where Tab takes it.
            if (args.PreviewTabs > 0)
            {
                var keys = new Timer { Interval = 400 };
                keys.Tick += (s, e) =>
                {
                    keys.Stop();
                    // Posted to the panel itself, never typed into whatever window has the keyboard.
                    Surface.ShowFocusUnfocused = true;
                    for (var i = 0; i < args.PreviewTabs; i++) PostMessage(panel.Handle, 0x0100, (IntPtr)0x09, IntPtr.Zero);
                };
                keys.Start();
            }

            if (args.PreviewShot != null)
            {
                var timer = new Timer { Interval = 1500 };
                timer.Tick += (s, e) =>
                {
                    timer.Stop();
                    Shoot(window, args.PreviewShot + "-installer.png");
                    Shoot(panel, args.PreviewShot + "-panel.png");
                    TrayIcons(args.PreviewShot + "-tray.png");
                    Application.ExitThread();
                };
                timer.Start();
            }
            Application.Run();
            return 0;
        }

        [System.Runtime.InteropServices.DllImport("user32.dll")]
        static extern bool PostMessage(IntPtr hwnd, int message, IntPtr wParam, IntPtr lParam);

        /// <summary>Each tray state at 16, 20, 24 and 32 px on a light and a dark taskbar colour.</summary>
        static void TrayIcons(string path)
        {
            var sizes = new[] { 16, 20, 24, 32 };
            var kinds = (TrayIcon[])Enum.GetValues(typeof(TrayIcon));
            using (var sheet = new Bitmap(2 * (kinds.Length * 40 + 8), sizes.Length * 40 + 8))
            {
                using (var g = Graphics.FromImage(sheet))
                {
                    var half = sheet.Width / 2;
                    using (var light = new SolidBrush(Color.FromArgb(0xF3, 0xF3, 0xF3))) g.FillRectangle(light, 0, 0, half, sheet.Height);
                    using (var dark = new SolidBrush(Color.FromArgb(0x20, 0x20, 0x20))) g.FillRectangle(dark, half, 0, half, sheet.Height);
                    for (var side = 0; side < 2; side++)
                        for (var row = 0; row < sizes.Length; row++)
                            for (var k = 0; k < kinds.Length; k++)
                                using (var icon = MarkIcon.Draw(sizes[row], kinds[k]))
                                    g.DrawIconUnstretched(icon, new Rectangle(side * half + 8 + k * 40, 8 + row * 40, sizes[row], sizes[row]));
                }
                sheet.Save(path, ImageFormat.Png);
            }
        }

        /// <summary>Where the notification area is on the primary screen, from the taskbar's edge.</summary>
        static Point TrayAnchor()
        {
            var screen = Screen.PrimaryScreen;
            var b = screen.Bounds;
            var w = screen.WorkingArea;
            switch (Placement.TaskbarEdge(b, w, Win.PrimaryTaskbarEdge()))
            {
                case Edge.Top: return new Point(w.Right - 100, b.Top + 1);
                case Edge.Left: return new Point(b.Left + 1, w.Bottom - 100);
                case Edge.Right: return new Point(b.Right - 1, w.Bottom - 100);
                default: return new Point(w.Right - 100, b.Bottom - 1);
            }
        }

        /// <summary>What is on screen where the window is, with a margin for its shadow.</summary>
        static void Shoot(Form form, string path)
        {
            var r = form.Bounds;
            r.Inflate(16, 16);
            using (var bitmap = new Bitmap(r.Width, r.Height, PixelFormat.Format32bppArgb))
            {
                using (var g = Graphics.FromImage(bitmap)) g.CopyFromScreen(r.Location, Point.Empty, r.Size);
                bitmap.Save(path, ImageFormat.Png);
            }
            Console.WriteLine("saved " + path + " (" + form.Bounds.Width + "x" + form.Bounds.Height + ")");
        }
    }
}
