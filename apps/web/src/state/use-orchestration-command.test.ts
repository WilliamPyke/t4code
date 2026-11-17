import type { AtomCommand } from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  EnvironmentAuthorizationError,
  EnvironmentId,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { assert, beforeEach, expect, it, vi } from "vite-plus/test";

const state = vi.hoisted(() => ({
  allowed: new Set<string>(),
  connected: true,
  readScope: vi.fn(),
  run: vi.fn(),
}));

vi.mock("react", () => ({ useCallback: (callback: unknown) => callback }));
vi.mock("./session", () => ({ readEnvironmentScopeAccess: state.readScope }));
vi.mock("./use-atom-command", () => ({ useAtomCommand: () => state.run }));

import { useOrchestrationCommand } from "./use-orchestration-command";

const first = EnvironmentId.make("primary");
const second = EnvironmentId.make("secondary");
type Target = { environmentId: EnvironmentId; input: { threadId: string } };
const command: AtomCommand<Target, string, Error> = { label: "thread mutation", run: state.run };
const target = (environmentId: EnvironmentId): Target => ({
  environmentId,
  input: { threadId: "thread-1" },
});

beforeEach(() => {
  state.allowed.clear();
  state.connected = true;
  state.run.mockReset().mockResolvedValue(AsyncResult.success("receipt"));
  state.readScope
    .mockReset()
    .mockImplementation((environmentId, scope) =>
      !state.connected
        ? "not-connected"
        : scope === AuthOrchestrationOperateScope && state.allowed.has(environmentId)
          ? "granted"
          : "denied",
    );
});

it("checks the command's environment instead of borrowing the primary grant", async () => {
  state.allowed.add(first);
  const mutate = useOrchestrationCommand(command, { reportFailure: false });
  const result = await mutate(target(second));
  assert(result._tag === "Failure");
  const error = Cause.squash(result.cause);
  expect(error).toBeInstanceOf(EnvironmentAuthorizationError);
  expect(error).toMatchObject({
    requiredScope: AuthOrchestrationOperateScope,
    message: "This connection cannot change threads or projects.",
  });
  expect(state.run).not.toHaveBeenCalled();

  expect(await mutate(target(first))).toMatchObject({ _tag: "Success", value: "receipt" });
  expect(state.run).toHaveBeenCalledWith(target(first));
});

it("does not dispatch a later mutation after access changes while awaiting a receipt", async () => {
  state.allowed.add(second);
  let finish: (() => void) | undefined;
  state.run.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(AsyncResult.success("first receipt"));
      }),
  );
  const mutate = useOrchestrationCommand(command);
  const pending = mutate(target(second));
  state.allowed.delete(second);
  finish!();
  expect((await pending)._tag).toBe("Success");
  expect((await mutate(target(second)))._tag).toBe("Failure");
  expect(state.run).toHaveBeenCalledTimes(1);
});

it("says the machine is not connected when its session is not here, not that access is missing", async () => {
  state.allowed.add(first);
  state.connected = false;
  const result = await useOrchestrationCommand(command, { reportFailure: false })(target(first));
  assert(result._tag === "Failure");
  expect(Cause.squash(result.cause)).toMatchObject({
    message: "Not connected to this machine. Check that Tinkjam is running there.",
  });
  expect(state.run).not.toHaveBeenCalled();
});
