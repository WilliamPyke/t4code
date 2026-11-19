import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

/**
 * Runs `use` on the test clock with a way to put the machine to sleep: the wall clock jumps
 * ahead while no timer fires, which is what a process sees when a laptop wakes.
 */
export const withMachineSleep = <A, E, R>(
  use: (sleepFor: (duration: Duration.Input) => Effect.Effect<void>) => Effect.Effect<A, E, R>,
) =>
  Clock.clockWith((clock) => {
    let asleepMillis = 0;
    const now = () => clock.currentTimeMillisUnsafe() + asleepMillis;
    return use((duration) =>
      Effect.sync(() => {
        asleepMillis += Duration.toMillis(Duration.fromInputUnsafe(duration));
      }),
    ).pipe(
      Effect.provideService(Clock.Clock, {
        ...clock,
        currentTimeMillisUnsafe: now,
        currentTimeMillis: Effect.sync(now),
      }),
    );
  });
