//! The tray icon, as a StatusNotifierItem (KDE, and GNOME with the AppIndicator extension that
//! Ubuntu ships). A click opens the panel; the menu is for hosts that only show menus.

use std::sync::Arc;
use std::time::Duration;

use ksni::blocking::TrayMethods;
use ksni::menu::StandardItem;

use super::{Msg, MsgSender};
use crate::config;
use crate::engine::{Phase, Shared, View};

struct TrayIcon {
    phase: Phase,
    detail: Option<String>,
    tx: std::sync::Mutex<MsgSender>,
    icons: Arc<[Vec<ksni::Icon>; 3]>,
}

fn pixmaps(sources: &[&[u8]]) -> Vec<ksni::Icon> {
    sources
        .iter()
        .filter_map(|bytes| image::load_from_memory(bytes).ok())
        .map(|image| {
            let rgba = image.to_rgba8();
            let (width, height) = (rgba.width() as i32, rgba.height() as i32);
            // ARGB32 in network byte order.
            let data = rgba.pixels().flat_map(|p| [p[3], p[0], p[1], p[2]]).collect();
            ksni::Icon { width, height, data }
        })
        .collect()
}

fn load_icons() -> [Vec<ksni::Icon>; 3] {
    [
        pixmaps(&[
            include_bytes!("../../assets/icons/tray/connected-22.png"),
            include_bytes!("../../assets/icons/tray/connected-32.png"),
            include_bytes!("../../assets/icons/tray/connected-48.png"),
            include_bytes!("../../assets/icons/tray/connected-64.png"),
        ]),
        pixmaps(&[
            include_bytes!("../../assets/icons/tray/idle-22.png"),
            include_bytes!("../../assets/icons/tray/idle-32.png"),
            include_bytes!("../../assets/icons/tray/idle-48.png"),
            include_bytes!("../../assets/icons/tray/idle-64.png"),
        ]),
        pixmaps(&[
            include_bytes!("../../assets/icons/tray/attention-22.png"),
            include_bytes!("../../assets/icons/tray/attention-32.png"),
            include_bytes!("../../assets/icons/tray/attention-48.png"),
            include_bytes!("../../assets/icons/tray/attention-64.png"),
        ]),
    ]
}

pub fn status_line(phase: Phase) -> &'static str {
    match phase {
        Phase::SettingUp => "Setting up…",
        Phase::Approving => "Waiting for you to approve this computer",
        Phase::Connecting => "Connecting…",
        Phase::Connected => "Connected",
        Phase::Reconnecting => "Reconnecting…",
        Phase::NotConnected => "Not connected",
        Phase::Disconnecting => "Disconnecting…",
        Phase::Stopped => "Needs your attention",
    }
}

impl TrayIcon {
    fn send(&self, msg: Msg) {
        let _ = self.tx.lock().unwrap().send(msg);
    }
}

impl ksni::Tray for TrayIcon {
    fn id(&self) -> String {
        "tinkjam-sync".into()
    }

    fn title(&self) -> String {
        "Tinkjam Sync".into()
    }

    fn icon_pixmap(&self) -> Vec<ksni::Icon> {
        let index = match self.phase {
            Phase::Connected => 0,
            Phase::Stopped | Phase::Approving | Phase::NotConnected => 2,
            _ => 1,
        };
        self.icons[index].clone()
    }

    fn status(&self) -> ksni::Status {
        if matches!(self.phase, Phase::Stopped) {
            ksni::Status::NeedsAttention
        } else {
            ksni::Status::Active
        }
    }

    fn tool_tip(&self) -> ksni::ToolTip {
        ksni::ToolTip {
            title: "Tinkjam Sync".into(),
            description: match &self.detail {
                Some(detail) => format!("{}. {detail}", status_line(self.phase).trim_end_matches('…')),
                None => status_line(self.phase).into(),
            },
            ..Default::default()
        }
    }

    fn activate(&mut self, x: i32, y: i32) {
        let at = (x > 0 || y > 0).then_some((x, y));
        self.send(Msg::Panel(at));
    }

    fn menu(&self) -> Vec<ksni::MenuItem<Self>> {
        vec![
            StandardItem { label: status_line(self.phase).into(), enabled: false, ..Default::default() }.into(),
            ksni::MenuItem::Separator,
            StandardItem { label: "Show Tinkjam Sync".into(), activate: Box::new(|t: &mut Self| t.send(Msg::Home)), ..Default::default() }.into(),
            StandardItem {
                label: "Open Tinkjam".into(),
                activate: Box::new(|_: &mut Self| {
                    crate::procs::open_url(&config::hosted_app_url());
                }),
                ..Default::default()
            }
            .into(),
            ksni::MenuItem::Separator,
            StandardItem { label: "Quit Tinkjam Sync".into(), activate: Box::new(|t: &mut Self| t.send(Msg::Quit)), ..Default::default() }.into(),
        ]
    }

    fn watcher_offline(&self, _reason: ksni::OfflineReason) -> bool {
        // Keep the item: the host may come back (a shell restart).
        true
    }
}

/// The running tray, or None when this desktop has no StatusNotifierItem host.
pub struct Tray {
    handle: ksni::blocking::Handle<TrayIcon>,
}

impl Drop for Tray {
    fn drop(&mut self) {
        let _ = self.handle.shutdown();
    }
}

pub fn start(shared: Arc<Shared>, tx: MsgSender) -> Option<Tray> {
    let (_, view) = shared.view();
    let icon = TrayIcon { phase: view.phase, detail: view.detail.clone(), tx: std::sync::Mutex::new(tx), icons: Arc::new(load_icons()) };
    let handle = match icon.spawn() {
        Ok(handle) => handle,
        Err(error) => {
            crate::log::app(format!("No tray: {error}"));
            return None;
        }
    };
    let follow = handle.clone();
    std::thread::spawn(move || {
        let mut serial = 0;
        let mut shown: Option<(Phase, Option<String>)> = None;
        while !follow.is_closed() {
            let (next, view): (u64, View) = shared.view_after(serial, Duration::from_secs(30));
            serial = next;
            let now = (view.phase, view.detail.clone());
            if shown.as_ref() != Some(&now) {
                shown = Some(now);
                follow.update(|t| {
                    t.phase = view.phase;
                    t.detail = view.detail.clone();
                });
            }
        }
    });
    Some(Tray { handle })
}
