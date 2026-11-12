import { createFileRoute } from "@tanstack/react-router";

import { TeamInvitePage } from "../components/teams/TeamInvitePage";

function TeamInviteRouteView() {
  const { name } = Route.useParams();
  return <TeamInvitePage name={name} />;
}

export const Route = createFileRoute("/_chat/t/$name")({
  component: TeamInviteRouteView,
});
