import * as NodeServices from "@effect/platform-node/NodeServices";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as PlatformError from "effect/PlatformError";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

// Node throws, rather than emits, spawn errors other than ENOENT/EACCES/EAGAIN/EMFILE/ENFILE.
// A sandbox that forbids running a program (macOS denies /bin/ps to sandboxed agents) gives EPERM.
const isThrownSpawnError = (cause: unknown): cause is NodeJS.ErrnoException =>
  cause instanceof Error &&
  "syscall" in cause &&
  typeof cause.syscall === "string" &&
  cause.syscall.startsWith("spawn");

/**
 * The same spawner, except a spawn that Node throws fails with a PlatformError instead of
 * killing the fiber, so callers that tolerate a missing program also tolerate a forbidden one.
 */
const recoverThrownSpawnErrors = (
  spawner: ChildProcessSpawner.ChildProcessSpawner["Service"],
): ChildProcessSpawner.ChildProcessSpawner["Service"] =>
  ChildProcessSpawner.make((command) =>
    spawner.spawn(command).pipe(
      Effect.catchDefect((cause) =>
        isThrownSpawnError(cause)
          ? Effect.fail(
              PlatformError.systemError({
                _tag:
                  cause.code === "EPERM" || cause.code === "EACCES"
                    ? "PermissionDenied"
                    : "Unknown",
                module: "ChildProcess",
                method: "spawn",
                syscall: cause.syscall,
                description: cause.message,
                cause,
              }),
            )
          : Effect.die(cause),
      ),
    ),
  );

export const layerRecoveringSpawner = Layer.effect(
  ChildProcessSpawner.ChildProcessSpawner,
  Effect.map(ChildProcessSpawner.ChildProcessSpawner, recoverThrownSpawnErrors),
);

/** NodeServices, with spawn failures recoverable. */
export const layer = layerRecoveringSpawner.pipe(Layer.provideMerge(NodeServices.layer));
