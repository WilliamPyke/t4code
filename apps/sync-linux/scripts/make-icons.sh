#!/bin/bash
# Renders the PNGs in assets/ from their SVGs. Run it after changing an SVG; the PNGs are committed
# so a normal build needs no SVG renderer. Needs `resvg` (cargo install resvg) on PATH or in $RESVG.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
resvg="${RESVG:-resvg}"
icons="$here/assets/icons"
for size in 16 22 24 32 48 64 128 256 512; do
  mkdir -p "$icons/hicolor/${size}x${size}/apps"
  "$resvg" -w "$size" -h "$size" "$icons/org.tinkjam.Sync.svg" "$icons/hicolor/${size}x${size}/apps/org.tinkjam.Sync.png"
done
mkdir -p "$icons/hicolor/scalable/apps" "$icons/hicolor/symbolic/apps"
cp "$icons/org.tinkjam.Sync.svg" "$icons/hicolor/scalable/apps/"
cp "$icons/org.tinkjam.Sync-symbolic.svg" "$icons/hicolor/symbolic/apps/"
# Tray pixmaps (StatusNotifierItem hosts pick the closest size) and the window mark.
mkdir -p "$icons/tray"
for state in connected idle attention; do
  source="$icons/tray-$state.svg"
  [ "$state" = connected ] && source="$icons/org.tinkjam.Sync.svg"
  for size in 22 32 48 64; do "$resvg" -w "$size" -h "$size" "$source" "$icons/tray/$state-$size.png"; done
done
# Agent logos at 2x of their 20 px row size.
for svg in "$here"/assets/agents/*.svg; do
  "$resvg" -w 40 -h 40 "$svg" "${svg%.svg}.png"
done
echo "Icons written under $icons and $here/assets/agents"
