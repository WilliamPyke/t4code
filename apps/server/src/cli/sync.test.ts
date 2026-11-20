import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { appApprovalLine, syncNeedsApproval, syncSignedIn } from "./sync.ts";

describe("syncSignedIn", () => {
  const refreshFailure = (status?: number) =>
    Effect.fail(
      new CliTokenManager.CloudCliCredentialRefreshError({
        cause: "refresh failed",
        ...(status === undefined ? {} : { status }),
      }),
    );

  it.effect("counts a stored sign-in unless the account asks to sign in again", () =>
    Effect.gen(function* () {
      const hasCredential = Effect.succeed(true);
      // No network yet at log-in: the sign-in could not be checked, which is not a sign-out.
      expect(yield* syncSignedIn({ getExisting: refreshFailure(), hasCredential })).toBe(true);
      expect(yield* syncSignedIn({ getExisting: refreshFailure(503), hasCredential })).toBe(true);
      expect(yield* syncSignedIn({ getExisting: refreshFailure(400), hasCredential })).toBe(false);
      expect(
        yield* syncSignedIn({
          getExisting: Effect.succeedNone,
          hasCredential: Effect.succeed(false),
        }),
      ).toBe(false);
    }),
  );
});

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
    // SyncProcess.swift in the tinkjam-sync repository matches this prefix.
    expect(appApprovalLine("http://127.0.0.1:34338")).toBe(
      "TINKJAM_SYNC_APPROVE_URL http://127.0.0.1:34338",
    );
  });
});
