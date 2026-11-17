import type { EnvironmentConnectReachability } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as TestClock from "effect/testing/TestClock";

import {
  announceWhenReachable,
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
  it.effect("says Connected once the link is reachable, and the slow notice only once", () =>
    Effect.gen(function* () {
      const said: Array<string> = [];
      let latest: EnvironmentConnectReachability = notLinked;
      const fiber = yield* announceWhenReachable({
        check: Effect.sync(() => latest),
        say: (line) => Effect.sync(() => void said.push(line)),
      }).pipe(Effect.forkChild);

      yield* TestClock.adjust(Duration.minutes(5));
      expect(said).toEqual([SYNC_CONNECTING_MESSAGE, SYNC_SLOW_MESSAGE]);

      latest = reachable;
      yield* TestClock.adjust(Duration.seconds(2));
      yield* Fiber.join(fiber);
      expect(said).toEqual([SYNC_CONNECTING_MESSAGE, SYNC_SLOW_MESSAGE, SYNC_CONNECTED_MESSAGE]);
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
