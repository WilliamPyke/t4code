import {
  GuestConnectionRegistration,
  GuestConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import { GuestShareAccess, type GuestShareEndpoint } from "@t3tools/client-runtime/rpc";
import {
  type CloudBoardAccountBoard,
  type GuestId,
  type GuestShareView,
  type RoomAgentActivity,
  type RoomBoxProgress,
  type RoomAgentsEvent,
  type RoomCodeState,
  type RoomCursor,
  type RoomCursorsEvent,
  type RoomViewport,
  ThreadId,
} from "@t3tools/contracts";
import { encodeBoardPreview } from "@t3tools/shared/boardPreview";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { Atom, AtomRegistry } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { sharedThreadLocationOf } from "./boardAddress";
import { linkRefusalNotice, type RefusalNotice } from "./linkRefusal.logic";
import {
  acceptedGuestLinkHost,
  cloudBoardsHosts,
  cloudBoardsOrigin,
  isCloudBoardsHost,
  guestHostZones,
  guestShareOriginOf,
} from "./cloudBoardsHost";

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
  /** Set when joined from a team's page, so the app can join again as the member. */
  team: Schema.optional(
    Schema.Struct({ id: Schema.String, environmentId: Schema.String, credential: Schema.String }),
  ),
  /** A cloud board's invite, kept so anyone on it can invite others. */
  credential: Schema.optional(Schema.String),
  /** Who this browser is on the board, once its stream said, so it can leave from anywhere. */
  guestId: Schema.optional(Schema.String),
  /**
   * The Tinkjam account this cloud board was made, joined or opened under on this browser. It goes
   * from here once that account is no longer signed in.
   */
  accountId: Schema.optional(Schema.String),
  /** Whether this person made the cloud board, so may delete it. */
  made: Schema.optional(Schema.Boolean),
  /** When this browser last opened the board. */
  openedAt: Schema.optional(Schema.String),
  /** Opened from a cloud board's view link, which is the token: it shows the board, nothing more. */
  viewOnly: Schema.optional(Schema.Boolean),
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

/**
 * What the host said when it ended each share, for the notice the share's page then shows. Joined
 * again, or forgotten for any other reason, a share's notice goes with it.
 */
export const endedShareNoticesAtom = Atom.make<ReadonlyMap<string, RefusalNotice>>(
  new Map<string, RefusalNotice>(),
).pipe(Atom.keepAlive, Atom.withLabel("ended-share-notices"));

function writeEndedNotice(shareId: string, detail: string | undefined) {
  const notices = appAtomRegistry.get(endedShareNoticesAtom);
  if (detail === undefined && !notices.has(shareId)) return;
  const next = new Map(notices);
  if (detail === undefined) next.delete(shareId);
  else next.set(shareId, linkRefusalNotice(detail));
  appAtomRegistry.set(endedShareNoticesAtom, next);
}

export function rememberGuestShare(share: JoinedGuestShare) {
  writeGuestShares([
    ...readGuestShares().filter((existing) => existing.shareId !== share.shareId),
    share,
  ]);
  writeEndedNotice(share.shareId, undefined);
}

/** Boards being opened again under a new session, which show as opening meanwhile. */
export const reopeningSharesAtom = Atom.make<ReadonlySet<string>>(new Set<string>()).pipe(
  Atom.keepAlive,
  Atom.withLabel("guest-shares-reopening"),
);
// Long enough for the connection to the board to close before the new one opens.
const REOPEN_GAP_MS = 300;

/**
 * Keeps `share` in place of the one with its id and connects to it again, so a session that
 * could only look (a view link) becomes the account's seat without reloading the page.
 */
export function reopenGuestShare(share: JoinedGuestShare) {
  appAtomRegistry.update(reopeningSharesAtom, (current) => new Set([...current, share.shareId]));
  writeGuestShares(readGuestShares().filter((existing) => existing.shareId !== share.shareId));
  setTimeout(() => {
    rememberGuestShare(share);
    appAtomRegistry.update(
      reopeningSharesAtom,
      (current) => new Set([...current].filter((shareId) => shareId !== share.shareId)),
    );
  }, REOPEN_GAP_MS);
}

// Opening a board again within this long does not count as a newer visit, so a reload writes nothing.
const OPENED_STEP_MS = 10 * 60_000;

/** Notes that this browser opened the board now, so the boards it lists come most recent first. */
export function markGuestShareOpened(shareId: string, now = new Date()) {
  const share = findGuestShare(shareId);
  if (share === null) return;
  const last = Date.parse(share.openedAt ?? share.joinedAt);
  if (Number.isFinite(last) && now.getTime() - last < OPENED_STEP_MS) return;
  rememberGuestShare({ ...share, openedAt: now.toISOString() });
}

/**
 * The signed-in account's cloud boards, as the board host lists them for every device it signs in
 * on. Null while nobody is signed in, or before the list arrives.
 */
export const accountBoardsAtom = Atom.make<ReadonlyArray<CloudBoardAccountBoard> | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("account-boards"),
);

// Per browser: the last preview of each board this browser had open, for its tile on the home
// when the board host has none to give (signed out, or before it sent one). Apart from the shares
// so an open board's changes never re-render what reads them.
const PREVIEWS_KEY = "t3code:board-previews:v1";
const PREVIEWS_KEPT = 200;
const PREVIEW_STEP_MS = 10_000;
const decodePreviews = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)),
);

function readStoredPreviews(): Readonly<Record<string, string>> {
  try {
    return Option.getOrElse(
      decodePreviews(window.localStorage.getItem(PREVIEWS_KEY) ?? "{}"),
      () => ({}),
    );
  } catch {
    return {};
  }
}

export const localBoardPreviewsAtom = Atom.make<Readonly<Record<string, string>>>(
  readStoredPreviews(),
).pipe(Atom.keepAlive, Atom.withLabel("board-previews"));

const previewWrittenAt = new Map<string, number>();
const previewTimers = new Map<string, ReturnType<typeof setTimeout>>();

function writePreviews(next: Readonly<Record<string, string>>) {
  appAtomRegistry.set(localBoardPreviewsAtom, next);
  try {
    window.localStorage.setItem(PREVIEWS_KEY, JSON.stringify(next));
  } catch {}
}

/** Keeps the open board's preview for its tile, at most once every few seconds, the last too. */
function noteBoardPreview(shareId: string, view: GuestShareView) {
  const now = Date.now();
  const wait = (previewWrittenAt.get(shareId) ?? 0) + PREVIEW_STEP_MS - now;
  if (wait > 0) {
    if (!previewTimers.has(shareId)) {
      previewTimers.set(
        shareId,
        setTimeout(() => {
          previewTimers.delete(shareId);
          const latest = appAtomRegistry.get(guestRoomAtom(shareId)).view;
          if (latest !== null && findGuestShare(shareId) !== null) {
            noteBoardPreview(shareId, latest);
          }
        }, wait),
      );
    }
    return;
  }
  const previews = appAtomRegistry.get(localBoardPreviewsAtom);
  const preview = encodeBoardPreview(view.board);
  if (previews[shareId] === preview) return;
  previewWrittenAt.set(shareId, now);
  const { [shareId]: _old, ...others } = previews;
  const kept = Object.entries(others).slice(-(PREVIEWS_KEPT - 1));
  writePreviews({ ...Object.fromEntries(kept), [shareId]: preview });
}

/**
 * Forgets a joined share: left, removed, deleted, or the host's `endedDetail` said why its link
 * no longer opens, which the share's page then shows instead of "not valid".
 */
export function forgetGuestShare(shareId: string, endedDetail?: string) {
  const shares = readGuestShares();
  if (shares.some((share) => share.shareId === shareId)) {
    writeGuestShares(shares.filter((share) => share.shareId !== shareId));
  }
  const previews = appAtomRegistry.get(localBoardPreviewsAtom);
  if (previews[shareId] !== undefined) {
    const { [shareId]: _gone, ...others } = previews;
    writePreviews(others);
  }
  // Left, removed or deleted: the host took it off the account's list too.
  const listed = appAtomRegistry.get(accountBoardsAtom);
  if (listed?.some((board) => board.shareId === shareId)) {
    appAtomRegistry.set(
      accountBoardsAtom,
      listed.filter((board) => board.shareId !== shareId),
    );
  }
  writeEndedNotice(shareId, endedDetail);
}

/** What a share's stream last said about its room. Empty until the thread is open. */
interface GuestRoomState {
  readonly view: GuestShareView | null;
  /** The guests with the thread open now, this one included. */
  readonly online: ReadonlyArray<GuestId>;
  /** On a cloud board: how many look on from its view link now. */
  readonly viewing?: number;
  /** The guests' agents running a turn on their own machines now. */
  readonly running: ReadonlyArray<RoomAgentActivity>;
  /** Where the owner's code is, once their server said. */
  readonly ownerCode?: RoomCodeState | undefined;
}
const EMPTY_ROOM: GuestRoomState = { view: null, online: [], running: [] };
export const guestRoomAtom = Atom.family((shareId: string) =>
  Atom.make<GuestRoomState>(EMPTY_ROOM).pipe(
    Atom.keepAlive,
    Atom.withLabel(`guest-room:${shareId}`),
  ),
);

/**
 * Everyone else's pointers on the room's board. Apart from the room, so a pointer moving
 * renders only the pointers.
 */
export const guestRoomCursorsAtom = Atom.family((shareId: string) =>
  Atom.make<ReadonlyArray<RoomCursor>>([]).pipe(
    Atom.keepAlive,
    Atom.withLabel(`guest-room-cursors:${shareId}`),
  ),
);

/**
 * What each thread box's agent is doing now, undefined from an older server. Apart from the room,
 * so a progress tick renders only the board's store and not the guest's whole view.
 */
export const guestRoomBoxesAtom = Atom.family((shareId: string) =>
  Atom.make<ReadonlyArray<RoomBoxProgress> | undefined>(undefined).pipe(
    Atom.keepAlive,
    Atom.withLabel(`guest-room-boxes:${shareId}`),
  ),
);

/** Everyone else's view of the board, so this guest can follow one. Apart, like the pointers. */
export const guestRoomViewsAtom = Atom.family((shareId: string) =>
  Atom.make<ReadonlyArray<RoomViewport> | undefined>(undefined).pipe(
    Atom.keepAlive,
    Atom.withLabel(`guest-room-views:${shareId}`),
  ),
);

/** The origin a share's guest routes are on. Tunnels are https; this page's own host is itself. */
export const guestShareOrigin = (host: string) =>
  guestShareOriginOf({ host, page: window.location, cloudOrigin: cloudBoardsOrigin() });

/** Whether a joined share is a board on the cloud board host, on nobody's machine. */
export const isCloudShare = (share: Pick<JoinedGuestShare, "host">) =>
  isCloudBoardsHost(share.host);

/** Where a joined share opens in this app: for links to it and for going to it. */
export const guestShareLocation = (
  share: Pick<JoinedGuestShare, "host" | "shareId" | "threadId">,
) => sharedThreadLocationOf(share, isCloudShare(share));

export const guestShareEndpointOf = (share: JoinedGuestShare): GuestShareEndpoint => ({
  httpBaseUrl: guestShareOrigin(share.host),
  shareId: share.shareId,
  token: share.token,
});

/**
 * The owner's host a guest link names, or null when the link may not be followed. A link with
 * no `host` means this page's own host, which served the page. A `host` is whatever the link's
 * author wrote, so only this deployment's tunnels and its cloud board host are accepted.
 */
export const guestLinkHost = (requested: string | null): string | null =>
  acceptedGuestLinkHost({
    requested,
    pageHost: window.location.host,
    zones: guestHostZones(),
    cloudHosts: cloudBoardsHosts(),
  });

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
        if (share !== null) noteBoardPreview(shareId, view);
        if (
          share !== null &&
          (share.title !== view.title ||
            share.owner !== view.ownerName ||
            (view.guestId !== undefined && share.guestId !== view.guestId) ||
            (view.guestId !== undefined && view.maker === view.guestId && share.made !== true))
        ) {
          const { owner: _, ...rest } = share;
          rememberGuestShare({
            ...rest,
            title: view.title,
            ...(view.ownerName === undefined ? {} : { owner: view.ownerName }),
            ...(view.guestId === undefined ? {} : { guestId: view.guestId }),
            ...(view.guestId !== undefined && view.maker === view.guestId ? { made: true } : {}),
          });
        }
      });
    }),
    presence: Effect.fn("GuestShareAccess.presence")(function (
      shareId: string,
      online: ReadonlyArray<GuestId>,
      viewing?: number,
    ) {
      return Effect.sync(() => {
        appAtomRegistry.update(guestRoomAtom(shareId), (room) => ({
          ...room,
          online,
          viewing: viewing ?? 0,
        }));
      });
    }),
    // Untraced: pointers move many times a second.
    live: Effect.fnUntraced(function* (shareId: string, event: RoomAgentsEvent | RoomCursorsEvent) {
      yield* Effect.sync(() => {
        if (event.type === "cursors") {
          appAtomRegistry.set(guestRoomCursorsAtom(shareId), event.cursors);
          appAtomRegistry.set(guestRoomViewsAtom(shareId), event.views);
        } else {
          appAtomRegistry.set(guestRoomBoxesAtom(shareId), event.boxes);
          // Box progress arrives many times a second; the room changes only when these do.
          appAtomRegistry.update(guestRoomAtom(shareId), (room) =>
            JSON.stringify([room.running, room.ownerCode]) ===
            JSON.stringify([event.running, event.owner])
              ? room
              : { ...room, running: event.running, ownerCode: event.owner },
          );
        }
      });
    }),
    ended: Effect.fn("GuestShareAccess.ended")(function (shareId: string, detail?: string) {
      return Effect.sync(() => forgetGuestShare(shareId, detail));
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
              label: isCloudShare(share) ? "Cloud" : share.host,
              httpBaseUrl: guestShareOrigin(share.host),
              shareId: share.shareId,
              threadId: share.threadId,
            }),
          }),
      ),
    ),
  );
