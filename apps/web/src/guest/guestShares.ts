import {
  GuestConnectionRegistration,
  GuestConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import { GuestShareAccess, type GuestShareEndpoint } from "@t3tools/client-runtime/rpc";
import { type GuestId, type GuestShareView, ThreadId } from "@t3tools/contracts";
import { guestHostZoneOf, isGuestHostAllowed } from "@t3tools/shared/guestLinks";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom, AtomRegistry } from "effect/reactivity";

import { configuredHostedAppUrl } from "../hostedPairing";
import { appAtomRegistry } from "../rpc/atomRegistry";

/**
 * A thread someone shared that this browser joined. The token is the guest session for that one
 * share: it reads the thread and proposes messages for a day, and opens nothing else.
 */
const JoinedGuestShare = Schema.Struct({
  /** The owner's host, which serves the share's guest routes. */
  host: Schema.String,
  shareId: Schema.String,
  threadId: ThreadId,
  token: Schema.String,
  title: Schema.String,
  /** Who shared it, once the owner's server has said. */
  owner: Schema.optional(Schema.String),
  joinedAt: Schema.String,
});
export type JoinedGuestShare = typeof JoinedGuestShare.Type;

const STORAGE_KEY = "t3code:guest-shares:v1";
const decodeStored = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Array(JoinedGuestShare)),
);

function readStored(): ReadonlyArray<JoinedGuestShare> {
  try {
    return Option.getOrElse(
      decodeStored(window.localStorage.getItem(STORAGE_KEY) ?? "[]"),
      () => [],
    );
  } catch {
    return [];
  }
}

export const guestSharesAtom = Atom.make<ReadonlyArray<JoinedGuestShare>>(readStored()).pipe(
  Atom.keepAlive,
  Atom.withLabel("guest-shares"),
);

export const readGuestShares = () => appAtomRegistry.get(guestSharesAtom);
export const hasGuestShares = () => readGuestShares().length > 0;
export const findGuestShare = (shareId: string) =>
  readGuestShares().find((share) => share.shareId === shareId) ?? null;

function writeGuestShares(next: ReadonlyArray<JoinedGuestShare>) {
  appAtomRegistry.set(guestSharesAtom, next);
  // Storage can be blocked. The share then lasts as long as the page does.
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {}
}

export function rememberGuestShare(share: JoinedGuestShare) {
  writeGuestShares([
    ...readGuestShares().filter((existing) => existing.shareId !== share.shareId),
    share,
  ]);
}

export function forgetGuestShare(shareId: string) {
  const shares = readGuestShares();
  if (shares.some((share) => share.shareId === shareId)) {
    writeGuestShares(shares.filter((share) => share.shareId !== shareId));
  }
}

/** What a share's stream last said about its room. Empty until the thread is open. */
interface GuestRoomState {
  readonly view: GuestShareView | null;
  /** The guests with the thread open now, this one included. */
  readonly online: ReadonlyArray<GuestId>;
}
const EMPTY_ROOM: GuestRoomState = { view: null, online: [] };
export const guestRoomAtom = Atom.family((shareId: string) =>
  Atom.make<GuestRoomState>(EMPTY_ROOM).pipe(
    Atom.keepAlive,
    Atom.withLabel(`guest-room:${shareId}`),
  ),
);

/** The origin a share's guest routes are on. Tunnels are https; this page's own host is itself. */
export const guestShareOrigin = (host: string) =>
  host === window.location.host ? window.location.origin : `https://${host}`;

export const guestShareEndpointOf = (share: JoinedGuestShare): GuestShareEndpoint => ({
  httpBaseUrl: guestShareOrigin(share.host),
  shareId: share.shareId,
  token: share.token,
});

/**
 * The zone this deployment's tunnels live in. `VITE_GUEST_HOST_ZONE` names it; without it, it is
 * the hosted app's own host minus its first label.
 */
const guestHostZone = (): string | null =>
  import.meta.env.VITE_GUEST_HOST_ZONE?.trim() || guestHostZoneOf(configuredHostedAppUrl());

/**
 * The owner's host a guest link names, or null when the link may not be followed. A link with
 * no `host` means this page's own host, which served the page. A `host` is whatever the link's
 * author wrote, so only this deployment's tunnels are accepted.
 */
export function guestLinkHost(requested: string | null): string | null {
  if (requested === null || requested === window.location.host) return window.location.host;
  return isGuestHostAllowed(requested, guestHostZone()) ? requested : null;
}

/** How the connection runtime reads the joined shares and reports what their streams say. */
export const layerGuestShareAccess = Layer.succeed(
  GuestShareAccess,
  GuestShareAccess.of({
    share: Effect.fn("GuestShareAccess.share")(function (shareId: string) {
      return Effect.sync(() =>
        Option.map(Option.fromNullishOr(findGuestShare(shareId)), ({ token, title }) => ({
          token,
          title,
        })),
      );
    }),
    viewed: Effect.fn("GuestShareAccess.viewed")(function (shareId: string, view: GuestShareView) {
      return Effect.sync(() => {
        appAtomRegistry.update(guestRoomAtom(shareId), (room) => ({ ...room, view }));
        const share = findGuestShare(shareId);
        if (share !== null && (share.title !== view.title || share.owner !== view.ownerName)) {
          const { owner: _, ...rest } = share;
          rememberGuestShare({
            ...rest,
            title: view.title,
            ...(view.ownerName === undefined ? {} : { owner: view.ownerName }),
          });
        }
      });
    }),
    presence: Effect.fn("GuestShareAccess.presence")(function (
      shareId: string,
      online: ReadonlyArray<GuestId>,
    ) {
      return Effect.sync(() => {
        appAtomRegistry.update(guestRoomAtom(shareId), (room) => ({ ...room, online }));
      });
    }),
    ended: Effect.fn("GuestShareAccess.ended")(function (shareId: string) {
      return Effect.sync(() => forgetGuestShare(shareId));
    }),
  }),
);

/** One environment per joined share, as the registry's platform source lists them. */
export const guestShareRegistrations: Stream.Stream<ReadonlyArray<GuestConnectionRegistration>> =
  AtomRegistry.toStream(appAtomRegistry, guestSharesAtom).pipe(
    Stream.map((shares) =>
      shares.map(
        (share) =>
          new GuestConnectionRegistration({
            target: new GuestConnectionTarget({
              environmentId: guestEnvironmentId(share.shareId),
              label: share.host,
              httpBaseUrl: guestShareOrigin(share.host),
              shareId: share.shareId,
              threadId: share.threadId,
            }),
          }),
      ),
    ),
  );
