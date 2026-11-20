//! Tinkjam Sync for Linux. One program, several roles:
//!
//! - no arguments (or `--autostart`): the running copy. It sets up and supervises Sync, serves the
//!   control socket and, in the desktop build, shows the tray icon. A second launch asks the
//!   running copy to show its window and exits.
//! - `--window setup|panel|home`: one window, drawn by this program, talking to the running copy
//!   over its socket. Windows are separate processes so they open and close cleanly on Wayland.
//! - `status`, `connect`, `disconnect`, `quit`, `check-for-updates`: ask the running copy.
//! - `enable-service`, `disable-service`: the headless build's systemd user unit.

#![cfg_attr(not(feature = "gui"), allow(dead_code))]

mod agents;
mod config;
mod desktop;
mod engine;
mod ipc;
mod log;
mod net;
mod procs;
mod signature;
mod updater;
mod words;

#[cfg(feature = "gui")]
mod gui;

use std::os::fd::AsRawFd;
use std::process::ExitCode;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use config::Paths;

static QUIT: AtomicBool = AtomicBool::new(false);

extern "C" fn on_signal(_: libc::c_int) {
    QUIT.store(true, Ordering::SeqCst);
}

#[derive(Default)]
pub struct Args {
    pub command: Option<String>,
    pub base_dir: Option<String>,
    pub autostart: bool,
    pub after_update: bool,
    pub window: Option<String>,
    pub at: Option<(i32, i32)>,
    pub rest: Vec<String>,
}

fn parse_args() -> Result<Args, String> {
    let mut args = Args::default();
    let mut iter = std::env::args().skip(1);
    while let Some(arg) = iter.next() {
        match arg.as_str() {
            "--base-dir" => args.base_dir = Some(iter.next().ok_or("--base-dir needs a folder")?),
            "--autostart" => args.autostart = true,
            "--after-update" => args.after_update = true,
            "--window" => args.window = Some(iter.next().ok_or("--window needs setup, panel or home")?),
            "--at" => {
                let value = iter.next().ok_or("--at needs x,y")?;
                let (x, y) = value.split_once(',').ok_or("--at needs x,y")?;
                args.at = Some((x.trim().parse().map_err(|_| "bad --at")?, y.trim().parse().map_err(|_| "bad --at")?));
            }
            "--version" | "-v" => args.command = Some("version".into()),
            "--help" | "-h" => args.command = Some("help".into()),
            other if !other.starts_with('-') && args.command.is_none() => args.command = Some(other.into()),
            other if !other.starts_with('-') => args.rest.push(other.into()),
            other => return Err(format!("Unknown option {other}. Run tinkjam-sync --help.")),
        }
    }
    Ok(args)
}

const HELP: &str = "Tinkjam Sync connects the agents on this computer, such as Claude Code or Codex, to your
Tinkjam boards. They run here, on your own sign-in, and only you can send them work.

Usage: tinkjam-sync [command] [--base-dir <dir>]

Commands
  (none)             Start Tinkjam Sync, or show the running one.
  status             Show whether this computer is connected.
  connect            Connect this computer (prints the approval link).
  disconnect         Disconnect this computer from your Tinkjam account.
  check-for-updates  Check for a newer Tinkjam Sync now.
  quit               Stop Tinkjam Sync.
  enable-service     Start Tinkjam Sync when you log in (a systemd user unit).
  disable-service    Stop starting it when you log in.
  verify <kind> <file or URL>
                     Check a release manifest's signature (kind: sync, linux, mac, windows).
  version            Show the version.";

fn main() -> ExitCode {
    let args = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            eprintln!("{message}");
            return ExitCode::from(2);
        }
    };
    let paths = Paths::resolve(args.base_dir.as_deref());
    match args.command.as_deref() {
        Some("help") => {
            println!("{HELP}");
            return ExitCode::SUCCESS;
        }
        Some("version") => {
            println!("Tinkjam Sync for Linux {} ({})", config::version(), config::build());
            return ExitCode::SUCCESS;
        }
        Some("status") => return status(&paths),
        Some(cmd @ ("connect" | "disconnect" | "quit" | "check-for-updates" | "show")) => return ask(&paths, cmd),
        Some("enable-service") => return service(&paths, true),
        Some("disable-service") => return service(&paths, false),
        Some("verify") => return verify(&args.rest),
        Some("run") | None => {}
        Some(other) => {
            eprintln!("Unknown command {other}. Run tinkjam-sync --help.");
            return ExitCode::from(2);
        }
    }
    #[cfg(feature = "gui")]
    if let Some(kind) = args.window.as_deref() {
        return gui::run_window(&paths, kind, args.at);
    }
    run(&paths, &args)
}

/// Holds `<home>/sync-app.lock` for as long as this copy runs: one running copy per home.
fn take_lock(paths: &Paths, wait: Duration) -> Option<std::fs::File> {
    let _ = std::fs::create_dir_all(&paths.base);
    let file = std::fs::OpenOptions::new().create(true).truncate(false).write(true).open(paths.lock()).ok()?;
    let deadline = Instant::now() + wait;
    loop {
        if unsafe { libc::flock(file.as_raw_fd(), libc::LOCK_EX | libc::LOCK_NB) } == 0 {
            return Some(file);
        }
        if Instant::now() >= deadline {
            return None;
        }
        std::thread::sleep(Duration::from_millis(250));
    }
}

fn run(paths: &Paths, args: &Args) -> ExitCode {
    let gui = cfg!(feature = "gui");
    let wait = if args.after_update { Duration::from_secs(60) } else { Duration::ZERO };
    let Some(lock) = take_lock(paths, wait) else {
        // Already running: bring its window forward instead.
        return match ipc::Client::connect(&paths.socket()) {
            Ok(mut client) => {
                if gui && !args.autostart {
                    client.send("show");
                } else if !gui {
                    println!("Tinkjam Sync is already running for {}. Run `tinkjam-sync status` to see it.", paths.base.display());
                }
                ExitCode::SUCCESS
            }
            Err(error) => {
                eprintln!("Another Tinkjam Sync holds {} but does not answer ({error}).", paths.lock().display());
                ExitCode::FAILURE
            }
        };
    };
    log::init(paths.log());
    log::app(format!(
        "Tinkjam Sync for Linux {} ({}) started{} for {}",
        config::version(),
        config::build(),
        if args.autostart { " at log-in" } else { "" },
        paths.base.display()
    ));

    // An AppImage opened from Downloads moves into place first, and runs from there.
    #[cfg(feature = "gui")]
    if paths.is_default {
        if let Some(target) = desktop::integrate_appimage() {
            log::app(format!("Installed the AppImage at {}; starting it from there", target.display()));
            drop(lock);
            let forwarded: Vec<String> = std::env::args().skip(1).collect();
            let mut command = std::process::Command::new(&target);
            command.args(forwarded);
            for name in ["APPIMAGE", "APPDIR", "ARGV0", "OWD"] {
                command.env_remove(name);
            }
            return match command.spawn() {
                Ok(_) => ExitCode::SUCCESS,
                Err(error) => {
                    log::app(format!("Could not start {}: {error}", target.display()));
                    ExitCode::FAILURE
                }
            };
        }
    }

    unsafe {
        libc::signal(libc::SIGINT, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGTERM, on_signal as *const () as libc::sighandler_t);
        libc::signal(libc::SIGHUP, on_signal as *const () as libc::sighandler_t);
    }

    let (engine, shared) = engine::Engine::new(paths.clone(), gui);
    let engine_thread = std::thread::Builder::new().name("engine".into()).spawn(move || engine.run()).expect("engine thread");

    #[cfg(feature = "gui")]
    let code = gui::run_front(paths, shared.clone(), args, &QUIT);
    #[cfg(not(feature = "gui"))]
    let code = run_headless(paths, shared.clone(), args);

    shared.shutdown();
    let _ = std::fs::remove_file(paths.socket());
    log::app("Exited; Tinkjam Sync stopped.");
    drop(engine_thread);
    drop(lock);
    code
}

#[cfg(not(feature = "gui"))]
fn run_headless(paths: &Paths, shared: std::sync::Arc<engine::Shared>, args: &Args) -> ExitCode {
    use engine::{FrontEvent, Phase};
    shared.set_front(|event| {
        // The approval link is printed with the state; the rest are worth a line of their own.
        if let FrontEvent::Notify(title, body) = event.clone() {
            if !title.starts_with("Approve") && !title.ends_with("isn't connected") {
                println!("{title}: {body}");
            }
        }
    });
    if let Err(error) = ipc::serve(&paths.socket(), shared.clone(), |request| {
        if let ipc::FrontRequest::Quit = request {
            QUIT.store(true, Ordering::SeqCst);
        }
    }) {
        log::app(format!("Could not open the control socket: {error}"));
    }
    // In a terminal, connecting happens here, in the open: the approval link is printed.
    let interactive = !args.autostart && unsafe { libc::isatty(1) } == 1;
    shared.send(engine::Cmd::Start { interactive });
    let mut shown = String::new();
    let mut serial = 0;
    while !QUIT.load(Ordering::SeqCst) {
        let (next, view) = shared.view_after(serial, Duration::from_millis(300));
        serial = next;
        let mut quiet = view.clone();
        // A line per quarter of a download is enough in a terminal or a journal.
        quiet.percent = quiet.percent.map(|p| p / 25 * 25);
        let line = describe(&quiet, paths);
        if line != shown {
            println!("{line}");
            shown = line;
        }
        if view.phase == Phase::Approving && !view.approval_opened {
            // Nobody can press a button here; the link itself is printed by Sync to the log.
        }
    }
    ExitCode::SUCCESS
}

fn describe(view: &engine::View, _paths: &Paths) -> String {
    use engine::Phase;
    let title = match view.phase {
        Phase::SettingUp => "Setting up…",
        Phase::Approving => "Waiting for you to approve this computer",
        Phase::Connecting => "Connecting…",
        Phase::Connected => "Connected",
        Phase::Reconnecting => "Reconnecting…",
        Phase::NotConnected => "Not connected",
        Phase::Disconnecting => "Disconnecting…",
        Phase::Stopped => "Stopped",
    };
    let mut line = format!("Tinkjam Sync: {title}");
    if let Some(detail) = &view.detail {
        line.push_str(&format!(" ({detail}{})", view.percent.map(|p| format!(" {p}%")).unwrap_or_default()));
    }
    if view.phase == Phase::Approving {
        let link = view.approval_url.clone().unwrap_or_else(|| format!("http://127.0.0.1:{}", config::APPROVAL_PORT));
        line.push_str(&format!("\nTo connect {}, open this link in a browser, sign in and press Connect:\n\n  {link}\n", view.computer));
    }
    line
}

fn status(paths: &Paths) -> ExitCode {
    match ipc::Client::connect(&paths.socket()).and_then(|mut c| c.state(0)) {
        Ok((_, view)) => {
            println!("{}", describe(&view, paths));
            println!("This computer: {}", view.computer);
            let agents: Vec<String> = view.agents.iter().map(|a| if a.working { format!("{} (working)", a.name) } else { a.name.clone() }).collect();
            println!("Agents found: {}", if agents.is_empty() { "none".into() } else { agents.join(", ") });
            println!("Version {}{}", view.version, view.update_version.map(|v| format!(" (version {v} is available)")).unwrap_or_default());
            println!("Log: {}", view.log_path);
            ExitCode::SUCCESS
        }
        Err(_) => {
            println!("Tinkjam Sync is not running for {}.", paths.base.display());
            ExitCode::from(3)
        }
    }
}

fn ask(paths: &Paths, command: &str) -> ExitCode {
    let Ok(mut client) = ipc::Client::connect(&paths.socket()) else {
        if command == "connect" {
            eprintln!("Tinkjam Sync is not running. Start it with `tinkjam-sync`; in a terminal it prints the approval link.");
        } else {
            eprintln!("Tinkjam Sync is not running for {}.", paths.base.display());
        }
        return ExitCode::from(3);
    };
    if !client.send(command) {
        return ExitCode::FAILURE;
    }
    if command == "connect" {
        // Wait for the link, so a person on a server can open it elsewhere.
        let mut serial = 0;
        for _ in 0..120 {
            let Ok((next, view)) = client.state(serial) else { break };
            serial = next;
            match view.phase {
                engine::Phase::Approving => {
                    println!("{}", describe(&view, paths));
                    return ExitCode::SUCCESS;
                }
                engine::Phase::Connected => {
                    println!("This computer is connected.");
                    return ExitCode::SUCCESS;
                }
                _ => {}
            }
        }
    }
    ExitCode::SUCCESS
}

/// `~/.config/systemd/user/tinkjam-sync-cli.service`. Named so the Sync package's own
/// `--uninstall` leaves it alone (it treats `tinkjam-sync-<name>` as another home's).
fn service(paths: &Paths, enable: bool) -> ExitCode {
    let unit_name = "tinkjam-sync-cli.service";
    let unit = config::config_home().join("systemd/user").join(unit_name);
    let systemctl = |args: &[&str]| std::process::Command::new("systemctl").arg("--user").args(args).status().map(|s| s.success()).unwrap_or(false);
    if !enable {
        systemctl(&["disable", "--now", unit_name]);
        let _ = std::fs::remove_file(&unit);
        systemctl(&["daemon-reload"]);
        println!("Tinkjam Sync no longer starts when you log in. This computer stays connected.");
        return ExitCode::SUCCESS;
    }
    let exe = std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_else(|_| "tinkjam-sync".into());
    let quote = |v: &str| format!("\"{}\"", v.replace('\\', "\\\\").replace('"', "\\\"").replace('%', "%%").replace('$', "$$"));
    let mut exec = vec![quote(&exe), "run".into(), "--autostart".into()];
    if !paths.is_default {
        exec.extend(["--base-dir".into(), quote(&paths.base.to_string_lossy())]);
    }
    let text = format!(
        "[Unit]\nDescription=Tinkjam Sync: connects this computer's agents to Tinkjam\nAfter=network-online.target\n\n[Service]\nExecStart={}\nRestart=on-failure\nRestartSec=10\n\n[Install]\nWantedBy=default.target\n",
        exec.join(" ")
    );
    if let Err(error) = std::fs::create_dir_all(unit.parent().unwrap()).and_then(|_| std::fs::write(&unit, text)) {
        eprintln!("Could not write {}: {error}", unit.display());
        return ExitCode::FAILURE;
    }
    if !(systemctl(&["daemon-reload"]) && systemctl(&["enable", "--now", unit_name])) {
        eprintln!("systemd did not start {unit_name}. Is a systemd user session running here?");
        return ExitCode::FAILURE;
    }
    println!("Tinkjam Sync now runs in the background and starts when you log in ({}).", unit.display());
    println!("To keep it running after you log out, run: loginctl enable-linger");
    ExitCode::SUCCESS
}

/// For releases and tests: whether a manifest carries a valid signature by Tinkjam's release key.
fn verify(rest: &[String]) -> ExitCode {
    let (Some(kind), Some(source)) = (rest.first(), rest.get(1)) else {
        eprintln!("Usage: tinkjam-sync verify <sync|linux|mac|windows> <file or URL>");
        return ExitCode::from(2);
    };
    let manifest = if source.starts_with("https://") || source.starts_with("http://127.0.0.1:") {
        net::get_json(std::slice::from_ref(source), "reading the manifest").map_err(|e| e.detail)
    } else {
        std::fs::read_to_string(source)
            .map_err(|e| e.to_string())
            .and_then(|text| serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(&text).map_err(|e| e.to_string()))
    };
    match manifest {
        Ok(manifest) if signature::verify(kind, &manifest) => {
            println!("{source}: signed by Tinkjam's release key ({kind})");
            ExitCode::SUCCESS
        }
        Ok(_) => {
            println!("{source}: NOT signed by Tinkjam's release key ({kind})");
            ExitCode::FAILURE
        }
        Err(error) => {
            eprintln!("{source}: {error}");
            ExitCode::FAILURE
        }
    }
}
