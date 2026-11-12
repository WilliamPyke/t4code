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
  /** Absent: the box thread's own model, or the room thread's for a box prompted first. */
  modelSelection: Schema.optional(ModelSelection),
});
export type RoomBoxPromptInput = typeof RoomBoxPromptInput.Type;

export const RoomBoxPromptResult = Schema.Struct({ boxThreadId: ThreadId });
export type RoomBoxPromptResult = typeof RoomBoxPromptResult.Type;

/**
 * The owner sends a guest's waiting message: in the guest's thread box when it names one that is
 * still on the board, else in the room thread. The server supplies the text, never the client.
 */
export const GuestMessageSendInput = Schema.Struct({
  threadId: ThreadId,
  guestMessageId: GuestMessageId,
  /** The model the owner picked for their next message, so the guest's turn runs on it too. */
  modelSelection: Schema.optional(ModelSelection),
  creationSource: Schema.optional(Schema.Literals(["web", "mobile"])),
});
export type GuestMessageSendInput = typeof GuestMessageSendInput.Type;

const ROOM_BOX_ERROR_MESSAGES = {
  inactive: "This thread is not shared.",
  box_gone: "This thread box is no longer on the board.",
  not_yours: "This thread box is someone else's. Their own agent runs it.",
  not_pending: "This message is no longer waiting.",
  failed: "Could not start the turn. Try again.",
} as const;

export class RoomBoxError extends Schema.TaggedError<RoomBoxError>()("RoomBoxError", {
  reason: Schema.Literals(["inactive", "box_gone", "not_yours", "not_pending", "failed"]),
}) {
  override get message(): string {
    return ROOM_BOX_ERROR_MESSAGES[this.reason];
  }
}
