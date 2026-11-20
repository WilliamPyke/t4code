/**
 * Moving a browser from the app's older address to its current one. Browsers keep storage per
 * address, so the older page hands what it holds (the boards joined signed out, the name, the
 * look) to the current one in the link's fragment, which no server sees.
 */

/** Set on the current address once the older one handed over, or had nothing to. */
export const MOVED_KEY = "tinkjam:moved:v1";
/** The boards handed over, until the boards list takes them in under its own schema. */
export const MOVED_SHARES_KEY = "tinkjam:moved-shares:v1";
/** Per tab: the older address was asked, so a hand-over that never comes is not asked for twice. */
export const ASKED_KEY = "tinkjam:move-asked:v1";

const SHARES_KEY = "t3code:guest-shares:v1";
const HASH_PREFIX = "#moved=";
const CLERK_DEV_BROWSER = "__clerk_db_jwt";
// Small per-browser choices worth keeping. Each is copied only where the new address has none.
const KEPT_KEYS = [
  "t3code:browser-identity:v1",
  "t3code:board-name:v1",
  "t3code:account-names:v1",
  "t3code:board-name-suggestion:v1",
  "t3code:client-settings:v1",
  "t3code:theme",
  "t3code:theme-follow-system",
  "t3code:theme-appearance-mode",
  "t3code:boards-sort:v1",
  "t3code:sign-in-nudge-dismissed:v1",
  "t3code:connect-computer-nudge-dismissed:v1",
] as const;
const KEPT_VALUE_MAX = 8_000;
// Safari's limit on a link is the tightest, near 80,000 characters.
const SHARES_MAX = 40_000;
// New browsers stop asking the older address then: by that time whoever used it has been moved.
const ASKING_ENDS = Date.UTC(2027, 4, 1);

interface MovePayload {
  /** The fragment the link had before this one took its place. */
  readonly hash: string;
  readonly shares: string;
  readonly kept: Readonly<Record<string, string>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function toBase64Url(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(encoded: string): string | null {
  try {
    const binary = atob(encoded.replaceAll("-", "+").replaceAll("_", "/"));
    return new TextDecoder("utf-8", { fatal: true }).decode(
      Uint8Array.from(binary, (char) => char.charCodeAt(0)),
    );
  } catch {
    return null;
  }
}

const lastOpened = (share: Record<string, unknown>) => {
  const at = Date.parse(String(share.openedAt ?? share.joinedAt ?? ""));
  return Number.isFinite(at) ? at : 0;
};

/**
 * The boards worth handing over, most recently opened first, as many as fit. An account's boards
 * stay behind: they come back from the board host once that account signs in.
 */
function sharesToMove(stored: string | null): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stored ?? "[]");
  } catch {
    return "[]";
  }
  if (!Array.isArray(parsed)) return "[]";
  const shares = parsed
    .filter(isRecord)
    .filter((share) => share.accountId === undefined)
    .toSorted((left, right) => lastOpened(right) - lastOpened(left));
  while (shares.length > 0 && JSON.stringify(shares).length > SHARES_MAX) shares.pop();
  return JSON.stringify(shares);
}

/** The fragment that carries what `read` holds, and the link's own fragment, to the new address. */
export function packMove(input: {
  readonly read: (key: string) => string | null;
  readonly hash: string;
}): string {
  const kept: Record<string, string> = {};
  for (const key of KEPT_KEYS) {
    const value = input.read(key);
    if (value !== null && value.length <= KEPT_VALUE_MAX) kept[key] = value;
  }
  const payload: MovePayload = {
    hash: input.hash,
    shares: sharesToMove(input.read(SHARES_KEY)),
    kept,
  };
  return `${HASH_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
}

/** What a fragment made by `packMove` carries, or null for any other fragment. */
export function unpackMove(hash: string): MovePayload | null {
  if (!hash.startsWith(HASH_PREFIX)) return null;
  const text = fromBase64Url(hash.slice(HASH_PREFIX.length));
  if (text === null) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    if (!isRecord(parsed) || typeof parsed.hash !== "string" || typeof parsed.shares !== "string") {
      return null;
    }
    const kept: Record<string, string> = {};
    if (isRecord(parsed.kept)) {
      for (const key of KEPT_KEYS) {
        const value = parsed.kept[key];
        if (typeof value === "string" && value.length <= KEPT_VALUE_MAX) kept[key] = value;
      }
    }
    return { hash: parsed.hash, shares: parsed.shares.slice(0, SHARES_MAX), kept };
  } catch {
    return null;
  }
}

/** A link's search without the sign-in a hand-over carried, for a hand-over that is not taken. */
function withoutSignIn(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(CLERK_DEV_BROWSER);
  const rest = params.toString();
  return rest === "" ? "" : `?${rest}`;
}

function withSignIn(search: string, signIn: string | null): string {
  if (signIn === null) return search;
  const params = new URLSearchParams(search);
  params.set(CLERK_DEV_BROWSER, signIn);
  return `?${params.toString()}`;
}

/** The sign-in a development Clerk instance keeps in a cookie the page can read, if any. */
function clerkDevBrowserOf(cookie: string): string | null {
  for (const part of cookie.split(";")) {
    const [name, ...value] = part.trim().split("=");
    if (name?.startsWith(CLERK_DEV_BROWSER) && value.join("=") !== "") return value.join("=");
  }
  return null;
}

type MoveStep =
  /** Leave for `href`: the older address handing over, or the current one asking it to. */
  | { readonly kind: "go"; readonly href: string; readonly asking: boolean }
  /** A hand-over arrived: show `href` in its place, keep `payload`, and when `done` never ask. */
  | {
      readonly kind: "arrived";
      readonly href: string;
      readonly payload: MovePayload | null;
      readonly done: boolean;
    }
  | { readonly kind: "stay" };

/**
 * What a page of the app does about the move as it loads. `origins` are the app's addresses,
 * `current` the one people are moved to; a page anywhere else stays as it is.
 */
export function moveStep(input: {
  readonly origin: string;
  readonly current: string;
  readonly origins: ReadonlyArray<string>;
  readonly path: string;
  readonly search: string;
  readonly hash: string;
  readonly referrer: string;
  readonly moved: boolean;
  readonly asked: boolean;
  readonly canStore: boolean;
  readonly framed: boolean;
  readonly now: number;
  readonly read: (key: string) => string | null;
  readonly cookie: string;
}): MoveStep {
  const older = input.origins.filter((origin) => origin !== input.current);
  if (!input.origins.includes(input.origin) || older.length === 0 || input.framed) {
    return { kind: "stay" };
  }
  if (input.origin !== input.current) {
    const search = withSignIn(input.search, clerkDevBrowserOf(input.cookie));
    const hash = packMove({ read: input.read, hash: input.hash });
    return { kind: "go", href: `${input.current}${input.path}${search}${hash}`, asking: false };
  }
  const payload = unpackMove(input.hash);
  if (input.hash.startsWith(HASH_PREFIX)) {
    const from = URL.canParse(input.referrer) ? new URL(input.referrer).origin : null;
    // Only our older address may hand over. No referrer proves nothing, so nothing is taken, but
    // the move counts as done; a stranger's link leaves it to be done properly.
    const trusted = from !== null && older.includes(from);
    const taken = trusted && !input.moved ? payload : null;
    const search = taken === null ? withoutSignIn(input.search) : input.search;
    return {
      kind: "arrived",
      href: `${input.path}${search}${payload?.hash ?? ""}`,
      payload: taken,
      done: trusted || from === null,
    };
  }
  if (input.moved || input.asked || !input.canStore || input.now >= ASKING_ENDS) {
    return { kind: "stay" };
  }
  return {
    kind: "go",
    href: `${older[0]}${input.path}${input.search}${input.hash}`,
    asking: true,
  };
}

/**
 * The boards a browser holds after taking in the ones handed over: its own win, and a board on a
 * host this page may not follow is left out. `hostOf` gives the host to keep a board under.
 */
export function mergeMovedShares<Share extends { readonly shareId: string; readonly host: string }>(
  own: ReadonlyArray<Share>,
  moved: ReadonlyArray<Share>,
  hostOf: (host: string) => string | null,
): ReadonlyArray<Share> {
  const held = new Set(own.map((share) => share.shareId));
  const added: Array<Share> = [];
  for (const share of moved) {
    const host = hostOf(share.host);
    if (host === null || held.has(share.shareId)) continue;
    held.add(share.shareId);
    added.push({ ...share, host });
  }
  return added.length === 0 ? own : [...own, ...added];
}
