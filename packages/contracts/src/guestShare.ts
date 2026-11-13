import * as Schema from "effect/Schema";

import { ChatAttachment } from "./chatAttachment.ts";
import {
  GuestId,
  GuestMessageId,
  GuestShareId,
  IsoDateTime,
  MessageId,
  ThreadId,
  TrimmedNonEmptyString,
  TrimmedString,
} from "./baseSchemas.ts";

/**
 * A guest share lets a few unauthenticated browsers watch a thread over T Connect and propose
 * messages the owner must send or dismiss. The thread projection holds this public state; the
 * credentials are derived from the share id with a server key and never stored.
 */
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
/** A card's id on a room's board, as the client that added it named it. */
const RoomBoardNoteId = TrimmedNonEmptyString.check(Schema.isMaxLength(64));

/**
 * The kind of the context record on the owner's own message that takes a task card from the
 * board to their agent. Its text never references it, so the agent never reads it.
 */
export const ROOM_TASK_CONTEXT_KIND = "room-task";
export const RoomTaskContextPayload = Schema.Struct({ shareId: GuestShareId, taskId: RoomTaskId });
export type RoomTaskContextPayload = typeof RoomTaskContextPayload.Type;

/**
 * The kind of the context record that ties a message in a thread box's own thread to its box.
 * Only the owner's server attaches it, and the text never references it.
 */
export const ROOM_BOX_CONTEXT_KIND = "room-box";
export const RoomBoxContextPayload = Schema.Struct({
  shareId: GuestShareId,
  boxId: RoomBoardNoteId,
});
export type RoomBoxContextPayload = typeof RoomBoxContextPayload.Type;

/** One catch-up from a room: how many messages, how long each, and how much in all. */
export const ROOM_UPDATES_MAX_MESSAGES = 50;
export const ROOM_UPDATE_MAX_LENGTH = 8_000;
export const ROOM_UPDATES_MAX_CHARS = 48_000;

export const ThreadGuestMessageStatus = Schema.Literals(["pending", "sent", "dismissed"]);
export type ThreadGuestMessageStatus = typeof ThreadGuestMessageStatus.Type;

/** The labels of the cards that went with a turn, at most this many. */
export const ROOM_BOX_CARD_LABELS_MAX = 8;
/**
 * Board cards as a turn or an artifact names them: "Note from Sam", 'Artifact "Plan"'. The
 * owner's server writes them from the board, so they read the same to everyone.
 */
const RoomBoxCardLabels = Schema.Array(Schema.String.check(Schema.isMaxLength(200))).check(
  Schema.isMaxLength(ROOM_BOX_CARD_LABELS_MAX),
);

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
  /**
   * The artifact card the reply fills once the owner sends it. The owner's server attaches the
   * card when it sends the message; one removed by then leaves a plain message.
   */
  artifactId: Schema.optional(RoomBoardNoteId),
  /** The guest's own thread box this message is for. The owner's Send runs it in that box. */
  boxId: Schema.optional(RoomBoardNoteId),
  /**
   * The message the owner's server sent it as in its box's own thread. The owner's only: a guest
   * never receives it.
   */
  sentAs: Schema.optional(MessageId),
  /** The board cards the guest attached, as this server labelled them when it took the message. */
  cards: Schema.optional(RoomBoxCardLabels),
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

export const ROOM_BOARD_MIN_CARD_SIZE = 120;
export const ROOM_BOARD_MAX_CARD_SIZE = 1_600;
const RoomBoardLength = Schema.Int.check(
  Schema.isBetween({ minimum: ROOM_BOARD_MIN_CARD_SIZE, maximum: ROOM_BOARD_MAX_CARD_SIZE }),
);
/** How big someone made a card, in board pixels. */
export const RoomBoardSize = Schema.Struct({ w: RoomBoardLength, h: RoomBoardLength });
export type RoomBoardSize = typeof RoomBoardSize.Type;

export const ROOM_BOARD_QUOTE_MAX_LENGTH = 280;
export const ROOM_ARTIFACT_MAX_LENGTH = 16_000;
export const ROOM_BOARD_MAX_ARTIFACTS = 6;
/** Thread boxes one board holds, the room thread's own card not counted. */
export const ROOM_BOARD_MAX_THREADS = 12;

/** What a thread box and an artifact show of a turn: its prompt and reply, cut to these. */
export const ROOM_BOX_PROMPT_MAX_LENGTH = 280;
export const ROOM_BOX_REPLY_MAX_LENGTH = 600;
/** The turns a thread box keeps, newest last. */
export const ROOM_BOX_TURN_LIMIT = 3;
const ROOM_BOX_MODEL_MAX_LENGTH = 120;

const RoomBoxModelName = Schema.String.check(Schema.isMaxLength(ROOM_BOX_MODEL_MAX_LENGTH));

/** One turn of a thread box's conversation, as the board shows it. Plain text only. */
export const RoomBoxTurn = Schema.Struct({
  /** The turn as the machine that ran it named it. */
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  prompt: Schema.String.check(Schema.isMaxLength(ROOM_BOX_PROMPT_MAX_LENGTH)),
  reply: Schema.String.check(Schema.isMaxLength(ROOM_BOX_REPLY_MAX_LENGTH)),
  cards: Schema.optional(RoomBoxCardLabels),
  at: IsoDateTime,
  /** The model's display name. */
  model: Schema.optional(RoomBoxModelName),
  /** Whose agent ran it. Absent: the owner's. */
  guestId: Schema.optional(GuestId),
  /** The guest whose request the owner sent. */
  askedBy: Schema.optional(GuestId),
});
export type RoomBoxTurn = typeof RoomBoxTurn.Type;

/** What a thread box shows of its conversation. Only the owner's server writes it. */
export const RoomBoxState = Schema.Struct({
  /** The last few turns, newest last. */
  turns: Schema.Array(RoomBoxTurn).check(Schema.isMaxLength(ROOM_BOX_TURN_LIMIT)),
});
export type RoomBoxState = typeof RoomBoxState.Type;

const RoomArtifactVersionFields = {
  body: Schema.String.check(Schema.isMaxLength(ROOM_ARTIFACT_MAX_LENGTH)),
  /** The body was longer than the board keeps. */
  truncated: Schema.optional(Schema.Boolean),
  /** The guest whose agent wrote this version, on their own machine. Absent: the owner's agent. */
  guestId: Schema.optional(GuestId),
  /** The guest whose message the owner's agent answered with this version. */
  askedBy: Schema.optional(GuestId),
  /** The turn that wrote it, as the machine that ran it named it. */
  turnId: ThreadGuestTurn.fields.id,
  updatedAt: IsoDateTime,
  /** The start of the prompt that produced it. Absent on older versions. */
  prompt: Schema.optional(RoomBoxTurn.fields.prompt),
  /** The labels of the cards that went with that prompt. */
  cards: Schema.optional(RoomBoxCardLabels),
  /** The thread box whose turn wrote it: `ROOM_BOARD_ROOM_BOX` for the room thread. */
  boxId: Schema.optional(RoomBoardNoteId),
  /** The model's display name. */
  model: Schema.optional(RoomBoxModelName),
};

/** The version of an artifact that the current one replaced, kept so anyone can go back to it. */
export const RoomArtifactPrevious = Schema.Struct(RoomArtifactVersionFields);
export type RoomArtifactPrevious = typeof RoomArtifactPrevious.Type;

/**
 * What an agent wrote into an artifact card: markdown, or a whole HTML page. Only the owner's
 * server writes it: from a turn of the owner's agent that was asked to fill the card, or from a
 * turn a guest's agent ran on their own machine and posted to the room.
 */
export const RoomArtifactContent = Schema.Struct({
  ...RoomArtifactVersionFields,
  previous: Schema.optional(RoomArtifactPrevious),
});
export type RoomArtifactContent = typeof RoomArtifactContent.Type;

/** Replies one comment thread holds after its first comment. */
export const ROOM_BOARD_MAX_REPLIES = 30;
/** How much of an agent's answer a comment thread keeps, longer than a person's reply. */
export const ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH = 1_200;

/** A reply in a comment thread on the board. */
export const RoomBoardReply = Schema.Struct({
  /** The client that adds the reply names it, or the owner's server for an agent's. */
  id: RoomBoardNoteId,
  /** A person's is plain text; an agent's is markdown, and plain prose from an older server. */
  text: Schema.String.check(Schema.isMaxLength(ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH)),
  /** The guest who wrote it, or whose agent did. Absent on the owner's and their agent's. */
  guestId: Schema.optional(GuestId),
  /** When the server that holds the board took it; never the client's word. */
  at: IsoDateTime,
  /**
   * An agent wrote it, asked from the thread. Only the owner's server sets it, from a finished
   * run; no board change can.
   */
  agent: Schema.optional(
    Schema.Struct({
      /** The run that wrote it, as the machine that ran it named it. */
      turnId: ThreadGuestTurn.fields.id,
      /** The thread box that ran it: `ROOM_BOARD_ROOM_BOX` for the room thread. */
      boxId: RoomBoardNoteId,
      model: Schema.optional(RoomBoxModelName),
    }),
  ),
});
export type RoomBoardReply = typeof RoomBoardReply.Type;

/** The colours a plain note can be. Absent is yellow. */
export const ROOM_BOARD_NOTE_COLORS = [
  "yellow",
  "green",
  "blue",
  "pink",
  "purple",
  "grey",
] as const;
export const RoomBoardNoteColor = Schema.Literals(ROOM_BOARD_NOTE_COLORS);
export type RoomBoardNoteColor = typeof RoomBoardNoteColor.Type;

/** The reactions anyone can leave on a card. */
export const ROOM_BOARD_REACTIONS = ["👍", "❤️", "🎉", "👀", "✅", "❓"] as const;
export const RoomBoardReactionEmoji = Schema.Literals(ROOM_BOARD_REACTIONS);
export type RoomBoardReactionEmoji = typeof RoomBoardReactionEmoji.Type;
/** Reactions one card holds, from everyone. */
export const ROOM_BOARD_MAX_REACTIONS = 60;

/** Someone's reaction on a card. */
export const RoomBoardReaction = Schema.Struct({
  emoji: RoomBoardReactionEmoji,
  /** The guest who reacted. Absent on the owner's. */
  guestId: Schema.optional(GuestId),
});
export type RoomBoardReaction = typeof RoomBoardReaction.Type;

/**
 * A card someone added to the board: a note, unless `kind` says it is a task, a link, an
 * artifact, a thread box or a comment thread. A note with `pinnedTo` is a comment on that message
 * of the thread. An artifact's and a thread box's `text` is its title; a comment thread's is its
 * first comment. A thread box is a conversation of its own, run by the agent of whoever added it.
 */
export const RoomBoardNote = Schema.Struct({
  /** The client that adds the note names it. */
  id: RoomBoardNoteId,
  text: Schema.String.check(Schema.isMaxLength(ROOM_BOARD_NOTE_MAX_LENGTH)),
  ...RoomBoardPoint.fields,
  /** The guest who added it. Absent on the owner's notes. */
  guestId: Schema.optional(GuestId),
  kind: Schema.optional(Schema.Literals(["task", "link", "artifact", "thread", "comment"])),
  /** A task that is done. */
  done: Schema.optional(Schema.Boolean),
  assignee: Schema.optional(RoomBoardAssignee),
  /** A link card's address. Clients read it; the server never fetches it. */
  url: Schema.optional(RoomBoardUrl),
  /** The id of the thread's message this comment is pinned to. */
  pinnedTo: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  /** A task someone's agent answered. No board change sets it; it stays when the task changes. */
  answer: Schema.optional(RoomTaskAnswer),
  /** The start of the reply a comment is pinned to, as its author's client read it. */
  quote: Schema.optional(Schema.String.check(Schema.isMaxLength(ROOM_BOARD_QUOTE_MAX_LENGTH))),
  /** Absent until someone resizes the card. */
  size: Schema.optional(RoomBoardSize),
  /** A plain note's colour, once someone picked one. */
  color: Schema.optional(RoomBoardNoteColor),
  /** What an agent wrote into an artifact. No board change sets it. */
  artifact: Schema.optional(RoomArtifactContent),
  /** A thread box's recent turns. No board change sets it; it stays when the box changes. */
  thread: Schema.optional(RoomBoxState),
  /** When a comment thread was started, as the server that holds the board took it. */
  createdAt: Schema.optional(IsoDateTime),
  /** A comment thread's replies, oldest first. Only the comment changes set them. */
  replies: Schema.optional(
    Schema.Array(RoomBoardReply).check(Schema.isMaxLength(ROOM_BOARD_MAX_REPLIES)),
  ),
  /** A comment thread someone resolved. Only `comment.resolve` sets it. */
  resolved: Schema.optional(Schema.Literal(true)),
  /** Who reacted with what, oldest first. Only `note.react` sets them. */
  reactions: Schema.optional(
    Schema.Array(RoomBoardReaction).check(Schema.isMaxLength(ROOM_BOARD_MAX_REACTIONS)),
  ),
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
 * arrows between them. Changing it never starts a turn. Cards reach an agent only in a message
 * someone sends from it: the owner's own Send on their own thread, or a guest's message, which
 * carries them as text and goes through the owner like any other.
 */
/** Someone from an earlier link whose cards, replies or reactions are still on the board. */
export const RoomBoardPastPerson = Schema.Struct({
  guestId: GuestId,
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(GUEST_NAME_MAX_LENGTH)),
});
export type RoomBoardPastPerson = typeof RoomBoardPastPerson.Type;

export const RoomBoard = Schema.Struct({
  positions: Schema.Record(Schema.String, RoomBoardPoint),
  notes: Schema.Array(RoomBoardNote),
  /** Absent until someone draws an arrow, and from an older server. */
  edges: Schema.optional(Schema.Array(RoomBoardEdge)),
  /** The size of each card someone resized, by card id. Notes carry their own. */
  sizes: Schema.optional(Schema.Record(Schema.String, RoomBoardSize)),
  /**
   * People of earlier links, named as they were when their link ended. They are no longer in the
   * room, so what they added is nobody's: only the owner can remove it. No board change sets it.
   */
  people: Schema.optional(Schema.Array(RoomBoardPastPerson)),
});
export type RoomBoard = typeof RoomBoard.Type;

export const ROOM_BOARD_THREAD_CARD = "thread";
/** The box id of the room thread's own card, which behaves as the owner's first thread box. */
export const ROOM_BOARD_ROOM_BOX = "thread";
export const roomBoardGuestCard = (guestId: string) => `guest:${guestId}`;
export const roomBoardAgentCard = (guestId: string) => `agent:${guestId}`;

/** One change to a room's board. The last change to a card or a note wins. */
export const RoomBoardChange = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("card.move"),
    cardId: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
    ...RoomBoardPoint.fields,
  }),
  /** Sizes a card. Notes are sized with `note.put`. */
  Schema.Struct({
    type: Schema.Literal("card.resize"),
    cardId: TrimmedNonEmptyString.check(Schema.isMaxLength(160)),
    ...RoomBoardSize.fields,
  }),
  /**
   * Adds the note, or replaces the text and place of the one with this id. `kind`, `url`,
   * `pinnedTo` and `quote` are kept from when it was added. Absent `size`, `done`, `assignee`
   * and `color` stay as they were, so an older client's edit keeps them; a null `assignee`
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
    quote: RoomBoardNote.fields.quote,
    size: RoomBoardNote.fields.size,
    done: RoomBoardNote.fields.done,
    assignee: Schema.optional(Schema.NullOr(RoomBoardAssignee)),
    color: RoomBoardNote.fields.color,
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
  /**
   * Swaps an artifact's content with the version it replaced, so a second restore undoes the
   * first. An artifact with no earlier version stays as it is.
   */
  Schema.Struct({ type: Schema.Literal("artifact.restore"), noteId: RoomBoardNote.fields.id }),
  /** Adds a reply to a comment thread. A reply id it already has changes nothing. */
  Schema.Struct({
    type: Schema.Literal("comment.reply"),
    noteId: RoomBoardNote.fields.id,
    replyId: RoomBoardReply.fields.id,
    text: Schema.String.check(Schema.isMaxLength(ROOM_BOARD_NOTE_MAX_LENGTH)),
  }),
  Schema.Struct({
    type: Schema.Literal("comment.reply.remove"),
    noteId: RoomBoardNote.fields.id,
    replyId: RoomBoardReply.fields.id,
  }),
  /** Resolves a comment thread, or reopens it. */
  Schema.Struct({
    type: Schema.Literal("comment.resolve"),
    noteId: RoomBoardNote.fields.id,
    resolved: Schema.Boolean,
  }),
  /** Adds the sender's own reaction to a card, or takes it back if they had it. */
  Schema.Struct({
    type: Schema.Literal("note.react"),
    noteId: RoomBoardNote.fields.id,
    emoji: RoomBoardReactionEmoji,
  }),
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
  /** The artifact card the turn's reply will fill. */
  artifactId: Schema.optional(RoomBoardNoteId),
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

export const ROOM_BOX_PROGRESS_DETAIL_MAX_LENGTH = 120;
export const ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH = 240;

/**
 * What a thread box's agent is doing in a run, live: waiting its turn, thinking, using a tool,
 * writing its reply, or waiting for the owner to approve something. Never stored.
 */
export const RoomBoxProgress = Schema.Struct({
  /** `ROOM_BOARD_ROOM_BOX` for the room thread. */
  boxId: RoomBoardNoteId,
  /** Whose agent runs it. Absent: the owner's. */
  guestId: Schema.optional(GuestId),
  /** The artifact card the run's reply will fill. */
  artifactId: Schema.optional(RoomBoardNoteId),
  /** The comment thread the run's reply will be posted in. */
  commentId: Schema.optional(RoomBoardNoteId),
  phase: Schema.Literals(["queued", "thinking", "tool", "writing", "approval"]),
  /** For `tool`: the tool's name or a few words. Never its arguments. */
  detail: Schema.optional(
    Schema.String.check(Schema.isMaxLength(ROOM_BOX_PROGRESS_DETAIL_MAX_LENGTH)),
  ),
  /** For `writing`: the end of the reply so far. */
  preview: Schema.optional(
    Schema.String.check(Schema.isMaxLength(ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH)),
  ),
  /** With `artifactId`: what the artifact would show if the reply ended now. */
  draft: Schema.optional(Schema.String.check(Schema.isMaxLength(ROOM_ARTIFACT_MAX_LENGTH))),
  startedAt: IsoDateTime,
  /** The model's display name. */
  model: Schema.optional(RoomBoxModelName),
  /** The start of what the run answers: a guest's own words when it is their request. */
  prompt: Schema.optional(RoomBoxTurn.fields.prompt),
  /** The guest whose request the owner sent. */
  askedBy: Schema.optional(GuestId),
});
export type RoomBoxProgress = typeof RoomBoxProgress.Type;

/** The guests' agents running now, sent whenever that changes. */
export const RoomAgentsEvent = Schema.Struct({
  type: Schema.Literal("agents"),
  running: Schema.Array(RoomAgentActivity),
  /** Where the owner's code is, on a guest's stream once the owner's server could say. */
  owner: Schema.optional(RoomCodeState),
  /** What each thread box's agent is doing now. Absent from an older server. */
  boxes: Schema.optional(Schema.Array(RoomBoxProgress)),
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
  /**
   * The owner's own thread behind each of their thread boxes, by box id. The owner's only: a
   * guest never receives it.
   */
  boardThreads: Schema.optional(Schema.Record(Schema.String, ThreadId)),
  /**
   * The owner moved `expiresAt` on since the link was made. The relay keeps a readable name for
   * as long as the link first lasted, so an extended link is given out in its long form.
   */
  extended: Schema.optional(Schema.Literal(true)),
});
export type ThreadGuestShare = typeof ThreadGuestShare.Type;

/**
 * A room's board while its thread is not shared, kept for the next link. The next share takes
 * it, so a board outlasts every link it was on.
 */
export const ThreadRoomBoard = Schema.Struct({
  board: RoomBoard,
  /** The owner's own thread behind each of their thread boxes, as `ThreadGuestShare` has it. */
  boardThreads: Schema.optional(Schema.Record(Schema.String, ThreadId)),
});
export type ThreadRoomBoard = typeof ThreadRoomBoard.Type;

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

/** How many days a guest link can last. The first is the default. */
export const GUEST_SHARE_LIFETIME_DAYS = [1, 7, 30] as const;
export const GuestShareLifetimeDays = Schema.Literals(GUEST_SHARE_LIFETIME_DAYS);
export type GuestShareLifetimeDays = typeof GuestShareLifetimeDays.Type;
const DAY_MS = 24 * 60 * 60 * 1000;
export const guestShareLifetimeMs = (days: GuestShareLifetimeDays | undefined): number =>
  (days ?? GUEST_SHARE_LIFETIME_DAYS[0]) * DAY_MS;

export const GuestShareCreateInput = Schema.Struct({
  threadId: ThreadId,
  /** Ends a link people can still join with and makes a new one, instead of returning it. */
  replace: Schema.optional(Schema.Boolean),
  /** How long a new guest link lasts, or with `extend` how long from now the current one does. */
  days: Schema.optional(GuestShareLifetimeDays),
  /**
   * Keeps the guest link people can still join with, and makes it last `days` from now, so
   * everyone on it stays. Without such a link a new one is made.
   */
  extend: Schema.optional(Schema.Boolean),
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
  /** The artifact card the reply should fill, which the owner sees before sending it. */
  artifactId: Schema.optional(RoomBoardNoteId),
  /** The guest's own thread box the message is for. Another person's box is refused. */
  boxId: Schema.optional(RoomBoardNoteId),
  /**
   * The cards written into `text`, as arrows name them (`note:<id>`). The owner's server labels
   * them from its board for the box to show; they never reach an agent apart from the text.
   */
  cardRefs: Schema.optional(
    Schema.Array(RoomBoardItemRef).check(Schema.isMaxLength(ROOM_BOX_CARD_LABELS_MAX)),
  ),
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
 * Lets the guest's own T Code post the turns it runs back to the room, read what the room said
 * since, and read an artifact card its user takes to their agent, until the share ends or the
 * guest is removed. The token opens nothing else.
 */
export const SharedThreadRoom = Schema.Struct({
  token: TrimmedNonEmptyString,
  /** When the share ends, so the guest's machine stops posting then. */
  expiresAt: IsoDateTime,
  /** The share, so the guest's machine can find this thread again from a link to the room. */
  shareId: Schema.optional(GuestShareId),
  /**
   * A session for the same guest, and the shared thread it reads, so the app the guest joined
   * from on their own machine shows the room and its board too. Absent from an older server and
   * for a team's share, whose members join as their account.
   */
  session: Schema.optional(TrimmedNonEmptyString),
  threadId: Schema.optional(ThreadId),
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
  /** Set on the thread behind one of the user's own thread boxes: its turns show on that box. */
  boxId: Schema.optional(RoomBoardNoteId),
  /** On the thread joined from the room: the thread here behind each of the user's boxes. */
  boxes: Schema.optional(Schema.Record(Schema.String, ThreadId)),
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
  /**
   * The artifact card the user asked this turn to fill, and what goes in it: made from the
   * whole reply, which `reply` may cut. One not on the share's board is ignored. Kept apart
   * from the turn, which the room stores at its shorter length.
   */
  artifact: Schema.optional(
    Schema.Struct({
      noteId: RoomBoardNoteId,
      body: RoomArtifactContent.fields.body,
      truncated: RoomArtifactContent.fields.truncated,
    }),
  ),
  /**
   * The guest's own thread box the turn ran in. It shows on that box instead of among the room's
   * turns; another person's box, or one no longer on the board, is ignored.
   */
  boxId: Schema.optional(RoomBoardNoteId),
  /** With `boxId`: the labels of the board cards that went with the prompt. */
  cards: Schema.optional(RoomBoxCardLabels),
  /** With `boxId`: the model's display name. */
  model: Schema.optional(RoomBoxModelName),
  /**
   * With `boxId`: the comment thread the user asked this turn to answer, and the answer, made
   * from the whole reply. One that is not a comment thread on the share's board is ignored.
   */
  comment: Schema.optional(
    Schema.Struct({
      noteId: RoomBoardNoteId,
      text: Schema.String.check(Schema.isMaxLength(ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH)),
    }),
  ),
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
  artifactId: RoomAgentActivity.fields.artifactId,
  code: RoomAgentActivity.fields.code,
  /** The guest's own thread box the turn runs in, which then shows what its agent is doing. */
  boxId: Schema.optional(RoomBoardNoteId),
  /** With `boxId`: the comment thread the turn's reply will be posted in. */
  commentId: RoomBoxProgress.fields.commentId,
  /** With `boxId`: what the agent is doing now, and what it has written so far. */
  phase: Schema.optional(RoomBoxProgress.fields.phase),
  detail: RoomBoxProgress.fields.detail,
  preview: RoomBoxProgress.fields.preview,
  draft: RoomBoxProgress.fields.draft,
  model: RoomBoxProgress.fields.model,
});
export type GuestAgentActivityRequest = typeof GuestAgentActivityRequest.Type;

/**
 * An artifact card as the guest's own T Code reads it, so the user's agent can revise it: its
 * title and what it shows now. Absent `body`: nothing filled it yet.
 */
export const RoomArtifactRead = Schema.Struct({
  title: RoomBoardNote.fields.text,
  body: Schema.optional(RoomArtifactContent.fields.body),
});
export type RoomArtifactRead = typeof RoomArtifactRead.Type;

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
/**
 * On the answer to a posted turn or activity: when the room ends now, as an ISO time. The owner
 * can extend a link, so the guest's machine moves its own end to this.
 */
export const GUEST_ROOM_EXPIRES_HEADER = "t3-room-expires-at";
/** What happened in the room since `?after=<ISO time>`, for a bearer room token. */
export const GUEST_ROOM_UPDATES_ROUTE = `${GUEST_ROUTE_PREFIX}/room/updates`;
/** One artifact card of the room's board, `?note=<id>`, as a `RoomArtifactRead`, for a room token. */
export const GUEST_ROOM_ARTIFACT_ROUTE = `${GUEST_ROUTE_PREFIX}/room/artifact`;
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
