// @effect-diagnostics nodeBuiltinImport:off - Plain Node beside the launcher: it verifies with node:crypto before any server code runs.
// Tinkjam Sync's check for a newer copy of itself. Plain TypeScript importing only Node built-ins:
// the build strips its types into bin/update-check.mjs, beside the launcher that runs it.
import * as NodeCrypto from "node:crypto";

/**
 * Release keys every Tinkjam Sync trusts, by keyId: SPKI (DER, base64) of an ECDSA P-256 key.
 * The second is held back for rotation. The same keys are in the tinkjam-sync repository (ReleaseSignature.cs,
 * ReleaseSignature.swift, signature.rs); `node scripts/sign-release.ts public` prints them.
 */
export const RELEASE_PUBLIC_KEYS: Readonly<Record<string, string>> = {
  ef314cdf2274b761:
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEOWhWhpaREXvpaUlBj0bCM9JZ0wmuarNs1D1LCKJXKb+yrCM9kSXnUGHkEzKVj5uSerr38r8Si488l03ltzl7wg==",
  abba1fb4c21713ca:
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEUgGkI4A4huZQzmxgXfcRXLA3KsIB8/5kojMQOJRjVwVA4RQjHk8lQD7KvVZclEoPdjM1oUD2fTy7cwW+1zmh3w==",
};

export type ReleaseKind = "sync" | "windows" | "mac" | "linux";

const SIGNED_FIELDS = ["version", "build", "url", "sha256", "minimumSystemVersion"] as const;

/**
 * The exact text a release signature covers. A missing or null field is empty; anything else that
 * is not a string, or holds a line break, has no canonical form and so can never verify.
 */
export function releaseCanonical(kind: ReleaseKind, manifest: object): string | null {
  const lines = ["tinkjam-release-v1", `kind=${kind}`];
  for (const field of SIGNED_FIELDS) {
    const value: unknown = Reflect.get(manifest, field) ?? "";
    if (typeof value !== "string" || /[\r\n]/.test(value)) return null;
    lines.push(`${field}=${value}`);
  }
  return lines.join("\n");
}

/** Whether one of `keys` signed this manifest (`keyId`, `signature`: raw r||s, base64). */
export function verifyReleaseSignature(
  kind: ReleaseKind,
  manifest: object,
  keys: Readonly<Record<string, string>> = RELEASE_PUBLIC_KEYS,
): boolean {
  const keyId: unknown = Reflect.get(manifest, "keyId");
  const signature: unknown = Reflect.get(manifest, "signature");
  const canonical = releaseCanonical(kind, manifest);
  if (typeof keyId !== "string" || typeof signature !== "string" || canonical === null)
    return false;
  const spki = Object.hasOwn(keys, keyId) ? keys[keyId] : undefined;
  const raw = Buffer.from(signature, "base64");
  if (spki === undefined || raw.length !== 64) return false;
  try {
    const key = NodeCrypto.createPublicKey({
      key: Buffer.from(spki, "base64"),
      format: "der",
      type: "spki",
    });
    return NodeCrypto.verify(
      "sha256",
      Buffer.from(canonical, "utf8"),
      { key, dsaEncoding: "ieee-p1363" },
      raw,
    );
  } catch {
    return false;
  }
}

/** sync.json, published beside the tarball: the newest version and the tarball's stable URL. */
export interface SyncRelease {
  readonly version: string;
  readonly url: string;
}

// `<server version>+<UTC build time as yyyymmddhhmm>`, so every build is newer than the last.
const VERSION = /^(\d+)\.(\d+)\.(\d+)(?:\+(\d{12}))?$/;

/** The version a build at `builtAt` (an ISO time in UTC) carries. */
export function syncVersion(serverVersion: string, builtAt: string): string {
  const stamp = builtAt.replace(/\D/g, "").slice(0, 12);
  return `${serverVersion}+${stamp}`;
}

/** Whether `latest` is newer than `own`. Anything unreadable counts as not newer. */
export function isNewerSync(own: string, latest: string): boolean {
  const mine = VERSION.exec(own);
  const theirs = VERSION.exec(latest);
  if (mine === null || theirs === null) return false;
  for (let part = 1; part <= 3; part += 1) {
    const difference = Number(theirs[part]) - Number(mine[part]);
    if (difference !== 0) return difference > 0;
  }
  return (theirs[4] ?? "") > (mine[4] ?? "");
}

/**
 * The command that runs the newest copy. npx keeps the first copy it downloaded from a URL and
 * runs that again, so the version goes in the URL: a URL npx has not seen downloads afresh.
 */
const syncUpdateCommand = (release: SyncRelease): string =>
  `npx -y ${release.url}?v=${encodeURIComponent(release.version)}`;

/**
 * What to tell the person when a newer copy is out, or null. With `install`, the copy to update
 * is the one in the background, which `--install` replaces.
 */
export function syncUpdateNotice(
  own: string,
  release: SyncRelease | null,
  options?: { readonly install?: boolean },
): string | null {
  if (release === null || !isNewerSync(own, release.version)) return null;
  return options?.install === true
    ? [
        "A newer Tinkjam Sync is out. To run it in the background instead of this one, run:",
        "",
        `  ${syncUpdateCommand(release)} --install`,
        "",
      ].join("\n")
    : [
        "A newer Tinkjam Sync is out. To use it, press Ctrl+C, then run:",
        "",
        `  ${syncUpdateCommand(release)}`,
        "",
      ].join("\n");
}

const isRelease = (value: unknown): value is SyncRelease =>
  typeof value === "object" &&
  value !== null &&
  "version" in value &&
  "url" in value &&
  typeof value.version === "string" &&
  typeof value.url === "string" &&
  /^https:\/\/\S+$/.test(value.url);

/** Reads sync.json, or null when it is slow, missing, unsigned or not what it should be. */
export async function readSyncRelease(
  manifestUrl: string,
  timeoutMs: number,
  fetchRelease: (url: string, init: RequestInit) => Promise<Response> = fetch,
  keys: Readonly<Record<string, string>> = RELEASE_PUBLIC_KEYS,
): Promise<SyncRelease | null> {
  try {
    const response = await fetchRelease(manifestUrl, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isRelease(body) && verifyReleaseSignature("sync", body, keys)
      ? { version: body.version, url: body.url }
      : null;
  } catch {
    return null;
  }
}
