// How each computer gets Tinkjam Sync, the one list every place that offers it reads. Served
// beside the homepage (the apps are in the tinkjam-sync repository). When an OS gets files a browser
// download can open (a notarized Mac build, Linux packages), switch its entry to `method: "file"`.
const DOWNLOADS = "https://tinkjam.com/downloads";

export type SyncOs = "mac" | "windows" | "linux";

interface SyncDownloadFile {
  /** What the file is, when an OS has more than one. */
  readonly kind: string;
  readonly href: string;
}

export type SyncInstall =
  | { readonly method: "file"; readonly files: ReadonlyArray<SyncDownloadFile> }
  /** One line pasted into a terminal, for where a downloaded file would not open. */
  | { readonly method: "command"; readonly command: string };

export const SYNC_OS_NAMES: Readonly<Record<SyncOs, string>> = {
  mac: "Mac",
  windows: "Windows",
  linux: "Linux",
};

export const SYNC_INSTALLS: Readonly<Record<SyncOs, SyncInstall>> = {
  // Signed ad hoc, so macOS stops a copy downloaded in a browser; a download made by curl is
  // not checked.
  mac: { method: "command", command: "curl -fsSL https://tinkjam.com/downloads/install.sh | sh" },
  windows: {
    method: "file",
    files: [{ kind: "Installer", href: `${DOWNLOADS}/TinkjamSyncSetup.exe` }],
  },
  // --install keeps it running in the background and starts it at log-in.
  linux: { method: "command", command: "npx -y https://tinkjam.com/sync.tgz --install" },
};

export const SYNC_OSES: ReadonlyArray<SyncOs> = ["mac", "windows", "linux"];

/** The computer this page is open on, or `null` on a phone or tablet, which is never it. */
export function detectSyncOs(): SyncOs | null {
  if (typeof navigator === "undefined") return "linux";
  const agent = navigator.userAgent;
  // An iPad says it is a Mac; only its touch points tell them apart.
  if (/iphone|ipad|ipod|android/i.test(agent)) return null;
  if (/mac/i.test(agent)) return navigator.maxTouchPoints > 1 ? null : "mac";
  return /win/i.test(agent) ? "windows" : "linux";
}
