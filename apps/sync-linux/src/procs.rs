//! Processes, read from /proc, and the PATH a terminal would have.

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub fn alive(pid: i32) -> bool {
    pid > 0 && unsafe { libc::kill(pid, 0) } == 0
}

pub fn parent(pid: i32) -> Option<i32> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    // The command name is in parentheses and may hold spaces; the fields after it are plain.
    let rest = &stat[stat.rfind(')')? + 2..];
    rest.split(' ').nth(1)?.parse().ok()
}

pub fn exe(pid: i32) -> Option<PathBuf> {
    std::fs::read_link(format!("/proc/{pid}/exe")).ok()
}

pub fn cmdline(pid: i32) -> Vec<String> {
    std::fs::read(format!("/proc/{pid}/cmdline"))
        .map(|bytes| bytes.split(|b| *b == 0).filter(|s| !s.is_empty()).map(|s| String::from_utf8_lossy(s).into_owned()).collect())
        .unwrap_or_default()
}

fn all_parents() -> HashMap<i32, i32> {
    let mut map = HashMap::new();
    if let Ok(entries) = std::fs::read_dir("/proc") {
        for entry in entries.flatten() {
            if let Some(pid) = entry.file_name().to_str().and_then(|n| n.parse::<i32>().ok()) {
                if let Some(ppid) = parent(pid) {
                    map.insert(pid, ppid);
                }
            }
        }
    }
    map
}

/// Every process under `root`, however deep.
pub fn descendants(root: i32) -> Vec<i32> {
    let parents = all_parents();
    let mut found = Vec::new();
    let mut seen: HashSet<i32> = HashSet::from([root]);
    let mut queue = vec![root];
    while let Some(current) = queue.pop() {
        for (pid, ppid) in &parents {
            if *ppid == current && seen.insert(*pid) {
                found.push(*pid);
                queue.push(*pid);
            }
        }
    }
    found
}

/// The program names a process answers to: its executable and the scripts node or a shell runs.
pub fn names(pid: i32) -> Vec<String> {
    let mut names: Vec<String> = cmdline(pid).into_iter().take(2).filter_map(|arg| base(&arg)).collect();
    if let Some(path) = exe(pid) {
        names.extend(base(&path.to_string_lossy()));
    }
    names
}

fn base(path: &str) -> Option<String> {
    Path::new(path).file_name().map(|n| n.to_string_lossy().trim_end_matches(" (deleted)").to_string())
}

pub fn kill(pid: i32, signal: i32) {
    if pid > 0 {
        unsafe {
            libc::kill(pid, signal);
        }
    }
}

/// The PATH a terminal window would have. Sync starts the person's agents (claude, codex) by
/// name, and a program started from the app menu or at log-in often gets a shorter one.
pub fn login_path() -> String {
    let home = crate::config::home_dir();
    let mut fallback: Vec<String> = [".local/bin", ".npm-global/bin", ".bun/bin", ".cargo/bin", ".volta/bin"]
        .iter()
        .map(|p| home.join(p).to_string_lossy().into_owned())
        .collect();
    fallback.extend(["/usr/local/bin", "/usr/bin", "/bin"].map(String::from));
    let shell = std::env::var("SHELL").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "/bin/bash".into());
    let marker = "__TINKJAM_PATH__";
    let found = run_with_timeout(
        Command::new(&shell).args(["-ilc", &format!("printf '{marker}%s{marker}' \"$PATH\"")]),
        Duration::from_secs(8),
    )
    .and_then(|out| out.split(marker).nth(1).map(str::to_string))
    .filter(|p| !p.is_empty());
    let current = std::env::var("PATH").unwrap_or_default();
    let mut seen = HashSet::new();
    found
        .unwrap_or_default()
        .split(':')
        .chain(current.split(':'))
        .map(str::to_string)
        .chain(fallback)
        .filter(|p| !p.is_empty() && seen.insert(p.clone()))
        .collect::<Vec<_>>()
        .join(":")
}

/// Runs a short command with no input and returns its standard output, or None.
pub fn run_with_timeout(command: &mut Command, timeout: Duration) -> Option<String> {
    let mut child = command.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn().ok()?;
    let mut stdout = child.stdout.take()?;
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        let _ = std::io::Read::read_to_string(&mut stdout, &mut text);
        text
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if start.elapsed() < timeout => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    reader.join().ok()
}

/// Whether a program is on `path`.
pub fn which(program: &str, path: &str) -> Option<PathBuf> {
    use std::os::unix::fs::PermissionsExt;
    path.split(':').filter(|d| !d.is_empty()).map(|d| Path::new(d).join(program)).find(|candidate| {
        std::fs::metadata(candidate).map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0).unwrap_or(false)
    })
}

pub fn port_free(port: u16) -> bool {
    std::net::TcpListener::bind(("127.0.0.1", port)).is_ok()
}

pub fn hostname() -> String {
    std::fs::read_to_string("/proc/sys/kernel/hostname").map(|h| h.trim().to_string()).unwrap_or_default()
}

/// Opens a link in the person's browser.
pub fn open_url(url: &str) -> bool {
    Command::new("xdg-open")
        .arg(url)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|mut child| {
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        })
        .is_ok()
}
