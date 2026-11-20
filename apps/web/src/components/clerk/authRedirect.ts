export interface ClerkSignInProps {
  forceRedirectUrl?: string;
  signUpForceRedirectUrl?: string;
}

export function resolveClerkSignInProps(href: string, isElectron: boolean): ClerkSignInProps {
  if (isElectron) {
    // Electron routes through the hash, so reset any Clerk virtual pathname without losing the T3 page.
    const redirectUrl = new URL(href);
    redirectUrl.pathname = "/";
    redirectUrl.search = "";

    return {
      forceRedirectUrl: redirectUrl.toString(),
      signUpForceRedirectUrl: redirectUrl.toString(),
    };
  }
  // Set sign-up's redirect too; switching from sign-in otherwise falls back to the modal's opening URL.
  const returnUrl = newDocumentUrl(href);
  return { forceRedirectUrl: returnUrl, signUpForceRedirectUrl: returnUrl };
}

/** What the sign-in page needs to send a person back to where they asked to sign in. */
export interface SignInPageRequest extends ClerkSignInProps {
  /** The page to go back to without signing in, as a path on this site. */
  readonly from: string;
  /** An email Clerk does not know yet makes an account in the same form. */
  readonly withSignUp: boolean;
}

const sameOriginUrl = (value: unknown, origin: string): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value, origin);
    return url.origin === origin ? url.toString() : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Reads a kept sign-in request. Every address must be on this site, so a request planted in
 * storage cannot send someone elsewhere after they sign in.
 */
export function parseSignInPageRequest(raw: string | null, origin: string): SignInPageRequest {
  let value: Record<string, unknown> = {};
  try {
    const parsed: unknown = raw === null ? null : JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null) value = parsed as Record<string, unknown>;
  } catch {}
  const from = sameOriginUrl(value.from, origin);
  const forceRedirectUrl = sameOriginUrl(value.forceRedirectUrl, origin);
  const signUpForceRedirectUrl = sameOriginUrl(value.signUpForceRedirectUrl, origin);
  return {
    from: from === undefined ? "/" : from.slice(origin.length) || "/",
    withSignUp: value.withSignUp !== false,
    ...(forceRedirectUrl ? { forceRedirectUrl } : {}),
    ...(signUpForceRedirectUrl ? { signUpForceRedirectUrl } : {}),
  };
}

// The home and the two invite pages follow the account as it changes and hold their invite in
// memory, so a sign-in never has to load them again.
const IN_APP_PATHS: ReadonlySet<string> = new Set(["/", "/guest", "/join-workspace"]);

/**
 * Whether Clerk's move to `to` after a sign-in or sign-out can happen inside the app, with no page
 * load. Other pages read what they need as they load (a board's session, a pairing), so they
 * still get the new document Clerk gives them.
 */
export function staysInApp(to: string, origin: string): boolean {
  try {
    const url = new URL(to, origin);
    return url.origin === origin && IN_APP_PATHS.has(url.pathname) && url.hash === "";
  } catch {
    return false;
  }
}

/**
 * The page to come back to after signing in, as a new document. Going to this same page with a
 * fragment (an invite's code) only scrolls, and Clerk then holds back the session it just made,
 * which leaves the page signed out; a mark in the query makes it a new page load.
 */
function newDocumentUrl(href: string): string {
  const url = new URL(href);
  if (url.hash === "") return href;
  url.searchParams.set("signed-in", "1");
  return url.toString();
}
