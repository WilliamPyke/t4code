import { useClerk } from "@clerk/react";
import { useNavigate } from "@tanstack/react-router";

import { isElectron } from "../../env";
import { type ClerkSignInProps, resolveClerkSignInProps } from "./authRedirect";
import { keepSignInPageRequest } from "./signInPageRequest";

/**
 * Opens sign-in: on the web the sign-in page, which comes back here; on desktop, whose pages live
 * in the address's fragment where Clerk's page router cannot run, Clerk's own dialog.
 */
export function useOpenSignIn() {
  const clerk = useClerk();
  const navigate = useNavigate();
  // One form for both: an email Clerk does not know yet signs up instead of failing.
  return () => {
    const props: ClerkSignInProps = resolveClerkSignInProps(window.location.href, isElectron);
    if (isElectron) {
      clerk.openSignIn({ ...props, withSignUp: true });
      return;
    }
    keepSignInPageRequest({ ...props, from: window.location.href, withSignUp: true });
    void navigate({ to: "/sign-in/$", params: { _splat: "" } });
  };
}

export function useT3ConnectAuthPrompt() {
  return { openAuthPrompt: useOpenSignIn() };
}
