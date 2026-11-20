import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { Discovery } from "@t3tools/client-runtime/relay";
import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";

/**
 * `ready`: connected here, its agent can join now. `online`: Tinkjam Sync runs on it, not yet
 * connected here. `offline`: Tinkjam Sync is not running. `unchecked`: the account could not say
 * whether it is up. `unsupported`: an incompatible version. `gone`: saved here, but no longer on
 * the person's account.
 */
export type BringAgentComputerStatus =
  | "ready"
  | "online"
  | "connecting"
  | "offline"
  | "unchecked"
  | "unsupported"
  | "gone";

export interface BringAgentComputer {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly status: BringAgentComputerStatus;
  /** Added to this browser's computers; one that is not gets added when its agent is brought. */
  readonly saved: boolean;
  /** When the account got it; only set when another computer has the same name. */
  readonly addedAt: string | null;
}

const ORDER: Record<BringAgentComputerStatus, number> = {
  ready: 0,
  online: 1,
  connecting: 2,
  offline: 3,
  unchecked: 4,
  unsupported: 5,
  gone: 6,
};

export interface DiscoveredComputer {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly availability: Discovery.RelayEnvironmentAvailability;
  readonly unsupported: boolean;
  readonly linkedAt: string;
}

/**
 * The account's computers as the dialog shows them while it asks again every few seconds: each
 * ask lists none at first and then says "checking" for every one, so what was shown stays until
 * the new answer says something.
 */
export function steadyDiscovered(
  shown: ReadonlyArray<DiscoveredComputer>,
  latest: { readonly listed: boolean; readonly computers: ReadonlyArray<DiscoveredComputer> },
): ReadonlyArray<DiscoveredComputer> {
  if (!latest.listed) return shown;
  const before = new Map(shown.map((computer) => [computer.environmentId, computer]));
  return latest.computers.map((computer) => {
    const known = before.get(computer.environmentId);
    return computer.availability === "checking" &&
      known !== undefined &&
      known.availability !== "checking"
      ? { ...computer, availability: known.availability, unsupported: known.unsupported }
      : computer;
  });
}

/**
 * What was shown once the account has gone unanswered too long to trust: the same computers,
 * with nothing said about whether each is up.
 */
export function uncheckedDiscovered(
  shown: ReadonlyArray<DiscoveredComputer>,
): ReadonlyArray<DiscoveredComputer> {
  return shown.map((computer) => ({ ...computer, availability: "error" as const }));
}

/**
 * The person's computers for "Bring my agent": the ones this browser connects to, and the ones
 * their account says Tinkjam Sync runs on. The account's word on online or offline is the real
 * signal for a computer this browser has not reached.
 */
export function bringAgentComputers(input: {
  readonly saved: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly name: string;
    readonly phase: EnvironmentConnectionPhase;
    readonly hasConfig: boolean;
    /** Reached only through the account; one paired directly is never treated as gone. */
    readonly relayOnly: boolean;
  }>;
  readonly discovered: ReadonlyArray<DiscoveredComputer>;
  /** The account's list has loaded, so a computer missing from it is not on the account. */
  readonly listed: boolean;
}): ReadonlyArray<BringAgentComputer> {
  const discoveredById = new Map(input.discovered.map((entry) => [entry.environmentId, entry]));
  const savedIds = new Set(input.saved.map((entry) => entry.environmentId));
  const saved = input.saved.map((entry) => {
    const onAccount = discoveredById.get(entry.environmentId);
    const accountSays = onAccount?.availability;
    // This browser keeps retrying a computer it cannot reach; the account's word wins then.
    const status: BringAgentComputerStatus =
      entry.phase === "unsupported"
        ? "unsupported"
        : entry.phase === "connected" && entry.hasConfig
          ? "ready"
          : entry.phase === "connected"
            ? "connecting"
            : input.listed && entry.relayOnly && onAccount === undefined
              ? "gone"
              : accountSays === "offline"
                ? "offline"
                : entry.phase === "connecting" ||
                    entry.phase === "reconnecting" ||
                    entry.phase === "available" ||
                    accountSays === "online"
                  ? "connecting"
                  : accountSays === "error"
                    ? "unchecked"
                    : "offline";
    return {
      environmentId: entry.environmentId,
      name: entry.name,
      status,
      saved: true,
      linkedAt: onAccount?.linkedAt ?? null,
    };
  });
  const discovered = input.discovered
    .filter((entry) => !savedIds.has(entry.environmentId))
    .map((entry) => {
      const status: BringAgentComputerStatus = entry.unsupported
        ? "unsupported"
        : entry.availability === "online"
          ? "online"
          : entry.availability === "checking"
            ? "connecting"
            : entry.availability === "error"
              ? "unchecked"
              : "offline";
      return {
        environmentId: entry.environmentId,
        name: entry.name,
        status,
        saved: false,
        linkedAt: entry.linkedAt,
      };
    });
  const all = [...saved, ...discovered];
  const nameCounts = new Map<string, number>();
  for (const computer of all) {
    nameCounts.set(computer.name, (nameCounts.get(computer.name) ?? 0) + 1);
  }
  return all
    .map(({ linkedAt, ...computer }): BringAgentComputer => ({
      ...computer,
      addedAt: (nameCounts.get(computer.name) ?? 0) > 1 ? linkedAt : null,
    }))
    .toSorted(
      (left, right) =>
        ORDER[left.status] - ORDER[right.status] || left.name.localeCompare(right.name),
    );
}

type SavedComputer = Parameters<typeof bringAgentComputers>[0]["saved"][number];

/** Saved computers this browser still waits on, retrying or stopped after an error. */
export function computersAwaitingReconnect(
  saved: ReadonlyArray<SavedComputer>,
): ReadonlyArray<EnvironmentId> {
  return saved
    .filter(
      (entry) => entry.relayOnly && (entry.phase === "reconnecting" || entry.phase === "error"),
    )
    .map((entry) => entry.environmentId);
}

/**
 * The waiting computers the account says Tinkjam Sync runs on again. This browser's own retries
 * slow to one every few minutes, and some errors stop them, so these are retried at once.
 */
export function computersBackOnline(
  saved: ReadonlyArray<SavedComputer>,
  discovered: ReadonlyArray<DiscoveredComputer>,
): ReadonlyArray<EnvironmentId> {
  const online = new Set(
    discovered
      .filter((entry) => entry.availability === "online" && !entry.unsupported)
      .map((entry) => entry.environmentId),
  );
  return computersAwaitingReconnect(saved).filter((environmentId) => online.has(environmentId));
}

/**
 * Which of the person's own computers one of their boxes runs on. A box whose chat is on a
 * computer stays there (`fixed`); while that computer is not connected the box is `stranded` and
 * runs nowhere. A box with no chat yet runs on the board's pick, else the first computer here.
 */
export function boxComputer<Machine extends BoxComputerMachine>(input: {
  /** The person's computers on this board that are connected now. */
  readonly here: ReadonlyArray<Machine>;
  readonly boxId: string;
  /** The computer the person last chose on this board. */
  readonly picked: string | null;
  /** The computer this box last ran on, as this browser remembers it. */
  readonly remembered: string | null;
  /** The person's computers this browser still has that are not connected now. */
  readonly disconnected: ReadonlySet<string>;
}): {
  readonly machine: Machine | null;
  readonly fixed: boolean;
  readonly stranded: string | null;
} {
  const first = (candidates: ReadonlyArray<Machine>, ...wanted: ReadonlyArray<string | null>) =>
    wanted
      .map((id) => candidates.find((machine) => machine.environmentId === id))
      .find((machine) => machine !== undefined) ??
    candidates[0] ??
    null;
  const homes = input.here.filter((machine) => input.boxId in machine.boxes);
  if (homes.length > 0) {
    return { machine: first(homes, input.remembered, input.picked), fixed: true, stranded: null };
  }
  if (input.remembered !== null && input.disconnected.has(input.remembered)) {
    return { machine: null, fixed: true, stranded: input.remembered };
  }
  return { machine: first(input.here, input.picked), fixed: false, stranded: null };
}

interface BoxComputerMachine {
  readonly environmentId: string;
  readonly boxes: Readonly<Record<string, unknown>>;
}

const AGENT_NAMES: Partial<Record<string, string>> = { claudeAgent: "Claude Code", codex: "Codex" };
const SIGN_IN_HINTS: Partial<Record<string, string>> = {
  claudeAgent: "Open Claude Code on that computer and sign in.",
  codex: "Open the ChatGPT or Codex app on that computer and sign in.",
};

/** How a person signs an agent in again, on the computer it runs on. No terminal. */
export const agentSignInHint = (driver: string, name: string): string =>
  SIGN_IN_HINTS[driver] ?? `Open ${name} on that computer and sign in.`;

export type AgentState =
  | "ready"
  | "checking"
  | "signed-out"
  | "broken"
  | "turned-off"
  | "not-installed";
const AGENT_STATE_ORDER: ReadonlyArray<AgentState> = [
  "ready",
  "checking",
  "signed-out",
  "broken",
  "turned-off",
  "not-installed",
];

type ProviderSummary = Pick<
  ServerProvider,
  "driver" | "displayName" | "enabled" | "installed" | "status" | "auth"
>;

const agentState = (provider: ProviderSummary): AgentState =>
  !provider.enabled
    ? "turned-off"
    : !provider.installed
      ? // Before its first check an agent reports not installed, without an error.
        provider.status === "error"
        ? "not-installed"
        : "checking"
      : provider.auth.status === "unauthenticated"
        ? "signed-out"
        : provider.status === "error"
          ? "broken"
          : "ready";

/** Whether a computer has said how each of its agents is, so bringing one would not be a guess. */
export const agentsChecked = (providers: ReadonlyArray<ProviderSummary>): boolean =>
  providers.length > 0 && providers.every((provider) => agentState(provider) !== "checking");

const describeAgent = (driver: string, name: string, state: AgentState): string => {
  switch (state) {
    case "not-installed":
      return "not installed.";
    case "checking":
      return "still being checked.";
    case "turned-off":
      return "turned off in Tinkjam settings.";
    case "broken":
      return "installed, but it did not start.";
    case "ready":
      return "ready, but it has no model to use.";
    case "signed-out":
      return `not signed in. ${agentSignInHint(driver, name)}`;
  }
};

/**
 * A computer's agents as a person should see them: Claude Code and Codex always, other agents only
 * when installed and turned on. One entry per agent, at the best state any of its instances has.
 */
export function computerAgentStates(
  providers: ReadonlyArray<ProviderSummary>,
): ReadonlyArray<{ readonly driver: string; readonly name: string; readonly state: AgentState }> {
  const states = new Map<string, { name: string; state: AgentState }>();
  for (const provider of providers) {
    const state = agentState(provider);
    const known = states.get(provider.driver);
    if (
      known !== undefined &&
      AGENT_STATE_ORDER.indexOf(known.state) <= AGENT_STATE_ORDER.indexOf(state)
    ) {
      continue;
    }
    const name =
      AGENT_NAMES[provider.driver] ??
      provider.displayName ??
      PROVIDER_DISPLAY_NAMES[provider.driver] ??
      provider.driver;
    states.set(provider.driver, { name, state });
  }
  return [
    ...["claudeAgent", "codex"].map((driver) => ({
      driver,
      name: AGENT_NAMES[driver]!,
      state: states.get(driver)?.state ?? "not-installed",
    })),
    ...[...states.entries()]
      .filter(
        ([driver, entry]) =>
          !(driver in AGENT_NAMES) &&
          entry.state !== "not-installed" &&
          entry.state !== "turned-off",
      )
      .map(([driver, entry]) => ({ driver, ...entry })),
  ];
}

/**
 * Why a computer's agent cannot come to a board, from that computer's agents: Claude Code and
 * Codex always, other agents only when installed and turned on. One line per agent.
 */
export function noAgentMessage(input: {
  readonly computerName: string;
  readonly settingsLoaded: boolean;
  readonly providers: ReadonlyArray<ProviderSummary>;
}): string {
  const stillChecking = `${input.computerName} is still checking its agents. Try again in a moment.`;
  if (!input.settingsLoaded || input.providers.length === 0) return stillChecking;
  const lines = computerAgentStates(input.providers);
  const anyReady = lines.some((line) => line.state === "ready");
  if (!anyReady && lines.some((line) => line.state === "checking")) return stillChecking;
  const heading = anyReady
    ? `Tinkjam Sync found no agent it can start on ${input.computerName}.`
    : `Tinkjam Sync found no signed-in agent on ${input.computerName}.`;
  return [
    heading,
    ...lines.map((line) => `${line.name}: ${describeAgent(line.driver, line.name, line.state)}`),
  ].join("\n");
}

const OWN_AGENT_FAILURES: Partial<Record<string, string>> = {
  invalid_host: "Your computer could not open this board. Try again.",
  invalid_response:
    "Your computer could not read this board. Open Tinkjam Sync on it, choose Check for Updates, then try again.",
  unreachable:
    "Your computer could not reach this board. Check its internet connection, then try again.",
  expired: "That took too long. Try again.",
  launch_failed: "Your computer could not start your agent. Try again.",
  leave_failed: "Could not take your agent off this board. Try again.",
  not_in_room: "Your agent is no longer on this board. Press Bring my agent to bring it back.",
  room_ended: "Your agent is no longer on this board. Press Bring my agent to bring it back.",
  too_fast: "Too many tries in a row. Wait a minute, then try again.",
  thread_unavailable: "That chat cannot go on this board. It may be on a board already.",
};

/**
 * What to tell a person when their own computer refused something for a board, in their words.
 * The computer's own wording is for whoever debugs it, so it goes to the console.
 */
export function ownAgentFailureMessage(cause: unknown, fallback: string): string {
  console.error("[bring-agent]", cause);
  const reason =
    typeof cause === "object" && cause !== null && "reason" in cause ? cause.reason : undefined;
  return (typeof reason === "string" ? OWN_AGENT_FAILURES[reason] : undefined) ?? fallback;
}
