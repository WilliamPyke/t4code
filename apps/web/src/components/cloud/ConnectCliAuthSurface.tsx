import { useAuth, useClerk, useUser } from "@clerk/react";
import { readConnectAuthorizeRequest } from "@t3tools/shared/connectAuth";
import { CheckIcon } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  approveComputerSignIn,
  buildConnectCliClerkAuthorizeUrl,
} from "../../cloud/connectCliAuth";
import { isElectron } from "../../env";
import { resolveClerkSignInProps } from "../clerk/authRedirect";
import { BoardBackdrop } from "../room/BoardChrome";
import { TinkjamWordmark } from "../TinkjamLogo";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import { Spinner } from "../ui/spinner";

const START_AGAIN = "Open Tinkjam Sync on your computer and choose Connect to start again.";

// Sign-in normally loads in a second or two; past this the page says so instead of staying busy.
const SIGN_IN_SLOW_MS = 10_000;

const ALLOWS = [
  "Your agents run on this computer, under your own Claude or Codex account.",
  "Nothing anyone else writes reaches your agent unless you press Send.",
  "Stop any time: quit Tinkjam Sync, or remove this computer in Settings, under Your computers.",
];

/**
 * Where Tinkjam Sync (or `t3 connect`) sends the browser: the signed-in person approves this
 * computer for their account. Only their press of Connect approves it, never a page load, and it
 * hands a one-time code back to the computer itself. Every state keeps the same rows in place.
 */
export function ConnectCliAuthorizeSurface() {
  const [request] = useState(() => readConnectAuthorizeRequest(new URL(window.location.href)));
  const clerk = useClerk();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const [connecting, setConnecting] = useState(false);
  const [cannotStart, setCannotStart] = useState(false);
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

  if (!request || cannotStart) {
    return (
      <ConnectCard
        title={request ? "Tinkjam could not connect this computer" : "This link is incomplete"}
        description={`Nothing was connected. ${START_AGAIN}`}
      >
        <div>
          <Button variant="outline" size="lg" render={<a href="/" />}>
            Go to your boards
          </Button>
        </div>
      </ConnectCard>
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
  const openSignIn = () =>
    clerk.openSignIn(resolveClerkSignInProps(window.location.href, isElectron));
  const account = user?.primaryEmailAddress?.emailAddress ?? user?.fullName ?? null;

  return (
    <ConnectCard
      title={`Connect ${request.computerName ?? "this computer"} to Tinkjam`}
      description="Your boards will be able to use the agents on this computer, such as Claude Code or Codex."
    >
      <ul className="flex flex-col gap-2 text-sm">
        {ALLOWS.map((line) => (
          <li key={line} className="flex gap-2">
            <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <span className="text-pretty">{line}</span>
          </li>
        ))}
      </ul>
      <div className="flex flex-col gap-3">
        <div
          className="flex min-h-13 flex-wrap content-center items-center gap-x-2 gap-y-1 text-sm"
          data-connect-account
        >
          {!isLoaded ? (
            slow ? (
              <p role="alert" className="text-muted-foreground">
                Sign-in is taking a while to load. Check your internet connection.
              </p>
            ) : (
              <span role="status" aria-label="Loading sign-in">
                <Skeleton className="h-4 w-48" />
              </span>
            )
          ) : !isSignedIn ? (
            <p className="text-muted-foreground">
              Sign in, or create an account, to connect it to your boards.
            </p>
          ) : (
            <>
              <span className="min-w-0">
                {account === null ? (
                  "You are signed in."
                ) : (
                  <>
                    Signed in as <span className="font-medium break-all">{account}</span>
                  </>
                )}
              </span>
              <Button
                type="button"
                size="xs"
                variant="ghost-muted"
                disabled={connecting}
                // The address only differs by its fragment, so going to it reloads nothing by itself.
                onClick={() =>
                  void clerk
                    .signOut({ redirectUrl: window.location.href })
                    .finally(() => window.location.reload())
                }
              >
                Use a different account
              </Button>
            </>
          )}
        </div>
        <div className="grid grid-cols-1 sm:flex">
          {!isLoaded && slow ? (
            <Button type="button" size="lg" variant="outline" onClick={() => location.reload()}>
              Reload
            </Button>
          ) : isLoaded && !isSignedIn ? (
            <Button type="button" size="lg" onClick={openSignIn}>
              Sign in to continue
            </Button>
          ) : (
            <Button
              type="button"
              size="lg"
              disabled={!isLoaded || connecting}
              aria-busy={connecting || undefined}
              onClick={() => void connect()}
              data-connect-computer
            >
              {connecting ? <Spinner aria-hidden /> : null}
              Connect
            </Button>
          )}
        </div>
        <p className="min-h-12 text-xs text-pretty text-muted-foreground sm:min-h-8">
          {connecting
            ? "Finishing on your computer. If you are asked to sign in again, use the same account."
            : "Only connect a computer you just opened Tinkjam Sync on. If that was not you, close this page and nothing is connected."}
        </p>
      </div>
    </ConnectCard>
  );
}

/** The welcome screen's card on the board's backdrop, top-anchored on a phone so it holds still. */
function ConnectCard({
  title,
  description,
  children,
}: {
  readonly title: string;
  readonly description: string;
  readonly children: ReactNode;
}) {
  return (
    <BoardBackdrop className="flex h-full flex-col overflow-y-auto scrollbar-gutter-both px-4 pt-12 pb-8 text-foreground motion-safe:animate-page-fade sm:pt-16 sm:pb-10">
      <main className="mx-auto mb-auto flex w-full max-w-lg shrink-0 flex-col gap-5 rounded-board border border-board-hairline bg-card p-5 text-card-foreground shadow-board motion-safe:animate-page-rise sm:my-auto sm:gap-6 sm:p-8">
        <div className="flex flex-col gap-3">
          <TinkjamWordmark wordClassName="h-5 w-auto shrink-0" markClassName="size-7 shrink-0" />
          <div className="flex flex-col gap-1.5">
            <h1 className="text-xl leading-tight font-semibold tracking-tight text-balance wrap-anywhere sm:text-2xl">
              {title}
            </h1>
            <p className="text-sm text-pretty text-muted-foreground">{description}</p>
          </div>
        </div>
        {children}
      </main>
    </BoardBackdrop>
  );
}
