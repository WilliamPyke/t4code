import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import {
  GUEST_HOST_PARAM,
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
  findGuestShare,
  guestLinkHost,
  type JoinedGuestShare,
  rememberGuestShare,
} from "~/guest/guestShares";
import { redeemInvite } from "~/guest/redeemInvite";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { GuestNotice, noteGuestSignInFailure } from "./GuestThreadView";
import { inviteShareId } from "./guestStream.logic";

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
  <GuestNotice title="This link has ended or is not valid" detail="Ask the owner for a new link." />
);

/**
 * Where a guest link lands. It asks for the guest's name, joins the share on the owner's host,
 * and hands over to the app, where the thread opens beside any other thread shared with this
 * browser. A share this browser already joined opens straight away.
 */
export function GuestPage() {
  const [{ credential, host, shareId }] = useState(takeGuestEntry);
  const [joined, setJoined] = useState(() => (shareId === null ? null : findGuestShare(shareId)));
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

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      {joined !== null ? (
        <Navigate
          to="/$environmentId/$threadId"
          params={{ environmentId: guestEnvironmentId(joined.shareId), threadId: joined.threadId }}
          replace
        />
      ) : host === null || shareId === null || credential === null ? (
        INVALID
      ) : (
        <NameForm credential={credential} host={host} onJoined={setJoined} />
      )}
    </div>
  );
}

function NameForm({
  credential,
  host,
  onJoined,
}: {
  readonly credential: string;
  readonly host: string;
  readonly onJoined: (share: JoinedGuestShare) => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    rememberGuestShare(joined);
    onJoined(joined);
  };
  return (
    <form className="m-auto flex w-full max-w-xs flex-col gap-3 p-6" onSubmit={submit}>
      <h1 className="text-base font-medium">Join a shared thread</h1>
      <p className="text-xs text-muted-foreground">Shared from {host}</p>
      <label className="flex flex-col gap-1.5 text-sm" htmlFor="guest-name">
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
      <p className="text-xs text-muted-foreground">
        The owner sees your name and approves each message before the agent gets it.
      </p>
    </form>
  );
}
