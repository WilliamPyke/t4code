import {
  orchestrationProtocolCompatibilityError,
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Option from "effect/Option";
import { type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { TINKJAM_SYNC_COMMAND } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { environmentCatalog } from "~/connection/catalog";
import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironments, useRelayEnvironmentDiscovery } from "~/state/environments";
import { relayEnvironmentDiscovery } from "~/state/relay";
import { useAtomCommand } from "~/state/use-atom-command";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { CommandBlock } from "../CommandBlock";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { type BringAgentComputer, bringAgentComputers } from "./bringAgent.logic";

// Discovery lists the account's computers; refreshed only while the dialog waits for one.
const DISCOVERY_REFRESH_MS = 5_000;

type BringAgent = (
  environmentId: EnvironmentId,
  project: EnvironmentProject | null,
) => Promise<string | null>;

/**
 * How a person brings their own agent to a cloud board, which has none of its own: pick one of
 * their computers, or connect one with Tinkjam Sync first. Figma-style, the desktop app is the
 * other route, not built yet.
 */
export function BringAgentDialog({
  open,
  onOpenChange,
  onBring,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Brings the agent from that computer onto this board. Resolves to what went wrong, or null. */
  readonly onBring: BringAgent;
}) {
  const account = useBoardAccount();
  const withAccount = boardAccountsEnabled() && hasCloudPublicConfig();
  const signedIn = account.status === "signed-in";
  const { environments } = useEnvironments();
  const discovery = useRelayEnvironmentDiscovery();
  const refreshDiscovery = useAtomCommand(relayEnvironmentDiscovery.refresh, {
    reportFailure: false,
  });
  const registerEnvironment = useAtomCommand(environmentCatalog.register, {
    reportFailure: false,
  });
  const computers = bringAgentComputers({
    saved: environments
      .filter((entry) => !isGuestEnvironment(entry.environmentId))
      .map((entry) => ({
        environmentId: entry.environmentId,
        name: entry.label,
        phase: entry.connection.phase,
        hasConfig: entry.serverConfig !== null,
      })),
    discovered:
      withAccount && signedIn
        ? [...discovery.environments.values()].map(({ environment, availability, status }) => {
            const descriptor = Option.getOrNull(status)?.descriptor;
            return {
              environmentId: environment.environmentId,
              name: environment.label,
              availability,
              unsupported:
                descriptor !== undefined &&
                orchestrationProtocolCompatibilityError(descriptor) !== null,
            };
          })
        : [],
  });
  const hasReady = computers.some((computer) => computer.status === "ready");

  const [busy, setBusy] = useState<EnvironmentId | null>(null);
  const [error, setError] = useState<string | null>(null);
  // A computer this browser is still connecting to: its agent comes once it is ready.
  const [pending, setPending] = useState<{
    readonly environmentId: EnvironmentId;
    readonly project: EnvironmentProject | null;
  } | null>(null);

  const bring = async (environmentId: EnvironmentId, project: EnvironmentProject | null) => {
    setBusy(environmentId);
    setError(null);
    const failed = await onBring(environmentId, project);
    setBusy(null);
    setError(failed);
    if (failed === null) onOpenChange(false);
  };
  const bringWhenReady = useEffectEvent(
    (target: {
      readonly environmentId: EnvironmentId;
      readonly project: EnvironmentProject | null;
    }) => {
      setPending(null);
      void bring(target.environmentId, target.project);
    },
  );
  const pendingReady =
    pending !== null &&
    computers.some(
      (computer) => computer.environmentId === pending.environmentId && computer.status === "ready",
    );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- brings the agent once the computer this browser just connected to reports ready
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- readiness comes from the connection supervisor; bringing clears the wait
    if (pending !== null && pendingReady) bringWhenReady(pending);
  }, [pending, pendingReady]);

  const choose = async (computer: BringAgentComputer, project: EnvironmentProject | null) => {
    if (computer.status === "ready") return void bring(computer.environmentId, project);
    setError(null);
    setPending({ environmentId: computer.environmentId, project });
    if (computer.saved) return;
    const result = await registerEnvironment(
      new RelayConnectionRegistration({
        target: new RelayConnectionTarget({
          environmentId: computer.environmentId,
          label: computer.name,
        }),
      }),
    );
    if (result._tag === "Failure") {
      setPending(null);
      setError(`Could not reach ${computer.name}. Check that Tinkjam Sync is running on it.`);
    }
  };

  const refreshWhileWaiting = useEffectEvent(() => {
    if (document.visibilityState === "visible" && !discovery.refreshing) void refreshDiscovery();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the account's computer list while the dialog waits for one to come online
  useEffect(() => {
    if (!open || !withAccount || !signedIn || hasReady) return;
    refreshWhileWaiting();
    const timer = setInterval(refreshWhileWaiting, DISCOVERY_REFRESH_MS);
    return () => clearInterval(timer);
  }, [open, withAccount, signedIn, hasReady]);

  const setup = <ConnectComputerRoutes withAccount={withAccount} signedIn={signedIn} />;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Bring your agent to this board</DialogTitle>
          <DialogDescription>
            Your agent runs on your own computer, with your own Claude, Codex or other AI account.
            Only you can start it. Others see what it makes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-5">
            {computers.length > 0 ? (
              <section className="flex flex-col gap-2" data-bring-agent-computers>
                <h3 className="text-sm font-medium">Your computers</h3>
                <ul className="flex flex-col gap-2">
                  {computers.map((computer) => (
                    <ComputerRow
                      key={computer.environmentId}
                      computer={computer}
                      working={
                        busy === computer.environmentId ||
                        pending?.environmentId === computer.environmentId
                      }
                      disabled={busy !== null || pending !== null}
                      onBring={(project) => void choose(computer, project)}
                    />
                  ))}
                </ul>
              </section>
            ) : null}
            {error === null ? null : (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {computers.length === 0 ? (
              setup
            ) : (
              <Collapsible>
                <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
                  Connect another computer
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="pt-3">{setup}</div>
                </CollapsiblePanel>
              </Collapsible>
            )}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="outline" />}>Not now</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

const NO_PROJECT = "none";

const STATUS_TEXT: Record<BringAgentComputer["status"], string> = {
  ready: "Connected",
  online: "Online",
  connecting: "Connecting...",
  offline: "Offline. Start Tinkjam Sync on it.",
  unsupported: "Out of date. Run the Tinkjam Sync command on it again.",
};

const STATUS_DOT: Record<BringAgentComputer["status"], string> = {
  ready: "bg-success",
  online: "bg-success",
  connecting: "bg-warning",
  offline: "bg-muted-foreground/35",
  unsupported: "bg-destructive",
};

/** One of the person's computers: whether it is up, the project its agent works in, and Bring. */
function ComputerRow({
  computer,
  working,
  disabled,
  onBring,
}: {
  readonly computer: BringAgentComputer;
  readonly working: boolean;
  readonly disabled: boolean;
  readonly onBring: (project: EnvironmentProject | null) => void;
}) {
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === computer.environmentId &&
      project.isScratch !== true &&
      project.archivedAt == null,
  );
  const [projectId, setProjectId] = useState<string>(NO_PROJECT);
  const items = [
    { value: NO_PROJECT, label: "No project" },
    ...projects.map((project) => ({ value: project.id, label: project.title })),
  ];
  const canBring = computer.status === "ready" || computer.status === "online";
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2.5"
      data-bring-agent-computer={computer.status}
    >
      <span
        aria-hidden
        className={cn("size-2 shrink-0 rounded-full", STATUS_DOT[computer.status])}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{computer.name}</span>
        <span className="block truncate text-xs text-muted-foreground">
          {working && computer.status !== "ready" ? "Connecting..." : STATUS_TEXT[computer.status]}
        </span>
      </span>
      {projects.length > 0 && canBring ? (
        <div className="w-40 shrink-0">
          <Select
            value={projectId}
            onValueChange={(next) => {
              if (next) setProjectId(next);
            }}
            items={items}
          >
            <SelectTrigger size="sm" aria-label="Project your agent works in">
              <SelectValue />
            </SelectTrigger>
            <SelectPopup>
              {items.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectPopup>
          </Select>
        </div>
      ) : null}
      <Button
        size="sm"
        disabled={!canBring || disabled}
        onClick={() => onBring(projects.find((project) => project.id === projectId) ?? null)}
        data-bring-agent
      >
        {working ? "Bringing..." : "Bring my agent"}
      </Button>
    </li>
  );
}

type Os = "unix" | "windows";
const detectOs = (): Os =>
  typeof navigator !== "undefined" && /win/i.test(navigator.userAgent) ? "windows" : "unix";

/** The two ways to connect a computer, side by side: Tinkjam Sync now, the desktop app later. */
function ConnectComputerRoutes({
  withAccount,
  signedIn,
}: {
  readonly withAccount: boolean;
  readonly signedIn: boolean;
}) {
  const [os, setOs] = useState<Os>(detectOs);
  const enter = os === "windows" ? "Enter" : "Return";
  return (
    <div className="grid gap-3 sm:grid-cols-[3fr_2fr]" data-bring-agent-steps>
      <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Tinkjam Sync</h3>
          <Badge variant="success">One command</Badge>
        </div>
        <ToggleGroup
          aria-label="Your computer"
          value={[os]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "unix" || value === "windows") setOs(value);
          }}
        >
          <Toggle value="unix">Mac or Linux</Toggle>
          <Toggle value="windows">Windows</Toggle>
        </ToggleGroup>
        <ol className="flex flex-col gap-2.5 text-sm">
          <Step number={1}>
            {os === "windows" ? (
              <>Open PowerShell: press the Windows key, type PowerShell, press Enter.</>
            ) : (
              <>Open Terminal. On a Mac, press ⌘ Space, type Terminal, press Return.</>
            )}
          </Step>
          <Step number={2}>
            Paste this and press {enter}:
            <CommandBlock command={TINKJAM_SYNC_COMMAND} className="mt-1.5" />
          </Step>
          <Step number={3}>
            Open the link it prints and press Connect. Keep that window open while you work.
          </Step>
          {withAccount && !signedIn ? (
            <Step number={4}>
              <SignInHere />
            </Step>
          ) : null}
        </ol>
        <p className="text-xs text-muted-foreground">
          Needs Node.js 22 or newer from{" "}
          <a className="underline" href="https://nodejs.org" target="_blank" rel="noreferrer">
            nodejs.org
          </a>
          . Tinkjam Sync lets your boards use the agents on this computer, such as Claude Code or
          Codex, under your own account; they can use what those agents can on it. Nothing anyone
          else writes reaches your agent unless you press Send. Press Ctrl+C in that window to stop
          it.
        </p>
        {withAccount ? null : (
          <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
            Add my computer
          </Button>
        )}
      </section>
      <section className="flex flex-col gap-2 rounded-xl border border-dashed border-border p-4 text-muted-foreground">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Tinkjam for desktop</h3>
          <Badge variant="outline">Coming soon</Badge>
        </div>
        <p className="text-sm">
          An app for your computer that does the same, with no terminal. Until then, Tinkjam Sync is
          the way in.
        </p>
      </section>
    </div>
  );
}

function SignInHere() {
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <span className="flex flex-wrap items-center gap-2">
      Sign in here with the same account, so this board finds your computer.
      <Button size="sm" variant="outline" onClick={openAuthPrompt}>
        Sign in
      </Button>
    </span>
  );
}

function Step({ number, children }: { readonly number: number; readonly children: ReactNode }) {
  return (
    <li className="flex gap-2.5">
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold"
      >
        {number}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </li>
  );
}
