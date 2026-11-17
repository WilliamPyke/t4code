import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { ThreadRoomBoard } from "../components/room/ThreadRoomBoard";
import { type BoardViewMode, boardViewModeOf } from "../components/room/boardPlan.logic";
import { rememberRoomBoardChat } from "../components/room/roomBoardNavigation";

// The params are not named environmentId/threadId: the _chat layout shows the thread for those.
function RoomBoardRoute() {
  const { roomEnvironmentId, roomThreadId } = Route.useParams();
  const { chat, view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const threadRef = scopeThreadRef(
    EnvironmentId.make(roomEnvironmentId),
    ThreadId.make(roomThreadId),
  );
  const go = (next: { readonly chat: string | null; readonly view: BoardViewMode }) =>
    void navigate({
      search: {
        ...(next.chat === null ? {} : { chat: next.chat }),
        ...(next.view === "plan" ? { view: next.view } : {}),
      },
      replace: true,
    });
  return (
    <ThreadRoomBoard
      key={`${roomEnvironmentId}:${roomThreadId}`}
      threadRef={threadRef}
      chat={chat ?? null}
      onChat={(next) => {
        rememberRoomBoardChat(threadRef, next);
        go({ chat: next, view: view ?? "board" });
      }}
      view={view ?? "board"}
      onView={(next) => go({ chat: chat ?? null, view: next })}
    />
  );
}

export const Route = createFileRoute("/_chat/board/$roomEnvironmentId/$roomThreadId")({
  // Which thread box's conversation shows beside the board ("thread" for the room thread's own),
  // and whether the board shows its tasks as a Plan.
  validateSearch: (raw: Record<string, unknown>): { chat?: string; view?: "plan" } => ({
    ...(typeof raw.chat === "string" && raw.chat.trim() !== "" ? { chat: raw.chat } : {}),
    ...(boardViewModeOf(raw.view) === "plan" ? { view: "plan" as const } : {}),
  }),
  component: RoomBoardRoute,
});
