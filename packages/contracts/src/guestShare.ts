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

export const ThreadGuest = Schema.Struct({
  id: GuestId,
  name: TrimmedNonEmptyString,
  joinedAt: IsoDateTime,
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
 * A shared thread as a guest takes it to their own machine: the conversation and where its code
 * is. A one-time copy. Nothing the guest then does reaches the owner's thread or their agent.
 */
export const SharedThreadExport = Schema.Struct({
  title: Schema.String,
  messages: Schema.Array(SharedThreadMessage),
  /** Older messages were left out to keep the export small. */
  truncated: Schema.Boolean,
  checkout: Schema.NullOr(SharedThreadCheckout),
});
export type SharedThreadExport = typeof SharedThreadExport.Type;

export const GuestHandoff = Schema.Struct({ token: TrimmedNonEmptyString });
export type GuestHandoff = typeof GuestHandoff.Type;

export const GUEST_ROUTE_PREFIX = "/api/guest";
/** Mints a short-lived token the guest's own T3 Code uses to read the export: `?share=<id>`. */
export const GUEST_HANDOFF_ROUTE = `${GUEST_ROUTE_PREFIX}/handoff`;
/** The thread's export, for a bearer handoff token. Called by another T3 Code server. */
export const GUEST_EXPORT_ROUTE = `${GUEST_ROUTE_PREFIX}/export`;
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
