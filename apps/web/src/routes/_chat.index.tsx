import { useAtomValue } from "@effect/atom-react";
import { createFileRoute, Navigate } from "@tanstack/react-router";

import { BoardsHome } from "../components/boards/BoardsHome";
import { GuestNotice } from "../components/guest/GuestThreadView";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { cloudBoardsOrigin } from "../guest/cloudBoardsHost";
import { guestShareLocation, guestSharesAtom } from "../guest/guestShares";
import { SidebarInset } from "../components/ui/sidebar";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();
  const latestShare = useAtomValue(guestSharesAtom).at(-1);

  // With cloud boards the hosted app makes and lists boards without any machine.
  const cloud = authGateState.status === "hosted-static" && cloudBoardsOrigin() !== null;
  if (authGateState.status === "hosted-static" || authGateState.status === "guest") {
    if (!isReady) return null;
    if (environments.length === 0 && !cloud) {
      if (latestShare !== undefined) {
        return <Navigate {...guestShareLocation(latestShare)} replace />;
      }
      return authGateState.status === "guest" ? (
        <SidebarInset className="flex h-dvh">
          <GuestNotice
            title="The threads shared with you have ended"
            detail="Ask the owner for a new link."
          />
        </SidebarInset>
      ) : (
        <HostedEmptyState />
      );
    }
  }

  return <BoardsHome />;
}

export const Route = createFileRoute("/_chat/")({
  component: ChatIndexRouteView,
});
