import { parseSignInPageRequest, type SignInPageRequest } from "./authRedirect";

// Per tab, so it survives the sign-in page's own steps and a Google or Apple round trip.
const REQUEST_KEY = "tinkjam:sign-in-request:v1";

export function keepSignInPageRequest(request: SignInPageRequest): void {
  try {
    window.sessionStorage.setItem(REQUEST_KEY, JSON.stringify(request));
  } catch {
    // Blocked storage only means the page comes back to the boards home.
  }
}

export function readSignInPageRequest(): SignInPageRequest {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(REQUEST_KEY);
  } catch {}
  return parseSignInPageRequest(raw, window.location.origin);
}
