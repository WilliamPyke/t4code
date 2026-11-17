import type { EnvironmentConnectReachability } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ServerConfig from "../config.ts";
import * as ConnectReachability from "./ConnectReachability.ts";

export const SYNC_CONNECTING_MESSAGE = "Connecting this computer to Tinkjam...";
export const SYNC_CONNECTED_MESSAGE =
  "Connected. You can close the browser tab; keep this window open while you work.";
export const SYNC_SLOW_MESSAGE =
  "Still connecting. Check this computer's internet connection; Tinkjam Sync keeps trying.";

// The server checks on its own only when the tunnel's readiness changes and every few minutes,
// and the first of those usually comes before Cloudflare routes a new tunnel. So this asks
// itself, often, until it answers; then never again.
const CHECK_INTERVAL = Duration.seconds(2);
const SLOW_AFTER = Duration.seconds(90);

/**
 * Tells the person once this computer can be reached through its account, which is when their
 * boards can see it. Says so once if that takes long, and nothing more after it connects.
 */
export const announceWhenReachable = Effect.fn("sync.announceWhenReachable")(function* (input: {
  readonly check: Effect.Effect<EnvironmentConnectReachability>;
  readonly say: (line: string) => Effect.Effect<void>;
}) {
  yield* input.say(SYNC_CONNECTING_MESSAGE);
  const startedAt = yield* Clock.currentTimeMillis;
  let saidSlow = false;
  while (true) {
    const result = yield* input.check;
    if (result.status === "reachable") return yield* input.say(SYNC_CONNECTED_MESSAGE);
    const waited = (yield* Clock.currentTimeMillis) - startedAt;
    if (!saidSlow && waited >= Duration.toMillis(SLOW_AFTER)) {
      saidSlow = true;
      yield* input.say(SYNC_SLOW_MESSAGE);
    }
    yield* Effect.sleep(CHECK_INTERVAL);
  }
});

/** Runs only for `t3 sync`; other presentations print their own access details. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (config.startupPresentation !== "sync") return;
    const reachability = yield* ConnectReachability.ConnectReachability;
    yield* announceWhenReachable({ check: reachability.check, say: Console.log }).pipe(
      Effect.forkScoped,
    );
  }),
);
