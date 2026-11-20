import {
  RelayConnectionRegistration,
  RelayConnectionTarget,
} from "@t3tools/client-runtime/connection";
import type { EnvironmentProject } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type ReactNode, useEffect, useEffectEvent, useRef, useState } from "react";

import { TINKJAM_AGENT_PROMPT } from "~/branding";
import { environmentCatalog } from "~/connection/catalog";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import { SYNC_INSTALLS, detectSyncOs, type SyncOs } from "~/syncDownloads";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { SyncInstallAction } from "../connect/GetSync";
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
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
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
  // Chosen as it opens and kept until it has closed, so nothing that happens inside resizes it:
  // short for someone whose computers are already known, tall when the steps show.
  const [size, setSize] = useState<"compact" | "tall" | null>(null);
  if (open && size === null) setSize(computers.length > 0 ? "compact" : "tall");

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
  // On a phone nobody is about to press Connect, so nothing stands in for a computer to come.
  const waitingForFirst = withAccount && signedIn && !list.failed;
  const phone = onPhoneOrTablet();
  const setupInline = size !== "compact" || computers.length === 0;
  return (
    <Dialog
      open={open}
      onOpenChange={changeOpen}
      onOpenChangeComplete={(isOpen) => {
        if (isOpen) return;
        setSize(null);
        if (!brought) return;
        setBrought(false);
        onBrought();
      }}
    >
      {/* After an agent came, the caret goes to its box on the board, not back to a button. */}
      <DialogPopup
        className={size === "compact" ? "h-104 max-w-2xl" : "h-180 max-w-2xl"}
        finalFocus={brought ? false : undefined}
      >
        <DialogHeader>
          <DialogTitle>Bring your agent to this board</DialogTitle>
          <DialogDescription>
            Your agent runs on your own computer, under your own Claude, Codex or other AI account.
            Only you can start it. Everyone on the board sees what it makes.
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
            ) : !phone && (list.loading || waitingForFirst) ? (
              <section className="flex flex-col gap-2">
                <h3 className="text-sm font-medium">Your computers</h3>
                {list.loading ? (
                  <ComputersLoading />
                ) : (
                  <WaitingForComputer next="Then press Bring my agent, beside its name." />
                )}
              </section>
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
            {setupInline ? (
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

/**
 * Where the first computer will show: this page is looking, so nobody reloads it after pressing
 * Connect. The dot is the app's stepped status pulse, not a spinner, and still under reduced motion.
 */
export function WaitingForComputer({ next }: { readonly next: string }) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-dashed border-border px-3 py-2.5"
      data-waiting-for-computer
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-status-pulse"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">Waiting for your computer…</span>
        <span className="block text-xs text-muted-foreground">
          It shows up here by itself once you press Connect. {next}
        </span>
      </span>
    </div>
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

/** Whether this is a phone or tablet, where no agent runs and Tinkjam Sync cannot be installed. */
export const onPhoneOrTablet = () => detectSyncOs() === null;

/** How a computer gets connected: the Tinkjam Sync app, or the person's coding agent installing it. */
export function ConnectComputerRoutes({
  withAccount,
  signedIn,
}: {
  readonly withAccount: boolean;
  readonly signedIn: boolean;
}) {
  const [os, setOs] = useState<SyncOs | null>(detectSyncOs);
  const signIn = withAccount && !signedIn;
  const connect = "Your browser opens by itself. Sign in if it asks, then press Connect.";
  return (
    <div className="flex flex-col gap-3" data-bring-agent-steps>
      <section className="flex flex-col gap-3 rounded-xl border border-border p-4">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Install Tinkjam Sync</h3>
          <p className="text-xs text-muted-foreground">
            The small app that lets your boards reach the agents on your computer.
          </p>
        </div>
        {os === null ? (
          <div className="flex flex-col gap-3 text-sm" data-sync-other-device>
            <p>
              Agents run on a computer, not on a phone or tablet. Open Tinkjam on your Mac or PC,
              sign in, and connect it from there. Your boards will be waiting.
            </p>
            <CopyAppLink />
          </div>
        ) : (
          <>
            <SyncInstallAction os={os} onChoose={setOs} />
            {os === "mac" ? (
              <>
                <ol className="flex flex-col gap-2.5 text-sm">
                  <Step number={1}>
                    Open Terminal: press Command and Space, type Terminal, press Return.
                  </Step>
                  <Step number={2}>
                    Paste the install command and press Return.
                    <CommandLine os={os} />
                    <StepNote>
                      One time only. It asks for no password and changes no settings: it downloads
                      Tinkjam Sync, checks the file is intact, puts it in your Applications folder
                      and opens it.
                    </StepNote>
                  </Step>
                  <Step number={3}>{connect}</Step>
                  {signIn ? (
                    <Step number={4}>
                      <SignInHere />
                    </Step>
                  ) : null}
                </ol>
                <p className="text-xs text-muted-foreground">
                  Why Terminal? Apple has not checked Tinkjam Sync yet (it is not notarized), so
                  macOS would refuse to open a normal download. Once installed it sits in your menu
                  bar, starts with your Mac and keeps itself up to date.
                </p>
              </>
            ) : os === "windows" ? (
              <>
                <ol className="flex flex-col gap-2.5 text-sm">
                  <Step number={1}>
                    Download Tinkjam Sync and open the file.
                    <StepNote>
                      Windows does not recognise Tinkjam Sync yet, so it says it protected your PC.
                      Choose More info, then Run anyway.
                    </StepNote>
                  </Step>
                  <Step number={2}>{connect}</Step>
                  {signIn ? (
                    <Step number={3}>
                      <SignInHere />
                    </Step>
                  ) : null}
                </ol>
                <p className="text-xs text-muted-foreground">
                  Once installed it sits in your system tray, starts with your computer and keeps
                  itself up to date.
                </p>
              </>
            ) : (
              <ol className="flex flex-col gap-2.5 text-sm">
                <Step number={1}>
                  Open a terminal, paste the install command and press Enter. It needs Node.js 22.16
                  or newer.
                  <CommandLine os={os} />
                </Step>
                <Step number={2}>
                  Open the link it prints and press Connect. It then runs in the background and
                  starts when you log in.
                </Step>
                {signIn ? (
                  <Step number={3}>
                    <SignInHere />
                  </Step>
                ) : null}
              </ol>
            )}
            <AgentRoute />
          </>
        )}
      </section>
      <p className="text-xs text-muted-foreground">
        Tinkjam Sync lets your boards use the agents on {os === null ? "your" : "this"} computer,
        such as Claude Code or Codex, under your own account, with the access they already have on
        it. Nothing anyone else writes reaches your agent unless you press Send. To stop it, quit it
        from its menu.
      </p>
      {withAccount ? null : (
        <div>
          <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
            Add my computer
          </Button>
        </div>
      )}
    </div>
  );
}

/** An OS's install command, whole and selectable; the button above copies it. */
function CommandLine({ os }: { readonly os: SyncOs }) {
  const install = SYNC_INSTALLS[os];
  if (install.method !== "command") return null;
  return (
    <code
      className="mt-1.5 block rounded-lg border border-border bg-muted/50 px-3 py-2 font-mono text-sm wrap-anywhere select-all"
      data-sync-command
    >
      {install.command}
    </code>
  );
}

const StepNote = ({ children }: { readonly children: ReactNode }) => (
  <span className="mt-1 block text-xs text-muted-foreground">{children}</span>
);

/** Two labels in one cell, so the button is as wide copied as not. */
function CopyLabel({ copied, children }: { readonly copied: boolean; readonly children: string }) {
  return (
    <span className="grid">
      <span className={cn("col-start-1 row-start-1", copied && "invisible")}>{children}</span>
      <span className={cn("col-start-1 row-start-1", !copied && "invisible")}>Copied</span>
    </span>
  );
}

/**
 * The other way to install: the person's coding agent does it. The request is written for that
 * agent, so it is copied whole and only shown to whoever asks to read it.
 */
function AgentRoute() {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 2000, target: "command" });
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-border pt-3"
      data-sync-agent-route
    >
      <p className="min-w-48 flex-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">Rather have your coding agent do it?</span>{" "}
        Copy a ready-made request and paste it into Claude Code, Codex or another coding agent on{" "}
        this computer.
      </p>
      <Popover>
        <PopoverTrigger render={<Button size="sm" variant="ghost" />}>Read it</PopoverTrigger>
        <PopoverPopup side="top" align="end" width="md">
          <div className="flex flex-col gap-2">
            <PopoverTitle>What the request says</PopoverTitle>
            <p className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs wrap-anywhere select-all">
              {TINKJAM_AGENT_PROMPT}
            </p>
            <p className="text-xs text-muted-foreground">
              It is written for your agent, not for you. Its last sentence is your permission for
              the agent to run the installer.
            </p>
          </div>
        </PopoverPopup>
      </Popover>
      <Button
        size="sm"
        variant="outline"
        onClick={() => copyToClipboard(TINKJAM_AGENT_PROMPT, undefined)}
        data-sync-agent-copy
      >
        {isCopied ? <CheckIcon /> : <CopyIcon />}
        <CopyLabel copied={isCopied}>Copy request</CopyLabel>
      </Button>
    </div>
  );
}

/**
 * For someone reading on a phone: Tinkjam's own address, to open on their computer. Never a board
 * or invite link, which would hand on a way in.
 */
export function CopyAppLink() {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 2000, target: "link" });
  const address = typeof window === "undefined" ? "" : window.location.origin;
  return (
    <div className="flex flex-col gap-1.5" data-sync-app-link>
      <Button onClick={() => copyToClipboard(address, undefined)}>
        {isCopied ? <CheckIcon /> : <CopyIcon />}
        <CopyLabel copied={isCopied}>Copy link to open on my computer</CopyLabel>
      </Button>
      <p className="text-center text-xs wrap-anywhere text-muted-foreground">
        {address.replace(/^https?:\/\//, "")}
      </p>
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
