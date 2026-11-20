import { Dialog as DialogPrimitive } from "@base-ui/react/dialog";
import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { BotIcon, XIcon } from "lucide-react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { create } from "zustand";

import { environmentCatalog } from "~/connection/catalog";
import { useEnvironmentProviders } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { detectSyncOs } from "~/syncDownloads";

import { artAgentFor, type ArtAgent } from "./brand/agentArt";
import { ArtCard, ArtConnector, BrandArtPanel, LaptopGlyph } from "./brand/BrandArtPanel";
import { Copyright, SplitHeading, SplitScreen, splitLinkClassName } from "./brand/SplitScreen";
import { useT3ConnectAuthPrompt } from "./clerk/useT3ConnectAuthPrompt";
import { SyncInstallAction, SyncSteps, WaitingForSync } from "./connect/GetSync";
import {
  type AgentState,
  type BringAgentComputer,
  computerAgentStates,
} from "./guest/bringAgent.logic";
import {
  ConnectComputerRoutes,
  CopyAppLink,
  WaitingForComputer,
  onPhoneOrTablet,
} from "./guest/BringAgentDialog";
import { ComputerRow, ComputersLoading, ComputersNotLoaded } from "./guest/ComputerRow";
import { useRemoveComputer, useYourComputers } from "./guest/yourComputers";
import { Button } from "./ui/button";

const DISCOVERY_REFRESH_MS = 4_000;

const useConnectComputerStore = create<{ readonly open: boolean }>(() => ({ open: false }));

/** The one way in to a person's own agents, from the sidebar, Settings and the command menu. */
export function openConnectComputer(): void {
  useConnectComputerStore.setState({ open: true });
}

const closeConnectComputer = () => useConnectComputerStore.setState({ open: false });

/** Connecting a computer, as a page over the app: get Tinkjam Sync, then the computer and its agents. */
export function ConnectComputerDialogHost() {
  const open = useConnectComputerStore((state) => state.open);
  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(next) => useConnectComputerStore.setState({ open: next })}
    >
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          aria-label="Connect a computer"
          className="fixed inset-0 z-50 overflow-y-auto outline-none"
          data-connect-computer
        >
          {open ? <ConnectComputerScreen /> : null}
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Opens this browser's connection to each of the person's computers that comes online. */
function useAddComputersComingOnline(computers: ReadonlyArray<BringAgentComputer>) {
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
}

const readyIds = (computers: ReadonlyArray<BringAgentComputer>) =>
  new Set(
    computers
      .filter((computer) => computer.status === "ready")
      .map((computer) => computer.environmentId),
  );

function ConnectComputerScreen() {
  const list = useYourComputers({ active: true, pollEveryMs: DISCOVERY_REFRESH_MS });
  useAddComputersComingOnline(list.computers);
  // The computers already connected when this opened, once the account has said: a computer
  // that connects after that is the one just set up.
  const [before, setBefore] = useState<ReadonlySet<EnvironmentId> | null>(null);
  if (before === null && !list.loading) setBefore(readyIds(list.computers));
  const connected =
    before === null
      ? undefined
      : list.computers.find(
          (computer) => computer.status === "ready" && !before.has(computer.environmentId),
        );
  return connected === undefined ? (
    <GetSyncScreen list={list} />
  ) : (
    <ConnectedScreen computer={connected} onAnother={() => setBefore(readyIds(list.computers))} />
  );
}

const CloseCorner = () => (
  <DialogPrimitive.Close render={<Button variant="ghost" size="icon" aria-label="Close" />}>
    <XIcon />
  </DialogPrimitive.Close>
);

function GetSyncScreen({ list }: { readonly list: ReturnType<typeof useYourComputers> }) {
  const [os, setOs] = useState(detectSyncOs);
  const removeComputer = useRemoveComputer();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const { computers, withAccount, signedIn } = list;
  return (
    <SplitScreen
      corner={<CloseCorner />}
      footer={
        <button type="button" className={splitLinkClassName} onClick={closeConnectComputer}>
          Skip for now
        </button>
      }
      art={
        <BrandArtPanel headline={{ kind: "bring" }}>
          <ComputerCard name="Your computer" line="Tinkjam Sync not found yet" />
          <ArtConnector tone="waiting" />
          <AgentCard agent={null} chip="Not connected" faded>
            Your agent will show up here, as a box on the board.
          </AgentCard>
        </BrandArtPanel>
      }
    >
      <SplitHeading>Connect your computer</SplitHeading>
      <p className="mt-3 text-base text-muted-foreground">
        Tinkjam Sync lets your own agent work on the board.
      </p>
      {os === null ? (
        <div className="mt-7 flex flex-col gap-3 text-base" data-sync-other-device>
          <p>
            Agents run on a computer, not on a phone or tablet. Open Tinkjam on your Mac or PC, sign
            in, and connect it from there.
          </p>
          <CopyAppLink />
        </div>
      ) : (
        <>
          <div className="mt-7">
            <SyncInstallAction os={os} onChoose={setOs} />
          </div>
          <div className="mt-9">
            <SyncSteps os={os} />
          </div>
          <div className="mt-6 flex flex-col gap-3">
            {!withAccount ? (
              <div>
                <Button
                  variant="outline"
                  render={<Link to="/settings/connections" onClick={closeConnectComputer} />}
                >
                  Add my computer
                </Button>
              </div>
            ) : !signedIn ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
                Sign in here with the same account, so your boards find your computer.
                <Button size="sm" variant="outline" onClick={openAuthPrompt}>
                  Sign in
                </Button>
              </p>
            ) : list.failed ? (
              <ComputersNotLoaded onRetry={list.refresh} />
            ) : list.loading ? (
              <ComputersLoading />
            ) : (
              <WaitingForSync />
            )}
          </div>
        </>
      )}
      {computers.length > 0 ? (
        <section className="mt-9 flex flex-col gap-2" data-your-computers>
          <h2 className="text-sm font-semibold text-foreground">Your computers</h2>
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
        </section>
      ) : null}
    </SplitScreen>
  );
}

const AGENT_STATE_TEXT: Record<AgentState, string> = {
  ready: "Ready",
  checking: "Checking…",
  "signed-out": "Not signed in",
  broken: "Did not start",
  "turned-off": "Turned off",
  "not-installed": "Not installed",
};

function ConnectedScreen({
  computer,
  onAnother,
}: {
  readonly computer: BringAgentComputer;
  readonly onAnother: () => void;
}) {
  const providers = useEnvironmentProviders().get(computer.environmentId) ?? [];
  const agents = computerAgentStates(providers);
  const readyArt = agents
    .filter((agent) => agent.state === "ready")
    .map((agent) => artAgentFor(agent.driver))
    .filter((agent): agent is ArtAgent => agent !== null);
  const firstReady = agents.find((agent) => agent.state === "ready");
  return (
    <SplitScreen
      corner={<CloseCorner />}
      footer={<Copyright />}
      art={
        <BrandArtPanel
          headline={readyArt.length > 0 ? { kind: "on", agents: readyArt } : { kind: "bring" }}
        >
          <ComputerCard name={computer.name} line="Connected" connected />
          <ArtConnector tone="connected" />
          {firstReady === undefined ? null : (
            <AgentCard
              agent={artAgentFor(firstReady.driver)}
              name={artAgentFor(firstReady.driver)?.name ?? firstReady.name}
              chip="Ready"
            >
              Send me something from any board and I'll start.
            </AgentCard>
          )}
        </BrandArtPanel>
      }
    >
      <span
        aria-hidden
        className="inline-flex size-13 items-center justify-center rounded-full bg-success-foreground text-background"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="size-6"
        >
          <path d="M5 12.5l4.5 4.5L19 7.5" />
        </svg>
      </span>
      <SplitHeading className="mt-5.5">You're connected</SplitHeading>
      <p className="mt-3 text-base wrap-anywhere text-muted-foreground" data-computer-connected>
        {computer.name}
      </p>
      {providers.length === 0 ? (
        <p role="status" className="mt-6.5 text-sm text-muted-foreground">
          {computer.name} is still checking its agents.
        </p>
      ) : (
        <ul className="mt-6.5 flex flex-col border-b border-border" data-connected-agents>
          {agents.map((agent) => {
            const art = artAgentFor(agent.driver);
            return (
              <li
                key={agent.driver}
                className="flex items-center gap-3.5 border-t border-border py-3.5 font-semibold text-foreground"
                data-agent-state={agent.state}
              >
                {art === null ? (
                  <BotIcon aria-hidden className="size-6.5 text-muted-foreground" />
                ) : (
                  <img src={art.icon} alt="" className="size-6.5" />
                )}
                {art?.name ?? agent.name}
                <span
                  className={
                    agent.state === "ready"
                      ? "ms-auto text-sm font-medium text-success-foreground"
                      : "ms-auto text-sm font-medium text-muted-foreground"
                  }
                >
                  {AGENT_STATE_TEXT[agent.state]}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-7.5 flex flex-wrap items-center gap-x-4.5 gap-y-3">
        <Button size="pill" render={<Link to="/" onClick={closeConnectComputer} />}>
          Go to my boards
        </Button>
        <button type="button" className={splitLinkClassName} onClick={onAnother}>
          Connect another computer
        </button>
      </div>
    </SplitScreen>
  );
}

function ComputerCard({
  name,
  line,
  connected = false,
}: {
  readonly name: string;
  readonly line: string;
  readonly connected?: boolean;
}) {
  return (
    <ArtCard className="bottom-30 left-13 w-57.5 p-4">
      <LaptopGlyph className="h-7 w-8.5" />
      <div className="mt-3 truncate text-ui-md font-semibold">{name}</div>
      <div className={connected ? "font-semibold text-brand-forest" : "text-brand-ink/65"}>
        {line}
      </div>
    </ArtCard>
  );
}

function AgentCard({
  agent,
  name = "Your agent",
  chip,
  faded = false,
  children,
}: {
  readonly agent: ArtAgent | null;
  readonly name?: string;
  readonly chip: string;
  readonly faded?: boolean;
  readonly children: string;
}) {
  return (
    <ArtCard className={faded ? "right-12 bottom-28 w-70 opacity-75" : "right-12 bottom-28 w-70"}>
      <div className="flex items-center gap-2 border-b border-brand-panel px-3 py-2.5 font-semibold">
        {agent === null ? null : <img src={agent.icon} alt="" className="size-4" />}
        {name}
        <span
          className={
            faded
              ? "ms-auto rounded-full bg-brand-panel px-2 py-0.75 text-2xs font-semibold text-brand-ink/65"
              : "ms-auto rounded-full bg-brand-forest px-2 py-0.75 text-2xs font-semibold text-white"
          }
        >
          {chip}
        </span>
      </div>
      <p className={faded ? "p-3.5 text-brand-ink/65" : "p-3.5"}>{children}</p>
    </ArtCard>
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
  useAddComputersComingOnline(computers);

  const connected = computers.find((computer) => computer.status === "ready");
  // On a phone nobody is about to press Connect here, so nothing waits for a first computer.
  const waits = withAccount && signedIn && (list.failed || !onPhoneOrTablet());
  return (
    <div className="flex flex-col gap-5">
      {/* Above the steps, so a computer that connects shows where the wait was and moves nothing. */}
      {computers.length === 0 && !waits ? null : (
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
