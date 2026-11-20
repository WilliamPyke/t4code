//! Gets Sync onto this computer and keeps exactly one running as a child. Sync itself is the
//! published package (https://tinkjam.com/sync.tgz) run by a private Node; this only drives it,
//! the same way Tinkjam Sync for Mac and Windows do. Everything happens on one engine thread;
//! the windows, the tray and the CLI only read the view and send commands.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::mpsc::{self, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::agents::{self, Agent};
use crate::config::{self, Paths};
use crate::net::{self, NetError};
use crate::{desktop, log, procs, signature, updater, words};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    SettingUp,
    Approving,
    Connecting,
    Connected,
    Reconnecting,
    NotConnected,
    Disconnecting,
    Stopped,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UpdateState {
    #[default]
    Idle,
    Checking,
    UpToDate,
    /// A newer app is downloaded and checked: "Restart to update".
    Ready,
    /// A newer app exists but this copy cannot replace itself (a .deb or .rpm install).
    Manual,
    Failed,
}

/// What the windows, the tray and `status` show. Only real state: nothing here is guessed.
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct View {
    pub phase: Phase,
    pub detail: Option<String>,
    pub percent: Option<u8>,
    pub computer: String,
    /// Node and the Sync package are in place.
    pub installed: bool,
    pub agents: Vec<Agent>,
    pub approval_url: Option<String>,
    /// The browser was opened for the current approval.
    pub approval_opened: bool,
    pub start_at_login: bool,
    pub can_start_at_login: bool,
    pub version: String,
    pub update: UpdateState,
    pub update_version: Option<String>,
    pub busy: bool,
    pub tray: bool,
    /// An AppImage install this app made itself, which it can also remove.
    pub can_uninstall: bool,
    pub log_path: String,
}

#[derive(Debug)]
pub enum Cmd {
    Start { interactive: bool },
    Connect,
    OpenApproval,
    Retry,
    Disconnect,
    SetStartAtLogin(bool),
    CheckForUpdates { manual: bool },
    RestartToUpdate,
    RefreshAgents,
    Uninstall,
    Line(u64, String),
    Exit(u64, String),
}

/// What the front end (tray app or CLI) is asked to do.
#[derive(Clone, Debug)]
pub enum FrontEvent {
    /// Bring the first-run window forward.
    ShowSetup,
    Notify(String, String),
}

pub struct Shared {
    view: Mutex<(u64, View)>,
    changed: Condvar,
    pub commands: Mutex<Sender<Cmd>>,
    pub shutting_down: AtomicBool,
    child_pid: AtomicI32,
    front: Mutex<Option<Box<dyn Fn(FrontEvent) + Send>>>,
    pub paths: Paths,
}

impl Shared {
    pub fn view(&self) -> (u64, View) {
        self.view.lock().unwrap().clone()
    }

    /// The view once it is newer than `after`, or as it is after `wait`.
    pub fn view_after(&self, after: u64, wait: Duration) -> (u64, View) {
        let guard = self.view.lock().unwrap();
        let (guard, _) = self.changed.wait_timeout_while(guard, wait, |(serial, _)| *serial <= after).unwrap();
        guard.clone()
    }

    fn update(&self, change: impl FnOnce(&mut View)) {
        let mut guard = self.view.lock().unwrap();
        let mut next = guard.1.clone();
        change(&mut next);
        if next != guard.1 {
            guard.0 += 1;
            guard.1 = next;
            self.changed.notify_all();
        }
    }

    pub fn send(&self, cmd: Cmd) {
        let _ = self.commands.lock().unwrap().send(cmd);
    }

    pub fn set_front(&self, front: impl Fn(FrontEvent) + Send + 'static) {
        *self.front.lock().unwrap() = Some(Box::new(front));
    }

    fn front(&self, event: FrontEvent) {
        if let Some(front) = self.front.lock().unwrap().as_ref() {
            front(event);
        }
    }

    pub fn set_tray(&self, available: bool) {
        self.update(|v| v.tray = available);
    }

    /// Stops Sync from any thread (quitting): SIGTERM lets it close its tunnel helper itself;
    /// whatever is left after ten seconds is killed.
    pub fn shutdown(&self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        let pid = self.child_pid.swap(0, Ordering::SeqCst);
        if pid > 0 {
            log::app(format!("Quitting: stopping Tinkjam Sync (pid {pid})"));
            stop_tree(pid, Duration::from_secs(10));
            let _ = std::fs::remove_file(self.paths.child_record());
        }
    }
}

fn stop_tree(pid: i32, grace: Duration) {
    let tree = procs::descendants(pid);
    procs::kill(pid, libc::SIGTERM);
    let deadline = Instant::now() + grace;
    while procs::alive(pid) && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(100));
    }
    if procs::alive(pid) {
        procs::kill(pid, libc::SIGKILL);
    }
    for child in tree {
        if procs::alive(child) {
            procs::kill(child, libc::SIGKILL);
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub start_at_login: Option<bool>,
    /// The person chose Disconnect: nothing connects again until they choose Connect.
    pub disconnected: bool,
    pub sync_version: Option<String>,
    /// The app version this copy already tried to update to by itself.
    pub update_attempted: Option<String>,
}

impl Settings {
    pub fn load(paths: &Paths) -> Settings {
        std::fs::read_to_string(paths.settings()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
    }

    fn save(&self, paths: &Paths) {
        let _ = std::fs::create_dir_all(&paths.base);
        let tmp = paths.settings().with_extension("json.tmp");
        if std::fs::write(&tmp, serde_json::to_string_pretty(self).unwrap_or_default()).is_ok() {
            let _ = std::fs::rename(&tmp, paths.settings());
        }
    }
}

#[derive(Debug)]
pub struct SetupError {
    pub plain: &'static str,
    pub detail: String,
    pub offline: bool,
}

impl From<NetError> for SetupError {
    fn from(e: NetError) -> Self {
        SetupError { plain: e.plain, detail: e.detail, offline: e.offline }
    }
}

fn fail(plain: &'static str, detail: impl Into<String>) -> SetupError {
    SetupError { plain, detail: detail.into(), offline: false }
}

fn io_fail(error: std::io::Error, doing: &str) -> SetupError {
    let plain = if error.raw_os_error() == Some(libc::ENOSPC) { words::DISK_FULL } else { words::SETUP_FAILED };
    fail(plain, format!("{doing}: {error}"))
}

/// What one line of Sync's output means to the app. Sync's words are for people; the app keys
/// on the few that change what it shows, and on `TINKJAM_SYNC_APPROVE_URL` from `sync --app`.
#[derive(Debug, PartialEq)]
pub enum SyncLine {
    ApprovalUrl(String),
    ComputerName(String),
    Approved,
    Connected,
    PortBusy,
    Held,
    Other,
}

impl SyncLine {
    pub fn classify(raw: &str) -> SyncLine {
        let line = raw.trim();
        // Only Sync's own page on this computer is ever opened, whatever a line says.
        let local = |url: &str| {
            url.strip_prefix("http://127.0.0.1:")
                .map(|rest| {
                    let port: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
                    !port.is_empty() && rest[port.len()..].chars().all(|c| !c.is_whitespace()) && (rest.len() == port.len() || rest[port.len()..].starts_with('/'))
                })
                .unwrap_or(false)
        };
        if let Some(url) = line.strip_prefix("TINKJAM_SYNC_APPROVE_URL ") {
            return if local(url.trim()) { SyncLine::ApprovalUrl(url.trim().into()) } else { SyncLine::Other };
        }
        if line.starts_with("http://127.0.0.1:") && local(line) {
            return SyncLine::ApprovalUrl(line.into());
        }
        if let Some(rest) = line.strip_prefix("To connect ") {
            if let Some(name) = rest.split(" to Tinkjam, open this link").next().filter(|_| rest.contains(" to Tinkjam, open this link")) {
                return SyncLine::ComputerName(name.into());
            }
        }
        if line == "Approved." {
            return SyncLine::Approved;
        }
        if line.starts_with("Connected.") {
            return SyncLine::Connected;
        }
        if line.contains("EADDRINUSE") && line.contains(&config::APPROVAL_PORT.to_string()) {
            return SyncLine::PortBusy;
        }
        if line.contains("already running in the background") || line.contains("Tinkjam Sync is already running") {
            return SyncLine::Held;
        }
        SyncLine::Other
    }
}

/// `<home>/userdata/sync-status.json`, which Sync rewrites every 30 seconds once connected.
#[derive(Debug, Deserialize)]
struct SyncStatus {
    pid: Option<i64>,
    status: String,
    cause: Option<String>,
    #[serde(rename = "checkedAt")]
    checked_at: Option<String>,
}

#[derive(Debug, PartialEq)]
enum Health {
    Unknown,
    Reachable,
    Unreachable(Option<String>),
    Stale,
}

const STALE_AFTER: u64 = 150;

fn health(paths: &Paths, pid: i32, now: u64) -> Health {
    let Some(status) = std::fs::read_to_string(paths.status()).ok().and_then(|t| serde_json::from_str::<SyncStatus>(&t).ok()) else {
        return Health::Unknown;
    };
    if status.pid != Some(pid as i64) {
        return Health::Unknown;
    }
    if let Some(at) = status.checked_at.as_deref().and_then(log::parse_utc) {
        if now.saturating_sub(at) > STALE_AFTER {
            return Health::Stale;
        }
    }
    if status.status == "reachable" {
        Health::Reachable
    } else {
        Health::Unreachable(status.cause)
    }
}

/// `<major>.<minor>.<patch>+<yyyymmddhhmm>`, as the Sync package numbers itself.
pub fn is_newer(own: Option<&str>, latest: Option<&str>) -> bool {
    fn parse(v: &str) -> Option<([u64; 3], String)> {
        let (main, build) = v.trim().split_once('+').map(|(a, b)| (a, b.to_string())).unwrap_or((v.trim(), String::new()));
        if !build.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        let parts: Vec<u64> = main.split('.').map(|p| p.parse().ok()).collect::<Option<_>>()?;
        (parts.len() == 3).then(|| ([parts[0], parts[1], parts[2]], build))
    }
    let Some(theirs) = latest.and_then(parse) else { return false };
    let Some(mine) = own.and_then(parse) else { return true };
    if theirs.0 != mine.0 {
        return theirs.0 > mine.0;
    }
    (theirs.1.len(), &theirs.1) > (mine.1.len(), &mine.1)
}

/// Restarts after a crash: 2, 4, 8, 16 seconds; a fifth crash within ten minutes stops.
pub fn backoff(crashes: &[Instant], now: Instant) -> Option<Duration> {
    let recent = crashes.iter().filter(|at| now.duration_since(**at) < Duration::from_secs(600)).count();
    if recent >= 5 {
        return None;
    }
    Some(Duration::from_secs((2u64 << recent.saturating_sub(1).min(5)).min(60)))
}

struct Running {
    pid: i32,
    _stdin: ChildStdin,
    started: Instant,
    /// Sync's descendants by pid and executable, refreshed while it runs, so a crash of Sync does
    /// not leave its tunnel helper running on its own.
    descendants: HashMap<i32, PathBuf>,
}

pub struct Engine {
    shared: Arc<Shared>,
    rx: Receiver<Cmd>,
    tx: Sender<Cmd>,
    paths: Paths,
    settings: Settings,
    gui: bool,
    child: Option<Running>,
    generation: u64,
    approval_url: Option<String>,
    connect_wanted: bool,
    announce_connected: bool,
    approved_this_run: bool,
    ever_reachable: bool,
    port_busy: bool,
    held: bool,
    took_over: bool,
    crashes: Vec<Instant>,
    restart_at: Option<Instant>,
    retry_at: Option<Instant>,
    next_update_check: Instant,
    next_agents: Instant,
    login_path: Option<String>,
    staged_update: Option<updater::Staged>,
    stop_notified: bool,
    last_wall: SystemTime,
    last_mono: Instant,
}

const POLL: Duration = Duration::from_secs(2);

impl Engine {
    pub fn new(paths: Paths, gui: bool) -> (Engine, Arc<Shared>) {
        let (tx, rx) = mpsc::channel();
        let settings = Settings::load(&paths);
        let can_start_at_login = gui && paths.is_default;
        let view = View {
            computer: procs::hostname(),
            version: config::version().into(),
            start_at_login: can_start_at_login && settings.start_at_login.unwrap_or(true),
            can_start_at_login,
            can_uninstall: gui && paths.is_default && desktop::installed_appimage().is_some(),
            log_path: paths.log().to_string_lossy().into_owned(),
            ..View::default()
        };
        let shared = Arc::new(Shared {
            view: Mutex::new((1, view)),
            changed: Condvar::new(),
            commands: Mutex::new(tx.clone()),
            shutting_down: AtomicBool::new(false),
            child_pid: AtomicI32::new(0),
            front: Mutex::new(None),
            paths: paths.clone(),
        });
        let engine = Engine {
            shared: shared.clone(),
            rx,
            tx,
            paths,
            settings,
            gui,
            child: None,
            generation: 0,
            approval_url: None,
            connect_wanted: false,
            announce_connected: false,
            approved_this_run: false,
            ever_reachable: false,
            port_busy: false,
            held: false,
            took_over: false,
            crashes: Vec::new(),
            restart_at: None,
            retry_at: None,
            next_update_check: Instant::now() + Duration::from_secs(15),
            next_agents: Instant::now(),
            login_path: None,
            staged_update: None,
            stop_notified: false,
            last_wall: SystemTime::now(),
            last_mono: Instant::now(),
        };
        (engine, shared)
    }

    fn shutting(&self) -> bool {
        self.shared.shutting_down.load(Ordering::SeqCst)
    }

    fn set(&self, phase: Phase, detail: Option<&str>) {
        let detail = detail.map(str::to_string);
        let mut changed_phase = false;
        self.shared.update(|v| {
            changed_phase = v.phase != phase || (phase == Phase::Stopped && v.detail != detail);
            v.phase = phase;
            v.detail = detail.clone();
            v.percent = None;
            if phase != Phase::Approving {
                v.approval_url = None;
                v.approval_opened = false;
            }
        });
        if changed_phase {
            log::app(format!("Now: {phase:?}{}", detail.map(|d| format!(" ({d})")).unwrap_or_default()));
        }
    }

    fn progress(&self, detail: &str, percent: Option<u8>) {
        let detail = detail.to_string();
        self.shared.update(|v| {
            if v.phase == Phase::SettingUp {
                v.detail = Some(detail);
                v.percent = percent;
            }
        });
    }

    fn notify(&self, title: &str, body: &str) {
        self.shared.front(FrontEvent::Notify(title.into(), body.into()));
    }

    fn busy(&self, busy: bool) {
        self.shared.update(|v| v.busy = busy);
    }

    pub fn run(mut self) {
        loop {
            let timeout = self.next_wait();
            match self.rx.recv_timeout(timeout) {
                Ok(cmd) => self.handle(cmd),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            if self.shutting() {
                break;
            }
            self.tick();
        }
    }

    fn next_wait(&self) -> Duration {
        let now = Instant::now();
        let mut wait = Duration::from_secs(30);
        if self.child.is_some() {
            wait = POLL;
        }
        for at in [self.restart_at, self.retry_at, Some(self.next_update_check)].into_iter().flatten() {
            wait = wait.min(at.saturating_duration_since(now));
        }
        wait.max(Duration::from_millis(50))
    }

    fn handle(&mut self, cmd: Cmd) {
        match cmd {
            Cmd::Start { interactive } => self.start(interactive),
            Cmd::Connect | Cmd::Retry => self.connect(),
            Cmd::OpenApproval => self.open_approval(),
            Cmd::Disconnect => self.disconnect(),
            Cmd::SetStartAtLogin(on) => {
                self.settings.start_at_login = Some(on);
                self.settings.save(&self.paths);
                self.shared.update(|v| v.start_at_login = v.can_start_at_login && on);
                self.apply_start_at_login();
            }
            Cmd::CheckForUpdates { manual } => self.check_for_updates(manual),
            Cmd::RestartToUpdate => self.restart_to_update(),
            Cmd::RefreshAgents => {
                self.login_path = None;
                self.next_agents = Instant::now();
            }
            Cmd::Uninstall => self.uninstall(),
            Cmd::Line(generation, line) => {
                if generation == self.generation {
                    self.received(&line)
                }
            }
            Cmd::Exit(generation, how) => {
                if generation == self.generation && self.child.is_some() {
                    self.sync_exited(&how)
                }
            }
        }
    }

    fn tick(&mut self) {
        let now = Instant::now();
        // A wall clock that ran ahead of the monotonic one means the computer slept.
        let wall = SystemTime::now();
        let slept = wall.duration_since(self.last_wall).unwrap_or_default().saturating_sub(now.duration_since(self.last_mono));
        self.last_wall = wall;
        self.last_mono = now;
        if slept > Duration::from_secs(60) {
            log::app(format!("Woke after about {} minutes", slept.as_secs() / 60));
            self.next_update_check = now + Duration::from_secs(30);
            if self.phase() == Phase::Stopped {
                self.retry_at = Some(now + Duration::from_secs(20));
            }
        }
        if self.restart_at.is_some_and(|at| at <= now) {
            self.restart_at = None;
            if self.child.is_none() && !self.shared.view().1.busy {
                self.start_sync();
            }
        }
        if self.retry_at.is_some_and(|at| at <= now) {
            self.retry_at = None;
            if self.phase() == Phase::Stopped {
                log::app("Trying again");
                self.crashes.clear();
                self.took_over = false;
                let wanted = self.connect_wanted;
                self.bring(wanted);
            }
        }
        if self.next_update_check <= now {
            self.next_update_check = now + Duration::from_secs(55 * 60);
            self.check_for_updates(false);
        }
        if self.child.is_some() {
            self.poll_status();
        }
        if self.next_agents <= Instant::now() {
            self.refresh_agents();
        }
    }

    fn phase(&self) -> Phase {
        self.shared.view().1.phase
    }

    // ---- What the windows and the tray ask for ----

    fn start(&mut self, interactive: bool) {
        self.connect_wanted = interactive;
        self.announce_connected = interactive;
        if let Some(orphan) = self.end_orphan() {
            log::app(format!("Ended a Tinkjam Sync left from an earlier run: {orphan}"));
        }
        if interactive && !self.first_run_done() {
            self.shared.front(FrontEvent::ShowSetup);
        }
        if self.settings.disconnected && self.first_run_done() {
            if self.ensure_ready().is_ok() {
                self.set(Phase::NotConnected, None);
            }
            return;
        }
        self.bring(interactive);
    }

    fn first_run_done(&self) -> bool {
        self.paths.server_entry().is_file() && self.settings.sync_version.is_some()
    }

    /// The person asked: connect if needed, in the open.
    fn connect(&mut self) {
        if self.shared.view().1.busy {
            return;
        }
        self.crashes.clear();
        self.took_over = false;
        self.stop_notified = false;
        self.connect_wanted = true;
        if self.settings.disconnected {
            self.settings.disconnected = false;
            self.settings.save(&self.paths);
        }
        if self.phase() == Phase::Approving && self.child.is_some() {
            self.open_approval();
            return;
        }
        self.bring(true);
    }

    fn open_approval(&mut self) {
        let Some(url) = self.approval_url.clone() else { return };
        if config::browser_disabled() {
            log::app(format!("Not opening the browser (TINKJAM_SYNC_NO_BROWSER): {url}"));
        } else if !procs::open_url(&url) {
            log::app("Could not open the browser with xdg-open");
        }
        self.shared.update(|v| v.approval_opened = true);
    }

    /// Runtime, package, login item, then Sync: whatever is missing, in order.
    fn bring(&mut self, open_browser: bool) {
        self.connect_wanted = open_browser || self.connect_wanted;
        self.stop_sync();
        self.busy(true);
        let ready = self.ensure_ready();
        self.busy(false);
        match ready {
            Ok(()) => self.start_sync(),
            Err(error) => self.give_up(error),
        }
    }

    fn ensure_ready(&mut self) -> Result<(), SetupError> {
        self.set(Phase::SettingUp, Some("Getting ready…"));
        self.ensure_runtime()?;
        self.ensure_package()?;
        self.apply_start_at_login();
        self.shared.update(|v| v.installed = true);
        self.refresh_agents();
        Ok(())
    }

    fn give_up(&mut self, error: SetupError) {
        log::app(format!("Stopped: {}", error.detail));
        self.stop(error.plain, error.offline);
    }

    /// Stopped, with when it tries again by itself. One notification until it next connects.
    fn stop(&mut self, message: &str, soon: bool) {
        self.set(Phase::Stopped, Some(message));
        self.retry_at = Some(Instant::now() + if soon { Duration::from_secs(60) } else { Duration::from_secs(15 * 60) });
        if !soon && !self.stop_notified {
            self.stop_notified = true;
            self.notify("Tinkjam Sync needs your attention", message);
        }
    }

    fn disconnect(&mut self) {
        if self.shared.view().1.busy || !self.paths.server_entry().is_file() {
            return;
        }
        self.busy(true);
        let was_running = self.child.is_some();
        let (phase, detail) = {
            let v = self.shared.view().1;
            (v.phase, v.detail)
        };
        self.stop_sync();
        self.set(Phase::Disconnecting, None);
        let entry = self.paths.server_entry().to_string_lossy().into_owned();
        let base = self.paths.base.to_string_lossy().into_owned();
        let result = self.run_node(&[&entry, "sync", "--disconnect", "--base-dir", &base], None, Duration::from_secs(120), false);
        self.busy(false);
        match result {
            Ok((0, output)) => {
                self.settings.disconnected = true;
                self.settings.save(&self.paths);
                self.connect_wanted = false;
                let still_listed = output.contains("Could not remove this computer");
                self.set(Phase::NotConnected, still_listed.then_some(words::STILL_LISTED));
                self.notify("Disconnected", "This computer is no longer connected to your Tinkjam account.");
            }
            other => {
                log::app(format!("Disconnecting failed: {:?}", other.map(|(code, _)| code)));
                self.notify("Couldn't disconnect", words::COULD_NOT_DISCONNECT);
                if was_running {
                    self.start_sync();
                } else {
                    self.set(phase, detail.as_deref());
                }
            }
        }
    }

    fn apply_start_at_login(&self) {
        if !self.gui || !self.paths.is_default {
            return;
        }
        let on = self.settings.start_at_login.unwrap_or(true);
        if let Err(error) = desktop::set_autostart(on) {
            log::app(format!("Could not change Start when I log in: {error}"));
        }
    }

    fn refresh_agents(&mut self) {
        self.next_agents = Instant::now() + Duration::from_secs(5);
        if self.login_path.is_none() {
            self.login_path = Some(procs::login_path());
        }
        let mut found = agents::installed(self.login_path.as_deref().unwrap_or_default());
        agents::mark_working(&mut found, self.child.as_ref().map(|c| c.pid));
        if let Some(running) = self.child.as_mut() {
            let mut seen = HashMap::new();
            for pid in procs::descendants(running.pid) {
                if let Some(exe) = procs::exe(pid) {
                    seen.insert(pid, exe);
                }
            }
            running.descendants = seen;
        }
        self.shared.update(|v| v.agents = found);
    }

    fn agents_working(&self) -> bool {
        // Anything under Sync besides its tunnel helper is an agent session at work.
        self.child.as_ref().is_some_and(|c| {
            procs::descendants(c.pid).into_iter().any(|pid| !procs::names(pid).iter().any(|n| n == "cloudflared"))
        })
    }

    // ---- Node.js ----

    fn ensure_runtime(&mut self) -> Result<(), SetupError> {
        let arch = config::node_arch();
        let marker = format!("{}-linux-{arch}", config::NODE_VERSION);
        let marker_file = self.paths.runtime().join("installed");
        if self.paths.node().is_file() && std::fs::read_to_string(&marker_file).ok().as_deref() == Some(marker.as_str()) {
            return Ok(());
        }
        let name = format!("node-{}-linux-{arch}", config::NODE_VERSION);
        let url = format!("{}/{}/{name}.tar.xz", config::node_dist_url(), config::NODE_VERSION);
        let downloads = self.paths.runtime().join("downloads");
        let tarball = downloads.join(format!("{name}.tar.xz"));
        let unpack = self.paths.runtime().join(".unpack");
        let result = (|| {
            log::app(format!("Downloading Node.js {} ({arch}) from {url}", config::NODE_VERSION));
            let say = "Downloading what Tinkjam Sync needs…";
            self.progress(say, Some(0));
            net::download(&url, &tarball, "downloading Node.js", &self.shared.shutting_down, |p| self.progress(say, Some(p)))?;
            self.progress("Checking the download…", None);
            let expected = config::node_sha256(arch).ok_or_else(|| fail(words::SETUP_FAILED, format!("no Node.js for {arch}")))?;
            if !net::sha_matches(&tarball, expected) {
                return Err(fail(words::DAMAGED, "Node.js checksum mismatch"));
            }
            self.progress("Unpacking…", None);
            let _ = std::fs::remove_dir_all(&unpack);
            std::fs::create_dir_all(&unpack).map_err(|e| io_fail(e, "making the unpack folder"))?;
            let plain_tar = downloads.join(format!("{name}.tar"));
            {
                let mut input = BufReader::new(std::fs::File::open(&tarball).map_err(|e| io_fail(e, "opening Node.js"))?);
                let mut output = std::io::BufWriter::new(std::fs::File::create(&plain_tar).map_err(|e| io_fail(e, "unpacking Node.js"))?);
                lzma_rs::xz_decompress(&mut input, &mut output).map_err(|e| fail(words::DAMAGED, format!("Node.js would not unpack: {e:?}")))?;
            }
            let _ = std::fs::remove_file(&tarball);
            let mut archive = tar::Archive::new(std::fs::File::open(&plain_tar).map_err(|e| io_fail(e, "opening Node.js"))?);
            archive.set_preserve_permissions(true);
            archive.unpack(&unpack).map_err(|e| io_fail(e, "unpacking Node.js"))?;
            let _ = std::fs::remove_dir_all(self.paths.node_home());
            std::fs::rename(unpack.join(&name), self.paths.node_home()).map_err(|e| io_fail(e, "putting Node.js in place"))?;
            let version = procs::run_with_timeout(Command::new(self.paths.node()).arg("--version"), Duration::from_secs(30));
            if version.as_deref().map(str::trim) != Some(config::NODE_VERSION) {
                return Err(fail(words::SETUP_FAILED, format!("Node.js was unpacked but does not run ({version:?})")));
            }
            // Older runtimes this app kept go once the new one works.
            if let Ok(entries) = std::fs::read_dir(self.paths.runtime()) {
                for entry in entries.flatten() {
                    let file = entry.file_name().to_string_lossy().into_owned();
                    if file.starts_with("node-") && file != name {
                        let _ = std::fs::remove_dir_all(entry.path());
                    }
                }
            }
            std::fs::write(&marker_file, &marker).map_err(|e| io_fail(e, "marking Node.js installed"))?;
            log::app(format!("Node.js {} is ready at {}", config::NODE_VERSION, self.paths.node_home().display()));
            Ok(())
        })();
        let _ = std::fs::remove_dir_all(&downloads);
        let _ = std::fs::remove_dir_all(&unpack);
        result
    }

    // ---- The Sync package ----

    fn ensure_package(&mut self) -> Result<(), SetupError> {
        if self.first_run_done() {
            if desktop::legacy_present(&self.paths) {
                self.take_over_existing()?;
            }
            return Ok(());
        }
        // First run: a fresh copy, which also clears out whatever an earlier `npx … --install` set up.
        self.progress("Downloading Tinkjam Sync…", None);
        let manifest = net::get_json(&config::sync_manifest_urls(), "checking for Tinkjam Sync")?;
        let version = self.stage_package(&manifest, false)?;
        self.take_over_with(&config::Paths::launcher_in(&self.paths.staging()))?;
        self.progress("Finishing…", None);
        self.swap()?;
        self.settings.sync_version = Some(version.clone());
        self.settings.save(&self.paths);
        log::app(format!("Tinkjam Sync {version} installed in {}", self.paths.app().display()));
        Ok(())
    }

    /// Downloads and checks the package sync.json names, unpacks it into the staging folder and
    /// installs exactly its npm-shrinkwrap.json there. The running one is untouched.
    fn stage_package(&mut self, manifest: &Map<String, Value>, quiet: bool) -> Result<String, SetupError> {
        let text = |k: &str| manifest.get(k).and_then(Value::as_str).map(str::to_string);
        let version = text("version").unwrap_or_default();
        let url = text("url").unwrap_or_else(config::sync_package_url);
        let sha = text("sha256").unwrap_or_default().to_ascii_lowercase();
        if !net::allowed_url(&url) || !net::looks_like_sha(&sha) {
            return Err(fail(words::SERVER_TROUBLE, format!("sync.json names no usable download (url {url}, sha256 {sha})")));
        }
        if !signature::verify("sync", manifest) {
            return Err(fail(words::SERVER_TROUBLE, format!("sync.json for {version} is not signed with Tinkjam's release key; not installed")));
        }
        let staging = self.paths.staging();
        let _ = std::fs::remove_dir_all(&staging);
        std::fs::create_dir_all(&staging).map_err(|e| io_fail(e, "making the staging folder"))?;
        let downloads = self.paths.runtime().join("downloads");
        let tarball = downloads.join("sync.tgz");
        let npm_cache = self.paths.runtime().join("npm-cache");
        let result = (|| {
            // A pinned version in the URL, so no cache serves an older one.
            let pinned = format!("{url}{}v={}", if url.contains('?') { '&' } else { '?' }, net::query_escape(&version));
            log::app(format!("Downloading Tinkjam Sync {version}"));
            let say = "Downloading Tinkjam Sync…";
            net::download(&pinned, &tarball, "downloading Tinkjam Sync", &self.shared.shutting_down, |p| {
                if !quiet {
                    self.progress(say, Some(p))
                }
            })?;
            if !net::sha_matches(&tarball, &sha) {
                return Err(fail(words::DAMAGED, "Tinkjam Sync checksum mismatch"));
            }
            if !quiet {
                self.progress("Installing Tinkjam Sync…", None);
            }
            let package = Paths::package_in(&staging);
            unpack_package(&tarball, &package).map_err(|problem| fail(words::SETUP_FAILED, problem))?;
            let npm = self.paths.npm_cli().to_string_lossy().into_owned();
            let cache = npm_cache.to_string_lossy().into_owned();
            let ci = signature::npm_commands::ci(&npm, &cache);
            let mut install = self.run_node(&ci.iter().map(String::as_str).collect::<Vec<_>>(), Some(&package), Duration::from_secs(900), true)?;
            if install.0 == 0 {
                let rebuild = signature::npm_commands::rebuild(&npm, &cache);
                install = self.run_node(&rebuild.iter().map(String::as_str).collect::<Vec<_>>(), Some(&package), Duration::from_secs(300), true)?;
            }
            if !install.1.trim().is_empty() {
                log::app(format!("npm: {}", tail_lines(&install.1, 20)));
            }
            if install.0 != 0 || !Paths::server_entry_in(&staging).is_file() {
                let out = &install.1;
                let detail = format!("npm ended with exit code {}", install.0);
                if out.contains("ENOSPC") {
                    return Err(fail(words::DISK_FULL, detail));
                }
                if ["ENOTFOUND", "EAI_AGAIN", "ENETUNREACH", "ETIMEDOUT", "ECONNREFUSED"].iter().any(|s| out.contains(s)) {
                    return Err(SetupError { plain: words::OFFLINE, detail, offline: true });
                }
                if ["SELF_SIGNED_CERT", "UNABLE_TO_GET_ISSUER_CERT", "E403", "E407", "ECONNRESET"].iter().any(|s| out.contains(s)) {
                    return Err(SetupError { plain: words::RESTRICTED, detail, offline: true });
                }
                return Err(fail(words::SETUP_FAILED, detail));
            }
            Ok(installed_version(&staging).unwrap_or(version.clone()))
        })();
        let _ = std::fs::remove_dir_all(&downloads);
        // npm's cache would double what Sync takes on disk for nothing after the install.
        let _ = std::fs::remove_dir_all(&npm_cache);
        if result.is_err() {
            let _ = std::fs::remove_dir_all(&staging);
        }
        result
    }

    /// The package's own `--uninstall` ends any other Sync of this home and removes the login
    /// items earlier installs made (never this app's, which it names differently). It also
    /// deletes `<home>/app`, so it runs from a staged copy that then takes its place.
    fn take_over_with(&mut self, launcher: &Path) -> Result<(), SetupError> {
        log::app("Removing older Tinkjam Sync setups (the package's --uninstall)");
        let launcher = launcher.to_string_lossy().into_owned();
        let base = self.paths.base.to_string_lossy().into_owned();
        let (code, output) = self.run_node(&[&launcher, "--uninstall", "--base-dir", &base], None, Duration::from_secs(180), false)?;
        if code != 0 {
            log::app(format!("--uninstall ended with exit code {code}: {}", tail_lines(&output, 5)));
        }
        if desktop::legacy_present(&self.paths) {
            return Err(fail(
                "Could not replace the older Tinkjam Sync on this computer. Restart your computer, then open Tinkjam Sync again.",
                "the older login item is still there after --uninstall",
            ));
        }
        self.apply_start_at_login();
        Ok(())
    }

    fn take_over_existing(&mut self) -> Result<(), SetupError> {
        self.progress("Replacing the older Tinkjam Sync…", None);
        self.stop_sync();
        let staging = self.paths.staging();
        let _ = std::fs::remove_dir_all(&staging);
        copy_dir(&self.paths.app(), &staging).map_err(|e| io_fail(e, "copying the installed package"))?;
        self.take_over_with(&Paths::launcher_in(&staging))?;
        self.swap()
    }

    /// The staged package takes the installed one's place; if it can't, the installed one goes back.
    fn swap(&self) -> Result<(), SetupError> {
        let previous = self.paths.base.join("app-previous");
        let _ = std::fs::remove_dir_all(&previous);
        let had = self.paths.app().exists();
        if had {
            std::fs::rename(self.paths.app(), &previous).map_err(|e| io_fail(e, "setting the old package aside"))?;
        }
        if let Err(error) = std::fs::rename(self.paths.staging(), self.paths.app()) {
            if had {
                let _ = std::fs::rename(&previous, self.paths.app());
            }
            return Err(io_fail(error, "putting the new package in place"));
        }
        let _ = std::fs::remove_dir_all(&previous);
        Ok(())
    }

    // ---- Running Sync ----

    fn sync_env(&self, node_first: bool) -> Vec<(String, String)> {
        let node_bin = self.paths.node_home().join("bin").to_string_lossy().into_owned();
        let path = self.login_path.clone().unwrap_or_else(procs::login_path);
        let path = if node_first { format!("{node_bin}:{path}") } else { format!("{path}:{node_bin}") };
        let mut env = vec![
            ("PATH".into(), path),
            ("T3CODE_HOME".into(), self.paths.base.to_string_lossy().into_owned()),
            ("T3CODE_HOSTED_APP_URL".into(), config::hosted_app_url()),
            ("TINKJAM_SYNC_URL".into(), config::sync_package_url()),
            ("TINKJAM_SYNC_APP".into(), config::version().into()),
            ("TINKJAM_SYNC_FROM_APP".into(), "1".into()),
            ("npm_config_update_notifier".into(), "false".into()),
            ("npm_config_fund".into(), "false".into()),
            ("npm_config_audit".into(), "false".into()),
            ("NO_COLOR".into(), "1".into()),
        ];
        // Node trusts only its own certificate list unless told; on a work network the system's
        // certificates are the ones that work. Not when NODE_OPTIONS already picks a store.
        let options = std::env::var("NODE_OPTIONS").unwrap_or_default();
        if !["--use-openssl-ca", "--use-bundled-ca", "--use-system-ca"].iter().any(|f| options.contains(f)) {
            env.push(("NODE_USE_SYSTEM_CA".into(), "1".into()));
        }
        env
    }

    fn node_command(&self, args: &[&str], cwd: Option<&Path>, node_first: bool) -> Command {
        let mut command = Command::new(self.paths.node());
        command.args(args);
        command.current_dir(cwd.unwrap_or(&self.paths.base));
        // An AppImage's own variables mean nothing to Sync or the agents it starts.
        for name in ["APPIMAGE", "APPDIR", "ARGV0", "OWD"] {
            command.env_remove(name);
        }
        for (key, value) in self.sync_env(node_first) {
            command.env(key, value);
        }
        command
    }

    /// Runs one Node command to its end: its exit code and output (both streams, logged).
    fn run_node(&self, args: &[&str], cwd: Option<&Path>, timeout: Duration, node_first: bool) -> Result<(i32, String), SetupError> {
        let _ = std::fs::create_dir_all(&self.paths.base);
        let mut child = self
            .node_command(args, cwd, node_first)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| io_fail(e, "starting Node.js"))?;
        let output = Arc::new(Mutex::new(String::new()));
        let readers: Vec<_> = [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
            .map(|stream| {
                let output = output.clone();
                std::thread::spawn(move || {
                    for line in BufReader::new(stream).lines().map_while(Result::ok) {
                        log::sync(&line);
                        let mut out = output.lock().unwrap();
                        if out.len() < 200_000 {
                            out.push_str(&line);
                            out.push('\n');
                        }
                    }
                })
            })
            .collect();
        let start = Instant::now();
        let code = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status.code().unwrap_or(-1),
                Ok(None) if start.elapsed() < timeout && !self.shutting() => std::thread::sleep(Duration::from_millis(100)),
                _ => {
                    log::app(format!("Stopping {} (timed out or quitting)", args.get(1).unwrap_or(&"node")));
                    stop_tree(child.id() as i32, Duration::from_secs(5));
                    let _ = child.wait();
                    break -1;
                }
            }
        };
        for reader in readers {
            let _ = reader.join();
        }
        let text = output.lock().unwrap().clone();
        Ok((code, text))
    }

    fn start_sync(&mut self) {
        if self.shutting() || self.child.is_some() {
            return;
        }
        if !self.paths.server_entry().is_file() || !self.paths.node().is_file() {
            let wanted = self.connect_wanted;
            return self.bring(wanted);
        }
        self.restart_at = None;
        self.port_busy = false;
        self.held = false;
        self.ever_reachable = false;
        self.approval_url = None;
        let entry = self.paths.server_entry().to_string_lossy().into_owned();
        let base = self.paths.base.to_string_lossy().into_owned();
        let mut command = self.node_command(&[&entry, "sync", "--base-dir", &base, "--app"], None, false);
        command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
        let mut child: Child = match command.spawn() {
            Ok(child) => child,
            Err(error) => {
                log::app(format!("Tinkjam Sync could not start: {error}"));
                return self.stop(words::COULD_NOT_START, false);
            }
        };
        self.generation += 1;
        let generation = self.generation;
        let pid = child.id() as i32;
        // Sync's stdin is a pipe this app holds; with `--app`, Sync exits when it closes, so even
        // a crash of the app leaves no Sync behind.
        let stdin = child.stdin.take().expect("piped stdin");
        for stream in [child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>)]
            .into_iter()
            .flatten()
        {
            let tx = self.tx.clone();
            std::thread::spawn(move || {
                for line in BufReader::new(stream).lines().map_while(Result::ok) {
                    log::sync(&line);
                    if tx.send(Cmd::Line(generation, line)).is_err() {
                        break;
                    }
                }
            });
        }
        let tx = self.tx.clone();
        std::thread::spawn(move || {
            let how = match child.wait() {
                Ok(status) => match (status.code(), std::os::unix::process::ExitStatusExt::signal(&status)) {
                    (Some(code), _) => format!("exit code {code}"),
                    (None, Some(signal)) => format!("signal {signal}"),
                    _ => "unknown".into(),
                },
                Err(error) => error.to_string(),
            };
            let _ = tx.send(Cmd::Exit(generation, how));
        });
        let _ = std::fs::write(self.paths.child_record(), serde_json::json!({ "pid": pid }).to_string());
        self.shared.child_pid.store(pid, Ordering::SeqCst);
        log::app(format!("Started Tinkjam Sync {} (pid {pid}, --app)", self.settings.sync_version.as_deref().unwrap_or("?")));
        self.child = Some(Running { pid, _stdin: stdin, started: Instant::now(), descendants: HashMap::new() });
        self.set(Phase::Connecting, None);
        self.next_agents = Instant::now() + Duration::from_secs(3);
    }

    fn stop_sync(&mut self) {
        self.restart_at = None;
        let Some(running) = self.child.take() else { return };
        self.generation += 1;
        self.shared.child_pid.store(0, Ordering::SeqCst);
        log::app(format!("Stopping Tinkjam Sync (pid {})", running.pid));
        stop_tree(running.pid, Duration::from_secs(10));
        drop(running);
        let _ = std::fs::remove_file(self.paths.child_record());
    }

    /// `<home>/sync-app-child.json`: if the app was killed and its Sync lived on, the next start
    /// ends that Sync, and only when it is still this app's Node running this home.
    fn end_orphan(&self) -> Option<String> {
        let record = self.paths.child_record();
        let pid = std::fs::read_to_string(&record).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok())?.get("pid")?.as_i64()? as i32;
        let _ = std::fs::remove_file(&record);
        let ours = procs::alive(pid)
            && procs::exe(pid).is_some_and(|exe| exe == self.paths.node() || std::fs::canonicalize(self.paths.node()).ok() == Some(exe))
            && procs::cmdline(pid).iter().any(|arg| arg == &self.paths.base.to_string_lossy());
        if !ours {
            return None;
        }
        let count = procs::descendants(pid).len();
        stop_tree(pid, Duration::from_secs(10));
        Some(format!("pid {pid} and {count} process(es) it started"))
    }

    fn received(&mut self, line: &str) {
        match SyncLine::classify(line) {
            SyncLine::ApprovalUrl(url) => {
                // Sync prints the link twice: for people, then for the app.
                if self.phase() == Phase::Approving && self.approval_url.as_deref() == Some(url.as_str()) {
                    return;
                }
                self.approval_url = Some(url);
                self.set(Phase::Approving, None);
                let link = self.approval_url.clone();
                self.shared.update(|v| v.approval_url = link);
                if self.connect_wanted {
                    self.open_approval();
                    self.notify("Approve in your browser", "Sign in to Tinkjam and press Connect.");
                } else {
                    self.notify("Tinkjam Sync isn't connected", "Open Tinkjam Sync and choose Connect.");
                }
            }
            SyncLine::ComputerName(name) => self.shared.update(|v| v.computer = name),
            SyncLine::Approved => {
                self.approved_this_run = true;
                self.set(Phase::Connecting, None);
            }
            SyncLine::Connected => {}
            SyncLine::PortBusy => self.port_busy = true,
            SyncLine::Held => self.held = true,
            SyncLine::Other => {}
        }
    }

    fn poll_status(&mut self) {
        let Some(running) = self.child.as_ref() else { return };
        let phase = self.phase();
        if !matches!(phase, Phase::Connecting | Phase::Connected | Phase::Reconnecting) {
            return;
        }
        let now = SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
        let slow = running.started.elapsed() > Duration::from_secs(90);
        match health(&self.paths, running.pid, now) {
            Health::Reachable => {
                if phase == Phase::Connected {
                    return;
                }
                let first = !self.ever_reachable;
                self.ever_reachable = true;
                self.stop_notified = false;
                self.set(Phase::Connected, None);
                if first && (self.approved_this_run || self.announce_connected) {
                    self.notify("Connected", "Your agents on this computer are now available on your Tinkjam boards.");
                }
                self.approved_this_run = false;
                self.announce_connected = false;
                self.connect_wanted = false;
            }
            // A file caught mid-write reads as nothing; only a real answer changes what is shown.
            Health::Unknown => {
                if !self.ever_reachable && slow {
                    self.set(Phase::Connecting, Some("This is taking longer than usual. Tinkjam Sync keeps trying."));
                }
            }
            Health::Stale => {
                if self.ever_reachable {
                    self.set(Phase::Reconnecting, Some("Still connecting. Tinkjam Sync keeps trying by itself."));
                }
            }
            Health::Unreachable(cause) => {
                let said = words::connecting(cause.as_deref());
                if self.ever_reachable {
                    self.set(Phase::Reconnecting, said.or(Some("Still connecting. Tinkjam Sync keeps trying by itself.")));
                } else if slow || said.is_some() {
                    self.set(Phase::Connecting, said.or(Some("This is taking longer than usual. Tinkjam Sync keeps trying.")));
                }
            }
        }
    }

    fn sync_exited(&mut self, how: &str) {
        let Some(running) = self.child.take() else { return };
        self.shared.child_pid.store(0, Ordering::SeqCst);
        let _ = std::fs::remove_file(self.paths.child_record());
        log::app(format!("Tinkjam Sync exited ({how})"));
        // Whatever Sync started that outlived it, if it is still the same program.
        for (pid, exe) in &running.descendants {
            if procs::alive(*pid) && procs::exe(*pid).as_ref() == Some(exe) {
                procs::kill(*pid, libc::SIGTERM);
            }
        }
        if self.shutting() {
            return;
        }
        if self.port_busy && !procs::port_free(config::APPROVAL_PORT) {
            log::app(format!("Port {} is in use by another program, so this computer can't be approved", config::APPROVAL_PORT));
            return self.stop(words::PORT_BUSY, false);
        }
        if self.phase() == Phase::Approving {
            self.connect_wanted = false;
            return self.set(Phase::NotConnected, Some(words::APPROVAL_UNFINISHED));
        }
        if self.held {
            if !self.took_over {
                self.took_over = true;
                self.busy(true);
                let result = self.take_over_existing();
                self.busy(false);
                return match result {
                    Ok(()) => self.start_sync(),
                    Err(error) => self.give_up(error),
                };
            }
            return self.stop(words::ANOTHER_COPY, false);
        }
        let now = Instant::now();
        self.crashes.push(now);
        match backoff(&self.crashes, now) {
            None => {
                self.crashes.clear();
                log::app("Tinkjam Sync stopped 5 times in 10 minutes");
                self.stop(words::KEEPS_STOPPING, false);
            }
            Some(wait) => {
                log::app(format!("Restarting in {} seconds", wait.as_secs()));
                self.set(Phase::Connecting, Some("Starting again…"));
                self.restart_at = Some(now + wait);
            }
        }
    }

    // ---- Updates ----

    fn check_for_updates(&mut self, manual: bool) {
        if self.shutting() {
            return;
        }
        if manual {
            self.shared.update(|v| v.update = UpdateState::Checking);
        }
        let outcome = updater::check(&self.paths, &self.shared.shutting_down);
        match outcome {
            Ok(updater::Outcome::UpToDate) => {
                self.staged_update = None;
                self.shared.update(|v| {
                    v.update = UpdateState::UpToDate;
                    v.update_version = None;
                });
            }
            Ok(updater::Outcome::Manual(version)) => self.shared.update(|v| {
                v.update = UpdateState::Manual;
                v.update_version = Some(version);
            }),
            Ok(updater::Outcome::Staged(staged)) => {
                let version = staged.version.clone();
                self.staged_update = Some(staged);
                self.shared.update(|v| {
                    v.update = UpdateState::Ready;
                    v.update_version = Some(version.clone());
                });
                // One try by itself per version, and only while nothing is in the way.
                let view = self.shared.view().1;
                let quiet = !view.busy && matches!(view.phase, Phase::Connected | Phase::Reconnecting | Phase::NotConnected | Phase::Stopped);
                if self.settings.update_attempted.as_deref() != Some(version.as_str()) && quiet && !self.agents_working() {
                    self.settings.update_attempted = Some(version);
                    self.settings.save(&self.paths);
                    self.restart_to_update();
                    return;
                }
            }
            Err(error) => {
                log::app(format!("App update check: {}", error.detail));
                if manual {
                    self.shared.update(|v| v.update = UpdateState::Failed);
                }
            }
        }
        self.refresh_package();
    }

    fn restart_to_update(&mut self) {
        let Some(staged) = self.staged_update.clone() else { return };
        log::app(format!("Restarting to install Tinkjam Sync for Linux {}", staged.version));
        let was_running = self.child.is_some();
        self.stop_sync();
        match updater::apply(&staged) {
            Ok(never) => match never {},
            Err(error) => {
                log::app(format!("Could not install the new version: {error}"));
                self.staged_update = None;
                self.shared.update(|v| v.update = UpdateState::Failed);
                if was_running {
                    self.start_sync();
                }
            }
        }
    }

    /// A newer Sync package replaces the installed one, with Sync stopped only for the swap and
    /// never while an agent works. A failure leaves what was running as it was.
    fn refresh_package(&mut self) {
        let view = self.shared.view().1;
        if view.busy || !self.first_run_done() || matches!(view.phase, Phase::SettingUp | Phase::Approving | Phase::Disconnecting) {
            return;
        }
        let Ok(manifest) = net::get_json(&config::sync_manifest_urls(), "checking for a newer Tinkjam Sync") else { return };
        let latest = manifest.get("version").and_then(Value::as_str).map(str::to_string);
        if !is_newer(self.settings.sync_version.as_deref(), latest.as_deref()) {
            return;
        }
        if self.agents_working() {
            log::app(format!("Tinkjam Sync {} installs once no agent is running", latest.unwrap_or_default()));
            return;
        }
        log::app(format!("Updating Tinkjam Sync from {} to {}", self.settings.sync_version.as_deref().unwrap_or("?"), latest.unwrap_or_default()));
        self.busy(true);
        let staged = self.stage_package(&manifest, true);
        let result = staged.and_then(|version| {
            if self.agents_working() {
                return Err(fail(words::SETUP_FAILED, "an agent started meanwhile; the newer Tinkjam Sync waits for the next check"));
            }
            let was_running = self.child.is_some();
            self.stop_sync();
            let swapped = self.swap();
            if swapped.is_ok() {
                self.settings.sync_version = Some(version.clone());
                self.settings.save(&self.paths);
                log::app(format!("Tinkjam Sync {version} installed in {}", self.paths.app().display()));
            }
            if was_running {
                self.start_sync();
            }
            swapped
        });
        self.busy(false);
        if let Err(error) = result {
            log::app(format!("Tinkjam Sync update did not finish; the installed one keeps running: {}", error.detail));
            let _ = std::fs::remove_dir_all(self.paths.staging());
        }
    }

    fn uninstall(&mut self) {
        if !self.shared.view().1.can_uninstall {
            return;
        }
        self.stop_sync();
        log::app("Removing Tinkjam Sync for Linux (the AppImage, its menu entry and its login item)");
        desktop::uninstall_appimage();
        self.shared.shutting_down.store(true, Ordering::SeqCst);
        std::process::exit(0);
    }
}

/// The version baked into the installed launcher, e.g. `0.1.7+202611171847`.
pub fn installed_version(root: &Path) -> Option<String> {
    let text = std::fs::read_to_string(Paths::launcher_in(root)).ok()?;
    let start = text.find("const SYNC_VERSION = \"")? + "const SYNC_VERSION = \"".len();
    let end = text[start..].find('"')?;
    Some(text[start..start + end].to_string()).filter(|v| !v.is_empty() && !v.starts_with("__"))
}

/// Unpacks npm's `package/` folder as `target`, only when every entry is a plain file or folder
/// with a safe name inside it. Returns what went wrong.
pub fn unpack_package(tarball: &Path, target: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let open = || std::fs::File::open(tarball).map(|f| tar::Archive::new(flate2::read::GzDecoder::new(f)));
    // First a listing, so nothing is written from an archive that holds anything else.
    let mut listing = open().map_err(|e| format!("could not open sync.tgz: {e}"))?;
    let mut count = 0;
    for entry in listing.entries().map_err(|e| format!("could not read sync.tgz: {e}"))? {
        let entry = entry.map_err(|e| format!("could not read sync.tgz: {e}"))?;
        let name = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
        let kind = entry.header().entry_type();
        if !signature::package_archive::safe_name(&name) || !(kind.is_file() || kind.is_dir()) {
            return Err(format!("sync.tgz holds something besides the package's own files and folders ({name})"));
        }
        count += 1;
    }
    if count == 0 {
        return Err("sync.tgz is empty".into());
    }
    std::fs::create_dir_all(target).map_err(|e| format!("could not make {}: {e}", target.display()))?;
    let mut archive = open().map_err(|e| format!("could not open sync.tgz: {e}"))?;
    for entry in archive.entries().map_err(|e| format!("could not read sync.tgz: {e}"))? {
        let mut entry = entry.map_err(|e| format!("could not read sync.tgz: {e}"))?;
        let name = String::from_utf8_lossy(&entry.path_bytes()).into_owned();
        let relative = name.trim_start_matches("package/").trim_end_matches('/');
        if relative.is_empty() {
            continue;
        }
        let destination = target.join(relative);
        if entry.header().entry_type().is_dir() {
            std::fs::create_dir_all(&destination).map_err(|e| format!("could not make {}: {e}", destination.display()))?;
            continue;
        }
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("could not make {}: {e}", parent.display()))?;
        }
        let mode = entry.header().mode().unwrap_or(0o644) & 0o755 | 0o600;
        let mut file = std::fs::File::create(&destination).map_err(|e| format!("could not write {}: {e}", destination.display()))?;
        std::io::copy(&mut entry, &mut file).map_err(|e| format!("could not write {}: {e}", destination.display()))?;
        let _ = std::fs::set_permissions(&destination, std::fs::Permissions::from_mode(mode));
    }
    Ok(())
}

fn copy_dir(from: &Path, to: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let kind = entry.file_type()?;
        let destination = to.join(entry.file_name());
        if kind.is_dir() {
            copy_dir(&entry.path(), &destination)?;
        } else if kind.is_symlink() {
            std::os::unix::fs::symlink(std::fs::read_link(entry.path())?, &destination)?;
        } else {
            std::fs::copy(entry.path(), &destination)?;
        }
    }
    Ok(())
}

fn tail_lines(text: &str, count: usize) -> String {
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(count)..].join(" | ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_sync_output() {
        assert_eq!(
            SyncLine::classify("TINKJAM_SYNC_APPROVE_URL http://127.0.0.1:34338/approve?x=1"),
            SyncLine::ApprovalUrl("http://127.0.0.1:34338/approve?x=1".into())
        );
        assert_eq!(SyncLine::classify("  http://127.0.0.1:34338"), SyncLine::ApprovalUrl("http://127.0.0.1:34338".into()));
        // Only Sync's own page on this computer.
        assert_eq!(SyncLine::classify("TINKJAM_SYNC_APPROVE_URL https://evil.example/"), SyncLine::Other);
        assert_eq!(SyncLine::classify("TINKJAM_SYNC_APPROVE_URL http://127.0.0.1:34338@evil.example/"), SyncLine::Other);
        assert_eq!(SyncLine::classify("TINKJAM_SYNC_APPROVE_URL http://127.0.0.1.evil.example/"), SyncLine::Other);
        assert_eq!(
            SyncLine::classify("To connect pykew-laptop to Tinkjam, open this link. It says what connecting does"),
            SyncLine::ComputerName("pykew-laptop".into())
        );
        assert_eq!(SyncLine::classify("Approved."), SyncLine::Approved);
        assert_eq!(SyncLine::classify("Error: listen EADDRINUSE: address already in use 127.0.0.1:34338"), SyncLine::PortBusy);
        assert_eq!(SyncLine::classify("Tinkjam Sync is already running in the background (pid 4)."), SyncLine::Held);
        assert_eq!(SyncLine::classify("Tinkjam Sync"), SyncLine::Other);
    }

    #[test]
    fn versions_compare_like_the_package() {
        assert!(is_newer(Some("0.1.7+202611171847"), Some("0.1.7+202611200033")));
        assert!(!is_newer(Some("0.1.7+202611200033"), Some("0.1.7+202611200033")));
        assert!(is_newer(Some("0.1.7+202611200033"), Some("0.1.8")));
        assert!(!is_newer(Some("0.2.0"), Some("0.1.9+209912312359")));
        assert!(is_newer(None, Some("0.1.0")));
        assert!(!is_newer(Some("0.1.0"), Some("garbage")));
        assert!(is_newer(Some("garbage"), Some("0.1.0")));
    }

    #[test]
    fn backoff_doubles_then_stops() {
        let now = Instant::now();
        let mut crashes = vec![now];
        assert_eq!(backoff(&crashes, now), Some(Duration::from_secs(2)));
        crashes.push(now);
        assert_eq!(backoff(&crashes, now), Some(Duration::from_secs(4)));
        crashes.extend([now, now]);
        assert_eq!(backoff(&crashes, now), Some(Duration::from_secs(16)));
        crashes.push(now);
        assert_eq!(backoff(&crashes, now), None);
    }

    fn tgz(entries: &[(&str, tar::EntryType, &[u8])]) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("tinkjam-test-{}-{}", std::process::id(), entries.len() * 7 + entries[0].0.len()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("sync.tgz");
        let file = std::fs::File::create(&path).unwrap();
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(file, flate2::Compression::fast()));
        for (name, kind, data) in entries {
            let mut header = tar::Header::new_gnu();
            header.set_entry_type(*kind);
            header.set_size(data.len() as u64);
            header.set_mode(0o644);
            if *kind == tar::EntryType::Symlink {
                header.set_link_name("/etc/passwd").unwrap();
            }
            // Write the name raw so a test can hold a name tar's own checks would refuse.
            let bytes = name.as_bytes();
            header.as_old_mut().name[..bytes.len()].copy_from_slice(bytes);
            header.set_cksum();
            builder.append(&header, *data).unwrap();
        }
        builder.into_inner().unwrap().finish().unwrap();
        path
    }

    #[test]
    fn unpacks_only_plain_package_files() {
        let good = tgz(&[("package/", tar::EntryType::Directory, b""), ("package/dist/bin.mjs", tar::EntryType::Regular, b"ok")]);
        let target = good.parent().unwrap().join("out");
        unpack_package(&good, &target).unwrap();
        assert_eq!(std::fs::read_to_string(target.join("dist/bin.mjs")).unwrap(), "ok");

        let link = tgz(&[("package/x", tar::EntryType::Symlink, b"")]);
        assert!(unpack_package(&link, &link.parent().unwrap().join("out")).is_err());
        let outside = tgz(&[("other/bin.mjs", tar::EntryType::Regular, b"x"), ("package/a", tar::EntryType::Regular, b"")]);
        assert!(unpack_package(&outside, &outside.parent().unwrap().join("out")).is_err());
        let climbing = tgz(&[("package/../../evil", tar::EntryType::Regular, b"x"), ("package/b", tar::EntryType::Regular, b""), ("package/c", tar::EntryType::Regular, b"")]);
        let out = climbing.parent().unwrap().join("out");
        assert!(unpack_package(&climbing, &out).is_err());
        assert!(!out.exists(), "nothing is written from a refused archive");
    }
}
