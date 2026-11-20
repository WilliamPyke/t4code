//! Fixed addresses and pins, and where everything lives. Each address can be overridden with an
//! environment variable, which is how the app is tested against a local server.

use std::path::{Path, PathBuf};

pub const APP_ID: &str = "org.tinkjam.Sync";
/// Sync's approval page listens here; another program holding it blocks connecting.
pub const APPROVAL_PORT: u16 = 34338;

/// Node.js for Sync, kept by the app under `<home>/runtime`. The hashes are from
/// https://nodejs.org/dist/v26.13.1/SHASUMS256.txt, the same version the Mac app pins.
pub const NODE_VERSION: &str = "v26.13.1";
pub fn node_sha256(arch: &str) -> Option<&'static str> {
    match arch {
        "x64" => Some("5c063e46bab0fbc1c17cc445d7ff129cbdcd0471be6ed83b6ab864f8143bc864"),
        "arm64" => Some("89e1853138db51e8b82d3e98ba9c0d3f2956a28e5e55ea1b7e12d25aae92d5dd"),
        _ => None,
    }
}

pub fn node_arch() -> &'static str {
    if cfg!(target_arch = "aarch64") {
        "arm64"
    } else {
        "x64"
    }
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// The UTC build stamp scripts/build.sh sets; a development build has none.
pub fn build() -> &'static str {
    option_env!("TINKJAM_BUILD").unwrap_or("0")
}

fn env(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

/// Each manifest from tinkjam.com, else the same file on trellium.org; an override stands alone.
fn addresses(overridden: Option<String>, path: &str) -> Vec<String> {
    match overridden {
        Some(url) => vec![url],
        None => vec![format!("https://tinkjam.com{path}"), format!("https://trellium.org{path}")],
    }
}

pub fn sync_manifest_urls() -> Vec<String> {
    addresses(env("TINKJAM_SYNC_MANIFEST_URL"), "/sync.json")
}

pub fn app_manifest_urls() -> Vec<String> {
    addresses(env("TINKJAM_APP_MANIFEST_URL"), "/downloads/linux.json")
}

/// The tarball's address as signed manifests name it: still trellium.org, which every copy out
/// there reaches (tinkjam.com serves the same file).
pub fn sync_package_url() -> String {
    env("TINKJAM_SYNC_PACKAGE_URL").unwrap_or_else(|| "https://trellium.org/sync.tgz".into())
}

pub fn hosted_app_url() -> String {
    env("TINKJAM_HOSTED_APP_URL").unwrap_or_else(|| "https://app.tinkjam.com".into())
}

pub fn download_page_url() -> String {
    env("TINKJAM_DOWNLOAD_PAGE_URL").unwrap_or_else(|| "https://tinkjam.com/download".into())
}

pub fn node_dist_url() -> String {
    env("TINKJAM_NODE_DIST_URL").unwrap_or_else(|| "https://nodejs.org/dist".into())
}

/// Test hook: never open a browser, only log the approval link (and keep it in the panel).
pub fn browser_disabled() -> bool {
    env("TINKJAM_SYNC_NO_BROWSER").is_some()
}

pub fn home_dir() -> PathBuf {
    env("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/"))
}

pub fn config_home() -> PathBuf {
    env("XDG_CONFIG_HOME").map(PathBuf::from).unwrap_or_else(|| home_dir().join(".config"))
}

pub fn data_home() -> PathBuf {
    env("XDG_DATA_HOME").map(PathBuf::from).unwrap_or_else(|| home_dir().join(".local/share"))
}

/// Where everything lives. The home is `~/.tinkjam`, shared with the npx-installed Sync so an
/// existing connection carries over; `--base-dir <dir>` or TINKJAM_SYNC_HOME points a test copy
/// somewhere else, and such a copy never touches the login items of the default home.
#[derive(Clone, Debug)]
pub struct Paths {
    pub base: PathBuf,
    pub is_default: bool,
}

impl Paths {
    pub fn resolve(flag: Option<&str>) -> Paths {
        let chosen = flag.map(str::to_string).or_else(|| env("TINKJAM_SYNC_HOME"));
        let default = Self::default_base();
        match chosen {
            Some(dir) => {
                let expanded = if let Some(rest) = dir.strip_prefix("~/") { home_dir().join(rest) } else { PathBuf::from(&dir) };
                let absolute = if expanded.is_absolute() {
                    expanded
                } else {
                    std::env::current_dir().unwrap_or_default().join(expanded)
                };
                let is_default = same_path(&absolute, &default);
                Paths { base: absolute, is_default }
            }
            None => Paths { base: default, is_default: true },
        }
    }

    pub fn default_base() -> PathBuf {
        home_dir().join(".tinkjam")
    }

    pub fn runtime(&self) -> PathBuf {
        self.base.join("runtime")
    }
    pub fn node_home(&self) -> PathBuf {
        self.runtime().join(format!("node-{NODE_VERSION}-linux-{}", node_arch()))
    }
    pub fn node(&self) -> PathBuf {
        self.node_home().join("bin/node")
    }
    pub fn npm_cli(&self) -> PathBuf {
        self.node_home().join("lib/node_modules/npm/bin/npm-cli.js")
    }
    pub fn app(&self) -> PathBuf {
        self.base.join("app")
    }
    pub fn staging(&self) -> PathBuf {
        self.base.join("app-staging")
    }
    pub fn log(&self) -> PathBuf {
        self.base.join("logs/sync.log")
    }
    pub fn status(&self) -> PathBuf {
        self.base.join("userdata/sync-status.json")
    }
    pub fn settings(&self) -> PathBuf {
        self.base.join("sync-app.json")
    }
    pub fn lock(&self) -> PathBuf {
        self.base.join("sync-app.lock")
    }
    pub fn child_record(&self) -> PathBuf {
        self.base.join("sync-app-child.json")
    }
    pub fn update_dir(&self) -> PathBuf {
        self.runtime().join("update")
    }

    /// The control socket: in the session's runtime folder when there is one.
    pub fn socket(&self) -> PathBuf {
        let name = if self.is_default {
            "tinkjam-sync.sock".to_string()
        } else {
            format!("tinkjam-sync-{:016x}.sock", fnv(self.base.to_string_lossy().as_bytes()))
        };
        match env("XDG_RUNTIME_DIR") {
            Some(dir) if Path::new(&dir).is_dir() => PathBuf::from(dir).join(name),
            _ => self.base.join(name),
        }
    }

    pub fn package_in(root: &Path) -> PathBuf {
        root.join("node_modules/tinkjam-sync")
    }
    pub fn server_entry_in(root: &Path) -> PathBuf {
        Self::package_in(root).join("dist/bin.mjs")
    }
    pub fn launcher_in(root: &Path) -> PathBuf {
        Self::package_in(root).join("bin/tinkjam-sync.mjs")
    }
    pub fn server_entry(&self) -> PathBuf {
        Self::server_entry_in(&self.app())
    }
}

pub fn same_path(a: &Path, b: &Path) -> bool {
    let clean = |p: &Path| p.to_string_lossy().trim_end_matches('/').to_string();
    clean(a) == clean(b)
}

fn fnv(bytes: &[u8]) -> u64 {
    bytes.iter().fold(0xcbf29ce484222325u64, |hash, byte| (hash ^ *byte as u64).wrapping_mul(0x100000001b3))
}
