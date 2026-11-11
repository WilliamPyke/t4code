import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { createFileRoute } from "@tanstack/react-router";

import { ThreadRoomBoard } from "../components/room/ThreadRoomBoard";

// The params are not named environmentId/threadId: the _chat layout shows the thread for those.
function RoomBoardRoute() {
  const { roomEnvironmentId, roomThreadId } = Route.useParams();
  const threadRef = scopeThreadRef(
    EnvironmentId.make(roomEnvironmentId),
    ThreadId.make(roomThreadId),
  );
  return <ThreadRoomBoard key={`${roomEnvironmentId}:${roomThreadId}`} threadRef={threadRef} />;
}

export const Route = createFileRoute("/_chat/board/$roomEnvironmentId/$roomThreadId")({
  component: RoomBoardRoute,
});
