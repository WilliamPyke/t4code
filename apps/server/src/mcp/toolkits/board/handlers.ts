import { OrchestratorMcpFailure, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import * as RoomBoardAgent from "../../../guest/RoomBoardAgent.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { BoardToolkit } from "./tools.ts";

const boardFailure = (error: RoomBoardAgent.RoomBoardAgentError) =>
  new OrchestratorMcpFailure({ code: "invalid_request", message: error.message });

/** The calling thread's board only: no tool names another. */
const asCaller = Effect.fn("BoardTools.asCaller")(function* <A>(
  run: (
    agent: RoomBoardAgent.RoomBoardAgent["Service"],
    threadId: ThreadId,
  ) => Effect.Effect<A, RoomBoardAgent.RoomBoardAgentError>,
) {
  const scope = yield* McpInvocationContext.McpInvocationContext;
  const { thread } = yield* McpInvocationContext.requireThreadScope(scope, "This tool");
  const agent = yield* RoomBoardAgent.RoomBoardAgent;
  return yield* run(agent, thread.threadId).pipe(Effect.mapError(boardFailure));
});

const handlers = {
  t3_board_read: McpToolAccess.readsAsCaller(() =>
    asCaller((agent, threadId) => agent.read(threadId)),
  ),
  t3_board_add: McpToolAccess.actsAsCaller((input) =>
    asCaller((agent, threadId) => agent.add(threadId, input)),
  ),
  t3_board_update: McpToolAccess.actsAsCaller((input) =>
    asCaller((agent, threadId) => agent.update(threadId, input)),
  ),
  t3_board_arrange: McpToolAccess.actsAsCaller((input) =>
    asCaller((agent, threadId) => agent.arrange(threadId, input)),
  ),
} satisfies McpToolAccess.Handlers<typeof BoardToolkit.tools>;

export const layer = McpToolAccess.toLayer(BoardToolkit, handlers);
