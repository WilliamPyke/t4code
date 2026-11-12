import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ThreadRoomBoard } from "../components/room/ThreadRoomBoard";

// The params are not named environmentId/threadId: the _chat layout shows the thread for those.
function RoomBoardRoute() {
  const { roomEnvironmentId, roomThreadId } = Route.useParams();
  const { chat } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const threadRef = scopeThreadRef(
    EnvironmentId.make(roomEnvironmentId),
    ThreadId.make(roomThreadId),
  );
  return (
    <ThreadRoomBoard
      key={`${roomEnvironmentId}:${roomThreadId}`}
      threadRef={threadRef}
      chat={chat ?? null}
      onChat={(next) =>
        void navigate({ search: next === null ? {} : { chat: next }, replace: true })
      }
    />
  );
}

export const Route = createFileRoute("/_chat/board/$roomEnvironmentId/$roomThreadId")({
  // Which thread box's conversation shows beside the board: "thread" for the room thread's own.
  validateSearch: (raw: Record<string, unknown>): { chat?: string } =>
    typeof raw.chat === "string" && raw.chat.trim() !== "" ? { chat: raw.chat } : {},
  component: RoomBoardRoute,
});
