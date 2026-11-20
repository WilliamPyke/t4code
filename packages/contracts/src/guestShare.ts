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
import { ModelSelection } from "./modelSelection.ts";

/**
 * A guest share lets a few unauthenticated browsers watch a thread over Tinkjam Connect and propose
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
export const ROOM_BOX_CARD_LABELS_MAX = 16;
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
  /** The same cards as arrows name them (`note:<id>`), whose lines are marked sent with it. */
  cardRefs: Schema.optional(
    Schema.Array(TrimmedNonEmptyString.check(Schema.isMaxLength(170))).check(
      Schema.isMaxLength(ROOM_BOX_CARD_LABELS_MAX),
    ),
  ),
});
export type ThreadGuestMessage = typeof ThreadGuestMessage.Type;

/**
 * One turn a guest ran in their own Tinkjam after joining from the room: their prompt and their
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
  /** The thread box whose turn answered, for a task someone ran there. */
  boxId: Schema.optional(RoomBoardNoteId),
});
export type RoomTaskAnswer = typeof RoomTaskAnswer.Type;

/**
 * The thread box someone ran a task in, and when: the box's next turn the board shows ticks it
 * off. Only `task.run` sets it; that turn takes it away.
 */
export const RoomTaskRun = Schema.Struct({ boxId: RoomBoardNoteId, at: IsoDateTime });
export type RoomTaskRun = typeof RoomTaskRun.Type;

/** A task's place in the board's Plan, in column order: to do, in progress, done. */
const ROOM_TASK_STATUSES = ["todo", "doing", "done"] as const;
export const RoomTaskStatus = Schema.Literals(ROOM_TASK_STATUSES);
export type RoomTaskStatus = typeof RoomTaskStatus.Type;
/** The day a task is due, as `YYYY-MM-DD`, with no time or zone. */
const RoomTaskDue = Schema.String.check(Schema.isPattern(/^\d{4}-(?:0[1-9]|1[0-2])-\d{2}$/));
/** How much a task matters, lowest first. A task with none has no priority. */
const ROOM_TASK_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const RoomTaskPriority = Schema.Literals(ROOM_TASK_PRIORITIES);
export type RoomTaskPriority = typeof RoomTaskPriority.Type;
/** Where a task sits in its Plan column: lower first. */
const RoomTaskOrder = Schema.Finite.check(Schema.isBetween({ minimum: -1e12, maximum: 1e12 }));

export const ROOM_BOARD_MIN_CARD_SIZE = 120;
/** The longest side a card can be given; a section, which frames many cards, goes further. */
export const ROOM_BOARD_MAX_CARD_SIZE = 8_000;
export const ROOM_BOARD_MAX_SECTION_SIZE = 20_000;
/** What hosts from before the larger sizes take: they refuse a longer side. */
export const ROOM_BOARD_LEGACY_MAX_CARD_SIZE = 1_600;
// One bound for every kind, the largest: whoever resizes keeps a card within its own kind's.
const RoomBoardLength = Schema.Int.check(
  Schema.isBetween({ minimum: ROOM_BOARD_MIN_CARD_SIZE, maximum: ROOM_BOARD_MAX_SECTION_SIZE }),
);
/** How big someone made a card, in board pixels. */
export const RoomBoardSize = Schema.Struct({ w: RoomBoardLength, h: RoomBoardLength });
export type RoomBoardSize = typeof RoomBoardSize.Type;

export const ROOM_BOARD_QUOTE_MAX_LENGTH = 280;

export const ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH = 300;
export const ROOM_BOARD_MARK_TEXT_MAX_LENGTH = 200;
const RoomBoardMarkText = Schema.String.check(Schema.isMaxLength(ROOM_BOARD_MARK_TEXT_MAX_LENGTH));

/**
 * Where in an artifact's page a note points, as its author's client read it from the page: text
 * from an agent-written page, never evaluated. `selector` finds the element in the page's source.
 */
export const RoomBoardMark = Schema.Struct({
  selector: TrimmedNonEmptyString.check(Schema.isMaxLength(ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH)),
  /** The element's tag name, lower case. */
  tag: Schema.optional(Schema.String.check(Schema.isMaxLength(32))),
  /** The start of the element's own text. */
  text: Schema.optional(RoomBoardMarkText),
  /** The text the person had selected in it. */
  quote: Schema.optional(RoomBoardMarkText),
});
export type RoomBoardMark = typeof RoomBoardMark.Type;
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

/**
 * The model someone picked for a thread box, on the machine that runs the box: the owner's for
 * theirs, a guest's own for a guest's box. Its next prompt runs on it until a later run or pick.
 */
export const RoomBoxModel = Schema.Struct({
  selection: ModelSelection,
  /** Its display name, as the picker's machine names it, for everyone else. */
  name: RoomBoxModelName,
  /** When it was picked, as the server that holds the board took it. */
  at: IsoDateTime,
});
export type RoomBoxModel = typeof RoomBoxModel.Type;

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
  /** A person wrote this version by hand (`artifact.write`): `guestId` is theirs, not an agent's. */
  byHand: Schema.optional(Schema.Literal(true)),
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

export const ROOM_BOARD_MAX_CODE_WINDOWS = 6;
/** What a code window lists: at most this many files, each path cut to this length. */
export const ROOM_CODE_MAX_FILES = 50;
export const ROOM_CODE_PATH_MAX_LENGTH = 300;
/** The longest patch of one file a code window opens. Longer ones say they are too large. */
export const ROOM_CODE_PATCH_MAX_LENGTH = 200_000;

const RoomLineCount = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

/** One file a thread box's thread changed, as its code window lists it. */
export const RoomCodeFile = Schema.Struct({
  path: Schema.String.check(Schema.isMaxLength(ROOM_CODE_PATH_MAX_LENGTH)),
  additions: RoomLineCount,
  deletions: RoomLineCount,
  /** What the thread's last turn changed in it, when it changed it. */
  lastTurn: Schema.optional(Schema.Struct({ additions: RoomLineCount, deletions: RoomLineCount })),
});
export type RoomCodeFile = typeof RoomCodeFile.Type;

/**
 * What a thread changed from its start to one of its turns, as the machine that ran it counted
 * it: the files, never their patches, which are read when someone opens one.
 */
export const RoomCodeDiffSummary = Schema.Struct({
  files: Schema.Array(RoomCodeFile).check(Schema.isMaxLength(ROOM_CODE_MAX_FILES)),
  /** Changed files left out after the first `ROOM_CODE_MAX_FILES`. */
  more: Schema.optional(RoomLineCount),
  /** Lines added and removed in every changed file, those left out too. */
  additions: RoomLineCount,
  deletions: RoomLineCount,
  /** The diff was longer than the machine reads, so the counts may be short. */
  truncated: Schema.optional(Schema.Literal(true)),
  /** Which of the thread's turns it is up to, as a patch read names it. */
  turnCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(1)),
});
export type RoomCodeDiffSummary = typeof RoomCodeDiffSummary.Type;

/**
 * What a code window shows of the thread box it has a line from. Only the owner's server writes
 * it: from a turn of the owner's, or one a guest's machine posted for the guest's own box.
 */
export const RoomCodeChanges = Schema.Struct({
  ...RoomCodeDiffSummary.fields,
  /** The box whose thread made them: `ROOM_BOARD_ROOM_BOX` for the room thread. */
  boxId: RoomBoardNoteId,
  /** The guest whose agent made them, on their machine. Absent: the owner's. */
  guestId: Schema.optional(GuestId),
  /** The run that ended with them, as the machine that ran it named it. */
  turnId: ThreadGuestTurn.fields.id,
  updatedAt: IsoDateTime,
});
export type RoomCodeChanges = typeof RoomCodeChanges.Type;

/** Which changes of a code window's thread a patch shows: since the thread began, or its last turn. */
export const RoomCodePatchScope = Schema.Literals(["thread", "turn"]);
export type RoomCodePatchScope = typeof RoomCodePatchScope.Type;

/** One file's patch, as a code window opens it. Without `patch`, the file is too large to show. */
export const RoomCodePatch = Schema.Struct({
  path: RoomCodeFile.fields.path,
  patch: Schema.optional(Schema.String.check(Schema.isMaxLength(ROOM_CODE_PATCH_MAX_LENGTH))),
});
export type RoomCodePatch = typeof RoomCodePatch.Type;

export const ROOM_BOARD_MAX_PULL_REQUESTS = 10;
/** The failing checks a pull request window names; the rest it counts. */
export const ROOM_PULL_REQUEST_MAX_FAILING_NAMES = 8;

const ROOM_PULL_REQUEST_URL =
  /^https:\/\/github\.com\/([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))\/([A-Za-z0-9._-]{1,100})\/pull\/([1-9][0-9]{0,9})(?:[/?#].*)?$/;

/**
 * The GitHub pull request a URL names, as `owner/repo` and its number, or null for anything but a
 * github.com pull request URL. The owner's server reads only what this accepts.
 */
export function roomPullRequestOf(
  value: string,
): { readonly repository: string; readonly number: number; readonly url: string } | null {
  const match = ROOM_PULL_REQUEST_URL.exec(value.trim());
  if (match === null) return null;
  const [, owner, repo, number] = match;
  if (owner === undefined || repo === undefined || number === undefined) return null;
  if (repo === "." || repo === "..") return null;
  const repository = `${owner}/${repo}`;
  return {
    repository,
    number: Number(number),
    url: `https://github.com/${repository}/pull/${number}`,
  };
}

const RoomPullRequestText = (max: number) => Schema.String.check(Schema.isMaxLength(max));

/** One pull request as its window shows it, read by the owner's server from GitHub. */
export const RoomPullRequest = Schema.Struct({
  title: RoomPullRequestText(300),
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  headBranch: RoomPullRequestText(255),
  baseBranch: RoomPullRequestText(255),
  /** Absent when the commits could not be counted; `moreCommits` when there are more than that. */
  commits: Schema.optional(RoomLineCount),
  moreCommits: Schema.optional(Schema.Literal(true)),
  changedFiles: RoomLineCount,
  additions: RoomLineCount,
  deletions: RoomLineCount,
  checks: Schema.Struct({
    passing: RoomLineCount,
    failing: RoomLineCount,
    pending: RoomLineCount,
    /** The first failing checks' names. */
    failingNames: Schema.Array(RoomPullRequestText(200)).check(
      Schema.isMaxLength(ROOM_PULL_REQUEST_MAX_FAILING_NAMES),
    ),
  }),
  /** When GitHub last saw it change. */
  updatedAt: IsoDateTime,
});
export type RoomPullRequest = typeof RoomPullRequest.Type;

/** Why a pull request window has no pull request to show. */
export const RoomPullRequestProblem = Schema.Literals(["not_found", "signed_out", "unavailable"]);
export type RoomPullRequestProblem = typeof RoomPullRequestProblem.Type;

/**
 * The last read of a pull request window's pull request: what it showed, or why it could not be
 * read. Only the owner's server writes it, from its own GitHub sign-in.
 */
export const RoomPullRequestRead = Schema.Struct({
  readAt: IsoDateTime,
  pullRequest: Schema.optional(RoomPullRequest),
  problem: Schema.optional(RoomPullRequestProblem),
});
export type RoomPullRequestRead = typeof RoomPullRequestRead.Type;

/** Replies one comment thread holds after its first comment. */
export const ROOM_BOARD_MAX_REPLIES = 30;
/** How much of an agent's answer a comment thread keeps, longer than a person's reply. */
export const ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH = 1_200;

/** People one note, task, comment or reply names with `@`. */
const ROOM_BOARD_MAX_MENTIONS = 10;

/**
 * Someone a card or reply names with `@Name`, which its text keeps: a person on the board
 * (`guestId`), or a member of the board's workspace who has not opened it yet (`memberId`). Exactly
 * one of the two. Never an email or an account id. It only tells that person; it never reaches an
 * agent's prompt as anything but the text.
 */
export const RoomBoardMention = Schema.Struct({
  guestId: Schema.optional(GuestId),
  memberId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(64))),
  /** The name as it was picked, which follows the `@` in the text. */
  name: TrimmedNonEmptyString.check(Schema.isMaxLength(GUEST_NAME_MAX_LENGTH)),
});
export type RoomBoardMention = typeof RoomBoardMention.Type;
const RoomBoardMentions = Schema.Array(RoomBoardMention).check(
  Schema.isMaxLength(ROOM_BOARD_MAX_MENTIONS),
);

/** The reactions anyone can leave on a card or a comment. */
export const ROOM_BOARD_REACTIONS = ["👍", "❤️", "🎉", "👀", "✅", "❓"] as const;
export const RoomBoardReactionEmoji = Schema.Literals(ROOM_BOARD_REACTIONS);
export type RoomBoardReactionEmoji = typeof RoomBoardReactionEmoji.Type;
/** Reactions one card holds, from everyone. */
export const ROOM_BOARD_MAX_REACTIONS = 60;
/** Reactions one comment in a thread holds, its first or a reply, from everyone. */
export const ROOM_COMMENT_MAX_REACTIONS = 20;

/** Someone's reaction on a card or a comment. */
export const RoomBoardReaction = Schema.Struct({
  emoji: RoomBoardReactionEmoji,
  /** The guest who reacted. Absent on the owner's. */
  guestId: Schema.optional(GuestId),
});
export type RoomBoardReaction = typeof RoomBoardReaction.Type;

/** A reply in a comment thread on the board. */
export const RoomBoardReply = Schema.Struct({
  /** The client that adds the reply names it, or the owner's server for an agent's. */
  id: RoomBoardNoteId,
  /** A person's is plain text; an agent's is markdown, and plain prose from an older server. */
  text: Schema.String.check(Schema.isMaxLength(ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH)),
  /** The guest who wrote it, or whose agent did. Absent on the owner's and their agent's. */
  guestId: Schema.optional(GuestId),
  /** People it names with `@`. */
  mentions: Schema.optional(RoomBoardMentions),
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
  /** Who reacted with what, oldest first. Only `note.react` with this reply's id sets them. */
  reactions: Schema.optional(
    Schema.Array(RoomBoardReaction).check(Schema.isMaxLength(ROOM_COMMENT_MAX_REACTIONS)),
  ),
});
export type RoomBoardReply = typeof RoomBoardReply.Type;

/** A thread box's agent that changed the board: `ROOM_BOARD_ROOM_BOX` for the room thread. */
export const RoomBoardAgentMark = Schema.Struct({
  boxId: RoomBoardNoteId,
  model: Schema.optional(RoomBoxModelName),
  /** The run that made the change. Absent on cards from before it was kept. */
  turnId: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(128))),
  /** The guest whose request the owner's agent ran. Absent: the owner's own. */
  askedBy: Schema.optional(GuestId),
});
export type RoomBoardAgentMark = typeof RoomBoardAgentMark.Type;

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

/**
 * A card someone added to the board: a note unless `kind` names another card. A note with
 * `pinnedTo` comments on that message. An artifact's, thread box's, code window's or pull request
 * window's `text` is its title; a comment thread's is its first comment.
 */
export const RoomBoardNote = Schema.Struct({
  /** The client that adds the note names it. */
  id: RoomBoardNoteId,
  text: Schema.String.check(Schema.isMaxLength(ROOM_BOARD_NOTE_MAX_LENGTH)),
  ...RoomBoardPoint.fields,
  /** The guest who added it. Absent on the owner's notes. */
  guestId: Schema.optional(GuestId),
  kind: Schema.optional(
    Schema.Literals(["task", "link", "artifact", "thread", "comment", "code", "pull-request"]),
  ),
  /** A task that is done. */
  done: Schema.optional(Schema.Boolean),
  /**
   * A task someone started that is not done. To do and done are `done`'s, so a client that
   * predates it reads every task as before. `roomTaskStatus` reads a task's status.
   */
  status: Schema.optional(Schema.Literal("doing")),
  /** The day a task is due. */
  due: Schema.optional(RoomTaskDue),
  /** Where a task sits in its Plan column. Absent: after the ones that have one. */
  order: Schema.optional(RoomTaskOrder),
  /** How much a task matters. Absent: no priority. */
  priority: Schema.optional(RoomTaskPriority),
  assignee: Schema.optional(RoomBoardAssignee),
  /** People a note, task or comment names with `@`, each while its text still does. */
  mentions: Schema.optional(RoomBoardMentions),
  /**
   * A link card's address, which clients read and the server never fetches, or a pull request
   * window's GitHub pull request URL as `roomPullRequestOf` writes it.
   */
  url: Schema.optional(RoomBoardUrl),
  /**
   * A link card someone chose to show its page in, for a source the board does not frame itself.
   * Each viewer's client still decides whether the address is safe to frame, and loads it only
   * once they ask.
   */
  framed: Schema.optional(Schema.Literal(true)),
  /** The id of the thread's message this comment is pinned to. */
  pinnedTo: Schema.optional(TrimmedNonEmptyString.check(Schema.isMaxLength(256))),
  /** A task someone's agent answered. No board change sets it; it stays when the task changes. */
  answer: Schema.optional(RoomTaskAnswer),
  /** A task a thread box is running now, or ran without finishing. */
  run: Schema.optional(RoomTaskRun),
  /** The start of the reply a comment is pinned to, as its author's client read it. */
  quote: Schema.optional(Schema.String.check(Schema.isMaxLength(ROOM_BOARD_QUOTE_MAX_LENGTH))),
  /** A plain note that points at part of an artifact's page. Set when it is added, never after. */
  mark: Schema.optional(RoomBoardMark),
  /** Absent until someone resizes the card. */
  size: Schema.optional(RoomBoardSize),
  /** A plain note's or a section's colour, once someone picked one. */
  color: Schema.optional(RoomBoardNoteColor),
  /**
   * A section: a titled frame drawn behind the cards, whose `text` is its title. It holds nothing:
   * the cards over it are only where they are. Set when it is added, never after. Not a `kind`,
   * so a client that predates it still reads the board and shows it as a note.
   */
  section: Schema.optional(Schema.Literal(true)),
  /** What an agent wrote into an artifact. No board change sets it. */
  artifact: Schema.optional(RoomArtifactContent),
  /**
   * An artifact that is a live view of another: it holds no content and shows that one's, at its
   * own size. Only `artifact.view` sets it; `artifact.copy` and removing the source clear it.
   */
  viewOf: Schema.optional(RoomBoardNoteId),
  /** A thread box's recent turns. No board change sets it; it stays when the box changes. */
  thread: Schema.optional(RoomBoxState),
  /** A thread box's model, once someone picked one. Only `box.model` sets it. */
  boxModel: Schema.optional(RoomBoxModel),
  /** What a code window's box changed, as of its last turn. No board change sets it. */
  changes: Schema.optional(RoomCodeChanges),
  /** A pull request window's last read of its pull request. No board change sets it. */
  pullRequest: Schema.optional(RoomPullRequestRead),
  /** When a comment thread was started, as the server that holds the board took it. */
  createdAt: Schema.optional(IsoDateTime),
  /** When its text or a task's status last changed, as the server took it. */
  editedAt: Schema.optional(IsoDateTime),
  /** Who made that edit: a guest, or null for the owner. Absent on cards from before it was kept. */
  editedBy: Schema.optional(Schema.NullOr(GuestId)),
  /**
   * Who added it or last changed what it says (text, status, assignee, colour), and when, as the
   * server took it. No guest is the owner. Absent on cards from before it was kept.
   */
  changed: Schema.optional(Schema.Struct({ at: IsoDateTime, guestId: Schema.optional(GuestId) })),
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
  /** The owner's thread box whose agent added it. Only the owner's server sets it. */
  agent: Schema.optional(RoomBoardAgentMark),
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
  /** The guest who drew it. Absent: the owner, an agent, or a line from before it was kept. */
  guestId: Schema.optional(GuestId),
  /**
   * When a prompt last carried the card this line starts at, along this line, as the server that
   * took the prompt stamped it. No board change sets it. Absent: never sent.
   */
  sentAt: Schema.optional(IsoDateTime),
  /**
   * On a line between two cards, which several boxes can reach: when a prompt from each box,
   * by box id, last carried the card along it. `sentAt` is for lines into a box or its artifact.
   */
  sentFor: Schema.optional(Schema.Record(Schema.String, IsoDateTime)),
  /**
   * On a line from a section, which carries every card in it: when a prompt from each box, by box
   * id, last carried each card along it, by the card's ref. Only cards still in the section stay.
   */
  sentCards: Schema.optional(
    Schema.Record(Schema.String, Schema.Record(Schema.String, IsoDateTime)),
  ),
  /**
   * When a run that carried the card along this line finished, beside `sentAt`, `sentFor` and
   * `sentCards` each. Only the server that records the run sets them. Absent: not finished, or a
   * server from before runs were marked.
   */
  doneAt: Schema.optional(IsoDateTime),
  doneFor: Schema.optional(Schema.Record(Schema.String, IsoDateTime)),
  doneCards: Schema.optional(
    Schema.Record(Schema.String, Schema.Record(Schema.String, IsoDateTime)),
  ),
  /** The card goes with every prompt along this line, not only while it is new. */
  pinned: Schema.optional(Schema.Literal(true)),
  /** Drawn with straight runs and square corners, around other cards. Absent: a curve. */
  shape: Schema.optional(Schema.Literal("elbow")),
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

/** A card as an agent's turn found it or left it. `kind` and `section` never change. */
export const RoomBoardAgentCardState = Schema.Struct({
  text: RoomBoardNote.fields.text,
  ...RoomBoardPoint.fields,
  done: RoomBoardNote.fields.done,
  size: RoomBoardNote.fields.size,
  kind: RoomBoardNote.fields.kind,
  section: RoomBoardNote.fields.section,
  /** A task's plan, so undoing a turn puts it back too. Absent on turns from before it was kept. */
  status: RoomBoardNote.fields.status,
  due: RoomBoardNote.fields.due,
  priority: RoomBoardNote.fields.priority,
  assignee: RoomBoardNote.fields.assignee,
});
export type RoomBoardAgentCardState = typeof RoomBoardAgentCardState.Type;

/** The removed comment threads a board keeps for undo. */
export const ROOM_BOARD_REMOVED_MAX = 10;

/** The agent turns a board remembers, newest last, so each can be shown and taken back. */
export const ROOM_BOARD_AGENT_TURNS_MAX = 8;

/** What one turn of a thread box's agent did to the board. Only the owner's server writes it. */
export const RoomBoardAgentTurn = Schema.Struct({
  /** The run, as `RoomBoardAgentMark.turnId`. */
  id: TrimmedNonEmptyString.check(Schema.isMaxLength(128)),
  boxId: RoomBoardNoteId,
  model: Schema.optional(RoomBoxModelName),
  askedBy: Schema.optional(GuestId),
  /** The guest whose own machine ran it, whose cards they are. Absent: the owner's server. */
  guestId: Schema.optional(GuestId),
  /** When it last changed the board. */
  at: IsoDateTime,
  /** Each card it added (no `before`) or changed, as it found it and as it left it. */
  cards: Schema.Array(
    Schema.Struct({
      id: RoomBoardNoteId,
      before: Schema.optional(RoomBoardAgentCardState),
      after: RoomBoardAgentCardState,
    }),
  ).check(Schema.isMaxLength(ROOM_BOARD_MAX_NOTES * 2)),
  /** The lines it drew. */
  edges: Schema.optional(
    Schema.Array(
      Schema.Struct({
        id: RoomBoardEdge.fields.id,
        from: RoomBoardEdge.fields.from,
        to: RoomBoardEdge.fields.to,
      }),
    ).check(Schema.isMaxLength(ROOM_BOARD_MAX_EDGES)),
  ),
  /** Taken back with `agent-turn.undo`; a redo clears it. */
  undone: Schema.optional(Schema.Literal(true)),
});
export type RoomBoardAgentTurn = typeof RoomBoardAgentTurn.Type;

/** Cards one board tool call adds at most. */
const ROOM_BOARD_AGENT_MAX_CARDS = 20;
/** Changes one board tool call makes at most: one call can plan every card one add makes, twice. */
const ROOM_BOARD_AGENT_MAX_CHANGES = 40;
// Models read these messages when they send too many, so they say how to carry on.
const ROOM_BOARD_AGENT_CARDS_CAP = `At most ${ROOM_BOARD_AGENT_MAX_CARDS} cards per call; add the rest in a second call.`;
const ROOM_BOARD_AGENT_CHANGES_CAP = `At most ${ROOM_BOARD_AGENT_MAX_CHANGES} changes per call; send the rest in a second call.`;
const RoomBoardAgentCardText = TrimmedNonEmptyString.check(
  Schema.isMaxLength(ROOM_BOARD_NOTE_MAX_LENGTH),
);
/** A card as an agent names it: its id, or `thread` for the room thread's own card. */
const RoomBoardAgentCardId = TrimmedNonEmptyString.check(Schema.isMaxLength(170));

/** Someone a board tool names: "me" for the box's owner, or a person's name as the board shows it. */
const RoomBoardAgentPerson = TrimmedNonEmptyString.check(
  Schema.isMaxLength(GUEST_NAME_MAX_LENGTH),
).annotate({
  description: '"me" (your user) or a name in `people` from t3_board_read. Never guess.',
});
const RoomBoardAgentDue = RoomTaskDue.annotate({ description: "YYYY-MM-DD." });

/** The board tools' input and answers, which a guest's machine also sends to the room's owner. */
export const RoomBoardAgentAddInput = Schema.Struct({
  cards: Schema.Array(
    Schema.Struct({
      text: RoomBoardAgentCardText,
      task: Schema.optional(Schema.Boolean),
      /** Any of these makes the card a task. */
      status: Schema.optional(RoomTaskStatus),
      priority: Schema.optional(RoomTaskPriority),
      due: Schema.optional(RoomBoardAgentDue),
      assignee: Schema.optional(RoomBoardAgentPerson),
    }),
  )
    .check(Schema.isMaxLength(ROOM_BOARD_AGENT_MAX_CARDS, { message: ROOM_BOARD_AGENT_CARDS_CAP }))
    .annotate({ description: ROOM_BOARD_AGENT_CARDS_CAP }),
  /** A section's id or title. A title no section has makes a new one. */
  section: Schema.optional(RoomBoardAgentCardText),
});
export type RoomBoardAgentAddInput = typeof RoomBoardAgentAddInput.Type;

export const RoomBoardAgentUpdateInput = Schema.Struct({
  changes: Schema.Array(
    Schema.Struct({
      id: RoomBoardAgentCardId,
      text: Schema.optional(RoomBoardAgentCardText),
      done: Schema.optional(Schema.Boolean),
      status: Schema.optional(RoomTaskStatus),
      /** null clears it. */
      priority: Schema.optional(Schema.NullOr(RoomTaskPriority)),
      due: Schema.optional(Schema.NullOr(RoomBoardAgentDue)),
      assignee: Schema.optional(Schema.NullOr(RoomBoardAgentPerson)),
      section: Schema.optional(RoomBoardAgentCardText),
      lineTo: Schema.optional(RoomBoardAgentCardId),
    }),
  )
    .check(
      Schema.isMinLength(1),
      Schema.isMaxLength(ROOM_BOARD_AGENT_MAX_CHANGES, { message: ROOM_BOARD_AGENT_CHANGES_CAP }),
    )
    .annotate({ description: ROOM_BOARD_AGENT_CHANGES_CAP }),
});
export type RoomBoardAgentUpdateInput = typeof RoomBoardAgentUpdateInput.Type;

/** Steps one arrange call takes at most, and the cards they move between them. */
const ROOM_BOARD_AGENT_MAX_OPS = 20;
export const ROOM_BOARD_AGENT_MAX_ARRANGED = 60;
const ROOM_BOARD_AGENT_OPS_CAP = `At most ${ROOM_BOARD_AGENT_MAX_OPS} ops per call; send the rest in a second call.`;
export const ROOM_BOARD_AGENT_ARRANGED_CAP = `At most ${ROOM_BOARD_AGENT_MAX_ARRANGED} cards per call; send the rest in a second call.`;
const RoomBoardAgentSection = RoomBoardAgentCardText.annotate({
  description: "A section's id or title.",
});
const RoomBoardAgentNewSection = RoomBoardAgentCardText.annotate({
  description: "A section's id or title. A title no section has makes a new one.",
});
// Any number: what is out of range is clamped, or refused with a reason the model can read.
const RoomBoardAgentNumber = Schema.Finite;

/** One step of arranging the board. Each is done whole or refused, apart from the others. */
export const RoomBoardAgentArrangeOp = Schema.Union([
  Schema.Struct({
    do: Schema.Literal("layout"),
    cards: Schema.Array(RoomBoardAgentCardId)
      .check(
        Schema.isMinLength(1),
        Schema.isMaxLength(ROOM_BOARD_AGENT_MAX_ARRANGED, {
          message: ROOM_BOARD_AGENT_ARRANGED_CAP,
        }),
      )
      .annotate({ description: "Card ids, in the order they should sit." }),
    as: Schema.Literals(["row", "column", "grid"]),
    in: Schema.optional(RoomBoardAgentNewSection),
    columns: Schema.optional(
      Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 12 })).annotate({
        description: "For a grid. Absent: as many as fit the section, or a near-square.",
      }),
    ),
  }),
  Schema.Struct({
    do: Schema.Literal("place"),
    card: RoomBoardAgentCardId,
    side: Schema.Literals(["right", "left", "above", "below"]),
    of: RoomBoardAgentCardId,
  }),
  Schema.Struct({ do: Schema.Literal("tidy"), section: RoomBoardAgentSection }),
  Schema.Struct({ do: Schema.Literal("fit"), section: RoomBoardAgentSection }),
  Schema.Struct({
    do: Schema.Literal("move"),
    card: RoomBoardAgentCardId,
    x: RoomBoardAgentNumber,
    y: RoomBoardAgentNumber,
  }),
  Schema.Struct({
    do: Schema.Literal("resize"),
    card: RoomBoardAgentCardId,
    w: RoomBoardAgentNumber,
    h: RoomBoardAgentNumber,
  }),
  Schema.Struct({
    do: Schema.Literal("rename"),
    card: RoomBoardAgentCardId,
    title: RoomBoardAgentCardText,
  }),
]);
export type RoomBoardAgentArrangeOp = typeof RoomBoardAgentArrangeOp.Type;

export const RoomBoardAgentArrangeInput = Schema.Struct({
  ops: Schema.Array(RoomBoardAgentArrangeOp)
    .check(
      Schema.isMinLength(1),
      Schema.isMaxLength(ROOM_BOARD_AGENT_MAX_OPS, { message: ROOM_BOARD_AGENT_OPS_CAP }),
    )
    .annotate({ description: ROOM_BOARD_AGENT_OPS_CAP }),
});
export type RoomBoardAgentArrangeInput = typeof RoomBoardAgentArrangeInput.Type;

/** What an arrange call changed, and the ops, by their place in the call, the board refused. */
export const RoomBoardAgentArrangeResult = Schema.Struct({
  moved: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      x: Schema.Number,
      y: Schema.Number,
      w: Schema.Number,
      h: Schema.Number,
    }),
  ),
  renamed: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  /** Sections a layout made, for a title no section had. */
  sections: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  ),
  refused: Schema.Array(Schema.Struct({ op: Schema.Number, reason: Schema.String })),
});
export type RoomBoardAgentArrangeResult = typeof RoomBoardAgentArrangeResult.Type;

export const RoomBoardAgentView = Schema.Struct({
  /** The id of this thread's own box. */
  you: Schema.String,
  cards: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      text: Schema.String,
      by: Schema.String,
      done: Schema.optional(Schema.Boolean),
      /** A task's plan. Absent from an older server. */
      status: Schema.optional(RoomTaskStatus),
      priority: Schema.optional(RoomTaskPriority),
      due: Schema.optional(Schema.String),
      assignee: Schema.optional(Schema.String),
      section: Schema.optional(Schema.String),
      /** Its top left corner on the board. */
      x: Schema.optional(Schema.Number),
      y: Schema.optional(Schema.Number),
      /** Its size as the board draws it. Absent from an older server, as `color` and `url` are. */
      w: Schema.optional(Schema.Number),
      h: Schema.optional(Schema.Number),
      color: Schema.optional(Schema.String),
      /** A link card's address. */
      url: Schema.optional(Schema.String),
    }),
  ),
  lines: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
  /** Cards with a line to or from this thread's box, and the cards in a section that has one. */
  attachedToYou: Schema.optional(Schema.Array(Schema.String)),
  /** Who a task can be for; `me` marks this box's user. */
  people: Schema.optional(
    Schema.Array(Schema.Struct({ name: Schema.String, me: Schema.optional(Schema.Boolean) })),
  ),
  /** Cards and lines left out to keep the answer short. */
  omitted: Schema.optional(Schema.Struct({ cards: Schema.Number, lines: Schema.Number })),
});
export type RoomBoardAgentView = typeof RoomBoardAgentView.Type;

export const RoomBoardAgentResult = Schema.Struct({
  /** Cards added, or changed, by id. */
  done: Schema.Array(Schema.String),
  /** Sections this call made. */
  sections: Schema.optional(
    Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String })),
  ),
  /** What the board did not take, and why. */
  refused: Schema.Array(Schema.Struct({ card: Schema.String, reason: Schema.String })),
});
export type RoomBoardAgentResult = typeof RoomBoardAgentResult.Type;

/**
 * One board tool call of the agent of a guest's own box, run on their machine. The owner's server
 * makes it as that guest's, marked as that box's agent in that run (`turnId`).
 */
export const RoomBoardAgentChangeRequest = Schema.Struct({
  boxId: RoomBoardNoteId,
  turnId: Schema.optional(RoomBoardAgentTurn.fields.id),
  model: Schema.optional(RoomBoxModelName),
  change: Schema.Union([
    Schema.Struct({ add: RoomBoardAgentAddInput }),
    Schema.Struct({ update: RoomBoardAgentUpdateInput }),
    /** A host from before it refuses the request as not valid. */
    Schema.Struct({ arrange: RoomBoardAgentArrangeInput }),
  ]),
});
export type RoomBoardAgentChangeRequest = typeof RoomBoardAgentChangeRequest.Type;

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
  /** The last few agent turns that changed it, newest last. Absent until an agent changes it. */
  agentTurns: Schema.optional(
    Schema.Array(RoomBoardAgentTurn).check(Schema.isMaxLength(ROOM_BOARD_AGENT_TURNS_MAX)),
  ),
  /** The room thread's own box's model, once the owner picked one. Only `box.model` sets it. */
  roomBoxModel: Schema.optional(RoomBoxModel),
  /**
   * The card or section someone opening the board for the first time starts at, when the whole
   * board is too big to read at once. Only `board.start` sets it; one no longer on the board is
   * ignored. Absent: the top-left section.
   */
  start: Schema.optional(RoomBoardNoteId),
  /**
   * Comment threads removed lately, newest last, so an undo can put one back with its replies,
   * which no change can send again. Only `note.remove` fills it and `note.put` of the same id
   * takes one back; a day later, or past the cap, it is gone for good.
   */
  removed: Schema.optional(
    Schema.Array(Schema.Struct({ note: RoomBoardNote, at: IsoDateTime })).check(
      Schema.isMaxLength(ROOM_BOARD_REMOVED_MAX),
    ),
  ),
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
   * Adds the note, or replaces the one with this id; `kind`, `url`, `pinnedTo`, `quote`, `mark` and
   * `section` stay as added. Absent `size`, `done`, `status`, `due`, `order`, `priority`, `assignee`
   * and `color` stay as they were, so an older client's edit keeps them; a null `assignee`, `due` or
   * `priority` clears it. `status` sets `done` too, and the two must agree when both are sent.
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
    mark: RoomBoardNote.fields.mark,
    size: RoomBoardNote.fields.size,
    done: RoomBoardNote.fields.done,
    status: Schema.optional(RoomTaskStatus),
    due: Schema.optional(Schema.NullOr(RoomTaskDue)),
    order: RoomBoardNote.fields.order,
    priority: Schema.optional(Schema.NullOr(RoomTaskPriority)),
    assignee: Schema.optional(Schema.NullOr(RoomBoardAssignee)),
    color: RoomBoardNote.fields.color,
    /** Absent keeps what it had, as an older client's edit does; false clears it. */
    framed: Schema.optional(Schema.Boolean),
    section: RoomBoardNote.fields.section,
    /** Absent keeps those it had whose `@Name` the text still has. */
    mentions: RoomBoardNote.fields.mentions,
  }),
  /** Removes the note and its arrows. */
  Schema.Struct({ type: Schema.Literal("note.remove"), noteId: RoomBoardNote.fields.id }),
  /** Adds an arrow. One that exists, or one between the same two cards, changes nothing. */
  Schema.Struct({
    type: Schema.Literal("edge.put"),
    edgeId: RoomBoardEdge.fields.id,
    from: RoomBoardEdge.fields.from,
    to: RoomBoardEdge.fields.to,
    shape: RoomBoardEdge.fields.shape,
  }),
  Schema.Struct({ type: Schema.Literal("edge.remove"), edgeId: RoomBoardEdge.fields.id }),
  /** Draws an arrow as a curve or with square corners. */
  Schema.Struct({
    type: Schema.Literal("edge.shape"),
    edgeId: RoomBoardEdge.fields.id,
    shape: Schema.Literals(["curve", "elbow"]),
  }),
  /** Makes the card an arrow carries go with every prompt, or only while it is new again. */
  Schema.Struct({
    type: Schema.Literal("edge.pin"),
    edgeId: RoomBoardEdge.fields.id,
    pinned: Schema.Boolean,
  }),
  /**
   * Forgets that a prompt carried the card along this arrow, and that a run finished with it, so
   * it goes with the next prompt someone sends. `card`: only that card of a section's line.
   */
  Schema.Struct({
    type: Schema.Literal("edge.resend"),
    edgeId: RoomBoardEdge.fields.id,
    card: Schema.optional(RoomBoardEdge.fields.from),
  }),
  /**
   * Swaps an artifact's content with the version it replaced, so a second restore undoes the
   * first. An artifact with no earlier version stays as it is.
   */
  Schema.Struct({ type: Schema.Literal("artifact.restore"), noteId: RoomBoardNote.fields.id }),
  /**
   * Writes an artifact's body by hand, as its author's version: the one it replaces is kept for
   * `artifact.restore`, as when an agent fills it. Markdown, or a whole HTML page.
   */
  Schema.Struct({
    type: Schema.Literal("artifact.write"),
    noteId: RoomBoardNote.fields.id,
    body: Schema.String.check(Schema.isMaxLength(ROOM_ARTIFACT_MAX_LENGTH)),
  }),
  /**
   * Gives the empty artifact `noteId`, or a view, artifact `fromNoteId`'s version as its own, as it
   * is: its author, prompt, time and the version it replaced. A view stops following, even one of
   * an artifact still empty. One that has content stays as it is.
   */
  Schema.Struct({
    type: Schema.Literal("artifact.copy"),
    noteId: RoomBoardNote.fields.id,
    fromNoteId: RoomBoardNote.fields.id,
  }),
  /**
   * Makes the artifact `noteId`, which has no content of its own, a live view of artifact
   * `fromNoteId`, or of the one that is a view of. Writing or restoring a view changes its source.
   */
  Schema.Struct({
    type: Schema.Literal("artifact.view"),
    noteId: RoomBoardNote.fields.id,
    fromNoteId: RoomBoardNote.fields.id,
  }),
  /** Adds a reply to a comment thread. A reply id it already has changes nothing. */
  Schema.Struct({
    type: Schema.Literal("comment.reply"),
    noteId: RoomBoardNote.fields.id,
    replyId: RoomBoardReply.fields.id,
    text: Schema.String.check(Schema.isMaxLength(ROOM_BOARD_NOTE_MAX_LENGTH)),
    mentions: RoomBoardReply.fields.mentions,
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
  /**
   * Adds the sender's own reaction to a card, or takes it back if they had it. On a comment
   * thread it goes on the first comment, or on the reply `replyId` names.
   */
  Schema.Struct({
    type: Schema.Literal("note.react"),
    noteId: RoomBoardNote.fields.id,
    emoji: RoomBoardReactionEmoji,
    replyId: Schema.optional(RoomBoardReply.fields.id),
  }),
  /**
   * Takes back everything one agent turn did to the board (`undone: true`), or does it again,
   * leaving each card someone changed since. For the owner and whoever asked for the turn.
   */
  Schema.Struct({
    type: Schema.Literal("agent-turn.undo"),
    turnId: RoomBoardAgentTurn.fields.id,
    undone: Schema.Boolean,
  }),
  /**
   * Picks the model a thread box runs on. For the owner and whoever added the box;
   * `ROOM_BOARD_ROOM_BOX` names the room thread's own box, which only the owner picks for.
   */
  Schema.Struct({
    type: Schema.Literal("box.model"),
    noteId: RoomBoardNote.fields.id,
    modelSelection: RoomBoxModel.fields.selection,
    name: RoomBoxModel.fields.name,
  }),
  /**
   * Runs an open task in one of the author's own thread boxes, making it theirs, before the
   * prompt goes; `null` takes the run off. Only the box's next turn ticks it off.
   */
  Schema.Struct({
    type: Schema.Literal("task.run"),
    noteId: RoomBoardNote.fields.id,
    boxId: Schema.NullOr(RoomBoardNoteId),
  }),
  /**
   * Marks the card or section new visitors start at, or clears it (`null`). For the room's owner
   * and a cloud board's maker.
   */
  Schema.Struct({
    type: Schema.Literal("board.start"),
    noteId: Schema.NullOr(RoomBoardNoteId),
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

export const ROOM_BOARD_DRAG_MAX_ITEMS = 64;

/**
 * A card or note someone is dragging, resizing or writing in, by its board ref (`note:<id>`,
 * `card:<id>`), where and how big it is this moment and what it says. Absent fields did not change.
 */
export const RoomBoardDragItem = Schema.Struct({
  ref: Schema.String.check(Schema.isMaxLength(128)),
  x: Schema.optional(RoomBoardCoordinate),
  y: Schema.optional(RoomBoardCoordinate),
  w: Schema.optional(RoomBoardLength),
  h: Schema.optional(RoomBoardLength),
  /** A note's or section's text as they type it, which is stored once they finish. */
  text: Schema.optional(RoomBoardNote.fields.text),
});
export type RoomBoardDragItem = typeof RoomBoardDragItem.Type;

/**
 * What someone is dragging, sent with their pointer and never stored. `done` is the drag let go:
 * where it landed, which the board's stored positions are about to say.
 */
export const RoomBoardDrag = Schema.Struct({
  items: Schema.Array(RoomBoardDragItem).check(Schema.isMaxLength(ROOM_BOARD_DRAG_MAX_ITEMS)),
  done: Schema.optional(Schema.Literal(true)),
});
export type RoomBoardDrag = typeof RoomBoardDrag.Type;

/** Someone's pointer on the board, in board pixels. Absent `guestId` is the owner's. */
export const RoomCursor = Schema.Struct({
  guestId: Schema.optional(GuestId),
  ...RoomBoardPoint.fields,
  /** What they are dragging now. Absent from an older server. */
  drag: Schema.optional(RoomBoardDrag),
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
 * shows, null once they closed it, and unchanged when absent. `drag` is what they drag, absent
 * when they drag nothing.
 */
const RoomCursorFields = {
  at: Schema.NullOr(RoomBoardPoint),
  view: Schema.optional(Schema.NullOr(RoomBoardViewport)),
  drag: Schema.optional(RoomBoardDrag),
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
  /** The Tinkjam Connect tunnel hostname the link points at. Guest routes require it to still serve. */
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

const UNSHARED_ROOM_PREFIX = "board:";

/**
 * The id a thread's board goes by while the thread is not shared, where a share's id would be:
 * what the owner's board commands, its runs' records and its live progress name. A share's id is
 * base64url, so it never starts with the prefix.
 */
export const unsharedRoomId = (threadId: ThreadId): GuestShareId =>
  GuestShareId.make(`${UNSHARED_ROOM_PREFIX}${threadId}`);

/** The thread whose unshared board this id names, or null for a share's id. */
export const threadOfUnsharedRoom = (id: GuestShareId): ThreadId | null =>
  id.startsWith(UNSHARED_ROOM_PREFIX) ? ThreadId.make(id.slice(UNSHARED_ROOM_PREFIX.length)) : null;

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
  /** Shares to this team instead of making a guest link. Needs Tinkjam Connect and membership. */
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
  connect_unavailable: "Guest links need a running Tinkjam Connect tunnel.",
  thread_unavailable: "This thread cannot be shared.",
  read_failed: "Failed to read the shared thread.",
  changed: "The guest link changed while it was being created.",
  team_unavailable:
    "Could not share with this team. Check that this machine is linked to Tinkjam Connect with an account in the team.",
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

/** One file of a code window, as a guest's page asks for it: `?share=&note=&path=&scope=`. */
export const RoomCodePatchRequest = Schema.Struct({
  noteId: RoomBoardNoteId,
  path: RoomCodeFile.fields.path,
  scope: RoomCodePatchScope,
});
export type RoomCodePatchRequest = typeof RoomCodePatchRequest.Type;

/** One file of a code window on the board of the owner's thread. */
export const RoomCodePatchInput = Schema.Struct({
  threadId: ThreadId,
  ...RoomCodePatchRequest.fields,
});
export type RoomCodePatchInput = typeof RoomCodePatchInput.Type;

/** Asks the owner's server to read a pull request window's pull request again. */
export const RoomPullRequestRefreshInput = Schema.Struct({
  threadId: ThreadId,
  noteId: RoomBoardNoteId,
});
export type RoomPullRequestRefreshInput = typeof RoomPullRequestRefreshInput.Type;

const ROOM_CODE_PATCH_MESSAGES = {
  inactive: "This thread is not shared.",
  window_gone: "This code window is no longer on the board.",
  elsewhere: "These changes are on the machine of the person whose thread box it is.",
  unavailable: "This file's changes cannot be read now.",
} as const;

export class RoomCodePatchError extends Schema.TaggedError<RoomCodePatchError>()(
  "RoomCodePatchError",
  { reason: Schema.Literals(["inactive", "window_gone", "elsewhere", "unavailable"]) },
) {
  override get message(): string {
    return ROOM_CODE_PATCH_MESSAGES[this.reason];
  }
}

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
   * A team member's signed assertion from Tinkjam Connect. A thread shared to a team takes nothing else,
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
  /** What the board is called, where the host says so, so the page never shows a stand-in. */
  title: Schema.optional(Schema.String),
});
export type GuestRedeemResult = typeof GuestRedeemResult.Type;

/**
 * What an invite is for, told only to someone who sent its credential: the board's name and who
 * made it. An older host answers 204 with no body.
 */
export const GuestInvitePreview = Schema.Struct({
  title: Schema.optional(Schema.String),
  maker: Schema.optional(Schema.String),
});
export type GuestInvitePreview = typeof GuestInvitePreview.Type;

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
 * Lets the guest's own Tinkjam post the turns it runs back to the room, read what the room said
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
  /** A cloud board: joining brings the person's agent to the board, with no conversation. */
  board: Schema.optional(Schema.Boolean),
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

/** A turn the guest's own Tinkjam posts to the room. */
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
  /** With `boxId`: those cards as arrows name them, whose lines into the box are marked sent. */
  cardRefs: ThreadGuestMessage.fields.cardRefs,
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
  /**
   * With `boxId`: what the box's thread changed, for the code windows the box has a line to. The
   * machine posts the turn again with it once the turn's checkpoint is taken.
   */
  changes: Schema.optional(RoomCodeDiffSummary),
});
export type GuestTurnRequest = typeof GuestTurnRequest.Type;

/**
 * The guest's own Tinkjam saying a turn started (`running`, with the prompt) or stopped without
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
 * An artifact card as the guest's own Tinkjam reads it, so the user's agent can revise it: its
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
/** Mints a short-lived token the guest's own Tinkjam uses to read the export: `?share=<id>`. */
export const GUEST_HANDOFF_ROUTE = `${GUEST_ROUTE_PREFIX}/handoff`;
/** The thread's export, for a bearer handoff token. Called by another Tinkjam server. */
export const GUEST_EXPORT_ROUTE = `${GUEST_ROUTE_PREFIX}/export`;
/** A guest's own Tinkjam posts a turn it ran here, with a bearer room token. */
export const GUEST_ROOM_TURN_ROUTE = `${GUEST_ROUTE_PREFIX}/room/turns`;
/** A guest's own Tinkjam says a turn started or stopped here, with a bearer room token. */
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
/**
 * The room's board for the agent of a guest's own box, for a room token: `?box=<id>` reads it as a
 * `RoomBoardAgentView` (GET), and a `RoomBoardAgentChangeRequest` changes it (POST).
 */
export const GUEST_ROOM_BOARD_ROUTE = `${GUEST_ROUTE_PREFIX}/room/board`;
/** A guest's change to the room's board (POST), a `RoomBoardChange` as JSON: `?share=<id>`. */
export const GUEST_BOARD_ROUTE = `${GUEST_ROUTE_PREFIX}/board`;
/** Where a guest's pointer is on the room's board (POST), a `GuestCursorRequest`: `?share=<id>`. */
export const GUEST_BOARD_CURSOR_ROUTE = `${GUEST_ROUTE_PREFIX}/board/cursor`;
/**
 * One file of a code window on the room's board, a `RoomCodePatch`:
 * `?share=<id>&note=<id>&path=<path>&scope=thread|turn`.
 */
export const GUEST_BOARD_CODE_ROUTE = `${GUEST_ROUTE_PREFIX}/board/code`;
/**
 * Asks the owner's server to read a pull request window's pull request again (POST):
 * `?share=<id>&note=<id>`. It answers at once; the board shows the read when it lands.
 */
export const GUEST_BOARD_PULL_REQUEST_ROUTE = `${GUEST_ROUTE_PREFIX}/board/pull-request`;
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

/** Where the cloud board host makes a board that lives on nobody's machine. */
export const CLOUD_BOARD_ROUTE = "/api/boards";
export const CLOUD_BOARD_TITLE_MAX_LENGTH = 80;

export const CloudBoardCreateRequest = Schema.Struct({
  /** The name the maker joins the board under. */
  name: GuestRedeemRequest.fields.name,
  title: Schema.optional(
    TrimmedNonEmptyString.check(Schema.isMaxLength(CLOUD_BOARD_TITLE_MAX_LENGTH)),
  ),
});
export type CloudBoardCreateRequest = typeof CloudBoardCreateRequest.Type;

/**
 * The maker's own session on the new board, as a redeem answers, and the credential a link to it
 * carries so the maker can invite others.
 */
export const CloudBoardCreateResult = Schema.Struct({
  token: TrimmedNonEmptyString,
  shareId: GuestShareId,
  threadId: ThreadId,
  credential: TrimmedNonEmptyString,
});
export type CloudBoardCreateResult = typeof CloudBoardCreateResult.Type;

/**
 * Whether a site lets other pages frame it (GET `?url=`), for a link card someone chose to show
 * its page in: answers only `{ frame: "ok" | "refused" | "unknown" }`, to this deployment's pages.
 */
export const CLOUD_BOARD_FRAME_CHECK_ROUTE = `${CLOUD_BOARD_ROUTE}/frame-check`;

/** Renames a cloud board: `?share=<share id>`, signed by anyone on it. */
export const CLOUD_BOARD_TITLE_ROUTE = `${CLOUD_BOARD_ROUTE}/title`;
export const CloudBoardTitleRequest = Schema.Struct({
  title: TrimmedNonEmptyString.check(Schema.isMaxLength(CLOUD_BOARD_TITLE_MAX_LENGTH)),
});
export type CloudBoardTitleRequest = typeof CloudBoardTitleRequest.Type;

/**
 * Takes someone off a cloud board: `?share=<share id>`, signed by the board's maker for anyone
 * but themselves, or by anyone for themselves (leaving). Their cards go as on a machine's room.
 * `DELETE` on `CLOUD_BOARD_ROUTE` with `?share=` deletes the whole board, for its maker only.
 */
export const CLOUD_BOARD_PEOPLE_REMOVE_ROUTE = `${CLOUD_BOARD_ROUTE}/people/remove`;
export const CloudBoardRemovePersonRequest = Schema.Struct({ guestId: GuestId });
export type CloudBoardRemovePersonRequest = typeof CloudBoardRemovePersonRequest.Type;

/**
 * A cloud board's two links: `edit` joins it as someone who can change it, `view` only shows it,
 * with no name and no seat. A view link's credential is `<share id>.v.<random>`, so the page that
 * opens it knows which it was given.
 */
export const CloudBoardLinkKind = Schema.Literals(["edit", "view"]);
export type CloudBoardLinkKind = typeof CloudBoardLinkKind.Type;
export const isCloudBoardViewCredential = (credential: string): boolean =>
  /^[^.]+\.v\.[^.]+$/.test(credential);

/**
 * Opens a cloud board from its view link (POST `{ credential }`), answered as a
 * `GuestRedeemResult` whose token is the view link itself: it reads the board and nothing more.
 */
export const CLOUD_BOARD_VIEW_ROUTE = `${GUEST_ROUTE_PREFIX}/view`;

/**
 * Turns one of a board's links on with a new credential, which ends the old one, or off:
 * `?share=`, for its maker and the owners of its workspace.
 */
export const CLOUD_BOARD_LINK_ROUTE = `${CLOUD_BOARD_ROUTE}/links`;
export const CloudBoardLinkRequest = Schema.Struct({
  kind: CloudBoardLinkKind,
  on: Schema.Boolean,
});
export type CloudBoardLinkRequest = typeof CloudBoardLinkRequest.Type;
export const CloudBoardLinkResult = Schema.Struct({
  credential: Schema.NullOr(TrimmedNonEmptyString),
});
export type CloudBoardLinkResult = typeof CloudBoardLinkResult.Type;

/**
 * Who a cloud board's links let in, as one setting: `edit`, both links work; `view`, only the
 * view link does; `off`, neither lets anyone new in. People already on the board keep their own
 * access, and turning sharing back on brings back the same links.
 */
export const CloudBoardLinkSharing = Schema.Literals(["edit", "view", "off"]);
export type CloudBoardLinkSharing = typeof CloudBoardLinkSharing.Type;

/** Sets link sharing (`?share=`, as the link route); `renew` also makes both links anew. */
export const CLOUD_BOARD_SHARING_ROUTE = `${CLOUD_BOARD_ROUTE}/sharing`;
export const CloudBoardSharingRequest = Schema.Struct({
  sharing: CloudBoardLinkSharing,
  renew: Schema.optional(Schema.Literal(true)),
});
export type CloudBoardSharingRequest = typeof CloudBoardSharingRequest.Type;

/** Lets someone on a board change it, or only look at it: `?share=`, as the link route. */
export const CLOUD_BOARD_PEOPLE_ROLE_ROUTE = `${CLOUD_BOARD_ROUTE}/people/role`;
export const CloudBoardRole = Schema.Literals(["edit", "view"]);
export type CloudBoardRole = typeof CloudBoardRole.Type;
export const CloudBoardRoleRequest = Schema.Struct({ guestId: GuestId, role: CloudBoardRole });
export type CloudBoardRoleRequest = typeof CloudBoardRoleRequest.Type;

/**
 * Lets anyone who can see a board make their own copy of it, or stops that: `?share=`, as the
 * link route. Off on every board until its maker turns it on.
 */
export const CLOUD_BOARD_COPIES_ROUTE = `${CLOUD_BOARD_ROUTE}/copies`;
export const CloudBoardCopiesRequest = Schema.Struct({ on: Schema.Boolean });
export type CloudBoardCopiesRequest = typeof CloudBoardCopiesRequest.Type;

/**
 * Makes a new board of the caller's own from one that allows copies (POST), answered as
 * `CloudBoardCreateResult`. `source` is the caller's session on that board or its view link; a
 * signed-in caller's bearer is their account, as when making a board. Only what everyone sees is
 * copied, as the caller's own cards; never an agent, its conversation or a prompt.
 */
export const CLOUD_BOARD_COPY_ROUTE = `${CLOUD_BOARD_ROUTE}/copy`;
export const CloudBoardCopyRequest = Schema.Struct({
  name: CloudBoardCreateRequest.fields.name,
  source: TrimmedNonEmptyString,
});
export type CloudBoardCopyRequest = typeof CloudBoardCopyRequest.Type;
