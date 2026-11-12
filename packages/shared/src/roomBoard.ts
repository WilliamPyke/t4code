import {
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_THREADS,
  ROOM_BOX_CARD_LABELS_MAX,
  ROOM_BOX_CONTEXT_KIND,
  isRoomBoardUrl,
  roomBoardCardRef,
  roomBoardNoteRef,
  RoomArtifactContextRecord,
  RoomBoxContextPayload,
  RoomCardsContextRecord,
  type GuestId,
  type GuestMessageId,
  type GuestShareId,
  type OrchestrationV2TurnItem,
  type RoomArtifactContent,
  type RoomBoard,
  type RoomBoardChange,
  type RoomBoardEdge,
  type RoomBoardNote,
  type RoomBoardSize,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

export const ROOM_BOARD_FULL = "This board has as many notes as it holds. Remove one first.";

export const EMPTY_ROOM_BOARD: RoomBoard = { positions: {}, notes: [] };

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
): Result.Result<RoomBoardNote, string> {
  const kind = existing === undefined ? change.kind : existing.kind;
  // The server never fetches the address; clients open it only in a new tab.
  const linkOk =
    change.url === undefined ? kind !== "link" : kind === "link" && isRoomBoardUrl(change.url);
  if (existing === undefined && !linkOk) {
    return Result.fail("A link card needs an http or https address, and only a link card has one.");
  }
  const assigns = change.assignee !== undefined && change.assignee !== null;
  if (kind !== "task" && (change.done !== undefined || assigns)) {
    return Result.fail("Only a task can be done or assigned.");
  }
  if (change.assignee?.guestId !== undefined && !scope.hasPerson(change.assignee.guestId)) {
    return Result.fail("A task can only be assigned to someone in the room.");
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
    } satisfies RoomBoardNote);
  const { done: _done, assignee: _assignee, size: _size, ...rest } = base;
  const done = change.done ?? base.done === true;
  const assignee = change.assignee === undefined ? base.assignee : change.assignee;
  const size = change.size ?? base.size;
  return Result.succeed({
    ...rest,
    text: change.text,
    x: change.x,
    y: change.y,
    ...(done ? { done } : {}),
    ...(assignee === undefined || assignee === null ? {} : { assignee }),
    ...(size === undefined ? {} : { size }),
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
  sameSize(left.size, right.size);

/**
 * The board after one change by `author` (null for the room's owner), the same board when the
 * change does nothing, or why the board does not take it. The owner's server applies it to a
 * room's board and the relay to a team's, so both take and refuse the same changes.
 */
export function applyRoomBoardChange(
  board: RoomBoard,
  scope: RoomBoardScope,
  author: GuestId | null,
  change: RoomBoardChange,
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
      return Result.map(putNote(scope, author, existing, change), (note) => {
        if (existing === undefined) return { ...board, notes: [...board.notes, note] };
        // A note stays its author's whoever edits it.
        return sameNote(existing, note)
          ? board
          : { ...board, notes: board.notes.map((other) => (other === existing ? note : other)) };
      });
    }
    case "note.remove": {
      if (!board.notes.some((note) => note.id === change.noteId)) return Result.succeed(board);
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
      if (!isOnBoard(scope, board, change.from) || !isOnBoard(scope, board, change.to)) {
        return Result.fail("An arrow joins cards that are on the board.");
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
    case "artifact.restore": {
      const note = board.notes.find((candidate) => candidate.id === change.noteId);
      const current = note?.kind === "artifact" ? note.artifact : undefined;
      if (note === undefined || current?.previous === undefined) return Result.succeed(board);
      const { previous, ...shown } = current;
      const restored: RoomBoardNote = { ...note, artifact: { ...previous, previous: shown } };
      return Result.succeed({
        ...board,
        notes: board.notes.map((other) => (other === note ? restored : other)),
      });
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

/** Text as a thread box or an artifact shows it: one paragraph of plain text, cut to `max`. */
export function roomBoxExcerpt(text: string, max: number): string {
  const plain = text
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/```\w*|`|\*\*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length <= max
    ? plain
    : `${plain.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
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
