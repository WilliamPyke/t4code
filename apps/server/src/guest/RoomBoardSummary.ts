import {
  ROOM_BOARD_SUMMARY_MAX_PEOPLE,
  ROOM_BOARD_SUMMARY_MAX_SHAPES,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoard,
  type RoomBoardNote,
  type RoomBoardSummary,
  type RoomBoardSummaryShape,
  type ThreadId,
} from "@t3tools/contracts";
import { boardOutline } from "@t3tools/shared/boardOutline";
import {
  ROOM_BOARD_CARD_SIZE,
  ROOM_THREAD_CARD_SIZE,
  ROOM_THREAD_ORIGIN,
  roomBoardNoteSize,
  roomThreadCardSize,
} from "@t3tools/shared/roomBoardAgent";

/** The part of a thread its board's summary reads. */
export interface SummarizedThread {
  readonly id: ThreadId;
  readonly guestShare?:
    | {
        readonly board?: RoomBoard | undefined;
        readonly guests?: ReadonlyArray<{ readonly name: string }> | undefined;
        readonly expiresAt: string;
      }
    | null
    | undefined;
  readonly roomBoard?: { readonly board?: RoomBoard | undefined } | null | undefined;
}

function noteShape(note: RoomBoardNote): RoomBoardSummaryShape {
  const size = roomBoardNoteSize(note);
  return {
    x: note.x,
    y: note.y,
    w: size.w,
    h: size.h,
    kind: note.section === true ? "section" : (note.kind ?? "note"),
    ...(note.color === undefined ? {} : { color: note.color }),
  };
}

/**
 * What a board list shows of a thread's board, or null when the thread has none. Sections come
 * first so a thumbnail draws them behind the cards.
 */
export function summarizeRoomBoard(
  thread: SummarizedThread,
  options: {
    readonly nowIso: string;
    readonly online: number;
    /** The thread's title, when the summary should also name what is on the board. */
    readonly outlineAs?: string | undefined;
  },
): RoomBoardSummary | null {
  const share = thread.guestShare ?? null;
  const board = share?.board ?? thread.roomBoard?.board ?? null;
  if (share === null && thread.roomBoard == null) return null;
  const notes = (board?.notes ?? []).filter((note) => note.pinnedTo === undefined);
  const positions = board?.positions ?? {};
  const cardShapes: Array<RoomBoardSummaryShape> = Object.entries(positions).map(([id, at]) => {
    const size =
      board?.sizes?.[id] ??
      (id === ROOM_BOARD_THREAD_CARD ? ROOM_THREAD_CARD_SIZE : ROOM_BOARD_CARD_SIZE);
    return {
      x: at.x,
      y: at.y,
      w: size.w,
      h: size.h,
      kind: id === ROOM_BOARD_THREAD_CARD ? "thread" : "card",
    };
  });
  if (positions[ROOM_BOARD_THREAD_CARD] === undefined) {
    const size = roomThreadCardSize(board ?? undefined);
    cardShapes.unshift({ ...ROOM_THREAD_ORIGIN, w: size.w, h: size.h, kind: "thread" });
  }
  const noteShapes = notes.map(noteShape);
  const shapes = [
    ...noteShapes.filter((shape) => shape.kind === "section"),
    ...cardShapes,
    ...noteShapes.filter((shape) => shape.kind !== "section"),
  ].slice(0, ROOM_BOARD_SUMMARY_MAX_SHAPES);
  // A team share ends with its link too.
  const live = share !== null && share.expiresAt > options.nowIso;
  return {
    threadId: thread.id,
    cards: notes.filter((note) => note.section !== true && note.kind !== "comment").length,
    agentBoxes: 1 + notes.filter((note) => note.kind === "thread").length,
    shared: live,
    people: live
      ? (share.guests ?? []).slice(0, ROOM_BOARD_SUMMARY_MAX_PEOPLE).map((guest) => guest.name)
      : [],
    online: live ? options.online : 0,
    shapes,
    ...(options.outlineAs === undefined
      ? {}
      : { outline: boardOutline(board ?? undefined, options.outlineAs) }),
  };
}
