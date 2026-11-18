import { useAtomValue } from "@effect/atom-react";
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import type { EnvironmentId } from "@t3tools/contracts";
import { useEffect, useEffectEvent, useRef } from "react";

import { environmentCatalog } from "~/connection/catalog";
import { useEnvironments, useRelayEnvironmentDiscovery } from "~/state/environments";
import { relayEnvironmentDiscovery } from "~/state/relay";
import { useAtomCommand } from "~/state/use-atom-command";

import { computersAwaitingReconnect, computersBackOnline } from "./bringAgent.logic";
import { discoveredComputers, savedComputers } from "./yourComputers";

const ASK_ACCOUNT_EVERY_MS = 20_000;
// A retry that is still connecting is left alone this long before another.
const RETRY_AT_MOST_EVERY_MS = 60_000;

/**
 * Reconnects a computer the moment Tinkjam Sync runs on it again, so nobody has to reload the
 * page or press Reconnect after starting Sync or connecting it.
 */
export function ComputerReconnectCoordinator() {
  const session = useAtomValue(managedRelaySessionAtom);
  const { environments } = useEnvironments();
  const discovery = useRelayEnvironmentDiscovery();
  const refreshDiscovery = useAtomCommand(relayEnvironmentDiscovery.refresh, {
    reportFailure: false,
  });
  const retry = useAtomCommand(environmentCatalog.retryNow, { reportFailure: false });
  const retriedAt = useRef(new Map<EnvironmentId, number>());

  const saved = savedComputers(environments);
  const waiting = session !== null && computersAwaitingReconnect(saved).length > 0;
  const backOnline = waiting ? computersBackOnline(saved, discoveredComputers(discovery)) : [];
  const backOnlineKey = backOnline.join("\n");

  const retryBackOnline = useEffectEvent(() => {
    const now = Date.now();
    for (const environmentId of backOnline) {
      if (now - (retriedAt.current.get(environmentId) ?? 0) < RETRY_AT_MOST_EVERY_MS) continue;
      retriedAt.current.set(environmentId, now);
      void retry(environmentId);
    }
  });
  const askAccount = useEffectEvent(() => {
    if (document.visibilityState !== "visible") return;
    // A computer still waiting after an earlier retry gets another once that one had its time.
    retryBackOnline();
    if (!discovery.refreshing) void refreshDiscovery();
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the account which computers run Sync while this browser waits on one
  useEffect(() => {
    if (!waiting) return;
    askAccount();
    const timer = setInterval(askAccount, ASK_ACCOUNT_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the account's word that Sync is back to the connection supervisor
  useEffect(() => {
    if (backOnlineKey !== "") retryBackOnline();
  }, [backOnlineKey]);

  return null;
}
