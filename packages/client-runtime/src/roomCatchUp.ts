import type { RoomUpdatesContextRecord, SharedThreadCatchUpResult } from "@t3tools/contracts";
import { roomUpdatesContextRecord } from "@t3tools/shared/composerContextReferences";

/**
 * What a catch-up gives the composer: the record to attach to the user's next message, or none
 * when the room said nothing new, and the line that says which. Attaching is all a client does
 * with it; the user sends the message.
 */
export function roomCatchUpOutcome(result: SharedThreadCatchUpResult): {
  readonly record: RoomUpdatesContextRecord | null;
  readonly status: string;
} {
  const { updates, truncated, cursor } = result;
  if (updates.length === 0 || cursor === null) return { record: null, status: "Nothing new" };
  return {
    record: roomUpdatesContextRecord({ batch: cursor, updates, truncated }),
    status: `${updates.length} ${updates.length === 1 ? "update" : "updates"} added to your message`,
  };
}

export const roomCatchUpFailureMessage = (error: unknown): string =>
  error instanceof Error && error.message ? error.message : "Could not reach the room";
