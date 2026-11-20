#!/bin/bash
# Builds the Linux release files of Tinkjam Sync into dist/ (or $OUT):
#
#   tinkjam-sync-v<version>-linux-x86_64.AppImage   the desktop app, any distro
#   tinkjam-sync-v<version>-linux-x86_64.deb        the desktop app for Debian and Ubuntu
#   tinkjam-sync-v<version>-linux-x86_64.rpm        the desktop app for Fedora and openSUSE
#   tinkjam-sync-cli-v<version>-linux-x86_64.tar.gz the headless build for servers (static)
#   checksums.txt                                   SHA-256 of the four, in sha256sum format
#   linux.json                                      the update manifest, UNSIGNED
#
# linux.json must be signed before it is published (node scripts/sign-release.ts sign
# dist/linux.json); installed copies refuse it unsigned. This script never touches the key.
#
# Needs, on PATH or in $TOOLS (see README): cargo, zig + cargo-zigbuild (to link against glibc
# 2.31, so the app runs on distributions older than the build machine), cargo-generate-rpm,
# appimagetool and its type2 runtime file, dpkg-deb. No root.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
out="${OUT:-$here/dist}"
tools="${TOOLS:-$HOME/tinkjam-linux-build/tools}"
export PATH="$tools/bin:$tools/zig:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$here/target}"
downloads="${DOWNLOAD_BASE:-https://trellium.org/downloads}"
glibc="${GLIBC_FLOOR:-2.31}"
jobs="${JOBS:-2}"

version="$(sed -n 's/^version = "\(.*\)"/\1/p' "$here/Cargo.toml" | head -1)"
build="$(date -u +%Y%m%d%H%M)"
export TINKJAM_BUILD="$build"
stem="tinkjam-sync-v$version-linux-x86_64"
cli_stem="tinkjam-sync-cli-v$version-linux-x86_64"

need() { command -v "$1" >/dev/null || { echo "build.sh: $1 is missing (see README)" >&2; exit 1; }; }
for tool in cargo zig cargo-zigbuild cargo-generate-rpm dpkg-deb sha256sum; do need "$tool"; done
appimagetool="${APPIMAGETOOL:-$tools/appimagetool}"
runtime="${APPIMAGE_RUNTIME:-$tools/runtime-x86_64}"
[ -x "$appimagetool" ] && [ -f "$runtime" ] || { echo "build.sh: appimagetool or its runtime is missing (see README)" >&2; exit 1; }

cd "$here"
echo "Tinkjam Sync for Linux $version ($build)"
cargo test -j "$jobs" --quiet
cargo zigbuild -j "$jobs" --release --target "x86_64-unknown-linux-gnu.$glibc"
cargo zigbuild -j "$jobs" --release --no-default-features --target x86_64-unknown-linux-musl
app="$CARGO_TARGET_DIR/x86_64-unknown-linux-gnu/release/tinkjam-sync"
cli="$CARGO_TARGET_DIR/x86_64-unknown-linux-musl/release/tinkjam-sync"
"$app" --version
"$cli" --version

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
rm -rf "$out"
mkdir -p "$out"

# The files every desktop package carries, under a prefix.
install_tree() {
  local root="$1"
  install -Dm755 "$app" "$root/usr/bin/tinkjam-sync"
  install -Dm644 packaging/org.tinkjam.Sync.desktop "$root/usr/share/applications/org.tinkjam.Sync.desktop"
  install -Dm644 packaging/org.tinkjam.Sync.metainfo.xml "$root/usr/share/metainfo/org.tinkjam.Sync.metainfo.xml"
  (cd assets/icons/hicolor && find . -type f) | while read -r icon; do
    install -Dm644 "assets/icons/hicolor/$icon" "$root/usr/share/icons/hicolor/$icon"
  done
  install -Dm644 assets/fonts/OFL-Outfit.txt "$root/usr/share/doc/tinkjam-sync/OFL-Outfit.txt"
  install -Dm644 assets/fonts/OFL-InstrumentSans.txt "$root/usr/share/doc/tinkjam-sync/OFL-InstrumentSans.txt"
}

# AppImage
appdir="$work/AppDir"
install_tree "$appdir"
ln -s usr/bin/tinkjam-sync "$appdir/AppRun"
cp packaging/org.tinkjam.Sync.desktop "$appdir/org.tinkjam.Sync.desktop"
cp assets/icons/hicolor/256x256/apps/org.tinkjam.Sync.png "$appdir/org.tinkjam.Sync.png"
ln -s org.tinkjam.Sync.png "$appdir/.DirIcon"
ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$appimagetool" --no-appstream --runtime-file "$runtime" "$appdir" "$out/$stem.AppImage" >"$work/appimagetool.log" 2>&1 \
  || { cat "$work/appimagetool.log"; exit 1; }
chmod 755 "$out/$stem.AppImage"

# .deb
deb="$work/deb"
install_tree "$deb"
install -Dm644 /dev/stdin "$deb/usr/share/doc/tinkjam-sync/copyright" <<EOF
Tinkjam Sync for Linux. Copyright Tinkjam. MIT licence.
Embeds the Outfit and Instrument Sans fonts under the SIL Open Font License 1.1 (OFL-*.txt beside this file).
EOF
mkdir -p "$deb/DEBIAN"
cat >"$deb/DEBIAN/control" <<EOF
Package: tinkjam-sync
Version: $version
Section: net
Priority: optional
Architecture: amd64
Maintainer: Tinkjam <hello@tinkjam.com>
Depends: libc6 (>= $glibc), libxkbcommon0, libxkbcommon-x11-0, libegl1, libwayland-client0, libx11-6, libxcursor1, libxrandr2, libxi6
Recommends: xdg-utils, libnotify-bin
Installed-Size: $(du -sk "$deb/usr" | cut -f1)
Homepage: https://tinkjam.com
Description: Connects the agents on this computer to your Tinkjam boards
 Tinkjam Sync lets your Tinkjam boards use the coding agents installed on this
 computer, such as Claude Code or Codex. They run here, on your own sign-in.
EOF
dpkg-deb --root-owner-group -Zxz --build "$deb" "$out/$stem.deb" >/dev/null

# .rpm, from a manifest made for it (cargo-generate-rpm reads Cargo.toml metadata)
rpm="$work/rpm"
mkdir -p "$rpm/src" "$rpm/files"
touch "$rpm/src/main.rs"
install_tree "$rpm/files"
{
  cat <<EOF
[package]
name = "tinkjam-sync"
version = "$version"
edition = "2021"
license = "MIT"
description = "Connects the agents on this computer to your Tinkjam boards"
homepage = "https://tinkjam.com"

[package.metadata.generate-rpm]
summary = "Connects the agents on this computer to your Tinkjam boards"
release = "1"
auto-req = "no"
assets = [
EOF
  (cd "$rpm/files" && find . -type f | sed 's|^\./||') | while read -r file; do
    mode=644; [ "$file" = usr/bin/tinkjam-sync ] && mode=755
    echo "  { source = \"$rpm/files/$file\", dest = \"/$file\", mode = \"$mode\" },"
  done
  cat <<'EOF'
]

[package.metadata.generate-rpm.requires]
"libxkbcommon.so.0()(64bit)" = "*"
"libxkbcommon-x11.so.0()(64bit)" = "*"
"libEGL.so.1()(64bit)" = "*"
"libwayland-client.so.0()(64bit)" = "*"
"libX11.so.6()(64bit)" = "*"
"libXcursor.so.1()(64bit)" = "*"
"libXrandr.so.2()(64bit)" = "*"
"libXi.so.6()(64bit)" = "*"

[package.metadata.generate-rpm.recommends]
xdg-utils = "*"
EOF
} >"$rpm/Cargo.toml"
cargo generate-rpm -p "$rpm" -o "$out/$stem.rpm"

# Headless build for servers
tarroot="$work/$cli_stem"
install -Dm755 "$cli" "$tarroot/tinkjam-sync-cli"
install -Dm644 packaging/tinkjam-sync-cli.service "$tarroot/tinkjam-sync-cli.service"
cat >"$tarroot/README.txt" <<'EOF'
Tinkjam Sync for Linux servers: the same engine as the desktop app, without windows.

1. Put tinkjam-sync-cli somewhere on your PATH, for example ~/.local/bin.
2. Run `tinkjam-sync-cli` in a terminal. It sets itself up and prints a link: open it in a browser
   on any device, sign in to Tinkjam and press Connect. Then stop it with Ctrl+C.
3. Run `tinkjam-sync-cli enable-service` to keep it running in the background (a systemd user
   unit; `loginctl enable-linger` keeps it running after you log out).

`tinkjam-sync-cli status` shows the state, `tinkjam-sync-cli disconnect` removes this computer
from your account, `tinkjam-sync-cli disable-service` stops the background copy.
It keeps the Sync package up to date by itself; a newer tinkjam-sync-cli itself is announced in
its log and in `status`, and is installed by downloading it again.
EOF
tar -C "$work" --owner=0 --group=0 -czf "$out/$cli_stem.tar.gz" "$cli_stem"

# Checksums and the update manifest
(cd "$out" && sha256sum "$stem.AppImage" "$stem.deb" "$stem.rpm" "$cli_stem.tar.gz" >checksums.txt)
appimage_sha="$(sha256sum "$out/$stem.AppImage" | cut -d' ' -f1)"
cat >"$out/linux.json" <<EOF
{
  "version": "$version",
  "build": "$build",
  "url": "$downloads/$stem.AppImage",
  "sha256": "$appimage_sha"
}
EOF

for file in "$out"/*; do
  size=$(stat -c %s "$file")
  [ "$size" -le $((25 * 1024 * 1024)) ] || { echo "build.sh: $(basename "$file") is over the 25 MB a static file may be" >&2; exit 1; }
done
ls -la "$out"
cat "$out/checksums.txt"
echo "linux.json is NOT signed. Sign it with: node scripts/sign-release.ts sign $out/linux.json"
