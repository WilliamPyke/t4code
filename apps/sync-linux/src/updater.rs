//! The app updates itself from `https://tinkjam.com/downloads/linux.json` (else the same file on
//! trellium.org), which names the AppImage:
//!
//!     { "kind": "linux", "version": "1.0.6", "build": "202612010900",
//!       "url": "https://trellium.org/downloads/tinkjam-sync-v1.0.6-linux-x86_64.AppImage",
//!       "sha256": "<hex>", "keyId": "…", "signature": "…" }
//!
//! Only a manifest Tinkjam's release key signed is used. An AppImage this app installed replaces
//! itself; a .deb or .rpm install, which only the package manager may change, offers the download.

use std::path::PathBuf;
use std::sync::atomic::AtomicBool;

use serde_json::Value;

use crate::config::{self, Paths};
use crate::engine::SetupError;
use crate::{desktop, log, net, signature, words};

#[derive(Clone, Debug)]
pub struct Staged {
    pub version: String,
    pub file: PathBuf,
    pub sha256: String,
}

pub enum Outcome {
    UpToDate,
    Staged(Staged),
    Manual(String),
}

/// `version` then `build`, both compared numerically part by part.
pub fn is_newer(version: &str, build: &str, than_version: &str, than_build: &str) -> bool {
    fn parts(v: &str) -> Vec<u64> {
        v.split('.').map(|p| p.chars().take_while(char::is_ascii_digit).collect::<String>().parse().unwrap_or(0)).collect()
    }
    let compare = |a: &str, b: &str| {
        let (a, b) = (parts(a), parts(b));
        for i in 0..a.len().max(b.len()) {
            let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
            if x != y {
                return x.cmp(&y);
            }
        }
        std::cmp::Ordering::Equal
    };
    match compare(version, than_version) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => compare(build, than_build) == std::cmp::Ordering::Greater,
    }
}

pub fn check(paths: &Paths, cancel: &AtomicBool) -> Result<Outcome, SetupError> {
    let manifest = net::get_json(&config::app_manifest_urls(), "checking for a new version of the app")?;
    let text = |k: &str| manifest.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let (version, build, url, sha) = (text("version"), text("build"), text("url"), text("sha256").to_ascii_lowercase());
    if !is_newer(&version, &build, config::version(), config::build()) {
        let _ = std::fs::remove_dir_all(paths.update_dir());
        return Ok(Outcome::UpToDate);
    }
    if !signature::verify("linux", &manifest) {
        return Err(SetupError {
            plain: words::SERVER_TROUBLE,
            detail: format!("linux.json offers {version} but is not signed with Tinkjam's release key; not installed"),
            offline: false,
        });
    }
    let Some(installed) = desktop::installed_appimage() else {
        log::app(format!("Tinkjam Sync for Linux {version} is out; this copy is updated by its package manager"));
        return Ok(Outcome::Manual(version));
    };
    if !net::allowed_url(&url) || !net::looks_like_sha(&sha) {
        return Err(SetupError { plain: words::SERVER_TROUBLE, detail: format!("linux.json names no usable download ({url})"), offline: false });
    }
    let writable = installed.parent().is_some_and(|dir| unsafe {
        let c = std::ffi::CString::new(dir.as_os_str().as_encoded_bytes()).unwrap_or_default();
        libc::access(c.as_ptr(), libc::W_OK) == 0
    });
    if !writable {
        return Ok(Outcome::Manual(version));
    }
    let file = paths.update_dir().join(format!("tinkjam-sync-{}.AppImage", version.replace(|c: char| !c.is_ascii_alphanumeric() && c != '.', "-")));
    // One already downloaded and intact is kept, so a new log-in downloads nothing again.
    if !(file.is_file() && net::sha_matches(&file, &sha)) {
        let _ = std::fs::remove_dir_all(paths.update_dir());
        log::app(format!("Downloading Tinkjam Sync for Linux {version}"));
        net::download(&url, &file, "downloading the new version of the app", cancel, |_| {})?;
        if !net::sha_matches(&file, &sha) {
            let _ = std::fs::remove_file(&file);
            return Err(SetupError { plain: words::DAMAGED, detail: "the new version of the app did not match its checksum".into(), offline: false });
        }
        let mut magic = [0u8; 4];
        let elf = std::fs::File::open(&file).and_then(|mut f| std::io::Read::read_exact(&mut f, &mut magic)).is_ok() && magic == *b"\x7fELF";
        if !elf {
            let _ = std::fs::remove_file(&file);
            return Err(SetupError { plain: words::DAMAGED, detail: "the new version of the app is not a Linux program".into(), offline: false });
        }
        log::app(format!("Tinkjam Sync for Linux {version} is downloaded and checked"));
    }
    Ok(Outcome::Staged(Staged { version, file, sha256: sha }))
}

/// Puts the checked AppImage in place of the installed one and starts it. Call it with Sync
/// stopped. Returns only when it could not.
pub fn apply(staged: &Staged) -> Result<std::convert::Infallible, String> {
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::process::CommandExt;
    let installed = desktop::installed_appimage().ok_or("not running from the installed AppImage")?;
    // The file sat on disk since it was checked; only the one that was published runs.
    if !net::sha_matches(&staged.file, &staged.sha256) {
        let _ = std::fs::remove_file(&staged.file);
        return Err("the downloaded update no longer matches what was published".into());
    }
    let next = installed.with_extension("AppImage.new");
    std::fs::copy(&staged.file, &next).map_err(|e| e.to_string())?;
    std::fs::set_permissions(&next, std::fs::Permissions::from_mode(0o755)).map_err(|e| e.to_string())?;
    // A running file can be replaced on Linux: this copy keeps its old inode until it exits.
    std::fs::rename(&next, &installed).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(&staged.file);
    log::app(format!("Installed Tinkjam Sync for Linux {}; starting it", staged.version));
    // A new process, not exec: this one's AppImage mount stays up only until it exits. The new
    // copy waits for this one's lock.
    let args: Vec<String> = std::env::args().skip(1).filter(|a| a != "--autostart" && a != "--after-update").collect();
    let mut command = std::process::Command::new(&installed);
    command.args(args).arg("--after-update");
    for name in ["APPIMAGE", "APPDIR", "ARGV0", "OWD"] {
        command.env_remove(name);
    }
    unsafe {
        command.pre_exec(|| {
            libc::setsid();
            Ok(())
        });
    }
    command.spawn().map_err(|e| format!("could not start the new version: {e}"))?;
    std::process::exit(0)
}

#[cfg(test)]
mod tests {
    #[test]
    fn compares_version_then_build() {
        use super::is_newer;
        assert!(is_newer("1.0.6", "", "1.0.5", "202611200012"));
        assert!(is_newer("1.0.5", "202611210000", "1.0.5", "202611200012"));
        assert!(!is_newer("1.0.5", "202611200012", "1.0.5", "202611200012"));
        assert!(!is_newer("1.0.4", "209912312359", "1.0.5", "0"));
        assert!(is_newer("1.10.0", "", "1.9.9", ""));
    }
}
