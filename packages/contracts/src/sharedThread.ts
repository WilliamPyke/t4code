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
import { RoomUpdate, SharedThreadCheckout } from "./guestShare.ts";
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

export const SharedThreadJoinResult = Schema.Struct({ threadId: ThreadId });
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
    ]),
  },
) {
  override get message(): string {
    return SHARED_THREAD_JOIN_MESSAGES[this.reason];
  }
}
