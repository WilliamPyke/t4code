//! The desktop build's front end: the tray icon, the windows (each its own process) and
//! notifications. The engine does the work; this only shows it.

pub mod theme;
mod tray;
mod window;

use std::collections::HashMap;
use std::process::{Child, Command, ExitCode, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError, Sender};
use std::sync::Arc;
use std::time::{Duration, Instant};

use crate::config::Paths;
use crate::engine::{Cmd, FrontEvent, Shared};
use crate::{ipc, log, procs, Args};

pub use window::Kind;

pub enum Msg {
    Setup,
    Panel(Option<(i32, i32)>),
    Home,
    Notify(String, String),
    Quit,
}

pub fn run_window(paths: &Paths, kind: &str, at: Option<(i32, i32)>) -> ExitCode {
    let kind = match kind {
        "setup" => Kind::Setup,
        "panel" => Kind::Panel,
        "home" => Kind::Home,
        other => {
            eprintln!("Unknown window {other}: setup, panel or home.");
            return ExitCode::from(2);
        }
    };
    window::run(paths, kind, at)
}

struct Windows {
    paths: Paths,
    open: HashMap<&'static str, Child>,
    panel_closed_at: Option<Instant>,
}

impl Windows {
    fn reap(&mut self) {
        let mut closed = Vec::new();
        for (kind, child) in self.open.iter_mut() {
            if !matches!(child.try_wait(), Ok(None)) {
                closed.push(*kind);
            }
        }
        for kind in closed {
            self.open.remove(kind);
            if kind == "panel" {
                self.panel_closed_at = Some(Instant::now());
            }
        }
    }

    fn is_open(&mut self, kind: &str) -> bool {
        self.reap();
        self.open.contains_key(kind)
    }

    fn show(&mut self, kind: &'static str, at: Option<(i32, i32)>) {
        if self.is_open(kind) {
            return;
        }
        let Ok(exe) = std::env::current_exe() else { return };
        let mut command = Command::new(exe);
        command.args(["--window", kind]).stdin(Stdio::null());
        if !self.paths.is_default {
            command.arg("--base-dir").arg(&self.paths.base);
        }
        if let Some((x, y)) = at {
            command.arg("--at").arg(format!("{x},{y}"));
        }
        match command.spawn() {
            Ok(child) => {
                self.open.insert(kind, child);
            }
            Err(error) => log::app(format!("Could not open the {kind} window: {error}")),
        }
    }

    fn close(&mut self, kind: &str) {
        if let Some(mut child) = self.open.remove(kind) {
            procs::kill(child.id() as i32, libc::SIGTERM);
            let _ = child.wait();
        }
    }

    fn close_all(&mut self) {
        let kinds: Vec<&'static str> = self.open.keys().copied().collect();
        for kind in kinds {
            self.close(kind);
        }
    }
}

fn notify(title: &str, body: &str) {
    let path = std::env::var("PATH").unwrap_or_default();
    if procs::which("notify-send", &path).is_none() {
        return;
    }
    let _ = Command::new("notify-send")
        .args(["--app-name=Tinkjam Sync", "--icon=org.tinkjam.Sync", title, body])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|mut child| {
            std::thread::spawn(move || {
                let _ = child.wait();
            })
        });
}

pub fn run_front(paths: &Paths, shared: Arc<Shared>, args: &Args, quit: &AtomicBool) -> ExitCode {
    let (tx, rx) = mpsc::channel::<Msg>();
    {
        let tx = std::sync::Mutex::new(tx.clone());
        shared.set_front(move |event| {
            let _ = tx.lock().unwrap().send(match event {
                FrontEvent::ShowSetup => Msg::Setup,
                FrontEvent::Notify(title, body) => Msg::Notify(title, body),
            });
        });
    }
    {
        let tx = std::sync::Mutex::new(tx.clone());
        if let Err(error) = ipc::serve(&paths.socket(), shared.clone(), move |request| {
            let _ = tx.lock().unwrap().send(match request {
                ipc::FrontRequest::Show => Msg::Home,
                ipc::FrontRequest::Panel => Msg::Panel(None),
                ipc::FrontRequest::Quit => Msg::Quit,
            });
        }) {
            log::app(format!("Could not open the control socket {}: {error}", paths.socket().display()));
        }
    }
    let mut tray = tray::start(shared.clone(), tx.clone());
    shared.set_tray(tray.is_some());
    if tray.is_none() {
        log::app("No tray is available here (no StatusNotifierItem host); the window opens from the app menu instead");
    }
    shared.send(Cmd::Start { interactive: !args.autostart });

    let mut windows = Windows { paths: paths.clone(), open: HashMap::new(), panel_closed_at: None };
    let started = Instant::now();
    let mut setup_requested = false;
    let mut first_window_due = !args.autostart;
    let mut next_tray_try = Instant::now() + Duration::from_secs(60);
    while !quit.load(Ordering::SeqCst) {
        match rx.recv_timeout(Duration::from_millis(200)) {
            Ok(Msg::Setup) => {
                setup_requested = true;
                windows.close("home");
                windows.show("setup", None);
            }
            Ok(Msg::Home) => {
                if !windows.is_open("setup") {
                    windows.close("panel");
                    windows.show("home", None);
                }
            }
            Ok(Msg::Panel(at)) => {
                windows.reap();
                let just_closed = windows.panel_closed_at.is_some_and(|t| t.elapsed() < Duration::from_millis(500));
                if windows.is_open("panel") {
                    windows.close("panel");
                } else if !just_closed && !windows.is_open("setup") {
                    windows.close("home");
                    windows.show("panel", at);
                }
            }
            Ok(Msg::Notify(title, body)) => notify(&title, &body),
            Ok(Msg::Quit) => break,
            Err(RecvTimeoutError::Timeout) => {}
            Err(RecvTimeoutError::Disconnected) => break,
        }
        windows.reap();
        // Opened from the app menu: show the app, unless the first-run window is coming.
        if first_window_due && started.elapsed() > Duration::from_millis(1500) {
            first_window_due = false;
            if !setup_requested && !windows.is_open("setup") {
                windows.show("home", None);
            }
        }
        // The tray can appear later (a GNOME extension turned on after log-in).
        if tray.is_none() && Instant::now() >= next_tray_try {
            next_tray_try = Instant::now() + Duration::from_secs(60);
            tray = tray::start(shared.clone(), tx.clone());
            if tray.is_some() {
                log::app("A tray is available now; Tinkjam Sync's icon is in it");
                shared.set_tray(true);
            }
        }
    }
    windows.close_all();
    drop(tray);
    ExitCode::SUCCESS
}

pub type MsgSender = Sender<Msg>;
