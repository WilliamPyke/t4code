# Tinkjam Sync for Mac

A menu bar app that sets up, runs and updates Tinkjam Sync, so nobody needs a terminal or Node.js.
AppKit and SwiftPM only; no Xcode project.

- First launch downloads Node.js (pinned version and SHA-256 in `Sources/TinkjamSync/Config.swift`)
  into `~/.tinkjam/runtime`, unpacks the published Sync package (`https://trellium.org/sync.json`,
  `sync.tgz`) into `~/.tinkjam/app/node_modules/tinkjam-sync`, installs exactly its
  `npm-shrinkwrap.json` there with that Node's `npm ci`, and starts it.
- The app is the only Sync: it removes the npx-installed LaunchAgent with the package's own
  `--uninstall` (the account stays connected), ends any other Sync of the home, runs Sync as its
  child and stops the whole tree on Quit. It is its own login item (`SMAppService.mainApp`).
- It checks `sync.json` and `downloads/mac.json` on launch, hourly and on waking. A newer Sync
  installs by itself once no agent is running; `sync.json` must carry the tarball's `sha256` and,
  like `mac.json`, a signature by the release key (`scripts/sign-release.ts`). A
  newer app is downloaded, checked, and installed at the next launch or when no agent is running;
  the menu also offers "Restart to Update".
- The menu follows `~/.tinkjam/userdata/sync-status.json`, which Sync rewrites every 30 seconds,
  so "Connected" turns into "Reconnecting…" when boards cannot reach this Mac.
- When it gives up (Sync keeps stopping, setup fails), it tries again every 15 minutes, on waking
  and when the network returns.

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

Installed copies refuse a `mac.json` the release key did not sign. The key stays on the release
PC, so copy `dist/mac.json` there and run `node scripts/sign-release.ts sign <path to mac.json>`
(then `verify`) unless `build.sh` found the key itself. Then upload everything in `dist/` to
`https://trellium.org/downloads/`. Installed copies read `mac.json` (`version`, `build`, `url`,
`sha256`, `minimumSystemVersion`, `keyId`, `signature`) and update to a newer `version`.
Agents and terminals install with `curl -fsSL https://trellium.org/downloads/install.sh | bash`.

## Testing without touching the real setup

Launch arguments (or `defaults write org.trellium.tinkjam-sync-app <key> <value>`):

- `-BaseDirectory <dir>`: a throwaway home instead of `~/.tinkjam`. Such a copy never touches the
  login item or the LaunchAgent and keeps its own preferences.
- `-SyncManifestURL`, `-AppManifestURL`, `-SyncPackageURL`, `-HostedAppURL`: point at a local server.
- `-SkipMoveToApplications YES`: no "Move to Applications?" prompt when run from elsewhere.

`open -a "<path to the app>" "tinkjam-sync://<action>"` runs an action in that copy: `connect`,
`disconnect` (asks first), `check-for-updates` (never stops a working agent), `show` (the status
window) and `menu`. Any web page can open these links, so none of them quits the app or changes a
setting; to quit a copy from a script, send it SIGTERM. Name the copy with `-a`; a bare
`open tinkjam-sync://…` may start another copy against `~/.tinkjam`.

Everything the app and Sync say goes to `~/.tinkjam/logs/sync.log` (menu: Show Log). The menu and
the windows show plain sentences from `Sources/TinkjamSync/Words.swift`; the technical cause of a
failure is only in the log.

## Uninstall

To disconnect this Mac from the account, choose Disconnect this Mac… from the menu first. Then
quit it from the menu and delete `/Applications/Tinkjam Sync.app`.
