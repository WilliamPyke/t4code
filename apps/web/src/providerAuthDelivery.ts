import { runAtomCommand } from "@t3tools/client-runtime/state/runtime";
import { readCodexAuthDelivery } from "@t3tools/shared/codexAuthHandoff";
import * as Schema from "effect/Schema";

import { toastManager } from "./components/ui/toast";
import { readLocalStorageValue, writeLocalStorageValue } from "./hooks/useLocalStorage";
import { appAtomRegistry } from "./rpc/atomRegistry";
import { environmentPresentations } from "./state/presentation";
import { serverEnvironment } from "./state/server";

type ProviderAuthDelivery = NonNullable<ReturnType<typeof readCodexAuthDelivery>>;

const ExpectedSignIn = Schema.Struct({
  environmentId: Schema.String,
  flowId: Schema.String,
  at: Schema.Number,
});
type ExpectedSignIn = typeof ExpectedSignIn.Type;
const ExpectedSignIns = Schema.Array(ExpectedSignIn);
const EXPECTED_KEY = "tinkjam:provider-auth-expected";
const EXPECTED_FOR_MS = 30 * 60_000;
const EXPECTED_MAX = 8;

/**
 * The sign-ins this app started, with the environment each was for. A finished sign-in goes only
 * to an environment and flow named here, never to one a link alone names.
 */
export function withExpectedSignIn(
  expected: ReadonlyArray<ExpectedSignIn>,
  next: ExpectedSignIn,
): ReadonlyArray<ExpectedSignIn> {
  return [...expected.filter((entry) => entry.at > next.at - EXPECTED_FOR_MS), next].slice(
    -EXPECTED_MAX,
  );
}

export function takeExpectedSignIn(
  expected: ReadonlyArray<ExpectedSignIn>,
  delivered: { readonly environmentId: string; readonly flowId: string },
  now: number,
): { readonly expected: boolean; readonly rest: ReadonlyArray<ExpectedSignIn> } {
  const live = expected.filter((entry) => entry.at > now - EXPECTED_FOR_MS);
  const rest = live.filter(
    (entry) => entry.environmentId !== delivered.environmentId || entry.flowId !== delivered.flowId,
  );
  return { expected: rest.length < live.length, rest };
}

/** Called as this app hands a sign-in to the desktop app, which returns it here. */
export function expectProviderAuthDelivery(environmentId: string, flowId: string): void {
  writeLocalStorageValue(
    EXPECTED_KEY,
    (expected: ReadonlyArray<ExpectedSignIn>) =>
      withExpectedSignIn(expected, { environmentId, flowId, at: Date.now() }),
    [],
    ExpectedSignIns,
  );
}

/**
 * Remove the code before the router, tracing, or welcome screen sees the incoming address,
 * then hand it to its environment once that environment connects. Hosted web receives only
 * the one-time code; the selected environment verifies and stores tokens.
 */
export function startProviderAuthDelivery(): void {
  if (!window.location.hash.startsWith("#codex-auth=")) return;
  const delivery = readCodexAuthDelivery(window.location.href);
  window.history.replaceState(
    window.history.state,
    "",
    delivery?.returnUrl ?? `${window.location.pathname}${window.location.search}`,
  );
  if (!delivery) return;
  const taken = takeExpectedSignIn(
    readLocalStorageValue(EXPECTED_KEY, [], ExpectedSignIns),
    delivery,
    Date.now(),
  );
  writeLocalStorageValue(EXPECTED_KEY, taken.rest, [], ExpectedSignIns);
  if (!taken.expected) {
    toastManager.add({
      type: "error",
      title: "ChatGPT sign-in was not sent",
      description: "This app did not start that sign-in. Start it again from the agent's settings.",
    });
    return;
  }

  const presentationAtom = environmentPresentations.presentationAtom(delivery.environmentId);
  if (appAtomRegistry.get(presentationAtom)?.connection.phase === "connected") {
    void completeProviderAuth(delivery);
    return;
  }
  const unsubscribe = appAtomRegistry.subscribe(presentationAtom, (presentation) => {
    if (presentation?.connection.phase !== "connected") return;
    unsubscribe();
    void completeProviderAuth(delivery);
  });
}

async function completeProviderAuth(delivery: ProviderAuthDelivery): Promise<void> {
  try {
    const result = await runAtomCommand(
      appAtomRegistry,
      serverEnvironment.completeProviderAuth,
      {
        environmentId: delivery.environmentId,
        input: {
          instanceId: delivery.instanceId,
          flowId: delivery.flowId,
          callbackUrl: delivery.callbackUrl,
        },
      },
      { reportFailure: false },
    );
    if (result._tag === "Failure") {
      toastManager.add({
        type: "error",
        title: "ChatGPT sign-in couldn't finish",
        description: "Return to the provider and try again.",
      });
    }
  } catch {
    toastManager.add({
      type: "error",
      title: "ChatGPT sign-in couldn't finish",
      description: "Reconnect to the environment and try again.",
    });
  }
}
