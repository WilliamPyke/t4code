import * as Schema from "effect/Schema";

import { GuestMessageId, ThreadId } from "./baseSchemas.ts";
import { RoomBoardContextCard } from "./composerContext.ts";
import { GUEST_MESSAGE_MAX_LENGTH, RoomBoardNote } from "./guestShare.ts";
import { ModelSelection } from "./modelSelection.ts";

/**
 * The owner prompts one of their thread boxes on the board of a thread they share. The box's own
 * thread on the owner's machine runs it, made the first time; the room thread's own card
 * (`ROOM_BOARD_ROOM_BOX`) runs it in the room thread.
 */
export const RoomBoxPromptInput = Schema.Struct({
  /** The room thread: the shared thread whose board has the box. */
  threadId: ThreadId,
  boxId: RoomBoardNote.fields.id,
  text: Schema.String.check(Schema.isMaxLength(GUEST_MESSAGE_MAX_LENGTH)),
  /** The cards with an arrow into the box, which go with the prompt. */
  cards: Schema.optional(Schema.Array(RoomBoardContextCard)),
  /** The artifact card the reply fills. One not on the board is left out. */
  artifactId: Schema.optional(RoomBoardNote.fields.id),
  /** The comment thread the reply is posted in. One not on the board is left out. */
  commentId: Schema.optional(RoomBoardNote.fields.id),
  /** Absent: the box thread's own model, or the room thread's for a box prompted first. */
  modelSelection: Schema.optional(ModelSelection),
});
export type RoomBoxPromptInput = typeof RoomBoxPromptInput.Type;

export const RoomBoxPromptResult = Schema.Struct({ boxThreadId: ThreadId });
export type RoomBoxPromptResult = typeof RoomBoxPromptResult.Type;

/**
 * The owner puts one of their existing threads on the board of a thread they share, as a new
 * thread box titled with the thread's title. From then on the room sees that thread's turns on the
 * box, whether prompted from the board or from the thread itself.
 */
export const RoomBoxAddThreadInput = Schema.Struct({
  /** The room thread: the shared thread whose board gets the box. */
  threadId: ThreadId,
  /** The new box's id, named by the client as any new card's is. */
  boxId: RoomBoardNote.fields.id,
  boxThreadId: ThreadId,
  x: RoomBoardNote.fields.x,
  y: RoomBoardNote.fields.y,
});
export type RoomBoxAddThreadInput = typeof RoomBoxAddThreadInput.Type;

/**
 * The owner sends or dismisses a guest's waiting message. Send runs it in the guest's thread box
 * when it names one that is still on the board, else in the room thread. The server supplies the
 * text, never the client.
 */
export const GuestMessageResolveInput = Schema.Struct({
  threadId: ThreadId,
  guestMessageId: GuestMessageId,
  decision: Schema.Literals(["send", "dismiss"]),
  /** The model the owner picked for their next message, so the guest's turn runs on it too. */
  modelSelection: Schema.optional(ModelSelection),
  creationSource: Schema.optional(Schema.Literals(["web", "mobile"])),
});
export type GuestMessageResolveInput = typeof GuestMessageResolveInput.Type;

const ROOM_BOX_ERROR_MESSAGES = {
  inactive: "This thread is not shared.",
  box_gone: "This thread box is no longer on the board.",
  not_yours: "This thread box is someone else's. Their own agent runs it.",
  not_pending: "This message is no longer waiting.",
  failed: "Could not start the turn. Try again.",
  thread_unavailable:
    "This thread cannot go on the board. It may be archived or deleted, shared, or in a room already.",
  already_on_board: "This thread is already on the board.",
  board_full: "This board has as many thread boxes as it holds. Remove one first.",
} as const;

export class RoomBoxError extends Schema.TaggedError<RoomBoxError>()("RoomBoxError", {
  reason: Schema.Literals([
    "inactive",
    "box_gone",
    "not_yours",
    "not_pending",
    "failed",
    "thread_unavailable",
    "already_on_board",
    "board_full",
  ]),
}) {
  override get message(): string {
    return ROOM_BOX_ERROR_MESSAGES[this.reason];
  }
}
