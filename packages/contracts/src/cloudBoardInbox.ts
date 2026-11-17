import * as Schema from "effect/Schema";

import { GuestShareId, IsoDateTime, ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { CLOUD_BOARD_ACCOUNT_ROUTE } from "./cloudBoardAccount.ts";
import { GuestRedeemRequest, RoomTaskPriority, RoomTaskStatus } from "./guestShare.ts";

/**
 * A signed-in person's inbox: what brings them back to a board. Cloud boards write it into the
 * account when a change is taken; nothing here reaches anyone's agent. Every route is signed with
 * the account's Clerk session token as the bearer, and an account reads only its own.
 *
 * `GET` reads the inbox, newest first.
 */
export const CLOUD_INBOX_ROUTE = `${CLOUD_BOARD_ACCOUNT_ROUTE}/inbox`;
/** `GET`: how many are unread, and on which boards, read often and cheaply. */
export const CLOUD_INBOX_COUNT_ROUTE = `${CLOUD_INBOX_ROUTE}/count`;
/** `POST`: marks some read, or all of them. */
export const CLOUD_INBOX_READ_ROUTE = `${CLOUD_INBOX_ROUTE}/read`;
/** `GET`: every task given to the account, across its boards. */
export const CLOUD_MY_TASKS_ROUTE = `${CLOUD_BOARD_ACCOUNT_ROUTE}/tasks`;
/** `?share=`: `POST` asks the board's maker for edit access. */
export const CLOUD_BOARD_ACCESS_ROUTE = `${CLOUD_BOARD_ACCOUNT_ROUTE}/access`;
/** `?share=`: `POST` approves or declines a request, for whoever manages the board. */
export const CLOUD_BOARD_ACCESS_ANSWER_ROUTE = `${CLOUD_BOARD_ACCESS_ROUTE}/answer`;

/** Items one inbox keeps; the oldest go first past it. */
export const CLOUD_INBOX_MAX_ITEMS = 200;
/** Items older than this go. */
export const CLOUD_INBOX_KEEP_DAYS = 30;
export const CLOUD_INBOX_EXCERPT_MAX_LENGTH = 140;
export const CLOUD_ACCESS_MESSAGE_MAX_LENGTH = 140;

/**
 * `mention`: named you with `@`. `assign`: gave you a task. `reply`: replied to your comment.
 * `access-request`: asked to edit a board you manage. `access-answer`: your request was answered.
 * `access-changed`: what you can do on a board or in a workspace changed.
 */
export const CloudInboxKind = Schema.Literals([
  "mention",
  "assign",
  "reply",
  "access-request",
  "access-answer",
  "access-changed",
]);
export type CloudInboxKind = typeof CloudInboxKind.Type;

/** What someone may now do: on a board, edit or view; in a workspace, owner or member. */
export const CloudInboxRole = Schema.Literals(["edit", "view", "owner", "member"]);
export type CloudInboxRole = typeof CloudInboxRole.Type;

export const CloudInboxItem = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(96)),
  kind: CloudInboxKind,
  at: IsoDateTime,
  read: Schema.optional(Schema.Literal(true)),
  /** Who did it, as the board or workspace names them. */
  by: Schema.String,
  /** The board's or the workspace's name. */
  title: Schema.String,
  shareId: Schema.optional(GuestShareId),
  threadId: Schema.optional(ThreadId),
  /** The workspace the board is in, so a member not on it yet can open it. */
  workspaceId: Schema.optional(TrimmedNonEmptyString),
  /** The start of what was written. */
  excerpt: Schema.optional(Schema.String.check(Schema.isMaxLength(CLOUD_INBOX_EXCERPT_MAX_LENGTH))),
  /** The card to show. */
  noteId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  /** The card is a task: it opens in the Plan. */
  task: Schema.optional(Schema.Literal(true)),
  /** An access request, for whoever manages the board, and where it stands. */
  request: Schema.optional(
    Schema.Struct({
      id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
      status: Schema.Literals(["open", "approved", "declined"]),
    }),
  ),
  role: Schema.optional(CloudInboxRole),
  /** An answered request: whether it was approved. */
  approved: Schema.optional(Schema.Boolean),
});
export type CloudInboxItem = typeof CloudInboxItem.Type;

export const CloudInbox = Schema.Struct({
  items: Schema.Array(CloudInboxItem),
  unread: Schema.Number,
});
export type CloudInbox = typeof CloudInbox.Type;

export const CloudInboxCount = Schema.Struct({
  unread: Schema.Number,
  /** The boards with something unread. */
  boards: Schema.Array(Schema.String),
});
export type CloudInboxCount = typeof CloudInboxCount.Type;

/** `all` marks every item read; otherwise only `ids`. */
export const CloudInboxReadRequest = Schema.Struct({
  ids: Schema.optional(
    Schema.Array(TrimmedNonEmptyString).check(Schema.isMaxLength(CLOUD_INBOX_MAX_ITEMS)),
  ),
  all: Schema.optional(Schema.Literal(true)),
});
export type CloudInboxReadRequest = typeof CloudInboxReadRequest.Type;

export const CloudBoardAccessRequest = Schema.Struct({
  /** How the maker sees who asks. */
  name: GuestRedeemRequest.fields.name,
  message: Schema.optional(
    Schema.String.check(Schema.isMaxLength(CLOUD_ACCESS_MESSAGE_MAX_LENGTH)),
  ),
  /** The view link the page was opened with, for someone not on the board. */
  credential: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
});
export type CloudBoardAccessRequest = typeof CloudBoardAccessRequest.Type;

/** The request's id, which the asking page watches for in the board's `granted`. */
export const CloudBoardAccessResult = Schema.Struct({ request: TrimmedNonEmptyString });
export type CloudBoardAccessResult = typeof CloudBoardAccessResult.Type;

export const CloudBoardAccessAnswer = Schema.Struct({
  request: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  approve: Schema.Boolean,
});
export type CloudBoardAccessAnswer = typeof CloudBoardAccessAnswer.Type;

/** A task given to the account, as its board last said. */
export const CloudMyTask = Schema.Struct({
  shareId: GuestShareId,
  threadId: ThreadId,
  /** The board's name. */
  title: Schema.String,
  workspaceId: Schema.optional(TrimmedNonEmptyString),
  noteId: TrimmedNonEmptyString,
  text: Schema.String,
  status: RoomTaskStatus,
  priority: Schema.optional(RoomTaskPriority),
  due: Schema.optional(Schema.String),
});
export type CloudMyTask = typeof CloudMyTask.Type;

export const CloudMyTasks = Schema.Struct({ tasks: Schema.Array(CloudMyTask) });
export type CloudMyTasks = typeof CloudMyTasks.Type;
