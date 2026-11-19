import { useAuth, useClerk, useUser } from "@clerk/react";
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
import { Skeleton } from "../ui/skeleton";

const START_AGAIN = "Open Tinkjam Sync on your computer and choose Connect to start again.";

// Sign-in normally loads in a second or two; past this the page says so instead of staying empty.
const SIGN_IN_SLOW_MS = 10_000;

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
  const { user } = useUser();
  const continued = useRef(false);
  const [connecting, setConnecting] = useState(false);
  const [cannotStart, setCannotStart] = useState(false);
  const [slow, setSlow] = useState(false);

  const connect = () => {
    if (!request) return;
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) return setCannotStart(true);
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

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer: says sign-in is slow to load instead of leaving the page without a button
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setSlow(true), SIGN_IN_SLOW_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  if (!request || cannotStart) {
    return (
      <StandalonePage>
        <StandalonePageHeader
          context="Connect a computer"
          title={request ? "Tinkjam could not start the approval" : "This link is incomplete"}
          description={START_AGAIN}
        />
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

  const account = user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? null;
  return (
    <StandalonePage>
      <StandalonePageHeader
        context="Connect a computer"
        title={`Connect ${computer} to your Tinkjam account`}
        description={`So your boards can use the agents on ${computer}, such as Claude Code or Codex. They run there, on your own sign-in, and only when you send them something.${isLoaded && !isSignedIn ? " Sign in to approve it." : ""}`}
      />
      {!isLoaded ? (
        slow ? (
          <div className="mt-6 flex flex-wrap items-center gap-3" role="alert">
            <p className="text-sm text-muted-foreground">
              Sign-in is taking a while to load. Check your internet connection.
            </p>
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </div>
        ) : (
          <div className="mt-6" role="status" aria-label="Loading sign-in">
            <Skeleton className="h-8 w-28" />
          </div>
        )
      ) : (
        <>
          {isSignedIn && account !== null ? (
            <p className="mt-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <span>
                Signed in as <span className="font-medium">{account}</span>
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
                onClick={() => void clerk.signOut({ redirectUrl: window.location.href })}
              >
                Use a different account
              </Button>
            </p>
          ) : null}
          <div className="mt-4 flex flex-wrap items-center gap-3">
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
              Only approve a computer you just opened Tinkjam Sync on.
            </p>
          </div>
        </>
      )}
    </StandalonePage>
  );
}
