import {
  CLOUD_BOARD_ACCOUNT_MAX_BOARDS,
  type CloudBoardAccountBoard,
  type GuestId,
} from "@t3tools/contracts";
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

/**
 * Ties `account` to the person `sessionHash` opens the board as. Doing it again changes nothing.
 * A seat another account holds stays theirs, and an account already on the board as someone else
 * keeps that seat. `credential` is kept only when it is this board's invite.
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
  { readonly room: CloudRoom; readonly board: CloudBoardAccountBoard },
  RoomFailure
> {
  const guest = guestBySession(room, input.sessionHash);
  if (room === null || guest === undefined) return Result.fail(roomFailure("ended"));
  if (guest.accountId !== undefined && guest.accountId !== input.account) {
    return Result.fail(roomFailure("taken"));
  }
  const already = accountGuestOf(room, input.account);
  if (already !== undefined && already.id !== guest.id) return Result.fail(roomFailure("taken"));
  const next =
    guest.accountId === input.account
      ? room
      : {
          ...room,
          guests: room.guests.map((candidate) =>
            candidate.id === guest.id ? { ...candidate, accountId: input.account } : candidate,
          ),
        };
  const credential =
    input.credential !== undefined && input.credential.hash === room.inviteHash
      ? input.credential.value
      : undefined;
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
