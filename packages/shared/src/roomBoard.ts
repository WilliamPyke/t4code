import {
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_AGENT_TURNS_MAX,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_CODE_WINDOWS,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_PULL_REQUESTS,
  ROOM_BOARD_MAX_REACTIONS,
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOARD_MAX_THREADS,
  ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH,
  ROOM_BOARD_MARK_TEXT_MAX_LENGTH,
  ROOM_BOARD_REMOVED_MAX,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  ROOM_BOX_CARD_LABELS_MAX,
  ROOM_BOX_CONTEXT_KIND,
  ROOM_BOX_REPLY_MAX_LENGTH,
  ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH,
  ROOM_COMMENT_MAX_REACTIONS,
  isRoomBoardUrl,
  roomPullRequestOf,
  roomBoardCardRef,
  roomBoardNoteRef,
  roomTaskAnswerExcerpt,
  RoomArtifactContextRecord,
  RoomBoxContextPayload,
  RoomCardsContextRecord,
  RoomCommentContextRecord,
  type GuestId,
  type GuestMessageId,
  type GuestShareId,
  type OrchestrationV2TurnItem,
  type RoomArtifactContent,
  type RoomBoard,
  type RoomBoardAgentCardState,
  type RoomBoardAgentMark,
  type RoomBoardAgentTurn,
  type RoomBoardChange,
  type RoomBoardContextCard,
  type RoomBoardEdge,
  type RoomBoardMark,
  type RoomBoardMention,
  type RoomBoardNote,
  type RoomBoardReaction,
  type RoomBoardReactionEmoji,
  type RoomBoardSize,
  type RoomBoxModel,
  type RoomTaskStatus,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { replaceComposerContextReferences } from "./composerContextReferences.ts";
import { sanitizeLinkedPrompt } from "./promptLinks.ts";
import { isRoomEmbedPersonFrameUrl, roomEmbedOf } from "./roomEmbed.ts";

export const ROOM_BOARD_FULL = "This board has as many notes as it holds. Remove one first.";
export const ROOM_COMMENT_THREAD_FULL = `A comment thread holds ${ROOM_BOARD_MAX_REPLIES} replies. Start a new one.`;

export const EMPTY_ROOM_BOARD: RoomBoard = { positions: {}, notes: [] };

/** How big a new note shows until its text grows it. */
export const ROOM_BOARD_NOTE_SIZE: RoomBoardSize = { w: 192, h: 144 };
/** A new task is taller than a note: its checkbox and actions sit around the text. */
export const ROOM_BOARD_TASK_SIZE: RoomBoardSize = { w: 192, h: 184 };

/** Starts the id of every reply an agent's run wrote. No reply a client sends may use it. */
export const ROOM_AGENT_REPLY_ID_PREFIX = "agent:";

/** What a board is about: the cards it has, and the people a task can be for. */
export interface RoomBoardScope {
  /** Only these cards, so the positions and arrows cannot grow without bound. */
  readonly hasCard: (cardId: string) => boolean;
  /** Called only for a named person; a task with no one named is for the room's owner. */
  readonly hasPerson: (guestId: GuestId) => boolean;
  /** Members of the board's workspace someone may `@` mention. Absent: a board in no workspace. */
  readonly hasMember?: ((memberId: string) => boolean) | undefined;
  /** Who besides the room's owner manages the board: a cloud board's maker. Absent: nobody. */
  readonly manages?: ((guestId: GuestId) => boolean) | undefined;
}

/** Names one mentioned person, whichever way they are named. */
export const roomMentionKey = (mention: Pick<RoomBoardMention, "guestId" | "memberId">) =>
  mention.guestId === undefined ? `member:${mention.memberId ?? ""}` : `guest:${mention.guestId}`;

/** The mentions whose `@Name` the text still has, each person once. */
export function roomMentionsIn(
  mentions: ReadonlyArray<RoomBoardMention>,
  text: string,
): ReadonlyArray<RoomBoardMention> {
  const seen = new Set<string>();
  return mentions.filter((mention) => {
    const key = roomMentionKey(mention);
    if (seen.has(key) || !text.includes(`@${mention.name}`)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The mentions a note or reply by `author` keeps. Each new one names exactly one person on the
 * board or in its workspace; one it already had stays while the text names it, even once they
 * left. Absent `wanted` keeps those it had. Naming yourself does nothing.
 */
function roomMentionsOf(
  scope: RoomBoardScope,
  author: GuestId | null,
  text: string,
  wanted: ReadonlyArray<RoomBoardMention> | undefined,
  had: ReadonlyArray<RoomBoardMention> | undefined,
): Result.Result<ReadonlyArray<RoomBoardMention>, string> {
  if (wanted === undefined) return Result.succeed(roomMentionsIn(had ?? [], text));
  const known = new Set((had ?? []).map(roomMentionKey));
  for (const mention of wanted) {
    if ((mention.guestId === undefined) === (mention.memberId === undefined)) {
      return Result.fail("A mention names one person.");
    }
    if (known.has(roomMentionKey(mention))) continue;
    const there =
      mention.guestId === undefined
        ? scope.hasMember?.(mention.memberId ?? "") === true
        : scope.hasPerson(mention.guestId);
    if (!there) return Result.fail("You can only mention people on this board.");
  }
  return Result.succeed(
    roomMentionsIn(
      wanted.filter(
        (mention) =>
          author === null || mention.guestId !== author || known.has(roomMentionKey(mention)),
      ),
      text,
    ),
  );
}

const sameMentions = (
  left: ReadonlyArray<RoomBoardMention> | undefined,
  right: ReadonlyArray<RoomBoardMention> | undefined,
) => (left ?? []).map(roomMentionKey).join(" ") === (right ?? []).map(roomMentionKey).join(" ");

const CARD_REF = roomBoardCardRef("");
const isOnBoard = (scope: RoomBoardScope, board: RoomBoard, ref: string) =>
  board.notes.some((note) => ref === roomBoardNoteRef(note.id)) ||
  (ref.startsWith(CARD_REF) && scope.hasCard(ref.slice(CARD_REF.length)));

/** The board with its arrows kept only where `keep` says. */
export const roomBoardWithEdges = (
  board: RoomBoard,
  keep: (edge: RoomBoardEdge) => boolean,
): RoomBoard => (board.edges === undefined ? board : { ...board, edges: board.edges.filter(keep) });

/** The board with the places and sizes of only the cards `keep` says. */
function roomBoardKeepingCards(board: RoomBoard, keep: (cardId: string) => boolean): RoomBoard {
  const kept = {
    ...board,
    positions: Object.fromEntries(
      Object.entries(board.positions).filter(([cardId]) => keep(cardId)),
    ),
  };
  return board.sizes === undefined
    ? kept
    : {
        ...kept,
        sizes: Object.fromEntries(Object.entries(board.sizes).filter(([cardId]) => keep(cardId))),
      };
}

const hasCardOutside = (board: RoomBoard, keep: (cardId: string) => boolean) =>
  [...Object.keys(board.positions), ...Object.keys(board.sizes ?? {})].some(
    (cardId) => !keep(cardId),
  );

/**
 * The board without the places, sizes and arrows of cards it no longer has. The same board when
 * every card is still there.
 */
export function roomBoardWithCards(board: RoomBoard, hasCard: (cardId: string) => boolean) {
  const strayEdge = (edge: RoomBoardEdge) =>
    [edge.from, edge.to].some(
      (ref) => ref.startsWith(CARD_REF) && !hasCard(ref.slice(CARD_REF.length)),
    );
  if (!hasCardOutside(board, hasCard) && board.edges?.some(strayEdge) !== true) return board;
  return roomBoardWithEdges(roomBoardKeepingCards(board, hasCard), (edge) => !strayEdge(edge));
}

/** The board without these cards' places and sizes; the same board when it has neither. */
export function roomBoardWithoutCards(board: RoomBoard, cardIds: ReadonlyArray<string>) {
  const keep = (cardId: string) => !cardIds.includes(cardId);
  return hasCardOutside(board, keep) ? roomBoardKeepingCards(board, keep) : board;
}

type NotePut = Extract<RoomBoardChange, { type: "note.put" }>;

/** The note a `note.put` makes or leaves, or why the board does not take it. */
function putNote(
  scope: RoomBoardScope,
  author: GuestId | null,
  existing: RoomBoardNote | undefined,
  change: NotePut,
  at: string,
): Result.Result<RoomBoardNote, string> {
  const kind = existing === undefined ? change.kind : existing.kind;
  // The server never fetches a link; clients open it only in a new tab. The owner's server reads
  // a pull request window's, so it takes only a github.com pull request URL, as one spelling.
  if (existing === undefined && kind === "pull-request") {
    if (change.url === undefined || roomPullRequestOf(change.url)?.url !== change.url) {
      return Result.fail("A pull request window needs the address of a pull request on GitHub.");
    }
  } else if (
    existing === undefined &&
    (change.url === undefined ? kind === "link" : kind !== "link" || !isRoomBoardUrl(change.url))
  ) {
    return Result.fail("A link card needs an http or https address, and only a link card has one.");
  }
  const assigns = change.assignee !== undefined && change.assignee !== null;
  const plans =
    change.status !== undefined ||
    (change.due !== undefined && change.due !== null) ||
    (change.priority !== undefined && change.priority !== null) ||
    change.order !== undefined;
  if (kind !== "task" && (change.done !== undefined || assigns || plans)) {
    return Result.fail("Only a task can be done, assigned or planned.");
  }
  if (
    change.status !== undefined &&
    change.done !== undefined &&
    change.done !== (change.status === "done")
  ) {
    return Result.fail("A task's status and whether it is done must agree.");
  }
  if (change.assignee?.guestId !== undefined && !scope.hasPerson(change.assignee.guestId)) {
    return Result.fail("A task can only be assigned to someone in the room.");
  }
  const pinned = existing === undefined ? change.pinnedTo : existing.pinnedTo;
  if (
    existing === undefined &&
    change.section === true &&
    (kind !== undefined || pinned !== undefined)
  ) {
    return Result.fail("A section is a frame of its own, not a card of another kind.");
  }
  if (change.color !== undefined && (kind !== undefined || pinned !== undefined)) {
    return Result.fail("Only a note or a section can have a colour.");
  }
  const framedUrl = existing === undefined ? change.url : existing.url;
  if (
    change.framed === true &&
    (kind !== "link" || framedUrl === undefined || !isRoomEmbedPersonFrameUrl(framedUrl))
  ) {
    return Result.fail("Only a link card with a public https address can show its page.");
  }
  const mentioned = roomMentionsOf(scope, author, change.text, change.mentions, existing?.mentions);
  if (Result.isFailure(mentioned)) return Result.fail(mentioned.failure);
  const mentions = mentioned.success;
  // An artifact's content, a task's answer and a thread box's turns come only from the owner's
  // server, never a change.
  const base: RoomBoardNote =
    existing ??
    ({
      id: change.noteId,
      text: "",
      x: 0,
      y: 0,
      ...(author === null ? {} : { guestId: author }),
      ...(kind === undefined ? {} : { kind }),
      ...(change.url === undefined ? {} : { url: change.url }),
      ...(change.pinnedTo === undefined ? {} : { pinnedTo: change.pinnedTo }),
      ...(change.pinnedTo === undefined || change.quote === undefined
        ? {}
        : { quote: change.quote }),
      // Only a plain note points into a page.
      ...(change.mark === undefined ||
      kind !== undefined ||
      change.pinnedTo !== undefined ||
      change.section === true
        ? {}
        : { mark: change.mark }),
      ...(kind === "comment" ? { createdAt: at } : {}),
      ...(change.section === true ? { section: true } : {}),
    } satisfies RoomBoardNote);
  const {
    done: _done,
    status: _status,
    due: _due,
    order: _order,
    priority: _priority,
    assignee: _assignee,
    size: _size,
    color: _color,
    framed: _framed,
    mentions: _mentions,
    ...rest
  } = base;
  // Unticked, a done task goes back to to do; ticked or not, an older client's edit keeps it.
  const status =
    change.status ??
    (change.done === true
      ? "done"
      : change.done === false && base.done === true
        ? "todo"
        : roomTaskStatus(base));
  const due = change.due === undefined ? base.due : change.due;
  const order = change.order ?? base.order;
  const priority = change.priority === undefined ? base.priority : change.priority;
  const assignee = change.assignee === undefined ? base.assignee : change.assignee;
  const size = change.size ?? base.size;
  const color = change.color ?? base.color;
  const framed = change.framed ?? base.framed === true;
  // A card edited since a prompt carried it goes with the next one again.
  const edited =
    existing !== undefined &&
    (change.text !== existing.text || status !== roomTaskStatus(existing));
  const next: RoomBoardNote = {
    ...rest,
    ...(edited ? { editedAt: at, editedBy: author } : {}),
    text: change.text,
    x: change.x,
    y: change.y,
    ...(status === "done" ? { done: true } : {}),
    ...(status === "doing" ? { status } : {}),
    ...(due === undefined || due === null ? {} : { due }),
    ...(order === undefined ? {} : { order }),
    ...(priority === undefined || priority === null ? {} : { priority }),
    ...(assignee === undefined || assignee === null ? {} : { assignee }),
    ...(size === undefined ? {} : { size }),
    ...(color === undefined ? {} : { color }),
    ...(framed ? { framed: true } : {}),
    ...(mentions.length === 0 ? {} : { mentions }),
  };
  // Moving or resizing a card is not changing it, for whoever catches up on the board later.
  return Result.succeed(
    existing !== undefined && sameContent(existing, next)
      ? next
      : { ...next, changed: { at, ...(author === null ? {} : { guestId: author }) } },
  );
}

const sameSize = (left: RoomBoardSize | undefined, right: RoomBoardSize | undefined) =>
  left?.w === right?.w && left?.h === right?.h;

const sameContent = (left: RoomBoardNote, right: RoomBoardNote) =>
  left.text === right.text &&
  left.done === right.done &&
  left.status === right.status &&
  left.due === right.due &&
  left.priority === right.priority &&
  left.assignee?.guestId === right.assignee?.guestId &&
  (left.assignee === undefined) === (right.assignee === undefined) &&
  left.color === right.color &&
  sameMentions(left.mentions, right.mentions);

const REMOVED_KEPT_MS = 24 * 60 * 60 * 1000;
type RemovedEntry = NonNullable<RoomBoard["removed"]>[number];
const removedLongAgo = (entry: RemovedEntry, at: string) =>
  Date.parse(at) - Date.parse(entry.at) > REMOVED_KEPT_MS;

/** A comment thread removed lately that a `note.put` of its id brings back. */
const removedComment = (board: RoomBoard, noteId: string, at: string) => {
  const entry = board.removed?.find((candidate) => candidate.note.id === noteId);
  return entry === undefined || removedLongAgo(entry, at) ? undefined : entry.note;
};

const withRemoved = (board: RoomBoard, removed: ReadonlyArray<RemovedEntry>): RoomBoard => {
  if (removed.length > 0) return { ...board, removed };
  if (board.removed === undefined) return board;
  const { removed: _gone, ...rest } = board;
  return rest;
};

// Like a card's place, its order in a Plan column is not what it says.
const sameNote = (left: RoomBoardNote, right: RoomBoardNote) =>
  sameContent(left, right) &&
  left.x === right.x &&
  left.y === right.y &&
  left.order === right.order &&
  left.framed === right.framed &&
  sameSize(left.size, right.size);

/**
 * Which Plan column a task is in: done when ticked, whatever else it says, so a card an older
 * client or an agent ticked is done; in progress once started; else to do.
 */
export const roomTaskStatus = (note: Pick<RoomBoardNote, "done" | "status">): RoomTaskStatus =>
  note.done === true ? "done" : note.status === "doing" ? "doing" : "todo";

/**
 * Whether `person` (null for the room's owner) may remove a card or rename a thread box: the owner
 * and whoever added it. Anyone in the room moves, sizes, connects and edits the rest.
 */
export const isRoomCardOwnedBy = (note: Pick<RoomBoardNote, "guestId">, person: string | null) =>
  person === null || (note.guestId ?? null) === person;

/**
 * Whether `person` (null for the room's owner) may swap an artifact with the version it replaced:
 * the owner, whoever added the card, and whoever asked for or whose agent wrote either version.
 */
export function canRestoreRoomArtifact(
  note: Pick<RoomBoardNote, "guestId" | "artifact">,
  person: GuestId | null,
): boolean {
  if (isRoomCardOwnedBy(note, person)) return true;
  return [note.artifact, note.artifact?.previous].some(
    (version) => version?.guestId === person || version?.askedBy === person,
  );
}

/**
 * The artifact a card shows and every write to it reaches: the card itself, or for a live view
 * the artifact it follows, through any views between. Undefined for any other card, and for a
 * view whose source is gone.
 */
export function roomArtifactSource(
  board: RoomBoard | undefined,
  noteId: string | undefined,
): RoomBoardNote | undefined {
  const find = (id: string | undefined) => board?.notes.find((note) => note.id === id);
  const seen = new Set<string>();
  let note = find(noteId);
  while (note?.kind === "artifact" && note.viewOf !== undefined && !seen.has(note.id)) {
    seen.add(note.id);
    note = find(note.viewOf);
  }
  return note?.kind === "artifact" && note.viewOf === undefined ? note : undefined;
}

const withNote = (board: RoomBoard, note: RoomBoardNote, next: RoomBoardNote): RoomBoard => ({
  ...board,
  notes: board.notes.map((other) => (other === note ? next : other)),
});

const agentCardState = (note: RoomBoardNote): RoomBoardAgentCardState => ({
  text: note.text,
  x: note.x,
  y: note.y,
  ...(note.done === true ? { done: true } : {}),
  ...(note.size === undefined ? {} : { size: note.size }),
  ...(note.kind === undefined ? {} : { kind: note.kind }),
  ...(note.section === true ? { section: true as const } : {}),
  ...taskPlanOf(note),
});

/** A task's plan as a card state keeps it: status (in progress only), due, priority, assignee. */
const taskPlanOf = (note: Pick<RoomBoardNote, "status" | "due" | "priority" | "assignee">) => ({
  ...(note.status === undefined ? {} : { status: note.status }),
  ...(note.due === undefined ? {} : { due: note.due }),
  ...(note.priority === undefined ? {} : { priority: note.priority }),
  ...(note.assignee === undefined ? {} : { assignee: note.assignee }),
});

const isInState = (note: RoomBoardNote, state: RoomBoardAgentCardState) =>
  note.text === state.text &&
  note.x === state.x &&
  note.y === state.y &&
  (note.done === true) === (state.done === true) &&
  note.status === state.status &&
  note.due === state.due &&
  note.priority === state.priority &&
  (note.assignee === undefined) === (state.assignee === undefined) &&
  note.assignee?.guestId === state.assignee?.guestId &&
  sameSize(note.size, state.size);

/**
 * The board after a change a thread box's agent made as `author` (null for the owner, or the guest
 * whose own machine runs it): a note it added marked as its own, and its turn's record of what it
 * found and left, which undoing the turn goes by.
 */
export function roomBoardWithAgentChange(
  before: RoomBoard,
  after: RoomBoard,
  change: RoomBoardChange,
  agent: RoomBoardAgentMark,
  at: string,
  author: GuestId | null = null,
): RoomBoard {
  if (after === before) return after;
  const previous =
    change.type === "note.put" ? before.notes.find((note) => note.id === change.noteId) : undefined;
  const board =
    change.type === "note.put" && previous === undefined
      ? {
          ...after,
          notes: after.notes.map((note) => (note.id === change.noteId ? { ...note, agent } : note)),
        }
      : after;
  if (agent.turnId === undefined) return board;
  const turns = board.agentTurns ?? [];
  const known = turns.find((turn) => turn.id === agent.turnId);
  let cards = known?.cards ?? [];
  let edges = known?.edges ?? [];
  if (change.type === "note.put") {
    const note = board.notes.find((candidate) => candidate.id === change.noteId);
    if (note === undefined) return board;
    const step = cards.find((card) => card.id === note.id);
    if (step !== undefined) {
      cards = cards.map((card) =>
        card === step ? { ...card, after: agentCardState(note) } : card,
      );
    } else if (cards.length < ROOM_BOARD_MAX_NOTES * 2) {
      cards = [
        ...cards,
        {
          id: note.id,
          ...(previous === undefined ? {} : { before: agentCardState(previous) }),
          after: agentCardState(note),
        },
      ];
    }
  } else if (change.type === "edge.put") {
    const drawn = board.edges?.find((edge) => edge.id === change.edgeId);
    if (drawn === undefined || before.edges?.some((edge) => edge.id === drawn.id) === true) {
      return board;
    }
    if (edges.length < ROOM_BOARD_MAX_EDGES) {
      edges = [...edges, { id: drawn.id, from: drawn.from, to: drawn.to }];
    }
  } else {
    return board;
  }
  // More work after an undo makes the turn one to undo again.
  const turn: RoomBoardAgentTurn = {
    id: agent.turnId,
    boxId: agent.boxId,
    ...(agent.model === undefined ? {} : { model: agent.model }),
    ...(agent.askedBy === undefined ? {} : { askedBy: agent.askedBy }),
    ...(author === null ? {} : { guestId: author }),
    at,
    cards,
    ...(edges.length === 0 ? {} : { edges }),
  };
  return {
    ...board,
    agentTurns: [...turns.filter((other) => other !== known), turn].slice(
      -ROOM_BOARD_AGENT_TURNS_MAX,
    ),
  };
}

/** Whether `person` (null for the room's owner) may undo or redo an agent's turn. */
export const canUndoRoomAgentTurn = (
  turn: Pick<RoomBoardAgentTurn, "askedBy">,
  person: GuestId | null,
) => person === null || turn.askedBy === person;

/** A card put back to how an agent's turn found or left it, signed as `author`'s change. */
function noteInState(
  note: RoomBoardNote,
  state: RoomBoardAgentCardState,
  author: GuestId | null,
  at: string,
): RoomBoardNote {
  const {
    done: _done,
    size: _size,
    status: _status,
    due: _due,
    priority: _priority,
    assignee: _assignee,
    ...rest
  } = note;
  const edited =
    note.text !== state.text ||
    (note.done === true) !== (state.done === true) ||
    note.status !== state.status;
  return {
    ...rest,
    text: state.text,
    x: state.x,
    y: state.y,
    ...(state.done === true ? { done: true } : {}),
    ...taskPlanOf(state),
    ...(state.size === undefined ? {} : { size: state.size }),
    ...(edited
      ? {
          editedAt: at,
          editedBy: author,
          changed: { at, ...(author === null ? {} : { guestId: author }) },
        }
      : {}),
  };
}

/**
 * The board with an agent's turn taken back (`undone`) or done again, and the cards that stay as
 * they are because someone changed them since: moved, edited, or, for a card it added, reacted
 * to, assigned, coloured or joined by a line of someone else's. Its own lines go unless pinned.
 */
export function roomBoardAfterAgentTurn(
  board: RoomBoard,
  scope: RoomBoardScope,
  turn: RoomBoardAgentTurn,
  undone: boolean,
  author: GuestId | null,
  at: string,
): { readonly board: RoomBoard; readonly left: ReadonlyArray<string> } {
  const left: Array<string> = [];
  let next = board;
  if (undone) {
    // Its lines first, so a line still on a card it added is someone else's.
    for (const drawn of turn.edges ?? []) {
      const edge = next.edges?.find((candidate) => candidate.id === drawn.id);
      if (edge !== undefined && edge.pinned !== true) {
        next = roomBoardWithEdges(next, (other) => other !== edge);
      }
    }
    for (const step of [...turn.cards].reverse()) {
      const note = next.notes.find((candidate) => candidate.id === step.id);
      if (note === undefined) continue;
      const ref = roomBoardNoteRef(note.id);
      const kept =
        !isInState(note, step.after) ||
        (step.before === undefined &&
          (note.reactions !== undefined ||
            note.color !== undefined ||
            next.edges?.some((edge) => edge.from === ref || edge.to === ref) === true));
      if (kept) left.push(note.id);
      else if (step.before !== undefined) {
        next = withNote(next, note, noteInState(note, step.before, author, at));
      } else next = { ...next, notes: next.notes.filter((other) => other !== note) };
    }
    return { board: next, left };
  }
  for (const step of turn.cards) {
    const note = next.notes.find((candidate) => candidate.id === step.id);
    if (step.before !== undefined) {
      if (note === undefined) continue;
      if (isInState(note, step.before)) {
        next = withNote(next, note, noteInState(note, step.after, author, at));
      } else left.push(note.id);
      continue;
    }
    if (note !== undefined) continue;
    if (next.notes.length >= ROOM_BOARD_MAX_NOTES) {
      left.push(step.id);
      continue;
    }
    const { kind, section, ...state } = step.after;
    const agent: RoomBoardAgentMark = {
      boxId: turn.boxId,
      ...(turn.model === undefined ? {} : { model: turn.model }),
      turnId: turn.id,
      ...(turn.askedBy === undefined ? {} : { askedBy: turn.askedBy }),
    };
    const added: RoomBoardNote = {
      id: step.id,
      ...state,
      ...(kind === undefined ? {} : { kind }),
      ...(section === true ? { section } : {}),
      ...(turn.guestId === undefined ? {} : { guestId: turn.guestId }),
      agent,
      changed: { at },
    };
    next = { ...next, notes: [...next.notes, added] };
  }
  for (const drawn of turn.edges ?? []) {
    const edges = next.edges ?? [];
    if (
      edges.length >= ROOM_BOARD_MAX_EDGES ||
      edges.some(
        (edge) => edge.id === drawn.id || (edge.from === drawn.from && edge.to === drawn.to),
      ) ||
      !isOnBoard(scope, next, drawn.from) ||
      !isOnBoard(scope, next, drawn.to)
    ) {
      continue;
    }
    // A guest's agent draws for them.
    const line = turn.guestId === undefined ? drawn : { ...drawn, guestId: turn.guestId };
    next = { ...next, edges: [...edges, line] };
  }
  return { board: next, left };
}

const ROOM_COMMENT_REACTIONS_FULL = "This comment has as many reactions as it holds.";
const ROOM_LINE_NOT_YOURS =
  "This line takes its card to someone else's agent. Only they can pin it or send it again.";

/**
 * A card's or comment's reactions once `author`'s `emoji` is taken back, when they had it, or
 * added; empty when none are left, null when it holds no more.
 */
function toggledReaction(
  reactions: ReadonlyArray<RoomBoardReaction> | undefined,
  emoji: RoomBoardReactionEmoji,
  author: GuestId | null,
  comment: boolean,
): ReadonlyArray<RoomBoardReaction> | null {
  const all = reactions ?? [];
  const mine = (reaction: RoomBoardReaction) =>
    reaction.emoji === emoji && (reaction.guestId ?? null) === author;
  if (all.some(mine)) return all.filter((reaction) => !mine(reaction));
  if (all.length >= (comment ? ROOM_COMMENT_MAX_REACTIONS : ROOM_BOARD_MAX_REACTIONS)) return null;
  return [...all, { emoji, ...(author === null ? {} : { guestId: author }) }];
}

/**
 * The board after one change by `author` (null for the room's owner) at `at` (the ISO time the
 * server takes it, which signs a reply), the same board when the change does nothing, or why the
 * board does not take it. The owner's server applies it to a room's board and the relay to a
 * team's, so both take and refuse the same changes.
 */
export function applyRoomBoardChange(
  board: RoomBoard,
  scope: RoomBoardScope,
  author: GuestId | null,
  change: RoomBoardChange,
  at: string,
): Result.Result<RoomBoard, string> {
  switch (change.type) {
    case "card.move": {
      if (!scope.hasCard(change.cardId)) return Result.fail("This card is not on the board.");
      const at = board.positions[change.cardId];
      if (at?.x === change.x && at.y === change.y) return Result.succeed(board);
      return Result.succeed({
        ...board,
        positions: { ...board.positions, [change.cardId]: { x: change.x, y: change.y } },
      });
    }
    case "card.resize": {
      if (!scope.hasCard(change.cardId)) return Result.fail("This card is not on the board.");
      const size = { w: change.w, h: change.h };
      if (sameSize(board.sizes?.[change.cardId], size)) return Result.succeed(board);
      return Result.succeed({ ...board, sizes: { ...board.sizes, [change.cardId]: size } });
    }
    case "note.put": {
      const existing = board.notes.find((note) => note.id === change.noteId);
      if (existing === undefined && board.notes.length >= ROOM_BOARD_MAX_NOTES) {
        return Result.fail(ROOM_BOARD_FULL);
      }
      const removed = existing === undefined ? removedComment(board, change.noteId, at) : undefined;
      if (removed !== undefined && change.kind === "comment") {
        if (!isRoomCardOwnedBy(removed, author)) {
          return Result.fail(
            "Only whoever started this comment thread, or the owner, can bring it back.",
          );
        }
        return Result.succeed(
          withRemoved(
            { ...board, notes: [...board.notes, { ...removed, x: change.x, y: change.y }] },
            (board.removed ?? []).filter((entry) => entry.note.id !== removed.id),
          ),
        );
      }
      if (
        existing === undefined &&
        change.kind === "artifact" &&
        board.notes.filter((note) => note.kind === "artifact").length >= ROOM_BOARD_MAX_ARTIFACTS
      ) {
        return Result.fail("This board has as many artifacts as it holds. Remove one first.");
      }
      if (
        existing === undefined &&
        change.kind === "thread" &&
        board.notes.filter((note) => note.kind === "thread").length >= ROOM_BOARD_MAX_THREADS
      ) {
        return Result.fail("This board has as many thread boxes as it holds. Remove one first.");
      }
      if (
        existing === undefined &&
        change.kind === "code" &&
        board.notes.filter((note) => note.kind === "code").length >= ROOM_BOARD_MAX_CODE_WINDOWS
      ) {
        return Result.fail("This board has as many code windows as it holds. Remove one first.");
      }
      if (
        existing === undefined &&
        change.kind === "pull-request" &&
        board.notes.filter((note) => note.kind === "pull-request").length >=
          ROOM_BOARD_MAX_PULL_REQUESTS
      ) {
        return Result.fail(
          "This board has as many pull request windows as it holds. Remove one first.",
        );
      }
      if (
        (existing?.kind === "thread" || existing?.section === true) &&
        change.text !== existing.text &&
        !isRoomCardOwnedBy(existing, author)
      ) {
        return Result.fail(
          existing.section === true
            ? "Only the owner and whoever added this section can rename it."
            : "Only the owner and whoever added this thread box can rename it.",
        );
      }
      if (
        existing?.kind === "comment" &&
        change.text !== existing.text &&
        !isRoomCardOwnedBy(existing, author)
      ) {
        return Result.fail("Only whoever started this comment thread, or the owner, can edit it.");
      }
      return Result.map(putNote(scope, author, existing, change, at), (note) => {
        if (existing === undefined) return { ...board, notes: [...board.notes, note] };
        // A note stays its author's whoever edits it.
        return sameNote(existing, note)
          ? board
          : { ...board, notes: board.notes.map((other) => (other === existing ? note : other)) };
      });
    }
    case "note.remove": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      if (note === undefined) return Result.succeed(board);
      if (!isRoomCardOwnedBy(note, author)) {
        return Result.fail("Only the owner and whoever added this card can remove it.");
      }
      const ref = roomBoardNoteRef(change.noteId);
      const kept = (board.removed ?? []).filter((entry) => !removedLongAgo(entry, at));
      // A view of the card going keeps what it showed: its content, or the source it followed.
      const notes = board.notes.flatMap((other): ReadonlyArray<RoomBoardNote> => {
        if (other.id === change.noteId) return [];
        if (other.viewOf !== change.noteId) return [other];
        const { viewOf: _viewOf, ...own } = other;
        return [
          {
            ...own,
            ...(note.viewOf === undefined ? {} : { viewOf: note.viewOf }),
            ...(note.artifact === undefined ? {} : { artifact: note.artifact }),
          },
        ];
      });
      return Result.succeed(
        roomBoardWithEdges(
          withRemoved(
            { ...board, notes },
            note.kind === "comment" ? [...kept, { note, at }].slice(-ROOM_BOARD_REMOVED_MAX) : kept,
          ),
          (edge) => edge.from !== ref && edge.to !== ref,
        ),
      );
    }
    case "edge.put": {
      const edges = board.edges ?? [];
      if (
        edges.some(
          (edge) =>
            edge.id === change.edgeId || (edge.from === change.from && edge.to === change.to),
        )
      ) {
        return Result.succeed(board);
      }
      if (change.from === change.to) return Result.fail("An arrow joins two different cards.");
      if (!isOnBoard(scope, board, change.from) || !isOnBoard(scope, board, change.to)) {
        return Result.fail("An arrow joins cards that are on the board.");
      }
      const window = roomBoardNoteOfRef(board, change.to);
      if (
        window?.kind === "code" &&
        roomBoxIdOfRef(board, change.from) !== undefined &&
        roomWindowBoxId(board, window.id) !== undefined
      ) {
        return Result.fail(
          "A code window shows one thread box's changes. Remove its line from the other box first.",
        );
      }
      if (edges.length >= ROOM_BOARD_MAX_EDGES) {
        return Result.fail("This board has as many arrows as it holds. Remove one first.");
      }
      return Result.succeed({
        ...board,
        edges: [
          ...edges,
          {
            id: change.edgeId,
            from: change.from,
            to: change.to,
            ...(author === null ? {} : { guestId: author }),
            ...(change.shape === undefined ? {} : { shape: change.shape }),
          },
        ],
      });
    }
    // Anyone who may draw or remove a line may change how it is drawn.
    case "edge.shape": {
      const edge = board.edges?.find((candidate) => candidate.id === change.edgeId);
      if (edge === undefined) return Result.fail("This arrow is not on the board.");
      if ((edge.shape ?? "curve") === change.shape) return Result.succeed(board);
      const { shape: _shape, ...rest } = edge;
      const next = change.shape === "elbow" ? { ...rest, shape: change.shape } : rest;
      return Result.succeed({
        ...board,
        edges: board.edges?.map((candidate) => (candidate === edge ? next : candidate)),
      });
    }
    case "edge.remove":
      return board.edges?.some((edge) => edge.id === change.edgeId) === true
        ? Result.succeed(roomBoardWithEdges(board, (edge) => edge.id !== change.edgeId))
        : Result.succeed(board);
    // Anyone may unpin a line; pinning one into an agent's box is that box's person's.
    case "edge.pin": {
      const edge = board.edges?.find((candidate) => candidate.id === change.edgeId);
      if (edge === undefined) return Result.fail("This arrow is not on the board.");
      if ((edge.pinned === true) === change.pinned) return Result.succeed(board);
      if (change.pinned && reachesSomeoneElsesBox(board, edge, author)) {
        return Result.fail(ROOM_LINE_NOT_YOURS);
      }
      const { pinned: _pinned, ...rest } = edge;
      const next = change.pinned ? { ...rest, pinned: true as const } : rest;
      return Result.succeed({
        ...board,
        edges: board.edges?.map((candidate) => (candidate === edge ? next : candidate)),
      });
    }
    case "edge.resend": {
      const edge = board.edges?.find((candidate) => candidate.id === change.edgeId);
      if (edge === undefined) return Result.fail("This arrow is not on the board.");
      if (reachesSomeoneElsesBox(board, edge, author)) {
        return Result.fail(ROOM_LINE_NOT_YOURS);
      }
      const next = roomEdgeToSendAgain(
        edge,
        change.card === undefined ? { kind: "all" } : { kind: "cards", cards: [change.card] },
      );
      return Result.succeed(
        next === edge
          ? board
          : { ...board, edges: board.edges?.map((other) => (other === edge ? next : other)) },
      );
    }
    // Restoring or writing a view changes the artifact it shows.
    case "artifact.restore": {
      const note = roomArtifactSource(board, change.noteId);
      const current = note?.artifact;
      if (note === undefined || current?.previous === undefined) return Result.succeed(board);
      if (!canRestoreRoomArtifact(note, author)) {
        return Result.fail(
          "Only the owner, whoever added this artifact, and the people behind its versions can restore it.",
        );
      }
      const { previous, ...shown } = current;
      return Result.succeed(
        withNote(board, note, { ...note, artifact: { ...previous, previous: shown } }),
      );
    }
    case "artifact.write": {
      const note = roomArtifactSource(board, change.noteId);
      if (note === undefined) return Result.fail("This artifact is not on the board.");
      // Characters nobody can see have no place in text the whole room reads.
      const body = sanitizeLinkedPrompt(change.body).text.trim();
      if (body === "") return Result.fail("Write something first.");
      if (note.artifact?.body === body) return Result.succeed(board);
      const person = author === null ? {} : { guestId: author };
      return Result.succeed(
        withNote(board, note, {
          ...note,
          artifact: roomArtifactAfterFill(note.artifact, {
            body,
            ...person,
            byHand: true,
            turnId: `edit:${at}`,
            updatedAt: at,
          }),
          changed: { at, ...person },
        }),
      );
    }
    // Anyone who may draw a line may copy along it. Nobody wrote a version, so `changed` stays.
    case "artifact.copy": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      const from = board.notes.find((candidate) => candidate.id === change.fromNoteId);
      if (note?.kind !== "artifact" || from?.kind !== "artifact") {
        return Result.fail("This artifact is not on the board.");
      }
      const content = roomArtifactSource(board, from.id)?.artifact;
      if (note.artifact !== undefined) return Result.succeed(board);
      if (content === undefined && note.viewOf === undefined) return Result.succeed(board);
      // A view stops following, with what it showed as its own, which may be nothing yet.
      const { viewOf: _viewOf, ...own } = note;
      return Result.succeed(
        withNote(board, note, { ...own, ...(content === undefined ? {} : { artifact: content }) }),
      );
    }
    case "artifact.view": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      const from = board.notes.find((candidate) => candidate.id === change.fromNoteId);
      if (note?.kind !== "artifact" || from?.kind !== "artifact") {
        return Result.fail("This artifact is not on the board.");
      }
      const source = roomArtifactSource(board, from.id);
      // Never over content, nor of itself. The source found is no view, so no views go in a ring.
      if (
        note.artifact !== undefined ||
        source === undefined ||
        source.id === note.id ||
        note.viewOf === source.id
      ) {
        return Result.succeed(board);
      }
      return Result.succeed(withNote(board, note, { ...note, viewOf: source.id }));
    }
    case "comment.reply": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      if (note?.kind !== "comment") return Result.fail("This comment thread is not on the board.");
      const replies = note.replies ?? [];
      // An agent's answer is named after its run; a client that took the name would keep it out.
      if (change.replyId.startsWith(ROOM_AGENT_REPLY_ID_PREFIX)) {
        return Result.fail("This reply's id is reserved.");
      }
      if (replies.some((reply) => reply.id === change.replyId)) return Result.succeed(board);
      const text = change.text.trim();
      if (text === "") return Result.fail("A reply needs some text.");
      if (replies.length >= ROOM_BOARD_MAX_REPLIES) return Result.fail(ROOM_COMMENT_THREAD_FULL);
      const mentioned = roomMentionsOf(scope, author, text, change.mentions, undefined);
      if (Result.isFailure(mentioned)) return Result.fail(mentioned.failure);
      const reply = {
        id: change.replyId,
        text,
        ...(author === null ? {} : { guestId: author }),
        at,
        ...(mentioned.success.length === 0 ? {} : { mentions: mentioned.success }),
      };
      return Result.succeed(withNote(board, note, { ...note, replies: [...replies, reply] }));
    }
    case "comment.reply.remove": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      const reply = note?.replies?.find((candidate) => candidate.id === change.replyId);
      if (note === undefined || reply === undefined) return Result.succeed(board);
      if (!isRoomCardOwnedBy(reply, author)) {
        return Result.fail("Only the owner and whoever wrote this reply can remove it.");
      }
      const { replies: _replies, ...rest } = note;
      const kept = note.replies?.filter((candidate) => candidate !== reply) ?? [];
      return Result.succeed(
        withNote(board, note, kept.length === 0 ? rest : { ...rest, replies: kept }),
      );
    }
    case "comment.resolve": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      if (note?.kind !== "comment") return Result.fail("This comment thread is not on the board.");
      if ((note.resolved === true) === change.resolved) return Result.succeed(board);
      const { resolved: _resolved, ...rest } = note;
      return Result.succeed(
        withNote(board, note, change.resolved ? { ...rest, resolved: true } : rest),
      );
    }
    case "note.react": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      if (note === undefined) return Result.fail("This card is not on the board.");
      const comment = note.kind === "comment";
      if (change.replyId !== undefined) {
        const replies = comment ? (note.replies ?? []) : [];
        const reply = replies.find((candidate) => candidate.id === change.replyId);
        if (reply === undefined) return Result.fail("This reply is not in the thread.");
        const reactions = toggledReaction(reply.reactions, change.emoji, author, true);
        if (reactions === null) return Result.fail(ROOM_COMMENT_REACTIONS_FULL);
        const { reactions: _reactions, ...rest } = reply;
        const next = reactions.length === 0 ? rest : { ...rest, reactions };
        return Result.succeed(
          withNote(board, note, {
            ...note,
            replies: replies.map((candidate) => (candidate === reply ? next : candidate)),
          }),
        );
      }
      const reactions = toggledReaction(note.reactions, change.emoji, author, comment);
      if (reactions === null) {
        return Result.fail(
          comment ? ROOM_COMMENT_REACTIONS_FULL : "This card has as many reactions as it holds.",
        );
      }
      const { reactions: _reactions, ...rest } = note;
      return Result.succeed(
        withNote(board, note, reactions.length === 0 ? rest : { ...rest, reactions }),
      );
    }
    case "agent-turn.undo": {
      const turn = board.agentTurns?.find((candidate) => candidate.id === change.turnId);
      if (turn === undefined) {
        return Result.fail("The board no longer keeps this agent's work to undo.");
      }
      if (!canUndoRoomAgentTurn(turn, author)) {
        return Result.fail("Only the owner and whoever asked for it can undo an agent's work.");
      }
      if ((turn.undone === true) === change.undone) return Result.succeed(board);
      const { undone: _undone, ...rest } = turn;
      const marked = change.undone ? { ...rest, undone: true as const } : rest;
      const next = roomBoardAfterAgentTurn(board, scope, turn, change.undone, author, at).board;
      return Result.succeed({
        ...next,
        agentTurns: next.agentTurns?.map((candidate) => (candidate === turn ? marked : candidate)),
      });
    }
    case "box.model": {
      const picked = { selection: change.modelSelection, name: change.name, at };
      const same = (current: RoomBoxModel | undefined) =>
        current !== undefined &&
        current.name === change.name &&
        JSON.stringify(current.selection) === JSON.stringify(change.modelSelection);
      if (change.noteId === ROOM_BOARD_ROOM_BOX) {
        if (author !== null) return Result.fail("Only the owner can pick the room thread's model.");
        return Result.succeed(
          same(board.roomBoxModel) ? board : { ...board, roomBoxModel: picked },
        );
      }
      const box = board.notes.find((note) => note.id === change.noteId && note.kind === "thread");
      if (box === undefined) return Result.fail("This thread box is not on the board.");
      if (!isRoomCardOwnedBy(box, author)) {
        return Result.fail("Only the owner and whoever added this thread box can pick its model.");
      }
      if (same(box.boxModel)) return Result.succeed(board);
      return Result.succeed(withNote(board, box, { ...box, boxModel: picked }));
    }
    case "task.run": {
      const task = board.notes.find((candidate) => candidate.id === change.noteId);
      if (task?.kind !== "task") return Result.fail("This task is not on the board.");
      const { run: _run, ...rest } = task;
      if (change.boxId === null) {
        // A run that never went, or was cleared, leaves an unanswered task to do again.
        const { status: _status, ...open } = rest;
        return Result.succeed(
          task.run === undefined
            ? board
            : withNote(board, task, task.answer === undefined ? open : rest),
        );
      }
      const box = board.notes.find((note) => note.id === change.boxId && note.kind === "thread");
      if (box === undefined) return Result.fail("This thread box is not on the board.");
      if ((box.guestId ?? null) !== author) {
        return Result.fail("A task runs only in a thread box of your own.");
      }
      if (task.done === true) return Result.fail("This task is done already.");
      if (task.assignee !== undefined && (task.assignee.guestId ?? null) !== author) {
        return Result.fail("This task is someone else's.");
      }
      return Result.succeed(
        withNote(board, task, {
          ...rest,
          status: "doing",
          assignee: author === null ? {} : { guestId: author },
          run: { boxId: box.id, at },
        }),
      );
    }
    case "board.start": {
      if (author !== null && scope.manages?.(author) !== true) {
        return Result.fail("Only whoever made this board can say where visitors start.");
      }
      const { start: _start, ...rest } = board;
      if (change.noteId === null) return Result.succeed(board.start === undefined ? board : rest);
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      if (note === undefined || note.kind === "comment") {
        return Result.fail("This card is not on the board.");
      }
      return Result.succeed(board.start === note.id ? board : { ...rest, start: note.id });
    }
  }
}

/**
 * Where someone opening the board for the first time starts: the card or section it marks, else
 * its top-left section, else nothing (null), when the whole board shows.
 */
export function roomBoardStartNote(
  board: Pick<RoomBoard, "notes" | "start">,
): RoomBoardNote | null {
  const marked = board.notes.find((note) => note.id === board.start && note.kind !== "comment");
  if (marked !== undefined) return marked;
  return (
    board.notes
      .filter((note) => note.section === true)
      .sort((left, right) => left.y + left.x - (right.y + right.x) || left.y - right.y)[0] ?? null
  );
}

/**
 * The board once a thread box's turn shows on it: each task run in that box before the turn is
 * answered by it, as the box owner's, and stays in progress until a person ticks it off; one
 * someone else took since only loses its run. Any other board is left as it was.
 */
export function roomBoardWithBoxRunDone(
  board: RoomBoard,
  boxId: string,
  turn: { readonly id: string; readonly reply: string; readonly at: string },
): RoomBoard {
  const box = board.notes.find((note) => note.id === boxId && note.kind === "thread");
  const ran = (note: RoomBoardNote) =>
    note.run?.boxId === boxId && Date.parse(note.run.at) <= Date.parse(turn.at);
  if (box === undefined || !board.notes.some(ran)) return board;
  const person = box.guestId === undefined ? {} : { guestId: box.guestId };
  return {
    ...board,
    notes: board.notes.map((note) => {
      if (!ran(note)) return note;
      const { run: _run, ...rest } = note;
      if (note.assignee !== undefined && note.assignee.guestId !== box.guestId) return rest;
      return {
        ...rest,
        ...(note.done === true ? {} : { status: "doing" as const }),
        assignee: person,
        answer: { ...person, excerpt: roomTaskAnswerExcerpt(turn.reply), turnId: turn.id, boxId },
      };
    }),
  };
}

/**
 * An artifact's content after an agent wrote `next` into it: the version it replaces is kept,
 * without its own earlier one, so the card can go back one step.
 */
export function roomArtifactAfterFill(
  current: RoomArtifactContent | undefined,
  next: Omit<RoomArtifactContent, "previous">,
): RoomArtifactContent {
  if (current === undefined) return next;
  const { previous: _older, ...replaced } = current;
  return { ...next, previous: replaced };
}

const isRoomArtifactRecord = Schema.is(RoomArtifactContextRecord);
const isRoomCardsRecord = Schema.is(RoomCardsContextRecord);
const isRoomCommentRecord = Schema.is(RoomCommentContextRecord);
const decodeRoomBox = Schema.decodeUnknownOption(RoomBoxContextPayload);

/**
 * The artifact card of this share that one of a run's messages asked its agent to fill, the
 * guest message it was, if a guest's, and the thread box it went from. A guest's message carries
 * only records the owner's server attached, so the share id names a card of that server's own
 * board.
 */
export function roomArtifactRequestOf(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  shareId: GuestShareId,
):
  | {
      readonly noteId: string;
      readonly guestMessageId?: GuestMessageId;
      readonly boxId?: string;
    }
  | undefined {
  for (const item of items) {
    if (item.type !== "user_message") continue;
    for (const record of item.context?.records ?? []) {
      if (!isRoomArtifactRecord(record) || record.shareId !== shareId) continue;
      const guestMessageId = item.context?.guest?.guestMessageId;
      return {
        noteId: record.noteId,
        ...(guestMessageId === undefined ? {} : { guestMessageId }),
        ...(record.boxId === undefined ? {} : { boxId: record.boxId }),
      };
    }
  }
  return undefined;
}

/** The comment thread of this share that one of a run's messages asked its agent to answer. */
export function roomCommentRequestOf(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  shareId: GuestShareId,
): string | undefined {
  for (const item of items) {
    if (item.type !== "user_message") continue;
    for (const record of item.context?.records ?? []) {
      if (isRoomCommentRecord(record) && record.shareId === shareId) return record.noteId;
    }
  }
  return undefined;
}

/**
 * The thread box whose own thread a run's message was sent in, as the owner's server marked it.
 * Whether that thread really is the box's is for the owner's server to check.
 */
export function roomBoxRequestOf(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): RoomBoxContextPayload | undefined {
  for (const item of items) {
    if (item.type !== "user_message") continue;
    for (const record of item.context?.records ?? []) {
      if (record.kind !== ROOM_BOX_CONTEXT_KIND || !("payload" in record)) continue;
      const box = decodeRoomBox(record.payload);
      if (Option.isSome(box)) return box.value;
    }
  }
  return undefined;
}

/** The labels of the board cards that went with a run's messages. */
export function roomCardLabelsOf(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<string> {
  return items
    .flatMap((item) =>
      item.type === "user_message"
        ? (item.context?.records ?? []).flatMap((record) =>
            isRoomCardsRecord(record) ? record.cards.map((card) => card.label) : [],
          )
        : [],
    )
    .slice(0, ROOM_BOX_CARD_LABELS_MAX);
}

/** The board cards that went with a run's messages, as arrows name them. */
export function roomCardRefsOf(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): ReadonlyArray<string> {
  return items
    .flatMap((item) =>
      item.type === "user_message"
        ? (item.context?.records ?? []).flatMap((record) =>
            isRoomCardsRecord(record)
              ? record.cards.flatMap((card) => (card.ref === undefined ? [] : [card.ref]))
              : [],
          )
        : [],
    )
    .slice(0, ROOM_BOX_CARD_LABELS_MAX);
}

/**
 * The board with the lines that carried `refs` into a thread box marked sent at `at`: `sentAt`
 * into the box or its artifact, `sentFor` into a card other boxes reach, `sentCards` from a
 * section. With `settled`, the run that carried them ended: those sent marks get a done mark
 * beside them, or a failed run's are dropped so the cards go again.
 */
export function roomBoardWithCardsSent(
  board: RoomBoard,
  boxId: string,
  artifactId: string | undefined,
  refs: ReadonlyArray<string>,
  at: string,
  settled?: "done" | "failed",
): RoomBoard {
  const edges = board.edges ?? [];
  const box = roomBoxRef(boxId);
  // The artifacts the box has a line to, each as the one it shows: a view's is its source.
  const sources = edges.flatMap((edge) => {
    const source =
      edge.from === box
        ? roomArtifactSource(board, roomBoardNoteOfRef(board, edge.to)?.id)
        : undefined;
    return source === undefined ? [] : [roomBoardNoteRef(source.id)];
  });
  // A prompt naming none, as one asked from a comment thread, still found its cards on the
  // artifact the box rewrites, the first one it has a line to, as the board finds them.
  const named = roomArtifactSource(board, artifactId);
  const artifact =
    artifactId === undefined
      ? sources[0]
      : named === undefined
        ? undefined
        : roomBoardNoteRef(named.id);
  const rewrites = artifact !== undefined && sources.includes(artifact);
  const roots = new Set([box, ...(rewrites ? [artifact] : [])]);
  const sent = new Set(refs.filter((ref) => !roots.has(ref)));
  // Every card a prompt from this box carries, as it finds them: along lines into the box or its
  // artifact, and into those cards, never through another box. A section's line carries its cards.
  const reached = new Set<string>();
  const held = new Map<string, ReadonlyArray<string>>();
  let frontier = [...roots];
  while (frontier.length > 0) {
    const next: Array<string> = [];
    for (const edge of edges) {
      if (!frontier.includes(edge.to) || roots.has(edge.from) || reached.has(edge.from)) continue;
      const note = roomBoardNoteOfRef(board, edge.from);
      if (note === undefined || note.kind === "thread") continue;
      reached.add(edge.from);
      next.push(edge.from);
      if (note.section !== true) continue;
      const cards = roomSectionCards(board, note).map((card) => roomBoardNoteRef(card.id));
      held.set(edge.from, cards);
      for (const ref of cards) {
        if (roots.has(ref) || reached.has(ref)) continue;
        reached.add(ref);
        next.push(ref);
      }
    }
    frontier = next;
  }
  let changed = false;
  const next = edges.map((edge) => {
    const cards = held.get(edge.from);
    if (settled !== undefined) {
      const carried =
        cards !== undefined
          ? (roots.has(edge.to) || reached.has(edge.to)) && cards.some((ref) => sent.has(ref))
          : sent.has(edge.from) && (roots.has(edge.to) || reached.has(edge.to));
      if (!carried) return edge;
      const took = cards?.filter((ref) => sent.has(ref));
      const after =
        settled === "done"
          ? roomEdgeDone(edge, boxId, roots.has(edge.to), took, at)
          : roomEdgeToSendAgain(
              edge,
              took !== undefined
                ? { kind: "cards", cards: took, boxId }
                : roots.has(edge.to)
                  ? { kind: "shared" }
                  : { kind: "box", boxId },
            );
      if (after !== edge) changed = true;
      return after;
    }
    if (cards !== undefined) {
      const took = cards.filter((ref) => sent.has(ref));
      if (took.length === 0 || (!roots.has(edge.to) && !reached.has(edge.to))) return edge;
      const before = edge.sentCards?.[boxId] ?? {};
      if (took.every((ref) => before[ref] === at)) return edge;
      const marks = Object.fromEntries([
        ...Object.entries(before).filter(([ref]) => cards.includes(ref) && !took.includes(ref)),
        ...took.map((ref) => [ref, at] as const),
      ]);
      changed = true;
      return { ...edge, sentCards: { ...edge.sentCards, [boxId]: marks } };
    }
    if (!sent.has(edge.from)) return edge;
    if (roots.has(edge.to)) {
      if (edge.sentAt === at) return edge;
      changed = true;
      return { ...edge, sentAt: at };
    }
    if (!reached.has(edge.to) || edge.sentFor?.[boxId] === at) return edge;
    changed = true;
    return { ...edge, sentFor: { ...edge.sentFor, [boxId]: at } };
  });
  return changed ? { ...board, edges: next } : board;
}

/** An edge with the sent marks a finished run from `boxId` carried along it marked done. */
function roomEdgeDone(
  edge: RoomBoardEdge,
  boxId: string,
  shared: boolean,
  took: ReadonlyArray<string> | undefined,
  at: string,
): RoomBoardEdge {
  if (took !== undefined) {
    const sent = edge.sentCards?.[boxId] ?? {};
    const before = edge.doneCards?.[boxId] ?? {};
    const done = took.filter((ref) => sent[ref] !== undefined && before[ref] !== at);
    if (done.length === 0) return edge;
    // Like the sent marks, only cards the line still carries keep theirs.
    const marks = Object.fromEntries([
      ...Object.entries(before).filter(([ref]) => sent[ref] !== undefined),
      ...done.map((ref) => [ref, at] as const),
    ]);
    return { ...edge, doneCards: { ...edge.doneCards, [boxId]: marks } };
  }
  if (shared) {
    return edge.sentAt === undefined || edge.doneAt === at ? edge : { ...edge, doneAt: at };
  }
  return edge.sentFor?.[boxId] === undefined || edge.doneFor?.[boxId] === at
    ? edge
    : { ...edge, doneFor: { ...edge.doneFor, [boxId]: at } };
}

const withoutKeys = <V>(record: Readonly<Record<string, V>>, keys: ReadonlyArray<string>) =>
  Object.fromEntries(Object.entries(record).filter(([key]) => !keys.includes(key)));

/** Which of a line's sent and done marks go: every one, some cards' of a section's line, the
 * shared ones of a line into a box or its artifact, or one box's on a line between cards. */
type RoomEdgeMarks =
  | { readonly kind: "all" }
  | { readonly kind: "cards"; readonly cards: ReadonlyArray<string>; readonly boxId?: string }
  | { readonly kind: "shared" }
  | { readonly kind: "box"; readonly boxId: string };

/** An edge without those marks, so the next prompt carries its card again. */
function roomEdgeToSendAgain(edge: RoomBoardEdge, marks: RoomEdgeMarks): RoomBoardEdge {
  if (marks.kind === "all") {
    const {
      sentAt: _a,
      sentFor: _b,
      sentCards: _c,
      doneAt: _d,
      doneFor: _e,
      doneCards: _f,
      ...rest
    } = edge;
    return Object.keys(rest).length === Object.keys(edge).length ? edge : rest;
  }
  if (marks.kind === "shared") {
    if (edge.sentAt === undefined && edge.doneAt === undefined) return edge;
    const { sentAt: _sentAt, doneAt: _doneAt, ...rest } = edge;
    return rest;
  }
  const { sentFor, doneFor, sentCards, doneCards } = edge;
  if (marks.kind === "box") {
    if (sentFor?.[marks.boxId] === undefined && doneFor?.[marks.boxId] === undefined) return edge;
    const { sentFor: _sentFor, doneFor: _doneFor, ...rest } = edge;
    const others = (byBox: RoomBoardEdge["sentFor"]) => withoutKeys(byBox ?? {}, [marks.boxId]);
    const some = (byBox: Record<string, string>) => Object.keys(byBox).length > 0;
    return {
      ...rest,
      ...(some(others(sentFor)) ? { sentFor: others(sentFor) } : {}),
      ...(some(others(doneFor)) ? { doneFor: others(doneFor) } : {}),
    };
  }
  const named = (boxId: string) => marks.boxId === undefined || marks.boxId === boxId;
  const marked = (byBox: RoomBoardEdge["sentCards"]) =>
    Object.entries(byBox ?? {}).some(
      ([boxId, cards]) => named(boxId) && marks.cards.some((ref) => cards[ref] !== undefined),
    );
  if (!marked(sentCards) && !marked(doneCards)) return edge;
  const left = (byBox: NonNullable<RoomBoardEdge["sentCards"]>) =>
    Object.fromEntries(
      Object.entries(byBox).map(([boxId, cards]) => [
        boxId,
        named(boxId) ? withoutKeys(cards, marks.cards) : cards,
      ]),
    );
  return {
    ...edge,
    ...(sentCards === undefined ? {} : { sentCards: left(sentCards) }),
    ...(doneCards === undefined ? {} : { doneCards: left(doneCards) }),
  };
}

/**
 * When a card last changed in a way a prompt from `boxId` should carry again: its text or status
 * edited, a reply in its thread (except this box's own agent's answer), or new content an agent
 * wrote into it. Undefined for a card unchanged since it was added.
 */
export function roomBoardCardChangedAt(note: RoomBoardNote, boxId: string): string | undefined {
  const times = [
    note.editedAt,
    ...(note.replies ?? []).flatMap((reply) => (reply.agent?.boxId === boxId ? [] : [reply.at])),
    note.artifact?.updatedAt,
    note.changes?.updatedAt,
  ].filter((time): time is string => time !== undefined);
  return times.reduce<string | undefined>(
    (latest, time) =>
      latest === undefined || Date.parse(time) > Date.parse(latest) ? time : latest,
    undefined,
  );
}

/** What a run was asked, without the chips its cards and artifact left in the text. */
export const roomRunPromptText = (items: ReadonlyArray<OrchestrationV2TurnItem>): string =>
  replaceComposerContextReferences(
    [...items]
      .sort((left, right) => left.ordinal - right.ordinal)
      .flatMap((item) => (item.type === "user_message" ? [item.text] : []))[0] ?? "",
    () => "",
  );

/** The last thing the agent said in a run, whole, or "" when it said nothing. */
export const roomRunReplyText = (items: ReadonlyArray<OrchestrationV2TurnItem>): string =>
  [...items]
    .sort((left, right) => left.ordinal - right.ordinal)
    .flatMap((item) =>
      item.type === "assistant_message" && !item.streaming ? [item.text.trim()] : [],
    )
    .findLast((text) => text !== "") ?? "";

/** The note an arrow or a card names (`note:<id>`), if the board has it. */
export const roomBoardNoteOfRef = (board: RoomBoard | undefined, ref: string) =>
  board?.notes.find((note) => roomBoardNoteRef(note.id) === ref);

/** How big a section is until someone resizes it. */
export const ROOM_BOARD_SECTION_SIZE: RoomBoardSize = { w: 640, h: 420 };
const PIN_SIZE: RoomBoardSize = { w: 32, h: 32 };
const NOTE_SIZES: Partial<Record<NonNullable<RoomBoardNote["kind"]>, RoomBoardSize>> = {
  artifact: { w: 380, h: 400 },
  thread: { w: 340, h: 460 },
  code: { w: 560, h: 420 },
  "pull-request": { w: 360, h: 300 },
  comment: PIN_SIZE,
  task: ROOM_BOARD_TASK_SIZE,
};

/** A card's size as the board draws it, or about, until someone resizes it. */
export const roomBoardNoteSize = (
  note: Pick<RoomBoardNote, "kind" | "size" | "section">,
): RoomBoardSize =>
  note.size ??
  (note.section === true
    ? ROOM_BOARD_SECTION_SIZE
    : note.kind === undefined
      ? ROOM_BOARD_NOTE_SIZE
      : (NOTE_SIZES[note.kind] ?? ROOM_BOARD_NOTE_SIZE));

/**
 * The cards in a section: those whose middle is inside it, as dragging it carries them. A line
 * from a section carries each as if it had a line of its own, so this is read whenever a line is,
 * and a card moved in or out later counts or stops counting. Never sections, boxes or comments.
 */
export function roomSectionCards(
  board: Pick<RoomBoard, "notes">,
  section: RoomBoardNote,
): ReadonlyArray<RoomBoardNote> {
  if (section.section !== true) return [];
  const area = roomBoardNoteSize(section);
  return board.notes.filter((note) => {
    if (note.section === true || note.kind === "thread" || note.kind === "comment") return false;
    if (note.pinnedTo !== undefined) return false;
    const size = roomBoardNoteSize(note);
    const x = note.x + size.w / 2;
    const y = note.y + size.h / 2;
    return x >= section.x && x <= section.x + area.w && y >= section.y && y <= section.y + area.h;
  });
}

/** A thread box as lines name it: the room thread's own card, or a thread note. */
export const roomBoxRef = (boxId: string): string =>
  boxId === ROOM_BOARD_ROOM_BOX
    ? roomBoardCardRef(ROOM_BOARD_THREAD_CARD)
    : roomBoardNoteRef(boxId);

/** The thread box a line from `ref` starts at, or undefined when it starts at anything else. */
export function roomBoxIdOfRef(board: RoomBoard, ref: string): string | undefined {
  if (ref === roomBoardCardRef(ROOM_BOARD_THREAD_CARD)) return ROOM_BOARD_ROOM_BOX;
  const note = roomBoardNoteOfRef(board, ref);
  return note?.kind === "thread" ? note.id : undefined;
}

/** Whose agent a thread box is: a guest's, or null for the owner's. */
export const roomBoxPerson = (board: RoomBoard, boxId: string): GuestId | null =>
  boxId === ROOM_BOARD_ROOM_BOX
    ? null
    : (board.notes.find((note) => note.id === boxId)?.guestId ?? null);

/**
 * Every thread box a card at `ref` would go to with a prompt: the box itself, a box whose artifact
 * it is, and those its lines lead to, or the lines of a section it is in, as a prompt from a box
 * finds its cards.
 */
export function roomBoxesReachedFrom(board: RoomBoard, ref: string): ReadonlySet<string> {
  const edges = board.edges ?? [];
  const sections = board.notes.filter((note) => note.section === true);
  const boxes = new Set<string>();
  const seen = new Set([ref]);
  let frontier = [ref];
  while (frontier.length > 0) {
    const next: Array<string> = [];
    for (const at of frontier) {
      const box = roomBoxIdOfRef(board, at);
      if (box !== undefined) {
        boxes.add(box);
        continue;
      }
      const note = roomBoardNoteOfRef(board, at);
      for (const section of sections) {
        const holder = roomBoardNoteRef(section.id);
        if (note === undefined || seen.has(holder)) continue;
        if (!roomSectionCards(board, section).includes(note)) continue;
        seen.add(holder);
        next.push(holder);
      }
      const artifact = note?.kind === "artifact";
      for (const edge of edges) {
        const rewriter = artifact && edge.to === at ? roomBoxIdOfRef(board, edge.from) : undefined;
        if (rewriter !== undefined) boxes.add(rewriter);
        if (edge.from === at && !seen.has(edge.to)) {
          seen.add(edge.to);
          next.push(edge.to);
        }
      }
    }
    frontier = next;
  }
  return boxes;
}

/**
 * Whether a line carries its card to an agent not `person`'s (null for the owner). Only a box's
 * own person pins a line into it or has it carry a card again.
 */
const reachesSomeoneElsesBox = (board: RoomBoard, edge: RoomBoardEdge, person: GuestId | null) =>
  [...roomBoxesReachedFrom(board, edge.to)].some((boxId) => roomBoxPerson(board, boxId) !== person);

/**
 * The thread box whose changes a code window shows: the first one with a line into it, which the
 * board keeps the only one. Undefined once no box has a line to it.
 */
export function roomWindowBoxId(board: RoomBoard, noteId: string): string | undefined {
  const ref = roomBoardNoteRef(noteId);
  for (const edge of board.edges ?? []) {
    if (edge.to !== ref) continue;
    const boxId = roomBoxIdOfRef(board, edge.from);
    if (boxId !== undefined) return boxId;
  }
  return undefined;
}

/** The code windows that show this thread box's changes. */
export const roomBoxCodeWindows = (board: RoomBoard, boxId: string): ReadonlyArray<RoomBoardNote> =>
  board.notes.filter((note) => note.kind === "code" && roomWindowBoxId(board, note.id) === boxId);

/** A pull request window as a card's label names it: 'Pull request #12 "Fix login"'. */
export function roomPullRequestLabel(note: Pick<RoomBoardNote, "url" | "pullRequest">): string {
  const ref = note.url === undefined ? null : roomPullRequestOf(note.url);
  const title = note.pullRequest?.pullRequest?.title.trim().replace(/\s+/g, " ") ?? "";
  if (ref === null) return "Pull request";
  return title === ""
    ? `Pull request ${ref.repository}#${ref.number}`
    : `Pull request #${ref.number} "${title}"`;
}

/** A link card as a card's label names it: "Figma link from Sam", or "Link from Sam". */
export function roomLinkLabel(url: string | undefined, by: string): string {
  const embed = url === undefined ? null : roomEmbedOf(url);
  return embed === null || embed.source === "web"
    ? `Link from ${by}`
    : `${embed.name} link from ${by}`;
}

/**
 * What a prompt carries of a link card: its title (the one someone gave it, else the one read
 * from the address) and the address, which the agent opens with its own tools. Never the page.
 */
export function roomLinkPromptText(note: Pick<RoomBoardNote, "text" | "url">): string {
  const title = note.text.trim() || (note.url === undefined ? "" : roomEmbedOf(note.url)?.title);
  return [title, note.url].filter(Boolean).join("\n");
}

/** What people call an element of a page, by its tag. */
export const ROOM_MARK_NOUNS: Readonly<Record<string, string>> = {
  a: "link",
  button: "button",
  img: "image",
  svg: "image",
  video: "video",
  p: "paragraph",
  li: "list item",
  input: "field",
  textarea: "field",
  select: "field",
  table: "table",
  form: "form",
  nav: "menu",
  header: "header",
  footer: "footer",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
};
const MARK_WHERE_LENGTH = 60;

// A page's text is untrusted and may be long: one line, cut, and never able to close a code span.
const markLine = (text: string | undefined, max: number) => {
  const line = (text ?? "").replace(/[\s`]+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1).trimEnd()}…` : line;
};

/** Where a marked note points, in words for people: `On the "Get a quote" button:`. */
export function roomMarkWhere(mark: RoomBoardMark): string {
  const quote = markLine(mark.quote, MARK_WHERE_LENGTH);
  if (quote !== "") return `On "${quote}":`;
  const noun = ROOM_MARK_NOUNS[mark.tag ?? ""];
  const text = markLine(mark.text, MARK_WHERE_LENGTH);
  if (text === "") return noun === undefined ? "On this part of the page:" : `On the ${noun}:`;
  return `On the "${text}" ${noun ?? "part"}:`;
}

/**
 * A marked note as a prompt carries it: the element as the page's source has it, then what the
 * person wrote, without the line that said where in words when it still starts the note.
 */
export function roomMarkPromptText(note: Pick<RoomBoardNote, "text" | "mark">): string {
  const text = note.text.trim();
  const { mark } = note;
  if (mark === undefined || text === "") return text;
  const where = roomMarkWhere(mark);
  const said = text.startsWith(where) ? text.slice(where.length).trim() : text;
  const tag = markLine(mark.tag, 32);
  const noun = ROOM_MARK_NOUNS[tag] ?? (tag === "" ? "element" : `<${tag}> element`);
  const reads = markLine(mark.text, ROOM_BOARD_MARK_TEXT_MAX_LENGTH);
  const quote = markLine(mark.quote, ROOM_BOARD_MARK_TEXT_MAX_LENGTH);
  const detail = [
    `${/^[aeio]/.test(noun) ? "an" : "a"} ${noun}${reads === "" ? "" : ` reading "${reads}"`}`,
    ...(quote === "" ? [] : [`the selected text "${quote}"`]),
  ].join(", ");
  const selector = markLine(mark.selector, ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH);
  return `On the element matching \`${selector}\` (${detail}): ${said}`;
}

/**
 * Who last edited a card's text or a task's status: a guest, null for the owner, undefined when
 * nobody did or it is not known. A card from before `editedBy` was kept reads its `changed`.
 */
export function roomCardEditor(
  note: Pick<RoomBoardNote, "editedAt" | "editedBy" | "changed">,
): GuestId | null | undefined {
  if (note.editedAt === undefined) return undefined;
  if (note.editedBy !== undefined) return note.editedBy;
  return note.changed?.at === note.editedAt ? (note.changed.guestId ?? null) : undefined;
}

/**
 * A card's label and who wrote it, from the board, so it reads the same to everyone: "Note from
 * Sam", "Task from the owner", 'Artifact "Plan"'. `nameOf` names a guest, or with no id the
 * owner; an artifact's content is its last writer's agent's.
 */
export function roomBoardCardIdentity(
  note: RoomBoardNote,
  nameOf: (guestId: GuestId | undefined) => string | undefined,
): Pick<RoomBoardContextCard, "label" | "author" | "name" | "editedBy"> {
  const by = nameOf(note.guestId) ?? (note.guestId === undefined ? "the owner" : "a guest");
  const title = note.text.trim().replace(/\s+/g, " ");
  const label =
    note.kind === "artifact"
      ? title === ""
        ? "Artifact"
        : `Artifact "${title}"`
      : note.kind === "thread"
        ? title === ""
          ? "Thread box"
          : `Thread box "${title}"`
        : note.kind === "code"
          ? title === ""
            ? "Code window"
            : `Code window "${title}"`
          : note.kind === "pull-request"
            ? roomPullRequestLabel(note)
            : note.kind === "task"
              ? `Task from ${by}`
              : note.kind === "link"
                ? roomLinkLabel(note.url, by)
                : note.kind === "comment"
                  ? `Comment thread from ${by}`
                  : note.pinnedTo === undefined
                    ? `Note from ${by}`
                    : `Comment from ${by} on a reply`;
  const writer = note.kind === "artifact" && note.artifact !== undefined ? note.artifact : note;
  const agent = writer !== note && note.artifact?.byHand !== true;
  const writerName = nameOf(writer.guestId);
  const editor = writer === note ? roomCardEditor(note) : undefined;
  const editorName = editor === undefined ? undefined : nameOf(editor ?? undefined);
  return {
    label: label.slice(0, 200),
    ...(editor === undefined || editor === (note.guestId ?? null)
      ? {}
      : {
          editedBy: {
            author: editor === null ? ("owner" as const) : ("guest" as const),
            ...(editorName === undefined ? {} : { name: editorName }),
          },
        }),
    author:
      writer.guestId === undefined
        ? agent
          ? "owner_agent"
          : "owner"
        : agent
          ? "guest_agent"
          : "guest",
    ...(writerName === undefined ? {} : { name: writerName }),
  };
}

/**
 * Text as a thread box or an artifact shows it: one paragraph of plain text, cut to `max`. Also
 * reads text already put on one line, as a live preview is, so table cells become "a · b".
 */
export function roomBoxExcerpt(text: string, max: number): string {
  const plain = text
    .replace(/(^|\s)(?:#{1,6}|-{3,}|\*{3,}|_{3,})(?=\s|$)/g, "$1")
    .replace(/^\s*>\s?/gm, "")
    .replace(/!?\[([^\]\n]*)\]\([^)\s]*\)/g, "$1")
    .replace(/```\w*|~~~\w*|`|\*\*|~~/g, "")
    .replace(/\s*\|[\s|:-]*/g, " · ")
    .replace(/\s+/g, " ")
    .replace(/([:.!?]) · /g, "$1 ")
    .replace(/^(?: ?· ?)+|(?: ?· ?)+$/g, "")
    .trim();
  return plain.length <= max
    ? plain
    : `${plain.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

const FENCE_LINE = /^ {0,3}(?:`{3,}|~{3,})/gm;

/**
 * What an agent's reply posts in a comment thread: its markdown without hidden characters, cut
 * at a line or a word break to what the thread keeps. A code block the cut leaves open is closed.
 */
export function roomCommentAnswer(reply: string): string {
  const text = sanitizeLinkedPrompt(reply).text;
  const max = ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH;
  if (text.length <= max) return text;
  // Room for "…" and a closing fence.
  const head = text.slice(0, max - 5);
  const line = head.lastIndexOf("\n");
  const word = head.search(/\s\S*$/);
  const end = line >= max / 2 ? line : word >= max / 2 ? word : head.length;
  const cut = `${head
    .slice(0, end)
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd()}…`;
  return (cut.match(FENCE_LINE)?.length ?? 0) % 2 === 1 ? `${cut}\n\`\`\`` : cut;
}

const HTML_DOCUMENT = /^(?:<!doctype html|<html)/i;
const HTML_FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*html(?:[ \t].*)?$/i;

/** The first ```html block of a reply that holds a whole page, or null. */
function htmlDocumentBlock(reply: string): string | null {
  const lines = reply.split(/\r?\n/);
  for (let start = 0; start < lines.length; start++) {
    const fence = HTML_FENCE_OPEN.exec(lines[start] ?? "")?.[1];
    if (fence === undefined) continue;
    const close = new RegExp(`^ {0,3}\\${fence[0]}{${fence.length},}[ \t]*$`);
    let end = start + 1;
    while (end < lines.length && !close.test(lines[end] ?? "")) end++;
    const content = lines
      .slice(start + 1, end)
      .join("\n")
      .trim();
    if (HTML_DOCUMENT.test(content)) return content;
    start = end;
  }
  return null;
}

/**
 * What an agent's reply puts in an artifact card: the page in its first ```html block that holds
 * a whole document (starting `<!doctype html` or `<html`, which is how clients tell a page from
 * markdown), or else the whole reply as markdown. Cut to what the board keeps.
 */
export function roomArtifactBody(reply: string): {
  readonly body: string;
  readonly truncated: boolean;
} {
  const full = htmlDocumentBlock(reply) ?? reply.trim();
  if (full.length <= ROOM_ARTIFACT_MAX_LENGTH) return { body: full, truncated: false };
  return {
    body: full.slice(0, ROOM_ARTIFACT_MAX_LENGTH).replace(/[\uD800-\uDBFF]$/, ""),
    truncated: true,
  };
}

/**
 * A finished reply as its thread box keeps it: the page it wrote, when it holds a whole one, so
 * the box can show it as a page by name, or else its words.
 */
export const roomBoxReply = (reply: string): string =>
  roomBoxExcerpt(htmlDocumentBlock(reply) ?? reply, ROOM_BOX_REPLY_MAX_LENGTH);
