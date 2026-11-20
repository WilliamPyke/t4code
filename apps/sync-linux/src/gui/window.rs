//! The two windows, drawn by this program after the Doop frames (`_OiiOCDH14` first run and menu
//! bar panel, `rv8Wt6cVnY` tray panel): the first-run window and the panel. The panel opens from
//! the tray as a small borderless window, or as a normal window ("home") where there is no tray.
//! Each window is its own process and reads the running copy's state over its socket.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use eframe::egui::{
    self, epaint::RectShape, text::LayoutJob, Align2, Color32, Context, CornerRadius, CursorIcon, FontData, FontDefinitions, FontFamily,
    FontId, Galley, Painter, Pos2, Rect, Response, Sense, Stroke, StrokeKind, TextFormat, TextureHandle, TextureOptions, Ui, Vec2,
    ViewportCommand, WidgetInfo, WidgetType,
};

use super::theme::{self, Palette};
use crate::config::Paths;
use crate::engine::{Phase, UpdateState, View};
use crate::ipc::Client;
use crate::{agents, config, procs};

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Kind {
    Setup,
    Panel,
    Home,
}

const PANEL_WIDTH: f32 = 340.0;
const SETUP_SIZE: Vec2 = Vec2::new(640.0, 316.0);

#[derive(Clone)]
struct Assets {
    mark: TextureHandle,
    photo: TextureHandle,
    agents: HashMap<&'static str, (TextureHandle, bool)>,
}

#[derive(Clone, Copy, PartialEq)]
enum Confirm {
    Disconnect,
    Remove,
}

pub struct WindowApp {
    kind: Kind,
    paths: Paths,
    state: Arc<Mutex<Option<View>>>,
    gone: Arc<AtomicBool>,
    dark: Arc<AtomicBool>,
    sender: Option<Client>,
    assets: Option<Assets>,
    settings: bool,
    confirm: Option<Confirm>,
    had_focus: bool,
    opened: Instant,
    size: Vec2,
    /// Test hook (TINKJAM_SYNC_SCREENSHOT=<file.png>): save what is drawn, then close.
    screenshot: Option<(String, u32)>,
}

pub fn options(kind: Kind, at: Option<(i32, i32)>) -> eframe::NativeOptions {
    let mut viewport = egui::ViewportBuilder::default()
        .with_title("Tinkjam Sync")
        .with_app_id(config::APP_ID)
        .with_resizable(false)
        .with_icon(icon_data());
    viewport = match kind {
        Kind::Setup => viewport.with_inner_size(SETUP_SIZE),
        Kind::Home => viewport.with_inner_size([PANEL_WIDTH, 420.0]),
        Kind::Panel => {
            let mut v = viewport.with_inner_size([PANEL_WIDTH, 420.0]).with_decorations(false).with_always_on_top().with_taskbar(false);
            // Only X11 lets a window choose where it opens; Wayland places it itself.
            if let Some((x, y)) = at {
                v = v.with_position(panel_position(x, y));
            }
            v
        }
    };
    eframe::NativeOptions { viewport, centered: kind != Kind::Panel, ..Default::default() }
}

/// Near the tray icon that was clicked, inside the screen: the icon is usually at a top or bottom
/// corner, so the panel opens below or above it.
fn panel_position(x: i32, y: i32) -> Pos2 {
    let (x, y) = (x as f32, y as f32);
    let left = (x - PANEL_WIDTH + 24.0).max(8.0);
    let top = if y < 300.0 { y + 16.0 } else { (y - 440.0).max(8.0) };
    Pos2::new(left, top)
}

fn icon_data() -> egui::IconData {
    let image = image::load_from_memory(include_bytes!("../../assets/icons/hicolor/128x128/apps/org.tinkjam.Sync.png"))
        .map(|i| i.to_rgba8())
        .ok();
    match image {
        Some(rgba) => egui::IconData { width: rgba.width(), height: rgba.height(), rgba: rgba.into_raw() },
        None => egui::IconData::default(),
    }
}

impl WindowApp {
    pub fn new(cc: &eframe::CreationContext<'_>, kind: Kind, paths: Paths) -> WindowApp {
        install_fonts(&cc.egui_ctx);
        let state = Arc::new(Mutex::new(None));
        let gone = Arc::new(AtomicBool::new(false));
        let dark = Arc::new(AtomicBool::new(theme::prefers_dark()));
        {
            let (state, gone, ctx, socket) = (state.clone(), gone.clone(), cc.egui_ctx.clone(), paths.socket());
            // Test hook: TINKJAM_SYNC_FAKE_VIEW=<view.json> draws a given state, with no running copy.
            match std::env::var("TINKJAM_SYNC_FAKE_VIEW") {
                Ok(file) => {
                    *state.lock().unwrap() = std::fs::read_to_string(file).ok().and_then(|t| serde_json::from_str(&t).ok());
                }
                Err(_) => {
                    std::thread::spawn(move || follow_state(&socket, &state, &gone, &ctx));
                }
            }
        }
        {
            let (dark, ctx) = (dark.clone(), cc.egui_ctx.clone());
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(3));
                let now = theme::prefers_dark();
                if dark.swap(now, Ordering::SeqCst) != now {
                    ctx.request_repaint();
                }
            });
        }
        let mut sender = Client::connect(&paths.socket()).ok();
        if let Some(client) = sender.as_mut() {
            client.send("refresh-agents");
        }
        let size = if kind == Kind::Setup { SETUP_SIZE } else { Vec2::new(PANEL_WIDTH, 420.0) };
        WindowApp {
            kind,
            paths,
            state,
            gone,
            dark,
            sender,
            assets: None,
            settings: false,
            confirm: None,
            had_focus: false,
            opened: Instant::now(),
            size,
            screenshot: std::env::var("TINKJAM_SYNC_SCREENSHOT").ok().map(|f| (f, 0)),
        }
    }

    fn send(&mut self, command: &str) {
        self.send_json(serde_json::json!({ "cmd": command }));
    }

    fn send_json(&mut self, request: serde_json::Value) {
        if self.sender.is_none() {
            self.sender = Client::connect(&self.paths.socket()).ok();
        }
        if let Some(client) = self.sender.as_mut() {
            if client.request(request).is_err() {
                self.sender = None;
            }
        }
    }
}

/// Long-polls the running copy; when it goes away for good, the window closes.
fn follow_state(socket: &std::path::Path, state: &Mutex<Option<View>>, gone: &AtomicBool, ctx: &Context) {
    let mut failures = 0;
    let mut serial = 0;
    let mut client: Option<Client> = None;
    loop {
        if client.is_none() {
            client = Client::connect(socket).ok();
        }
        match client.as_mut().map(|c| c.state(serial)) {
            Some(Ok((next, view))) => {
                failures = 0;
                if next != serial {
                    serial = next;
                    *state.lock().unwrap() = Some(view);
                    ctx.request_repaint();
                }
            }
            _ => {
                client = None;
                failures += 1;
                if failures > 10 {
                    gone.store(true, Ordering::SeqCst);
                    ctx.request_repaint();
                    return;
                }
                std::thread::sleep(Duration::from_millis(500));
            }
        }
    }
}

fn install_fonts(ctx: &Context) {
    let mut fonts = FontDefinitions::default();
    let add = |fonts: &mut FontDefinitions, name: &str, bytes: &'static [u8]| {
        fonts.font_data.insert(name.into(), FontData::from_static(bytes).into());
    };
    add(&mut fonts, "outfit", include_bytes!("../../assets/fonts/Outfit-SemiBold.ttf"));
    add(&mut fonts, "instrument", include_bytes!("../../assets/fonts/InstrumentSans-Regular.ttf"));
    add(&mut fonts, "instrument-semibold", include_bytes!("../../assets/fonts/InstrumentSans-SemiBold.ttf"));
    // egui's own fonts stay as fallbacks, for names in other scripts.
    let fallbacks = fonts.families.get(&FontFamily::Proportional).cloned().unwrap_or_default();
    let family = |first: &str| std::iter::once(first.to_string()).chain(fallbacks.iter().cloned()).collect::<Vec<_>>();
    fonts.families.insert(FontFamily::Proportional, family("instrument"));
    fonts.families.insert(FontFamily::Name("semibold".into()), family("instrument-semibold"));
    fonts.families.insert(FontFamily::Name("outfit".into()), family("outfit"));
    ctx.set_fonts(fonts);
}

fn load_assets(ctx: &Context) -> Assets {
    let texture = |name: &str, bytes: &[u8], mono: bool| {
        let image = image::load_from_memory(bytes).expect("embedded image").to_rgba8();
        let (w, h) = (image.width() as usize, image.height() as usize);
        let mut pixels = image.into_raw();
        if mono {
            // Single-colour logos become white masks, tinted with the text colour when drawn.
            for px in pixels.chunks_exact_mut(4) {
                px[0] = 255;
                px[1] = 255;
                px[2] = 255;
            }
        }
        ctx.load_texture(name, egui::ColorImage::from_rgba_unmultiplied([w, h], &pixels), TextureOptions::LINEAR)
    };
    let mut agents = HashMap::new();
    agents.insert("claude", (texture("claude", include_bytes!("../../assets/agents/claude-icon.png"), false), false));
    agents.insert("codex", (texture("codex", include_bytes!("../../assets/agents/openai-icon.png"), true), true));
    agents.insert("cursor", (texture("cursor", include_bytes!("../../assets/agents/cursor-icon.png"), true), true));
    agents.insert("grok", (texture("grok", include_bytes!("../../assets/agents/grok-icon.png"), true), true));
    Assets {
        mark: texture("mark", include_bytes!("../../assets/icons/hicolor/128x128/apps/org.tinkjam.Sync.png"), false),
        photo: texture("photo", include_bytes!("../../assets/art/blue-paint.jpg"), false),
        agents,
    }
}

// ---- Drawing helpers ----

#[derive(Clone, Copy)]
enum Face {
    Outfit,
    Body,
    Semibold,
}

fn galley(ctx: &Context, text: &str, size: f32, face: Face, color: Color32, tracking_em: f32, wrap: f32, line_height: Option<f32>) -> Arc<Galley> {
    let family = match face {
        Face::Outfit => FontFamily::Name("outfit".into()),
        Face::Body => FontFamily::Proportional,
        Face::Semibold => FontFamily::Name("semibold".into()),
    };
    // Instrument Sans has narrow spaces that egui's pixel snapping can nearly close at small
    // sizes, so spaces get a little more room than the font gives them.
    let format = |extra: f32| TextFormat {
        font_id: FontId::new(size, family.clone()),
        color,
        extra_letter_spacing: tracking_em * size + extra,
        line_height,
        ..Default::default()
    };
    let word_space = if size < 16.0 { 0.1 * size } else { 0.0 };
    let mut job = LayoutJob::default();
    let mut chunk = String::new();
    let mut first = true;
    let mut chars = text.chars().peekable();
    while let Some(c) = chars.next() {
        chunk.push(c);
        // Each word with the spaces after it; the next word starts a little further on.
        if c == ' ' && chars.peek().is_some_and(|n| *n != ' ') {
            job.append(&std::mem::take(&mut chunk), if first { 0.0 } else { word_space }, format(0.0));
            first = false;
        }
    }
    if !chunk.is_empty() {
        job.append(&chunk, if first { 0.0 } else { word_space }, format(0.0));
    }
    job.wrap.max_width = wrap;
    ctx.fonts(|f| f.layout_job(job))
}

fn check_circle(painter: &Painter, center: Pos2, p: &Palette) {
    painter.circle_filled(center, 10.0, p.success);
    let tick = if p.dark { p.ground } else { theme::WHITE };
    let pts = [center + Vec2::new(-4.6, 0.4), center + Vec2::new(-1.4, 3.6), center + Vec2::new(4.6, -2.6)];
    painter.line_segment([pts[0], pts[1]], Stroke::new(2.2, tick));
    painter.line_segment([pts[1], pts[2]], Stroke::new(2.2, tick));
}

fn pending_circle(painter: &Painter, center: Pos2, p: &Palette) {
    painter.circle_filled(center, 10.0, p.accent_tint);
    painter.circle_filled(center, 4.0, p.accent);
}

fn attention_circle(painter: &Painter, center: Pos2, p: &Palette) {
    painter.circle_filled(center, 10.0, p.sun_tint);
    painter.circle_filled(center, 4.0, if p.dark { p.sun } else { hex_dark_sun() });
}

fn hex_dark_sun() -> Color32 {
    Color32::from_rgb(0xB5, 0x83, 0x00)
}

/// A clickable area with the pointer cursor, a visible focus ring and an accessible name.
fn clickable(ui: &mut Ui, rect: Rect, id: &str, label: &str, radius: f32, p: &Palette) -> Response {
    let response = ui.interact(rect, ui.id().with(id), Sense::click());
    let label = label.to_string();
    response.widget_info(|| WidgetInfo::labeled(WidgetType::Button, true, label.clone()));
    if response.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    if response.has_focus() {
        ui.painter().rect_stroke(rect.expand(2.0), CornerRadius::from(radius + 2.0), Stroke::new(2.0, p.focus), StrokeKind::Outside);
    }
    response
}

fn button(ui: &mut Ui, rect: Rect, label: &str, radius: f32, enabled: bool, p: &Palette) -> bool {
    let response = clickable(ui, rect, label, label, radius, p);
    let fill = if !enabled {
        if p.dark { p.panel } else { p.rule }
    } else if response.hovered() {
        p.button_hover
    } else {
        p.button
    };
    ui.painter().rect_filled(rect, CornerRadius::from(radius), fill);
    let color = if enabled { theme::WHITE } else { p.quiet };
    let g = galley(ui.ctx(), label, 13.5, Face::Semibold, color, 0.0, f32::INFINITY, None);
    ui.painter().galley(rect.center() - g.size() / 2.0, g, color);
    enabled && response.clicked()
}

/// A text link: returns whether it was clicked.
fn link(ui: &mut Ui, pos: Pos2, align: Align2, text: &str, size: f32, color: Color32, face: Face, p: &Palette) -> (bool, Rect) {
    let g = galley(ui.ctx(), text, size, face, color, 0.0, f32::INFINITY, None);
    let rect = align.anchor_size(pos, g.size());
    let response = clickable(ui, rect.expand(3.0), text, text, 4.0, p);
    let color = if response.hovered() { p.accent } else { color };
    let g = galley(ui.ctx(), text, size, face, color, 0.0, f32::INFINITY, None);
    ui.painter().galley(rect.min, g, color);
    (response.clicked(), rect)
}

fn checkbox(ui: &mut Ui, pos: Pos2, checked: bool, label: &str, p: &Palette) -> bool {
    let g = galley(ui.ctx(), label, 13.0, Face::Body, p.body, 0.0, f32::INFINITY, None);
    let box_rect = Rect::from_min_size(pos, Vec2::splat(16.0));
    let whole = Rect::from_min_max(pos, pos + Vec2::new(16.0 + 8.0 + g.size().x, 16.0));
    let response = ui.interact(whole.expand(3.0), ui.id().with(label), Sense::click());
    let label_owned = label.to_string();
    response.widget_info(|| WidgetInfo::selected(WidgetType::Checkbox, true, checked, label_owned.clone()));
    if response.hovered() {
        ui.ctx().set_cursor_icon(CursorIcon::PointingHand);
    }
    let painter = ui.painter();
    if response.has_focus() {
        painter.rect_stroke(box_rect.expand(2.0), CornerRadius::from(6.0), Stroke::new(2.0, p.focus), StrokeKind::Outside);
    }
    if checked {
        painter.rect_filled(box_rect, CornerRadius::from(4.0), p.button);
        let c = box_rect.center();
        painter.line_segment([c + Vec2::new(-4.0, 0.3), c + Vec2::new(-1.2, 3.1)], Stroke::new(2.0, theme::WHITE));
        painter.line_segment([c + Vec2::new(-1.2, 3.1), c + Vec2::new(4.2, -2.6)], Stroke::new(2.0, theme::WHITE));
    } else {
        painter.rect_stroke(box_rect, CornerRadius::from(4.0), Stroke::new(1.5, p.quiet), StrokeKind::Inside);
    }
    painter.galley(Pos2::new(box_rect.max.x + 8.0, pos.y + 8.0 - g.size().y / 2.0), g, p.body);
    response.clicked()
}

fn image(painter: &Painter, texture: &TextureHandle, rect: Rect, radius: f32, tint: Color32) {
    painter.add(RectShape::filled(rect, CornerRadius::from(radius), tint).with_texture(texture.id(), Rect::from_min_max(Pos2::ZERO, Pos2::new(1.0, 1.0))));
}

/// The photo cropped to `rect` like CSS object-fit: cover.
fn cover(painter: &Painter, texture: &TextureHandle, rect: Rect, radius: f32) {
    let [w, h] = texture.size();
    let (iw, ih) = (w as f32, h as f32);
    let scale = (rect.width() / iw).max(rect.height() / ih);
    let (uw, uh) = (rect.width() / (iw * scale), rect.height() / (ih * scale));
    let uv = Rect::from_center_size(Pos2::new(0.5, 0.5), Vec2::new(uw, uh));
    painter.add(RectShape::filled(rect, CornerRadius::from(radius), Color32::WHITE).with_texture(texture.id(), uv));
}

fn agent_icon(painter: &Painter, assets: &Assets, id: &str, name: &str, rect: Rect, p: &Palette, on_white: bool) {
    match assets.agents.get(id) {
        Some((texture, mono)) => {
            let tint = if *mono { if on_white { Color32::from_rgb(0x17, 0x14, 0x1C) } else { p.text } } else { Color32::WHITE };
            image(painter, texture, rect, 0.0, tint);
        }
        None => {
            painter.circle_filled(rect.center(), rect.width() / 2.0, p.accent_tint);
            let letter = name.chars().next().unwrap_or('?').to_string();
            painter.text(rect.center(), Align2::CENTER_CENTER, letter, FontId::new(rect.width() * 0.6, FontFamily::Name("semibold".into())), p.accent);
        }
    }
}

struct Status {
    label: &'static str,
    color: Color32,
}

fn status(view: &View, p: &Palette) -> Status {
    match view.phase {
        Phase::Connected => Status { label: "Connected", color: p.success },
        Phase::Connecting => Status { label: "Connecting…", color: p.quiet },
        Phase::Reconnecting => Status { label: "Reconnecting…", color: p.quiet },
        Phase::SettingUp => Status { label: "Setting up…", color: p.quiet },
        Phase::Approving if view.approval_opened => Status { label: "Waiting for approval", color: p.accent },
        Phase::Approving | Phase::NotConnected => Status { label: "Not connected", color: p.quiet },
        Phase::Disconnecting => Status { label: "Disconnecting…", color: p.quiet },
        Phase::Stopped => Status { label: "Stopped", color: if p.dark { p.sun } else { hex_dark_sun() } },
    }
}

/// The main action for the state the app is in: its label and command.
fn primary(view: &View) -> (&'static str, Option<&'static str>) {
    match view.phase {
        Phase::Connected | Phase::Connecting | Phase::Reconnecting => ("Open Tinkjam", Some("open-tinkjam")),
        Phase::Approving if view.approval_opened => ("Open the page again", Some("open-approval")),
        Phase::Approving | Phase::NotConnected => ("Connect", Some("connect")),
        Phase::Stopped => ("Try again", Some("retry")),
        Phase::SettingUp => ("Setting up…", None),
        Phase::Disconnecting => ("Disconnecting…", None),
    }
}

impl eframe::App for WindowApp {
    fn clear_color(&self, _visuals: &egui::Visuals) -> [f32; 4] {
        let p = if self.dark.load(Ordering::Relaxed) { theme::DARK } else { theme::LIGHT };
        let base = if self.kind == Kind::Setup { p.ground } else { p.surface };
        egui::Rgba::from(base).to_array()
    }

    fn update(&mut self, ctx: &Context, _frame: &mut eframe::Frame) {
        if self.gone.load(Ordering::SeqCst) {
            ctx.send_viewport_cmd(ViewportCommand::Close);
            return;
        }
        let p = if self.dark.load(Ordering::Relaxed) { theme::DARK } else { theme::LIGHT };
        ctx.set_visuals(if p.dark { egui::Visuals::dark() } else { egui::Visuals::light() });
        if let Some((file, frames)) = self.screenshot.as_mut() {
            *frames += 1;
            let shot = ctx.input(|i| {
                i.raw.events.iter().find_map(|e| match e {
                    egui::Event::Screenshot { image, .. } => Some(image.clone()),
                    _ => None,
                })
            });
            if let Some(image) = shot {
                let [w, h] = image.size;
                let bytes: Vec<u8> = image.pixels.iter().flat_map(|c| c.to_array()).collect();
                if let Some(buffer) = image::RgbaImage::from_raw(w as u32, h as u32, bytes) {
                    let _ = buffer.save(file.as_str());
                }
                ctx.send_viewport_cmd(ViewportCommand::Close);
            } else if *frames == 12 {
                ctx.send_viewport_cmd(ViewportCommand::Screenshot(Default::default()));
            }
            ctx.request_repaint_after(Duration::from_millis(100));
        }
        if let Ok(ui) = std::env::var("TINKJAM_SYNC_FAKE_UI") {
            if self.screenshot.as_ref().is_some_and(|(_, f)| *f == 1) {
                self.settings = ui == "settings";
                self.confirm = (ui == "confirm").then_some(Confirm::Disconnect);
            }
        }
        if self.assets.is_none() {
            self.assets = Some(load_assets(ctx));
        }
        // The panel behaves like a menu: it closes when it loses focus or on Escape.
        if self.kind == Kind::Panel {
            let focused = ctx.input(|i| i.viewport().focused);
            if focused == Some(true) {
                self.had_focus = true;
            } else if focused == Some(false) && self.had_focus && self.confirm.is_none() && self.opened.elapsed() > Duration::from_millis(300) {
                ctx.send_viewport_cmd(ViewportCommand::Close);
            }
        }
        if ctx.input(|i| i.key_pressed(egui::Key::Escape)) {
            if self.confirm.is_some() {
                self.confirm = None;
            } else if self.settings {
                self.settings = false;
            } else if self.kind == Kind::Panel {
                ctx.send_viewport_cmd(ViewportCommand::Close);
            }
        }
        let view = self.state.lock().unwrap().clone();
        let base = if self.kind == Kind::Setup { p.ground } else { p.surface };
        egui::CentralPanel::default().frame(egui::Frame::NONE.fill(base)).show(ctx, |ui| {
            let Some(view) = view else {
                let g = galley(ctx, "Opening Tinkjam Sync…", 13.0, Face::Body, p.quiet, 0.0, f32::INFINITY, None);
                ui.painter().galley(ui.max_rect().center() - g.size() / 2.0, g, p.quiet);
                return;
            };
            let height = match self.kind {
                Kind::Setup => self.draw_setup(ui, &view, &p),
                Kind::Panel | Kind::Home => self.draw_panel(ui, &view, &p),
            };
            let wanted = Vec2::new(self.size.x, height.ceil());
            if (wanted.y - self.size.y).abs() > 0.5 {
                self.size = wanted;
                ctx.send_viewport_cmd(ViewportCommand::InnerSize(wanted));
            }
        });
    }
}

impl WindowApp {
    /// "Getting this computer ready": the steps, the one action, and the art.
    fn draw_setup(&mut self, ui: &mut Ui, view: &View, p: &Palette) -> f32 {
        let ctx = ui.ctx().clone();
        let assets = self.assets.clone().unwrap();
        let assets = &assets;
        let origin = ui.max_rect().min;
        let art_width = 250.0;
        let left_width = SETUP_SIZE.x - art_width - 10.0 - 30.0 - 24.0;
        let x = origin.x + 30.0;
        let mut y = origin.y + 28.0;

        let ready = view.phase == Phase::Connected;
        let heading = if ready { "This computer is ready" } else { "Getting this computer ready" };
        let g = galley(&ctx, heading, 26.0, Face::Outfit, p.text, -0.03, left_width, Some(28.6));
        y += g.size().y;
        ui.painter().galley(Pos2::new(x, origin.y + 28.0), g, p.text);
        y += 12.0;

        // Step 1: Tinkjam Sync itself.
        let installed = view.installed;
        let step = |ui: &mut Ui, y: f32, state: u8, text: &str| -> f32 {
            let center = Pos2::new(x + 10.0, y + 9.0 + 10.0);
            match state {
                0 => check_circle(ui.painter(), center, p),
                1 => pending_circle(ui.painter(), center, p),
                _ => attention_circle(ui.painter(), center, p),
            }
            let g = galley(&ctx, text, 13.0, Face::Semibold, p.text, 0.0, left_width - 30.0, None);
            let h = g.size().y.max(20.0);
            ui.painter().galley(Pos2::new(x + 30.0, y + 9.0 + 10.0 - g.size().y / 2.0), g, p.text);
            y + 18.0 + h
        };
        let stopped = view.phase == Phase::Stopped;
        let state1 = if installed { 0 } else if stopped { 2 } else { 1 };
        y = step(ui, y, state1, if installed { "Tinkjam Sync installed" } else { "Installing Tinkjam Sync" });
        if !installed && view.phase == Phase::SettingUp {
            let detail = view.detail.clone().unwrap_or_default();
            if let Some(percent) = view.percent {
                let track = Rect::from_min_size(Pos2::new(x + 30.0, y - 4.0), Vec2::new(left_width - 30.0, 4.0));
                ui.painter().rect_filled(track, CornerRadius::from(2.0), p.rule);
                let done = Rect::from_min_size(track.min, Vec2::new(track.width() * percent as f32 / 100.0, 4.0));
                ui.painter().rect_filled(done, CornerRadius::from(2.0), p.button);
                y += 6.0;
            }
            let g = galley(&ctx, &detail, 12.0, Face::Body, p.quiet, 0.0, left_width - 30.0, None);
            let h = g.size().y;
            ui.painter().galley(Pos2::new(x + 30.0, y), g, p.quiet);
            y += h + 4.0;
        }

        // Step 2: the agents found here.
        let found = agents::list_names(&view.agents);
        let (state2, text2) = if !installed {
            (1, "Find your agents".to_string())
        } else if found.is_empty() {
            (2, "No agents found yet".to_string())
        } else {
            (0, format!("Found {found}"))
        };
        y = step(ui, y, state2, &text2);
        if installed && found.is_empty() {
            let g = galley(&ctx, "Install Claude Code or Codex to use them from your boards.", 12.0, Face::Body, p.quiet, 0.0, left_width - 30.0, None);
            let h = g.size().y;
            ui.painter().galley(Pos2::new(x + 30.0, y - 6.0), g, p.quiet);
            y += h;
        }

        // Step 3: the account.
        let state3 = if ready { 0 } else { 1 };
        let text3 = if ready { "Connected to your account" } else { "Connect to your account" };
        y = step(ui, y, state3, text3);

        // A problem, in one sentence, above the action that answers it.
        let problem = match view.phase {
            Phase::Stopped | Phase::NotConnected => view.detail.clone(),
            Phase::Approving if view.approval_opened => Some("Sign in to Tinkjam in your browser and press Connect.".into()),
            Phase::Connecting | Phase::Reconnecting => view.detail.clone(),
            _ => None,
        };
        if let Some(text) = problem {
            y += 4.0;
            let g = galley(&ctx, &text, 13.0, Face::Body, p.body, 0.0, left_width, None);
            let h = g.size().y;
            ui.painter().galley(Pos2::new(x, y), g, p.body);
            y += h;
        }
        y += 14.0;
        let (label, command) = if ready {
            ("Done", Some("done"))
        } else {
            match view.phase {
                Phase::Connecting | Phase::Reconnecting => ("Connecting…", None),
                _ => primary(view),
            }
        };
        // While it works by itself there is nothing to press, so no button.
        if let Some(cmd) = command {
            let g = galley(&ctx, label, 13.5, Face::Semibold, theme::WHITE, 0.0, f32::INFINITY, None);
            let rect = Rect::from_min_size(Pos2::new(x, y), Vec2::new(g.size().x + 44.0, 36.0));
            if button(ui, rect, label, 18.0, true, p) {
                match cmd {
                    "done" => ui.ctx().send_viewport_cmd(ViewportCommand::Close),
                    other => self.run(other, view),
                }
            }
            y += 36.0;
        } else {
            let g = galley(&ctx, label, 13.0, Face::Body, p.quiet, 0.0, f32::INFINITY, None);
            let h = g.size().y;
            ui.painter().galley(Pos2::new(x, y + 18.0 - h / 2.0), g, p.quiet);
            y += 36.0;
        }

        // Start when I log in, as the Windows installer frame has it.
        let mut bottom = (y + 24.0).max(origin.y + SETUP_SIZE.y - 28.0 - 16.0);
        if view.can_start_at_login {
            if checkbox(ui, Pos2::new(x, bottom), view.start_at_login, "Start when I log in", p) {
                self.send_json(serde_json::json!({ "cmd": "start-at-login", "on": !view.start_at_login }));
            }
            bottom += 16.0;
        }
        let height = (bottom + 28.0 - origin.y).max(SETUP_SIZE.y);

        // The art: the photo under a cobalt tint, the line, and the agents found here.
        let art = Rect::from_min_max(Pos2::new(origin.x + SETUP_SIZE.x - 10.0 - art_width, origin.y + 10.0), Pos2::new(origin.x + SETUP_SIZE.x - 10.0, origin.y + height - 10.0));
        let painter = ui.painter();
        painter.rect_filled(art, CornerRadius::from(10.0), theme::COBALT);
        cover(painter, &assets.photo, art, 10.0);
        painter.rect_filled(art, CornerRadius::from(10.0), theme::COBALT_DEEP.gamma_multiply(0.4));
        let g = galley(&ctx, "bring your agent to your team's board", 27.0, Face::Outfit, theme::WHITE, -0.035, art.width() - 32.0, Some(30.2));
        painter.galley(art.min + Vec2::new(18.0, 20.0), g, theme::WHITE);
        let mut tile_x = art.min.x + 18.0;
        for agent in view.agents.iter().take(4) {
            let tile = Rect::from_min_size(Pos2::new(tile_x, art.max.y - 18.0 - 38.0), Vec2::splat(38.0));
            painter.rect_filled(tile, CornerRadius::from(10.0), theme::WHITE);
            agent_icon(painter, assets, &agent.id, &agent.name, Rect::from_center_size(tile.center(), Vec2::splat(20.0)), p, true);
            tile_x += 46.0;
        }
        height
    }

    /// The panel: state, the agents here, the one action, settings, quit, version.
    fn draw_panel(&mut self, ui: &mut Ui, view: &View, p: &Palette) -> f32 {
        let ctx = ui.ctx().clone();
        let origin = ui.max_rect().min;
        let pad = 16.0;
        let x = origin.x + pad;
        let right = origin.x + PANEL_WIDTH - pad;
        let width = right - x;
        let mut y = origin.y + pad;
        let assets = self.assets.clone().unwrap();
        let assets = &assets;

        // Header: mark, name, computer, state.
        image(ui.painter(), &assets.mark, Rect::from_min_size(Pos2::new(x, y + 1.0), Vec2::splat(32.0)), 7.5, Color32::WHITE);
        let g = galley(&ctx, "Tinkjam Sync", 17.0, Face::Outfit, p.text, -0.02, f32::INFINITY, None);
        ui.painter().galley(Pos2::new(x + 42.0, y), g, p.text);
        let s = status(view, p);
        let sg = galley(&ctx, s.label, 12.0, Face::Semibold, s.color, 0.0, f32::INFINITY, None);
        let sx = right - sg.size().x;
        ui.painter().galley(Pos2::new(sx, y + 9.0), sg.clone(), s.color);
        ui.painter().circle_filled(Pos2::new(sx - 10.0, y + 9.0 + sg.size().y / 2.0), 4.0, s.color);
        let name_width = (sx - 20.0) - (x + 42.0);
        let g = galley(&ctx, &view.computer, 12.0, Face::Body, p.quiet, 0.0, name_width.max(60.0), None);
        let gh = g.size().y.min(32.0);
        ui.painter().with_clip_rect(Rect::from_min_size(Pos2::new(x + 42.0, y + 20.0), Vec2::new(name_width.max(60.0), gh))).galley(Pos2::new(x + 42.0, y + 20.0), g, p.quiet);
        y += 20.0 + gh.max(14.0);

        if let Some(confirm) = self.confirm {
            let _ = confirm;
            return self.draw_confirm(ui, view, p, y + 14.0, x, width);
        }

        // The card: only what is true right now.
        let working: Vec<_> = view.agents.iter().filter(|a| a.working).cloned().collect();
        let card: Option<(&str, String, Color32, Color32)> = match view.phase {
            Phase::SettingUp => Some(("Setting up", format!("{}{}", view.detail.clone().unwrap_or_default(), view.percent.map(|n| format!(" {n}%")).unwrap_or_default()), p.accent, p.accent_tint)),
            Phase::Approving if view.approval_opened => Some(("Approve in your browser", "Sign in to Tinkjam and press Connect.".into(), p.accent, p.accent_tint)),
            Phase::Approving | Phase::NotConnected => view.detail.clone().map(|d| ("Not connected", d, p.body, p.panel)),
            Phase::Stopped => Some(("Needs your attention", view.detail.clone().unwrap_or_default(), if p.dark { p.sun } else { hex_dark_sun() }, p.sun_tint)),
            Phase::Connecting | Phase::Reconnecting => view.detail.clone().map(|d| ("Still connecting", d, p.body, p.panel)),
            Phase::Connected if !working.is_empty() => {
                let names = agents::list_names(&working);
                let verb = if working.len() == 1 { "is" } else { "are" };
                Some(("Working now", format!("{names} {verb} working on this computer."), p.accent, p.accent_tint))
            }
            _ => None,
        };
        if let Some((label, text, label_color, fill)) = card {
            y += 14.0;
            let lg = galley(&ctx, label, 12.0, Face::Semibold, label_color, 0.0, width - 24.0, None);
            let tg = galley(&ctx, &text, 13.0, Face::Semibold, p.text, 0.0, width - 24.0, None);
            let h = 12.0 + lg.size().y + 2.0 + tg.size().y + 12.0;
            let card = Rect::from_min_size(Pos2::new(x, y), Vec2::new(width, h));
            ui.painter().rect_filled(card, CornerRadius::from(12.0), fill);
            let lh = lg.size().y;
            ui.painter().galley(Pos2::new(x + 12.0, y + 12.0), lg, label_color);
            ui.painter().galley(Pos2::new(x + 12.0, y + 12.0 + lh + 2.0), tg, p.text);
            y += h;
        }

        if self.settings {
            return self.draw_settings(ui, view, p, y, x, width);
        }

        // Agents on this computer.
        y += 14.0;
        let g = galley(&ctx, "AGENTS ON THIS COMPUTER", 11.0, Face::Semibold, p.quiet, 0.08, f32::INFINITY, None);
        let h = g.size().y;
        ui.painter().galley(Pos2::new(x, y), g, p.quiet);
        y += h + 2.0;
        if view.agents.is_empty() {
            let text = if view.installed { "No agents found yet. Install Claude Code or Codex to use them from your boards." } else { "Your agents show here once setup finishes." };
            let g = galley(&ctx, text, 12.5, Face::Body, p.body, 0.0, width, None);
            let h = g.size().y;
            ui.painter().galley(Pos2::new(x, y + 8.0), g, p.body);
            y += h + 14.0;
        }
        for (index, agent) in view.agents.iter().enumerate() {
            if index > 0 {
                ui.painter().hline(x..=right, y, Stroke::new(1.0, p.rule));
            }
            let mid = y + 19.0;
            agent_icon(ui.painter(), assets, &agent.id, &agent.name, Rect::from_center_size(Pos2::new(x + 10.0, mid), Vec2::splat(20.0)), p, false);
            ui.painter().text(Pos2::new(x + 30.0, mid), Align2::LEFT_CENTER, &agent.name, FontId::new(13.5, FontFamily::Name("semibold".into())), p.text);
            if agent.working {
                ui.painter().circle_filled(Pos2::new(right - 4.0, mid), 4.0, p.accent);
                let g = galley(&ctx, "Working", 12.0, Face::Body, p.quiet, 0.0, f32::INFINITY, None);
                ui.painter().galley(Pos2::new(right - 18.0 - g.size().x, mid - g.size().y / 2.0), g, p.quiet);
            }
            y += 38.0;
        }

        // The one action.
        y += 12.0;
        let (label, command) = primary(view);
        if button(ui, Rect::from_min_size(Pos2::new(x, y), Vec2::new(width, 36.0)), label, 8.0, command.is_some(), p) {
            if let Some(cmd) = command {
                self.run(cmd, view);
            }
        }
        y += 36.0;

        // Settings and Quit.
        y += 12.0;
        let (settings, r) = link(ui, Pos2::new(x, y), Align2::LEFT_TOP, "Settings", 13.0, p.body, Face::Semibold, p);
        if settings {
            self.settings = true;
        }
        let (quit, _) = link(ui, Pos2::new(right, y), Align2::RIGHT_TOP, "Quit", 13.0, p.body, Face::Semibold, p);
        if quit {
            self.send("quit");
        }
        y = r.max.y;
        self.draw_footer(ui, view, p, y, x, right)
    }

    fn draw_footer(&mut self, ui: &mut Ui, view: &View, p: &Palette, mut y: f32, x: f32, right: f32) -> f32 {
        y += 12.0;
        ui.painter().hline(x..=right, y, Stroke::new(1.0, p.rule));
        y += 10.0;
        let ctx = ui.ctx().clone();
        let g = galley(&ctx, &format!("Version {}", view.version), 12.0, Face::Body, p.quiet, 0.0, f32::INFINITY, None);
        let h = g.size().y;
        ui.painter().galley(Pos2::new(x, y), g, p.quiet);
        let update_version = view.update_version.clone().unwrap_or_default();
        let (text, action): (String, Option<&str>) = match view.update {
            UpdateState::Checking => ("Checking…".into(), None),
            UpdateState::UpToDate => ("Up to date".into(), None),
            UpdateState::Ready => ("Restart to update".into(), Some("restart-to-update")),
            UpdateState::Manual => (format!("Get version {update_version}"), Some("download")),
            UpdateState::Failed => ("Couldn't check for updates".into(), Some("check-for-updates")),
            UpdateState::Idle => ("Check for updates".into(), Some("check-for-updates")),
        };
        match action {
            Some(cmd) => {
                let (clicked, _) = link(ui, Pos2::new(right, y), Align2::RIGHT_TOP, &text, 12.0, p.accent, Face::Semibold, p);
                if clicked {
                    self.run(cmd, view);
                }
            }
            None => {
                let g = galley(&ctx, &text, 12.0, Face::Body, p.quiet, 0.0, f32::INFINITY, None);
                ui.painter().galley(Pos2::new(right - g.size().x, y), g, p.quiet);
            }
        }
        y + h + 16.0 - ui.max_rect().min.y
    }

    fn draw_settings(&mut self, ui: &mut Ui, view: &View, p: &Palette, mut y: f32, x: f32, width: f32) -> f32 {
        let ctx = ui.ctx().clone();
        let right = x + width;
        y += 14.0;
        let g = galley(&ctx, "SETTINGS", 11.0, Face::Semibold, p.quiet, 0.08, f32::INFINITY, None);
        let h = g.size().y;
        ui.painter().galley(Pos2::new(x, y), g, p.quiet);
        y += h + 2.0;
        let mut first = true;
        let mut row = |ui: &mut Ui, y: &mut f32| {
            if !first {
                ui.painter().hline(x..=right, *y, Stroke::new(1.0, p.rule));
            }
            first = false;
            let top = *y;
            *y += 38.0;
            top
        };
        if view.can_start_at_login {
            let top = row(ui, &mut y);
            if checkbox(ui, Pos2::new(x, top + 11.0), view.start_at_login, "Start when I log in", p) {
                self.send_json(serde_json::json!({ "cmd": "start-at-login", "on": !view.start_at_login }));
            }
        }
        let mut item = |this: &mut Self, ui: &mut Ui, y: &mut f32, label: &str, color: Color32| -> bool {
            let top = row(ui, y);
            let _ = this;
            link(ui, Pos2::new(x, top + 19.0), Align2::LEFT_CENTER, label, 13.0, color, Face::Semibold, p).0
        };
        if item(self, ui, &mut y, "Check for updates", p.text) {
            self.send("check-for-updates");
        }
        if item(self, ui, &mut y, "Show technical log", p.text) {
            procs::open_url(&format!("file://{}", view.log_path));
        }
        if view.installed && !matches!(view.phase, Phase::NotConnected | Phase::Disconnecting | Phase::SettingUp) && item(self, ui, &mut y, "Disconnect this computer…", p.text) {
            self.confirm = Some(Confirm::Disconnect);
        }
        if view.can_uninstall && item(self, ui, &mut y, "Remove Tinkjam Sync from this computer…", p.text) {
            self.confirm = Some(Confirm::Remove);
        }
        y += 4.0;
        let (back, r) = link(ui, Pos2::new(x, y + 8.0), Align2::LEFT_TOP, "Back", 13.0, p.body, Face::Semibold, p);
        if back {
            self.settings = false;
        }
        let (quit, _) = link(ui, Pos2::new(right, y + 8.0), Align2::RIGHT_TOP, "Quit", 13.0, p.body, Face::Semibold, p);
        if quit {
            self.send("quit");
        }
        self.draw_footer(ui, view, p, r.max.y, x, right)
    }

    fn draw_confirm(&mut self, ui: &mut Ui, view: &View, p: &Palette, mut y: f32, x: f32, width: f32) -> f32 {
        let ctx = ui.ctx().clone();
        let (question, detail, action, command) = match self.confirm.unwrap_or(Confirm::Disconnect) {
            Confirm::Disconnect => (
                "Disconnect this computer from your Tinkjam account?",
                "Your boards can't use the agents on this computer until you connect it again.",
                "Disconnect",
                "disconnect",
            ),
            Confirm::Remove => (
                "Remove Tinkjam Sync from this computer?",
                "This computer stays connected to your account until you disconnect it in Tinkjam's Settings.",
                "Remove",
                "uninstall",
            ),
        };
        let g = galley(&ctx, question, 15.0, Face::Semibold, p.text, 0.0, width, None);
        let h = g.size().y;
        ui.painter().galley(Pos2::new(x, y), g, p.text);
        y += h + 6.0;
        let g = galley(&ctx, detail, 13.0, Face::Body, p.body, 0.0, width, None);
        let h = g.size().y;
        ui.painter().galley(Pos2::new(x, y), g, p.body);
        y += h + 14.0;
        let half = (width - 8.0) / 2.0;
        if button(ui, Rect::from_min_size(Pos2::new(x, y), Vec2::new(half, 36.0)), action, 8.0, true, p) {
            self.send(command);
            self.confirm = None;
            self.settings = false;
        }
        let cancel = Rect::from_min_size(Pos2::new(x + half + 8.0, y), Vec2::new(half, 36.0));
        let response = clickable(ui, cancel, "cancel", "Cancel", 8.0, p);
        ui.painter().rect_stroke(cancel, CornerRadius::from(8.0), Stroke::new(1.0, p.rule), StrokeKind::Inside);
        ui.painter().text(cancel.center(), Align2::CENTER_CENTER, "Cancel", FontId::new(13.5, FontFamily::Name("semibold".into())), p.text);
        if response.clicked() {
            self.confirm = None;
        }
        y += 36.0;
        let right = x + width;
        self.draw_footer(ui, view, p, y, x, right)
    }

    fn run(&mut self, command: &str, view: &View) {
        match command {
            "open-tinkjam" => {
                procs::open_url(&config::hosted_app_url());
            }
            "download" => {
                procs::open_url(&config::download_page_url());
            }
            other => {
                let _ = view;
                self.send(other)
            }
        }
    }
}

/// A WAYLAND_DISPLAY with no compositor behind it (a stale session variable) would stop the
/// window from opening at all; X11, when there is one, is used instead.
fn choose_display() {
    let Ok(name) = std::env::var("WAYLAND_DISPLAY") else { return };
    let socket = if name.starts_with('/') {
        std::path::PathBuf::from(&name)
    } else {
        std::path::PathBuf::from(std::env::var("XDG_RUNTIME_DIR").unwrap_or_default()).join(&name)
    };
    if !socket.exists() && std::env::var_os("DISPLAY").is_some() {
        crate::log::app(format!("No Wayland compositor at {}; using X11", socket.display()));
        std::env::remove_var("WAYLAND_DISPLAY");
    }
}

pub fn run(paths: &Paths, kind: Kind, at: Option<(i32, i32)>) -> std::process::ExitCode {
    choose_display();
    let paths = paths.clone();
    let result = eframe::run_native("Tinkjam Sync", options(kind, at), Box::new(move |cc| Ok(Box::new(WindowApp::new(cc, kind, paths)))));
    match result {
        Ok(()) => std::process::ExitCode::SUCCESS,
        Err(error) => {
            crate::log::app(format!("{} ({error})", crate::words::NO_GRAPHICS));
            eprintln!("{}: {error}", crate::words::NO_GRAPHICS);
            std::process::ExitCode::FAILURE
        }
    }
}
