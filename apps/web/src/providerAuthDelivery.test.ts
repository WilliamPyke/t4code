import { describe, expect, it, vi } from "vite-plus/test";

vi.mock("./state/server", () => ({ serverEnvironment: {} }));
vi.mock("./state/presentation", () => ({ environmentPresentations: {} }));
vi.mock("./rpc/atomRegistry", () => ({ appAtomRegistry: {} }));
vi.mock("./components/ui/toast", () => ({ toastManager: { add: vi.fn() } }));

import { takeExpectedSignIn, withExpectedSignIn } from "./providerAuthDelivery";

describe("provider sign-in delivery", () => {
  it("delivers a finished sign-in only to the environment and flow this app started, once", () => {
    const expected = withExpectedSignIn([], { environmentId: "env-own", flowId: "flow-1", at: 0 });
    // A link naming another environment, or another flow, gets nothing.
    expect(
      takeExpectedSignIn(expected, { environmentId: "env-linked", flowId: "flow-1" }, 1).expected,
    ).toBe(false);
    expect(
      takeExpectedSignIn(expected, { environmentId: "env-own", flowId: "flow-2" }, 1).expected,
    ).toBe(false);
    const taken = takeExpectedSignIn(expected, { environmentId: "env-own", flowId: "flow-1" }, 1);
    expect(taken).toEqual({ expected: true, rest: [] });
    expect(
      takeExpectedSignIn(taken.rest, { environmentId: "env-own", flowId: "flow-1" }, 2).expected,
    ).toBe(false);
    // An old start no longer counts.
    expect(
      takeExpectedSignIn(expected, { environmentId: "env-own", flowId: "flow-1" }, 31 * 60_000)
        .expected,
    ).toBe(false);
  });
});
