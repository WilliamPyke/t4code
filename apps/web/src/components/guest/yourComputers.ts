import { useAtomValue } from "@effect/atom-react";
import { orchestrationProtocolCompatibilityError } from "@t3tools/client-runtime/connection";
import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import { type Discovery, managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import type { EnvironmentId } from "@t3tools/contracts";
import * as Option from "effect/Option";
import { useEffect, useEffectEvent, useState } from "react";

import {
  deregisterManagedRelayEnvironmentCommand,
  refreshManagedTunnelUsage,
} from "~/cloud/managedRelayState";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { environmentCatalog } from "~/connection/catalog";
import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import {
  type EnvironmentPresentation,
  useEnvironments,
  useRelayEnvironmentDiscovery,
} from "~/state/environments";
import { toastManager } from "~/components/ui/toast";
import { relayEnvironmentDiscovery } from "~/state/relay";
import { useAtomCommand } from "~/state/use-atom-command";

import {
  type BringAgentComputer,
  type DiscoveredComputer,
  bringAgentComputers,
  steadyDiscovered,
  uncheckedDiscovered,
} from "./bringAgent.logic";

// The one wording for how a computer is, wherever a person's computers are listed.
const COMPUTER_STATUS_TEXT: Record<BringAgentComputer["status"], string> = {
  ready: "Online",
  online: "Online",
  connecting: "Connecting…",
  offline: "Offline. Wake it, or open Tinkjam Sync from Applications or the Start menu.",
  unchecked: "Could not check. Try again in a moment.",
  unsupported: "Out of date. Open Tinkjam Sync on it and choose Check for Updates.",
  gone: "No longer connected. Remove it, or open Tinkjam Sync on it and choose Connect.",
};

export const COMPUTER_STATUS_DOT: Record<BringAgentComputer["status"], string> = {
  ready: "bg-success",
  online: "bg-success",
  connecting: "bg-warning",
  offline: "bg-muted-foreground/35",
  unchecked: "bg-muted-foreground/35",
  unsupported: "bg-destructive",
  gone: "bg-muted-foreground/35",
};

/** Whether asking again could change how a computer shows: it was down, or nobody could say. */
export const canRetryComputer = (computer: BringAgentComputer): boolean =>
  computer.status === "offline" || computer.status === "unchecked";

// To the minute: two computers with one name are often connected on the same day.
const addedAtFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

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

// How long the account may go unanswered before what it last said stops being shown as true.
const TRUST_LAST_ANSWER_MS = 30_000;

/**
 * The person's computers, the same wherever they are listed: the ones this browser saved and the
 * ones their account lists. While `active` it asks the account, again every `pollEveryMs` if
 * given, and what was shown stays put between answers.
 */
export function useYourComputers(options: {
  readonly active: boolean;
  readonly pollEveryMs: number | null;
}) {
  const { active, pollEveryMs } = options;
  const account = useBoardAccount();
  const withAccount = boardAccountsEnabled() && hasCloudPublicConfig();
  const signedIn = account.status === "signed-in";
  const withList = withAccount && signedIn;
  const { environments } = useEnvironments();
  const discovery = useRelayEnvironmentDiscovery();
  const refreshDiscovery = useAtomCommand(relayEnvironmentDiscovery.refresh, {
    reportFailure: false,
  });
  const retryConnection = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });

  const [discovered, setDiscovered] = useState<ReadonlyArray<DiscoveredComputer>>([]);
  // Each ask for the account's list starts unlisted; once one answered, `discovered` holds it.
  const [listedOnce, setListedOnce] = useState(false);
  if (listedOnce !== (withList && (listedOnce || discovery.listed))) setListedOnce(!listedOnce);
  // An ask was seen under way; once it is over, with or without a list, the wait is too.
  const [askSeen, setAskSeen] = useState(false);
  if (discovery.refreshing && !askSeen) setAskSeen(true);
  const asked = askSeen && !discovery.refreshing;
  // How the last finished ask ended; one in flight says nothing yet.
  const [failed, setFailed] = useState(false);
  if (!discovery.refreshing) {
    const failedNow = withList && (discovery.offline || Option.isSome(discovery.error));
    if (failedNow !== failed) setFailed(failedNow);
  }
  const [aged, setAged] = useState(false);
  if (!failed && aged) setAged(false);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a timer: what the account last said stops counting once it has gone unanswered this long
  useEffect(() => {
    if (!failed) return;
    const timer = setTimeout(() => setAged(true), TRUST_LAST_ANSWER_MS);
    return () => clearTimeout(timer);
  }, [failed]);

  const steady = withList
    ? steadyDiscovered(discovered, {
        listed: discovery.listed,
        computers: discoveredComputers(discovery),
      })
    : [];
  if (JSON.stringify(steady) !== JSON.stringify(discovered)) setDiscovered(steady);
  const computers = bringAgentComputers({
    saved: savedComputers(environments),
    discovered: aged ? uncheckedDiscovered(steady) : steady,
    listed: withList && listedOnce && !aged,
  });

  const ask = useEffectEvent(async () => {
    if (document.visibilityState !== "visible" || discovery.refreshing) return;
    await refreshDiscovery();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the account for its computers while the list shows, so one that just connected appears
  useEffect(() => {
    if (!active || !withList) return;
    void ask();
    if (pollEveryMs === null) return;
    const timer = setInterval(() => void ask(), pollEveryMs);
    return () => clearInterval(timer);
  }, [active, withList, pollEveryMs]);

  return {
    computers,
    /** The account has not answered yet, so an empty list would be a guess. */
    loading: withList && !asked && !listedOnce && !failed,
    /** The account's list could not be loaded; saved computers still show. */
    failed,
    withAccount,
    signedIn,
    /** The computer this app itself runs on, which cannot be removed. */
    primaryIds: new Set(
      environments
        .filter((entry) => entry.entry.target._tag === "PrimaryConnectionTarget")
        .map((entry) => entry.environmentId),
    ),
    refresh: () => refreshDiscovery(),
    /** Reaches for one computer again: this browser's connection to it, and the account's word. */
    retry: async (computer: Pick<BringAgentComputer, "environmentId" | "saved">) => {
      if (computer.saved) void retryConnection(computer.environmentId);
      await refreshDiscovery();
    },
  };
}

const REMOVED = "It is signed out of your account and can no longer reach your boards";
const BRING_BACK = "Connect it again from that computer to bring it back.";

/**
 * Removes one of the person's computers: off their account, so no board finds it, and out of
 * this browser. Neither step needs the computer to be on. `remove` resolves to what went wrong,
 * or null; `question` is what to ask first.
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
  const accountId = session?.accountId ?? null;
  // Signed out, the account cannot be changed: only this browser forgets the computer.
  const browserOnly = accountId === null && boardAccountsEnabled() && hasCloudPublicConfig();
  return {
    question: (name: string) =>
      browserOnly
        ? `Forget ${name} in this browser? You are signed out, so it stays on your account. Sign in first to remove it everywhere.`
        : `Remove ${name}? ${REMOVED}. A board that has it open right now keeps that connection until it drops. ${BRING_BACK}`,
    remove: async (computer: {
      readonly environmentId: EnvironmentId;
      readonly name: string;
    }): Promise<string | null> => {
      const goneFromAccount =
        discovery.listed && !discovery.environments.has(computer.environmentId);
      if (accountId !== null && !goneFromAccount) {
        const result = await deregister({ accountId, environmentId: computer.environmentId });
        if (result._tag === "Failure") {
          return `Could not remove ${computer.name} from your account. Check your internet connection, then try again.`;
        }
        toastManager.add({
          type: "success",
          title: `${computer.name} was removed`,
          description: `${REMOVED}. ${BRING_BACK}`,
        });
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
    },
  };
}
