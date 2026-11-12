import { Link, useParams } from "@tanstack/react-router";
import { PlusIcon, UsersRoundIcon } from "lucide-react";

import { useTeams } from "~/teams/teams";
import { openNewTeamDialog } from "../teams/NewTeamDialog";
import { Button } from "../ui/button";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

/**
 * The teams the signed-in account is in, each opening its page. Nothing renders while signed
 * out or in a build without T Connect.
 */
export function TeamsSection() {
  const { accountId, teams } = useTeams();
  const activeTeamId = useParams({ strict: false, select: (params) => params.teamId ?? null });
  if (accountId === null) return null;
  return (
    <SidebarGroup aria-label="Teams">
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          <UsersRoundIcon aria-hidden className="size-3.5" />
          Teams
        </p>
        <Button
          size="icon-xs"
          variant="ghost-muted"
          aria-label="New team"
          onClick={openNewTeamDialog}
        >
          <PlusIcon />
        </Button>
      </div>
      <SidebarMenu>
        {(teams ?? []).map((team) => (
          <SidebarMenuItem key={team.id}>
            <SidebarMenuButton
              size="sm"
              isActive={team.id === activeTeamId}
              render={<Link to="/teams/$teamId" params={{ teamId: team.id }} />}
            >
              <span className="min-w-0 truncate">{team.name}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
