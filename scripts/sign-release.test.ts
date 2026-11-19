// @effect-diagnostics nodeBuiltinImport:off - Signs and checks real keys and files, as the plain-Node release step does.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import { publicKeyEncodings, requireReleaseKey, signFile, signManifest } from "./sign-release.ts";
import {
  releaseCanonical,
  RELEASE_PUBLIC_KEYS,
  verifyReleaseSignature,
} from "./sync-package/updateCheck.ts";

const keyPair = () => NodeCrypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
const trusting = (publicKey: NodeCrypto.KeyObject) => {
  const encodings = publicKeyEncodings(publicKey);
  return { [encodings.keyId]: encodings.spki };
};
const mac = {
  version: "1.0.5",
  build: "202611200000",
  url: "https://trellium.org/downloads/Tinkjam-Sync-mac.zip",
  sha256: "ab".repeat(32),
  minimumSystemVersion: "13.0",
};

describe("release signatures", () => {
  it("verifies what the release key signed, for that kind only", () => {
    const { privateKey, publicKey } = keyPair();
    const signed = signManifest("mac", mac, privateKey);
    expect(signed.kind).toBe("mac");
    expect(verifyReleaseSignature("mac", signed, trusting(publicKey))).toBe(true);
    expect(verifyReleaseSignature("windows", signed, trusting(publicKey))).toBe(false);
    // Signing again replaces the old signature rather than signing over it.
    expect(
      verifyReleaseSignature("mac", signManifest("mac", signed, privateKey), trusting(publicKey)),
    ).toBe(true);
  });

  it.each([
    ["a changed version", { version: "1.0.6" }],
    ["a changed build", { build: "202611200001" }],
    ["a changed url", { url: "https://example.com/Tinkjam-Sync-mac.zip" }],
    ["a changed sha256", { sha256: "cd".repeat(32) }],
    ["a dropped minimum system", { minimumSystemVersion: undefined }],
    ["no signature", { signature: undefined }],
    ["a signature that is not one", { signature: "bm9wZQ==" }],
    ["a key it does not know", { keyId: "ffffffffffffffff" }],
  ])("refuses %s", (_case, change) => {
    const { privateKey, publicKey } = keyPair();
    const changed = { ...signManifest("mac", mac, privateKey), ...change };
    expect(verifyReleaseSignature("mac", changed, trusting(publicKey))).toBe(false);
  });

  it("refuses a manifest signed by another key, and the real keys by default", () => {
    const signed = signManifest("sync", mac, keyPair().privateKey);
    expect(verifyReleaseSignature("sync", signed, trusting(keyPair().publicKey))).toBe(false);
    expect(verifyReleaseSignature("sync", signed)).toBe(false);
  });

  it("has no canonical form for a field that is not one line of text", () => {
    expect(releaseCanonical("sync", { ...mac, url: "https://x\nsha256=y" })).toBeNull();
    expect(releaseCanonical("sync", { ...mac, build: 7 })).toBeNull();
    expect(releaseCanonical("sync", { version: "1", url: "u", build: null })).toBe(
      "tinkjam-release-v1\nkind=sync\nversion=1\nbuild=\nurl=u\nsha256=\nminimumSystemVersion=",
    );
    expect(() => signManifest("sync", { ...mac, url: "a\nb" }, keyPair().privateKey)).toThrow();
  });

  it("embeds two P-256 keys under their own ids", () => {
    for (const [keyId, spki] of Object.entries(RELEASE_PUBLIC_KEYS)) {
      const key = NodeCrypto.createPublicKey({
        key: Buffer.from(spki, "base64"),
        format: "der",
        type: "spki",
      });
      expect(publicKeyEncodings(key).keyId).toBe(keyId);
    }
    expect(Object.keys(RELEASE_PUBLIC_KEYS)).toHaveLength(2);
  });

  it("will not sign without the key, nor with a key the apps do not trust", () => {
    const dir = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tinkjam-sign-test-"));
    const manifest = NodePath.join(dir, "sync.json");
    NodeFS.writeFileSync(manifest, JSON.stringify(mac));
    expect(() => requireReleaseKey(NodePath.join(dir, "missing.pem"))).toThrow(/No release key/);
    const keyFile = NodePath.join(dir, "untrusted.pem");
    NodeFS.writeFileSync(keyFile, keyPair().privateKey.export({ type: "pkcs8", format: "pem" }));
    expect(() => signFile(manifest, keyFile)).toThrow(/not one the apps trust/);
    expect(JSON.parse(NodeFS.readFileSync(manifest, "utf8"))).toEqual(mac);
  });
});
