// @effect-diagnostics nodeBuiltinImport:off - Signs a manifest with a throwaway key, as the release step does.
import * as NodeCrypto from "node:crypto";

import { describe, expect, it } from "vite-plus/test";

import { publicKeyEncodings, signManifest } from "../sign-release.ts";
import { isNewerSync, readSyncRelease, syncUpdateNotice, syncVersion } from "./updateCheck.ts";

const release = { version: "0.1.8+202611171530", url: "https://trellium.org/sync.tgz" };

describe("Tinkjam Sync's update check", () => {
  it("stamps each build with its time", () => {
    expect(syncVersion("0.1.7", "2026-11-17T15:30:59.000Z")).toBe("0.1.7+202611171530");
  });

  it.each([
    ["a newer build of the same version", "0.1.7+202611170900", "0.1.7+202611171530", true],
    ["a newer version", "0.1.7+202611171530", "0.1.10+202601010000", true],
    ["the same build", "0.1.7+202611171530", "0.1.7+202611171530", false],
    ["an older build", "0.1.7+202611171530", "0.1.7+202611170900", false],
    ["an older version", "0.2.0+202601010000", "0.1.9+202612312359", false],
    ["a copy built before builds were stamped", "0.1.7", "0.1.7+202611171530", true],
    ["anything unreadable", "0.1.7+202611171530", "latest", false],
  ])("treats %s as newer: %s -> %s is %s", (_case, own, latest, newer) => {
    expect(isNewerSync(own, latest)).toBe(newer);
  });

  it("tells the person the exact command, with the version in the URL so npx downloads it", () => {
    expect(syncUpdateNotice("0.1.8+202611171530", release)).toBeNull();
    expect(syncUpdateNotice("0.1.7+202611170900", null)).toBeNull();
    expect(syncUpdateNotice("0.1.7+202611170900", release)).toContain(
      "npx -y https://trellium.org/sync.tgz?v=0.1.8%2B202611171530",
    );
    expect(syncUpdateNotice("0.1.7+202611170900", release, { install: true })).toContain(
      "npx -y https://trellium.org/sync.tgz?v=0.1.8%2B202611171530 --install",
    );
  });

  it("reads only a well-formed sync.json the release key signed, and nothing when it fails", async () => {
    const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
    const encodings = publicKeyEncodings(publicKey);
    const keys = { [encodings.keyId]: encodings.spki };
    const answer = (status: number, body: unknown) => async () =>
      new Response(JSON.stringify(body), { status });
    const url = "https://trellium.org/sync.json";
    const signed = signManifest("sync", { ...release, sha256: "ab".repeat(32) }, privateKey);
    expect(await readSyncRelease(url, 1000, answer(200, signed), keys)).toEqual(release);
    expect(await readSyncRelease(url, 1000, answer(200, release), keys)).toBeNull();
    expect(await readSyncRelease(url, 1000, answer(200, signed))).toBeNull();
    expect(await readSyncRelease(url, 1000, answer(404, signed), keys)).toBeNull();
    expect(
      await readSyncRelease(url, 1000, answer(200, { version: "1", url: "http://x" }), keys),
    ).toBeNull();
    const failing = async (): Promise<Response> => {
      throw new Error("offline");
    };
    expect(await readSyncRelease(url, 1000, failing, keys)).toBeNull();
  });
});
