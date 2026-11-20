const SHARE_ID = /^[A-Za-z0-9-]{8,64}$/;

export const isShareId = (value: string | null): value is string =>
  value !== null && SHARE_ID.test(value);

/**
 * A board's invite credential or session token: `<shareId>.<random>`, so the Worker finds the
 * board without a lookup table. Only its hash is stored.
 */
export function makeSecret(shareId: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const random = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
  return `${shareId}.${random}`;
}

/** A board's view link credential, `<shareId>.v.<random>`; see `isCloudBoardViewCredential`. */
export const makeViewSecret = (shareId: string): string => makeSecret(shareId).replace(".", ".v.");

/** The board a secret names, or null when it is not one of ours. */
export function shareOfSecret(secret: string): string | null {
  const dot = secret.indexOf(".");
  if (dot <= 0 || dot === secret.length - 1) return null;
  const shareId = secret.slice(0, dot);
  return isShareId(shareId) ? shareId : null;
}

export async function hashSecret(secret: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
