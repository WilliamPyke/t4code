import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { bringAgentComputers, steadyDiscovered } from "./bringAgent.logic";

const id = (value: string) => EnvironmentId.make(value);

describe("steadyDiscovered", () => {
  const computer = (
    environmentId: string,
    availability: "checking" | "online" | "offline" | "error",
  ) => ({
    environmentId: id(environmentId),
    name: environmentId,
    availability,
    unsupported: false,
  });

  it("keeps what it showed while the account's list is asked again, and adds new computers", () => {
    const shown = [computer("desk", "online"), computer("gone", "offline")];
    expect(steadyDiscovered(shown, { listed: false, computers: [] })).toBe(shown);
    expect(
      steadyDiscovered(shown, {
        listed: true,
        computers: [computer("desk", "checking"), computer("new", "checking")],
      }),
    ).toEqual([computer("desk", "online"), computer("new", "checking")]);
    expect(
      steadyDiscovered(shown, { listed: true, computers: [computer("desk", "offline")] }),
    ).toEqual([computer("desk", "offline")]);
  });
});

describe("bringAgentComputers", () => {
  it("is ready only once connected here with its config, and trusts the account otherwise", () => {
    const computers = bringAgentComputers({
      saved: [
        { environmentId: id("desk"), name: "Desk", phase: "connected", hasConfig: true },
        { environmentId: id("laptop"), name: "Laptop", phase: "connected", hasConfig: false },
        { environmentId: id("old"), name: "Old", phase: "offline", hasConfig: false },
        { environmentId: id("back"), name: "Back", phase: "error", hasConfig: false },
      ],
      discovered: [
        // Saved here already: the account only says whether it is up.
        { environmentId: id("back"), name: "Back", availability: "online", unsupported: false },
        { environmentId: id("new"), name: "New", availability: "online", unsupported: false },
        { environmentId: id("away"), name: "Away", availability: "offline", unsupported: false },
        { environmentId: id("stale"), name: "Stale", availability: "online", unsupported: true },
      ],
    });
    expect(
      computers.map(({ environmentId, status, saved }) => [environmentId, status, saved]),
    ).toEqual([
      ["desk", "ready", true],
      ["new", "online", false],
      ["back", "connecting", true],
      ["laptop", "connecting", true],
      ["away", "offline", false],
      ["old", "offline", true],
      ["stale", "unsupported", false],
    ]);
  });
});
