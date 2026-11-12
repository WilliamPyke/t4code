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
 * A guest share lets a few unauthenticated browsers watch a thread over T Connect and propose
 * messages the owner must send or dismiss. The thread projection holds this public state; the
 * credentials are derived from the share id with a server key and never stored.
 */
export const GUEST_SHARE_TTL_MS = 24 * 60 * 60 * 1000;
/** How many people one link lets in. */
export const GUEST_SHARE_MAX_GUESTS = 8;
/**
 * A thread shared to a team lasts longer, and lets in every member who opens it. Members join as
 * their signed-in account, so a person keeps one guest record however often they come back.
 */
export const TEAM_SHARE_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const TEAM_SHARE_MAX_GUESTS = 50;
/** How long a team member's session lasts before their app joins again with a fresh assertion. */
export const TEAM_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
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

const ROOM_BRANCH_MAX_LENGTH = 200;
// What `git check-ref-format --branch` refuses, and characters nobody can see or that turn text.
const BRANCH_FORBIDDEN = /[\p{C}\p{Z}~^:?*[\\]|\.\.|@\{|\/\/|\/\.|\.lock(?:\/|$)/u;

/** Whether a branch name is one git takes and the room may show and put in a command. */
export const isRoomBranchName = (name: string): boolean =>
  name.length > 0 &&
  name.length <= ROOM_BRANCH_MAX_LENGTH &&
  !BRANCH_FORBIDDEN.test(name) &&
  !/^[-./]|[./]$/.test(name) &&
  name !== "@" &&
  name !== "HEAD";

/** Whether the branch's remote has all of it: no commits or edits it lacks. */
export const isBranchSynced = (status: {
  readonly hasUpstream: boolean;
  readonly aheadCount: number;
  readonly hasWorkingTreeChanges: boolean;
}): boolean => status.hasUpstream && status.aheadCount === 0 && !status.hasWorkingTreeChanges;

/**
 * Where one person's code is, as the room shows it beside their thread or agent. Display only:
 * it never reaches an agent.
 */
export const RoomCodeState = Schema.Struct({
  branch: Schema.String.check(
    Schema.makeFilter(isRoomBranchName, { expected: "a git branch name" }),
  ),
  /** The branch's remote has every commit and edit; see `isBranchSynced`. */
  synced: Schema.Boolean,
  /** Commits only this branch has, and only its remote has. Absent with no upstream. */
  ahead: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  behind: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  /** The open pull request for the branch, as that machine's source control knows it. */
  pullRequest: Schema.optional(
    Schema.Struct({
      number: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
      url: Schema.String.check(
        Schema.isMaxLength(2_048),
        Schema.makeFilter((url: string) => isRoomBoardUrl(url), {
          expected: "an http or https URL",
        }),
      ),
    }),
  ),
});
export type RoomCodeState = typeof RoomCodeState.Type;

/** What git says about a checkout, as the room shows it, or null when there is no branch to show. */
export function roomCodeStateOf(
  status: {
    readonly isRepo: boolean;
    readonly refName: string | null;
    readonly hasUpstream: boolean;
    readonly aheadCount: number;
    readonly behindCount: number;
    readonly hasWorkingTreeChanges: boolean;
    readonly pr: {
      readonly number: number;
      readonly url: string;
      readonly state: string;
    } | null;
  },
  fallbackBranch: string | null,
): RoomCodeState | null {
  const branch = status.refName ?? fallbackBranch;
  if (!status.isRepo || branch === null || !isRoomBranchName(branch)) return null;
  const pr = status.pr;
  return {
    branch,
    synced: isBranchSynced(status),
    ...(status.hasUpstream ? { ahead: status.aheadCount, behind: status.behindCount } : {}),
    ...(pr !== null && pr.state === "open" && isRoomBoardUrl(pr.url) && pr.url.length <= 2_048
      ? { pullRequest: { number: pr.number, url: pr.url } }
      : {}),
  };
}

/** A task card's id, as a turn that answers it names it. */
const RoomTaskId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

/**
 * The kind of the context record on the owner's own message that takes a task card from the
 * board to their agent. Its text never references it, so the agent never reads it.
 */
export const ROOM_TASK_CONTEXT_KIND = "room-task";
export const RoomTaskContextPayload = Schema.Struct({ shareId: GuestShareId, taskId: RoomTaskId });
export type RoomTaskContextPayload = typeof RoomTaskContextPayload.Type;

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
 * One turn a guest ran in their own T Code after joining from the room: their prompt and their
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
  /** Where the guest's code was when the turn finished. Absent from an older machine. */
  code: Schema.optional(RoomCodeState),
});
export type ThreadGuestTurn = typeof ThreadGuestTurn.Type;

export const ROOM_BOARD_NOTE_MAX_LENGTH = 280;
export const ROOM_BOARD_MAX_NOTES = 50;
/** How far from the board's origin a card or note can sit, in board pixels. */
export const ROOM_BOARD_MAX_COORDINATE = 100_000;

const RoomBoardCoordinate = Schema.Int.check(
  Schema.isBetween({ minimum: -ROOM_BOARD_MAX_COORDINATE, maximum: ROOM_BOARD_MAX_COORDINATE }),
);
export const RoomBoardPoint = Schema.Struct({ x: RoomBoardCoordinate, y: RoomBoardCoordinate });
export type RoomBoardPoint = typeof RoomBoardPoint.Type;

export const ROOM_BOARD_MAX_EDGES = 100;
const ROOM_BOARD_URL_MAX_LENGTH = 2_048;

/** Whether a link card may hold this address: an http or https URL with a host. */
export const isRoomBoardUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
};

const RoomBoardUrl = Schema.String.check(
  Schema.isMaxLength(ROOM_BOARD_URL_MAX_LENGTH),
  Schema.makeFilter(isRoomBoardUrl, { expected: "an http or https URL" }),
);

/** Who a task card is for. Absent `guestId` is the owner. */
export const RoomBoardAssignee = Schema.Struct({ guestId: Schema.optional(GuestId) });
export type RoomBoardAssignee = typeof RoomBoardAssignee.Type;

export const ROOM_TASK_ANSWER_MAX_LENGTH = 280;

/** The start of an agent's reply, as a task card shows it: one paragraph of plain text. */
export const roomTaskAnswerExcerpt = (reply: string): string => {
  const text = reply
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```\w*|`|\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text.length <= ROOM_TASK_ANSWER_MAX_LENGTH
    ? text
    : `${text.slice(0, ROOM_TASK_ANSWER_MAX_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
};

/**
 * Whose agent answered a task, and the start of its reply. Only the owner's server writes it,
 * from a turn the guest's machine posted or one of the owner's own. Display only, like the rest
 * of the board.
 */
export const RoomTaskAnswer = Schema.Struct({
  /** The guest whose agent answered. Absent when it was the owner's. */
  guestId: Schema.optional(GuestId),
  excerpt: Schema.String.check(Schema.isMaxLength(ROOM_TASK_ANSWER_MAX_LENGTH)),
  /** The turn that answered, as the machine that ran it named it. */
  turnId: ThreadGuestTurn.fields.id,
});
export type RoomTaskAnswer = typeof RoomTaskAnswer.Type;

/**
 * A card someone added to the board: a note, unless `kind` says it is a task or a link. A note
 * with `pinnedTo` is a comment on that message of the thread.
 */
export const RoomBoardNote = Schema.Struct({
  /** The client that adds the note names it. */
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  text: Schema.String.check(Schema.isMaxLength(ROOM_BOARD_NOTE_MAX_LENGTH)),
  ...RoomBoardPoint.fields,
  /** The guest who added it. Absent on the owner's notes. */
  guestId: Schema.optional(GuestId),
  kind: Schema.optional(Schema.Literals(["task", "link"])),
  /** A task that is done. */
  done: Schema.optional(Schema.Boolean),
  assignee: Schema.optional(RoomBoardAssignee),
  /** A link card's address. Clients read it; the server never fetches it. */
  url: Schema.optional(RoomBoardUrl),
  /** The id of the thread's message this comment is pinned to. */
  pinnedTo: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  /** A task someone's agent answered. No board change sets it; it stays when the task changes. */
  answer: Schema.optional(RoomTaskAnswer),
});
export type RoomBoardNote = typeof RoomBoardNote.Type;

/** A card or note on the board as an arrow names it: `card:<card id>` or `note:<note id>`. */
const RoomBoardItemRef = TrimmedNonEmptyString.check(Schema.isMaxLength(170));
export const roomBoardCardRef = (cardId: string) => `card:${cardId}`;
export const roomBoardNoteRef = (noteId: string) => `note:${noteId}`;

/** An arrow from one card or note to another. */
export const RoomBoardEdge = Schema.Struct({
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(64)),
  from: RoomBoardItemRef,
  to: RoomBoardItemRef,
});
export type RoomBoardEdge = typeof RoomBoardEdge.Type;

/**
 * What the people in a room arranged on its board: where each card sits, their notes, and the
 * arrows between them. The room only shows it. It never starts a turn and never reaches an agent.
 */
export const RoomBoard = Schema.Struct({
  positions: Schema.Record(Schema.String, RoomBoardPoint),
  notes: Schema.Array(RoomBoardNote),
  /** Absent until someone draws an arrow, and from an older server. */
  edges: Schema.optional(Schema.Array(RoomBoardEdge)),
});
export type RoomBoard = typeof RoomBoard.Type;

export const ROOM_BOARD_THREAD_CARD = "thread";
export const roomBoardGuestCard = (guestId: string) => `guest:${guestId}`;
export const roomBoardAgentCard = (guestId: string) => `agent:${guestId}`;

/** One change to a room's board. The last change to a card or a note wins. */
export const RoomBoardChange = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("card.move"),
    cardId: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
    ...RoomBoardPoint.fields,
  }),
  /**
   * Adds the note, or replaces the text and place of the one with this id. `kind`, `url` and
   * `pinnedTo` are taken when the note is added and kept after. A task's `done` and `assignee`
   * stay as they were when absent, so an older client's edit keeps them; a null `assignee`
   * clears it.
   */
  Schema.Struct({
    type: Schema.Literal("note.put"),
    noteId: RoomBoardNote.fields.id,
    text: RoomBoardNote.fields.text,
    ...RoomBoardPoint.fields,
    kind: RoomBoardNote.fields.kind,
    url: RoomBoardNote.fields.url,
    pinnedTo: RoomBoardNote.fields.pinnedTo,
    done: RoomBoardNote.fields.done,
    assignee: Schema.optional(Schema.NullOr(RoomBoardAssignee)),
  }),
  /** Removes the note and its arrows. */
  Schema.Struct({ type: Schema.Literal("note.remove"), noteId: RoomBoardNote.fields.id }),
  /** Adds an arrow. One that exists, or one between the same two cards, changes nothing. */
  Schema.Struct({
    type: Schema.Literal("edge.put"),
    edgeId: RoomBoardEdge.fields.id,
    from: RoomBoardEdge.fields.from,
    to: RoomBoardEdge.fields.to,
  }),
  Schema.Struct({ type: Schema.Literal("edge.remove"), edgeId: RoomBoardEdge.fields.id }),
]);
export type RoomBoardChange = typeof RoomBoardChange.Type;

/**
 * Live room state, held in the owner's server's memory and never stored: which guests' agents
 * are running a turn on their own machines, and where each person's pointer is on the board.
 */
export const GUEST_AGENT_PROMPT_MAX_LENGTH = 280;

/** A guest's agent running a turn on their machine, with the start of the prompt it is on. */
export const RoomAgentActivity = Schema.Struct({
  guestId: GuestId,
  prompt: Schema.String.check(Schema.isMaxLength(GUEST_AGENT_PROMPT_MAX_LENGTH)),
  /** The task card the turn answers. */
  taskId: Schema.optional(RoomTaskId),
  /** Where the guest's code is. Absent from an older machine. */
  code: Schema.optional(RoomCodeState),
});
export type RoomAgentActivity = typeof RoomAgentActivity.Type;

/** Someone's pointer on the board, in board pixels. Absent `guestId` is the owner's. */
export const RoomCursor = Schema.Struct({
  guestId: Schema.optional(GuestId),
  ...RoomBoardPoint.fields,
});
export type RoomCursor = typeof RoomCursor.Type;

/** What someone's board shows: the board point in the middle of their screen, and their zoom. */
export const RoomBoardViewport = Schema.Struct({
  ...RoomBoardPoint.fields,
  zoom: Schema.Number.check(Schema.isBetween({ minimum: 0.1, maximum: 10 })),
});
export type RoomBoardViewport = typeof RoomBoardViewport.Type;

/** Someone's view of the board, while they have it open. Absent `guestId` is the owner's. */
export const RoomViewport = Schema.Struct({
  guestId: Schema.optional(GuestId),
  ...RoomBoardViewport.fields,
});
export type RoomViewport = typeof RoomViewport.Type;

/** The guests' agents running now, sent whenever that changes. */
export const RoomAgentsEvent = Schema.Struct({
  type: Schema.Literal("agents"),
  running: Schema.Array(RoomAgentActivity),
  /** Where the owner's code is, on a guest's stream once the owner's server could say. */
  owner: Schema.optional(RoomCodeState),
});
export type RoomAgentsEvent = typeof RoomAgentsEvent.Type;

/** Everyone else's pointers on the board, sent whenever one moves. Never the reader's own. */
export const RoomCursorsEvent = Schema.Struct({
  type: Schema.Literal("cursors"),
  cursors: Schema.Array(RoomCursor),
  /** Everyone else's view of the board, so one can follow another. Absent from an older server. */
  views: Schema.optional(Schema.Array(RoomViewport)),
});
export type RoomCursorsEvent = typeof RoomCursorsEvent.Type;

/** The live room of the share the owner's board shows. */
export const RoomLiveInput = Schema.Struct({ threadId: ThreadId, shareId: GuestShareId });
export type RoomLiveInput = typeof RoomLiveInput.Type;

/**
 * Where someone's pointer is on the board, or null once it left. `view` is what their board
 * shows, null once they closed it, and unchanged when absent.
 */
const RoomCursorFields = {
  at: Schema.NullOr(RoomBoardPoint),
  view: Schema.optional(Schema.NullOr(RoomBoardViewport)),
};

/** The owner's pointer and view on the board. */
export const RoomCursorInput = Schema.Struct({
  threadId: ThreadId,
  shareId: GuestShareId,
  ...RoomCursorFields,
});
export type RoomCursorInput = typeof RoomCursorInput.Type;

/** A guest's pointer and view on the board. */
export const GuestCursorRequest = Schema.Struct(RoomCursorFields);
export type GuestCursorRequest = typeof GuestCursorRequest.Type;

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

/** The signed-in account of a guest who joined as a member of the team the thread is shared to. */
export const GuestTeamMember = Schema.Struct({
  userId: TrimmedNonEmptyString,
  avatarUrl: Schema.optional(TrimmedNonEmptyString),
});
export type GuestTeamMember = typeof GuestTeamMember.Type;

/** The team a thread is shared to. */
export const GuestShareTeam = Schema.Struct({ id: TrimmedNonEmptyString, name: Schema.String });
export type GuestShareTeam = typeof GuestShareTeam.Type;

export const ThreadGuest = Schema.Struct({
  id: GuestId,
  name: TrimmedNonEmptyString,
  joinedAt: IsoDateTime,
  /** Set when they joined as a team member: their name then comes from their account. */
  member: Schema.optional(GuestTeamMember),
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
  /** The T Connect tunnel hostname the link points at. Guest routes require it to still serve. */
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
  /** Absent until someone moves a card or adds a note. */
  board: Schema.optional(RoomBoard),
  /** Set when the thread is shared to a team: only its members join, each as their account. */
  team: Schema.optional(GuestShareTeam),
  /** Team members the owner removed, who cannot join this share again. */
  removedMembers: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
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

export const GuestShareCreateInput = Schema.Struct({
  threadId: ThreadId,
  /** Ends a link people can still join with and makes a new one, instead of returning it. */
  replace: Schema.optional(Schema.Boolean),
  /** Shares to this team instead of making a guest link. Needs T Connect and membership. */
  teamId: Schema.optional(TrimmedNonEmptyString),
});
export type GuestShareCreateInput = typeof GuestShareCreateInput.Type;

export const GuestShareCreateResult = Schema.Struct({
  url: TrimmedNonEmptyString,
  /** A readable link that leads to `url`, when the server's relay could name it. */
  shortUrl: Schema.optional(TrimmedNonEmptyString),
  share: ThreadGuestShare,
});
export type GuestShareCreateResult = typeof GuestShareCreateResult.Type;

const GUEST_SHARE_CREATE_MESSAGES = {
  disabled: "Guest links are off. Turn them on in Settings > Labs.",
  connect_unavailable: "Guest links need a running T Connect tunnel.",
  thread_unavailable: "This thread cannot be shared.",
  read_failed: "Failed to read the shared thread.",
  changed: "The guest link changed while it was being created.",
  team_unavailable:
    "Could not share with this team. Check that this machine is linked to T Connect with an account in the team.",
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
      "team_unavailable",
    ]),
  },
) {
  override get message(): string {
    return GUEST_SHARE_CREATE_MESSAGES[this.reason];
  }
}

/** The owner's change to the board of a thread they share. */
export const RoomBoardChangeInput = Schema.Struct({ threadId: ThreadId, change: RoomBoardChange });
export type RoomBoardChangeInput = typeof RoomBoardChangeInput.Type;

const ROOM_BOARD_CHANGE_MESSAGES = {
  inactive: "This thread is not shared.",
  full: "This board has as many notes as it holds. Remove one first.",
  rejected: "The board did not take this change.",
} as const;

export class RoomBoardChangeError extends Schema.TaggedError<RoomBoardChangeError>()(
  "RoomBoardChangeError",
  { reason: Schema.Literals(["inactive", "full", "rejected"]) },
) {
  override get message(): string {
    return ROOM_BOARD_CHANGE_MESSAGES[this.reason];
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
  /**
   * A team member's signed assertion from T Connect. A thread shared to a team takes nothing else,
   * and joins the member under their account's name instead of `name`.
   */
  memberAssertion: Schema.optional(TrimmedNonEmptyString),
  /**
   * Asks for the session token in the response body. A page on another origin than the owner's
   * host cannot use the cookie, so it keeps the token and sends it as a bearer.
   */
  returnToken: Schema.optional(Schema.Boolean),
});
export type GuestRedeemRequest = typeof GuestRedeemRequest.Type;

/** What a redeem that asked for its token gets back. An older server answers 204 with no body. */
export const GuestRedeemResult = Schema.Struct({
  token: TrimmedNonEmptyString,
  shareId: GuestShareId,
  /** The shared thread, which the guest's stream names too. */
  threadId: Schema.optional(ThreadId),
});
export type GuestRedeemResult = typeof GuestRedeemResult.Type;

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
 * Lets the guest's own T Code post the turns it runs back to the room and read what the room
 * said since, until the share ends or the guest is removed. The token opens nothing else.
 */
export const SharedThreadRoom = Schema.Struct({
  token: TrimmedNonEmptyString,
  /** When the share ends, so the guest's machine stops posting then. */
  expiresAt: IsoDateTime,
  /** The share, so the guest's machine can find this thread again from a link to the room. */
  shareId: Schema.optional(GuestShareId),
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
  /** Absent on a thread joined before rooms named their share. */
  shareId: Schema.optional(GuestShareId),
  /**
   * The task card the user took to this thread's agent, and when: the first turn asked after
   * that answers it.
   */
  task: Schema.optional(Schema.Struct({ id: RoomTaskId, takenAt: IsoDateTime })),
});
export type ThreadRoomLink = typeof ThreadRoomLink.Type;

/** A turn the guest's own T Code posts to the room. */
export const GuestTurnRequest = Schema.Struct({
  id: ThreadGuestTurn.fields.id,
  prompt: ThreadGuestTurn.fields.prompt,
  reply: ThreadGuestTurn.fields.reply,
  truncated: ThreadGuestTurn.fields.truncated,
  /** The task card this turn answers. One that is not this guest's task is ignored. */
  taskId: Schema.optional(RoomTaskId),
  code: ThreadGuestTurn.fields.code,
});
export type GuestTurnRequest = typeof GuestTurnRequest.Type;

/**
 * The guest's own T Code saying a turn started (`running`, with the prompt) or stopped without
 * a turn to post (`idle`). Posting the finished turn also clears it.
 */
export const GuestAgentActivityRequest = Schema.Struct({
  id: ThreadGuestTurn.fields.id,
  state: Schema.Literals(["running", "idle"]),
  prompt: Schema.optional(RoomAgentActivity.fields.prompt),
  taskId: RoomAgentActivity.fields.taskId,
  code: RoomAgentActivity.fields.code,
});
export type GuestAgentActivityRequest = typeof GuestAgentActivityRequest.Type;

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
/**
 * Starts the sign-in for a guest page on the hosted app (form POST with `token` and `share`). It
 * is a navigation, not a fetch, so the answer can set the sign-in cookie on this host before it
 * sends the browser on to GitHub.
 */
export const GUEST_SIGN_IN_BEGIN_ROUTE = `${GUEST_ROUTE_PREFIX}/sign-in/begin`;
/** GitHub sends the guest's browser back here (GET) with `code` and `state`. */
export const GUEST_SIGN_IN_CALLBACK_ROUTE = `${GUEST_ROUTE_PREFIX}/sign-in/callback`;
/** Mints a short-lived token the guest's own T Code uses to read the export: `?share=<id>`. */
export const GUEST_HANDOFF_ROUTE = `${GUEST_ROUTE_PREFIX}/handoff`;
/** The thread's export, for a bearer handoff token. Called by another T Code server. */
export const GUEST_EXPORT_ROUTE = `${GUEST_ROUTE_PREFIX}/export`;
/** A guest's own T Code posts a turn it ran here, with a bearer room token. */
export const GUEST_ROOM_TURN_ROUTE = `${GUEST_ROUTE_PREFIX}/room/turns`;
/** A guest's own T Code says a turn started or stopped here, with a bearer room token. */
export const GUEST_ROOM_ACTIVITY_ROUTE = `${GUEST_ROUTE_PREFIX}/room/activity`;
/** What happened in the room since `?after=<ISO time>`, for a bearer room token. */
export const GUEST_ROOM_UPDATES_ROUTE = `${GUEST_ROUTE_PREFIX}/room/updates`;
/** A guest's change to the room's board (POST), a `RoomBoardChange` as JSON: `?share=<id>`. */
export const GUEST_BOARD_ROUTE = `${GUEST_ROUTE_PREFIX}/board`;
/** Where a guest's pointer is on the room's board (POST), a `GuestCursorRequest`: `?share=<id>`. */
export const GUEST_BOARD_CURSOR_ROUTE = `${GUEST_ROUTE_PREFIX}/board/cursor`;
/** The guest page and guest routes name the share they mean with this query parameter. */
export const GUEST_SHARE_PARAM = "share";
/** On the hosted app, the guest page names the owner's host with this query parameter. */
export const GUEST_HOST_PARAM = "host";

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
