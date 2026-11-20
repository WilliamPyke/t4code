import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { layerRecoveringSpawner } from "./nodeServices.ts";

const spawnerThatThrows = (error: Error) =>
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die(error)),
  );

const forbidden = Object.assign(new Error("spawn EPERM"), {
  code: "EPERM",
  syscall: "spawn /bin/ps",
});

describe("nodeServices", () => {
  it.effect("lets a caller recover from a program the sandbox forbids, as from a missing one", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const output = yield* spawner
        .string(ChildProcess.make("/bin/ps", ["-o", "pid="]))
        .pipe(Effect.orElseSucceed(() => "unknown"));
      expect(output).toBe("unknown");
    }).pipe(
      Effect.provide(layerRecoveringSpawner.pipe(Layer.provide(spawnerThatThrows(forbidden)))),
    ),
  );

  it.effect("still dies on defects that are not spawn errors", () =>
    Effect.gen(function* () {
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const exit = yield* spawner.string(ChildProcess.make("ps", [])).pipe(Effect.exit);
      expect(Exit.hasDies(exit)).toBe(true);
    }).pipe(
      Effect.provide(
        layerRecoveringSpawner.pipe(Layer.provide(spawnerThatThrows(new Error("a bug")))),
      ),
    ),
  );
});
