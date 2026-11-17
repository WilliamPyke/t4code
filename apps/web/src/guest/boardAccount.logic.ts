import { CLOUD_BOARD_ACCOUNT_CLAIM_MAX, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";

interface LocalShare {
  readonly shareId: string;
  readonly token: string;
  readonly credential?: string | undefined;
  readonly accountId?: string | undefined;
}

/**
 * The cloud boards this browser made or joined while signed out that the account does not list
 * yet, at most one claim's worth. Each is tried once a page load: the host refuses a seat that is
 * another account's, and that stays so.
 */
export function boardsToClaim<TShare extends LocalShare>(input: {
  readonly shares: ReadonlyArray<TShare>;
  readonly listed: ReadonlyArray<{ readonly shareId: string }>;
  readonly tried: ReadonlySet<string>;
  readonly isCloud: (share: TShare) => boolean;
}): ReadonlyArray<TShare> {
  const listed = new Set<string>(input.listed.map((board) => board.shareId));
  return input.shares
    .filter(
      (share) =>
        input.isCloud(share) &&
        share.accountId === undefined &&
        !listed.has(share.shareId) &&
        !input.tried.has(share.shareId),
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
  readonly email?: string | null | undefined;
}

const fitName = (text: string | null | undefined) =>
  text?.trim().replace(/\s+/g, " ").slice(0, GUEST_NAME_MAX_LENGTH).trim() || null;

/**
 * The name a signed-in account joins boards under: its full name, else its first and last name,
 * its username, or its email before the @. Null when the account has none of these.
 */
export const accountDisplayName = (profile: AccountProfile): string | null =>
  fitName(profile.fullName) ??
  fitName([profile.firstName, profile.lastName].filter(Boolean).join(" ")) ??
  fitName(profile.username) ??
  fitName(profile.email?.split("@")[0]);

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
