import { useAuth, useClerk } from "@clerk/react";
import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  buildConnectCliClerkAuthorizeUrl,
  connectCliSignInRedirectUrl,
} from "../../cloud/connectCliAuth";
import { isElectron } from "../../env";
import { StandalonePage, StandalonePageHeader } from "../ui/standalone-page";
import { resolveClerkSignInProps } from "../clerk/authRedirect";
import { Button } from "../ui/button";

const invalidLinkMessage = {
  context: "Connect a computer",
  title: "This link is incomplete",
  description: "Run the Tinkjam Sync command on your computer again and open the link it prints.",
} as const;

/**
 * Where Tinkjam Sync (or `t3 connect`) sends the browser: the signed-in person approves this
 * computer for their account. Approving hands a one-time code back to the computer itself.
 */
export function ConnectCliAuthorizeSurface() {
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const signInOpened = useRef(false);
  const [connecting, setConnecting] = useState(false);

  const openSignIn = () => {
    if (!request) {
      return;
    }
    clerk.openSignIn(
      resolveClerkSignInProps(
        clerk.buildUrlWithAuth(connectCliSignInRedirectUrl(request, window.location.href)),
        isElectron,
      ),
    );
  };
  const openSignInOnLoad = useEffectEvent(openSignIn);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens Clerk sign-in once Clerk has loaded signed out
  useEffect(() => {
    if (!request || !isLoaded || isSignedIn || signInOpened.current) {
      return;
    }
    signInOpened.current = true;
    openSignInOnLoad();
  }, [isLoaded, isSignedIn, request]);

  if (!request) {
    return (
      <StandalonePage>
        <StandalonePageHeader {...invalidLinkMessage} />
      </StandalonePage>
    );
  }

  const connect = () => {
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) return;
    setConnecting(true);
    // On a development sign-in instance, Clerk's own pages are on another site that cannot see
    // this page's sign-in, and would ask for it again; this carries it there. Nothing elsewhere.
    window.location.assign(clerk.buildUrlWithAuth(authorizeUrl));
  };
  const computer = request.computerName ?? "this computer";

  return (
    <StandalonePage>
      <StandalonePageHeader
        context="Connect a computer"
        title={`Connect ${computer} to Tinkjam?`}
        description={
          isSignedIn
            ? "Your boards can then use the agents on it, such as Claude Code or Codex. They run there, on your own sign-in, and only when you send them something."
            : "Sign in first. Your boards can then use the agents on this computer, on your own sign-in."
        }
      />
      {isLoaded ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {isSignedIn ? (
            <Button type="button" disabled={connecting} onClick={connect} data-connect-computer>
              {connecting ? "Connecting..." : "Connect"}
            </Button>
          ) : (
            <Button type="button" onClick={openSignIn}>
              Sign in to connect
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Only approve a computer you just ran Tinkjam Sync on.
          </p>
        </div>
      ) : null}
    </StandalonePage>
  );
}
