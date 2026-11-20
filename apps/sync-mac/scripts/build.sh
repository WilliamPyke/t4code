#!/bin/bash
# Builds Tinkjam Sync for Mac into dist/: the .app, Tinkjam-Sync.dmg, Tinkjam-Sync-mac.zip, their
# .sha256 files, mac.json (what installed copies check for updates) and install.sh, plus the same
# zip and disk image under their release names (tinkjam-sync-v<version>-macos-aarch64.app.zip and
# .dmg) with checksums.txt.
#
#   apps/sync-mac/scripts/build.sh               ad-hoc signed, for testing and curl installs
#   TINKJAM_SIGN_IDENTITY="Developer ID Application: … (TEAMID)" \
#   TINKJAM_NOTARY_PROFILE=tinkjam-notary \
#   apps/sync-mac/scripts/build.sh               signed, notarized and stapled for browser downloads
#
# The notary profile is made once with:
#   xcrun notarytool store-credentials tinkjam-notary --apple-id <id> --team-id <TEAMID> --password <app-specific password>
#
# Options (environment): TINKJAM_VERSION (default: ../VERSION), TINKJAM_ARCHS ("arm64 x86_64"),
# TINKJAM_DMG_THEME (light or dark: the disk image's background, default light),
# TINKJAM_DOWNLOAD_BASE (default https://trellium.org/downloads: the signed mac.json names its zip
# there, which every installed copy and allowlisted network reaches; tinkjam.com serves it too).
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
cd "$here"
version="${TINKJAM_VERSION:-$(tr -d '[:space:]' < VERSION)}"
build_number="$(date -u +%Y%m%d%H%M)"
archs="${TINKJAM_ARCHS:-arm64 x86_64}"
download_base="${TINKJAM_DOWNLOAD_BASE:-https://trellium.org/downloads}"
identity="${TINKJAM_SIGN_IDENTITY:-}"
notary_profile="${TINKJAM_NOTARY_PROFILE:-}"
max_bytes=$((25 * 1024 * 1024))   # served as static files with this limit

dist="$here/dist"
work="$dist/.work"
# The bundle is assembled outside dist/ and removed at the end: a stray copy of the app would
# be one LaunchServices could open for tinkjam-sync:// links.
app="$work/Tinkjam Sync.app"
zip="$dist/Tinkjam-Sync-mac.zip"
dmg="$dist/Tinkjam-Sync.dmg"
rm -rf "$work" "$dist/Tinkjam Sync.app" "$zip" "$dmg" "$zip.sha256" "$dmg.sha256" "$dist/mac.json" \
  "$dist"/tinkjam-sync-v*-macos-* "$dist/checksums.txt"
mkdir -p "$work"

step() { printf '\n==> %s\n' "$*"; }

step "Building $version ($build_number) for $archs"
arch_flags=()
for arch in $archs; do arch_flags+=(--arch "$arch"); done
swift build -c release "${arch_flags[@]}"
binary="$(swift build -c release "${arch_flags[@]}" --show-bin-path)/TinkjamSync"
[ -x "$binary" ] || { echo "Build failed: no $binary" >&2; exit 1; }
lipo -archs "$binary"

step "Assembling the app bundle"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/TinkjamSync"
sed -e "s/__VERSION__/$version/" -e "s/__BUILD__/$build_number/" Resources/Info.plist > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist" >/dev/null
printf 'APPL????' > "$app/Contents/PkgInfo"

step "Fonts, pictures and the icon"
# Outfit (OFL, licence beside it) is registered at launch; the pictures keep their @2x pairs.
ditto Resources/Fonts "$app/Contents/Resources/Fonts"
cp Resources/Images/* "$app/Contents/Resources/"
# The icon's PNGs are rendered ahead of time (16 to 1024 px) into Resources/AppIcon.iconset.
[ -f Resources/AppIcon.iconset/icon_512x512@2x.png ] || { echo "Resources/AppIcon.iconset is incomplete" >&2; exit 1; }
if command -v iconutil >/dev/null; then
  iconutil -c icns Resources/AppIcon.iconset -o "$app/Contents/Resources/AppIcon.icns"
else
  # Without iconutil the 1024 px PNG still gives Finder an icon (no smaller sizes).
  echo "iconutil is missing; using a PNG app icon instead of .icns" >&2
  cp Resources/AppIcon.iconset/icon_512x512@2x.png "$app/Contents/Resources/AppIcon.png"
  /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile AppIcon.png" "$app/Contents/Info.plist"
fi

step "Signing"
if [ -n "$identity" ]; then
  codesign --force --timestamp --options runtime --sign "$identity" "$app"
else
  echo "TINKJAM_SIGN_IDENTITY is not set: signing ad hoc. Browser downloads will be blocked by"
  echo "Gatekeeper until a Developer ID build is notarized; install.sh (curl) works either way."
  codesign --force --options runtime --sign - "$app"
fi
codesign --verify --deep --strict --verbose=1 "$app"

notarize() {   # notarize <file to submit>
  xcrun notarytool submit "$1" --keychain-profile "$notary_profile" --wait --timeout 30m
}

step "Zip"
ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
if [ -n "$identity" ] && [ -n "$notary_profile" ]; then
  step "Notarizing the app (this waits for Apple)"
  notarize "$zip"
  xcrun stapler staple "$app"
  xcrun stapler validate "$app"
  rm -f "$zip"
  ditto -c -k --sequesterRsrc --keepParent "$app" "$zip"
else
  echo "Not notarizing: set both TINKJAM_SIGN_IDENTITY and TINKJAM_NOTARY_PROFILE to notarize."
fi

step "Disk image"
# A read-write image is laid out by Finder (window size, background, icon positions, kept in its
# .DS_Store), then compressed. Finder must be allowed to be controlled by this terminal (System
# Settings > Privacy & Security > Automation); without it the layout step fails and the build stops.
dmg_theme="${TINKJAM_DMG_THEME:-light}"
case "$dmg_theme" in light|dark) ;; *) echo "TINKJAM_DMG_THEME must be light or dark" >&2; exit 1 ;; esac
volume="Tinkjam Sync"
if [ -e "/Volumes/$volume" ]; then
  echo "/Volumes/$volume is already mounted; eject it first, so Finder lays out the right disk" >&2
  exit 1
fi
stage="$work/dmg"
mkdir -p "$stage/.background"
ditto "$app" "$stage/Tinkjam Sync.app"
ln -s /Applications "$stage/Applications"
tiffutil -cathidpicheck "Resources/DiskImage/background-$dmg_theme.png" \
  "Resources/DiskImage/background-$dmg_theme@2x.png" -out "$stage/.background/background.tiff"
[ -f "$app/Contents/Resources/AppIcon.icns" ] && cp "$app/Contents/Resources/AppIcon.icns" "$stage/.VolumeIcon.icns"
rw="$work/layout.dmg"
# Room beyond the files, for the .DS_Store Finder writes.
size_mb=$(( $(du -sm "$stage" | cut -f1) + 20 ))
hdiutil create -quiet -volname "$volume" -srcfolder "$stage" -fs HFS+ -format UDRW -size "${size_mb}m" -ov "$rw"
attached="$(hdiutil attach -readwrite -noverify -noautoopen "$rw")"
device="$(printf '%s\n' "$attached" | awk '/Apple_HFS/ {print $1; exit}')"
mount="$(printf '%s\n' "$attached" | awk -F '\t' '/\/Volumes\// {print $NF; exit}')"
[ -n "$device" ] && [ "$mount" = "/Volumes/$volume" ] || {
  echo "Could not mount the layout image where expected:" >&2; printf '%s\n' "$attached" >&2
  [ -n "$device" ] && hdiutil detach -force "$device" >/dev/null 2>&1
  exit 1
}
detach_layout() {
  for attempt in 1 2 3 4 5; do
    hdiutil detach "$device" >/dev/null 2>&1 && return 0
    sleep 2
  done
  hdiutil detach -force "$device"
}
# The window is 600 x 360 points of content (the background's size) plus the title bar; the icons'
# centres sit either side of the background's arrow. perl's alarm stops a Finder that never answers.
if ! perl -e 'alarm shift; exec @ARGV' 180 osascript - "$volume" <<'APPLESCRIPT'
on run argv
  set volumeName to item 1 of argv
  tell application "Finder"
    tell disk volumeName
      open
      set current view of container window to icon view
      set toolbar visible of container window to false
      set statusbar visible of container window to false
      set the bounds of container window to {200, 120, 800, 508}
      set viewOptions to the icon view options of container window
      set arrangement of viewOptions to not arranged
      set icon size of viewOptions to 112
      set text size of viewOptions to 13
      set background picture of viewOptions to file ".background:background.tiff"
      set position of item "Tinkjam Sync.app" of container window to {160, 180}
      set position of item "Applications" of container window to {440, 180}
      close
      open
      update without registering applications
      delay 2
      close
    end tell
  end tell
end run
APPLESCRIPT
then
  echo "Finder could not lay out the disk image (allow this terminal to control Finder, then build again)" >&2
  detach_layout
  exit 1
fi
sync
[ -f "$mount/.DS_Store" ] || { echo "Finder did not save the disk image's layout (.DS_Store is missing)" >&2; detach_layout; exit 1; }
if command -v SetFile >/dev/null && [ -f "$mount/.VolumeIcon.icns" ]; then
  SetFile -a C "$mount"
fi
detach_layout
hdiutil convert -quiet "$rw" -format UDZO -imagekey zlib-level=9 -ov -o "$dmg"
rm -f "$rw"
if [ -n "$identity" ]; then
  codesign --force --timestamp --sign "$identity" "$dmg"
  if [ -n "$notary_profile" ]; then
    step "Notarizing the disk image"
    notarize "$dmg"
    xcrun stapler staple "$dmg"
    xcrun stapler validate "$dmg"
  fi
fi

step "Checksums, mac.json and install.sh"
for file in "$zip" "$dmg"; do
  size=$(stat -f %z "$file")
  [ "$size" -lt "$max_bytes" ] || { echo "$(basename "$file") is $size bytes, over the 25 MB limit" >&2; exit 1; }
  (cd "$dist" && shasum -a 256 "$(basename "$file")" > "$(basename "$file").sha256")
done
zip_sha="$(cut -d' ' -f1 < "$zip.sha256")"
cat > "$dist/mac.json" <<JSON
{
  "version": "$version",
  "build": "$build_number",
  "url": "$download_base/Tinkjam-Sync-mac.zip",
  "sha256": "$zip_sha",
  "minimumSystemVersion": "13.0"
}
JSON
# Installed copies refuse an unsigned mac.json. The release key normally stays on the release PC,
# which signs this file there: node scripts/sign-release.ts sign apps/sync-mac/dist/mac.json
release_key="${TINKJAM_RELEASE_KEY:-$HOME/.tinkjam-release/release-key.pem}"
if [ -f "$release_key" ]; then
  node "$here/../../scripts/sign-release.ts" sign "$dist/mac.json"
else
  echo "mac.json is NOT signed (no release key at $release_key). Sign it on the release PC before publishing:"
  echo "  node scripts/sign-release.ts sign apps/sync-mac/dist/mac.json && node scripts/sign-release.ts verify apps/sync-mac/dist/mac.json"
fi
cp scripts/install.sh "$dist/install.sh"
chmod +x "$dist/install.sh"

step "Release names"
# The same files under the release naming, beside the names installed copies and install.sh use.
case " $archs " in *" arm64 "*) release_arch=aarch64 ;; *) release_arch=x86_64 ;; esac
release_zip="tinkjam-sync-v$version-macos-$release_arch.app.zip"
release_dmg="tinkjam-sync-v$version-macos-$release_arch.dmg"
cp "$zip" "$dist/$release_zip"
cp "$dmg" "$dist/$release_dmg"
(cd "$dist" && shasum -a 256 "$release_zip" "$release_dmg" > checksums.txt)
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$app" 2>/dev/null || true
rm -rf "$work"

step "Done"
ls -l "$dist" | sed 1d
cat "$dist"/*.sha256 "$dist/checksums.txt"
