import * as Schema from "effect/Schema";

import { ThreadId } from "./baseSchemas.ts";
import { RoomBoardNoteColor } from "./guestShare.ts";

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
});
export type RoomBoardSummary = typeof RoomBoardSummary.Type;

export const RoomBoardSummariesInput = Schema.Struct({
  threadIds: Schema.Array(ThreadId).check(Schema.isMaxLength(ROOM_BOARD_SUMMARY_MAX_BOARDS)),
});
export type RoomBoardSummariesInput = typeof RoomBoardSummariesInput.Type;

/** One summary per named thread that has a board; others are left out. */
export const RoomBoardSummaries = Schema.Struct({ boards: Schema.Array(RoomBoardSummary) });
export type RoomBoardSummaries = typeof RoomBoardSummaries.Type;
