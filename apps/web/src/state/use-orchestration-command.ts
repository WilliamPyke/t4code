import type {
  AtomCommand,
  AtomCommandOptions,
  AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  type EnvironmentId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";

import { type EnvironmentScopeAccess, readEnvironmentScopeAccess } from "./session";
import { useAtomCommand } from "./use-atom-command";

/** Why a change to threads or projects did not go to this machine. */
export const orchestrationDeniedMessage = (access: Exclude<EnvironmentScopeAccess, "granted">) =>
  access === "not-connected"
    ? "Not connected to this machine. Check that Tinkjam is running there."
    : "This connection cannot change threads or projects.";

export function useOrchestrationCommand<W extends { readonly environmentId: EnvironmentId }, A, E>(
  command: AtomCommand<W, A, E>,
  options?: string | AtomCommandOptions,
): (value: W) => Promise<AtomCommandResult<A, E | EnvironmentAuthorizationError>> {
  const run = useAtomCommand(command, options);
  return async (value: W): Promise<AtomCommandResult<A, E | EnvironmentAuthorizationError>> => {
    const access = readEnvironmentScopeAccess(value.environmentId, AuthOrchestrationOperateScope);
    if (access !== "granted") {
      return AsyncResult.failure(
        Cause.fail(
          new EnvironmentAuthorizationError({
            requiredScope: AuthOrchestrationOperateScope,
            message: orchestrationDeniedMessage(access),
          }),
        ),
      );
    }
    return run(value);
  };
}
