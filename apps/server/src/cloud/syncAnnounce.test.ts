import type { EnvironmentConnectReachability } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import { classifyReachability, type ReachabilityFacts } from "./ConnectReachability.ts";
import {
  announceWhenReachable,
  inSyncWords,
  SYNC_CONNECTED_MESSAGE,
  SYNC_CONNECTING_MESSAGE,
  SYNC_SLOW_MESSAGE,
} from "./syncAnnounce.ts";

const checkedAt = "2026-11-17T00:00:00.000Z";
const reachable: EnvironmentConnectReachability = {
  status: "reachable",
  checkedAt,
  readyConnections: 4,
  protocol: "quic",
};
const notLinked: EnvironmentConnectReachability = {
  status: "unreachable",
  checkedAt,
  cause: "not_linked",
  reason: "Not linked yet.",
  hint: null,
  fix: "Wait.",
};
// What a new tunnel answers before Cloudflare routes it, which the server alone rechecks late.
const notRoutedYet: EnvironmentConnectReachability = {
  ...notLinked,
  cause: "no_connector",
  reason: "No live connection yet.",
};

describe("announceWhenReachable", () => {
  it.effect("says Connected once reachable, the slow notice once, and then what it waits on", () =>
    Effect.gen(function* () {
      const said: Array<string> = [];
      let latest: EnvironmentConnectReachability = notLinked;
      const fiber = yield* announceWhenReachable({
        check: Effect.sync(() => latest),
        say: (line) => Effect.sync(() => void said.push(line)),
      }).pipe(Effect.forkChild);

      yield* TestClock.adjust(Duration.minutes(5));
      const waitingOnLink = "  Waiting on: Not linked yet. (not_linked) Wait.";
      expect(said).toEqual([SYNC_CONNECTING_MESSAGE, SYNC_SLOW_MESSAGE, waitingOnLink]);

      latest = notRoutedYet;
      yield* TestClock.adjust(Duration.seconds(10));
      latest = reachable;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* Fiber.join(fiber);
      expect(said).toEqual([
        SYNC_CONNECTING_MESSAGE,
        SYNC_SLOW_MESSAGE,
        waitingOnLink,
        "  Waiting on: No live connection yet. (no_connector) Wait.",
        SYNC_CONNECTED_MESSAGE,
      ]);
    }),
  );

  it.effect("asks again itself, so a tunnel Cloudflare routes seconds later connects then", () =>
    Effect.gen(function* () {
      const said: Array<string> = [];
      let checks = 0;
      const fiber = yield* announceWhenReachable({
        check: Effect.sync(() => {
          checks += 1;
          return checks < 4 ? notRoutedYet : reachable;
        }),
        say: (line) => Effect.sync(() => void said.push(line)),
      }).pipe(Effect.forkChild);

      yield* TestClock.adjust(Duration.seconds(6));
      yield* Fiber.join(fiber);
      expect(checks).toBe(4);
      expect(said).toEqual([SYNC_CONNECTING_MESSAGE, SYNC_CONNECTED_MESSAGE]);
    }),
  );
});

describe("inSyncWords", () => {
  it("never shows T3 Code or a t3 command, for any reason a check can give", () => {
    const connector = {
      pid: 1,
      readyConnections: 4,
      hostname: "env.example.test",
      protocol: "quic",
    };
    const base = {
      managedTunnelConfigured: true,
      connector,
      endpoint: null,
      edgeReachable: null,
      exitNode: null,
    };
    const results = [
      { ...base, managedTunnelConfigured: false },
      { ...base, connector: null },
      { ...base, endpoint: { kind: "status", status: 502 } },
      { ...base, endpoint: { kind: "status", status: 530 } },
      { ...base, endpoint: { kind: "status", status: 418 } },
      { ...base, endpoint: { kind: "dns_failed" } },
    ] as const satisfies ReadonlyArray<ReachabilityFacts>;
    for (const facts of results) {
      const said = inSyncWords(classifyReachability(facts, checkedAt));
      if (said.status === "reachable") continue;
      expect(`${said.reason} ${said.fix}`).not.toMatch(/\bT3\b|`t3 /);
    }
  });
});
