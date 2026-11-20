/** How much of the app's shell shows: boards only, or the full workbench beside them. */
export type ShellMode = "simple" | "advanced";

/** Simple on the hosted app; Advanced where the app is served from the person's own machine. */
function defaultShellMode(hosted: boolean): ShellMode {
  return hosted ? "simple" : "advanced";
}

/** A choice made on this browser holds; without one, where the app is served decides. */
export function resolveShellMode(stored: ShellMode | null, hosted: boolean): ShellMode {
  return stored ?? defaultShellMode(hosted);
}

/**
 * Pages only Advanced lists, by name, so Simple can say where they went instead of breaking.
 * Pull requests stay reachable in Simple once the person has a computer connected.
 */
export function advancedOnlyPageName(
  pathname: string,
  pullRequestsAvailable = false,
): string | null {
  if (pathname === "/usage") return "Usage";
  if (pathname === "/pull-requests") return pullRequestsAvailable ? null : "Pull requests";
  if (pathname.startsWith("/projects/")) return "Project settings";
  return null;
}

// Command menu actions Simple lists: boards, looks, help and the ways to more. Others are Advanced's.
const SIMPLE_PALETTE_ACTIONS = new Set([
  "action:go-to-boards",
  "action:new-board",
  "action:new-board-template",
  "action:change-theme",
  "action:change-appearance",
  "action:whats-new",
  "action:settings",
  "action:workspace-focus:1",
  "action:workspace-focus:-1",
  "action:connect-computer",
  "action:switch-shell-mode",
]);

export function paletteActionShows(
  value: string,
  mode: ShellMode,
  pullRequestsAvailable = false,
): boolean {
  if (mode === "advanced") return true;
  // Pull requests need a computer connected; without one the action is not offered.
  if (value === "action:pull-requests") return pullRequestsAvailable;
  return SIMPLE_PALETTE_ACTIONS.has(value);
}

/** Simple's own Settings page is the bare /settings; every other settings page is the full set. */
export function settingsLandingPath(mode: ShellMode): "/settings" | "/settings/general" {
  return mode === "simple" ? "/settings" : "/settings/general";
}
