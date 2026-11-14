import {
  ROOM_BOARD_SUMMARY_MAX_PEOPLE,
  ROOM_BOARD_SUMMARY_MAX_SHAPES,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoard,
  type RoomBoardNote,
  type RoomBoardSize,
  type RoomBoardSummary,
  type RoomBoardSummaryShape,
  type ThreadId,
} from "@t3tools/contracts";

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

// The sizes the board draws a card at until someone resizes it; a thumbnail needs only a guess.
const CARD: RoomBoardSize = { w: 320, h: 240 };
const ROOM_THREAD_CARD: RoomBoardSize = { w: 320, h: 420 };
const NOTE: RoomBoardSize = { w: 192, h: 144 };
const PIN: RoomBoardSize = { w: 32, h: 32 };
const NOTE_SIZES: Partial<Record<NonNullable<RoomBoardNote["kind"]>, RoomBoardSize>> = {
  artifact: { w: 380, h: 400 },
  thread: { w: 340, h: 460 },
  code: { w: 560, h: 420 },
  comment: PIN,
};
// Where the board puts its own thread's card before anyone moves it.
const ROOM_THREAD_ORIGIN = { x: 80, y: 72 };

function noteShape(note: RoomBoardNote): RoomBoardSummaryShape {
  const size = note.size ?? (note.kind === undefined ? NOTE : (NOTE_SIZES[note.kind] ?? NOTE));
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
  options: { readonly nowIso: string; readonly online: number },
): RoomBoardSummary | null {
  const share = thread.guestShare ?? null;
  const board = share?.board ?? thread.roomBoard?.board ?? null;
  if (share === null && thread.roomBoard == null) return null;
  const notes = (board?.notes ?? []).filter((note) => note.pinnedTo === undefined);
  const positions = board?.positions ?? {};
  const cardShapes: Array<RoomBoardSummaryShape> = Object.entries(positions).map(([id, at]) => {
    const size = board?.sizes?.[id] ?? (id === ROOM_BOARD_THREAD_CARD ? ROOM_THREAD_CARD : CARD);
    return {
      x: at.x,
      y: at.y,
      w: size.w,
      h: size.h,
      kind: id === ROOM_BOARD_THREAD_CARD ? "thread" : "card",
    };
  });
  if (positions[ROOM_BOARD_THREAD_CARD] === undefined) {
    const size = board?.sizes?.[ROOM_BOARD_THREAD_CARD] ?? ROOM_THREAD_CARD;
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
  };
}
