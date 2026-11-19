import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

const RESUME_CHECK_INTERVAL = Duration.seconds(10);
// Tunnel connections survive a shorter pause, and a busy event loop never stalls this long.
const RESUME_GAP_MILLIS = 30_000;

/**
 * Runs `onResume` with the time spent asleep each time this machine wakes from sleep. Sleep
 * stops or delays timers but not the wall clock, so a tick that took far too long is a wake.
 */
// Runs for the server's lifetime; a span would never end.
export const onSystemResume = Effect.fnUntraced(function* <E, R>(
  onResume: (asleepMillis: number) => Effect.Effect<void, E, R>,
) {
  const intervalMillis = Duration.toMillis(RESUME_CHECK_INTERVAL);
  let last = yield* Clock.currentTimeMillis;
  while (true) {
    yield* Effect.sleep(RESUME_CHECK_INTERVAL);
    const now = yield* Clock.currentTimeMillis;
    const asleepMillis = now - last - intervalMillis;
    last = now;
    if (asleepMillis >= RESUME_GAP_MILLIS) yield* onResume(asleepMillis);
  }
});
