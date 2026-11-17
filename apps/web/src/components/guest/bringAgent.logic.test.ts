import { EnvironmentId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { bringAgentComputers } from "./bringAgent.logic";

const id = (value: string) => EnvironmentId.make(value);

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
