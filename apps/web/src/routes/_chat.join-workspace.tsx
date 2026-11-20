import { createFileRoute, useLocation } from "@tanstack/react-router";

import { WorkspaceJoinPage } from "../components/boards/WorkspaceJoin";

// The invite's code is in the hash, so it never reaches a server's logs.
function JoinWorkspaceRoute() {
  const hash = useLocation({ select: (location) => location.hash.replace(/^#/, "") });
  return <WorkspaceJoinPage hash={hash} />;
}

export const Route = createFileRoute("/_chat/join-workspace")({
  component: JoinWorkspaceRoute,
});
