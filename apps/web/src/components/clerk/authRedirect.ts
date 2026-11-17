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
