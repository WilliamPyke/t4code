import { useAuth, useClerk, useUser } from "@clerk/react";
import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { type ReactNode, useEffect, useState } from "react";

import {
  approveComputerSignIn,
  buildConnectCliClerkAuthorizeUrl,
} from "../../cloud/connectCliAuth";
import { ArtCard, ArtConnector, BrandArtPanel, LaptopGlyph } from "../brand/BrandArtPanel";
import { Copyright, SplitHeading, SplitScreen, splitLinkClassName } from "../brand/SplitScreen";
import { useOpenSignIn } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";

const START_AGAIN = "Open Tinkjam Sync on your computer and choose Connect to start again.";

// Sign-in normally loads in a second or two; past this the page says so instead of staying busy.
const SIGN_IN_SLOW_MS = 10_000;

/**
 * Where Tinkjam Sync (or `t3 connect`) sends the browser: the signed-in person approves this
 * computer for their account. Only their press of Approve approves it, never a page load, and it
 * hands a one-time code back to the computer itself. Not mine leaves without approving anything.
 */
export function ConnectCliAuthorizeSurface() {
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const clerk = useClerk();
  const openSignIn = useOpenSignIn();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [connecting, setConnecting] = useState(false);
  const [cannotStart, setCannotStart] = useState(false);
  const [declined, setDeclined] = useState(false);
  const [slow, setSlow] = useState(false);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer: says sign-in is slow to load instead of leaving the page busy
  useEffect(() => {
    if (isLoaded) return;
    const timer = setTimeout(() => setSlow(true), SIGN_IN_SLOW_MS);
    return () => clearTimeout(timer);
  }, [isLoaded]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Back restores this page from the browser's cache with its button still busy
  useEffect(() => {
    const restore = (event: PageTransitionEvent) => {
      if (event.persisted) setConnecting(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  const computerName = request?.computerName ?? null;

  if (!request || cannotStart || declined) {
    return (
      <ApprovalScreen computerName={computerName} status={declined ? "declined" : "failed"}>
        <SplitHeading>
          {declined
            ? "Nothing was connected"
            : request
              ? "Tinkjam could not connect this computer"
              : "This link is incomplete"}
        </SplitHeading>
        <p className="mt-3 text-base text-pretty text-muted-foreground">
          {declined ? "You can close this page." : `Nothing was connected. ${START_AGAIN}`}
        </p>
        <div className="mt-7">
          <Button variant="outline" size="pill" render={<a href="/" />}>
            Go to your boards
          </Button>
        </div>
      </ApprovalScreen>
    );
  }

  const connect = async () => {
    const authorizeUrl = buildConnectCliClerkAuthorizeUrl(request);
    if (!authorizeUrl) return setCannotStart(true);
    setConnecting(true);
    // The press itself is the approval: the relay remembers it for this sign-in only.
    if (!(await approveComputerSignIn({ getToken, codeChallenge: request.challenge }))) {
      setConnecting(false);
      return setCannotStart(true);
    }
    // On a development sign-in instance, Clerk's own pages are on another site that cannot see
    // this page's sign-in, and would ask for it again; this carries it there. Nothing elsewhere.
    window.location.assign(clerk.buildUrlWithAuth(authorizeUrl));
  };
  const account = user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? null;

  return (
    <ApprovalScreen computerName={computerName} status="waiting">
      <SplitHeading>Connect this computer?</SplitHeading>
      <div className="mt-7 flex items-center gap-4 rounded-2xl border-2 border-border p-5">
        <span
          aria-hidden
          className="inline-flex size-14 shrink-0 items-center justify-center rounded-xl bg-update-foreground/12 text-update-foreground"
        >
          <LaptopGlyph className="h-6.5 w-7.5" />
        </span>
        <span className="min-w-0 text-lg font-semibold wrap-anywhere text-foreground">
          {computerName ?? "This computer"}
        </span>
      </div>
      {!isLoaded ? (
        <div className="mt-7 flex flex-col gap-4" data-connect-account>
          {slow ? (
            <>
              <p role="alert" className="text-base text-foreground">
                Sign-in is taking a while to load. Check your internet connection.
              </p>
              <div>
                <Button
                  type="button"
                  size="pill"
                  variant="outline"
                  onClick={() => location.reload()}
                >
                  Reload
                </Button>
              </div>
            </>
          ) : (
            <span role="status" aria-label="Loading sign-in" className="flex flex-col gap-4">
              <Skeleton className="h-4 w-60" />
              <Skeleton shape="pill" className="h-12 w-56" />
            </span>
          )}
        </div>
      ) : !isSignedIn ? (
        <>
          <p className="mt-5 text-ui-md text-muted-foreground" data-connect-account>
            Sign in, or create an account, to connect it to your boards.
          </p>
          <div className="mt-7">
            <Button type="button" size="pill" onClick={openSignIn}>
              Sign in to continue
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="mt-5 text-ui-md text-muted-foreground">
            Only approve a computer that is yours.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="pill"
              disabled={connecting}
              aria-busy={connecting || undefined}
              onClick={() => void connect()}
              data-connect-computer
            >
              {connecting ? <Spinner aria-hidden /> : null}
              Approve this computer
            </Button>
            <Button
              type="button"
              size="pill"
              variant="outline"
              disabled={connecting}
              onClick={() => setDeclined(true)}
            >
              Not mine
            </Button>
          </div>
          <p className="mt-5.5 text-sm text-muted-foreground" data-connect-account>
            {account === null ? (
              "You are signed in."
            ) : (
              <>
                Signed in as <span className="break-all">{account}</span>.
              </>
            )}{" "}
            <button
              type="button"
              className={splitLinkClassName}
              disabled={connecting}
              // The address only differs by its fragment, so going to it reloads nothing by itself.
              onClick={() =>
                void clerk
                  .signOut({ redirectUrl: window.location.href })
                  .finally(() => window.location.reload())
              }
            >
              Use another account
            </button>
          </p>
          {connecting ? (
            <p role="status" className="mt-4 text-sm text-pretty text-muted-foreground">
              Finishing on your computer. If you are asked to sign in again, use the same account.
            </p>
          ) : null}
        </>
      )}
    </ApprovalScreen>
  );
}

type ApprovalStatus = "waiting" | "declined" | "failed";

/** The approval's page: the form on the left, the art showing this computer on the right. */
function ApprovalScreen({
  computerName,
  status,
  children,
}: {
  readonly computerName: string | null;
  readonly status: ApprovalStatus;
  readonly children: ReactNode;
}) {
  return (
    <SplitScreen
      footer={<Copyright />}
      art={
        <BrandArtPanel headline={{ kind: "bring" }}>
          <ComputerArt name={computerName ?? "This computer"} status={status} />
        </BrandArtPanel>
      }
    >
      {children}
    </SplitScreen>
  );
}

const COMPUTER_LINE: Record<ApprovalStatus, string> = {
  waiting: "Waiting for your approval",
  declined: "Not connected",
  failed: "Not connected",
};

function ComputerArt({ name, status }: { readonly name: string; readonly status: ApprovalStatus }) {
  return (
    <>
      <ArtCard className="bottom-30 left-13 w-57.5 p-4">
        <LaptopGlyph className="h-7 w-8.5" />
        <div className="mt-3 truncate text-ui-md font-semibold">{name}</div>
        <div className="text-brand-ink/65">{COMPUTER_LINE[status]}</div>
      </ArtCard>
      <ArtConnector tone={status === "waiting" ? "sun" : "waiting"} />
      <ArtCard className="right-12 bottom-28 w-70 opacity-85">
        <div className="flex items-center gap-2 border-b border-brand-panel px-3 py-2.5 font-semibold">
          Your agent
          <span
            className={
              status === "waiting"
                ? "ms-auto rounded-full bg-brand-sun-tint px-2 py-0.75 text-2xs font-semibold"
                : "ms-auto rounded-full bg-brand-panel px-2 py-0.75 text-2xs font-semibold text-brand-ink/65"
            }
          >
            {status === "waiting" ? "Almost there" : "Not connected"}
          </span>
        </div>
        <p className="p-3.5 text-brand-ink/65">
          Your agent will show up here, as a box on the board.
        </p>
      </ArtCard>
    </>
  );
}
