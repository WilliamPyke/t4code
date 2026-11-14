import * as Schema from "effect/Schema";

import {
  CommandId,
  GuestShareId,
  IsoDateTime,
  NonNegativeInt,
  ProjectId,
  ThreadId,
  TrimmedNonEmptyString,
} from "./baseSchemas.ts";
import { RoomBoardContextCard } from "./composerContext.ts";
import {
  GUEST_MESSAGE_MAX_LENGTH,
  RoomArtifactRead,
  RoomBoardNote,
  RoomCodeDiffSummary,
  RoomCodePatchRequest,
  RoomUpdate,
  SharedThreadCheckout,
} from "./guestShare.ts";
import { ModelSelection } from "./modelSelection.ts";
import { ProviderInteractionMode, RuntimeMode } from "./providerPolicy.ts";

// Joining a shared thread on your own machine. The owner's side of it is in guestShare.ts.

/** Where a shared thread comes from: its owner's T Connect host and a guest's handoff token. */
export const SharedThreadSource = Schema.Struct({
  host: TrimmedNonEmptyString,
  token: TrimmedNonEmptyString,
});
export type SharedThreadSource = typeof SharedThreadSource.Type;

/** What joining would bring over, for the user to confirm before anything is created. */
export const SharedThreadPreview = Schema.Struct({
  title: Schema.String,
  messageCount: NonNegativeInt,
  truncated: Schema.Boolean,
  checkout: Schema.NullOr(SharedThreadCheckout),
  /** The joined thread will show its turns to the room it came from. */
  live: Schema.optional(Schema.Boolean),
});
export type SharedThreadPreview = typeof SharedThreadPreview.Type;

export const SharedThreadLeaveInput = Schema.Struct({ threadId: ThreadId });
export type SharedThreadLeaveInput = typeof SharedThreadLeaveInput.Type;

/**
 * A task card someone took from a room to their own agent: the room as its link names it, and
 * the card. The thread joined from that room remembers the card for its next turn.
 */
export const SharedThreadTakeTaskInput = Schema.Struct({
  host: TrimmedNonEmptyString,
  shareId: GuestShareId,
  taskId: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
});
export type SharedThreadTakeTaskInput = typeof SharedThreadTakeTaskInput.Type;

/** The thread joined from that room on this machine, or null when there is none to take it to. */
export const SharedThreadTakeTaskResult = Schema.Struct({ threadId: Schema.NullOr(ThreadId) });
export type SharedThreadTakeTaskResult = typeof SharedThreadTakeTaskResult.Type;

/** An artifact card someone takes from a room to their own agent, to fill it from here. */
export const SharedThreadTakeArtifactInput = Schema.Struct({
  host: TrimmedNonEmptyString,
  shareId: GuestShareId,
  artifactId: RoomBoardNote.fields.id,
});
export type SharedThreadTakeArtifactInput = typeof SharedThreadTakeArtifactInput.Type;

/**
 * The thread joined from that room on this machine, or null when there is none, and the card as
 * the room has it now, or null when the room no longer has it. Nothing is sent or changed.
 */
export const SharedThreadTakeArtifactResult = Schema.Struct({
  threadId: Schema.NullOr(ThreadId),
  artifact: Schema.NullOr(RoomArtifactRead),
});
export type SharedThreadTakeArtifactResult = typeof SharedThreadTakeArtifactResult.Type;

/**
 * A prompt to one of the user's own thread boxes on a room's board, run by their own agent here:
 * in the box's thread on this machine, made beside the thread joined from that room the first
 * time. The room sees the turn; the owner's agent never runs it.
 */
export const SharedThreadPromptBoxInput = Schema.Struct({
  host: TrimmedNonEmptyString,
  shareId: GuestShareId,
  boxId: RoomBoardNote.fields.id,
  /** The box's title, which names its thread. */
  title: RoomBoardNote.fields.text,
  text: Schema.String.check(Schema.isMaxLength(GUEST_MESSAGE_MAX_LENGTH)),
  /** The cards with an arrow into the box, as the user's board shows them. */
  cards: Schema.optional(Schema.Array(RoomBoardContextCard)),
  /** The artifact card the reply fills, read from the room as it is now. */
  artifactId: Schema.optional(RoomBoardNote.fields.id),
  /** The comment thread the reply is posted in, which the room checks when it takes the turn. */
  commentId: Schema.optional(RoomBoardNote.fields.id),
  /** Absent: the box thread's own model, or the joined thread's for a box prompted first. */
  modelSelection: Schema.optional(ModelSelection),
});
export type SharedThreadPromptBoxInput = typeof SharedThreadPromptBoxInput.Type;

/** The box's thread on this machine, or null when no thread here is in that room. */
export const SharedThreadPromptBoxResult = Schema.Struct({ threadId: Schema.NullOr(ThreadId) });
export type SharedThreadPromptBoxResult = typeof SharedThreadPromptBoxResult.Type;

/**
 * Makes one of the user's existing threads on this machine the thread behind their own new thread
 * box on a room's board, which their app already added there. Its turns show on the box from then.
 */
export const SharedThreadLinkBoxInput = Schema.Struct({
  host: TrimmedNonEmptyString,
  shareId: GuestShareId,
  boxId: RoomBoardNote.fields.id,
  threadId: ThreadId,
});
export type SharedThreadLinkBoxInput = typeof SharedThreadLinkBoxInput.Type;

/** A room as its link names it, to find what this machine has of it. */
export const SharedThreadFindRoomInput = Schema.Struct({
  host: TrimmedNonEmptyString,
  shareId: GuestShareId,
});
export type SharedThreadFindRoomInput = typeof SharedThreadFindRoomInput.Type;

/**
 * The thread joined from that room on this machine, or null when there is none, and the thread
 * here behind each of the user's own thread boxes, by box id.
 */
export const SharedThreadFindRoomResult = Schema.Struct({
  threadId: Schema.NullOr(ThreadId),
  boxes: Schema.Record(Schema.String, ThreadId),
});
export type SharedThreadFindRoomResult = typeof SharedThreadFindRoomResult.Type;

/**
 * One file's patch from the thread here behind one of the user's own thread boxes in a room, as
 * a code window on that room's board lists it. Only this machine has it.
 */
export const SharedThreadBoxPatchInput = Schema.Struct({
  host: TrimmedNonEmptyString,
  shareId: GuestShareId,
  boxId: RoomBoardNote.fields.id,
  turnCount: RoomCodeDiffSummary.fields.turnCount,
  path: RoomCodePatchRequest.fields.path,
  scope: RoomCodePatchRequest.fields.scope,
});
export type SharedThreadBoxPatchInput = typeof SharedThreadBoxPatchInput.Type;

export const SharedThreadCatchUpInput = Schema.Struct({ threadId: ThreadId });
export type SharedThreadCatchUpInput = typeof SharedThreadCatchUpInput.Type;

/**
 * What the room said since the thread last caught up. The client attaches it to the user's next
 * message; nothing here starts a turn.
 */
export const SharedThreadCatchUpResult = Schema.Struct({
  updates: Schema.Array(RoomUpdate),
  truncated: Schema.Boolean,
  /** Names this batch, so attaching it twice makes one chip. */
  cursor: Schema.NullOr(IsoDateTime),
});
export type SharedThreadCatchUpResult = typeof SharedThreadCatchUpResult.Type;

/**
 * A catch-up as the thread's own agent reads it through MCP: the room's words as one text, under
 * a notice that they are other people's and not instructions.
 */
export const SharedRoomCatchUpMcpResult = Schema.Struct({
  notice: Schema.String,
  messages: NonNegativeInt,
  truncated: Schema.Boolean,
  roomSaid: Schema.String,
});
export type SharedRoomCatchUpMcpResult = typeof SharedRoomCatchUpMcpResult.Type;

export const SharedThreadJoinInput = Schema.Struct({
  commandId: CommandId,
  source: SharedThreadSource,
  projectId: ProjectId,
  modelSelection: ModelSelection,
  runtimeMode: RuntimeMode,
  interactionMode: ProviderInteractionMode,
  /** Start from the shared branch in a new worktree. That runs the project's setup script. */
  checkout: Schema.Boolean,
});
export type SharedThreadJoinInput = typeof SharedThreadJoinInput.Type;

export const SharedThreadJoinResult = Schema.Struct({
  threadId: ThreadId,
  /**
   * The room as the guest's app keeps it, to show the shared thread and its board beside the
   * joined one. Absent when the owner's server gave no session.
   */
  shared: Schema.optional(
    Schema.Struct({
      shareId: GuestShareId,
      threadId: ThreadId,
      token: TrimmedNonEmptyString,
      title: Schema.String,
    }),
  ),
});
export type SharedThreadJoinResult = typeof SharedThreadJoinResult.Type;

const SHARED_THREAD_JOIN_MESSAGES = {
  invalid_host: "This link does not name a machine T Code can reach.",
  unreachable: "Could not reach the machine that shared this thread. It may be offline.",
  expired:
    "This link has expired, or the thread is no longer shared with you. Open the shared thread and choose Continue on my machine again.",
  invalid_response:
    "The other machine sent something T Code could not read. It may run a different version.",
  launch_failed: "Could not create the thread on this machine.",
  leave_failed: "Could not leave the room. Try again.",
  not_in_room: "This thread is not connected to a room.",
  room_ended: "The room has ended, or you are no longer in it.",
  too_fast: "The room was asked too often. Try again in a minute.",
  thread_unavailable:
    "This thread cannot go on the board. It may be archived or deleted, or in a room already.",
} as const;

export class SharedThreadJoinError extends Schema.TaggedError<SharedThreadJoinError>()(
  "SharedThreadJoinError",
  {
    reason: Schema.Literals([
      "invalid_host",
      "unreachable",
      "expired",
      "invalid_response",
      "launch_failed",
      "leave_failed",
      "not_in_room",
      "room_ended",
      "too_fast",
      "thread_unavailable",
    ]),
  },
) {
  override get message(): string {
    return SHARED_THREAD_JOIN_MESSAGES[this.reason];
  }
}
