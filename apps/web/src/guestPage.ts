import { isGuestEnvironment } from "@t3tools/client-runtime/environment";

/** The page a guest link opens. It takes the guest's name and hands over to the app. */
export const GUEST_PAGE_PATH = "/guest";

/** A guest link's readable form, which only looks up the link and goes to the guest page. */
const SHORT_GUEST_LINK_PREFIX = "/r/";

/** Pages a guest lands on before joining: nothing connects and no shell renders around them. */
export const isGuestEntryPath = (pathname: string) =>
  pathname === GUEST_PAGE_PATH || pathname.startsWith(SHORT_GUEST_LINK_PREFIX);

// Until the root route decides, a load that starts on a guest's page counts as a guest's.
let guestOnly =
  typeof window !== "undefined" &&
  (isGuestEntryPath(window.location.pathname) ||
    isGuestEnvironment(window.location.pathname.split("/")[1]));

/**
 * Whether this browser is only a guest here: it has no session on the host that serves this
 * page. The page origin's own environment is then left alone, so the connection never opens it
 * with whatever cookie the browser holds, and a guest never sees the owner's machine listed.
 */
export const isGuestOnlySession = () => guestOnly;

export function setGuestOnlySession(value: boolean) {
  guestOnly = value;
}
