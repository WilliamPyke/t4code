//! Downloads and manifests over HTTPS (plain http only for a local test server on 127.0.0.1).
//! Uses the system's certificates and, like Node under the apps, the proxy the environment names.

use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::words;

#[derive(Debug)]
pub struct NetError {
    /// What the person reads.
    pub plain: &'static str,
    /// What the log gets.
    pub detail: String,
    /// The network itself is down: try again sooner.
    pub offline: bool,
}

impl NetError {
    fn new(plain: &'static str, detail: String, offline: bool) -> Self {
        NetError { plain, detail, offline }
    }
}

fn agent() -> ureq::Agent {
    let mut builder = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(20))
        .timeout_read(Duration::from_secs(60))
        .user_agent(&format!("TinkjamSync-Linux/{}", crate::config::version()));
    for name in ["HTTPS_PROXY", "https_proxy", "ALL_PROXY", "all_proxy"] {
        if let Ok(value) = std::env::var(name) {
            if let Ok(proxy) = ureq::Proxy::new(value.trim()) {
                builder = builder.proxy(proxy);
                break;
            }
        }
    }
    builder.build()
}

pub fn allowed_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://127.0.0.1:")
}

fn classify(error: ureq::Error, doing: &str) -> NetError {
    match error {
        ureq::Error::Status(code, _) => NetError::new(words::SERVER_TROUBLE, format!("{doing}: HTTP {code}"), false),
        ureq::Error::Transport(transport) => {
            let text = transport.to_string();
            let offline = matches!(transport.kind(), ureq::ErrorKind::Dns | ureq::ErrorKind::ConnectionFailed)
                || text.contains("Network is unreachable");
            let plain = if offline {
                words::OFFLINE
            } else if text.contains("certificate") || text.contains("InvalidCertificate") || text.contains("proxy") {
                words::RESTRICTED
            } else {
                words::UNREACHABLE
            };
            NetError::new(plain, format!("{doing}: {text}"), offline)
        }
    }
}

/// The first manifest that answers, as a JSON object.
pub fn get_json(urls: &[String], doing: &str) -> Result<Map<String, Value>, NetError> {
    let mut last = None;
    for url in urls {
        if !allowed_url(url) {
            continue;
        }
        match agent().get(url).set("Accept", "application/json").set("Cache-Control", "no-cache").call() {
            Ok(response) => {
                let mut body = String::new();
                if let Err(error) = response.into_reader().take(1 << 20).read_to_string(&mut body) {
                    last = Some(NetError::new(words::UNREACHABLE, format!("{doing}: {error}"), false));
                    continue;
                }
                return match serde_json::from_str::<Value>(&body) {
                    Ok(Value::Object(map)) => Ok(map),
                    _ => Err(NetError::new(words::SERVER_TROUBLE, format!("{doing}: {url} is not a JSON object"), false)),
                };
            }
            Err(error) => last = Some(classify(error, &format!("{doing} ({url})"))),
        }
    }
    Err(last.unwrap_or_else(|| NetError::new(words::SERVER_TROUBLE, format!("{doing}: no usable address"), false)))
}

/// Downloads `url` to `to`, reporting whole percents. `cancel` stops it between chunks.
pub fn download(url: &str, to: &Path, doing: &str, cancel: &AtomicBool, mut progress: impl FnMut(u8)) -> Result<(), NetError> {
    if !allowed_url(url) {
        return Err(NetError::new(words::SERVER_TROUBLE, format!("{doing}: refusing {url}"), false));
    }
    if let Some(parent) = to.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let response = agent().get(url).call().map_err(|e| classify(e, doing))?;
    let total: Option<u64> = response.header("Content-Length").and_then(|v| v.parse().ok());
    let mut reader = response.into_reader();
    let partial = to.with_extension("partial");
    let mut file = File::create(&partial).map_err(|e| disk(e, doing))?;
    let mut buffer = vec![0u8; 64 * 1024];
    let (mut read, mut shown) = (0u64, 255u8);
    loop {
        if cancel.load(Ordering::Relaxed) {
            let _ = std::fs::remove_file(&partial);
            return Err(NetError::new(words::SETUP_FAILED, format!("{doing}: cancelled"), false));
        }
        let count = match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(count) => count,
            Err(error) => {
                let _ = std::fs::remove_file(&partial);
                return Err(NetError::new(words::UNREACHABLE, format!("{doing}: {error}"), false));
            }
        };
        file.write_all(&buffer[..count]).map_err(|e| disk(e, doing))?;
        read += count as u64;
        if let Some(total) = total.filter(|t| *t > 0) {
            let percent = ((read * 100) / total).min(100) as u8;
            if percent != shown {
                shown = percent;
                progress(percent);
            }
        }
    }
    file.sync_all().map_err(|e| disk(e, doing))?;
    drop(file);
    if let Some(total) = total {
        if read != total {
            let _ = std::fs::remove_file(&partial);
            return Err(NetError::new(words::DAMAGED, format!("{doing}: got {read} of {total} bytes"), false));
        }
    }
    std::fs::rename(&partial, to).map_err(|e| disk(e, doing))
}

fn disk(error: std::io::Error, doing: &str) -> NetError {
    let full = error.raw_os_error() == Some(libc::ENOSPC);
    NetError::new(if full { words::DISK_FULL } else { words::SETUP_FAILED }, format!("{doing}: {error}"), false)
}

pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut file = File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0u8; 256 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

pub fn sha_matches(path: &Path, expected: &str) -> bool {
    let expected = expected.trim().to_ascii_lowercase();
    looks_like_sha(&expected) && sha256_file(path).map(|actual| actual == expected).unwrap_or(false)
}

pub fn looks_like_sha(hex: &str) -> bool {
    hex.len() == 64 && hex.chars().all(|c| c.is_ascii_hexdigit())
}

/// `key=value` text, percent-encoded for a query string.
pub fn query_escape(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' => (b as char).to_string(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}
