import { describe, expect, it } from "vite-plus/test";

import { appApprovalLine, syncNeedsApproval } from "./sync.ts";

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

describe("appApprovalLine", () => {
  it("is the one line Tinkjam Sync for Mac reads the approval link from", () => {
    // apps/sync-mac/Sources/TinkjamSync/SyncProcess.swift matches this prefix.
    expect(appApprovalLine("http://127.0.0.1:34338")).toBe(
      "TINKJAM_SYNC_APPROVE_URL http://127.0.0.1:34338",
    );
  });
});
