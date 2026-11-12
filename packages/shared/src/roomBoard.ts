import {
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  isRoomBoardUrl,
  roomBoardCardRef,
  roomBoardNoteRef,
  type GuestId,
  type RoomBoard,
  type RoomBoardChange,
  type RoomBoardEdge,
  type RoomBoardNote,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

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

/**
 * The board without the places and arrows of cards it no longer has. The same board when every
 * card is still there.
 */
export function roomBoardWithCards(board: RoomBoard, hasCard: (cardId: string) => boolean) {
  const gone = Object.keys(board.positions).filter((cardId) => !hasCard(cardId));
  const strayEdge = (edge: RoomBoardEdge) =>
    [edge.from, edge.to].some(
      (ref) => ref.startsWith(CARD_REF) && !hasCard(ref.slice(CARD_REF.length)),
    );
  if (gone.length === 0 && board.edges?.some(strayEdge) !== true) return board;
  return roomBoardWithEdges(
    {
      ...board,
      positions: Object.fromEntries(
        Object.entries(board.positions).filter(([cardId]) => hasCard(cardId)),
      ),
    },
    (edge) => !strayEdge(edge),
  );
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
    } satisfies RoomBoardNote);
  const { done: _done, assignee: _assignee, ...rest } = base;
  const done = change.done ?? base.done === true;
  const assignee = change.assignee === undefined ? base.assignee : change.assignee;
  return Result.succeed({
    ...rest,
    text: change.text,
    x: change.x,
    y: change.y,
    ...(done ? { done } : {}),
    ...(assignee === undefined || assignee === null ? {} : { assignee }),
  });
}

const sameNote = (left: RoomBoardNote, right: RoomBoardNote) =>
  left.text === right.text &&
  left.x === right.x &&
  left.y === right.y &&
  left.done === right.done &&
  left.assignee?.guestId === right.assignee?.guestId &&
  (left.assignee === undefined) === (right.assignee === undefined);

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
    case "note.put": {
      const existing = board.notes.find((note) => note.id === change.noteId);
      if (existing === undefined && board.notes.length >= ROOM_BOARD_MAX_NOTES) {
        return Result.fail(ROOM_BOARD_FULL);
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
  }
}
