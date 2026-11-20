import * as Schema from "effect/Schema";

import { GuestId, GuestShareId, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { CLOUD_BOARD_ROUTE } from "./guestShare.ts";

/**
 * An account's cloud boards, the same list on every device. Signed with the account's Clerk
 * session token as the bearer, which the host verifies itself. `GET` lists them; `DELETE` with
 * `?share=<share id>` leaves that board and takes it off the list.
 */
export const CLOUD_BOARD_ACCOUNT_ROUTE = `${CLOUD_BOARD_ROUTE}/account`;
/** Adds boards this browser holds a session for to the account. Taking one twice changes nothing. */
export const CLOUD_BOARD_ACCOUNT_CLAIM_ROUTE = `${CLOUD_BOARD_ACCOUNT_ROUTE}/claim`;
/** `?share=<share id>`: a new session on a board of the account's, as the same person on it. */
export const CLOUD_BOARD_ACCOUNT_OPEN_ROUTE = `${CLOUD_BOARD_ACCOUNT_ROUTE}/open`;

/** As many boards as one claim takes; a browser with more claims again for the rest. */
export const CLOUD_BOARD_ACCOUNT_CLAIM_MAX = 25;
/** As many boards as one account lists; the oldest added goes first past it. */
export const CLOUD_BOARD_ACCOUNT_MAX_BOARDS = 500;

/**
 * The longest board preview the host keeps: a few dozen of the board's cards as kind, place,
 * size and paint, without any of their text. `@t3tools/shared/boardPreview` writes and reads it.
 */
export const CLOUD_BOARD_PREVIEW_MAX_CHARS = 640;
export const CloudBoardPreview = Schema.String.check(
  Schema.isMaxLength(CLOUD_BOARD_PREVIEW_MAX_CHARS),
);

export const CloudBoardAccountBoard = Schema.Struct({
  shareId: GuestShareId,
  threadId: ThreadId,
  title: Schema.String,
  /** Who the account is on the board. */
  guestId: GuestId,
  /** Whether the account made the board, rather than joined it from a link. */
  maker: Schema.Boolean,
  addedAt: Schema.String,
  /** The board's invite, so the account can invite others from any device. */
  credential: Schema.optional(TrimmedNonEmptyString),
  /** A small map of its cards for its tile on the home, once the board has changed. */
  preview: Schema.optional(CloudBoardPreview),
});
export type CloudBoardAccountBoard = typeof CloudBoardAccountBoard.Type;

export const CloudBoardAccountList = Schema.Struct({
  boards: Schema.Array(CloudBoardAccountBoard),
});
export type CloudBoardAccountList = typeof CloudBoardAccountList.Type;

export const CloudBoardAccountClaimRequest = Schema.Struct({
  boards: Schema.Array(
    Schema.Struct({
      /** This browser's session on the board, which names the board and proves the seat. */
      token: TrimmedNonEmptyString,
      /** The invite this browser keeps, taken only when it is the board's. */
      credential: Schema.optional(TrimmedNonEmptyString),
    }),
  ).check(Schema.isMaxLength(CLOUD_BOARD_ACCOUNT_CLAIM_MAX)),
});
export type CloudBoardAccountClaimRequest = typeof CloudBoardAccountClaimRequest.Type;

/** A session on one of the account's boards, as a redeem answers, and what the list keeps of it. */
export const CloudBoardAccountOpenResult = Schema.Struct({
  token: TrimmedNonEmptyString,
  board: CloudBoardAccountBoard,
});
export type CloudBoardAccountOpenResult = typeof CloudBoardAccountOpenResult.Type;
