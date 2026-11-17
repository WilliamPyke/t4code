import { useAuth, useClerk } from "@clerk/react";
import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import {
  buildConnectCliClerkAuthorizeUrl,
  connectCliContinueRequested,
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
 * computer for their account. Approving hands a one-time code back to the computer itself. It
 * says what this is before any sign-in form; signing in here goes straight on to approval.
 */
export function ConnectCliAuthorizeSurface() {
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const [continueAfterSignIn] = useState(() => connectCliContinueRequested(window.location.href));
  const clerk = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const continued = useRef(false);
  const [connecting, setConnecting] = useState(false);

  const connect = () => {
    if (!request) return;
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) return;
    setConnecting(true);
    // On a development sign-in instance, Clerk's own pages are on another site that cannot see
    // this page's sign-in, and would ask for it again; this carries it there. Nothing elsewhere.
    window.location.assign(clerk.buildUrlWithAuth(authorizeUrl));
  };
  const continueOnLoad = useEffectEvent(connect);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- leaves for Clerk's approval once Clerk has loaded the sign-in made to approve
  useEffect(() => {
    if (!continueAfterSignIn || !isLoaded || !isSignedIn || continued.current) return;
    continued.current = true;
    continueOnLoad();
  }, [continueAfterSignIn, isLoaded, isSignedIn]);

  if (!request) {
    return (
      <StandalonePage>
        <StandalonePageHeader {...invalidLinkMessage} />
      </StandalonePage>
    );
  }

  const openSignIn = () =>
    clerk.openSignIn(
      resolveClerkSignInProps(connectCliSignInRedirectUrl(window.location.href), isElectron),
    );
  const computer = request.computerName ?? "this computer";

  if (connecting || (continueAfterSignIn && isSignedIn)) {
    return (
      <StandalonePage>
        <StandalonePageHeader
          context="Connect a computer"
          title="One more step: confirm it's you"
          description={`Tinkjam is handing ${computer} its approval. If you are asked to sign in again, use the same account.`}
        />
      </StandalonePage>
    );
  }

  return (
    <StandalonePage>
      <StandalonePageHeader
        context="Connect a computer"
        title={`Connect ${computer} to your Tinkjam account`}
        description={`So your boards can use the agents on ${computer}, such as Claude Code or Codex. They run there, on your own sign-in, and only when you send them something.${isSignedIn ? "" : " Sign in to approve it."}`}
      />
      {isLoaded ? (
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {isSignedIn ? (
            <Button type="button" onClick={connect} data-connect-computer>
              Connect
            </Button>
          ) : (
            <Button type="button" onClick={openSignIn}>
              Sign in to approve
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
