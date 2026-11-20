import { createFileRoute } from "@tanstack/react-router";

import { TeamPage } from "../components/teams/TeamPage";

function TeamRouteView() {
  const { teamId } = Route.useParams();
  return <TeamPage key={teamId} teamId={teamId} />;
}

export const Route = createFileRoute("/_chat/teams/$teamId")({
  component: TeamRouteView,
});
