import { describe, expect, it } from "vite-plus/test";

import { clerkKeys, verifyClerkSession, type ClerkCheck } from "./clerk.ts";

const ISSUER = "https://example-instance.clerk.accounts.dev";
const NOW_S = 1_800_000_000;
const RS256 = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

const keyPair = await crypto.subtle.generateKey(
  { ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true,
  ["sign", "verify"],
);
const otherPair = await crypto.subtle.generateKey(
  { ...RS256, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true,
  ["sign", "verify"],
);

const base64Url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
const part = (value: unknown) => base64Url(new TextEncoder().encode(JSON.stringify(value)));

async function tokenOf(
  claims: Record<string, unknown>,
  options: { readonly kid?: string; readonly alg?: string; readonly key?: CryptoKey } = {},
) {
  const signed = `${part({ alg: options.alg ?? "RS256", kid: options.kid ?? "key-1", typ: "JWT" })}.${part(claims)}`;
  const signature = await crypto.subtle.sign(
    RS256,
    options.key ?? keyPair.privateKey,
    new TextEncoder().encode(signed),
  );
  return `${signed}.${base64Url(new Uint8Array(signature))}`;
}

const session = {
  iss: ISSUER,
  sub: "user_ada",
  azp: "https://app.trellium.org",
  sid: "sess_1",
  iat: NOW_S - 5,
  nbf: NOW_S - 5,
  exp: NOW_S + 55,
};

const check: ClerkCheck = {
  issuer: ISSUER,
  allowedOrigins: ["https://app.trellium.org", "http://localhost:5733"],
  now: NOW_S,
  keyFor: async (kid) => (kid === "key-1" ? keyPair.publicKey : null),
};

describe("Clerk session tokens", () => {
  it("gives the account of a valid session, made for an allowed page or none named", async () => {
    expect(await verifyClerkSession(await tokenOf(session), check)).toBe("user_ada");
    const { azp: _, ...noAzp } = session;
    expect(await verifyClerkSession(await tokenOf(noAzp), check)).toBe("user_ada");
  });

  it.each([
    ["another issuer", { ...session, iss: "https://evil.example" }],
    ["an expired session", { ...session, exp: NOW_S - 60 }],
    ["a session not valid yet", { ...session, nbf: NOW_S + 60 }],
    ["a session made for another page", { ...session, azp: "https://evil.example" }],
    ["no user", { ...session, sub: "" }],
    ["no expiry", { ...session, exp: undefined }],
  ])("refuses %s", async (_, claims) => {
    expect(await verifyClerkSession(await tokenOf(claims), check)).toBeNull();
  });

  it("refuses a token signed by another key, an unknown key, another algorithm, or changed", async () => {
    expect(
      await verifyClerkSession(await tokenOf(session, { key: otherPair.privateKey }), check),
    ).toBeNull();
    expect(await verifyClerkSession(await tokenOf(session, { kid: "key-2" }), check)).toBeNull();
    expect(await verifyClerkSession(await tokenOf(session, { alg: "HS256" }), check)).toBeNull();
    const [header, , signature] = (await tokenOf(session)).split(".");
    const forged = `${header}.${part({ ...session, sub: "user_eve" })}.${signature}`;
    expect(await verifyClerkSession(forged, check)).toBeNull();
    expect(await verifyClerkSession("", check)).toBeNull();
    expect(await verifyClerkSession("not.a.token", check)).toBeNull();
  });

  it("reads keys from the instance's published set, fetching again for an unknown key at most once a minute", async () => {
    const jwk = { ...(await crypto.subtle.exportKey("jwk", keyPair.publicKey)), kid: "key-1" };
    const asked: Array<string> = [];
    const fetcher = (async (url: string) => {
      asked.push(url);
      return Response.json({ keys: [jwk] });
    }) as typeof fetch;
    const keyFor = clerkKeys(ISSUER, fetcher);
    const token = await tokenOf(session);
    expect(await verifyClerkSession(token, { ...check, keyFor })).toBe("user_ada");
    expect(await verifyClerkSession(token, { ...check, keyFor })).toBe("user_ada");
    expect(await keyFor("key-unknown")).toBeNull();
    expect(asked).toEqual([`${ISSUER}/.well-known/jwks.json`]);
  });
});
