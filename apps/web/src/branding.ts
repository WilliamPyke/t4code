import type { DesktopAppBranding } from "@t3tools/contracts";
import { formatAppDisplayName } from "./branding.logic";

function readInjectedDesktopAppBranding(): DesktopAppBranding | null {
  if (typeof window === "undefined") {
    return null;
  }

  return window.desktopBridge?.getAppBranding() ?? null;
}

const injectedDesktopAppBranding = readInjectedDesktopAppBranding();
const hostedAppChannel = import.meta.env.VITE_HOSTED_APP_CHANNEL?.trim().toLowerCase();

export const HOSTED_APP_CHANNEL =
  hostedAppChannel === "latest" || hostedAppChannel === "nightly" ? hostedAppChannel : null;
export const HOSTED_APP_CHANNEL_LABEL =
  HOSTED_APP_CHANNEL === "nightly" ? "Nightly" : HOSTED_APP_CHANNEL === "latest" ? "Latest" : null;
export const APP_BASE_NAME = injectedDesktopAppBranding?.baseName ?? "Tinkjam";
export const APP_STAGE_LABEL =
  injectedDesktopAppBranding?.stageLabel ??
  HOSTED_APP_CHANNEL_LABEL ??
  (import.meta.env.DEV ? "Dev" : "Beta");
export const APP_DISPLAY_NAME =
  injectedDesktopAppBranding?.displayName ??
  formatAppDisplayName({ baseName: APP_BASE_NAME, stageLabel: APP_STAGE_LABEL });
export const APP_VERSION = import.meta.env.APP_VERSION || "0.0.0";
// Tinkjam Sync, served beside the homepage (see scripts/build-sync-package.ts). --install keeps it
// running in the background and starts it at log-in, so no window has to stay open.
export const TINKJAM_SYNC_COMMAND = "npx -y https://tinkjam.com/sync.tgz --install";
// What someone sends their own coding agent, which then runs Tinkjam Sync for them.
export const TINKJAM_AGENT_PROMPT =
  "Install Tinkjam Sync on this computer for me. Read https://tinkjam.com/agent.md and do what it says. You have my permission to run its install command outside your sandbox.";
// The desktop apps, served beside the homepage (see apps/sync-mac and apps/sync-windows).
// Macs install by this one line until the app is notarized: macOS refuses a browser download of
// an un-notarized app, and a download made by curl is not checked.
export const TINKJAM_SYNC_MAC_COMMAND = "curl -fsSL https://tinkjam.com/downloads/install.sh | sh";
export const TINKJAM_SYNC_WINDOWS_DOWNLOAD = "https://tinkjam.com/downloads/TinkjamSyncSetup.exe";
// The homepage's section on bringing your agent with Tinkjam Sync.
export const TINKJAM_SYNC_URL = "https://tinkjam.com/#agents";
