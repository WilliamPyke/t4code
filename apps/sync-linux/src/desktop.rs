//! The desktop's view of the app: its login item, its app-menu entry when it runs as an AppImage,
//! and the older npx-installed Sync it replaces.

use std::path::{Path, PathBuf};

use crate::config::{self, Paths};

/// Never `tinkjam-sync.desktop`: the package's `--uninstall` treats that name, and any file that
/// runs Tinkjam Sync under another name, as an older setup to remove. It leaves names of the form
/// `tinkjam-sync-<home>` alone, so this one survives the takeover.
const AUTOSTART_FILE: &str = "tinkjam-sync-app.desktop";
const MENU_FILE: &str = "org.tinkjam.Sync.desktop";

pub fn autostart_path() -> PathBuf {
    config::config_home().join("autostart").join(AUTOSTART_FILE)
}

/// Where an AppImage copies itself so the app menu, the login item and updates have one place.
pub fn appimage_home() -> PathBuf {
    config::data_home().join("tinkjam-sync")
}

pub fn appimage_target() -> PathBuf {
    appimage_home().join("tinkjam-sync.AppImage")
}

/// The AppImage this app installed for itself, if it runs from one.
pub fn installed_appimage() -> Option<PathBuf> {
    let running = std::env::var_os("APPIMAGE").map(PathBuf::from)?;
    config::same_path(&running, &appimage_target()).then_some(running)
}

/// The program that starts this copy again: the installed AppImage, else this executable.
pub fn launch_program() -> PathBuf {
    std::env::var_os("APPIMAGE")
        .map(PathBuf::from)
        .or_else(|| std::env::current_exe().ok())
        .unwrap_or_else(|| PathBuf::from("tinkjam-sync"))
}

/// A Desktop Entry `Exec` argument: quoted, with `"`, `` ` ``, `$` and `\` escaped, then every
/// backslash escaped again as a string value, and `%` doubled.
pub fn exec_quote(value: &str) -> String {
    if value.chars().all(|c| c.is_ascii_alphanumeric() || "/._-+".contains(c)) {
        return value.to_string();
    }
    let mut inner = String::new();
    for c in value.chars() {
        match c {
            '"' | '`' | '$' | '\\' => {
                inner.push('\\');
                inner.push(c);
            }
            _ => inner.push(c),
        }
    }
    format!("\"{}\"", inner.replace('\\', "\\\\").replace('%', "%%"))
}

pub fn set_autostart(on: bool) -> std::io::Result<()> {
    let path = autostart_path();
    if !on {
        return match std::fs::remove_file(&path) {
            Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
            _ => Ok(()),
        };
    }
    let program = launch_program();
    // TryExec: once the app is uninstalled, the desktop skips this entry instead of failing.
    let contents = format!(
        "[Desktop Entry]\nType=Application\nName=Tinkjam Sync\nComment=Connects the agents on this computer to Tinkjam\nExec={} --autostart\nTryExec={}\nIcon={}\nTerminal=false\nNoDisplay=true\nX-GNOME-Autostart-enabled=true\nX-KDE-autostart-after=panel\n",
        exec_quote(&program.to_string_lossy()),
        program.to_string_lossy(),
        config::APP_ID
    );
    write_if_changed(&path, &contents)
}

fn write_if_changed(path: &Path, contents: &str) -> std::io::Result<()> {
    if std::fs::read_to_string(path).ok().as_deref() == Some(contents) {
        return Ok(());
    }
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("tmp");
    std::fs::write(&tmp, contents)?;
    std::fs::rename(tmp, path)
}

/// What the npx-installed background Sync leaves for this home: its systemd user unit or its
/// autostart entry (service.ts `linuxLoginItems`), or files of the first background Sync.
pub fn legacy_present(paths: &Paths) -> bool {
    let name = if paths.is_default { "tinkjam-sync".to_string() } else { format!("tinkjam-sync-{}", home_suffix(&paths.base)) };
    let config = config::config_home();
    config.join("systemd/user").join(format!("{name}.service")).exists()
        || config.join("autostart").join(format!("{name}.desktop")).exists()
        || ["sync-service.pid", "sync-service.json"].iter().any(|f| paths.base.join(f).exists())
}

/// The Sync package's suffix for a home other than the default (service.ts serviceNames).
pub fn home_suffix(base: &Path) -> String {
    let name = base.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let mut suffix = String::new();
    for c in name.chars() {
        if c.is_ascii_lowercase() || c.is_ascii_digit() {
            suffix.push(c);
        } else if !suffix.ends_with('-') {
            suffix.push('-');
        }
    }
    let trimmed = suffix.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "custom".into()
    } else {
        trimmed
    }
}

/// An AppImage opened from Downloads copies itself to `appimage_target()`, adds itself to the app
/// menu and starts from there, so it has one stable place. Returns the copy to run instead.
pub fn integrate_appimage() -> Option<PathBuf> {
    let running = PathBuf::from(std::env::var_os("APPIMAGE")?);
    let target = appimage_target();
    let result = (|| -> std::io::Result<()> {
        if !config::same_path(&running, &target) {
            std::fs::create_dir_all(appimage_home())?;
            let tmp = target.with_extension("AppImage.new");
            std::fs::copy(&running, &tmp)?;
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
            std::fs::rename(&tmp, &target)?;
        }
        write_menu_entry(&target)
    })();
    match result {
        Ok(()) if !config::same_path(&running, &target) => Some(target),
        Ok(()) => None,
        Err(error) => {
            crate::log::app(format!("Could not add Tinkjam Sync to the app menu: {error}"));
            None
        }
    }
}

fn write_menu_entry(target: &Path) -> std::io::Result<()> {
    let data = config::data_home();
    // Icons come from inside the running AppImage.
    if let Some(appdir) = std::env::var_os("APPDIR").map(PathBuf::from) {
        let source = appdir.join("usr/share/icons/hicolor");
        for size in ["16x16", "22x22", "24x24", "32x32", "48x48", "64x64", "128x128", "256x256", "512x512", "scalable", "symbolic"] {
            let dir = source.join(size).join("apps");
            if let Ok(entries) = std::fs::read_dir(&dir) {
                for entry in entries.flatten() {
                    let destination = data.join("icons/hicolor").join(size).join("apps").join(entry.file_name());
                    if let Some(parent) = destination.parent() {
                        std::fs::create_dir_all(parent)?;
                    }
                    std::fs::copy(entry.path(), destination)?;
                }
            }
        }
    }
    let entry = format!(
        "[Desktop Entry]\nType=Application\nName=Tinkjam Sync\nComment=Connects the agents on this computer to Tinkjam\nExec={}\nIcon={}\nTerminal=false\nCategories=Network;Utility;\nStartupWMClass={}\nX-AppImage-Integrate=false\n",
        exec_quote(&target.to_string_lossy()),
        config::APP_ID,
        config::APP_ID
    );
    write_if_changed(&data.join("applications").join(MENU_FILE), &entry)
}

/// The way out of `integrate_appimage`: the copy, its menu entry, icons and login item. The
/// connection and `~/.tinkjam` stay, as on Mac and Windows.
pub fn uninstall_appimage() {
    let data = config::data_home();
    let _ = std::fs::remove_file(autostart_path());
    let _ = std::fs::remove_file(data.join("applications").join(MENU_FILE));
    for size in ["16x16", "22x22", "24x24", "32x32", "48x48", "64x64", "128x128", "256x256", "512x512", "scalable", "symbolic"] {
        for name in ["org.tinkjam.Sync.png", "org.tinkjam.Sync.svg", "org.tinkjam.Sync-symbolic.svg"] {
            let _ = std::fs::remove_file(data.join("icons/hicolor").join(size).join("apps").join(name));
        }
    }
    let _ = std::fs::remove_dir_all(appimage_home());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn suffixes_match_the_package() {
        assert_eq!(home_suffix(Path::new("/tmp/My Test_Home")), "my-test-home");
        assert_eq!(home_suffix(Path::new("/tmp/---")), "custom");
    }

    #[test]
    fn exec_arguments_are_quoted() {
        assert_eq!(exec_quote("/usr/bin/tinkjam-sync"), "/usr/bin/tinkjam-sync");
        assert_eq!(exec_quote("/home/a b/x.AppImage"), "\"/home/a b/x.AppImage\"");
        assert_eq!(exec_quote("/x/$y%"), "\"/x/\\\\$y%%\"");
    }
}
