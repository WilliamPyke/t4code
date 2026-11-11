import * as Schema from "effect/Schema";

import { ChatAttachment } from "./chatAttachment.ts";
import {
  GuestId,
  GuestMessageId,
  GuestShareId,
  IsoDateTime,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

/**
 * A guest share lets a few unauthenticated browsers watch a thread over T3 Connect and propose
 * messages the owner must send or dismiss. The thread projection holds this public state; the
 * credentials are derived from the share id with a server key and never stored.
 */
export const GUEST_SHARE_TTL_MS = 24 * 60 * 60 * 1000;
/** How many people one link lets in. */
export const GUEST_SHARE_MAX_GUESTS = 8;
export const GUEST_MESSAGE_MAX_LENGTH = 4_000;
export const GUEST_NAME_MAX_LENGTH = 40;
/** Waiting messages one guest can have. */
export const GUEST_PENDING_MESSAGE_LIMIT = 3;
/** Resolved messages kept so the guest can see what happened to what they sent. */
export const GUEST_RESOLVED_MESSAGE_LIMIT = 20;
/** Files a guest can attach to one message, and their total size. */
export const GUEST_MESSAGE_MAX_ATTACHMENTS = 4;
export const GUEST_MESSAGE_MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** Total size of the files in a share's waiting messages, so a guest cannot fill the disk. */
export const GUEST_PENDING_ATTACHMENT_BYTES_LIMIT = 20 * 1024 * 1024;

/** A turn a guest ran on their own machine, as the room shows it. Text only, cut to these. */
export const GUEST_TURN_PROMPT_MAX_LENGTH = 2_000;
export const GUEST_TURN_REPLY_MAX_LENGTH = 8_000;
/** Guests' own turns a share keeps, newest last, so the thread record stays small. */
export const GUEST_TURN_LIMIT = 10;

/** One catch-up from a room: how many messages, how long each, and how much in all. */
export const ROOM_UPDATES_MAX_MESSAGES = 50;
export const ROOM_UPDATE_MAX_LENGTH = 8_000;
export const ROOM_UPDATES_MAX_CHARS = 48_000;

export const ThreadGuestMessageStatus = Schema.Literals(["pending", "sent", "dismissed"]);
export type ThreadGuestMessageStatus = typeof ThreadGuestMessageStatus.Type;

export const ThreadGuestMessage = Schema.Struct({
  id: GuestMessageId,
  text: Schema.String,
  status: ThreadGuestMessageStatus,
  submittedAt: IsoDateTime,
  /** The thread's attachments, deleted if the message is dismissed. Absent on older messages. */
  attachments: Schema.optional(Schema.Array(ChatAttachment)),
  /** Who wrote it. Absent on a link made before several guests could join. */
  guestId: Schema.optional(GuestId),
  /** Went to the agent without the owner reading it, because its author was trusted then. */
  direct: Schema.optional(Schema.Boolean),
});
export type ThreadGuestMessage = typeof ThreadGuestMessage.Type;

/**
 * One turn a guest ran in their own T3 Code after joining from the room: their prompt and their
 * agent's final reply. The room only shows it. It never starts a turn here and never reaches the
 * owner's agent.
 */
export const ThreadGuestTurn = Schema.Struct({
  /** The guest's machine names the turn, so a repeated post is recorded once. */
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  guestId: GuestId,
  prompt: Schema.String.check(Schema.isMaxLength(GUEST_TURN_PROMPT_MAX_LENGTH)),
  reply: Schema.String.check(Schema.isMaxLength(GUEST_TURN_REPLY_MAX_LENGTH)),
  /** The prompt or the reply was longer than the room keeps. */
  truncated: Schema.optional(Schema.Boolean),
  postedAt: IsoDateTime,
});
export type ThreadGuestTurn = typeof ThreadGuestTurn.Type;

/** The GitHub account a guest signed in with. The id stays the same when the login changes. */
export const GuestAccount = Schema.Struct({ login: TrimmedNonEmptyString, id: Schema.Number });
export type GuestAccount = typeof GuestAccount.Type;

/**
 * Someone whose messages the owner lets through on every link they join signed in. The id is
 * filled in the first time they sign in, so a login someone else takes later does not match.
 */
export const GuestContributor = Schema.Struct({
  login: TrimmedNonEmptyString,
  id: Schema.optional(Schema.Number),
});
export type GuestContributor = typeof GuestContributor.Type;

export const guestContributorFor = (
  contributors: ReadonlyArray<GuestContributor>,
  account: GuestAccount,
): GuestContributor | undefined =>
  contributors.find(
    (contributor) =>
      contributor.login.toLowerCase() === account.login.toLowerCase() &&
      (contributor.id === undefined || contributor.id === account.id),
  );

export const ThreadGuest = Schema.Struct({
  id: GuestId,
  name: TrimmedNonEmptyString,
  joinedAt: IsoDateTime,
  /** Set once the guest signs in, so the owner knows who they are beyond a typed name. */
  account: Schema.optional(GuestAccount),
  /** The owner lets this guest's messages reach the agent without sending each one. */
  trusted: Schema.optional(Schema.Boolean),
});
export type ThreadGuest = typeof ThreadGuest.Type;

/**
 * Whether a guest's message may reach this provider without the owner sending it. A plan sign-in
 * covers only the account holder's own prompts, so only an API key qualifies. A driver not named
 * here has not been checked, and keeps the owner's Send.
 */
export const providerAllowsDirectGuestSend = (
  provider:
    | {
        readonly driver: string;
        readonly auth: { readonly status: string; readonly type?: string | undefined };
      }
    | undefined,
): boolean =>
  provider !== undefined &&
  (provider.driver === "claudeAgent" || provider.driver === "codex") &&
  provider.auth.status === "authenticated" &&
  provider.auth.type === "apiKey";

export const ThreadGuestShare = Schema.Struct({
  id: GuestShareId,
  /** The T3 Connect tunnel hostname the link points at. Guest routes require it to still serve. */
  host: TrimmedNonEmptyString,
  createdAt: IsoDateTime,
  expiresAt: IsoDateTime,
  /** The one guest of a link made before several could join. Null on every newer link. */
  guestName: Schema.NullOr(TrimmedNonEmptyString),
  /** Everyone who joined, in the order they did. Absent on a link made before several could. */
  guests: Schema.optional(Schema.Array(ThreadGuest)),
  /**
   * Set when the owner removes a guest. Guests have no account, so the only way to keep that
   * person out is to stop the link letting anyone new in.
   */
  joinsClosed: Schema.optional(Schema.Boolean),
  messages: Schema.Array(ThreadGuestMessage),
  /** Turns guests ran on their own machines, newest last. Absent until one is posted. */
  turns: Schema.optional(Schema.Array(ThreadGuestTurn)),
});
export type ThreadGuestShare = typeof ThreadGuestShare.Type;

type GuestRoster = Pick<ThreadGuestShare, "guests" | "guestName">;

/** The names of everyone who joined, in the order they did. */
const guestShareNames = (share: GuestRoster): ReadonlyArray<string> =>
  share.guests?.map((guest) => guest.name) ?? (share.guestName === null ? [] : [share.guestName]);

/** The name of the guest who wrote a message. */
export const guestMessageAuthorName = (
  share: GuestRoster,
  message: Pick<ThreadGuestMessage, "guestId">,
): string =>
  share.guests?.find((guest) => guest.id === message.guestId)?.name ?? share.guestName ?? "Guest";

/** Whose agent ran a guest's own turn, as the room labels it: "Sam's agent". */
export const guestAgentName = (
  share: GuestRoster,
  turn: Pick<ThreadGuestTurn, "guestId">,
): string => `${guestMessageAuthorName(share, turn)}'s agent`;

/** "Sam is a guest", "Sam and Alex are guests", or a count once the names would not fit. */
export const guestShareStatusLabel = (share: GuestRoster): string => {
  const names = guestShareNames(share);
  if (names.length === 0) return "Guest link active";
  if (names.length === 1) return `${names[0]} is a guest`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are guests`;
  return `${names.length} guests`;
};

export const pendingGuestMessageCount = (share: ThreadGuestShare | null | undefined): number =>
  share?.messages.filter((message) => message.status === "pending").length ?? 0;

/** Which guests have the shared thread open right now. Never stored: it is not history. */
export const GuestPresence = Schema.Struct({ online: Schema.Array(GuestId) });
export type GuestPresence = typeof GuestPresence.Type;

export const GuestPresenceInput = Schema.Struct({ threadId: ThreadId });
export type GuestPresenceInput = typeof GuestPresenceInput.Type;

export const GuestShareCreateInput = Schema.Struct({ threadId: ThreadId });
export type GuestShareCreateInput = typeof GuestShareCreateInput.Type;

export const GuestShareCreateResult = Schema.Struct({
  url: TrimmedNonEmptyString,
  share: ThreadGuestShare,
});
export type GuestShareCreateResult = typeof GuestShareCreateResult.Type;

const GUEST_SHARE_CREATE_MESSAGES = {
  disabled: "Guest links are off. Turn them on in Settings > Labs.",
  connect_unavailable: "Guest links need a running T3 Connect tunnel.",
  thread_unavailable: "This thread cannot be shared.",
  read_failed: "Failed to read the shared thread.",
  changed: "The guest link changed while it was being created.",
} as const;

export class GuestShareCreateError extends Schema.TaggedError<GuestShareCreateError>()(
  "GuestShareCreateError",
  {
    reason: Schema.Literals([
      "disabled",
      "connect_unavailable",
      "thread_unavailable",
      "read_failed",
      "changed",
    ]),
  },
) {
  override get message(): string {
    return GUEST_SHARE_CREATE_MESSAGES[this.reason];
  }
}

// The name lands in the agent's attribution line, so it must stay one plain line, and the owner
// reads it, so direction overrides cannot make it look like another name.
const NAME_BREAKING_CHARACTER = /[\p{Cc}\p{Zl}\p{Zp}\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/u;

export const GuestRedeemRequest = Schema.Struct({
  credential: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString.check(
    Schema.isMaxLength(GUEST_NAME_MAX_LENGTH),
    Schema.makeFilter((name) => !NAME_BREAKING_CHARACTER.test(name), {
      description: "a single line of text",
    }),
  ),
});
export type GuestRedeemRequest = typeof GuestRedeemRequest.Type;

/**
 * The fields of a guest message. The page posts them as multipart form data, with each file as a
 * `file` part; text can be empty when files are attached.
 */
export const GuestSubmitRequest = Schema.Struct({
  /** The share the page shows, so a message from a page for a replaced link is refused instead
      of reaching the new one. */
  shareId: GuestShareId,
  text: TrimmedString.check(Schema.isMaxLength(GUEST_MESSAGE_MAX_LENGTH)),
});
export type GuestSubmitRequest = typeof GuestSubmitRequest.Type;

/** How long a handoff token opens the thread's export. Long enough to pick a project. */
export const GUEST_HANDOFF_TTL_MS = 10 * 60 * 1000;
/** The export keeps the newest messages that fit, so one request stays small. */
export const SHARED_THREAD_MAX_MESSAGES = 400;
export const SHARED_THREAD_MAX_CHARS = 400_000;

/** One message of a thread someone shared, as another machine imports it. */
export const SharedThreadMessage = Schema.Struct({
  role: Schema.Literals(["user", "assistant"]),
  text: Schema.String,
  createdAt: IsoDateTime,
});
export type SharedThreadMessage = typeof SharedThreadMessage.Type;

/** Where the shared thread's code is, for a machine that has the same repository. */
export const SharedThreadCheckout = Schema.Struct({
  /**
   * Names the repository the same way on every machine, as `host/owner/name`; see
   * `repositoryGroupingKeyOf`. The remote URL itself stays home: it can hold a credential.
   */
  repositoryKey: TrimmedNonEmptyString,
  branch: TrimmedNonEmptyString,
  /** False when the branch has commits or edits that its remote does not have yet. */
  synced: Schema.Boolean,
});
export type SharedThreadCheckout = typeof SharedThreadCheckout.Type;

/**
 * Lets the guest's own T3 Code post the turns it runs back to the room and read what the room
 * said since, until the share ends or the guest is removed. The token opens nothing else.
 */
export const SharedThreadRoom = Schema.Struct({
  token: TrimmedNonEmptyString,
  /** When the share ends, so the guest's machine stops posting then. */
  expiresAt: IsoDateTime,
});
export type SharedThreadRoom = typeof SharedThreadRoom.Type;

/**
 * A shared thread as a guest takes it to their own machine: the conversation and where its code
 * is. The guest's turns run on their machine; `room` lets it show them to the room, where they
 * never reach the owner's agent.
 */
export const SharedThreadExport = Schema.Struct({
  title: Schema.String,
  messages: Schema.Array(SharedThreadMessage),
  /** Older messages were left out to keep the export small. */
  truncated: Schema.Boolean,
  checkout: Schema.NullOr(SharedThreadCheckout),
  /** Absent from an older server, and for the one guest of a link made before several could join. */
  room: Schema.optional(SharedThreadRoom),
});
export type SharedThreadExport = typeof SharedThreadExport.Type;

/**
 * On a thread joined from a room: where its turns are shown, until the room ends. The token that
 * allows it stays in the server's secret store.
 */
export const ThreadRoomLink = Schema.Struct({
  host: TrimmedNonEmptyString,
  expiresAt: IsoDateTime,
  /** The newest thing from the room this thread has: joining and each catch-up move it on. */
  cursor: Schema.optional(IsoDateTime),
});
export type ThreadRoomLink = typeof ThreadRoomLink.Type;

/** A turn the guest's own T3 Code posts to the room. */
export const GuestTurnRequest = Schema.Struct({
  id: ThreadGuestTurn.fields.id,
  prompt: ThreadGuestTurn.fields.prompt,
  reply: ThreadGuestTurn.fields.reply,
  truncated: ThreadGuestTurn.fields.truncated,
});
export type GuestTurnRequest = typeof GuestTurnRequest.Type;

/**
 * One thing said in a room, as a thread joined from it reads it back. A guest's name is on the
 * guest's own messages and on their agent's replies.
 */
export const RoomUpdate = Schema.Struct({
  author: Schema.Literals(["owner", "owner_agent", "guest", "guest_agent"]),
  name: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(GUEST_NAME_MAX_LENGTH))),
  text: Schema.String.check(Schema.isMaxLength(ROOM_UPDATE_MAX_LENGTH)),
  at: IsoDateTime,
});
export type RoomUpdate = typeof RoomUpdate.Type;

/** What happened in a room after a cursor, oldest first, never the caller's own turns. */
export const RoomUpdates = Schema.Struct({
  updates: Schema.Array(RoomUpdate).check(Schema.isMaxLength(ROOM_UPDATES_MAX_MESSAGES)),
  /** Older updates, or the end of a long one, were left out. */
  truncated: Schema.Boolean,
  /** What to ask after next time. Null when the room has said nothing yet. */
  cursor: Schema.NullOr(IsoDateTime),
});
export type RoomUpdates = typeof RoomUpdates.Type;

export const GuestHandoff = Schema.Struct({ token: TrimmedNonEmptyString });
export type GuestHandoff = typeof GuestHandoff.Type;

/** Where the guest's browser goes on GitHub to sign in. */
export const GuestSignInStart = Schema.Struct({ url: TrimmedNonEmptyString });
export type GuestSignInStart = typeof GuestSignInStart.Type;

/** How long a guest has to finish on GitHub once they start. */
export const GUEST_SIGN_IN_TTL_MS = 10 * 60 * 1000;
/** Why a sign-in did not finish, as the guest page's address carries it back from GitHub. */
export const GuestSignInFailure = Schema.Literals(["expired", "denied", "failed"]);
export type GuestSignInFailure = typeof GuestSignInFailure.Type;
export const GUEST_SIGN_IN_PARAM = "sign_in";
/**
 * Ties a started sign-in to the browser that started it, so a guest cannot have someone else
 * finish theirs. `__Host-` stops another host on the same domain from setting it.
 */
export const GUEST_SIGN_IN_COOKIE = "__Host-t3_guest_sign_in";

export const GUEST_ROUTE_PREFIX = "/api/guest";
/** Starts a guest's GitHub sign-in (POST) and returns the GitHub address to open: `?share=<id>`. */
export const GUEST_SIGN_IN_ROUTE = `${GUEST_ROUTE_PREFIX}/sign-in`;
/** GitHub sends the guest's browser back here (GET) with `code` and `state`. */
export const GUEST_SIGN_IN_CALLBACK_ROUTE = `${GUEST_ROUTE_PREFIX}/sign-in/callback`;
/** Mints a short-lived token the guest's own T3 Code uses to read the export: `?share=<id>`. */
export const GUEST_HANDOFF_ROUTE = `${GUEST_ROUTE_PREFIX}/handoff`;
/** The thread's export, for a bearer handoff token. Called by another T3 Code server. */
export const GUEST_EXPORT_ROUTE = `${GUEST_ROUTE_PREFIX}/export`;
/** A guest's own T3 Code posts a turn it ran here, with a bearer room token. */
export const GUEST_ROOM_TURN_ROUTE = `${GUEST_ROUTE_PREFIX}/room/turns`;
/** What happened in the room since `?after=<ISO time>`, for a bearer room token. */
export const GUEST_ROOM_UPDATES_ROUTE = `${GUEST_ROUTE_PREFIX}/room/updates`;
/** The guest page and guest routes name the share they mean with this query parameter. */
export const GUEST_SHARE_PARAM = "share";

/**
 * One session cookie per share, so a guest keeps every link they joined on a host, and a page
 * for one share never acts with another share's session.
 */
export const guestSessionCookieName = (shareId: string) => `t3_guest_${shareId}`;
/** Serves one HTML render in the shared thread: `?share=<share id>&item=<turn item id>`. */
export const GUEST_RENDER_ROUTE = `${GUEST_ROUTE_PREFIX}/render`;
/** One item of the shared thread, as an expanded row loads it: `?share=<share id>&item=<id>`. */
export const GUEST_ITEM_ROUTE = `${GUEST_ROUTE_PREFIX}/item`;
/**
 * Older turns of the shared thread, as the owner's "Load earlier turns" pages them:
 * `?share=<share id>&cursor=<history cursor>`.
 */
export const GUEST_HISTORY_ROUTE = `${GUEST_ROUTE_PREFIX}/history`;
/** Server-sent output frames of one command in the shared thread: `?share=<share id>&item=<id>`. */
export const GUEST_COMMAND_OUTPUT_ROUTE = `${GUEST_ROUTE_PREFIX}/command-output`;
/**
 * A file in the shared thread or a guest's waiting message: `?share=<share id>&id=<attachment id>`.
 * Images load inline; other files download.
 */
export const GUEST_ATTACHMENT_ROUTE = `${GUEST_ROUTE_PREFIX}/attachment`;
/**
 * An image file on the host that an agent message in the shared thread embeds:
 * `?share=<share id>&path=<absolute path>`.
 */
export const GUEST_MEDIA_ROUTE = `${GUEST_ROUTE_PREFIX}/media`;
