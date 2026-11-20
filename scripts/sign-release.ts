#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - A plain release step on the maintainer's computer.
// Signs sync.json, windows.json and mac.json, which installed copies then trust only when signed.
// The private key stays outside the repo at $TINKJAM_RELEASE_KEY (default
// ~/.tinkjam-release/release-key.pem); keep an offline copy. Commands: generate | public |
// sign <file> | verify <file>.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import {
  releaseCanonical,
  RELEASE_PUBLIC_KEYS,
  type ReleaseKind,
  verifyReleaseSignature,
} from "./sync-package/updateCheck.ts";

const repoRoot = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../..");

function releaseKeyPath(env: NodeJS.ProcessEnv = process.env): string {
  const chosen = env.TINKJAM_RELEASE_KEY?.trim();
  return chosen
    ? NodePath.resolve(chosen)
    : NodePath.join(NodeOS.homedir(), ".tinkjam-release", "release-key.pem");
}

/** The key's id: the start of the SHA-256 of its SPKI, so a manifest names which key signed it. */
const keyIdOf = (spki: Buffer) =>
  NodeCrypto.createHash("sha256").update(spki).digest("hex").slice(0, 16);

/** The three forms the verifiers take: Node (SPKI), Windows CNG (ECCPUBLICBLOB), CryptoKit (raw x||y). */
export function publicKeyEncodings(key: NodeCrypto.KeyObject) {
  const spki = key.export({ type: "spki", format: "der" });
  const jwk = key.export({ format: "jwk" });
  if (jwk.crv !== "P-256" || jwk.x === undefined || jwk.y === undefined) {
    throw new Error("The release key must be ECDSA P-256.");
  }
  const xy = Buffer.concat([Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]);
  const header = Buffer.alloc(8);
  header.writeUInt32LE(0x31534345, 0); // BCRYPT_ECDSA_PUBLIC_P256_MAGIC ("ECS1")
  header.writeUInt32LE(32, 4);
  return {
    keyId: keyIdOf(spki),
    spki: spki.toString("base64"),
    cngBlob: Buffer.concat([header, xy]).toString("base64"),
    raw: xy.toString("base64"),
  };
}

/** The manifest with `kind`, `keyId` and `signature` set for these exact field values. */
export function signManifest(
  kind: ReleaseKind,
  manifest: Readonly<Record<string, unknown>>,
  privateKey: NodeCrypto.KeyObject,
): Record<string, unknown> {
  const fields = Object.fromEntries(
    Object.entries(manifest).filter(([name]) => !["kind", "keyId", "signature"].includes(name)),
  );
  const canonical = releaseCanonical(kind, fields);
  if (canonical === null) {
    throw new Error(
      "The manifest has a field that is not plain one-line text; it cannot be signed.",
    );
  }
  const signature = NodeCrypto.sign("sha256", Buffer.from(canonical, "utf8"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  return {
    kind,
    ...fields,
    keyId: publicKeyEncodings(NodeCrypto.createPublicKey(privateKey)).keyId,
    signature: signature.toString("base64"),
  };
}

const KINDS: Readonly<Record<string, ReleaseKind>> = {
  "sync.json": "sync",
  "windows.json": "windows",
  "mac.json": "mac",
  "linux.json": "linux",
};

function kindOf(file: string): ReleaseKind {
  const kind = KINDS[NodePath.basename(file)];
  if (kind === undefined)
    throw new Error(`${file} is not sync.json, windows.json, mac.json or linux.json.`);
  return kind;
}

/** The release key's path; throws when it is not there, so a build stops before it makes anything. */
export function requireReleaseKey(path: string = releaseKeyPath()): string {
  if (!NodeFS.existsSync(path)) {
    throw new Error(
      `No release key at ${path}. Set TINKJAM_RELEASE_KEY to where it is kept; an unsigned manifest must never be published.`,
    );
  }
  return path;
}

const readPrivateKey = (path: string) =>
  NodeCrypto.createPrivateKey(NodeFS.readFileSync(requireReleaseKey(path), "utf8"));

function printPublic(key: NodeCrypto.KeyObject) {
  const encodings = publicKeyEncodings(key);
  console.log(`keyId:                 ${encodings.keyId}`);
  console.log(`SPKI (Node):           ${encodings.spki}`);
  console.log(`ECCPUBLICBLOB (CNG):   ${encodings.cngBlob}`);
  console.log(`raw x||y (CryptoKit):  ${encodings.raw}`);
  console.log(
    Object.hasOwn(RELEASE_PUBLIC_KEYS, encodings.keyId)
      ? "The apps already trust this key."
      : "The apps do not trust this key yet.",
  );
}

/** Signs a manifest in place, then checks it against the keys the apps embed. */
export function signFile(file: string, keyPath: string = releaseKeyPath()) {
  const kind = kindOf(file);
  const manifest: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
  if (typeof manifest !== "object" || manifest === null)
    throw new Error(`${file} is not a JSON object.`);
  const signed = signManifest(kind, manifest as Record<string, unknown>, readPrivateKey(keyPath));
  if (!verifyReleaseSignature(kind, signed)) {
    throw new Error(`The key at ${keyPath} is not one the apps trust; ${file} was not changed.`);
  }
  NodeFS.writeFileSync(file, `${JSON.stringify(signed, null, 2)}\n`);
  console.log(`[sign] Signed ${file} with key ${String(signed.keyId)}`);
}

function main(argv: ReadonlyArray<string>) {
  const [command, file] = argv;
  const keyPath = releaseKeyPath();
  switch (command) {
    case "generate": {
      if (NodeFS.existsSync(keyPath))
        throw new Error(`${keyPath} already exists; nothing was changed.`);
      if (!NodePath.relative(repoRoot, keyPath).startsWith("..")) {
        throw new Error("The release key must live outside the repository.");
      }
      const { privateKey, publicKey } = NodeCrypto.generateKeyPairSync("ec", {
        namedCurve: "P-256",
      });
      NodeFS.mkdirSync(NodePath.dirname(keyPath), { recursive: true });
      NodeFS.writeFileSync(keyPath, privateKey.export({ type: "pkcs8", format: "pem" }), {
        mode: 0o600,
        flag: "wx",
      });
      console.log(`Wrote the private key to ${keyPath}. Back it up somewhere safe and offline.`);
      printPublic(publicKey);
      return;
    }
    case "public":
      printPublic(NodeCrypto.createPublicKey(readPrivateKey(keyPath)));
      return;
    case "sign":
      if (file === undefined) throw new Error("Usage: sign <sync.json|windows.json|mac.json>");
      signFile(file, keyPath);
      return;
    case "verify": {
      if (file === undefined) throw new Error("Usage: verify <sync.json|windows.json|mac.json>");
      const manifest: unknown = JSON.parse(NodeFS.readFileSync(file, "utf8"));
      const ok =
        typeof manifest === "object" &&
        manifest !== null &&
        verifyReleaseSignature(kindOf(file), manifest);
      console.log(ok ? `${file}: signed by a trusted release key` : `${file}: NOT validly signed`);
      process.exitCode = ok ? 0 : 1;
      return;
    }
    default:
      console.log(
        [
          "Usage: node scripts/sign-release.ts generate | public | sign <file> | verify <file>",
          `Release key: ${keyPath} (TINKJAM_RELEASE_KEY). Keep a copy offline: without it no`,
          "update can be signed with this key, and installed apps trust only the embedded keys.",
        ].join("\n"),
      );
  }
}

if (import.meta.main) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
