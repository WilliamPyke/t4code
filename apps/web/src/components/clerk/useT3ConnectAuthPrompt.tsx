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
  return { openAuthPrompt };
}
