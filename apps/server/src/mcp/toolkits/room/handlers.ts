import {
  OrchestratorMcpFailure,
  type SharedRoomCatchUpMcpResult,
  type SharedThreadCatchUpResult,
  type SharedThreadJoinError,
} from "@t3tools/contracts";
import {
  ROOM_UPDATES_NOTICE,
  roomUpdatesContextRecord,
} from "@t3tools/shared/composerContextReferences";
import * as Effect from "effect/Effect";

import * as SharedRoomLink from "../../../guest/SharedRoomLink.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { RoomToolkit } from "./tools.ts";

/** The same text the Room updates chip carries, under the same notice of whose words they are. */
function roomCatchUpForAgent(result: SharedThreadCatchUpResult): SharedRoomCatchUpMcpResult {
  const record = roomUpdatesContextRecord({
    batch: result.cursor ?? "none",
    updates: result.updates,
    truncated: result.truncated,
  });
  return {
    notice: ROOM_UPDATES_NOTICE,
    messages: record.messageCount,
    truncated: record.truncated,
    roomSaid: record.text,
  };
}

const catchUpFailure = (error: SharedThreadJoinError) =>
  new OrchestratorMcpFailure({
    code:
      error.reason === "not_in_room" || error.reason === "room_ended"
        ? "invalid_request"
        : "orchestration_error",
    message: error.message,
  });

const handlers = {
  // Only the calling thread: what the room said enters the turn that asked, and no other.
  t3_room_catch_up: McpToolAccess.actsAsCaller(() =>
    Effect.gen(function* () {
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "This tool");
      const rooms = yield* SharedRoomLink.SharedRoomLink;
      return yield* rooms
        .catchUp(thread.threadId)
        .pipe(Effect.map(roomCatchUpForAgent), Effect.mapError(catchUpFailure));
    }),
  ),
} satisfies McpToolAccess.Handlers<typeof RoomToolkit.tools>;

export const layer = McpToolAccess.toLayer(RoomToolkit, handlers);
