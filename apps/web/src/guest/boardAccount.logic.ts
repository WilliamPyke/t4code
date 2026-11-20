import { CLOUD_BOARD_ACCOUNT_CLAIM_MAX, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";

interface LocalShare {
  readonly shareId: string;
  readonly token: string;
  readonly credential?: string | undefined;
  readonly accountId?: string | undefined;
}

/**
 * The cloud boards this browser made or joined while signed out, at most one claim's worth: the
 * host makes each seat the account's, folding it into the seat the account already has there.
 * Each is tried once a page load: the host refuses a seat that is another account's.
 */
export function boardsToClaim<TShare extends LocalShare>(input: {
  readonly shares: ReadonlyArray<TShare>;
  readonly tried: ReadonlySet<string>;
  readonly isCloud: (share: TShare) => boolean;
}): ReadonlyArray<TShare> {
  return input.shares
    .filter(
      (share) =>
        input.isCloud(share) && share.accountId === undefined && !input.tried.has(share.shareId),
    )
    .slice(0, CLOUD_BOARD_ACCOUNT_CLAIM_MAX);
}

/**
 * The boards this browser keeps only because an account that is no longer signed in here opened
 * them. `userId` is who is signed in now, or null.
 */
export const sharesOfOtherAccounts = (
  shares: ReadonlyArray<Pick<LocalShare, "shareId" | "accountId">>,
  userId: string | null,
): ReadonlyArray<string> =>
  shares
    .filter((share) => share.accountId !== undefined && share.accountId !== userId)
    .map((share) => share.shareId);

interface AccountProfile {
  readonly fullName?: string | null | undefined;
  readonly firstName?: string | null | undefined;
  readonly lastName?: string | null | undefined;
  readonly username?: string | null | undefined;
  /** The name the account saved where its sign-in settings keep no first or last name. */
  readonly savedName?: string | null | undefined;
}

const fitName = (text: string | null | undefined) =>
  text?.trim().replace(/\s+/g, " ").slice(0, GUEST_NAME_MAX_LENGTH).trim() || null;

/**
 * The name a signed-in account joins boards under, and whether it is one the account has: its
 * full name, else its first and last name, else the name it saved; then its username. Only ever
 * the account's own: never a name this browser kept, which may be someone else's, and never
 * anything from its email, which others would see.
 */
export function accountDisplayName(profile: AccountProfile): {
  readonly name: string | null;
  readonly real: boolean;
} {
  const real =
    fitName(profile.fullName) ??
    fitName([profile.firstName, profile.lastName].filter(Boolean).join(" ")) ??
    fitName(profile.savedName);
  if (real !== null) return { name: real, real: true };
  return { name: fitName(profile.username), real: false };
}

/**
 * Who has used this browser, for the names it shows. `name` is the one typed while signed out
 * since an account last signed out here; `accounts` are the accounts that ever signed in here;
 * `current` is the one signed in when this browser last looked.
 */
export interface BrowserIdentity {
  readonly name: string | null;
  readonly accounts: ReadonlyArray<string>;
  readonly current: string | null;
}

/**
 * The name "What should we call you?" starts with for `userId`: the one typed signed out here,
 * and only while no other account has ever signed in on this browser.
 */
export const accountNameSeed = (identity: BrowserIdentity, userId: string): string | null =>
  identity.accounts.every((account) => account === userId) ? fitName(identity.name) : null;

/**
 * The one name a person goes by here, and what a name field starts with while they have none.
 * `account` is who is signed in (null: nobody): then only the account's own name is known, never
 * one this browser kept. `suggestion` is this browser's friendly name, only for someone signed
 * out: an account is never offered a made-up name, so it starts empty.
 */
export function resolveBoardName(input: {
  readonly account: { readonly name: string | null; readonly seed: string | null } | null;
  readonly signedOutName: string | null;
  readonly suggestion: string;
}): { readonly known: string | null; readonly suggested: string } {
  const known = input.account === null ? fitName(input.signedOutName) : fitName(input.account.name);
  if (known !== null) return { known, suggested: known };
  if (input.account === null) return { known, suggested: input.suggestion };
  return { known, suggested: fitName(input.account.seed) ?? "" };
}

/**
 * This browser after `signedIn` (null: nobody) is seen signed in, and whether the last account's
 * things must go from it: on sign-out or a switch, so the next person sees nothing of theirs,
 * its signed-out name included.
 */
export function browserAfterSignIn(
  identity: BrowserIdentity,
  signedIn: string | null,
): { readonly identity: BrowserIdentity; readonly clear: boolean } {
  if (identity.current === signedIn) return { identity, clear: false };
  const accounts =
    signedIn === null || identity.accounts.includes(signedIn)
      ? identity.accounts
      : [...identity.accounts, signedIn].slice(-20);
  const clear = identity.current !== null;
  return {
    identity: { name: clear ? null : identity.name, accounts, current: signedIn },
    clear,
  };
}

/**
 * The people a list should tell apart: everyone sharing a name with someone else in it, so
 * People can add what tells them apart.
 */
export function sharedNameIds<TPerson extends { readonly id: string; readonly name: string }>(
  people: ReadonlyArray<TPerson>,
): ReadonlySet<string> {
  const counts = new Map<string, number>();
  const key = (person: TPerson) => person.name.trim().toLocaleLowerCase();
  for (const person of people) counts.set(key(person), (counts.get(key(person)) ?? 0) + 1);
  return new Set(
    people.filter((person) => (counts.get(key(person)) ?? 0) > 1).map((person) => person.id),
  );
}

/** A typed name as the account keeps it: the last word as the last name, the rest as the first. */
export function accountNameParts(name: string): {
  readonly firstName: string;
  readonly lastName: string;
} {
  const words = (fitName(name) ?? "").split(" ").filter((word) => word !== "");
  if (words.length < 2) return { firstName: words[0] ?? "", lastName: "" };
  return { firstName: words.slice(0, -1).join(" "), lastName: words.at(-1)! };
}

const FRIENDLY_WORDS = [
  "Bright",
  "Calm",
  "Clever",
  "Curious",
  "Gentle",
  "Happy",
  "Kind",
  "Lucky",
  "Quick",
  "Sunny",
  "Swift",
  "Witty",
];
const FRIENDLY_ANIMALS = [
  "Badger",
  "Dolphin",
  "Falcon",
  "Fox",
  "Heron",
  "Koala",
  "Lynx",
  "Otter",
  "Owl",
  "Panda",
  "Puffin",
  "Robin",
];

/** A name someone can keep or type over before anyone sees them, such as "Curious Otter". */
export function friendlyName(pick: (count: number) => number): string {
  const word = FRIENDLY_WORDS[pick(FRIENDLY_WORDS.length) % FRIENDLY_WORDS.length]!;
  const animal = FRIENDLY_ANIMALS[pick(FRIENDLY_ANIMALS.length) % FRIENDLY_ANIMALS.length]!;
  return `${word} ${animal}`;
}
