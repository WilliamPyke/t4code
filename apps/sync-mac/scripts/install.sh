#!/bin/bash
# Installs Tinkjam Sync for Mac, or brings an older copy up to date, and opens it. Safe to run
# again. For people and agents who prefer a terminal:
#
#   curl -fsSL https://tinkjam.com/downloads/install.sh | bash
#
# It downloads the app, checks it against its published SHA-256, puts it in /Applications (or
# ~/Applications when /Applications is not writable), quits a running copy first and opens the
# new one. The app then sets up and runs Tinkjam Sync itself, and replaces an older
# `npx … --install` setup. Needs no sudo, no Node.js and no Xcode.
set -euo pipefail

base="${TINKJAM_DOWNLOAD_BASE:-https://tinkjam.com/downloads}"
name="Tinkjam Sync.app"
bundle_id="org.trellium.tinkjam-sync-app"

say() { printf 'Tinkjam Sync: %s\n' "$*"; }
fail() { printf 'Tinkjam Sync: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "this installer is for macOS. On Windows, download and open https://tinkjam.com/downloads/TinkjamSyncSetup.exe. On Linux, use: npx -y https://tinkjam.com/sync.tgz --install"
arch="$(uname -m)"
case "$arch" in
  arm64 | x86_64) ;;
  *) fail "unsupported processor: $arch" ;;
esac
major="$(sw_vers -productVersion | cut -d. -f1)"
[ "$major" -ge 13 ] || fail "needs macOS 13 or newer; this Mac has $(sw_vers -productVersion)."

if [ -w /Applications ]; then dir=/Applications; else dir="$HOME/Applications"; mkdir -p "$dir"; fi
dest="$dir/$name"

work="$(mktemp -d "${TMPDIR:-/tmp}/tinkjam-sync-install.XXXXXX")"
trap 'rm -rf "$work"' EXIT

say "downloading for $arch from $base"
curl -fsSL --retry 3 -o "$work/app.zip" "$base/Tinkjam-Sync-mac.zip" || fail "could not download $base/Tinkjam-Sync-mac.zip"
expected="$(curl -fsSL --retry 3 "$base/Tinkjam-Sync-mac.zip.sha256" | awk '{print $1}')" || fail "could not download the checksum"
actual="$(shasum -a 256 "$work/app.zip" | awk '{print $1}')"
[ -n "$expected" ] && [ "$expected" = "$actual" ] || fail "the download does not match its checksum (expected $expected, got $actual). Nothing was installed."

ditto -x -k "$work/app.zip" "$work/unpacked"
new="$work/unpacked/$name"
[ "$(defaults read "$new/Contents/Info.plist" CFBundleIdentifier 2>/dev/null)" = "$bundle_id" ] || fail "the download is not Tinkjam Sync. Nothing was installed."
codesign --verify --deep --strict "$new" 2>/dev/null || fail "the app's signature is broken. Nothing was installed."
new_version="$(defaults read "$new/Contents/Info.plist" CFBundleShortVersionString) ($(defaults read "$new/Contents/Info.plist" CFBundleVersion))"

version_of() { [ -d "$1" ] && echo "$(defaults read "$1/Contents/Info.plist" CFBundleShortVersionString 2>/dev/null) ($(defaults read "$1/Contents/Info.plist" CFBundleVersion 2>/dev/null))"; }

# Running copies of this app only: the process whose executable is inside a Tinkjam Sync.app.
running_pids() {
  for pid in $(pgrep -x TinkjamSync 2>/dev/null || true); do
    case "$(ps -o comm= -p "$pid" 2>/dev/null)" in
      *"/Tinkjam Sync.app/Contents/MacOS/TinkjamSync") echo "$pid" ;;
    esac
  done
}

quit_running() {
  local pids
  pids="$(running_pids)"
  [ -n "$pids" ] || return 0
  say "quitting the running copy so it can be replaced (it stops Sync first)"
  # SIGTERM is the app's own Quit: it stops Tinkjam Sync and its helper, then exits.
  kill -TERM $pids 2>/dev/null || true
  for _ in $(seq 1 60); do
    [ -z "$(running_pids)" ] && return 0
    sleep 0.5
  done
  fail "the running Tinkjam Sync did not quit. Quit it from its menu bar icon and run this again."
}

current="$(version_of "$dest" || true)"
if [ "$current" = "$new_version" ]; then
  say "version $new_version is already installed in $dir"
else
  quit_running
  # One copy only: an older one in the other Applications folder goes too.
  for other in "/Applications/$name" "$HOME/Applications/$name"; do
    if [ "$other" != "$dest" ] && [ -d "$other" ] && [ "$(defaults read "$other/Contents/Info.plist" CFBundleIdentifier 2>/dev/null)" = "$bundle_id" ]; then
      rm -rf "$other" && say "removed the older copy in $(dirname "$other")"
    fi
  done
  rm -rf "$dest.installing"
  ditto "$new" "$dest.installing"
  rm -rf "$dest"
  mv "$dest.installing" "$dest"
  say "installed version $new_version in $dir${current:+ (was $current)}"
fi

open "$dest"
say "opened. Look for its icon in the menu bar; if this Mac is not connected yet, approve it in the browser page that opens."
