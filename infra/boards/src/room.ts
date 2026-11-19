import {
  GUEST_NAME_MAX_LENGTH,
  roomBoardAgentCard,
  roomBoardGuestCard,
  type CloudBoardLinkKind,
  type CloudBoardLinkSharing,
  type CloudBoardRole,
  type GuestCursorRequest,
  type GuestId,
  type GuestInvitePreview,
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
  /** The workspace whose members may open the board without its invite. */
  readonly workspaceId?: string;
  /**
   * The edit link's credential, shown to those who may hand it on. Absent on boards made before it
   * was kept, until the link is made again; `inviteHash` is empty while the link is off.
   */
  readonly editLink?: string;
  /** The view link, which shows the board to anyone who has it. Absent while it is off. */
  readonly viewLink?: { readonly credential: string; readonly hash: string };
  /** Who the links let in now; see `linkSharingOf`. Absent on boards from before it was kept. */
  readonly sharing?: CloudBoardLinkSharing;
  /** Requests for edit access, open ones and the last few answered. */
  readonly requests?: ReadonlyArray<AccessRequest>;
  /** Anyone who can see the board may make their own copy of it, as its maker allowed. */
  readonly allowCopies?: true;
  /** The task and mention items the board sent lately, so it never sends one twice. */
  readonly notified?: ReadonlyArray<{ readonly key: string; readonly at: string }>;
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
  /** The Tinkjam account (Clerk user id) this person is, once they signed in with it here. */
  readonly accountId?: string;
  /** Sessions the account opened on its other devices, each the same person as this one. */
  readonly accountSessions?: ReadonlyArray<string>;
  /**
   * Taken out of the board's workspace: their cards stay theirs, but nothing opens the board as
   * them until the workspace has them back.
   */
  readonly locked?: true;
  /** Can only look at the board, as the maker set them. Absent: they can change it. */
  readonly role?: "viewer";
  /** When the board last put something in this person's account inbox. */
  readonly inboxAt?: string;
}

/** Someone signed in who asked to edit the board. `account` is never sent to anyone. */
export interface AccessRequest {
  readonly id: string;
  readonly account: string;
  readonly name: string;
  readonly message?: string;
  readonly at: string;
  readonly status: "open" | "approved" | "declined";
  readonly answeredAt?: string;
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
  signed_out: { status: 401, message: "Your sign-in ran out. Sign in again and try once more." },
  taken: { status: 409, message: "You are on this board as someone else already." },
  too_fast: { status: 429, message: "Too many requests at once. Try again in a minute." },
  too_large: { status: 400, message: "This request is too large." },
  bad_request: { status: 400, message: "The request was not valid." },
  unavailable: { status: 404, message: "Cloud boards do not have this yet." },
  empty: { status: 400, message: "Write something first." },
  artifact_gone: { status: 404, message: "This artifact is no longer on the board." },
  not_member: { status: 403, message: "You are not in this workspace." },
  not_owner: { status: 403, message: "Only an owner of this workspace can do this." },
  last_owner: {
    status: 409,
    message: "Make someone else an owner first, or delete the workspace.",
  },
  limit: { status: 409, message: "This is as many as Tinkjam holds." },
  not_in_workspace: { status: 404, message: "This board is no longer in this workspace." },
  not_on_board: {
    status: 404,
    message: "This thread is not on a board. Only one of its thread boxes can use it.",
  },
  view_only: { status: 403, message: "You can look at this board, but not change it." },
  viewers_full: {
    status: 409,
    message: "As many people are looking at this board as it holds. Try again in a while.",
  },
  asked: { status: 409, message: "You already asked. The answer will come to your inbox." },
  copies_off: { status: 403, message: "Whoever made this board has not allowed copies." },
} as const;

export type RoomFailureReason = keyof typeof FAILURES;

export interface RoomFailure {
  readonly status: number;
  /** What the client reads; `bad_request` goes out as `invalid`, as the machine host says it. */
  readonly reason: string;
  readonly message: string;
  /** Which refusal it is, for a client new enough to choose its own words. */
  readonly detail?: string;
}

export const roomFailure = (
  reason: RoomFailureReason,
  message?: string,
  detail?: string,
): RoomFailure => ({
  status: FAILURES[reason].status,
  reason: reason === "bad_request" ? "invalid" : reason,
  message: message ?? FAILURES[reason].message,
  ...(detail === undefined ? {} : { detail }),
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

export const freeGuestName = (guests: ReadonlyArray<CloudGuest>, wanted: string) => {
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
  /** The edit link's credential, whose hash is `inviteHash`. */
  readonly editLink?: string;
  readonly maker: Omit<CloudGuest, "joinedAt">;
  readonly now: string;
}): CloudRoom {
  return {
    shareId: input.shareId,
    threadId: input.threadId,
    title: input.title ?? DEFAULT_BOARD_TITLE,
    inviteHash: input.inviteHash,
    ...(input.editLink === undefined ? {} : { editLink: input.editLink }),
    guests: [{ ...input.maker, joinedAt: input.now }],
    maker: input.maker.id,
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/**
 * The board's link sharing. A board from before it was kept shares as its links say: the edit
 * link while it is on, else the view link while that is on.
 */
export const linkSharingOf = (room: CloudRoom): CloudBoardLinkSharing =>
  room.sharing ?? (room.inviteHash !== "" ? "edit" : room.viewLink !== undefined ? "view" : "off");

// Each keeps the "not valid" reason an older client already knows how to show.
const LINK_ENDED =
  "This board has ended, or the link is not valid. Ask whoever shared it with you for a new link.";
const LINK_REPLACED =
  "This link does not open the board any more. Ask whoever shared it for a new one.";
const SHARING_OFF =
  "Link sharing is off for this board. Ask whoever shared it to turn it on or add you.";
const ONLY_VIEWING =
  "This board's link now only lets people look at it. Ask whoever shared it for the view link.";

// An empty `inviteHash` is the edit link turned off: no credential hashes to it.
export function checkInvite(room: CloudRoom | null, inviteHash: string): RoomFailure | null {
  if (room === null) return roomFailure("invalid", LINK_ENDED, "ended");
  if (room.inviteHash === "" || room.inviteHash !== inviteHash) {
    return roomFailure("invalid", LINK_REPLACED, "replaced");
  }
  const sharing = linkSharingOf(room);
  if (sharing === "off") return roomFailure("invalid", SHARING_OFF, "sharing_off");
  return sharing === "view" ? roomFailure("invalid", ONLY_VIEWING, "view_only") : null;
}

/**
 * What the edit link's holder is told before joining: the board's name and its maker's. Read only
 * after `checkInvite` passed, so nobody without the link learns either.
 */
export const invitePreviewOf = (room: CloudRoom): GuestInvitePreview => {
  const maker = room.guests.find((guest) => guest.id === room.maker)?.name.trim() ?? "";
  const title = room.title.trim();
  return {
    ...(title === "" || title === DEFAULT_BOARD_TITLE ? {} : { title }),
    ...(maker === "" ? {} : { maker }),
  };
};

/**
 * Whether `hash` opens the board to look at, or why not: a hash that is not the link the board
 * has now was replaced by a new link, or never opened anything; `detail` cannot tell those apart.
 */
export function checkViewLink(room: CloudRoom | null, hash: string): RoomFailure | null {
  if (room === null) return roomFailure("invalid", LINK_ENDED, "ended");
  if (room.viewLink?.hash === hash) {
    return linkSharingOf(room) === "off"
      ? roomFailure("invalid", SHARING_OFF, "sharing_off")
      : null;
  }
  return roomFailure("invalid", LINK_REPLACED, "replaced");
}

/** Whether `hash` is the board's view link now, which opens it to look at and nothing more. */
export const isViewLink = (room: CloudRoom | null, hash: string): boolean =>
  checkViewLink(room, hash) === null;

/** People looking on from the view link at once, on one board. */
export const CLOUD_BOARD_MAX_VIEWERS = 200;

export const checkViewerRoom = (viewing: number): RoomFailure | null =>
  viewing >= CLOUD_BOARD_MAX_VIEWERS ? roomFailure("viewers_full") : null;

/** Open pages one seat keeps, and view-link pages one address keeps, before the oldest closes. */
export const STREAMS_PER_SEAT = 8;
export const VIEWER_STREAMS_PER_ADDRESS = 10;

/** The open pages to close, oldest first, so a new one keeps its seat or address within its cap. */
export function streamsPastCap<
  S extends {
    readonly guestId: string;
    readonly viewHash: string | null;
    readonly address: string | null;
  },
>(open: Iterable<S>, opening: { readonly guestId: string } | { readonly address: string }): S[] {
  const viewer = "address" in opening;
  const same = [...open].filter((stream) =>
    viewer
      ? stream.viewHash !== null && stream.address === opening.address
      : stream.guestId === opening.guestId,
  );
  return same.slice(
    0,
    Math.max(0, same.length - (viewer ? VIEWER_STREAMS_PER_ADDRESS : STREAMS_PER_SEAT) + 1),
  );
}

export const canChange = (guest: CloudGuest): boolean => guest.role !== "viewer";

/**
 * Whether `guest` manages the board: turns its links on and off, says who can edit, and removes
 * people. Its maker does, and an owner of the workspace it is in (`workspaceRole`, read there).
 */
export const managesBoard = (
  room: CloudRoom,
  guest: CloudGuest,
  workspaceRole: string | null,
): boolean =>
  guest.locked !== true &&
  (room.maker === guest.id || (room.workspaceId !== undefined && workspaceRole === "owner"));

/**
 * The board with one of its links made anew (`next`, the new credential and its hash), which
 * ends the old one, or turned off (`null`). Only someone who manages the board may.
 */
export function withLink(
  room: CloudRoom,
  manages: boolean,
  kind: CloudBoardLinkKind,
  next: { readonly credential: string; readonly hash: string } | null,
  now: string,
): Result.Result<CloudRoom, RoomFailure> {
  if (!manages) return Result.fail(roomFailure("not_maker"));
  // Turning a link on from an older client means it should work: sharing comes up to it.
  const sharing =
    next !== null && room.sharing !== undefined && !sharingAdmits(room.sharing, kind)
      ? { sharing: kind }
      : {};
  if (kind === "view") {
    const { viewLink: _old, ...rest } = room;
    return Result.succeed({
      ...rest,
      ...(next === null ? {} : { viewLink: next }),
      ...sharing,
      updatedAt: now,
    });
  }
  const { editLink: _old, ...rest } = room;
  return Result.succeed({
    ...rest,
    inviteHash: next?.hash ?? "",
    ...(next === null ? {} : { editLink: next.credential }),
    ...sharing,
    updatedAt: now,
  });
}

const sharingAdmits = (sharing: CloudBoardLinkSharing, kind: CloudBoardLinkKind): boolean =>
  sharing === "edit" || (sharing === "view" && kind === "view");

type NewLink = { readonly credential: string; readonly hash: string };

/**
 * The board with link sharing set to `sharing`. A link it needs that the board does not have yet
 * is made from `fresh`; `renew` makes both anew, which ends the old ones. Otherwise the links stay
 * the same, so turning sharing off and on again brings back the very links people were given.
 */
export function withSharing(
  room: CloudRoom,
  manages: boolean,
  input: {
    readonly sharing: CloudBoardLinkSharing;
    readonly renew: boolean;
    readonly fresh: { readonly edit: NewLink; readonly view: NewLink };
  },
  now: string,
): Result.Result<CloudRoom, RoomFailure> {
  if (!manages) return Result.fail(roomFailure("not_maker"));
  const on = input.sharing !== "off";
  const edit = input.renew || (on && room.inviteHash === "") ? input.fresh.edit : null;
  const view = input.renew || (on && room.viewLink === undefined) ? input.fresh.view : null;
  if (room.sharing === input.sharing && edit === null && view === null) return Result.succeed(room);
  return Result.succeed({
    ...room,
    sharing: input.sharing,
    ...(edit === null ? {} : { inviteHash: edit.hash, editLink: edit.credential }),
    ...(view === null ? {} : { viewLink: view }),
    updatedAt: now,
  });
}

/**
 * Lets someone on the board change it, or only look at it. The maker always can. Someone who can
 * only look loses their machines' tokens, so their agent stops posting to the board at once.
 */
export function withRole(
  room: CloudRoom,
  manages: boolean,
  guestId: GuestId,
  role: CloudBoardRole,
  now: string,
): Result.Result<CloudRoom, RoomFailure> {
  if (!manages) return Result.fail(roomFailure("not_maker"));
  const target = room.guests.find((guest) => guest.id === guestId);
  if (target === undefined) {
    return Result.fail(roomFailure("rejected", "This person is no longer on the board."));
  }
  if (role === "view" && guestId === room.maker) {
    return Result.fail(
      roomFailure("rejected", "The person who made the board can always edit it."),
    );
  }
  if ((role === "view") === (target.role === "viewer")) return Result.succeed(room);
  const { role: _old, ...rest } = target;
  const changed: CloudGuest = role === "view" ? { ...rest, role: "viewer" } : rest;
  const machines = room.machines?.filter((token) => token.guestId !== guestId);
  return Result.succeed({
    ...room,
    guests: room.guests.map((guest) => (guest === target ? changed : guest)),
    ...(role === "view" && machines !== undefined ? { machines } : {}),
    updatedAt: now,
  });
}

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
      guest.sessionHash === sessionHash ||
      guest.machineSessions?.includes(sessionHash) === true ||
      guest.accountSessions?.includes(sessionHash) === true,
  );

export const renameRoom = (room: CloudRoom, title: string, now: string): CloudRoom =>
  room.title === title ? room : { ...room, title, updatedAt: now };

const NO_MEMBERS: ReadonlySet<string> = new Set();

/** `members`: the member ids of the board's workspace, read when a change mentions one. */
export const roomScope = (
  room: CloudRoom,
  members: ReadonlySet<string> = NO_MEMBERS,
): RoomBoardScope => ({
  hasCard: (cardId) =>
    room.guests.some(
      (guest) => cardId === roomBoardGuestCard(guest.id) || cardId === roomBoardAgentCard(guest.id),
    ),
  hasPerson: (guestId) => room.guests.some((guest) => guest.id === guestId),
  hasMember: (memberId) => room.workspaceId !== undefined && members.has(memberId),
  manages: (guestId) =>
    room.maker === guestId && room.guests.some((guest) => guest.id === guestId && !guest.locked),
});

/** The workspace members a change names with `@`, which the board asks its workspace about. */
export const mentionedMembers = (change: RoomBoardChange): ReadonlyArray<string> =>
  change.type === "note.put" || change.type === "comment.reply"
    ? (change.mentions ?? []).flatMap((mention) => mention.memberId ?? [])
    : [];

/** A guest's change, applied by the same rules a machine's room uses, authored by that guest. */
export function changeBoard(
  room: CloudRoom,
  author: GuestId,
  change: RoomBoardChange,
  now: string,
  members?: ReadonlySet<string>,
): Result.Result<CloudRoom, RoomFailure> {
  if (needsAnOwner(change)) return Result.fail(roomFailure("rejected", NEEDS_AN_OWNER));
  const cleaned =
    change.type === "note.put" || change.type === "comment.reply"
      ? // Characters nobody can see have no place in text the whole room reads.
        { ...change, text: sanitizeLinkedPrompt(change.text).text }
      : change;
  const applied = roomBoardAfterChange(
    room,
    roomScope(room, members),
    author,
    cleaned,
    undefined,
    now,
  );
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
 * Takes `guestId` off the board with their cards, replies, reactions, turns and machines' tokens.
 * Whoever manages it (`manages`; by default its maker) removes anyone but the maker; anyone leaves,
 * the maker too, which leaves the board with no maker. Someone already gone changes nothing.
 */
export function removePerson(
  room: CloudRoom,
  by: GuestId,
  guestId: GuestId,
  now: string,
  manages: boolean = room.maker !== undefined && room.maker === by,
): Result.Result<CloudRoom, RoomFailure> {
  if (by !== guestId && (!manages || guestId === room.maker)) {
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
  room: Pick<CloudRoom, "createdAt" | "updatedAt" | "board">,
  now: number,
  scheduled: number | null,
): number | null {
  // A copy is made with its cards: it was never changed, but it is not empty.
  if (room.updatedAt === room.createdAt && room.board === undefined) {
    const at = Date.parse(room.createdAt) + UNTOUCHED_BOARD_MS;
    return scheduled === at ? null : at;
  }
  const at = now + IDLE_BOARD_MS + ALARM_STEP_MS;
  return scheduled !== null && at - scheduled < ALARM_STEP_MS ? null : at;
}

const CLOUD_MODEL = { driver: null, name: "Cloud board" } as const;

/** The name a view from the view link carries: it is nobody on the board. */
export const VIEWER_NAME = "Viewer";

/**
 * The board as `guest` sees it, or as someone looking on from the view link (`null`). Whoever can
 * only look gets no way to bring an agent; whoever can edit gets the links to hand on.
 */
export function viewFor(
  room: CloudRoom,
  guest: CloudGuest | null,
  manages = false,
): GuestShareView {
  const edits = guest !== null && canChange(guest);
  const viewers = room.guests.flatMap((person) => (canChange(person) ? [] : [person.id]));
  const sharing = linkSharingOf(room);
  // Only the links that let people in now, so an older client never offers one that does not.
  const editWorks = room.inviteHash !== "" && sharing === "edit";
  const links = {
    ...(edits && (!editWorks || room.editLink !== undefined)
      ? { edit: editWorks ? (room.editLink ?? null) : null }
      : {}),
    ...(guest !== null && room.viewLink !== undefined && sharing !== "off"
      ? { view: room.viewLink.credential }
      : {}),
  };
  return {
    shareId: room.shareId,
    title: room.title,
    guestName: guest?.name ?? VIEWER_NAME,
    ...(guest === null ? {} : { guestId: guest.id }),
    guests: room.guests.map(({ id, name, joinedAt }): ThreadGuest => ({ id, name, joinedAt })),
    direct: false,
    signIn: false,
    expiresAt: FAR_EXPIRY,
    messages: [],
    turns: room.turns ?? [],
    ...(room.board === undefined ? {} : { board: room.board }),
    cloud: true,
    ...(edits ? { machines: true } : { viewOnly: true }),
    ...(room.maker === undefined ? {} : { maker: room.maker }),
    ...(viewers.length === 0 ? {} : { viewers }),
    ...(manages && guest !== null ? { manage: true } : {}),
    ...(Object.keys(links).length === 0 ? {} : { links }),
    ...(guest === null ? {} : { sharing }),
    model: CLOUD_MODEL,
    ...(guest?.inboxAt === undefined ? {} : { inboxAt: guest.inboxAt }),
    ...(guest === null ? grantedOf(room) : {}),
    ...(room.allowCopies === true ? { copies: true } : {}),
  };
}

/** Lets anyone who can see the board copy it, or stops that. Only someone who manages it may. */
export function withCopies(
  room: CloudRoom,
  manages: boolean,
  on: boolean,
  now: string,
): Result.Result<CloudRoom, RoomFailure> {
  if (!manages) return Result.fail(roomFailure("not_maker"));
  if ((room.allowCopies === true) === on) return Result.succeed(room);
  const { allowCopies: _old, ...rest } = room;
  return Result.succeed({ ...rest, ...(on ? { allowCopies: true as const } : {}), updatedAt: now });
}

// An approval shows to pages on the view link this long after the board last changed.
const GRANT_SHOWN_MS = 10 * 60_000;

/** The access requests approved lately, which the page that asked opens the board on. */
function grantedOf(room: CloudRoom): { readonly granted?: ReadonlyArray<string> } {
  const since = Date.parse(room.updatedAt) - GRANT_SHOWN_MS;
  const granted = (room.requests ?? []).flatMap((request) =>
    request.status === "approved" && Date.parse(request.answeredAt ?? "") > since
      ? [request.id]
      : [],
  );
  return granted.length === 0 ? {} : { granted };
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
  | {
      readonly type: "presence";
      readonly online: ReadonlyArray<GuestId>;
      readonly viewing?: number;
    }
  | RoomCursorsEvent
  | RoomAgentsEvent
  | { readonly type: "ended"; readonly detail?: string };

export const sseFrame = (event: CloudStreamEvent) => `data: ${JSON.stringify(event)}\n\n`;

/**
 * What a newly opened stream gets first, in the order a guest's client needs it. `guest` is null
 * for someone looking on from the view link.
 */
export const openingEvents = (
  room: CloudRoom,
  guest: CloudGuest | null,
  presence: { readonly online: ReadonlyArray<GuestId>; readonly viewing: number },
  manages = false,
): ReadonlyArray<CloudStreamEvent> => [
  { type: "view", view: viewFor(room, guest, manages) },
  { type: "thread", item: emptyThreadSnapshot(room) },
  { type: "presence", ...presence },
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
