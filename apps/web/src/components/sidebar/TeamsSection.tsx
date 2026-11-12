import { RELAY_TEAM_NAME_MAX_LENGTH } from "@t3tools/contracts/relay";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { PlusIcon, UsersRoundIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { createTeam, useTeams } from "~/teams/teams";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

/**
 * The teams the signed-in account is in, each opening its page. Nothing renders while signed
 * out or in a build without T Connect.
 */
export function TeamsSection() {
  const { accountId, teams } = useTeams();
  const activeTeamId = useParams({ strict: false, select: (params) => params.teamId ?? null });
  const [creating, setCreating] = useState(false);
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
          onClick={() => setCreating(true)}
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
      {creating ? <NewTeamDialog onClose={() => setCreating(false)} /> : null}
    </SidebarGroup>
  );
}

function NewTeamDialog({ onClose }: { readonly onClose: () => void }) {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || busy) return;
    setBusy(true);
    const created = await createTeam(trimmed);
    setBusy(false);
    if (!created.ok) {
      setError(created.message);
      return;
    }
    onClose();
    void navigate({ to: "/teams/$teamId", params: { teamId: created.value.id } });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogPopup className="max-w-sm">
        <form onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New team</DialogTitle>
            <DialogDescription>
              Teammates join with their T Connect account and see the threads you share with the
              team.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <Input
              autoFocus
              aria-label="Team name"
              placeholder="Team name"
              maxLength={RELAY_TEAM_NAME_MAX_LENGTH}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
            {error === null ? null : (
              <p role="alert" className="pt-2 text-destructive text-xs">
                {error}
              </p>
            )}
          </DialogPanel>
          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={busy || name.trim() === ""}>
              {busy ? "Creating..." : "Create team"}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}
