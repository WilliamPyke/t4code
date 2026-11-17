import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { Discovery } from "@t3tools/client-runtime/relay";
import type { EnvironmentId } from "@t3tools/contracts";

/**
 * `ready`: connected here, its agent can join now. `online`: Tinkjam Sync runs on it, not yet
 * connected here. `offline`: Tinkjam Sync is not running. `unsupported`: an incompatible version.
 */
export type BringAgentComputerStatus =
  | "ready"
  | "online"
  | "connecting"
  | "offline"
  | "unsupported";

export interface BringAgentComputer {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly status: BringAgentComputerStatus;
  /** Added to this browser's computers; one that is not gets added when its agent is brought. */
  readonly saved: boolean;
}

const ORDER: Record<BringAgentComputerStatus, number> = {
  ready: 0,
  online: 1,
  connecting: 2,
  offline: 3,
  unsupported: 4,
};

export interface DiscoveredComputer {
  readonly environmentId: EnvironmentId;
  readonly name: string;
  readonly availability: Discovery.RelayEnvironmentAvailability;
  readonly unsupported: boolean;
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
  }>;
  readonly discovered: ReadonlyArray<DiscoveredComputer>;
}): ReadonlyArray<BringAgentComputer> {
  const discoveredById = new Map(input.discovered.map((entry) => [entry.environmentId, entry]));
  const savedIds = new Set(input.saved.map((entry) => entry.environmentId));
  const saved = input.saved.map((entry): BringAgentComputer => {
    const accountSays = discoveredById.get(entry.environmentId)?.availability;
    const status: BringAgentComputerStatus =
      entry.phase === "unsupported"
        ? "unsupported"
        : entry.phase === "connected" && entry.hasConfig
          ? "ready"
          : entry.phase === "connected" ||
              entry.phase === "connecting" ||
              entry.phase === "reconnecting" ||
              entry.phase === "available" ||
              accountSays === "online"
            ? "connecting"
            : "offline";
    return { environmentId: entry.environmentId, name: entry.name, status, saved: true };
  });
  const discovered = input.discovered
    .filter((entry) => !savedIds.has(entry.environmentId))
    .map((entry): BringAgentComputer => ({
      environmentId: entry.environmentId,
      name: entry.name,
      status: entry.unsupported
        ? "unsupported"
        : entry.availability === "online"
          ? "online"
          : entry.availability === "checking"
            ? "connecting"
            : "offline",
      saved: false,
    }));
  return [...saved, ...discovered].toSorted(
    (left, right) =>
      ORDER[left.status] - ORDER[right.status] || left.name.localeCompare(right.name),
  );
}
