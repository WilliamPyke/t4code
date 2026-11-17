import { useClerk } from "@clerk/react";

import { isElectron } from "../../env";
import { resolveClerkSignInProps } from "./authRedirect";

export function useT3ConnectAuthPrompt() {
  const clerk = useClerk();
  const openAuthPrompt = () => {
    // One form for both: an email Clerk does not know yet signs up instead of failing.
    clerk.openSignIn({
      ...resolveClerkSignInProps(window.location.href, isElectron),
      withSignUp: true,
    });
  };
  /**
   * The same on a page of its own, coming back here as a new page load: for a page that must see
   * the new session for certain, such as joining a workspace right after signing up.
   */
  const redirectToAuth = () => {
    const props = resolveClerkSignInProps(window.location.href, isElectron);
    void clerk.redirectToSignIn({
      signInForceRedirectUrl: props.forceRedirectUrl ?? null,
      signUpForceRedirectUrl: props.signUpForceRedirectUrl ?? null,
    });
  };
  return { openAuthPrompt, redirectToAuth };
}
