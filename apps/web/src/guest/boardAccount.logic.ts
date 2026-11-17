import { CLOUD_BOARD_ACCOUNT_CLAIM_MAX } from "@t3tools/contracts";

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
