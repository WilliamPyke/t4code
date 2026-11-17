import type { EnvironmentId } from "@t3tools/contracts";
import { useState } from "react";
import { create } from "zustand";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";

import { CloudEnvironmentConnectRows } from "./cloud/CloudEnvironmentConnectList";
import { ConnectComputerRoutes } from "./guest/BringAgentDialog";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "./ui/dialog";

const useConnectComputerStore = create<{ readonly open: boolean }>(() => ({ open: false }));

/** The one way in to a person's own agents, from the sidebar, Settings and the command menu. */
export function openConnectComputer(): void {
  useConnectComputerStore.setState({ open: true });
}

export function ConnectComputerDialogHost() {
  const open = useConnectComputerStore((state) => state.open);
  return (
    <Dialog open={open} onOpenChange={(next) => useConnectComputerStore.setState({ open: next })}>
      {open ? <ConnectComputerDialog /> : null}
    </Dialog>
  );
}

function ConnectComputerDialog() {
  const account = useBoardAccount();
  const withAccount = boardAccountsEnabled() && hasCloudPublicConfig();
  const signedIn = account.status === "signed-in";
  // A computer that shows up while this is open connects at once.
  const [autoAddedComputers] = useState(() => new Set<EnvironmentId>());
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<EnvironmentId>>(() => new Set());
  return (
    <DialogPopup className="max-w-2xl" data-connect-computer>
      <DialogHeader>
        <DialogTitle>Connect a computer</DialogTitle>
        <DialogDescription>
          Use the agents on your computer, such as Claude Code or Codex, on your boards. They run
          under your own account, and only you can start them.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <div className="flex flex-col gap-5">
          <ConnectComputerRoutes withAccount={withAccount} signedIn={signedIn} />
          {withAccount && signedIn ? (
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">Your computers</h3>
              <CloudEnvironmentConnectRows
                primaryEnvironmentId={null}
                savedEnvironments={[]}
                refreshWhileEmpty
                selection={{
                  autoSelectedComputers: autoAddedComputers,
                  selectedIds,
                  onChange: (environmentId, selected) =>
                    setSelectedIds((current) => {
                      const next = new Set(current);
                      if (selected) next.add(environmentId);
                      else next.delete(environmentId);
                      return next;
                    }),
                }}
                empty={
                  <p className="text-xs text-muted-foreground">Waiting for your computer...</p>
                }
              />
            </section>
          ) : null}
        </div>
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
      </DialogFooter>
    </DialogPopup>
  );
}
