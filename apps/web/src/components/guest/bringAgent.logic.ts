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
  readonly discovered: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly name: string;
    readonly availability: Discovery.RelayEnvironmentAvailability;
    readonly unsupported: boolean;
  }>;
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
