import {
  CLOUD_BOARD_TITLE_MAX_LENGTH,
  roomBoardNoteRef,
  type GuestId,
  type RoomBoard,
  type RoomBoardEdge,
  type RoomBoardNote,
} from "@t3tools/contracts";

import { roomFailure, type CloudGuest, type CloudRoom, type RoomFailure } from "./room.ts";

/**
 * A copy of a cloud board someone makes for themselves: only what anyone looking at it sees, as
 * the copier's own cards. Nobody's agent, conversation, prompt, reply, reaction or request comes
 * with it, and no task stays anyone else's.
 */

/** Boards one address may make in an hour, copies among them. */
export const BOARD_MAKING_LIMIT = 30;
export const BOARD_MAKING_WINDOW_MS = 60 * 60_000;

/**
 * The times an address made boards, once it makes one more at `now`, or null when it already made
 * as many as it may this hour. Making a board and copying one both take from it.
 */
export function takeBoardMaking(
  made: ReadonlyArray<number>,
  now: number,
  limit: { readonly count: number; readonly windowMs: number } = {
    count: BOARD_MAKING_LIMIT,
    windowMs: BOARD_MAKING_WINDOW_MS,
  },
): ReadonlyArray<number> | null {
  const recent = made.filter((at) => at > now - limit.windowMs);
  return recent.length >= limit.count ? null : [...recent, now];
}

/** Joins from one address, and link checks from one address: other counts kept the same way. */
export const JOINS_PER_ADDRESS = { count: 30, windowMs: 10 * 60_000 } as const;
export const FRAME_CHECKS_PER_ADDRESS = { count: 300, windowMs: 10 * 60_000 } as const;

/**
 * Why the caller may not copy the board, or null when they may: someone on it (`seat`) or looking
 * on from its view link (`viewLink`), on a board whose maker allows copies.
 */
export function copyRefusal(
  room: CloudRoom | null,
  seat: CloudGuest | undefined,
  viewLink: boolean,
): RoomFailure | null {
  if (room === null) return roomFailure("ended");
  if ((seat === undefined || seat.locked === true) && !viewLink) return roomFailure("invalid");
  return room.allowCopies === true ? null : roomFailure("copies_off");
}

export const copyTitle = (title: string): string =>
  `Copy of ${title.trim() === "" ? "a board" : title.trim()}`.slice(
    0,
    CLOUD_BOARD_TITLE_MAX_LENGTH,
  );

const NOT_COPIED: ReadonlySet<RoomBoardNote["kind"]> = new Set(["comment", "code", "pull-request"]);

/** Who the board says an agent box was, for the note that takes its place. */
const ownerOf = (room: CloudRoom, note: RoomBoardNote) =>
  room.guests.find((guest) => guest.id === note.guestId)?.name ??
  room.board?.people?.find((person) => person.guestId === note.guestId)?.name ??
  "Someone";

function copiedNote(
  room: CloudRoom,
  note: RoomBoardNote,
  copier: GuestId,
  at: string,
): RoomBoardNote | null {
  if (NOT_COPIED.has(note.kind)) return null;
  const mine = { guestId: copier, changed: { at, guestId: copier } };
  const place = {
    id: note.id,
    x: note.x,
    y: note.y,
    ...(note.size === undefined ? {} : { size: note.size }),
  };
  // An agent box keeps its place as a plain note saying an agent worked there; its conversation stays.
  if (note.kind === "thread") {
    const title = note.text.trim();
    return {
      ...place,
      ...mine,
      text: `${ownerOf(room, note)}'s agent worked here${title === "" ? "" : `: ${title}`}`,
      color: "grey",
    };
  }
  const body = note.artifact?.body;
  return {
    ...place,
    ...mine,
    text: note.text,
    ...(note.kind === undefined ? {} : { kind: note.kind }),
    ...(note.section === true ? { section: true } : {}),
    ...(note.color === undefined ? {} : { color: note.color }),
    ...(note.url === undefined ? {} : { url: note.url }),
    ...(note.kind === "task"
      ? {
          ...(note.done === true ? { done: true } : {}),
          ...(note.status === undefined ? {} : { status: note.status }),
          ...(note.due === undefined ? {} : { due: note.due }),
          ...(note.order === undefined ? {} : { order: note.order }),
          ...(note.priority === undefined ? {} : { priority: note.priority }),
        }
      : {}),
    ...(note.kind === "artifact" && body !== undefined
      ? {
          artifact: {
            body,
            ...(note.artifact?.truncated === true ? { truncated: true } : {}),
            guestId: copier,
            byHand: true as const,
            turnId: `copy:${at}`,
            updatedAt: at,
          },
        }
      : {}),
  };
}

/** The board a copy starts with: the copier's own notes, sections, tasks, links, artifacts and lines. */
export function copiedBoard(room: CloudRoom, copier: GuestId, at: string): RoomBoard {
  const notes = (room.board?.notes ?? []).flatMap((note) => {
    const copied = copiedNote(room, note, copier, at);
    return copied === null ? [] : [copied];
  });
  const kept = new Set(notes.map((note) => roomBoardNoteRef(note.id)));
  const edges = (room.board?.edges ?? []).flatMap((edge): ReadonlyArray<RoomBoardEdge> =>
    kept.has(edge.from) && kept.has(edge.to) ? [{ id: edge.id, from: edge.from, to: edge.to }] : [],
  );
  const start = room.board?.start;
  return {
    positions: {},
    notes,
    ...(edges.length === 0 ? {} : { edges }),
    ...(start !== undefined && kept.has(roomBoardNoteRef(start)) ? { start } : {}),
  };
}
