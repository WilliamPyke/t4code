import { useAtomValue } from "@effect/atom-react";
import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import { createFileRoute, Navigate } from "@tanstack/react-router";

import { BoardsHome } from "../components/boards/BoardsHome";
import { GuestNotice } from "../components/guest/GuestThreadView";
import { HostedEmptyState } from "../components/HostedEmptyState";
import { guestSharesAtom } from "../guest/guestShares";
import { SidebarInset } from "../components/ui/sidebar";
import { useEnvironments } from "../state/environments";

function ChatIndexRouteView() {
  const { authGateState } = Route.useRouteContext();
  const { environments, isReady } = useEnvironments();
  const latestShare = useAtomValue(guestSharesAtom).at(-1);

  if (authGateState.status === "hosted-static" || authGateState.status === "guest") {
    if (!isReady) return null;
    if (environments.length === 0) {
      if (latestShare !== undefined) {
        return (
          <Navigate
            to="/$environmentId/$threadId"
            params={{
              environmentId: guestEnvironmentId(latestShare.shareId),
              threadId: latestShare.threadId,
            }}
            replace
          />
        );
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
