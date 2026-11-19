#!/bin/bash
# Builds Tinkjam Sync for Mac into dist/: the .app, Tinkjam-Sync.dmg, Tinkjam-Sync-mac.zip, their
# .sha256 files, mac.json (what installed copies check for updates) and install.sh.
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
# TINKJAM_DOWNLOAD_BASE (default https://trellium.org/downloads).
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
rm -rf "$work" "$dist/Tinkjam Sync.app" "$zip" "$dmg" "$zip.sha256" "$dmg.sha256" "$dist/mac.json"
mkdir -p "$work"

step() { printf '\n==> %s\n' "$*"; }

step "Building $version ($build_number) for $archs"
arch_flags=()
for arch in $archs; do arch_flags+=(--arch "$arch"); done
swift build -c release "${arch_flags[@]}" 2>&1 | grep -v "x86_64 architecture is deprecated" || true
binary="$(swift build -c release "${arch_flags[@]}" --show-bin-path)/TinkjamSync"
[ -x "$binary" ] || { echo "Build failed: no $binary" >&2; exit 1; }
lipo -archs "$binary"

step "Assembling the app bundle"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$binary" "$app/Contents/MacOS/TinkjamSync"
sed -e "s/__VERSION__/$version/" -e "s/__BUILD__/$build_number/" Resources/Info.plist > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist" >/dev/null
printf 'APPL????' > "$app/Contents/PkgInfo"

step "Drawing the icon"
# Top-level code must be in main.swift when swiftc compiles more than one file.
cp scripts/make-icons.swift "$work/main.swift"
swiftc -O -o "$work/make-icons" "$work/main.swift" Sources/TinkjamSync/Icons.swift
"$work/make-icons" "$work/AppIcon.iconset"
if command -v iconutil >/dev/null; then
  iconutil -c icns "$work/AppIcon.iconset" -o "$app/Contents/Resources/AppIcon.icns"
else
  # Without iconutil the 1024 px PNG still gives Finder an icon (no smaller sizes).
  echo "iconutil is missing; using a PNG app icon instead of .icns" >&2
  cp "$work/AppIcon.iconset/icon_512x512@2x.png" "$app/Contents/Resources/AppIcon.png"
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
stage="$work/dmg"
mkdir -p "$stage"
ditto "$app" "$stage/Tinkjam Sync.app"
ln -s /Applications "$stage/Applications"
hdiutil create -quiet -volname "Tinkjam Sync" -srcfolder "$stage" -fs HFS+ -format UDZO -imagekey zlib-level=9 -ov "$dmg"
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
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -u "$app" 2>/dev/null || true
rm -rf "$work"

step "Done"
ls -l "$dist" | sed 1d
cat "$dist"/*.sha256
