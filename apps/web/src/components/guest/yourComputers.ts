import { useAtomValue } from "@effect/atom-react";
import { orchestrationProtocolCompatibilityError } from "@t3tools/client-runtime/connection";
import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import { type Discovery, managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";

import {
  deregisterManagedRelayEnvironmentCommand,
  refreshManagedTunnelUsage,
} from "~/cloud/managedRelayState";
import { environmentCatalog } from "~/connection/catalog";
import {
  type EnvironmentPresentation,
  useEnvironments,
  useRelayEnvironmentDiscovery,
} from "~/state/environments";
import { relayEnvironmentDiscovery } from "~/state/relay";
import { useAtomCommand } from "~/state/use-atom-command";

import type { BringAgentComputer, DiscoveredComputer } from "./bringAgent.logic";

const COMPUTER_STATUS_TEXT: Record<BringAgentComputer["status"], string> = {
  ready: "Connected",
  online: "Online",
  connecting: "Connecting...",
  offline: "Offline. Start Tinkjam Sync on it.",
  unsupported: "Out of date. Run the Tinkjam Sync command on it again.",
  gone: "No longer connected. Remove it, or connect it again.",
};

export const COMPUTER_STATUS_DOT: Record<BringAgentComputer["status"], string> = {
  ready: "bg-success",
  online: "bg-success",
  connecting: "bg-warning",
  offline: "bg-muted-foreground/35",
  unsupported: "bg-destructive",
  gone: "bg-muted-foreground/35",
};

const addedAtFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/** The line under a computer's name: how it is, and when it was added if names repeat. */
export function computerStatusLine(computer: BringAgentComputer): string {
  const added = computer.addedAt === null ? Number.NaN : Date.parse(computer.addedAt);
  return Number.isNaN(added)
    ? COMPUTER_STATUS_TEXT[computer.status]
    : `${COMPUTER_STATUS_TEXT[computer.status]} · added ${addedAtFormatter.format(added)}`;
}

/** The computers the account lists, as the relay discovered them. */
export function discoveredComputers(
  discovery: Discovery.RelayEnvironmentDiscoveryState,
): ReadonlyArray<DiscoveredComputer> {
  return [...discovery.environments.values()].map(({ environment, availability, status }) => {
    const descriptor = Option.getOrNull(status)?.descriptor;
    return {
      environmentId: environment.environmentId,
      name: environment.label,
      availability,
      unsupported:
        descriptor !== undefined && orchestrationProtocolCompatibilityError(descriptor) !== null,
      linkedAt: environment.linkedAt,
    };
  });
}

/** The computers this browser has saved, as `bringAgentComputers` takes them. */
export function savedComputers(environments: ReadonlyArray<EnvironmentPresentation>) {
  return environments
    .filter((entry) => !isGuestEnvironment(entry.environmentId))
    .map((entry) => ({
      environmentId: entry.environmentId,
      name: entry.label,
      phase: entry.connection.phase,
      hasConfig: entry.serverConfig !== null,
      relayOnly: [
        entry.entry.target,
        ...(entry.entry.alternateRoutes ?? []).map((route) => route.target),
      ].every((target) => target._tag === "RelayConnectionTarget"),
    }));
}

export const removeComputerQuestion = (name: string) =>
  `Remove ${name}? Its agent can no longer be used on your boards until you connect it again.`;

/**
 * Removes one of the person's computers: off their account, so no board finds it, and out of
 * this browser. Neither step needs the computer to be on. Resolves to what went wrong, or null.
 */
export function useRemoveComputer() {
  const session = useAtomValue(managedRelaySessionAtom);
  const discovery = useRelayEnvironmentDiscovery();
  const { environments } = useEnvironments();
  const deregister = useAtomCommand(deregisterManagedRelayEnvironmentCommand, {
    reportFailure: false,
  });
  const forget = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const refreshDiscovery = useAtomCommand(relayEnvironmentDiscovery.refreshAfterMutation, {
    reportFailure: false,
  });
  return async (computer: {
    readonly environmentId: EnvironmentId;
    readonly name: string;
  }): Promise<string | null> => {
    const accountId = session?.accountId ?? null;
    const goneFromAccount = discovery.listed && !discovery.environments.has(computer.environmentId);
    if (accountId !== null && !goneFromAccount) {
      const result = await deregister({ accountId, environmentId: computer.environmentId });
      if (result._tag === "Failure") {
        return `Could not remove ${computer.name} from your account. Check your internet connection, then try again.`;
      }
    }
    if (environments.some((entry) => entry.environmentId === computer.environmentId)) {
      const result = await forget(computer.environmentId);
      if (result._tag === "Failure") {
        return `Could not remove ${computer.name} from this browser. Try again.`;
      }
    }
    refreshManagedTunnelUsage();
    void refreshDiscovery();
    return null;
  };
}
