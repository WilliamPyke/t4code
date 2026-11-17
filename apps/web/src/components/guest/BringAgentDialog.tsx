import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import { useProjects } from "~/state/entities";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/**
 * How a person brings their own agent to a cloud board, which has none of its own: continue on
 * their machine, or connect one to this browser first when it has none.
 */
export function BringAgentDialog({
  open,
  onOpenChange,
  onContinue,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Opens this board on the person's own machine. Resolves to what went wrong, or null. */
  readonly onContinue: () => Promise<string | null>;
}) {
  // Their own machines are the ones with projects; a joined board's page has none.
  const hasMachine = useProjects().some((project) => !isGuestEnvironment(project.environmentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    const failed = await onContinue();
    setBusy(false);
    setError(failed);
    if (failed === null) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-md" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Bring your agent to this board</DialogTitle>
          <DialogDescription>
            {hasMachine
              ? "Agents here run on each person's own computer. Continue on your machine to add this board there, then come back to add thread boxes and ask your agent."
              : "Agents here run on each person's own computer, in Tinkjam. Connect your computer to this browser first, then come back to this board."}
          </DialogDescription>
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogHeader>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="outline" />}>Not now</DialogClose>
          {hasMachine ? (
            <Button disabled={busy} onClick={() => void start()}>
              Continue on my machine
            </Button>
          ) : (
            <Button render={<Link to="/settings/connections" />}>Connect a computer</Button>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
