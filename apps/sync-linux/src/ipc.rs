//! The running copy's control socket. Windows (separate processes, so Wayland can open and close
//! them freely), a second launch from the app menu and `tinkjam-sync status` all talk to it: one
//! JSON request per line, one JSON answer per line. The socket is the person's own (0600).

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;

use serde_json::{json, Value};

use crate::engine::{Cmd, Shared, View};

/// What the front end does itself (the engine does the rest).
pub enum FrontRequest {
    Show,
    Panel,
    Quit,
}

pub fn serve(socket: &Path, shared: Arc<Shared>, front: impl Fn(FrontRequest) + Send + Sync + 'static) -> std::io::Result<()> {
    let _ = std::fs::remove_file(socket);
    if let Some(parent) = socket.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let listener = UnixListener::bind(socket)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(socket, std::fs::Permissions::from_mode(0o600))?;
    let front = Arc::new(front);
    std::thread::spawn(move || {
        for stream in listener.incoming().flatten() {
            let (shared, front) = (shared.clone(), front.clone());
            std::thread::spawn(move || handle(stream, &shared, &*front));
        }
    });
    Ok(())
}

fn handle(stream: UnixStream, shared: &Shared, front: &dyn Fn(FrontRequest)) {
    // Only the same user: the socket's mode says so, and the peer's uid must agree.
    if !same_user(&stream) {
        return;
    }
    let Ok(mut writer) = stream.try_clone() else { return };
    let reader = BufReader::new(stream);
    for line in reader.lines().map_while(Result::ok) {
        let request: Value = serde_json::from_str(&line).unwrap_or(Value::Null);
        let answer = match request.get("cmd").and_then(Value::as_str).unwrap_or_default() {
            "state" => {
                let after = request.get("after").and_then(Value::as_u64).unwrap_or(0);
                let (serial, view) = shared.view_after(after, Duration::from_millis(900));
                json!({ "serial": serial, "view": view })
            }
            command => {
                match command {
                    "connect" => shared.send(Cmd::Connect),
                    "retry" => shared.send(Cmd::Retry),
                    "open-approval" => shared.send(Cmd::OpenApproval),
                    "disconnect" => shared.send(Cmd::Disconnect),
                    "start-at-login" => shared.send(Cmd::SetStartAtLogin(request.get("on").and_then(Value::as_bool).unwrap_or(true))),
                    "check-for-updates" => shared.send(Cmd::CheckForUpdates { manual: true }),
                    "restart-to-update" => shared.send(Cmd::RestartToUpdate),
                    "refresh-agents" => shared.send(Cmd::RefreshAgents),
                    "uninstall" => shared.send(Cmd::Uninstall),
                    "show" => front(FrontRequest::Show),
                    "panel" => front(FrontRequest::Panel),
                    "quit" => front(FrontRequest::Quit),
                    _ => {
                        let _ = writeln!(writer, "{}", json!({ "ok": false }));
                        continue;
                    }
                }
                json!({ "ok": true })
            }
        };
        if writeln!(writer, "{answer}").is_err() {
            break;
        }
    }
}

fn same_user(stream: &UnixStream) -> bool {
    use std::os::fd::AsRawFd;
    let mut cred = libc::ucred { pid: 0, uid: u32::MAX, gid: 0 };
    let mut len = std::mem::size_of::<libc::ucred>() as libc::socklen_t;
    let ok = unsafe {
        libc::getsockopt(stream.as_raw_fd(), libc::SOL_SOCKET, libc::SO_PEERCRED, &mut cred as *mut _ as *mut libc::c_void, &mut len)
    } == 0;
    ok && cred.uid == unsafe { libc::getuid() }
}

/// A connection to the running copy.
pub struct Client {
    reader: BufReader<UnixStream>,
    writer: UnixStream,
}

impl Client {
    pub fn connect(socket: &Path) -> std::io::Result<Client> {
        let stream = UnixStream::connect(socket)?;
        stream.set_read_timeout(Some(Duration::from_secs(5)))?;
        Ok(Client { writer: stream.try_clone()?, reader: BufReader::new(stream) })
    }

    pub fn request(&mut self, request: Value) -> std::io::Result<Value> {
        writeln!(self.writer, "{request}")?;
        let mut line = String::new();
        if self.reader.read_line(&mut line)? == 0 {
            return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "the running copy closed the connection"));
        }
        serde_json::from_str(&line).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))
    }

    pub fn send(&mut self, cmd: &str) -> bool {
        self.request(json!({ "cmd": cmd })).map(|a| a["ok"] == true).unwrap_or(false)
    }

    /// The view once it changes after `after` (or within about a second).
    pub fn state(&mut self, after: u64) -> std::io::Result<(u64, View)> {
        let answer = self.request(json!({ "cmd": "state", "after": after }))?;
        let serial = answer["serial"].as_u64().unwrap_or(0);
        let view = serde_json::from_value(answer["view"].clone()).map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        Ok((serial, view))
    }
}
