import { describe, expect, it } from "vite-plus/test";

import { syncNeedsApproval } from "./sync.ts";

describe("syncNeedsApproval", () => {
  const linked = { desired: true, mode: "managed", signedIn: true, revoked: false } as const;

  it("serves straight away only for a signed-in computer its account still keeps", () => {
    expect(syncNeedsApproval(linked)).toBe(false);
    expect(syncNeedsApproval({ ...linked, signedIn: false })).toBe(true);
    expect(syncNeedsApproval({ ...linked, desired: false })).toBe(true);
    expect(syncNeedsApproval({ ...linked, revoked: true })).toBe(true);
    // A publish-only link has no tunnel, so no board could reach this computer.
    expect(syncNeedsApproval({ ...linked, mode: "publish_only" })).toBe(true);
  });
});
