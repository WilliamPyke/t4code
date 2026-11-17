import type { EnvironmentConnectReachability } from "@t3tools/contracts";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import * as ServerConfig from "../config.ts";
import * as ConnectReachability from "./ConnectReachability.ts";

export const SYNC_CONNECTING_MESSAGE = "Connecting this computer to Tinkjam...";
export const SYNC_CONNECTED_MESSAGE =
  "Connected. You can close the browser tab; keep this window open while you work.";
export const SYNC_SLOW_MESSAGE =
  "Still connecting. Check this computer's internet connection; Tinkjam Sync keeps trying.";

// The server checks on its own whenever the tunnel's readiness changes, so reading its latest
// result is enough; this only decides how soon the person hears about it.
const POLL_INTERVAL = Duration.seconds(2);
const SLOW_AFTER = Duration.seconds(90);

/**
 * Tells the person once this computer can be reached through its account, which is when their
 * boards can see it. Says so once if that takes long, and nothing more after it connects.
 */
export const announceWhenReachable = Effect.fn("sync.announceWhenReachable")(function* (input: {
  readonly latest: Effect.Effect<Option.Option<EnvironmentConnectReachability>>;
  readonly say: (line: string) => Effect.Effect<void>;
}) {
  yield* input.say(SYNC_CONNECTING_MESSAGE);
  const slowAfter = Math.ceil(Duration.toMillis(SLOW_AFTER) / Duration.toMillis(POLL_INTERVAL));
  for (let polls = 0; ; polls += 1) {
    const latest = yield* input.latest;
    if (Option.isSome(latest) && latest.value.status === "reachable") {
      return yield* input.say(SYNC_CONNECTED_MESSAGE);
    }
    if (polls === slowAfter) yield* input.say(SYNC_SLOW_MESSAGE);
    yield* Effect.sleep(POLL_INTERVAL);
  }
});

/** Runs only for `t3 sync`; other presentations print their own access details. */
export const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* ServerConfig.ServerConfig;
    if (config.startupPresentation !== "sync") return;
    const reachability = yield* ConnectReachability.ConnectReachability;
    yield* announceWhenReachable({ latest: reachability.latest, say: Console.log }).pipe(
      Effect.forkScoped,
    );
  }),
);
