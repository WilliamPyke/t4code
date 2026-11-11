import { GUEST_ROUTE_PREFIX } from "@t3tools/contracts";
import { RelayGuestLinkResolveResponse } from "@t3tools/contracts/relay";
import { createFileRoute } from "@tanstack/react-router";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { resolveCloudPublicConfig } from "../cloud/publicConfig";
import { GuestNotice } from "../components/guest/GuestThreadView";
import { guestLinkHost, guestShareOrigin } from "../guest/guestShares";
import { GUEST_PAGE_PATH } from "../guestPage";

const decodeResolved = Schema.decodeUnknownOption(RelayGuestLinkResolveResponse);

type Outcome = "opening" | "ended" | "busy" | "unreachable";

/** Asks the relay what a readable guest link stands for, and goes there when it knows. */
async function openGuestLink(name: string): Promise<Outcome> {
  const { relayUrl } = resolveCloudPublicConfig();
  if (relayUrl === null) return "unreachable";
  const response = await fetch(new URL(`/v1/guest-links/${encodeURIComponent(name)}`, relayUrl), {
    credentials: "omit",
  }).catch(() => null);
  if (response?.status === 429) return "busy";
  if (!response?.ok) return "unreachable";
  const link = Option.getOrNull(decodeResolved(await response.json().catch(() => null)))?.link;
  const host = link ? guestLinkHost(link.host) : null;
  if (!link || host === null) return "ended";
  // The relay keeps a name until it expires; only the owner's server knows the link was ended.
  const check = await fetch(`${guestShareOrigin(host)}${GUEST_ROUTE_PREFIX}/invite`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ credential: link.credential }),
    credentials: "omit",
  }).catch(() => null);
  // Only a plain refusal counts: an older server has no such route, and an offline one says so later.
  if (check?.status === 401 || check?.status === 403 || check?.status === 410) return "ended";
  const target = new URL(GUEST_PAGE_PATH, window.location.origin);
  target.searchParams.set("host", host);
  target.hash = link.credential;
  // A new document, as if the full link had been opened: the guest page reads the fragment once.
  window.location.replace(target);
  return "opening";
}

const NOTICES = {
  opening: { title: "Opening the shared thread..." },
  ended: { title: "This link has ended or is not valid", detail: "Ask the owner for a new link." },
  busy: { title: "Too many tries", detail: "Wait a minute, then open the link again." },
  unreachable: {
    title: "Could not look up this link",
    detail: "Check your connection and reload.",
  },
} as const;

function ShortGuestLinkPage() {
  return <GuestNotice {...NOTICES[Route.useLoaderData()]} />;
}

export const Route = createFileRoute("/r/$name")({
  loader: ({ params }) => openGuestLink(params.name),
  component: ShortGuestLinkPage,
});
