import { useAtomValue } from "@effect/atom-react";
import { RELAY_TEAM_NAME_MAX_LENGTH } from "@t3tools/contracts/relay";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { type FormEvent, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
import { createTeam } from "~/teams/teams";
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

const newTeamDialogOpenAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("teams:new-team-dialog"),
);

/** Opens the new team dialog, from the sidebar or the command palette. */
export function openNewTeamDialog(): void {
  appAtomRegistry.set(newTeamDialogOpenAtom, true);
}

const close = () => appAtomRegistry.set(newTeamDialogOpenAtom, false);

/** Hosted once at the root, so the sidebar and Cmd-K both open it. */
export function NewTeamDialogHost() {
  return useAtomValue(newTeamDialogOpenAtom) ? <NewTeamDialog /> : null;
}

function NewTeamDialog() {
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
    close();
    void navigate({ to: "/teams/$teamId", params: { teamId: created.value.id } });
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
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
            <Button type="button" variant="outline" size="sm" onClick={close} disabled={busy}>
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
