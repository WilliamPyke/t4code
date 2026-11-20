import { useNavigate, type AnyRouter } from "@tanstack/react-router";

import { GUEST_PAGE_PATH, isGuestEntryPath } from "../../guestPage";
import { withoutAssistantCitationHash } from "../../lib/assistantCitationNavigation";

/** Settings, Usage and What's new open as modals over the last main-app view. */
export function isAppModalPage(pathname: string) {
  return (
    pathname === "/settings" ||
    pathname.startsWith("/settings/") ||
    pathname === "/usage" ||
    pathname === "/whats-new"
  );
}

export function isSidebarUtilityPage(pathname: string) {
  return pathname.startsWith("/projects/") || pathname === "/pull-requests";
}

// Pages the root route always renders without the app shell, so they are never
// a page to return to. Other paths seen before auth or on a prompt-link landing
// are still recorded; they are real app URLs, so returning to one is harmless.
const SHELL_LESS_PATHS = new Set(["/pair", "/connect", "/connect-agent", GUEST_PAGE_PATH]);

/** The sign-in page and each of its steps, which Clerk keeps under its path, and /sign-up. */
export const isSignInPath = (pathname: string) => /^\/sign-(?:in|up)(?:\/|$)/.test(pathname);

let mainAppHref: string | null = null;
let appModalReturnHref: string | null = null;

/** Remembers where Settings, Usage, and the utility pages lead back to. */
export function startMainAppLocationTracking(router: AnyRouter): () => void {
  const record = () => {
    const { pathname } = router.state.location;
    if (isAppModalPage(pathname) || SHELL_LESS_PATHS.has(pathname) || isSignInPath(pathname)) {
      return;
    }
    if (isGuestEntryPath(pathname)) return;
    const href = withoutAssistantCitationHash(router.state.location.href);
    appModalReturnHref = href;
    if (!isSidebarUtilityPage(pathname)) mainAppHref = href;
  };
  record();
  return router.subscribe("onResolved", record);
}

export function useNavigateToMainApp() {
  const navigate = useNavigate();
  return () => navigate({ href: mainAppHref ?? "/" });
}

/**
 * Whether the page a modal opened over is the boards home, or nothing came before it (the modal
 * opened from its own address), so the home is what shows behind it.
 */
export function appModalOpenedOverHome(): boolean {
  if (appModalReturnHref === null) return true;
  return new URL(appModalReturnHref, "http://local").pathname === "/";
}

/** Leaves Settings or Usage for the page that opened it. */
export function useCloseAppModal() {
  const navigate = useNavigate();
  return () => navigate({ href: appModalReturnHref ?? mainAppHref ?? "/" });
}
