# Tinkjam Sync for Mac

A menu bar app that sets up, runs and updates Tinkjam Sync, so nobody needs a terminal or Node.js.
AppKit and SwiftPM only; no Xcode project.

- First launch downloads Node.js (pinned version and SHA-256 in `Sources/TinkjamSync/Config.swift`)
  into `~/.tinkjam/runtime`, installs the published Sync package (`https://trellium.org/sync.json`,
  `sync.tgz`) with that Node's npm into `~/.tinkjam/app`, and starts it.
- The app is the only Sync: it removes the npx-installed LaunchAgent with the package's own
  `--uninstall` (the account stays connected), ends any other Sync of the home, runs Sync as its
  child and stops the whole tree on Quit. It is its own login item (`SMAppService.mainApp`).
- It checks `sync.json` and `downloads/mac.json` on launch and daily, installs a newer Sync by
  itself, and offers "Restart to Update" for a newer app.

## Build

```sh
apps/sync-mac/scripts/build.sh
```

Writes `apps/sync-mac/dist/`: `Tinkjam-Sync.dmg`, `Tinkjam-Sync-mac.zip`, their `.sha256`,
`mac.json` and `install.sh`. Version comes from `VERSION`; the build number is the UTC time.
Universal (arm64 + x86_64). Each file must stay under 25 MB, the static-file limit.

Without a signing identity the app is signed ad hoc: `install.sh` (curl) installs it fine, but a
copy downloaded in a browser is stopped by Gatekeeper. For browser downloads, with an Apple
Developer ID:

```sh
xcrun notarytool store-credentials tinkjam-notary --apple-id <id> --team-id <TEAMID> --password <app-specific password>
TINKJAM_SIGN_IDENTITY="Developer ID Application: <Name> (<TEAMID>)" \
TINKJAM_NOTARY_PROFILE=tinkjam-notary apps/sync-mac/scripts/build.sh
```

## Publish

Upload everything in `dist/` to `https://trellium.org/downloads/`. Installed copies read
`mac.json` (`version`, `url`, `sha256`, `minimumSystemVersion`) and update to a newer `version`.
Agents and terminals install with `curl -fsSL https://trellium.org/downloads/install.sh | bash`.

## Testing without touching the real setup

Launch arguments (or `defaults write org.trellium.tinkjam-sync-app <key> <value>`):

- `-BaseDirectory <dir>`: a throwaway home instead of `~/.tinkjam`. Such a copy never touches the
  login item or the LaunchAgent and keeps its own preferences.
- `-SyncManifestURL`, `-AppManifestURL`, `-SyncPackageURL`, `-HostedAppURL`: point at a local server.
- `-SkipMoveToApplications YES`: no "Move to Applications?" prompt when run from elsewhere.

`open -a "<path to the app>" "tinkjam-sync://<action>"` runs a menu action in that copy:
`connect`, `check-for-updates`, `restart-to-update`, `start-at-login?enabled=0|1`, `menu`, `quit`.
Name the copy with `-a`; a bare `open tinkjam-sync://…` may start another copy against `~/.tinkjam`.

Everything the app and Sync say goes to `~/.tinkjam/logs/sync.log` (menu: Show Log).

## Uninstall

Quit it from the menu, delete `/Applications/Tinkjam Sync.app`. To also disconnect this Mac from
the account: `npx -y https://trellium.org/sync.tgz --disconnect`.
