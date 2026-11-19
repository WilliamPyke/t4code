import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";
import { create } from "zustand";

import { environmentCatalog } from "~/connection/catalog";
import { useAtomCommand } from "~/state/use-atom-command";

import { ConnectComputerRoutes, WaitingForComputer } from "./guest/BringAgentDialog";
import { ComputerRow, ComputersLoading, ComputersNotLoaded } from "./guest/ComputerRow";
import { useRemoveComputer, useYourComputers } from "./guest/yourComputers";
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

const DISCOVERY_REFRESH_MS = 4_000;

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
  return (
    // One height whatever it shows, so picking a computer or one connecting moves no button.
    <DialogPopup className="h-180 max-w-2xl" data-connect-computer>
      <DialogHeader>
        <DialogTitle>Connect a computer</DialogTitle>
        <DialogDescription>
          Use the agents on your computer, such as Claude Code or Codex, on your boards. They run
          there, under your own account, and only you can start them.
        </DialogDescription>
      </DialogHeader>
      <DialogPanel>
        <ConnectComputerSteps />
      </DialogPanel>
      <DialogFooter variant="bare">
        <DialogClose render={<Button variant="outline" />}>Done</DialogClose>
      </DialogFooter>
    </DialogPopup>
  );
}

/**
 * How to get Tinkjam Sync, and the person's computers as every list shows them. A computer that
 * comes online while this shows is added to this browser at once, so it is ready on a board.
 */
export function ConnectComputerSteps() {
  const list = useYourComputers({ active: true, pollEveryMs: DISCOVERY_REFRESH_MS });
  const { computers, withAccount, signedIn } = list;
  const removeComputer = useRemoveComputer();
  const registerEnvironment = useAtomCommand(environmentCatalog.register, {
    reportFailure: false,
  });
  const added = useRef(new Set<EnvironmentId>());
  const newlyOnline = computers.filter((computer) => computer.status === "online");
  const newlyOnlineKey = newlyOnline.map((computer) => computer.environmentId).join("\n");
  const addNewlyOnline = useEffectEvent(() => {
    for (const computer of newlyOnline) {
      if (added.current.has(computer.environmentId)) continue;
      added.current.add(computer.environmentId);
      void registerEnvironment(
        new RelayConnectionRegistration({
          target: new RelayConnectionTarget({
            environmentId: computer.environmentId,
            label: computer.name,
          }),
        }),
      );
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- opens this browser's connection to a computer the account says just came online
  useEffect(() => {
    if (newlyOnlineKey !== "") addNewlyOnline();
  }, [newlyOnlineKey]);

  const connected = computers.find((computer) => computer.status === "ready");
  return (
    <div className="flex flex-col gap-5">
      {/* Above the steps, so a computer that connects shows where the wait was and moves nothing. */}
      {computers.length === 0 && !(withAccount && signedIn) ? null : (
        <section className="flex flex-col gap-2" data-your-computers>
          <h3 className="text-sm font-medium">Your computers</h3>
          {computers.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {computers.map((computer) => (
                <ComputerRow
                  key={computer.environmentId}
                  computer={computer}
                  thisComputer={list.primaryIds.has(computer.environmentId)}
                  onRetry={() => list.retry(computer)}
                  onRemove={
                    list.primaryIds.has(computer.environmentId)
                      ? null
                      : () => removeComputer.remove(computer)
                  }
                  removeQuestion={removeComputer.question(computer.name)}
                />
              ))}
            </ul>
          ) : list.loading ? (
            <ComputersLoading />
          ) : list.failed ? null : (
            <WaitingForComputer next="Then open a board and press Bring my agent." />
          )}
          {list.failed ? <ComputersNotLoaded onRetry={list.refresh} /> : null}
          {connected === undefined ? null : (
            <p role="status" className="text-sm" data-computer-connected>
              {connected.name} is connected. Open a board and press Bring my agent.
            </p>
          )}
        </section>
      )}
      <ConnectComputerRoutes withAccount={withAccount} signedIn={signedIn} />
    </div>
  );
}
