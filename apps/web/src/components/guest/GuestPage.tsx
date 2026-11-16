import { useAtomValue } from "@effect/atom-react";
import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import { guestShareRequest } from "@t3tools/client-runtime/rpc";
import {
  GUEST_HOST_PARAM,
  GUEST_ROUTE_PREFIX,
  GUEST_NAME_MAX_LENGTH,
  GUEST_SHARE_PARAM,
  GUEST_SIGN_IN_PARAM,
  GuestSignInFailure,
} from "@t3tools/contracts";
import { Navigate } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { useEffect, useState, type FormEvent } from "react";

import {
  forgetGuestShare,
  guestLinkHost,
  guestShareEndpointOf,
  guestShareOrigin,
  guestSharesAtom,
  type JoinedGuestShare,
  rememberGuestShare,
} from "~/guest/guestShares";
import { readBoardName, rememberBoardName } from "~/guest/cloudBoards";
import { isCloudBoardsHost } from "~/guest/cloudBoardsHost";
import { redeemInvite } from "~/guest/redeemInvite";
import { BoardBackdrop } from "../room/BoardChrome";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GuestNotice, noteGuestSignInFailure } from "./GuestThreadView";
import { guestEntryStep, inviteShareId } from "./guestStream.logic";

interface GuestEntry {
  /** Unspent invite from the URL hash, if this load came from a link. */
  readonly credential: string | null;
  /** The owner's host the link names, or null when the link may not be followed. */
  readonly host: string | null;
  readonly shareId: string | null;
}

// The entry is read once per address: reading it rewrites the address, and a second read (as
// React's development double render makes) must not find the credential gone.
let captured: { readonly href: string; readonly entry: GuestEntry } | null = null;

const decodeSignInFailure = Schema.decodeUnknownOption(GuestSignInFailure);

/**
 * The invite credential travels in the URL hash so it never reaches a server log. It is read
 * once and removed from history, so it lives only in memory. Opening the page never redeems it:
 * only submitting a name does, so a reload before that leaves the link usable.
 */
function takeGuestEntry(): GuestEntry {
  if (captured === null || captured.href !== window.location.href) {
    // A malformed fragment is an invalid link, not a crash.
    let credential = "";
    try {
      credential = decodeURIComponent(window.location.hash.slice(1)).trim();
    } catch {}
    const query = new URLSearchParams(window.location.search);
    const requestedHost = query.get(GUEST_HOST_PARAM);
    const shareId = credential !== "" ? inviteShareId(credential) : query.get(GUEST_SHARE_PARAM);
    const signInFailure = Option.getOrNull(decodeSignInFailure(query.get(GUEST_SIGN_IN_PARAM)));
    if (shareId !== null && signInFailure !== null) noteGuestSignInFailure(shareId, signInFailure);
    // The share and its host stay in the URL, so a reload finds this browser's session for it.
    const kept = new URLSearchParams();
    if (requestedHost !== null) kept.set(GUEST_HOST_PARAM, requestedHost);
    if (shareId !== null) kept.set(GUEST_SHARE_PARAM, shareId);
    window.history.replaceState(
      window.history.state,
      "",
      kept.size === 0 ? window.location.pathname : `${window.location.pathname}?${kept}`,
    );
    captured = {
      href: window.location.href,
      entry: {
        credential: credential === "" ? null : credential,
        host: guestLinkHost(requestedHost),
        shareId,
      },
    };
  }
  return captured.entry;
}

const INVALID = (
  <GuestNotice
    title="This board has ended, or the link is not valid"
    detail="Ask whoever shared it with you for a new link."
  />
);

/**
 * Where a guest link lands. It asks for the guest's name, joins the share on the owner's host,
 * and hands over to the app, where the thread opens beside any other thread shared with this
 * browser. A share this browser already joined opens straight away.
 */
export function GuestPage() {
  const [entry] = useState(takeGuestEntry);
  const { credential, host } = entry;
  const shares = useAtomValue(guestSharesAtom);
  const [joined, setJoined] = useState<JoinedGuestShare | null>(null);
  const step = guestEntryStep(shares, entry);
  const checking = joined === null && step.step === "check" ? step.share : null;
  // Pasting another guest link into this tab changes only the hash, which does not reload the
  // page; reload so the new invite is read instead of the one already captured.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hashchange listener reloads the page when another guest link is pasted into this tab
  useEffect(() => {
    const onHashChange = () => {
      if (window.location.hash !== "") window.location.reload();
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the share's host whether this browser's stored session still works before reusing it
  useEffect(() => {
    if (checking === null) return;
    let stopped = false;
    void guestShareRequest(guestShareEndpointOf(checking), GUEST_SESSION_ROUTE).then(
      (response) => {
        if (stopped) return;
        // Only a refusal joins again; anything else opens the board, which says what is wrong.
        if (SESSION_REFUSED.has(response.status)) forgetGuestShare(checking.shareId);
        else setJoined(checking);
      },
      () => {
        if (!stopped) setJoined(checking);
      },
    );
    return () => {
      stopped = true;
    };
  }, [checking]);

  const open = joined ?? (step.step === "open" ? step.share : null);
  return (
    <BoardBackdrop className="flex h-dvh flex-col px-4 text-foreground">
      {open !== null ? (
        <Navigate
          to="/$environmentId/$threadId"
          params={{ environmentId: guestEnvironmentId(open.shareId), threadId: open.threadId }}
          replace
        />
      ) : checking !== null ? (
        <GuestNotice title="Opening the board..." />
      ) : step.step === "invalid" || host === null || credential === null ? (
        INVALID
      ) : (
        <NameForm
          credential={credential}
          host={host}
          onJoined={(share) => {
            rememberGuestShare(share);
            setJoined(share);
          }}
        />
      )}
    </BoardBackdrop>
  );
}

const GUEST_SESSION_ROUTE = `${GUEST_ROUTE_PREFIX}/session`;
const SESSION_REFUSED = new Set([401, 403, 410]);

function NameForm({
  credential,
  host,
  onJoined,
}: {
  readonly credential: string;
  readonly host: string;
  readonly onJoined: (share: JoinedGuestShare) => void;
}) {
  const [name, setName] = useState(() => readBoardName() ?? "");
  const cloud = isCloudBoardsHost(host);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the host whether the invite still opens anything before asking for a name
  useEffect(() => {
    let stopped = false;
    void fetch(`${guestShareOrigin(host)}${GUEST_ROUTE_PREFIX}/invite`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential }),
      credentials: "omit",
    }).then(
      // Only a plain refusal counts: an older host has no such route.
      (response) => {
        if (!stopped && SESSION_REFUSED.has(response.status)) setEnded(true);
      },
      () => {},
    );
    return () => {
      stopped = true;
    };
  }, [credential, host]);
  if (ended) return INVALID;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || submitting) return;
    setSubmitting(true);
    const joined = await redeemInvite({ credential, host, name: trimmed });
    setSubmitting(false);
    if (typeof joined === "string") {
      setError(joined);
      return;
    }
    rememberBoardName(trimmed);
    onJoined(joined);
  };
  return (
    <form
      className="m-auto flex w-full max-w-sm flex-col gap-4 rounded-board border border-board-hairline bg-card p-6 text-card-foreground shadow-board"
      onSubmit={submit}
    >
      <div className="flex flex-col gap-1">
        <h1 className="text-lg font-semibold tracking-tight">Join a shared board</h1>
        <p className="text-sm text-muted-foreground">
          {cloud ? (
            "This board lives in the cloud. Everyone on it sees your name."
          ) : (
            <>
              Shared with you from <span className="font-medium text-foreground">{host}</span>
            </>
          )}
        </p>
      </div>
      <label className="flex flex-col gap-1.5 text-sm font-medium" htmlFor="guest-name">
        Your name
        <Input
          id="guest-name"
          autoFocus
          autoComplete="name"
          maxLength={GUEST_NAME_MAX_LENGTH}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      {error !== null ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" disabled={submitting || name.trim() === ""}>
        Join
      </Button>
      {cloud ? null : (
        <p className="text-xs text-muted-foreground">
          The owner sees your name and approves each message before the agent gets it.
        </p>
      )}
    </form>
  );
}
