import {
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_CODE_WINDOWS,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_PULL_REQUESTS,
  ROOM_BOARD_MAX_REACTIONS,
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOARD_MAX_THREADS,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  ROOM_BOX_CARD_LABELS_MAX,
  ROOM_BOX_CONTEXT_KIND,
  ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH,
  isRoomBoardUrl,
  roomPullRequestOf,
  roomBoardCardRef,
  roomBoardNoteRef,
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
  type RoomBoardChange,
  type RoomBoardContextCard,
  type RoomBoardEdge,
  type RoomBoardNote,
  type RoomBoardReaction,
  type RoomBoardSize,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import { replaceComposerContextReferences } from "./composerContextReferences.ts";
import { sanitizeLinkedPrompt } from "./promptLinks.ts";

export const ROOM_BOARD_FULL = "This board has as many notes as it holds. Remove one first.";
export const ROOM_COMMENT_THREAD_FULL = `A comment thread holds ${ROOM_BOARD_MAX_REPLIES} replies. Start a new one.`;

export const EMPTY_ROOM_BOARD: RoomBoard = { positions: {}, notes: [] };

/** Starts the id of every reply an agent's run wrote. No reply a client sends may use it. */
export const ROOM_AGENT_REPLY_ID_PREFIX = "agent:";

/** What a board is about: the cards it has, and the people a task can be for. */
export interface RoomBoardScope {
  /** Only these cards, so the positions and arrows cannot grow without bound. */
  readonly hasCard: (cardId: string) => boolean;
  /** Called only for a named person; a task with no one named is for the room's owner. */
  readonly hasPerson: (guestId: GuestId) => boolean;
}

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
  if (kind !== "task" && (change.done !== undefined || assigns)) {
    return Result.fail("Only a task can be done or assigned.");
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
      ...(kind === "comment" ? { createdAt: at } : {}),
      ...(change.section === true ? { section: true } : {}),
    } satisfies RoomBoardNote);
  const { done: _done, assignee: _assignee, size: _size, color: _color, ...rest } = base;
  const done = change.done ?? base.done === true;
  const assignee = change.assignee === undefined ? base.assignee : change.assignee;
  const size = change.size ?? base.size;
  const color = change.color ?? base.color;
  // A card edited since a prompt carried it goes with the next one again.
  const edited =
    existing !== undefined && (change.text !== existing.text || done !== (existing.done === true));
  return Result.succeed({
    ...rest,
    ...(edited ? { editedAt: at } : {}),
    text: change.text,
    x: change.x,
    y: change.y,
    ...(done ? { done } : {}),
    ...(assignee === undefined || assignee === null ? {} : { assignee }),
    ...(size === undefined ? {} : { size }),
    ...(color === undefined ? {} : { color }),
  });
}

const sameSize = (left: RoomBoardSize | undefined, right: RoomBoardSize | undefined) =>
  left?.w === right?.w && left?.h === right?.h;

const sameNote = (left: RoomBoardNote, right: RoomBoardNote) =>
  left.text === right.text &&
  left.x === right.x &&
  left.y === right.y &&
  left.done === right.done &&
  left.assignee?.guestId === right.assignee?.guestId &&
  (left.assignee === undefined) === (right.assignee === undefined) &&
  sameSize(left.size, right.size) &&
  left.color === right.color;

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

const withNote = (board: RoomBoard, note: RoomBoardNote, next: RoomBoardNote): RoomBoard => ({
  ...board,
  notes: board.notes.map((other) => (other === note ? next : other)),
});

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
      return Result.succeed(
        roomBoardWithEdges(
          { ...board, notes: board.notes.filter((note) => note.id !== change.noteId) },
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
      if (
        [change.from, change.to].some((ref) => roomBoardNoteOfRef(board, ref)?.section === true)
      ) {
        return Result.fail("An arrow cannot join a section.");
      }
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
        edges: [...edges, { id: change.edgeId, from: change.from, to: change.to }],
      });
    }
    case "edge.remove":
      return board.edges?.some((edge) => edge.id === change.edgeId) === true
        ? Result.succeed(roomBoardWithEdges(board, (edge) => edge.id !== change.edgeId))
        : Result.succeed(board);
    // Anyone who may draw or remove a line may pin it.
    case "edge.pin": {
      const edge = board.edges?.find((candidate) => candidate.id === change.edgeId);
      if (edge === undefined) return Result.fail("This arrow is not on the board.");
      if ((edge.pinned === true) === change.pinned) return Result.succeed(board);
      const { pinned: _pinned, ...rest } = edge;
      const next = change.pinned ? { ...rest, pinned: true as const } : rest;
      return Result.succeed({
        ...board,
        edges: board.edges?.map((candidate) => (candidate === edge ? next : candidate)),
      });
    }
    case "artifact.restore": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      const current = note?.kind === "artifact" ? note.artifact : undefined;
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
      const reply = {
        id: change.replyId,
        text,
        ...(author === null ? {} : { guestId: author }),
        at,
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
      if (note === undefined || note.kind === "comment") {
        return Result.fail("This card is not on the board.");
      }
      const reactions = note.reactions ?? [];
      const mine = (reaction: RoomBoardReaction) =>
        reaction.emoji === change.emoji && (reaction.guestId ?? null) === author;
      const { reactions: _reactions, ...rest } = note;
      if (reactions.some(mine)) {
        const kept = reactions.filter((reaction) => !mine(reaction));
        return Result.succeed(
          withNote(board, note, kept.length === 0 ? rest : { ...rest, reactions: kept }),
        );
      }
      if (reactions.length >= ROOM_BOARD_MAX_REACTIONS) {
        return Result.fail("This card has as many reactions as it holds.");
      }
      const reaction = { emoji: change.emoji, ...(author === null ? {} : { guestId: author }) };
      return Result.succeed(
        withNote(board, note, { ...rest, reactions: [...reactions, reaction] }),
      );
    }
  }
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
 * The board with the lines that carried `refs` into a thread box marked sent at `at`: into the box
 * or the artifact it rewrites in `sentAt`, into a card whose lines lead there in `sentFor` for this
 * box alone, as other boxes reach that card too. Lines no prompt from this box could carry stay as
 * they were, so a sender can mark only what their own prompt took.
 */
export function roomBoardWithCardsSent(
  board: RoomBoard,
  boxId: string,
  artifactId: string | undefined,
  refs: ReadonlyArray<string>,
  at: string,
): RoomBoard {
  const edges = board.edges ?? [];
  const box = roomBoxRef(boxId);
  // A prompt naming none, as one asked from a comment thread, still found its cards on the
  // artifact the box rewrites, the first one it has a line to, as the board finds them.
  const artifact =
    artifactId === undefined
      ? edges.find(
          (edge) => edge.from === box && roomBoardNoteOfRef(board, edge.to)?.kind === "artifact",
        )?.to
      : roomBoardNoteRef(artifactId);
  const rewrites =
    artifact !== undefined &&
    roomBoardNoteOfRef(board, artifact)?.kind === "artifact" &&
    edges.some((edge) => edge.from === box && edge.to === artifact);
  const roots = new Set([box, ...(rewrites ? [artifact] : [])]);
  const sent = new Set(refs.filter((ref) => !roots.has(ref)));
  // Every card a prompt from this box carries, as it finds them: along lines into the box or its
  // artifact, and into those cards, never through another box.
  const reached = new Set<string>();
  let frontier = [...roots];
  while (frontier.length > 0) {
    const next: Array<string> = [];
    for (const edge of edges) {
      if (!frontier.includes(edge.to) || roots.has(edge.from) || reached.has(edge.from)) continue;
      const note = roomBoardNoteOfRef(board, edge.from);
      if (note === undefined || note.kind === "thread") continue;
      reached.add(edge.from);
      next.push(edge.from);
    }
    frontier = next;
  }
  let changed = false;
  const next = edges.map((edge) => {
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

/**
 * A card's label and who wrote it, from the board, so it reads the same to everyone: "Note from
 * Sam", "Task from the owner", 'Artifact "Plan"'. `nameOf` names a guest, or with no id the
 * owner; an artifact's content is its last writer's agent's.
 */
export function roomBoardCardIdentity(
  note: RoomBoardNote,
  nameOf: (guestId: GuestId | undefined) => string | undefined,
): Pick<RoomBoardContextCard, "label" | "author" | "name"> {
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
                ? `Link from ${by}`
                : note.kind === "comment"
                  ? `Comment thread from ${by}`
                  : note.pinnedTo === undefined
                    ? `Note from ${by}`
                    : `Comment from ${by} on a reply`;
  const writer = note.kind === "artifact" && note.artifact !== undefined ? note.artifact : note;
  const agent = writer !== note;
  const writerName = nameOf(writer.guestId);
  return {
    label: label.slice(0, 200),
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
