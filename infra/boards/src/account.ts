import {
  CLOUD_BOARD_ACCOUNT_MAX_BOARDS,
  roomBoardAgentCard,
  roomBoardCardRef,
  roomBoardGuestCard,
  type CloudBoardAccountBoard,
  type GuestId,
  type RoomBoardOutline,
} from "@t3tools/contracts";
import { boardOutline } from "@t3tools/shared/boardOutline";
import * as Result from "effect/Result";

import {
  guestBySession,
  roomFailure,
  type CloudGuest,
  type CloudRoom,
  type RoomFailure,
} from "./room.ts";

/**
 * A Tinkjam account on a cloud board is one person on it: the board keeps which of its people
 * each account is, and only a session that already opens that person's seat ties the account to
 * it. The account's list of boards is kept apart, by account, and is only ever a copy of this.
 */

// As many devices as one person signs in on at once; the oldest session goes first.
const SESSIONS_PER_ACCOUNT = 8;

export const accountGuestOf = (room: CloudRoom | null, account: string): CloudGuest | undefined =>
  room?.guests.find((guest) => guest.accountId === account);

/** Locked out of the board's workspace: a fresh seat from the edit link is no way back in either. */
export const accountLockedOut = (room: CloudRoom | null, account: string): boolean =>
  accountGuestOf(room, account)?.locked === true;

/** What the account's list keeps of a board it is on. */
export const accountBoardOf = (
  room: CloudRoom,
  guest: CloudGuest,
  input: { readonly credential?: string | undefined; readonly addedAt: string },
): CloudBoardAccountBoard => ({
  shareId: room.shareId,
  threadId: room.threadId,
  title: room.title,
  guestId: guest.id,
  maker: room.maker === guest.id,
  addedAt: input.addedAt,
  ...(input.credential === undefined ? {} : { credential: input.credential }),
});

// What people wrote, which is never an id however it reads.
const WRITTEN = new Set(["text", "body", "quote", "title", "name", "url", "prompt", "reply"]);

/**
 * `value` with every id in `ids` replaced, as a value or as a key, and itself when it names none.
 * A key that would land on one already there is dropped, as is a list entry that becomes a copy
 * of another (a reaction or mention both seats had).
 */
function renamed<T>(value: T, ids: ReadonlyMap<string, string>): T {
  if (typeof value === "string") return (ids.get(value) ?? value) as T;
  if (Array.isArray(value)) {
    const items: ReadonlyArray<unknown> = value;
    const next = items.map((item) => renamed(item, ids));
    if (next.every((item, index) => item === items[index])) return value;
    const kept = new Set(
      next.flatMap((item, index) => (item === items[index] ? [JSON.stringify(item)] : [])),
    );
    return next.filter((item, index) => {
      if (item === items[index]) return true;
      const shown = JSON.stringify(item);
      if (kept.has(shown)) return false;
      kept.add(shown);
      return true;
    }) as T;
  }
  if (value === null || typeof value !== "object") return value;
  const entries = Object.entries(value);
  const next = entries.flatMap(([key, item]): ReadonlyArray<readonly [string, unknown]> => {
    const to = ids.get(key);
    if (to !== undefined) return to in value ? [] : [[to, renamed(item, ids)]];
    return [[key, WRITTEN.has(key) && typeof item === "string" ? item : renamed(item, ids)]];
  });
  const same =
    next.length === entries.length &&
    next.every(([key, item], index) => key === entries[index]![0] && item === entries[index]![1]);
  return same ? value : (Object.fromEntries(next) as T);
}

/**
 * The board once `from`, a second seat of the person who is `into`, is folded into it: what they
 * added, were given and brought (cards, replies, turns, their machines) is `into`'s, their
 * sessions open `into`, and `from` is gone. A board `from` made is `into`'s to manage.
 */
function mergeSeat(room: CloudRoom, from: CloudGuest, into: CloudGuest): CloudRoom {
  const ids = new Map<string, string>([
    [from.id, into.id],
    [roomBoardGuestCard(from.id), roomBoardGuestCard(into.id)],
    [roomBoardAgentCard(from.id), roomBoardAgentCard(into.id)],
    // Arrows name those cards as refs.
    [roomBoardCardRef(roomBoardGuestCard(from.id)), roomBoardCardRef(roomBoardGuestCard(into.id))],
    [roomBoardCardRef(roomBoardAgentCard(from.id)), roomBoardCardRef(roomBoardAgentCard(into.id))],
  ]);
  const sessions = [
    ...(into.accountSessions ?? []),
    ...(from.accountSessions ?? []),
    from.sessionHash,
  ].filter((hash) => hash !== "");
  const machineSessions = [...(into.machineSessions ?? []), ...(from.machineSessions ?? [])];
  const merged: CloudGuest = {
    ...into,
    accountSessions: sessions.slice(-SESSIONS_PER_ACCOUNT),
    ...(machineSessions.length === 0
      ? {}
      : { machineSessions: machineSessions.slice(-SESSIONS_PER_ACCOUNT) }),
  };
  return {
    ...room,
    guests: room.guests.flatMap((guest) =>
      guest.id === from.id ? [] : guest.id === into.id ? [merged] : [guest],
    ),
    ...(room.maker === from.id ? { maker: into.id } : {}),
    ...(room.board === undefined ? {} : { board: renamed(room.board, ids) }),
    ...(room.turns === undefined ? {} : { turns: renamed(room.turns, ids) }),
    ...(room.machines === undefined ? {} : { machines: renamed(room.machines, ids) }),
  };
}

/**
 * Ties `account` to the person `sessionHash` opens the board as. Doing it again changes nothing.
 * A seat another account holds stays theirs. An account already on the board stays that person:
 * the seat is folded into theirs (`merged`), so one account is never two people on a board.
 * `credential` is kept only when it is this board's invite.
 */
export function linkAccount(
  room: CloudRoom | null,
  input: {
    readonly account: string;
    readonly sessionHash: string;
    readonly credential?: { readonly value: string; readonly hash: string } | undefined;
    readonly now: string;
  },
): Result.Result<
  {
    readonly room: CloudRoom;
    readonly board: CloudBoardAccountBoard;
    readonly merged?: { readonly from: GuestId; readonly into: GuestId };
  },
  RoomFailure
> {
  const guest = guestBySession(room, input.sessionHash);
  if (room === null || guest === undefined) return Result.fail(roomFailure("ended"));
  if (guest.accountId !== undefined && guest.accountId !== input.account) {
    return Result.fail(roomFailure("taken"));
  }
  const credential =
    input.credential !== undefined && input.credential.hash === room.inviteHash
      ? input.credential.value
      : undefined;
  const already = accountGuestOf(room, input.account);
  if (already !== undefined && already.id !== guest.id) {
    // Taken out of the workspace, the account has no way in: a spare seat is not one either.
    if (already.locked === true || guest.locked === true) return Result.fail(roomFailure("taken"));
    const next = { ...mergeSeat(room, guest, already), updatedAt: input.now };
    return Result.succeed({
      room: next,
      board: accountBoardOf(next, accountGuestOf(next, input.account) ?? already, {
        credential,
        addedAt: input.now,
      }),
      merged: { from: guest.id, into: already.id },
    });
  }
  const next =
    guest.accountId === input.account
      ? room
      : {
          ...room,
          guests: room.guests.map((candidate) =>
            candidate.id === guest.id ? { ...candidate, accountId: input.account } : candidate,
          ),
        };
  return Result.succeed({
    room: next,
    board: accountBoardOf(next, guest, { credential, addedAt: input.now }),
  });
}

/**
 * A new session for the account's person on the board, for another device. It opens what their
 * first session opens and nothing more: the board's own routes, never a machine's.
 */
export function withAccountSession(
  room: CloudRoom | null,
  account: string,
  sessionHash: string,
): Result.Result<{ readonly room: CloudRoom; readonly guest: CloudGuest }, RoomFailure> {
  const guest = accountGuestOf(room, account);
  if (room === null || guest === undefined || guest.locked === true) {
    return Result.fail(roomFailure("ended"));
  }
  const sessions = [
    ...(guest.accountSessions ?? []).slice(-(SESSIONS_PER_ACCOUNT - 1)),
    sessionHash,
  ];
  const next = { ...guest, accountSessions: sessions };
  return Result.succeed({
    room: {
      ...room,
      guests: room.guests.map((candidate) => (candidate.id === guest.id ? next : candidate)),
    },
    guest: next,
  });
}

/** Who reads a board's outline without a session on it: verified by the Worker, never the page. */
export type OutlineReader = { readonly account: string } | { readonly workspaceId: string };

/**
 * What is on the board by name, for someone who could open it with no invite: the account's
 * person on it, or a member of the workspace it is in (the workspace said they are). Null for
 * anyone else, as for a board that has ended.
 */
export function outlineFor(room: CloudRoom | null, reader: OutlineReader): RoomBoardOutline | null {
  if (room === null) return null;
  if ("workspaceId" in reader) {
    if (room.workspaceId !== reader.workspaceId) return null;
  } else {
    const guest = accountGuestOf(room, reader.account);
    if (guest === undefined || guest.locked === true) return null;
  }
  return boardOutline(room.board, null);
}

/** The accounts on the board, each once, so its list follows what happens to the board. */
export const accountsOn = (room: CloudRoom | null): ReadonlyArray<string> => [
  ...new Set((room?.guests ?? []).flatMap((guest) => guest.accountId ?? [])),
];

export const accountOfGuest = (room: CloudRoom | null, guestId: GuestId): string | undefined =>
  room?.guests.find((guest) => guest.id === guestId)?.accountId;

/**
 * The account's list with `board` in it, once. A board already listed keeps when it was added
 * and its invite; past the cap, the oldest added goes.
 */
export function withAccountBoard(
  boards: ReadonlyArray<CloudBoardAccountBoard>,
  board: CloudBoardAccountBoard,
): ReadonlyArray<CloudBoardAccountBoard> {
  const listed = boards.find((existing) => existing.shareId === board.shareId);
  const credential = board.credential ?? listed?.credential;
  const preview = board.preview ?? listed?.preview;
  const kept: CloudBoardAccountBoard = {
    ...board,
    addedAt: listed?.addedAt ?? board.addedAt,
    ...(credential === undefined ? {} : { credential }),
    ...(preview === undefined ? {} : { preview }),
  };
  const others = boards.filter((existing) => existing.shareId !== board.shareId);
  return [...others, kept]
    .toSorted((left, right) => left.addedAt.localeCompare(right.addedAt))
    .slice(-CLOUD_BOARD_ACCOUNT_MAX_BOARDS);
}

export const withoutAccountBoard = (
  boards: ReadonlyArray<CloudBoardAccountBoard>,
  shareId: string,
): ReadonlyArray<CloudBoardAccountBoard> =>
  boards.some((board) => board.shareId === shareId)
    ? boards.filter((board) => board.shareId !== shareId)
    : boards;

export const retitledAccountBoard = (
  boards: ReadonlyArray<CloudBoardAccountBoard>,
  shareId: string,
  title: string,
): ReadonlyArray<CloudBoardAccountBoard> =>
  boards.some((board) => board.shareId === shareId && board.title !== title)
    ? boards.map((board) => (board.shareId === shareId ? { ...board, title } : board))
    : boards;
