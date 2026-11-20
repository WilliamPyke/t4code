using System;
using System.Collections.Generic;
using System.Drawing;
using System.Linq;
using System.Windows.Forms;

namespace TinkjamSync
{
    /// <summary>
    /// The flyout over the tray icon (Doop frame rv8Wt6cVnY), in place of a menu. Every action the
    /// menu had is here: the status card carries the phase's own action, Settings opens the rest.
    /// It opens only when the icon is clicked and closes on click-away or Esc.
    /// </summary>
    sealed class TrayPanel : Surface
    {
        const float W = 340, Pad = 16;
        AppView view = new AppView();
        List<AgentKind> agents;
        HashSet<string> working = new HashSet<string>();
        bool settingsOpen;
        Point anchor;
        public bool StayOpen;
        public DateTime HiddenAt { get; private set; }

        public event Action<string> Command;

        public TrayPanel()
        {
            ShowInTaskbar = false;
            TopMost = true;
            StartPosition = FormStartPosition.Manual;
            AccessibleName = "Tinkjam Sync";
            Deactivate += (s, e) => { if (!StayOpen) HidePanel(); };
            FormClosing += (s, e) =>
            {
                if (e.CloseReason != CloseReason.UserClosing) return;
                e.Cancel = true;
                HidePanel();
            };
        }

        protected override CreateParams CreateParams
        {
            get
            {
                var p = base.CreateParams;
                p.ExStyle |= Win.WS_EX_TOOLWINDOW;
                return p;
            }
        }

        public bool SettingsOpen { get => settingsOpen; set { settingsOpen = value; if (IsHandleCreated) Relayout(); } }

        public void Update(AppView next, List<AgentKind> found, HashSet<string> busy)
        {
            view = next;
            agents = found;
            working = busy ?? new HashSet<string>();
            if (!Visible) return;
            Relayout();
            PlaceAt(anchor);
        }

        public void HidePanel()
        {
            if (!Visible) return;
            HiddenAt = DateTime.UtcNow;
            keyboardFocus = false;
            Hide();
        }

        /// <summary>Opens over `iconCentre` on its screen, at that screen's scale, and takes the keyboard.</summary>
        public void ShowAt(Point iconCentre)
        {
            anchor = iconCentre;
            if (!IsHandleCreated) CreateHandle();
            scale = Win.ScaleAt(iconCentre);
            focused = null;
            keyboardFocus = false;
            Relayout();
            PlaceAt(iconCentre);
            Show();
            Activate();
            Win.SetForegroundWindow(Handle);
        }

        void PlaceAt(Point iconCentre)
        {
            var screen = Screen.FromPoint(iconCentre);
            var edge = Placement.TaskbarEdge(screen.Bounds, screen.WorkingArea, Win.PrimaryTaskbarEdge());
            Location = Placement.Panel(screen.WorkingArea, edge, iconCentre, Size, Px(12));
        }

        protected override void OnDpiChanged(float newScale, Rectangle suggested)
        {
            if (Appearance.ScaleOverride != null) return;
            scale = newScale;
            Relayout();
            PlaceAt(anchor);
        }

        protected override void OnEscape() => HidePanel();

        protected override void Press(string id)
        {
            if (id == "settings") { SettingsOpen = !settingsOpen; return; }
            if (id != "autostart") HidePanel();
            Command?.Invoke(id);
        }

        public string Describe() => "panel: " + PanelModel.Status(view) + (settingsOpen ? " (settings open)" : "");

        protected override Size Render(Graphics g, bool draw)
        {
            var x = S(Pad);
            var width = S(W - 2 * Pad);
            var right = x + width;
            var y = S(Pad);

            // Header: the mark, the name, the computer, and the state.
            if (draw)
            {
                Ink.Mark(g, new RectangleF(x, y, S(32), S(32)), Ink.MarkTone.Color);
                var state = g.Save();
                g.TextRenderingHint = System.Drawing.Text.TextRenderingHint.AntiAliasGridFit;
                Ink.Tracked(g, "Tinkjam Sync", Brand.Heading(S(17)), colors.Text, x + S(42), y - S(1), -0.02f);
                g.Restore(state);
                Ink.Text(g, view.ComputerName, Brand.Body(S(12)), colors.Quiet, x + S(42), y + S(18), right - x - S(42) - S(110));
                var tone = PanelModel.StatusTone(view);
                var statusFont = Brand.Body(S(12), true);
                var status = PanelModel.Status(view);
                var sw = Ink.Width(g, status, statusFont);
                Ink.Text(g, status, statusFont, colors.ToneColor(tone), right, y + S(16) - statusFont.Height / 2f, align: StringAlignment.Far);
                Ink.Dot(g, colors.DotColor(tone), right - sw - S(8), y + S(16), S(8));
            }
            y += S(32) + S(14);

            // The card: what is going on when it is not simply connected, with that phase's action.
            var notice = PanelModel.Notice(view);
            var items = MenuModel.Items(view);
            var action = items.FirstOrDefault(i => i.Id == "open-again" || i.Id == "retry" || i.Id == "connect");
            if (notice != null || action != null)
            {
                var textFont = Brand.Body(S(13), true);
                var inner = width - S(24);
                var th = notice == null ? 0 : Ink.Text(g, notice, textFont, colors.Text, 0, 0, inner, false);
                var linkFont = Brand.Body(S(13), true);
                var linkText = action == null ? null : action.Id == "connect" ? "Connect" : action.Text;
                var h = S(12) + th + (action != null ? (notice != null ? S(8) : 0) + S(18) : 0) + S(12);
                var card = new RectangleF(x, y, width, h);
                if (draw)
                {
                    Ink.FillRound(g, view.Phase == Phase.Stopped ? colors.SunTint : colors.Tint, card, S(6));
                    if (notice != null) Ink.Text(g, notice, textFont, colors.Text, x + S(12), y + S(12), inner);
                }
                if (action != null)
                {
                    var lw = Ink.Width(g, linkText, linkFont);
                    var ly = y + h - S(12) - S(18);
                    var hit = AddHit(action.Id, new RectangleF(right - S(12) - lw - S(2), ly - S(1), lw + S(4), S(20)), S(4), action.Enabled);
                    if (draw)
                    {
                        var color = !action.Enabled ? colors.Quiet : view.Phase == Phase.Stopped ? colors.Text : colors.Link;
                        var font = IsHover(action.Id) ? new Font(linkFont, FontStyle.Underline) : linkFont;
                        Ink.Text(g, linkText, font, color, right - S(12), ly, align: StringAlignment.Far);
                        if (font != linkFont) font.Dispose();
                        FocusRing(g, hit);
                    }
                }
                y += h;
            }

            // The agents this PC has, and which of them is at work under Sync now.
            y += S(14);
            if (draw)
                Ink.Tracked(g, "AGENTS ON THIS PC", Brand.Body(S(11), true), colors.Quiet, x, y, 0.08f);
            y += S(16);
            var rows = agents == null ? null : agents;
            if (rows == null || rows.Count == 0)
            {
                if (draw) Ink.Text(g, rows == null ? "Looking for agents…" : Words.NoAgents, Brand.Body(S(13)), colors.Quiet, x, y + S(9));
                y += S(38);
            }
            else
            {
                for (var i = 0; i < rows.Count; i++)
                {
                    var agent = rows[i];
                    if (draw)
                    {
                        if (i > 0) using (var pen = new Pen(colors.Rule, Math.Max(1, (int)S(1)))) g.DrawLine(pen, x, y, right, y);
                        Ink.AgentMark(g, agent, new RectangleF(x, y + S(9), S(20), S(20)), colors);
                        var nameFont = Brand.Body(S(13), true);
                        Ink.Text(g, agent.Name, nameFont, colors.Text, x + S(30), y + S(19) - nameFont.Height / 2f);
                        // Ready only while boards can reach this PC; otherwise the agent is here but not yet usable.
                        var busy = working.Contains(agent.Id);
                        var connected = view.Phase == Phase.Connected;
                        var small = Brand.Body(S(12));
                        Ink.Text(g, busy ? "Working" : connected ? "Ready" : "Installed", small, colors.Quiet, right - S(18), y + S(19) - small.Height / 2f, align: StringAlignment.Far);
                        Ink.Dot(g, busy ? colors.Link : connected ? colors.Success : colors.Quiet, right - S(4), y + S(19), S(8));
                    }
                    y += S(38);
                }
            }

            // Open Tinkjam.
            y += S(12);
            var open = AddHit("open", new RectangleF(x, y, width, S(36)), S(6));
            if (draw)
            {
                var fill = IsHover("open") || pressed == "open" ? Color.FromArgb(0x1C, 0x3F, 0xBF) : colors.Button;
                Ink.FillRound(g, fill, open.Bounds, S(6));
                using (var format = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                using (var brush = new SolidBrush(colors.ButtonText))
                    g.DrawString("Open Tinkjam", Brand.Body(S(13), true), brush, open.Bounds, format);
                FocusRing(g, open);
            }
            y += S(36) + S(12);

            // Settings and Quit.
            var linkRow = Brand.Body(S(13));
            var settingsW = Ink.Width(g, "Settings", linkRow);
            var quitW = Ink.Width(g, "Quit", linkRow);
            var settings = AddHit("settings", new RectangleF(x - S(2), y - S(1), settingsW + S(4), S(20)), S(4));
            var quit = AddHit("exit", new RectangleF(right - quitW - S(2), y - S(1), quitW + S(4), S(20)), S(4));
            if (draw)
            {
                foreach (var (hit, text) in new[] { (settings, "Settings"), (quit, "Quit") })
                {
                    var color = IsHover(hit.Id) || (hit.Id == "settings" && settingsOpen) ? colors.Text : colors.Body;
                    Ink.Text(g, text, hit.Id == "settings" && settingsOpen ? Brand.Body(S(13), true) : linkRow, color, hit.Bounds.X + S(2), y);
                    FocusRing(g, hit);
                }
            }
            y += S(18);

            if (settingsOpen)
            {
                y += S(8);
                var settingRows = new List<(string id, string text, bool enabled)>
                {
                    ("autostart", "Start when I sign in to Windows", true),
                };
                var connection = items.FirstOrDefault(i => i.Id == "disconnect");
                if (connection != null) settingRows.Add(("disconnect", "Disconnect this computer…", connection.Enabled));
                settingRows.Add(("log", "Show technical log", true));
                foreach (var (id, text, enabled) in settingRows)
                {
                    var hit = AddHit(id, new RectangleF(x, y + S(4), width, S(28)), S(4), enabled);
                    if (draw)
                    {
                        using (var pen = new Pen(colors.Rule, Math.Max(1, (int)S(1)))) g.DrawLine(pen, x, y, right, y);
                        if (IsHover(id)) Ink.FillRound(g, colors.Track, hit.Bounds, S(4));
                        var font = Brand.Body(S(13));
                        var tx = x + S(6);
                        if (id == "autostart")
                        {
                            var box = new RectangleF(tx, y + S(10), S(16), S(16));
                            if (view.StartWithWindows) { Ink.FillRound(g, colors.Button, box, S(4)); Ink.Check(g, colors.ButtonText, box, S(1.8f)); }
                            else Ink.Ring(g, colors.Quiet, RectangleF.Inflate(box, -S(0.5f), -S(0.5f)), S(4), S(1.2f));
                            tx = box.Right + S(8);
                        }
                        Ink.Text(g, text, font, enabled ? colors.Body : colors.Quiet, tx, y + S(18) - font.Height / 2f);
                        FocusRing(g, hit);
                    }
                    y += S(36);
                }
                y -= S(8);
            }

            // Version and the update state.
            y += S(12);
            if (draw) using (var pen = new Pen(colors.Rule, Math.Max(1, (int)S(1)))) g.DrawLine(pen, x, y, right, y);
            y += S(10);
            var small12 = Brand.Body(S(12));
            var update = PanelModel.UpdateText(view);
            var updateItem = items.First(i => i.Id == "update");
            var ready = view.UpdateVersion != null;
            var uw = Ink.Width(g, update, ready ? Brand.Body(S(12), true) : small12);
            var updateHit = AddHit("update", new RectangleF(right - uw - S(2), y - S(1), uw + S(4), S(18)), S(4), updateItem.Enabled);
            if (draw)
            {
                Ink.Text(g, "Version " + view.Version, small12, colors.Quiet, x, y);
                var color = ready ? colors.Link : IsHover("update") ? colors.Text : colors.Quiet;
                var font = ready ? Brand.Body(S(12), true) : small12;
                Ink.Text(g, update, font, color, right, y, align: StringAlignment.Far);
                FocusRing(g, updateHit);
            }
            y += S(16) + S(Pad);
            return new Size(Px(W), (int)Math.Ceiling(y));
        }

        protected override AccessibleObject CreateAccessibilityInstance() => new SurfaceAccessible(this, () => hits, Press, NameOf);

        string NameOf(string id)
        {
            switch (id)
            {
                case "open": return "Open Tinkjam";
                case "settings": return "Settings";
                case "exit": return "Quit Tinkjam Sync";
                case "autostart": return "Start when I sign in to Windows";
                case "update": return PanelModel.UpdateText(view);
                default: return MenuModel.Items(view).FirstOrDefault(i => i.Id == id)?.Text ?? id;
            }
        }
    }
}
