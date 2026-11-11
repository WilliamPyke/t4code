import { isGuestEnvironment } from "@t3tools/client-runtime/environment";

/** The page a guest link opens. It takes the guest's name and hands over to the app. */
export const GUEST_PAGE_PATH = "/guest";

// Until the root route decides, a load that starts on a guest's page counts as a guest's.
let guestOnly =
  typeof window !== "undefined" &&
  (window.location.pathname === GUEST_PAGE_PATH ||
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
