import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import { CLOUD_BOARD_ACCOUNT_ROUTE } from "./cloudBoardAccount.ts";
import { CLOUD_WORKSPACES_ROUTE } from "./cloudBoardWorkspace.ts";
import { GUEST_ROUTE_PREFIX, RoomBoardNoteColor } from "./guestShare.ts";

/** Boards one summary request names; the home lists at most this many of a machine's boards. */
export const ROOM_BOARD_SUMMARY_MAX_BOARDS = 200;
/** Shapes one board's summary carries, enough for a thumbnail. */
export const ROOM_BOARD_SUMMARY_MAX_SHAPES = 120;
/** People one board's summary names. */
export const ROOM_BOARD_SUMMARY_MAX_PEOPLE = 12;

/** A card on a board as its thumbnail draws it: where, how big, and what kind. */
export const RoomBoardSummaryShape = Schema.Struct({
  x: Schema.Finite,
  y: Schema.Finite,
  w: Schema.Finite,
  h: Schema.Finite,
  kind: Schema.Literals([
    "note",
    "task",
    "link",
    "artifact",
    "thread",
    "comment",
    "code",
    "pull-request",
    "section",
    "card",
  ]),
  color: Schema.optional(RoomBoardNoteColor),
});
export type RoomBoardSummaryShape = typeof RoomBoardSummaryShape.Type;

/** Items of each kind one board's outline carries. */
export const ROOM_BOARD_OUTLINE_MAX_PER_KIND = 24;
export const ROOM_BOARD_OUTLINE_NAME_MAX_LENGTH = 80;

/**
 * One artifact, thread box or section as a board list names it under its board. `id` is the
 * note's, or the room box's for the room thread's own card.
 */
export const RoomBoardOutlineItem = Schema.Struct({
  id: Schema.String.check(Schema.isMaxLength(64)),
  kind: Schema.Literals(["artifact", "thread", "section"]),
  name: Schema.String.check(Schema.isMaxLength(ROOM_BOARD_OUTLINE_NAME_MAX_LENGTH)),
});
export type RoomBoardOutlineItem = typeof RoomBoardOutlineItem.Type;

/** What is on a board by name: its artifacts, then its thread boxes, then its sections. */
export const RoomBoardOutline = Schema.Struct({
  items: Schema.Array(RoomBoardOutlineItem).check(
    Schema.isMaxLength(ROOM_BOARD_OUTLINE_MAX_PER_KIND * 3),
  ),
});
export type RoomBoardOutline = typeof RoomBoardOutline.Type;

/**
 * A cloud board's outline (GET), each for whoever could open the board that way: with a session
 * on it or its view link (`?share=`), as the account on it (`?share=`), or as a member of the
 * workspace it is in (`?workspace=&share=`).
 */
export const CLOUD_BOARD_OUTLINE_ROUTE = `${GUEST_ROUTE_PREFIX}/board/outline`;
export const CLOUD_BOARD_ACCOUNT_OUTLINE_ROUTE = `${CLOUD_BOARD_ACCOUNT_ROUTE}/outline`;
export const CLOUD_WORKSPACE_OUTLINE_ROUTE = `${CLOUD_WORKSPACES_ROUTE}/outline`;

/** What a board list shows of one board, without its text or history. */
export const RoomBoardSummary = Schema.Struct({
  threadId: ThreadId,
  /** Cards on it, sections and comments not counted. */
  cards: Schema.Int,
  /** Thread boxes on it, the board's own thread counted. */
  agentBoxes: Schema.Int,
  /** It has a live link or team share. */
  shared: Schema.Boolean,
  /** The names of the people in its room. */
  people: Schema.Array(Schema.String),
  /** How many of them have it open now. */
  online: Schema.Int,
  shapes: Schema.Array(RoomBoardSummaryShape),
  /** Only when the request asked for it, and never from a server that predates it. */
  outline: Schema.optional(RoomBoardOutline),
});
export type RoomBoardSummary = typeof RoomBoardSummary.Type;

export const RoomBoardSummariesInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(ROOM_BOARD_SUMMARY_MAX_BOARDS)),
  /** Also name each board's artifacts, thread boxes and sections. */
  outline: Schema.optional(Schema.Boolean),
});
export type RoomBoardSummariesInput = typeof RoomBoardSummariesInput.Type;

/** One summary per named thread that has a board; others are left out. */
export const RoomBoardSummaries = Schema.Struct({ boards: Schema.Array(RoomBoardSummary) });
export type RoomBoardSummaries = typeof RoomBoardSummaries.Type;
