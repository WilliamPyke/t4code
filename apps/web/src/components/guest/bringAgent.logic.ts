import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { Discovery } from "@t3tools/client-runtime/relay";
import {
  PROVIDER_DISPLAY_NAMES,
  type EnvironmentId,
  type ServerProvider,
} from "@t3tools/contracts";

/**
 * `ready`: connected here, its agent can join now. `online`: Tinkjam Sync runs on it, not yet
 * connected here. `offline`: Tinkjam Sync is not running. `unsupported`: an incompatible version.
 * `gone`: saved here, but no longer on the person's account.
 */
export type BringAgentComputerStatus =
  | "ready"
  | "online"
  | "connecting"
  | "offline"
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
  unsupported: 4,
  gone: 5,
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

const AGENT_NAMES: Partial<Record<string, string>> = { claudeAgent: "Claude Code", codex: "Codex" };
const SIGN_IN_HINTS: Partial<Record<string, string>> = {
  claudeAgent: "open a terminal on it, run `claude` and sign in",
  codex: "open a terminal on it and run `codex login`",
};

type AgentState = "ready" | "checking" | "signed-out" | "broken" | "turned-off" | "not-installed";
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

const describeAgent = (driver: string, state: AgentState): string => {
  switch (state) {
    case "not-installed":
      return "not installed";
    case "checking":
      return "still being checked";
    case "turned-off":
      return "turned off in Tinkjam settings";
    case "broken":
      return "installed, but it did not start";
    case "ready":
      return "ready, but it has no model to use";
    case "signed-out": {
      const hint = SIGN_IN_HINTS[driver];
      return hint === undefined ? "not signed in" : `not signed in (${hint})`;
    }
  }
};

/**
 * Why a computer's agent cannot come to a board, from that computer's agents: Claude Code and
 * Codex always, other agents only when installed and turned on.
 */
export function noAgentMessage(input: {
  readonly computerName: string;
  readonly settingsLoaded: boolean;
  readonly providers: ReadonlyArray<ProviderSummary>;
}): string {
  const stillChecking = `${input.computerName} is still checking its agents. Try again in a moment.`;
  if (!input.settingsLoaded || input.providers.length === 0) return stillChecking;
  const states = new Map<string, { name: string; state: AgentState }>();
  for (const provider of input.providers) {
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
  const lines = [
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
  const anyReady = lines.some((line) => line.state === "ready");
  if (!anyReady && lines.some((line) => line.state === "checking")) return stillChecking;
  const heading = anyReady
    ? `Tinkjam Sync found no agent it can start on ${input.computerName}.`
    : `Tinkjam Sync found no signed-in agent on ${input.computerName}.`;
  return [
    heading,
    ...lines.map((line) => `${line.name}: ${describeAgent(line.driver, line.state)}.`),
  ].join(" ");
}
