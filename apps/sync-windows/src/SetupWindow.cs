using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace TinkjamSync
{
    /// <summary>
    /// The first setup and the connect step, in our own window (Doop frame rv8Wt6cVnY): the cobalt art
    /// half, and a half that says what is really happening. It raises command ids; the host acts.
    /// </summary>
    sealed class SetupWindow : Surface
    {
        const float W = 760, H = 460, ArtW = 320, Pad = 40, TopPad = 64;
        AppView view;
        List<AgentKind> agents;
        readonly Timer motion = new Timer { Interval = 40 };
        string heading = "", line = "", button;

        public event Action<string> Command;

        public SetupWindow(AppView view, List<AgentKind> agents)
        {
            this.view = view;
            this.agents = agents;
            ShowInTaskbar = true;
            StartPosition = FormStartPosition.Manual;
            try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch (Exception) { }
            motion.Tick += (s, e) => { if (Visible && WindowState != FormWindowState.Minimized) Invalidate(BarBounds()); };
            FormClosed += (s, e) => motion.Dispose();
        }

        protected override CreateParams CreateParams
        {
            get
            {
                // A system menu and a minimise box make Alt+F4, Alt+Space and the taskbar button behave as anywhere else.
                var p = base.CreateParams;
                p.Style |= Win.WS_SYSMENU | Win.WS_MINIMIZEBOX;
                return p;
            }
        }

        protected override bool Draggable => true;

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            Relayout();
        }

        /// <summary>Centred on the screen the person is looking at (where the pointer is), at that screen's scale.</summary>
        public void Place()
        {
            var screen = Screen.FromPoint(Cursor.Position).WorkingArea;
            scale = Win.ScaleAt(new Point(screen.Left + screen.Width / 2, screen.Top + screen.Height / 2));
            var size = new Size(Px(W), Px(H));
            Size = size;
            Location = new Point(screen.Left + (screen.Width - size.Width) / 2, screen.Top + (screen.Height - size.Height) / 2);
        }

        /// <summary>The app is started by Explorer, so its window can open behind the browser or a folder.</summary>
        public void ComeForward()
        {
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            TopMost = true;
            Activate();
            TopMost = false;
        }

        public void Update(AppView next, List<AgentKind> found)
        {
            view = next;
            agents = found;
            Relayout();
        }

        protected override void OnDpiChanged(float newScale, Rectangle suggested)
        {
            if (Appearance.ScaleOverride != null) return;
            scale = newScale;
            Bounds = suggested;
            Relayout();
        }

        protected override void Relayout()
        {
            base.Relayout();
            var animate = Installing && view.Percent == null && Animations();
            if (animate != motion.Enabled) motion.Enabled = animate;
            AccessibleName = heading;
            AccessibleDescription = line;
        }

        static bool Animations() => SystemInformation.UIEffectsEnabled;

        bool Installing => view.Phase == Phase.SettingUp && !view.Installed;

        public string Describe() => heading + " | " + line + (button == null ? "" : " | [" + button + "]");

        Rectangle BarBounds() => Rectangle.Round(new RectangleF(S(ArtW + Pad) - 4, S(TopPad + 35 + 36) - 4, S(W - ArtW - 2 * Pad) + 8, S(8) + 8));

        protected override void Press(string id)
        {
            switch (id)
            {
                case "min": WindowState = FormWindowState.Minimized; break;
                case "close":
                case "done": Close(); break;
                default: Command?.Invoke(id); break;
            }
        }

        protected override Size Render(Graphics g, bool draw)
        {
            var size = new Size(Px(W), Px(H));
            if (draw) DrawArt(g);
            DrawCaptionButtons(g, draw);

            var x = S(ArtW + Pad);
            var width = S(W - ArtW - 2 * Pad);
            var y = S(TopPad);
            if (Installing) RenderInstalling(g, draw, x, y, width);
            else RenderChecklist(g, draw, x, y, width);

            // Bottom row: the login item, and Cancel while installing.
            var bottom = S(H - 30);
            var box = new RectangleF(x, bottom - S(17), S(16), S(16));
            var label = "Start when I sign in to Windows";
            var labelFont = Brand.Body(S(13));
            var labelW = Ink.Width(g, label, labelFont);
            var autostart = AddHit("autostart", new RectangleF(box.X, box.Y - S(2), S(24) + labelW, S(20)), S(4));
            if (draw)
            {
                if (view.StartWithWindows)
                {
                    Ink.FillRound(g, colors.Button, box, S(4));
                    Ink.Check(g, colors.ButtonText, box, S(1.8f));
                }
                else Ink.Ring(g, colors.Quiet, RectangleF.Inflate(box, -S(0.5f), -S(0.5f)), S(4), S(1.2f));
                Ink.Text(g, label, labelFont, colors.Body, box.Right + S(8), box.Y + S(8) - labelFont.Height / 2f);
                FocusRing(g, autostart);
            }
            if (Installing)
            {
                var font = Brand.Body(S(13), true);
                var cw = Ink.Width(g, "Cancel", font);
                var cancel = AddHit("cancel", new RectangleF(S(W - Pad) - cw, bottom - S(19), cw, S(20)), S(4));
                if (draw)
                {
                    Ink.Text(g, "Cancel", font, IsHover("cancel") ? colors.Text : colors.Quiet, cancel.Bounds.X, cancel.Bounds.Y + S(10) - font.Height / 2f);
                    FocusRing(g, cancel);
                }
            }
            return size;
        }

        void DrawArt(Graphics g)
        {
            var art = new RectangleF(0, 0, S(ArtW), S(H));
            var image = Brand.Art;
            var state = g.Save();
            g.SetClip(art);
            using (var brush = new SolidBrush(Color.FromArgb(0x2F, 0x5B, 0xEA))) g.FillRectangle(brush, art);
            if (image != null)
            {
                g.InterpolationMode = System.Drawing.Drawing2D.InterpolationMode.HighQualityBicubic;
                var cover = Math.Max(art.Width / image.Width, art.Height / image.Height);
                var iw = image.Width * cover;
                var ih = image.Height * cover;
                g.DrawImage(image, new RectangleF((art.Width - iw) / 2, (art.Height - ih) / 2, iw, ih));
            }
            using (var tint = new SolidBrush(Color.FromArgb(102, 0x1C, 0x3F, 0xBF))) g.FillRectangle(tint, art);

            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
            var markSize = S(29);
            Ink.Mark(g, new RectangleF(S(28), S(28), markSize, markSize), Ink.MarkTone.Cream);
            var word = Brand.Heading(S(22));
            Ink.Tracked(g, "tinkjam", word, Color.White, S(28) + markSize + S(9), S(28) + markSize / 2 - word.Height / 2f - S(1), -0.035f);

            var headline = Brand.Heading(S(36));
            var lines = Ink.TrackedLines(g, "bring your agent to your team's board", headline, S(ArtW - 28 - 24), -0.035f);
            var lineH = S(36 * 1.1f);
            var y = S(H - 30) - lines.Count * lineH;
            foreach (var text in lines)
            {
                Ink.Tracked(g, text, headline, Color.White, S(28), y - S(2), -0.035f);
                y += lineH;
            }
            g.Restore(state);
            g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.ClearTypeGridFit;
        }

        void DrawCaptionButtons(Graphics g, bool draw)
        {
            var w = S(46);
            var h = S(32);
            var min = AddHit("min", new RectangleF(S(W) - 2 * w, 0, w, h), 0);
            var close = AddHit("close", new RectangleF(S(W) - w, 0, w, h), 0);
            if (!draw) return;
            foreach (var hit in new[] { min, close })
            {
                var hot = IsHover(hit.Id) || pressed == hit.Id;
                var glyph = colors.Body;
                if (hot && hit.Id == "close")
                {
                    using (var red = new SolidBrush(Color.FromArgb(0xC4, 0x2B, 0x1C))) g.FillRectangle(red, hit.Bounds);
                    glyph = Color.White;
                }
                else if (hot) using (var brush = new SolidBrush(colors.CaptionHover)) g.FillRectangle(brush, hit.Bounds);
                var cx = hit.Bounds.X + w / 2;
                var cy = hit.Bounds.Y + h / 2;
                var half = S(5);
                using (var pen = new Pen(glyph, Math.Max(1, S(1))))
                {
                    var state = g.Save();
                    g.SmoothingMode = hit.Id == "min" ? System.Drawing.Drawing2D.SmoothingMode.None : System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
                    if (hit.Id == "min") g.DrawLine(pen, cx - half, (float)Math.Round(cy), cx + half, (float)Math.Round(cy));
                    else
                    {
                        g.DrawLine(pen, cx - half, cy - half, cx + half, cy + half);
                        g.DrawLine(pen, cx + half, cy - half, cx - half, cy + half);
                    }
                    g.Restore(state);
                }
                if (IsFocused(hit.Id)) Ink.Ring(g, colors.Link, RectangleF.Inflate(hit.Bounds, -S(2), -S(2)), S(2), S(2));
            }
        }

        float Heading(Graphics g, bool draw, string text, float x, float y)
        {
            heading = text;
            if (draw)
            {
                var state = g.Save();
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                Ink.Tracked(g, text, Brand.Heading(S(32)), colors.Text, x - S(1), y - S(3), -0.03f);
                g.Restore(state);
            }
            return y + S(35);
        }

        void RenderInstalling(Graphics g, bool draw, float x, float y, float width)
        {
            y = Heading(g, draw, "Installing Tinkjam Sync", x, y) + S(36);
            button = null;
            line = InstallSteps.Caption(view);
            if (draw)
            {
                var track = new RectangleF(x, y, width, S(8));
                Ink.FillRound(g, colors.Track, track, S(4));
                var done = (float)InstallSteps.Done(view);
                if (done > 0) Ink.FillRound(g, colors.Button, new RectangleF(x, y, Math.Max(S(8), width * done), S(8)), S(4));
                if (view.Percent == null && motion.Enabled)
                {
                    // The step has no percent to show: a short block moves through this step's share of the bar.
                    var share = width / InstallSteps.Count;
                    var block = share * 0.45f;
                    var t = (Environment.TickCount % 1600) / 1600f;
                    var bx = x + width * done + (share - block) * (float)(0.5 - 0.5 * Math.Cos(t * 2 * Math.PI));
                    Ink.FillRound(g, colors.Button, new RectangleF(bx, y, block, S(8)), S(4));
                }
                else if (view.Percent == null && done == 0)
                    Ink.FillRound(g, colors.Button, new RectangleF(x, y, S(8), S(8)), S(4));
            }
            y += S(8) + S(10);
            var font = Brand.Body(S(13));
            var step = "Step " + InstallSteps.Of(view) + " of " + InstallSteps.Count;
            if (draw)
            {
                var stepW = Ink.Width(g, step, font);
                Ink.Text(g, line, font, colors.Quiet, x, y, width - stepW - S(12));
                Ink.Text(g, step, font, colors.Quiet, x + width, y, align: StringAlignment.Far);
            }
            y += S(18) + S(34);
            var found = Words.Found(agents?.Select(a => a.Name).ToList(), " on this PC");
            if (agents != null) Row(g, draw, x, y, width, found != null ? RowMark.Done : RowMark.None, found ?? Words.NoAgents, false);
        }

        enum RowMark { Done, Pending, None, Problem }

        float Row(Graphics g, bool draw, float x, float y, float width, RowMark mark, string text, bool strong)
        {
            var font = Brand.Body(S(13), strong);
            var circle = new RectangleF(x, y, S(20), S(20));
            var textX = x + S(30);
            var height = Math.Max(S(20), Ink.Text(g, text, font, colors.Body, textX, y, width - S(30), false));
            if (!draw) return height;
            switch (mark)
            {
                case RowMark.Done:
                    Ink.Dot(g, colors.Success, circle.X + circle.Width / 2, circle.Y + circle.Height / 2, circle.Width);
                    Ink.Check(g, Appearance.IsDark ? colors.Surface : Color.White, RectangleF.Inflate(circle, -S(4.5f), -S(4.5f)), S(2.2f));
                    break;
                case RowMark.Pending:
                    Ink.Dot(g, colors.Tint, circle.X + S(10), circle.Y + S(10), S(20));
                    Ink.Dot(g, colors.Link, circle.X + S(10), circle.Y + S(10), S(8));
                    break;
                case RowMark.Problem:
                    Ink.Dot(g, colors.Sun, circle.X + S(10), circle.Y + S(10), S(20));
                    using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                    using (var brush = new SolidBrush(Color.FromArgb(0x17, 0x14, 0x1C)))
                        g.DrawString("!", Brand.Body(S(13), true), brush, new RectangleF(circle.X, circle.Y + S(0.5f), circle.Width, circle.Height), format);
                    break;
                default:
                    Ink.Ring(g, colors.Rule, RectangleF.Inflate(circle, -S(1), -S(1)), S(9), S(1.5f));
                    break;
            }
            var lineH = font.GetHeight(g);
            Ink.Text(g, text, font, strong ? colors.Text : colors.Body, textX, y + S(10) - Math.Min(lineH, height) / 2f, width - S(30));
            return height;
        }

        void RenderChecklist(Graphics g, bool draw, float x, float y, float width)
        {
            string title;
            switch (view.Phase)
            {
                case Phase.Connected: title = "This PC is connected"; break;
                case Phase.Stopped: title = view.Installed ? "Tinkjam Sync stopped" : "Couldn't install Tinkjam Sync"; break;
                case Phase.Disconnecting: title = "Disconnecting this PC"; break;
                default: title = "Getting this PC ready"; break;
            }
            y = Heading(g, draw, title, x, y) + S(24);

            var rows = new List<(RowMark, string)>();
            if (view.Installed) rows.Add((RowMark.Done, "Tinkjam Sync installed"));
            if (agents != null)
            {
                var found = Words.Found(agents.Select(a => a.Name).ToList());
                rows.Add(found != null ? (RowMark.Done, found) : (RowMark.None, Words.NoAgents));
            }
            if (view.Phase == Phase.Stopped) rows.Add((RowMark.Problem, Words.Problem(view.Detail)));
            else if (view.Phase == Phase.Connected) rows.Add((RowMark.Done, "Connected to your account"));
            else if (view.Phase != Phase.Disconnecting) rows.Add((RowMark.Pending, "Connect to your account"));
            foreach (var (mark, text) in rows) y += Row(g, draw, x, y, width, mark, text, true) + S(18);

            string id = null;
            button = null;
            line = null;
            switch (view.Phase)
            {
                case Phase.Approving: id = "open-again"; button = "Connect"; line = MenuModel.Title(view); break;
                case Phase.NotConnected: id = "connect"; button = "Connect"; line = view.Detail; break;
                case Phase.Stopped: id = "retry"; button = "Retry"; break;
                case Phase.Connected: id = "done"; button = "Done"; break;
                case Phase.SettingUp: line = InstallSteps.Caption(view); break;
                case Phase.Disconnecting: line = MenuModel.Title(view); break;
                default: line = MenuModel.DetailText(view) is string d ? Words.Capitalized(d) : MenuModel.Title(view); break;
            }
            y += S(14) - S(18) + S(4);
            if (button != null)
            {
                var font = Brand.Body(S(13), true);
                var bw = Ink.Width(g, button, font) + S(44);
                var enabled = !(view.Busy && (id == "retry" || id == "connect"));
                var hit = AddHit(id, new RectangleF(x, y, Math.Max(bw, S(96)), S(36)), S(6), enabled);
                if (draw)
                {
                    var fill = !enabled ? Color.FromArgb(110, colors.Button) : IsHover(id) || pressed == id ? Color.FromArgb(0x1C, 0x3F, 0xBF) : colors.Button;
                    Ink.FillRound(g, fill, hit.Bounds, S(6));
                    using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                    using (var brush = new SolidBrush(colors.ButtonText))
                        g.DrawString(button, font, brush, hit.Bounds, format);
                    FocusRing(g, hit);
                }
                y += S(36) + S(12);
            }
            if (!string.IsNullOrEmpty(line) && draw)
                Ink.Text(g, line, Brand.Body(S(13)), colors.Quiet, x, y, width);
        }

        protected override AccessibleObject CreateAccessibilityInstance() => new SurfaceAccessible(this, () => hits, Press, HitName);

        static string HitName(string id)
        {
            switch (id)
            {
                case "min": return "Minimise";
                case "close": return "Close";
                case "cancel": return "Cancel";
                case "autostart": return "Start when I sign in to Windows";
                case "retry": return "Retry";
                case "done": return "Done";
                default: return "Connect";
            }
        }
    }
}
