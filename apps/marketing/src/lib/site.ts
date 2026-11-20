export const SITE_NAME = "Tinkjam";
export const APP_URL = "https://app.tinkjam.com/";
export const SIGN_IN_URL = `${APP_URL}sign-in`;
// The public sample board's view link, as infra/boards/scripts/sample-board.mjs prints it. Empty
// hides "See a sample board". Keep it the same as SAMPLE_BOARD_URL in apps/web/src/sampleBoard.ts.
export const SAMPLE_BOARD_URL: string =
  "https://app.tinkjam.com/guest?host=boards.tinkjam.com#1ecbf7b4-8fc3-46f8-8a5c-8a683e311029.v.usrcvSaVH6bFGp3ACk5tGWNPWwFWYCZ5eXYLRB7usFE";

// Tinkjam Sync downloads, copied into dist/downloads/ at deploy. Release files are named
// tinkjam-sync-v<version>-<os>-<arch>.<ext>; point each constant at the real file at release.
const SYNC_VERSION = "1.0.5";
const WINDOWS_DOWNLOAD = "/downloads/TinkjamSyncSetup.exe";
const MAC_DMG_DOWNLOAD = "/downloads/Tinkjam-Sync.dmg";
const LINUX_DOWNLOADS = [
  {
    label: "AppImage (beta)",
    href: `/downloads/tinkjam-sync-v${SYNC_VERSION}-linux-x86_64.AppImage`,
  },
  { label: ".deb (beta)", href: `/downloads/tinkjam-sync-v${SYNC_VERSION}-linux-x86_64.deb` },
  { label: ".rpm (beta)", href: `/downloads/tinkjam-sync-v${SYNC_VERSION}-linux-x86_64.rpm` },
];
// The published install commands (apps/sync-mac/scripts/install.sh prints the Linux one).
const MAC_INSTALL_COMMAND = "curl -fsSL https://tinkjam.com/downloads/install.sh | bash";
const LINUX_INSTALL_COMMAND = "npx -y https://tinkjam.com/sync.tgz --install";
export const CHECKSUMS_URL = "/downloads/checksums.txt";
// A Mac app downloaded in a browser is stopped by Gatekeeper unless it is notarized, so until
// then Mac installs by command. Set each flag once its files are in dist/downloads/.
const MAC_NOTARIZED: boolean = false;
const LINUX_PUBLISHED: boolean = true;
export const CHECKSUMS_PUBLISHED: boolean = true;

type SyncMethod =
  | { kind: "files"; files: ReadonlyArray<{ label: string; href: string }> }
  | { kind: "command"; command: string; instruction: string };

export const SYNC_SYSTEMS: ReadonlyArray<{
  os: "mac" | "windows" | "linux";
  name: string;
  method: SyncMethod;
}> = [
  {
    os: "mac",
    name: "Mac",
    method: MAC_NOTARIZED
      ? { kind: "files", files: [{ label: "Download for Mac", href: MAC_DMG_DOWNLOAD }] }
      : {
          kind: "command",
          command: MAC_INSTALL_COMMAND,
          instruction: "Paste it into Terminal and press Return",
        },
  },
  {
    os: "windows",
    name: "Windows",
    method: { kind: "files", files: [{ label: "Download for Windows", href: WINDOWS_DOWNLOAD }] },
  },
  {
    os: "linux",
    name: "Linux",
    method: LINUX_PUBLISHED
      ? {
          kind: "files",
          files: LINUX_DOWNLOADS.map((file) => ({
            label: `Download for Linux (${file.label})`,
            href: file.href,
          })),
        }
      : {
          kind: "command",
          command: LINUX_INSTALL_COMMAND,
          instruction: "Paste it into a terminal and press Enter",
        },
  },
];

// Tinkjam is a fork of T3 Code, which is MIT licensed; the legal page credits it.
export const UPSTREAM_REPO_URL = "https://github.com/pingdotgg/t3code";
