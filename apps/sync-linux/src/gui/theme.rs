//! Colours, and whether the desktop asks for dark: the XDG desktop portal's `color-scheme` (GNOME,
//! KDE and others), else GNOME's own setting, else GTK_THEME. TINKJAM_SYNC_THEME=dark|light
//! overrides it, for screenshots and tests.

use eframe::egui::Color32;

#[derive(Clone, Copy)]
pub struct Palette {
    pub dark: bool,
    pub ground: Color32,
    pub surface: Color32,
    pub panel: Color32,
    pub rule: Color32,
    pub text: Color32,
    pub body: Color32,
    pub quiet: Color32,
    /// Links and accents drawn on the ground.
    pub accent: Color32,
    /// Buttons: always white text on cobalt.
    pub button: Color32,
    pub button_hover: Color32,
    pub accent_tint: Color32,
    pub success: Color32,
    pub sun: Color32,
    pub sun_tint: Color32,
    pub focus: Color32,
}

const fn hex(v: u32) -> Color32 {
    Color32::from_rgb((v >> 16) as u8, (v >> 8) as u8, v as u8)
}

pub const COBALT: Color32 = hex(0x2F5BEA);
pub const COBALT_DEEP: Color32 = hex(0x1C3FBF);
pub const WHITE: Color32 = Color32::WHITE;

pub const LIGHT: Palette = Palette {
    dark: false,
    ground: hex(0xFFFFFF),
    surface: hex(0xFFFFFF),
    panel: hex(0xF6F5F2),
    rule: hex(0xE7E4DE),
    text: hex(0x17141C),
    body: hex(0x4A4652),
    quiet: hex(0x6F6A78),
    accent: hex(0x2F5BEA),
    button: hex(0x2F5BEA),
    button_hover: hex(0x1C3FBF),
    accent_tint: hex(0xE9EEFE),
    success: hex(0x14634A),
    sun: hex(0xFFC83D),
    sun_tint: hex(0xFFF3CF),
    focus: hex(0x2F5BEA),
};

pub const DARK: Palette = Palette {
    dark: true,
    ground: hex(0x121016),
    surface: hex(0x1B1820),
    panel: hex(0x232029),
    rule: hex(0x34303C),
    text: hex(0xF6F3EE),
    body: hex(0xC9C4D1),
    quiet: hex(0x928C9C),
    accent: hex(0x5B7DFF),
    button: hex(0x2F5BEA),
    button_hover: hex(0x4A70F0),
    accent_tint: hex(0x1C2550),
    success: hex(0x3FBF8F),
    sun: hex(0xFFC83D),
    sun_tint: hex(0x3A2F12),
    focus: hex(0x9DB8FF),
};

pub fn prefers_dark() -> bool {
    match std::env::var("TINKJAM_SYNC_THEME").ok().as_deref() {
        Some("dark") => return true,
        Some("light") => return false,
        _ => {}
    }
    if let Some(scheme) = portal_scheme() {
        // 1 prefers dark, 2 prefers light, 0 no preference.
        if scheme != 0 {
            return scheme == 1;
        }
    }
    if let Some(out) = crate::procs::run_with_timeout(
        std::process::Command::new("gsettings").args(["get", "org.gnome.desktop.interface", "color-scheme"]),
        std::time::Duration::from_secs(2),
    ) {
        if out.contains("prefer-dark") {
            return true;
        }
    }
    std::env::var("GTK_THEME").map(|t| t.to_lowercase().contains(":dark")).unwrap_or(false)
}

fn portal_scheme() -> Option<u32> {
    use zbus::zvariant::OwnedValue;
    let connection = zbus::blocking::Connection::session().ok()?;
    let reply = connection
        .call_method(
            Some("org.freedesktop.portal.Desktop"),
            "/org/freedesktop/portal/desktop",
            Some("org.freedesktop.portal.Settings"),
            "ReadOne",
            &("org.freedesktop.appearance", "color-scheme"),
        )
        .ok()?;
    let value: OwnedValue = reply.body().deserialize().ok()?;
    u32::try_from(&value).ok()
}
