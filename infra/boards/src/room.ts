import {
  GUEST_NAME_MAX_LENGTH,
  roomBoardAgentCard,
  roomBoardGuestCard,
  type GuestCursorRequest,
  type GuestId,
  type GuestShareId,
  type GuestShareView,
  type RoomBoard,
  type RoomBoardChange,
  type RoomAgentsEvent,
  type RoomBoardDrag,
  type RoomCursorsEvent,
  type ThreadGuest,
  type ThreadGuestTurn,
  type ThreadId,
} from "@t3tools/contracts";
import { roomBoardAfterChange, roomWithoutGuest } from "@t3tools/shared/guestRoom";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import { EMPTY_ROOM_BOARD, ROOM_BOARD_FULL, type RoomBoardScope } from "@t3tools/shared/roomBoard";
import * as Result from "effect/Result";

import type { CloudMachineToken } from "./machines.ts";

/**
 * A board on the cloud board host: it lives on nobody's machine, so it has no owner, no thread and
 * no agent of its own. Everyone on it is a guest, and each can bring their own machine's agent.
 * Secrets are kept only as SHA-256 hashes.
 */
export interface CloudRoom {
  readonly shareId: GuestShareId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly inviteHash: string;
  readonly guests: ReadonlyArray<CloudGuest>;
  /** Absent until someone changes the board. */
  readonly board?: RoomBoard;
  /** Turns people's machines ran outside a box of theirs, newest last. */
  readonly turns?: ReadonlyArray<ThreadGuestTurn>;
  /** Handoff and room tokens of people's machines. */
  readonly machines?: ReadonlyArray<CloudMachineToken>;
  /** Who made the board. Absent on boards made before it was kept, and once the maker left. */
  readonly maker?: GuestId;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CloudGuest {
  readonly id: GuestId;
  readonly name: string;
  readonly joinedAt: string;
  readonly sessionHash: string;
  /** Sessions the export gave this person's machines, so the app there shows the board too. */
  readonly machineSessions?: ReadonlyArray<string>;
}

export const DEFAULT_BOARD_TITLE = "Untitled board";
// Cloud boards do not end; the view still needs a time.
export const FAR_EXPIRY = "9999-12-31T23:59:59.999Z";

const FAILURES = {
  invalid: { status: 403, message: "This board link is not valid." },
  inactive: { status: 403, message: "This board is no longer available." },
  full: { status: 409, message: "This board already has as many people as it holds." },
  exists: { status: 409, message: "This board already exists." },
  board_full: { status: 409, message: ROOM_BOARD_FULL },
  rejected: { status: 409, message: "The board did not take this change." },
  // As a machine answers for a room that ended, so a client forgets the board and a machine
  // joined to it stops posting.
  ended: { status: 410, message: "This board was deleted, or you are no longer on it." },
  not_maker: { status: 403, message: "Only the person who made this board can do this." },
  too_fast: { status: 429, message: "Too many requests at once. Try again in a minute." },
  too_large: { status: 400, message: "This request is too large." },
  bad_request: { status: 400, message: "The request was not valid." },
  unavailable: { status: 404, message: "Cloud boards do not have this yet." },
  empty: { status: 400, message: "Write something first." },
  artifact_gone: { status: 404, message: "This artifact is no longer on the board." },
  not_on_board: {
    status: 404,
    message: "This thread is not on a board. Only one of its thread boxes can use it.",
  },
} as const;

export type RoomFailureReason = keyof typeof FAILURES;

export interface RoomFailure {
  readonly status: number;
  /** What the client reads; `bad_request` goes out as `invalid`, as the machine host says it. */
  readonly reason: string;
  readonly message: string;
}

export const roomFailure = (reason: RoomFailureReason, message?: string): RoomFailure => ({
  status: FAILURES[reason].status,
  reason: reason === "bad_request" ? "invalid" : reason,
  message: message ?? FAILURES[reason].message,
});

const NEEDS_AN_OWNER =
  "A cloud board cannot do this: it has no owner whose machine would serve it.";

/**
 * Changes that need the room's owner, whom a cloud board does not have: code and pull request
 * windows (the owner's server fills them), comments pinned to the room thread's messages, and
 * tasks for the owner. People's own thread boxes, artifacts and what their agents do with them
 * follow the same rules as on a room an owner's machine serves.
 */
export function needsAnOwner(change: RoomBoardChange): boolean {
  return (
    change.type === "note.put" &&
    (change.kind === "code" ||
      change.kind === "pull-request" ||
      change.pinnedTo !== undefined ||
      (change.assignee !== undefined &&
        change.assignee !== null &&
        change.assignee.guestId === undefined))
  );
}

const freeGuestName = (guests: ReadonlyArray<CloudGuest>, wanted: string) => {
  const base = wanted.slice(0, GUEST_NAME_MAX_LENGTH - 3);
  const taken = new Set(guests.map((guest) => guest.name.toLowerCase()));
  let name = wanted;
  for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) name = `${base} ${suffix}`;
  return name;
};

export function createRoom(input: {
  readonly shareId: GuestShareId;
  readonly threadId: ThreadId;
  readonly title: string | undefined;
  readonly inviteHash: string;
  readonly maker: Omit<CloudGuest, "joinedAt">;
  readonly now: string;
}): CloudRoom {
  return {
    shareId: input.shareId,
    threadId: input.threadId,
    title: input.title ?? DEFAULT_BOARD_TITLE,
    inviteHash: input.inviteHash,
    guests: [{ ...input.maker, joinedAt: input.now }],
    maker: input.maker.id,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export const checkInvite = (room: CloudRoom | null, inviteHash: string): RoomFailure | null =>
  room === null || room.inviteHash !== inviteHash ? roomFailure("invalid") : null;

// A machine's link holds few guests because its owner can clear them; nobody clears a cloud board.
export const CLOUD_BOARD_MAX_GUESTS = 50;

/** Joins the board. Like a machine's link, every join is a new guest, even the same person's. */
export function joinRoom(
  room: CloudRoom | null,
  input: Omit<CloudGuest, "joinedAt"> & { readonly inviteHash: string; readonly now: string },
): Result.Result<CloudRoom, RoomFailure> {
  const refused = checkInvite(room, input.inviteHash);
  if (room === null || refused !== null) return Result.fail(refused ?? roomFailure("invalid"));
  if (room.guests.length >= CLOUD_BOARD_MAX_GUESTS) return Result.fail(roomFailure("full"));
  const guest: CloudGuest = {
    id: input.id,
    name: freeGuestName(room.guests, input.name),
    joinedAt: input.now,
    sessionHash: input.sessionHash,
  };
  return Result.succeed({ ...room, guests: [...room.guests, guest], updatedAt: input.now });
}

export const guestBySession = (room: CloudRoom | null, sessionHash: string) =>
  room?.guests.find(
    (guest) =>
      guest.sessionHash === sessionHash || guest.machineSessions?.includes(sessionHash) === true,
  );

export const renameRoom = (room: CloudRoom, title: string, now: string): CloudRoom =>
  room.title === title ? room : { ...room, title, updatedAt: now };

export const roomScope = (room: CloudRoom): RoomBoardScope => ({
  hasCard: (cardId) =>
    room.guests.some(
      (guest) => cardId === roomBoardGuestCard(guest.id) || cardId === roomBoardAgentCard(guest.id),
    ),
  hasPerson: (guestId) => room.guests.some((guest) => guest.id === guestId),
});

/** A guest's change, applied by the same rules a machine's room uses, authored by that guest. */
export function changeBoard(
  room: CloudRoom,
  author: GuestId,
  change: RoomBoardChange,
  now: string,
): Result.Result<CloudRoom, RoomFailure> {
  if (needsAnOwner(change)) return Result.fail(roomFailure("rejected", NEEDS_AN_OWNER));
  const cleaned =
    change.type === "note.put" || change.type === "comment.reply"
      ? // Characters nobody can see have no place in text the whole room reads.
        { ...change, text: sanitizeLinkedPrompt(change.text).text }
      : change;
  const applied = roomBoardAfterChange(room, roomScope(room), author, cleaned, undefined, now);
  if (Result.isFailure(applied)) {
    return Result.fail(
      applied.failure === ROOM_BOARD_FULL
        ? roomFailure("board_full")
        : roomFailure("rejected", applied.failure),
    );
  }
  return Result.succeed(
    applied.success === (room.board ?? EMPTY_ROOM_BOARD)
      ? room
      : { ...room, board: applied.success, updatedAt: now },
  );
}

/** Only the board's maker deletes it. */
export const checkDelete = (room: CloudRoom, by: GuestId): RoomFailure | null =>
  room.maker !== undefined && room.maker === by ? null : roomFailure("not_maker");

/**
 * Takes `guestId` off the board, by the same rule as an owner removing a guest from a machine's
 * room: their cards, replies, reactions, turns and machines' tokens go with them. The maker
 * removes anyone else; anyone removes themselves (leaving), the maker too, which leaves the board
 * with no maker. Someone already gone leaves the room as it was.
 */
export function removePerson(
  room: CloudRoom,
  by: GuestId,
  guestId: GuestId,
  now: string,
): Result.Result<CloudRoom, RoomFailure> {
  if (by !== guestId && (room.maker === undefined || room.maker !== by)) {
    return Result.fail(roomFailure("not_maker"));
  }
  if (!room.guests.some((guest) => guest.id === guestId)) return Result.succeed(room);
  const { maker, machines, ...rest } = roomWithoutGuest(room, guestId);
  const kept = machines?.filter((token) => token.guestId !== guestId);
  return Result.succeed({
    ...rest,
    ...(maker === undefined || maker === guestId ? {} : { maker }),
    ...(kept === undefined ? {} : { machines: kept }),
    updatedAt: now,
  });
}

const DAY_MS = 24 * 60 * 60_000;
/** A board nobody opened or changed for this long is deleted. */
export const IDLE_BOARD_MS = 90 * DAY_MS;
/** A board nobody changed since it was made (one person, nothing on it) goes after this. */
export const UNTOUCHED_BOARD_MS = DAY_MS;
// The deletion moves on at most once a day, so it comes between 90 and 91 days after the last use.
const ALARM_STEP_MS = DAY_MS;

/**
 * When the board should be deleted, given the alarm already set (`scheduled`, epoch ms), or null
 * when that alarm still stands. A board never changed since it was made goes a day after it was
 * made; any other goes once nobody used it for `IDLE_BOARD_MS`.
 */
export function boardAlarmAt(
  room: Pick<CloudRoom, "createdAt" | "updatedAt">,
  now: number,
  scheduled: number | null,
): number | null {
  if (room.updatedAt === room.createdAt) {
    const at = Date.parse(room.createdAt) + UNTOUCHED_BOARD_MS;
    return scheduled === at ? null : at;
  }
  const at = now + IDLE_BOARD_MS + ALARM_STEP_MS;
  return scheduled !== null && at - scheduled < ALARM_STEP_MS ? null : at;
}

const CLOUD_MODEL = { driver: null, name: "Cloud board" } as const;

export function viewFor(room: CloudRoom, guest: CloudGuest): GuestShareView {
  return {
    shareId: room.shareId,
    title: room.title,
    guestName: guest.name,
    guestId: guest.id,
    guests: room.guests.map(({ id, name, joinedAt }): ThreadGuest => ({ id, name, joinedAt })),
    direct: false,
    signIn: false,
    expiresAt: FAR_EXPIRY,
    messages: [],
    turns: room.turns ?? [],
    ...(room.board === undefined ? {} : { board: room.board }),
    cloud: true,
    machines: true,
    ...(room.maker === undefined ? {} : { maker: room.maker }),
    model: CLOUD_MODEL,
  };
}

/**
 * The thread a guest's client waits for before it calls the room live: a snapshot of an empty
 * thread, already in its JSON form.
 */
export function emptyThreadSnapshot(room: CloudRoom) {
  const id = room.threadId;
  return {
    kind: "snapshot",
    snapshotSequence: 0,
    projection: {
      thread: {
        createdBy: "user",
        creationSource: "web",
        id,
        projectId: "shared",
        title: room.title.trim() === "" ? DEFAULT_BOARD_TITLE : room.title,
        providerInstanceId: "shared",
        modelSelection: { instanceId: "shared", model: "shared" },
        runtimeMode: "approval-required",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        activeProviderThreadId: null,
        lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: id },
        forkedFrom: null,
        createdAt: room.createdAt,
        updatedAt: room.updatedAt,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        lastVisitedAt: null,
        deletedAt: null,
      },
      runs: [],
      attempts: [],
      nodes: [],
      subagents: [],
      providerSessions: [],
      providerThreads: [],
      providerTurns: [],
      runtimeRequests: [],
      messages: [],
      plans: [],
      turnItems: [],
      checkpointScopes: [],
      checkpoints: [],
      contextHandoffs: [],
      contextTransfers: [],
      visibleTurnItems: [],
      updatedAt: room.updatedAt,
    },
    historyCursor: null,
    hasMoreHistory: false,
    latestLocalTurnOrdinal: null,
  } as const;
}

/** What a stream sends, in the JSON form a `GuestStreamEvent` decodes from. */
export type CloudStreamEvent =
  | { readonly type: "view"; readonly view: GuestShareView }
  | { readonly type: "thread"; readonly item: ReturnType<typeof emptyThreadSnapshot> }
  | { readonly type: "presence"; readonly online: ReadonlyArray<GuestId> }
  | RoomCursorsEvent
  | RoomAgentsEvent
  | { readonly type: "ended" };

export const sseFrame = (event: CloudStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

/** What a newly opened stream gets first, in the order a guest's client needs it. */
export const openingEvents = (
  room: CloudRoom,
  guest: CloudGuest,
  online: ReadonlyArray<GuestId>,
): ReadonlyArray<CloudStreamEvent> => [
  { type: "view", view: viewFor(room, guest) },
  { type: "thread", item: emptyThreadSnapshot(room) },
  { type: "presence", online },
];

/** The guests with a stream open, each once, in a stable order. */
export const onlineOf = (guestIds: Iterable<GuestId>): ReadonlyArray<GuestId> =>
  [...new Set(guestIds)].toSorted();

// Pointers and views are live only: never stored, and each one expires, as on a machine's room.
const CURSOR_TTL_MS = 60_000;
// A held drag is posted every second; one not posted for this long ended with its page.
const DRAG_TTL_MS = 2_000;
const VIEW_TTL_MS = 10 * 60_000;
const CURSOR_RATE_LIMIT = 20;
const CURSOR_RATE_WINDOW_MS = 1_000;

interface LiveCursor {
  readonly x: number;
  readonly y: number;
  readonly drag?: RoomBoardDrag;
  readonly dragUntil?: number;
  readonly until: number;
}
interface LiveView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
  readonly until: number;
}
export interface RoomLive {
  readonly cursors: ReadonlyMap<GuestId, LiveCursor>;
  readonly views: ReadonlyMap<GuestId, LiveView>;
  readonly moves: ReadonlyMap<GuestId, ReadonlyArray<number>>;
}
export const EMPTY_LIVE: RoomLive = { cursors: new Map(), views: new Map(), moves: new Map() };

/** Moves a guest's pointer and view, or says they move too fast. */
export function moveCursor(
  live: RoomLive,
  guestId: GuestId,
  request: GuestCursorRequest,
  now: number,
): Result.Result<RoomLive, RoomFailure> {
  const moving = request.at !== null || (request.view !== undefined && request.view !== null);
  const recent = (live.moves.get(guestId) ?? []).filter((at) => at > now - CURSOR_RATE_WINDOW_MS);
  if (moving && recent.length >= CURSOR_RATE_LIMIT) return Result.fail(roomFailure("too_fast"));
  const moves = new Map(live.moves).set(guestId, moving ? [...recent, now] : recent);
  const cursors = new Map(live.cursors);
  if (request.at === null) cursors.delete(guestId);
  else {
    cursors.set(guestId, {
      x: request.at.x,
      y: request.at.y,
      ...(request.drag === undefined ? {} : { drag: request.drag, dragUntil: now + DRAG_TTL_MS }),
      until: now + CURSOR_TTL_MS,
    });
  }
  if (request.view === undefined) return Result.succeed({ ...live, cursors, moves });
  const views = new Map(live.views);
  if (request.view === null) views.delete(guestId);
  else views.set(guestId, { ...request.view, until: now + VIEW_TTL_MS });
  return Result.succeed({ cursors, views, moves });
}

/** The room once a guest has no stream open: their pointer and view go. */
export function withoutPerson(live: RoomLive, guestId: GuestId): RoomLive {
  if (!live.cursors.has(guestId) && !live.views.has(guestId) && !live.moves.has(guestId)) {
    return live;
  }
  const cursors = new Map(live.cursors);
  const views = new Map(live.views);
  const moves = new Map(live.moves);
  cursors.delete(guestId);
  views.delete(guestId);
  moves.delete(guestId);
  return { cursors, views, moves };
}

/** Everyone else's unexpired pointers and views, as `reader` gets them. */
export function cursorsEventFor(live: RoomLive, reader: GuestId, now: number): RoomCursorsEvent {
  const others = <V extends { readonly until: number }>(entries: ReadonlyMap<GuestId, V>) =>
    [...entries]
      .filter(([guestId, entry]) => guestId !== reader && entry.until > now)
      .toSorted(([left], [right]) => left.localeCompare(right));
  return {
    type: "cursors",
    cursors: others(live.cursors).map(([guestId, { x, y, drag, dragUntil }]) =>
      drag === undefined || (drag.done !== true && (dragUntil ?? 0) <= now)
        ? { guestId, x, y }
        : { guestId, x, y, drag },
    ),
    views: others(live.views).map(([guestId, { x, y, zoom }]) => ({ guestId, x, y, zoom })),
  };
}

/**
 * Durable Object storage keeps at most 128 KiB in one value, and a board with its artifacts full
 * holds more, so the room is kept as JSON in pieces. 32,000 UTF-16 units stay under that however
 * the characters are encoded.
 */
export const ROOM_CHUNK_CHARS = 32_000;
/** As many keys as one storage write takes, the count among them. */
export const ROOM_MAX_CHUNKS = 127;

export function roomChunks(room: CloudRoom): ReadonlyArray<string> {
  const json = JSON.stringify(room);
  const chunks: Array<string> = [];
  for (let at = 0; at < json.length; at += ROOM_CHUNK_CHARS) {
    chunks.push(json.slice(at, at + ROOM_CHUNK_CHARS));
  }
  return chunks;
}

export const roomOfChunks = (chunks: ReadonlyArray<string>): CloudRoom =>
  JSON.parse(chunks.join("")) as CloudRoom;
