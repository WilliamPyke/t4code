import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import {
  TINKJAM_AGENT_PROMPT,
  TINKJAM_SYNC_COMMAND,
  TINKJAM_SYNC_MAC_COMMAND,
  TINKJAM_SYNC_URL,
  TINKJAM_SYNC_WINDOWS_DOWNLOAD,
} from "~/branding";
import { environmentCatalog } from "~/connection/catalog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
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
import { type BringAgentComputer, agentsChecked } from "./bringAgent.logic";
import { ComputerRow, ComputersLoading, ComputersNotLoaded } from "./ComputerRow";
import { useRemoveComputer, useYourComputers } from "./yourComputers";

// The account's list is asked again while the dialog is open, so a computer that just connected
// shows up without a reload.
const DISCOVERY_REFRESH_MS = 4_000;
// How long a computer may take to connect and check its agents before the wait is given up.
const BRING_WAIT_MS = 30_000;

type BringAgent = (
  environmentId: EnvironmentId,
  project: EnvironmentProject | null,
) => Promise<string | null>;

interface BringTarget {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly project: EnvironmentProject | null;
}

/**
 * How a person brings their own agent to a cloud board, which has none of its own: pick one of
 * their computers, or connect one with Tinkjam Sync first. Figma-style, the desktop app is the
 * other route, not built yet.
 */
export function BringAgentDialog({
  open,
  onOpenChange,
  onBring,
  onBrought,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Brings the agent from that computer onto this board. Resolves to what went wrong, or null. */
  readonly onBring: BringAgent;
  /** Once the dialog has closed after an agent came: the board shows it, ready to prompt. */
  readonly onBrought: () => void;
}) {
  const list = useYourComputers({ active: open, pollEveryMs: DISCOVERY_REFRESH_MS });
  const { computers, withAccount, signedIn } = list;
  const providersByEnvironment = useEnvironmentProviders();
  const registerEnvironment = useAtomCommand(environmentCatalog.register, {
    reportFailure: false,
  });
  const removeComputer = useRemoveComputer();

  const [busy, setBusy] = useState<EnvironmentId | null>(null);
  // What went wrong, and the computer to try again on when trying again could help.
  const [error, setError] = useState<{
    readonly message: string;
    readonly retry: BringTarget | null;
  } | null>(null);
  // An agent came: once the dialog has closed, the board shows it.
  const [brought, setBrought] = useState(false);
  // A computer this browser is still connecting to: its agent comes once it is ready.
  const [pending, setPending] = useState<BringTarget | null>(null);
  // Counts closes, so work that finishes after one does not write into the next opening.
  const opening = useRef(0);

  const changeOpen = (next: boolean) => {
    if (!next) {
      opening.current += 1;
      setBusy(null);
      setPending(null);
      setError(null);
    }
    onOpenChange(next);
  };

  const bring = async (target: BringTarget) => {
    const mine = opening.current;
    setBusy(target.environmentId);
    setError(null);
    const failed = await onBring(target.environmentId, target.project);
    if (failed === null) rememberBringProject(target.environmentId, target.project);
    if (mine !== opening.current) {
      // Closed meanwhile: an agent that still came is shown on the board all the same.
      if (failed === null) onBrought();
      return;
    }
    setBusy(null);
    if (failed !== null) {
      setError({ message: failed, retry: target });
      return;
    }
    setBrought(true);
    changeOpen(false);
  };

  /** Connected here, and it has said how each of its agents is. */
  const readyToBring = (environmentId: EnvironmentId) =>
    computers.some(
      (computer) => computer.environmentId === environmentId && computer.status === "ready",
    ) && agentsChecked(providersByEnvironment.get(environmentId) ?? []);

  const bringWhenReady = useEffectEvent((target: BringTarget) => {
    setPending(null);
    void bring(target);
  });
  const pendingReady = pending !== null && readyToBring(pending.environmentId);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- brings the agent once the computer this browser just connected to reports ready
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- readiness comes from the connection supervisor; bringing clears the wait
    if (pending !== null && pendingReady) bringWhenReady(pending);
  }, [pending, pendingReady]);

  const giveUpWaiting = useEffectEvent((target: BringTarget) => {
    setPending(null);
    const connected = computers.some(
      (computer) => computer.environmentId === target.environmentId && computer.status === "ready",
    );
    // Connected, but its agents never finished checking: bringing says what it found.
    if (connected) return void bring(target);
    setError({
      message: `${target.name} did not connect in time. Check that it is awake and Tinkjam Sync is running on it.`,
      retry: target,
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer: the wait for a computer to connect ends by itself, so it never holds the list forever
  useEffect(() => {
    if (pending === null) return;
    const timer = setTimeout(() => giveUpWaiting(pending), BRING_WAIT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  const choose = async (computer: BringAgentComputer, project: EnvironmentProject | null) => {
    const target = { environmentId: computer.environmentId, name: computer.name, project };
    if (readyToBring(computer.environmentId)) return void bring(target);
    const mine = opening.current;
    setError(null);
    setPending(target);
    if (computer.saved) return;
    const result = await registerEnvironment(
      new RelayConnectionRegistration({
        target: new RelayConnectionTarget({
          environmentId: computer.environmentId,
          label: computer.name,
        }),
      }),
    );
    if (result._tag === "Failure" && mine === opening.current) {
      setPending(null);
      setError({
        message: `Could not reach ${computer.name}. Check that Tinkjam Sync is running on it.`,
        retry: target,
      });
    }
  };
  const tryAgain = (target: BringTarget) => {
    const computer = computers.find((entry) => entry.environmentId === target.environmentId);
    if (computer === undefined) return setError(null);
    if (computer.status !== "ready") void list.retry(computer);
    void choose(computer, target.project);
  };

  const setup = <ConnectComputerRoutes withAccount={withAccount} signedIn={signedIn} />;
  const waitingForFirst = withAccount && signedIn && !list.failed;
  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen || !brought) return;
        setBrought(false);
        onBrought();
      }}
    >
      {/* After an agent came, the caret goes to its box on the board, not back to a button. */}
      <DialogPopup className="max-w-2xl" finalFocus={brought ? false : undefined}>
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
                  {computers.map((computer) => {
                    const waiting = pending?.environmentId === computer.environmentId;
                    const bringing = busy === computer.environmentId;
                    return (
                      <ComputerRow
                        key={computer.environmentId}
                        computer={computer}
                        working={
                          bringing
                            ? "Bringing your agent…"
                            : !waiting
                              ? null
                              : computer.status === "ready"
                                ? "Checking its agents…"
                                : "Connecting…"
                        }
                        thisComputer={list.primaryIds.has(computer.environmentId)}
                        disabled={busy !== null || pending !== null}
                        onRetry={() => list.retry(computer)}
                        onRemove={
                          list.primaryIds.has(computer.environmentId)
                            ? null
                            : () => {
                                setError(null);
                                return removeComputer.remove(computer);
                              }
                        }
                        removeQuestion={removeComputer.question(computer.name)}
                      >
                        <BringControls
                          computer={computer}
                          working={waiting || bringing}
                          disabled={busy !== null || pending !== null}
                          onBring={(project) => void choose(computer, project)}
                          onCancel={waiting ? () => setPending(null) : null}
                        />
                      </ComputerRow>
                    );
                  })}
                </ul>
              </section>
            ) : list.loading ? (
              <ComputersLoading />
            ) : null}
            {list.failed ? <ComputersNotLoaded onRetry={list.refresh} /> : null}
            {error === null ? null : (
              <div role="alert" className="flex flex-col items-start gap-2" data-bring-agent-error>
                <p className="text-sm whitespace-pre-line text-destructive">{error.message}</p>
                {error.retry === null ? null : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy !== null || pending !== null}
                    onClick={() => error.retry !== null && tryAgain(error.retry)}
                  >
                    Try again
                  </Button>
                )}
              </div>
            )}
            {computers.length > 0 ? (
              <Collapsible>
                <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
                  Connect another computer
                </CollapsibleTrigger>
                <CollapsiblePanel>
                  <div className="pt-3">{setup}</div>
                </CollapsiblePanel>
              </Collapsible>
            ) : list.loading ? null : (
              <>
                {setup}
                {waitingForFirst ? <WaitingForComputer /> : null}
              </>
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

/** Under the steps: this page is looking, so nobody reloads it after pressing Connect. */
export function WaitingForComputer() {
  return (
    <p role="status" className="text-xs text-muted-foreground" data-waiting-for-computer>
      Waiting for your computer… It shows up here by itself once you press Connect.
    </p>
  );
}

const NO_PROJECT = "none";

/** On a computer's row: the project its agent works in, Bring my agent, and Cancel while it waits. */
function BringControls({
  computer,
  working,
  disabled,
  onBring,
  onCancel,
}: {
  readonly computer: BringAgentComputer;
  readonly working: boolean;
  readonly disabled: boolean;
  readonly onBring: (project: EnvironmentProject | null) => void;
  /** Stops waiting for this computer; null when it is not being waited on. */
  readonly onCancel: (() => void) | null;
}) {
  const projects = useProjects().filter(
    (project) =>
      project.environmentId === computer.environmentId &&
      project.isScratch !== true &&
      project.archivedAt == null,
  );
  // The project last picked for this computer here, else none: an agent in no project cannot
  // change anyone's code until the person picks one.
  const [projectId, setProjectId] = useState<string>(() => {
    const remembered = readBringProject(computer.environmentId);
    return remembered !== null && projects.some((project) => project.id === remembered)
      ? remembered
      : NO_PROJECT;
  });
  const items = [
    { value: NO_PROJECT, label: "No project" },
    ...projects.map((project) => ({ value: project.id, label: project.title })),
  ];
  const canBring = computer.status === "ready" || computer.status === "online";
  return (
    <>
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
      {onCancel === null ? (
        <Button
          size="sm"
          disabled={!canBring || disabled}
          onClick={() => onBring(projects.find((project) => project.id === projectId) ?? null)}
          data-bring-agent
        >
          {working ? "Bringing…" : "Bring my agent"}
        </Button>
      ) : (
        <Button size="sm" variant="outline" onClick={onCancel} data-bring-agent-cancel>
          Cancel
        </Button>
      )}
    </>
  );
}

type Os = "mac" | "windows" | "linux";
/** The computer being set up, or `null` on a phone or tablet, which is never it. */
const detectOs = (): Os | null => {
  if (typeof navigator === "undefined") return "linux";
  const agent = navigator.userAgent;
  // An iPad says it is a Mac; only its touch points tell them apart.
  if (/iphone|ipad|ipod|android/i.test(agent)) return null;
  if (/mac/i.test(agent)) return navigator.maxTouchPoints > 1 ? null : "mac";
  return /win/i.test(agent) ? "windows" : "linux";
};

/** How a computer gets connected: the Tinkjam Sync app, or an agent or a terminal installing it. */
export function ConnectComputerRoutes({
  withAccount,
  signedIn,
}: {
  readonly withAccount: boolean;
  readonly signedIn: boolean;
}) {
  const [os, setOs] = useState<Os | null>(detectOs);
  return (
    <div className="flex flex-col gap-3" data-bring-agent-steps>
      <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Get Tinkjam Sync for your computer</h3>
          <ToggleGroup
            aria-label="Your computer"
            value={os === null ? [] : [os]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "mac" || value === "windows" || value === "linux") setOs(value);
            }}
          >
            <Toggle value="mac">Mac</Toggle>
            <Toggle value="windows">Windows</Toggle>
            <Toggle value="linux">Linux</Toggle>
          </ToggleGroup>
        </div>
        {os === null ? (
          <div className="flex flex-col gap-1 text-sm" data-sync-other-device>
            <p>
              Do this on the computer where your agent runs, not on this phone or tablet. Open this
              page there:
            </p>
            <CopyLine text={TINKJAM_SYNC_URL} />
            <p className="mt-1 text-xs text-muted-foreground">
              Or pick that computer above to read the steps here.
            </p>
          </div>
        ) : os === "linux" ? (
          <ol className="flex flex-col gap-2.5 text-sm">
            <Step number={1}>
              Open a terminal, paste this and press Enter. It needs Node.js 22.16 or newer:
              <CopyLine text={TINKJAM_SYNC_COMMAND} mono />
            </Step>
            <Step number={2}>
              Open the link it prints and press Connect. It then runs in the background and starts
              when you log in.
            </Step>
            {withAccount && !signedIn ? (
              <Step number={3}>
                <SignInHere />
              </Step>
            ) : null}
          </ol>
        ) : (
          <ol className="flex flex-col gap-2.5 text-sm">
            {os === "mac" ? (
              <Step number={1}>
                Open the Terminal app (press Command and Space, type Terminal, press Return). Paste
                this line and press Return:
                <CopyLine text={TINKJAM_SYNC_MAC_COMMAND} mono />
                <span className="mt-1 block text-xs text-muted-foreground">
                  You only do this once. It asks for no password and changes no settings. It puts
                  Tinkjam Sync in your Applications folder and opens it. You can close Terminal
                  afterwards.
                </span>
              </Step>
            ) : (
              <Step number={1}>
                <span className="flex flex-wrap items-center gap-2">
                  Download it and open it.
                  <Button
                    size="sm"
                    render={<a href={TINKJAM_SYNC_WINDOWS_DOWNLOAD} download />}
                    data-sync-download
                  >
                    <DownloadIcon />
                    Download for Windows
                  </Button>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  Open the file. If Windows says it protected your PC, choose More info, then Run
                  anyway.
                </span>
              </Step>
            )}
            <Step number={2}>
              Your browser opens by itself. Sign in if it asks, then press Connect. That is all:
              Tinkjam Sync sits in your {os === "mac" ? "menu bar" : "system tray"}, starts with
              your computer and keeps itself up to date.
            </Step>
            {withAccount && !signedIn ? (
              <Step number={3}>
                <SignInHere />
              </Step>
            ) : null}
          </ol>
        )}
        {os === null || os === "linux" ? null : (
          <Collapsible>
            <CollapsibleTrigger render={<Button size="xs" variant="ghost" />}>
              Or have your coding agent install it
            </CollapsibleTrigger>
            <CollapsiblePanel>
              <div className="flex flex-col gap-2 pt-2 text-sm">
                <p>Paste this into Claude Code, Codex or another coding agent on your computer:</p>
                <CopyLine text={TINKJAM_AGENT_PROMPT} />
              </div>
            </CollapsiblePanel>
          </Collapsible>
        )}
        <p className="text-xs text-muted-foreground">
          Tinkjam Sync lets your boards use the agents on this computer, such as Claude Code or
          Codex, under your own account; they can use what those agents can on it. Nothing anyone
          else writes reaches your agent unless you press Send. Quit it from its menu to stop it.
        </p>
        {withAccount ? null : (
          <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
            Add my computer
          </Button>
        )}
      </section>
    </div>
  );
}

/** A prompt or command to copy, shown whole, with a Copy button anyone can find. */
function CopyLine({ text, mono = false }: { readonly text: string; readonly mono?: boolean }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 2000, target: "command" });
  return (
    <div className="mt-1.5 flex items-start gap-2" data-sync-command>
      <p
        className={cn(
          "min-w-0 flex-1 rounded-lg border border-border bg-muted/50 px-3 py-2 text-sm break-words select-all",
          mono && "font-mono",
        )}
      >
        {text}
      </p>
      <Button size="sm" onClick={() => copyToClipboard(text, undefined)}>
        {isCopied ? <CheckIcon /> : <CopyIcon />}
        {isCopied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

// Per browser: the project each computer's agent last came to a board in.
const BRING_PROJECT_KEY = "t3code:bring-agent-project:v1";
const BringProjects = Schema.Record(Schema.String, Schema.String);

const readBringProjects = (): Readonly<Record<string, string>> => {
  try {
    return getLocalStorageItem(BRING_PROJECT_KEY, BringProjects) ?? {};
  } catch {
    return {};
  }
};

const readBringProject = (environmentId: EnvironmentId) =>
  readBringProjects()[environmentId] ?? null;

function rememberBringProject(environmentId: EnvironmentId, project: EnvironmentProject | null) {
  try {
    setLocalStorageItem(
      BRING_PROJECT_KEY,
      { ...readBringProjects(), [environmentId]: project?.id ?? NO_PROJECT },
      BringProjects,
    );
  } catch {
    // Blocked storage only means no project is picked first next time.
  }
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
