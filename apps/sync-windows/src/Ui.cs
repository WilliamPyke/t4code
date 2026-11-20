using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.Drawing.Text;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using Microsoft.Win32;

namespace TinkjamSync
{
    /// <summary>The brand's colours for one mode. Buttons keep white on cobalt in both.</summary>
    sealed class Palette
    {
        public Color Surface, Track, Rule, Text, Body, Quiet, Link, Button, ButtonText, Tint, Success, Sun, SunTint, CaptionHover;

        static Color Hex(int rgb) => Color.FromArgb((rgb >> 16) & 0xFF, (rgb >> 8) & 0xFF, rgb & 0xFF);

        // Quiet is #77727F rather than the brand's #7C7785, which is 4.3:1 on white; this keeps small text at 4.5:1.
        public static readonly Palette Light = new Palette
        {
            Surface = Hex(0xFFFFFF), Track = Hex(0xF6F5F2), Rule = Hex(0xE7E4DE), Text = Hex(0x17141C), Body = Hex(0x4A4652),
            Quiet = Hex(0x77727F), Link = Hex(0x2F5BEA), Button = Hex(0x2F5BEA), ButtonText = Hex(0xFFFFFF), Tint = Hex(0xE9EEFE),
            Success = Hex(0x14634A), Sun = Hex(0xFFC83D), SunTint = Hex(0xFFF3CF), CaptionHover = Color.FromArgb(18, 0x17, 0x14, 0x1C),
        };

        public static readonly Palette Dark = new Palette
        {
            Surface = Hex(0x1B1820), Track = Hex(0x232029), Rule = Hex(0x34303C), Text = Hex(0xF6F3EE), Body = Hex(0xC9C4D1),
            Quiet = Hex(0x928C9C), Link = Hex(0x5B7DFF), Button = Hex(0x2F5BEA), ButtonText = Hex(0xFFFFFF), Tint = Hex(0x1C2550),
            Success = Hex(0x3FBF8F), Sun = Hex(0xFFC83D), SunTint = Hex(0x3A3220), CaptionHover = Color.FromArgb(28, 0xF6, 0xF3, 0xEE),
        };

        public Color ToneColor(Tone tone)
        {
            switch (tone)
            {
                case Tone.Good: return Success;
                case Tone.Busy: return Link;
                case Tone.Attention: return Text;
                default: return Quiet;
            }
        }

        public Color DotColor(Tone tone) => tone == Tone.Attention ? Sun : ToneColor(tone);
    }

    /// <summary>Follows Windows' app mode (Settings, Personalisation, Colours), live.</summary>
    static class Appearance
    {
        const string Key = @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize";
        public static bool? DarkOverride;
        public static float? ScaleOverride;
        static bool dark = Read();
        static bool watching;
        static readonly List<Action> listeners = new List<Action>();

        public static Palette Colors => (DarkOverride ?? dark) ? Palette.Dark : Palette.Light;
        public static bool IsDark => DarkOverride ?? dark;

        static bool Read()
        {
            try
            {
                using (var key = Registry.CurrentUser.OpenSubKey(Key)) return ThemeSetting.IsDark(key?.GetValue("AppsUseLightTheme"));
            }
            catch (Exception) { return false; }
        }

        /// <summary>`onChange` runs on `owner`'s thread whenever the mode flips.</summary>
        public static void Watch(Control owner, Action onChange)
        {
            Action listener = () => { if (owner.IsHandleCreated && !owner.IsDisposed) owner.BeginInvoke(onChange); };
            listeners.Add(listener);
            owner.Disposed += (s, e) => listeners.Remove(listener);
            if (watching) return;
            watching = true;
            SystemEvents.UserPreferenceChanged += (s, e) =>
            {
                if (e.Category != UserPreferenceCategory.General && e.Category != UserPreferenceCategory.Color) return;
                var now = Read();
                if (now == dark) return;
                dark = now;
                foreach (var listener in listeners.ToList()) listener();
            };
        }
    }

    /// <summary>Outfit, the art photo and the agents' marks, all carried inside the exe.</summary>
    static class Brand
    {
        static readonly PrivateFontCollection fonts = new PrivateFontCollection();
        static FontFamily outfit;
        static bool loaded;
        static Image art;
        static readonly Dictionary<string, Image> logos = new Dictionary<string, Image>();

        static Stream Resource(string name) => typeof(Brand).Assembly.GetManifestResourceStream("TinkjamSync." + name);

        /// <summary>Outfit SemiBold, or null (then headings use Segoe UI Semibold).</summary>
        static FontFamily Outfit
        {
            get
            {
                if (loaded) return outfit;
                loaded = true;
                try
                {
                    byte[] data;
                    using (var stream = Resource("Outfit-SemiBold.ttf"))
                    using (var copy = new MemoryStream()) { stream.CopyTo(copy); data = copy.ToArray(); }
                    // GDI+ reads the font from this memory for as long as the process runs: it is never freed.
                    var memory = Marshal.AllocCoTaskMem(data.Length);
                    Marshal.Copy(data, 0, memory, data.Length);
                    fonts.AddMemoryFont(memory, data.Length);
                    outfit = fonts.Families.FirstOrDefault();
                }
                catch (Exception error)
                {
                    Log.App("Couldn't load the Outfit font; using Segoe UI: " + error.Message);
                    outfit = null;
                }
                return outfit;
            }
        }

        static readonly Dictionary<string, Font> cache = new Dictionary<string, Font>();

        static Font Cached(string key, Func<Font> make)
        {
            if (!cache.TryGetValue(key, out var font)) cache[key] = font = make();
            return font;
        }

        /// <summary>Outfit 600 at `px` device pixels.</summary>
        public static Font Heading(float px) => Cached("h" + px, () =>
        {
            var family = Outfit;
            if (family != null)
                foreach (var style in new[] { FontStyle.Regular, FontStyle.Bold })
                    if (family.IsStyleAvailable(style)) return new Font(family, px, style, GraphicsUnit.Pixel);
            return Segoe(px, true);
        });

        public static Font Body(float px, bool strong = false) => Cached((strong ? "s" : "b") + px, () => Segoe(px, strong));

        static Font Segoe(float px, bool strong)
        {
            try
            {
                var font = new Font(strong ? "Segoe UI Semibold" : "Segoe UI", px, FontStyle.Regular, GraphicsUnit.Pixel);
                if (font.Name.StartsWith("Segoe UI", StringComparison.OrdinalIgnoreCase)) return font;
                font.Dispose();
            }
            catch (Exception) { }
            return new Font(SystemFonts.MessageBoxFont.FontFamily, px, strong ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel);
        }

        public static Image Art
        {
            get
            {
                if (art != null) return art;
                try { using (var stream = Resource("art.jpg")) art = Image.FromStream(stream); }
                catch (Exception) { art = null; }
                return art;
            }
        }

        /// <summary>An agent's own mark, or null for one without (it gets its initial).</summary>
        public static Image Logo(string id)
        {
            if (logos.TryGetValue(id, out var image)) return image;
            try
            {
                using (var stream = Resource("agent-" + id + ".png"))
                    image = stream == null ? null : new Bitmap(stream);
            }
            catch (Exception) { image = null; }
            return logos[id] = image;
        }

        /// <summary>Codex and Cursor marks are single-colour: drawn in the text colour so they read in dark mode too.</summary>
        public static bool Monochrome(string id) => id == "codex" || id == "cursor";
    }

    static class Ink
    {
        public static GraphicsPath Round(RectangleF r, float radius)
        {
            var path = new GraphicsPath();
            var d = Math.Min(radius * 2, Math.Min(r.Width, r.Height));
            if (d <= 0.5f) { path.AddRectangle(r); return path; }
            path.AddArc(r.X, r.Y, d, d, 180, 90);
            path.AddArc(r.Right - d, r.Y, d, d, 270, 90);
            path.AddArc(r.Right - d, r.Bottom - d, d, d, 0, 90);
            path.AddArc(r.X, r.Bottom - d, d, d, 90, 90);
            path.CloseFigure();
            return path;
        }

        public static void FillRound(Graphics g, Color color, RectangleF r, float radius)
        {
            using (var brush = new SolidBrush(color))
            using (var path = Round(r, radius)) g.FillPath(brush, path);
        }

        public static void Ring(Graphics g, Color color, RectangleF r, float radius, float width)
        {
            using (var pen = new Pen(color, width))
            using (var path = Round(r, radius)) g.DrawPath(pen, path);
        }

        static readonly StringFormat Typographic = MakeTypographic();

        static StringFormat MakeTypographic()
        {
            var format = (StringFormat)StringFormat.GenericTypographic.Clone();
            format.FormatFlags |= StringFormatFlags.MeasureTrailingSpaces | StringFormatFlags.NoWrap;
            return format;
        }

        /// <summary>Text with tighter tracking, as the brand sets headings; GDI+ has no tracking of its own.</summary>
        public static float Tracked(Graphics g, string text, Font font, Color color, float x, float y, float trackingEm, bool draw = true)
        {
            var tracking = font.Size * trackingEm;
            var start = x;
            using (var brush = new SolidBrush(color))
                foreach (var ch in text)
                {
                    var s = ch.ToString();
                    var w = g.MeasureString(s, font, PointF.Empty, Typographic).Width;
                    if (draw) g.DrawString(s, font, brush, x, y, Typographic);
                    x += w + tracking;
                }
            return x - start - tracking;
        }

        /// <summary>Words wrapped to `width` with tracking; the lines it made.</summary>
        public static List<string> TrackedLines(Graphics g, string text, Font font, float width, float trackingEm)
        {
            var lines = new List<string>();
            var line = "";
            foreach (var word in text.Split(' '))
            {
                var trial = line.Length == 0 ? word : line + " " + word;
                if (line.Length > 0 && Tracked(g, trial, font, Color.Empty, 0, 0, trackingEm, false) > width)
                {
                    lines.Add(line);
                    line = word;
                }
                else line = trial;
            }
            if (line.Length > 0) lines.Add(line);
            return lines;
        }

        /// <summary>Plain text, wrapped when `width` is given; returns its height.</summary>
        public static float Text(Graphics g, string text, Font font, Color color, float x, float y, float width = 0, bool draw = true, StringAlignment align = StringAlignment.Near)
        {
            using (var format = new StringFormat(width > 0 ? 0 : StringFormatFlags.NoWrap) { Alignment = align, Trimming = StringTrimming.None })
            {
                var size = width > 0 ? g.MeasureString(text, font, (int)Math.Ceiling(width), format) : g.MeasureString(text, font, PointF.Empty, format);
                if (draw)
                    using (var brush = new SolidBrush(color))
                    {
                        if (width > 0) g.DrawString(text, font, brush, new RectangleF(x, y, width, size.Height + 2), format);
                        else g.DrawString(text, font, brush, x, y, format);
                    }
                return size.Height;
            }
        }

        public static float Width(Graphics g, string text, Font font)
        {
            using (var format = new StringFormat(StringFormatFlags.NoWrap))
                return g.MeasureString(text, font, PointF.Empty, format).Width;
        }

        public static void Check(Graphics g, Color color, RectangleF r, float width)
        {
            using (var pen = new Pen(color, width) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
                g.DrawLines(pen, new[]
                {
                    new PointF(r.X + r.Width * 0.21f, r.Y + r.Height * 0.52f),
                    new PointF(r.X + r.Width * 0.40f, r.Y + r.Height * 0.71f),
                    new PointF(r.X + r.Width * 0.79f, r.Y + r.Height * 0.31f),
                });
        }

        public enum MarkTone { Color, Cream }

        /// <summary>The mark (brief: cobalt tile, cream stem, yellow crossbar and dot) at any size.</summary>
        public static void Mark(Graphics g, RectangleF r, MarkTone tone)
        {
            var state = g.Save();
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TranslateTransform(r.X, r.Y);
            g.ScaleTransform(r.Width / 64f, r.Height / 64f);
            var tile = tone == MarkTone.Color ? Color.FromArgb(0x2F, 0x5B, 0xEA) : Color.FromArgb(0xFF, 0xF7, 0xEC);
            var stem = tone == MarkTone.Color ? Color.FromArgb(0xFF, 0xF7, 0xEC) : Color.FromArgb(0x2F, 0x5B, 0xEA);
            var sun = Color.FromArgb(0xFF, 0xC8, 0x3D);
            FillRound(g, tile, new RectangleF(0, 0, 64, 64), 15);
            using (var pen = new Pen(stem, 9) { StartCap = LineCap.Round, EndCap = LineCap.Round, LineJoin = LineJoin.Round })
            using (var path = new GraphicsPath())
            {
                path.AddLine(37, 12, 37, 39);
                path.AddArc(17, 29, 20, 20, 0, 90);
                path.AddLine(27, 49, 22, 49);
                g.DrawPath(pen, path);
            }
            FillRound(g, sun, new RectangleF(20, 20, 32, 10), 5);
            using (var brush = new SolidBrush(sun)) g.FillEllipse(brush, 16 - 5.2f, 49 - 5.2f, 10.4f, 10.4f);
            g.Restore(state);
        }

        /// <summary>An agent's mark in a `size` square, or its initial on a tinted tile.</summary>
        public static void AgentMark(Graphics g, AgentKind agent, RectangleF r, Palette colors)
        {
            var logo = Brand.Logo(agent.Id);
            if (logo == null)
            {
                FillRound(g, colors.Tint, r, r.Width * 0.25f);
                using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                using (var brush = new SolidBrush(colors.Link))
                    g.DrawString(agent.Name.Substring(0, 1), Brand.Body(r.Height * 0.62f, true), brush, r, format);
                return;
            }
            var state = g.Save();
            g.InterpolationMode = InterpolationMode.HighQualityBicubic;
            g.PixelOffsetMode = PixelOffsetMode.HighQuality;
            if (Brand.Monochrome(agent.Id))
            {
                var c = colors.Text;
                using (var attributes = new ImageAttributes())
                {
                    attributes.SetColorMatrix(new ColorMatrix(new[]
                    {
                        new float[] { 0, 0, 0, 0, 0 }, new float[] { 0, 0, 0, 0, 0 }, new float[] { 0, 0, 0, 0, 0 },
                        new float[] { 0, 0, 0, 1, 0 }, new float[] { c.R / 255f, c.G / 255f, c.B / 255f, 0, 1 },
                    }));
                    g.DrawImage(logo, Rectangle.Round(r), 0, 0, logo.Width, logo.Height, GraphicsUnit.Pixel, attributes);
                }
            }
            else g.DrawImage(logo, r);
            g.Restore(state);
        }

        public static void Dot(Graphics g, Color color, float cx, float cy, float diameter)
        {
            var state = g.Save();
            g.SmoothingMode = SmoothingMode.AntiAlias;
            using (var brush = new SolidBrush(color)) g.FillEllipse(brush, cx - diameter / 2, cy - diameter / 2, diameter, diameter);
            g.Restore(state);
        }
    }

    static class Win
    {
        public const int WM_NCHITTEST = 0x84, HTCAPTION = 2, HTCLIENT = 1, WM_DPICHANGED = 0x02E0, WM_ACTIVATEAPP = 0x1C;
        public const int WS_SYSMENU = 0x80000, WS_MINIMIZEBOX = 0x20000, WS_EX_TOOLWINDOW = 0x80, WS_EX_NOACTIVATE = 0x08000000, CS_DROPSHADOW = 0x20000;

        [DllImport("user32.dll")] static extern uint GetDpiForWindow(IntPtr hwnd);
        [DllImport("user32.dll")] static extern IntPtr MonitorFromPoint(Point pt, uint flags);
        [DllImport("shcore.dll")] static extern int GetDpiForMonitor(IntPtr monitor, int type, out uint dpiX, out uint dpiY);
        [DllImport("dwmapi.dll")] static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);
        [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hwnd);
        [DllImport("shell32.dll")] static extern int Shell_NotifyIconGetRect(ref NOTIFYICONIDENTIFIER identifier, out RECT rect);
        [DllImport("shell32.dll")] static extern IntPtr SHAppBarMessage(uint message, ref APPBARDATA data);

        [StructLayout(LayoutKind.Sequential)] struct RECT { public int Left, Top, Right, Bottom; }

        [StructLayout(LayoutKind.Sequential)]
        struct NOTIFYICONIDENTIFIER
        {
            public uint cbSize;
            public IntPtr hWnd;
            public uint uID;
            public Guid guidItem;
        }

        [StructLayout(LayoutKind.Sequential)]
        struct APPBARDATA
        {
            public uint cbSize;
            public IntPtr hWnd;
            public uint uCallbackMessage, uEdge;
            public RECT rc;
            public IntPtr lParam;
        }

        public static float ScaleOf(IntPtr hwnd)
        {
            if (Appearance.ScaleOverride != null) return Appearance.ScaleOverride.Value;
            try { var dpi = GetDpiForWindow(hwnd); if (dpi > 0) return dpi / 96f; }
            catch (EntryPointNotFoundException) { }
            using (var g = Graphics.FromHwnd(hwnd)) return g.DpiX / 96f;
        }

        public static float ScaleAt(Point point)
        {
            if (Appearance.ScaleOverride != null) return Appearance.ScaleOverride.Value;
            try
            {
                if (GetDpiForMonitor(MonitorFromPoint(point, 2), 0, out var dpi, out _) == 0 && dpi > 0) return dpi / 96f;
            }
            catch (Exception) { }
            using (var g = Graphics.FromHwnd(IntPtr.Zero)) return g.DpiX / 96f;
        }

        /// <summary>Windows 11 rounds the corners; Windows 10 says no and the window stays square. True when rounded.</summary>
        public static bool RoundCorners(IntPtr hwnd, Color border)
        {
            try
            {
                var round = 2; // DWMWCP_ROUND
                var rounded = DwmSetWindowAttribute(hwnd, 33, ref round, 4) == 0;
                var colorRef = border.R | (border.G << 8) | (border.B << 16);
                if (rounded) DwmSetWindowAttribute(hwnd, 34, ref colorRef, 4);
                return rounded;
            }
            catch (Exception) { return false; }
        }

        /// <summary>Where the tray icon is on screen, or null when Windows won't say (then the cursor stands in).</summary>
        public static Rectangle? TrayIconRect(NotifyIcon icon)
        {
            try
            {
                var flags = System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic;
                var window = typeof(NotifyIcon).GetField("window", flags)?.GetValue(icon) as NativeWindow;
                var id = typeof(NotifyIcon).GetField("id", flags)?.GetValue(icon);
                if (window == null || id == null) return null;
                var identifier = new NOTIFYICONIDENTIFIER { hWnd = window.Handle, uID = Convert.ToUInt32(id) };
                identifier.cbSize = (uint)Marshal.SizeOf(identifier);
                if (Shell_NotifyIconGetRect(ref identifier, out var rect) != 0) return null;
                return Rectangle.FromLTRB(rect.Left, rect.Top, rect.Right, rect.Bottom);
            }
            catch (Exception) { return null; }
        }

        /// <summary>The primary taskbar's edge, for a screen whose taskbar hides itself.</summary>
        public static Edge PrimaryTaskbarEdge()
        {
            try
            {
                var data = new APPBARDATA();
                data.cbSize = (uint)Marshal.SizeOf(data);
                if (SHAppBarMessage(5, ref data) == IntPtr.Zero) return Edge.Bottom; // ABM_GETTASKBARPOS
                switch (data.uEdge)
                {
                    case 0: return Edge.Left;
                    case 1: return Edge.Top;
                    case 2: return Edge.Right;
                    default: return Edge.Bottom;
                }
            }
            catch (Exception) { return Edge.Bottom; }
        }
    }

    /// <summary>Screen readers see each hit of a painted surface as a button they can press.</summary>
    sealed class SurfaceAccessible : Control.ControlAccessibleObject
    {
        readonly Control owner;
        readonly Func<List<Hit>> hits;
        readonly Action<string> press;
        readonly Func<string, string> name;

        public SurfaceAccessible(Control owner, Func<List<Hit>> hits, Action<string> press, Func<string, string> name) : base(owner)
        {
            this.owner = owner;
            this.hits = hits;
            this.press = press;
            this.name = name;
        }

        public override AccessibleRole Role => AccessibleRole.Dialog;
        public override int GetChildCount() => hits().Count;
        public override AccessibleObject GetChild(int index) => index >= 0 && index < hits().Count ? new Child(this, hits()[index]) : null;

        sealed class Child : AccessibleObject
        {
            readonly SurfaceAccessible parent;
            readonly Hit hit;
            public Child(SurfaceAccessible parent, Hit hit) { this.parent = parent; this.hit = hit; }
            public override string Name => parent.name(hit.Id);
            public override AccessibleRole Role => AccessibleRole.PushButton;
            public override AccessibleObject Parent => parent;
            public override AccessibleStates State => hit.Enabled ? AccessibleStates.Focusable : AccessibleStates.Unavailable;
            public override Rectangle Bounds => parent.owner.RectangleToScreen(Rectangle.Round(hit.Bounds));
            public override string DefaultAction => "Press";
            public override void DoDefaultAction() { if (hit.Enabled) parent.press(hit.Id); }
        }
    }

    /// <summary>A focusable, clickable place on a surface, found again by its id after each layout.</summary>
    sealed class Hit
    {
        public string Id;
        public RectangleF Bounds;
        public float Radius;
        public bool Enabled = true;
    }

    /// <summary>
    /// A window that paints itself: one Render pass both measures and draws, so what is clicked is
    /// what is drawn. Tab, arrows, Enter and Space move between and press its hits.
    /// </summary>
    abstract class Surface : Form
    {
        protected float scale = 1;
        protected Palette colors = Appearance.Colors;
        protected readonly List<Hit> hits = new List<Hit>();
        protected string hover, pressed, focused;
        protected bool keyboardFocus, rounded;

        protected Surface()
        {
            FormBorderStyle = FormBorderStyle.None;
            AutoScaleMode = AutoScaleMode.None;
            SetStyle(ControlStyles.AllPaintingInWmPaint | ControlStyles.OptimizedDoubleBuffer | ControlStyles.UserPaint | ControlStyles.ResizeRedraw, true);
            KeyPreview = true;
            Text = "Tinkjam Sync";
            BackColor = colors.Surface;
            Appearance.Watch(this, () => { colors = Appearance.Colors; BackColor = colors.Surface; ApplyCorners(); Relayout(); });
        }

        protected int Px(float value) => (int)Math.Round(value * scale);
        protected float S(float value) => value * scale;

        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                p.ClassStyle |= Win.CS_DROPSHADOW;
                return p;
            }
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            if (Appearance.ScaleOverride == null) scale = Win.ScaleOf(Handle);
            else scale = Appearance.ScaleOverride.Value;
            ApplyCorners();
        }

        void ApplyCorners() { if (IsHandleCreated) rounded = Win.RoundCorners(Handle, colors.Rule); }

        /// <summary>Lays out and paints. With `g` measuring only (draw false) it must register the same hits.</summary>
        protected abstract Size Render(Graphics g, bool draw);

        protected Size Measure()
        {
            using (var bitmap = new Bitmap(1, 1))
            using (var g = Graphics.FromImage(bitmap))
            {
                Prepare(g);
                hits.Clear();
                return Render(g, false);
            }
        }

        /// <summary>Measure again (sizes may change), then repaint.</summary>
        protected virtual void Relayout()
        {
            var size = Measure();
            // Size, not ClientSize: with a system menu WinForms would add a caption bar the window does not have.
            if (Size != size) Size = size;
            Invalidate();
        }

        static void Prepare(Graphics g)
        {
            g.SmoothingMode = SmoothingMode.AntiAlias;
            g.TextRenderingHint = TextRenderingHint.ClearTypeGridFit;
            g.PixelOffsetMode = PixelOffsetMode.Half;
        }

        protected override void OnPaint(PaintEventArgs e)
        {
            var g = e.Graphics;
            g.Clear(colors.Surface);
            Prepare(g);
            hits.Clear();
            Render(g, true);
            if (!rounded)
                using (var pen = new Pen(colors.Rule)) g.DrawRectangle(pen, 0, 0, ClientSize.Width - 1, ClientSize.Height - 1);
        }

        protected Hit AddHit(string id, RectangleF bounds, float radius, bool enabled = true)
        {
            var hit = new Hit { Id = id, Bounds = bounds, Radius = radius, Enabled = enabled };
            hits.Add(hit);
            return hit;
        }

        protected bool IsHover(string id) => hover == id;
        /// <summary>Preview only: a window the preview cannot bring forward still shows where Tab went.</summary>
        public static bool ShowFocusUnfocused;
        protected bool IsFocused(string id) => keyboardFocus && focused == id && (ContainsFocus || ShowFocusUnfocused);

        protected void FocusRing(Graphics g, Hit hit)
        {
            if (!IsFocused(hit.Id)) return;
            var r = hit.Bounds;
            r.Inflate(S(3), S(3));
            Ink.Ring(g, colors.Link, r, hit.Radius + S(3), S(2));
        }

        Hit At(Point p) => hits.LastOrDefault(h => h.Enabled && h.Bounds.Contains(p));

        protected override void WndProc(ref Message m)
        {
            if (m.Msg == Win.WM_NCHITTEST && Draggable)
            {
                base.WndProc(ref m);
                if ((int)m.Result == Win.HTCLIENT)
                {
                    var screen = new Point(unchecked((short)(long)m.LParam), unchecked((short)((long)m.LParam >> 16)));
                    if (At(PointToClient(screen)) == null) m.Result = (IntPtr)Win.HTCAPTION;
                }
                return;
            }
            if (m.Msg == Win.WM_DPICHANGED)
            {
                OnDpiChanged((int)((long)m.WParam & 0xFFFF) / 96f, Marshal.PtrToStructure<Rectangle4>(m.LParam).ToRectangle());
                return;
            }
            base.WndProc(ref m);
        }

        [StructLayout(LayoutKind.Sequential)]
        struct Rectangle4
        {
            public int Left, Top, Right, Bottom;
            public Rectangle ToRectangle() => Rectangle.FromLTRB(Left, Top, Right, Bottom);
        }

        protected virtual bool Draggable => false;

        protected virtual void OnDpiChanged(float newScale, Rectangle suggested)
        {
            if (Appearance.ScaleOverride != null) return;
            scale = newScale;
            Location = suggested.Location;
            Relayout();
        }

        protected override void OnMouseMove(MouseEventArgs e)
        {
            base.OnMouseMove(e);
            var id = At(e.Location)?.Id;
            Cursor = id == null ? Cursors.Default : Cursors.Hand;
            if (id == hover) return;
            hover = id;
            Invalidate();
        }

        protected override void OnMouseLeave(EventArgs e)
        {
            base.OnMouseLeave(e);
            if (hover == null) return;
            hover = null;
            Invalidate();
        }

        protected override void OnMouseDown(MouseEventArgs e)
        {
            base.OnMouseDown(e);
            if (e.Button != MouseButtons.Left) return;
            pressed = At(e.Location)?.Id;
            keyboardFocus = false;
            Invalidate();
        }

        protected override void OnMouseUp(MouseEventArgs e)
        {
            base.OnMouseUp(e);
            var id = At(e.Location)?.Id;
            var was = pressed;
            pressed = null;
            Invalidate();
            if (e.Button == MouseButtons.Left && id != null && id == was) { focused = id; Press(id); }
        }

        protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
        {
            var enabled = hits.Where(h => h.Enabled).ToList();
            int Index() => enabled.FindIndex(h => h.Id == focused);
            switch (keyData)
            {
                case Keys.Tab:
                case Keys.Down:
                case Keys.Right:
                case Keys.Shift | Keys.Tab:
                case Keys.Up:
                case Keys.Left:
                    if (enabled.Count == 0) return true;
                    var back = keyData == (Keys.Shift | Keys.Tab) || keyData == Keys.Up || keyData == Keys.Left;
                    var at = Index();
                    if (!keyboardFocus && at >= 0) { }
                    else at = at < 0 ? (back ? enabled.Count - 1 : 0) : (at + (back ? enabled.Count - 1 : 1)) % enabled.Count;
                    focused = enabled[Math.Max(0, at)].Id;
                    keyboardFocus = true;
                    Invalidate();
                    return true;
                case Keys.Enter:
                case Keys.Space:
                    if (focused != null && enabled.Any(h => h.Id == focused)) { keyboardFocus = true; Press(focused); }
                    return true;
                case Keys.Escape:
                    OnEscape();
                    return true;
            }
            return base.ProcessCmdKey(ref msg, keyData);
        }

        protected virtual void OnEscape() { }

        protected abstract void Press(string id);
    }
}
