// @effect-diagnostics globalDate:off - Plain Cloudflare code, outside the Effect runtime.
/**
 * Verifies a Clerk session token with nothing but the instance's public keys, which its Frontend
 * API publishes at `<issuer>/.well-known/jwks.json`. No Clerk secret is needed.
 */

export type ClerkKeyLookup = (kid: string) => Promise<CryptoKey | null>;

export interface ClerkCheck {
  /** The instance's Frontend API origin, which every session token names as `iss`. */
  readonly issuer: string;
  /** Pages allowed to call the host; a token made for another page (`azp`) is refused. */
  readonly allowedOrigins: ReadonlyArray<string>;
  /** Epoch seconds. */
  readonly now: number;
  readonly keyFor: ClerkKeyLookup;
}

// Clerk's session tokens live a minute; a little skew between clocks is allowed.
const CLOCK_SKEW_S = 10;
const MAX_TOKEN_CHARS = 8 * 1024;
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

const base64UrlBytes = (part: string): Uint8Array<ArrayBuffer> | null => {
  try {
    const padded = part.replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
};

const jsonOf = (part: string): Record<string, unknown> | null => {
  const bytes = base64UrlBytes(part);
  if (bytes === null) return null;
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};

/** The Clerk user id a session token is for, or null when it is not a valid one of ours. */
export async function verifyClerkSession(token: string, check: ClerkCheck): Promise<string | null> {
  if (token.length === 0 || token.length > MAX_TOKEN_CHARS) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];
  const header = jsonOf(headerPart);
  const claims = jsonOf(payloadPart);
  const signature = base64UrlBytes(signaturePart);
  if (header === null || claims === null || signature === null) return null;
  if (header.alg !== "RS256" || typeof header.kid !== "string") return null;
  const key = await check.keyFor(header.kid);
  if (key === null) return null;
  const signed = new TextEncoder().encode(`${headerPart}.${payloadPart}`);
  const valid = await crypto.subtle.verify(RS256, key, signature, signed).catch(() => false);
  if (!valid) return null;
  const { iss, sub, exp, nbf, azp } = claims;
  if (iss !== check.issuer) return null;
  if (typeof exp !== "number" || exp + CLOCK_SKEW_S < check.now) return null;
  if (nbf !== undefined && (typeof nbf !== "number" || nbf - CLOCK_SKEW_S > check.now)) return null;
  if (azp !== undefined && (typeof azp !== "string" || !check.allowedOrigins.includes(azp))) {
    return null;
  }
  return typeof sub === "string" && sub !== "" ? sub : null;
}

// Keys rotate rarely; an unknown key id fetches again, at most this often.
const KEYS_TTL_MS = 60 * 60_000;
const KEYS_REFETCH_MS = 60_000;

/** Looks keys up in the instance's published set, kept for an hour. */
export function clerkKeys(issuer: string, fetcher: typeof fetch = fetch): ClerkKeyLookup {
  let keys = new Map<string, CryptoKey>();
  let fetchedAt = Number.NEGATIVE_INFINITY;
  let pending: Promise<void> | null = null;
  const refresh = async () => {
    const response = await fetcher(`${issuer}/.well-known/jwks.json`);
    if (!response.ok) throw new Error(`Clerk keys answered ${response.status}.`);
    const body = (await response.json()) as { readonly keys?: ReadonlyArray<JsonWebKey> };
    const next = new Map<string, CryptoKey>();
    for (const jwk of body.keys ?? []) {
      const kid = (jwk as { readonly kid?: unknown }).kid;
      if (jwk.kty !== "RSA" || typeof kid !== "string") continue;
      next.set(kid, await crypto.subtle.importKey("jwk", jwk, RS256, false, ["verify"]));
    }
    keys = next;
    fetchedAt = Date.now();
  };
  return async (kid) => {
    const fresh = Date.now() - fetchedAt < KEYS_TTL_MS;
    if (fresh && keys.has(kid)) return keys.get(kid) ?? null;
    if (Date.now() - fetchedAt >= KEYS_REFETCH_MS) {
      pending ??= refresh().finally(() => {
        pending = null;
      });
      // Unreachable keys refuse the token; the next request tries again.
      await pending.catch(() => undefined);
    }
    return keys.get(kid) ?? null;
  };
}
