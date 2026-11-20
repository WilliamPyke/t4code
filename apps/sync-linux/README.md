# Tinkjam Sync for Linux

The Linux sibling of `apps/sync-mac` and `apps/sync-windows`: a desktop app that sets up, runs and
updates Tinkjam Sync, so nobody needs a terminal or Node.js. One Rust program, no webview.

- **Engine** (`src/engine.rs`), the same steps as the Mac and Windows apps: downloads Node.js
  (pinned version and SHA-256 in `src/config.rs`) into `~/.tinkjam/runtime`, unpacks the
  published Sync package (`https://tinkjam.com/sync.json`, else the same file on trellium.org)
  into `~/.tinkjam/app/node_modules/tinkjam-sync` after checking its SHA-256 and the release
  signature (`src/signature.rs`, a port of `ReleaseSignature.swift`/`.cs`), installs exactly its
  `npm-shrinkwrap.json` with `npm ci --ignore-scripts` plus the two native rebuilds, and runs
  `sync --app` as its child. Sync's stdin is a pipe the app holds, so Sync never outlives it.
- It replaces an `npx … --install` setup by running the package's own `--uninstall` from a staged
  copy, as the Windows app does. Its own login item is `~/.config/autostart/tinkjam-sync-app.desktop`,
  a name the package's sweep leaves alone.
- Crashes restart after 2, 4, 8, 16 seconds; the fifth in ten minutes stops it, and it tries again
  in 15 minutes (one minute when the cause was the network) and after the computer wakes.
- It checks `sync.json` and `downloads/linux.json` 15 seconds after start and hourly. A newer Sync
  installs by itself when no agent is running. A newer app: the AppImage replaces itself (once
  by itself per version, otherwise "Restart to update" in the panel); a .deb or .rpm install
  only offers the download, since its package manager owns `/usr/bin`.
- **Windows** (`src/gui/`), drawn with egui after the Doop frames `_OiiOCDH14` and `rv8Wt6cVnY`:
  the first-run window and the panel, light and dark following the desktop's colour scheme (the
  XDG portal, else GNOME's setting). Each window is its own short-lived process that talks to the
  running copy over a Unix socket in `$XDG_RUNTIME_DIR`, so windows open and close cleanly on
  Wayland, and the background copy holds no GPU context.
- **Tray**: a StatusNotifierItem (KDE; GNOME with the AppIndicator extension, which Ubuntu ships).
  A click opens the panel. Where there is no tray, launching the app from the menu opens the same
  panel as a normal window; the app retries the tray every minute.
- **Headless build** (`tinkjam-sync-cli`, built without the `gui` feature): the same engine for
  servers. In a terminal it prints the approval link; `enable-service` writes a systemd user unit.

Fonts (Outfit SemiBold, Instrument Sans; OFL texts in `assets/fonts/`) and the art are embedded in
the binary. Agent logos come from `apps/marketing/public/agents/`.

## Build

Run on Linux (WSL works). Nothing needs root; the tools live in `$TOOLS`
(default `~/tinkjam-linux-build/tools`):

```sh
# once
curl -fsSL https://ziglang.org/download/0.14.1/zig-x86_64-linux-0.14.1.tar.xz | tar -xJ -C "$TOOLS" && mv "$TOOLS"/zig-x86_64-linux-0.14.1 "$TOOLS/zig"
cargo install --root "$TOOLS" cargo-zigbuild cargo-generate-rpm
rustup target add x86_64-unknown-linux-musl
curl -fsSLo "$TOOLS/appimagetool" https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage && chmod +x "$TOOLS/appimagetool"
curl -fsSLo "$TOOLS/runtime-x86_64" https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64

# each release (version from Cargo.toml; the build stamp is the UTC time)
OUT=/some/folder CARGO_TARGET_DIR=~/tinkjam-linux-build/target apps/sync-linux/scripts/build.sh
```

It runs the tests, then writes `tinkjam-sync-v<version>-linux-x86_64.{AppImage,deb,rpm}`,
`tinkjam-sync-cli-v<version>-linux-x86_64.tar.gz`, `checksums.txt` and an **unsigned**
`linux.json`. The desktop app links against glibc 2.31 (cargo-zigbuild), so it runs on
distributions older than the build machine; the CLI is a static musl binary. dpkg-deb comes with
Debian and Ubuntu. `scripts/make-icons.sh` re-renders the committed PNGs after an SVG changes.

While working on it: `cargo test`, `cargo build`, and `cargo build --no-default-features` for the CLI.

## Publish

Installed copies refuse a `linux.json` the release key did not sign. On the release PC:
`node scripts/sign-release.ts sign <path to linux.json>` (then `verify`). Upload the release files,
`checksums.txt` and `linux.json` to `/downloads/` on the site. `linux.json` names the AppImage on
trellium.org, which every installed copy reaches. `tinkjam-sync verify linux <file or URL>`
checks a manifest the way installed copies do.

## Testing without touching the real setup

- `--base-dir <dir>` or `TINKJAM_SYNC_HOME`: a throwaway home. Such a copy never writes the login
  item or the app-menu entry. A temporary `HOME` and `XDG_*` folders isolate everything else.
- `TINKJAM_SYNC_MANIFEST_URL`, `TINKJAM_APP_MANIFEST_URL`, `TINKJAM_SYNC_PACKAGE_URL`,
  `TINKJAM_HOSTED_APP_URL`, `TINKJAM_NODE_DIST_URL`: point at a local server (plain http only on
  127.0.0.1).
- `TINKJAM_SYNC_NO_BROWSER=1`: never opens the browser; the approval link is only logged. Use it
  to stop at the point a real approval would begin.
- Windows: `tinkjam-sync --window setup|panel|home` with `TINKJAM_SYNC_FAKE_VIEW=<view.json>`
  draws a given state with no running copy; `TINKJAM_SYNC_THEME=dark|light` forces the scheme,
  `TINKJAM_SYNC_FAKE_UI=settings|confirm` opens those views, and
  `TINKJAM_SYNC_SCREENSHOT=<file.png>` saves the window and closes it.
- `tinkjam-sync status | connect | disconnect | check-for-updates | quit` ask the running copy.

WSL notes: WSLg's compositor (Weston) crashes when a Wayland client resizes its window, which these
windows do as their content changes; test there over X11 (`unset WAYLAND_DISPLAY`, with
`libxkbcommon-x11` available). There is no tray host in WSL; a stand-in watcher on the session bus
shows the tray item registering.

Everything the app and Sync say goes to `~/.tinkjam/logs/sync.log` (panel: Settings, Show
technical log).

## Uninstall

Disconnect this computer first (panel: Settings, Disconnect this computer…). Then: an AppImage
install removes itself from Settings (Remove Tinkjam Sync from this computer…); a .deb or .rpm
is removed with the package manager. `~/.tinkjam` stays, as on Mac and Windows.
