import {
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_MAX_COORDINATE,
  ROOM_BOARD_MIN_CARD_SIZE,
  ROOM_BOARD_QUOTE_MAX_LENGTH,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  isRoomBoardUrl,
  isRoomBranchName,
  roomBoardCardRef,
  roomBoardGuestCard,
  roomBoardNoteRef,
  type RoomAgentActivity,
  type RoomArtifactContent,
  type RoomBoard,
  type RoomBoardChange,
  type RoomBoardEdge,
  type RoomBoardNote,
  type RoomBoardSize,
  type RoomBoardViewport,
  type RoomBoxProgress,
  type RoomCodeState,
  type ThreadGuestMessage,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** Where the board is scrolled to and how far it is zoomed. `x`/`y` are screen pixels. */
export interface BoardView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

export const BOARD_MIN_ZOOM = 0.2;
export const BOARD_MAX_ZOOM = 2;
export const INITIAL_BOARD_VIEW: BoardView = { x: 0, y: 0, zoom: 1 };

export const BOARD_CARD_WIDTH = 320;
const CARD_ROW_HEIGHT = 240;
const CARD_GAP = 40;
const BOARD_ORIGIN: BoardPoint = { x: 80, y: 72 };
/** How many of the thread's newest messages its card shows. */
export const BOARD_THREAD_MESSAGES = 3;

export const EMPTY_ROOM_BOARD: RoomBoard = { positions: {}, notes: [] };

export const screenToBoard = (view: BoardView, point: BoardPoint): BoardPoint => ({
  x: (point.x - view.x) / view.zoom,
  y: (point.y - view.y) / view.zoom,
});

/** Zooms by `factor`, keeping the board point under `anchor` (a screen point) where it is. */
export function zoomBoardAt(view: BoardView, anchor: BoardPoint, factor: number): BoardView {
  const zoom = Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, view.zoom * factor));
  const held = screenToBoard(view, anchor);
  return { zoom, x: anchor.x - held.x * zoom, y: anchor.y - held.y * zoom };
}

export const panBoardBy = (view: BoardView, dx: number, dy: number): BoardView => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
});

/**
 * A position for every card: the saved one, or the next free slot of a grid for a card that has
 * none yet, such as a guest who just joined. A slot under a saved card is skipped.
 */
export function placeBoardCards(
  cardIds: ReadonlyArray<string>,
  saved: RoomBoard["positions"],
  columns = 3,
  sizes: RoomBoard["sizes"] = undefined,
): Record<string, BoardPoint> {
  const stepX = BOARD_CARD_WIDTH + CARD_GAP;
  const stepY = CARD_ROW_HEIGHT + CARD_GAP;
  const slotOf = (point: BoardPoint) =>
    `${Math.round((point.x - BOARD_ORIGIN.x) / stepX)}:${Math.round((point.y - BOARD_ORIGIN.y) / stepY)}`;
  // A card someone made bigger also takes the slots it now reaches into.
  const slotsUnder = (at: BoardPoint, size: RoomBoardSize) => {
    const slots: Array<string> = [];
    const firstColumn = Math.floor((at.x - BOARD_ORIGIN.x - BOARD_CARD_WIDTH) / stepX) + 1;
    const firstRow = Math.floor((at.y - BOARD_ORIGIN.y - CARD_ROW_HEIGHT) / stepY) + 1;
    for (let column = firstColumn; BOARD_ORIGIN.x + column * stepX < at.x + size.w; column += 1) {
      for (let row = firstRow; BOARD_ORIGIN.y + row * stepY < at.y + size.h; row += 1) {
        slots.push(`${column}:${row}`);
      }
    }
    return slots;
  };
  const taken = new Set(
    cardIds.flatMap((id) => {
      const position = saved[id];
      if (position === undefined) return [];
      const size = sizes?.[id];
      return size === undefined
        ? [slotOf(position)]
        : [slotOf(position), ...slotsUnder(position, size)];
    }),
  );
  const placed: Record<string, BoardPoint> = {};
  let slot = 0;
  for (const id of cardIds) {
    const position = saved[id];
    if (position !== undefined) {
      placed[id] = position;
      continue;
    }
    let point: BoardPoint;
    do {
      point = {
        x: BOARD_ORIGIN.x + (slot % columns) * stepX,
        y: BOARD_ORIGIN.y + Math.floor(slot / columns) * stepY,
      };
      slot += 1;
    } while (taken.has(slotOf(point)));
    placed[id] = point;
    const size = sizes?.[id];
    if (size !== undefined) for (const under of slotsUnder(point, size)) taken.add(under);
  }
  return placed;
}

const NOTE_WIDTH = 192;
const NOTE_HEIGHT = 144;
// Guesses for heights the browser decides, used only where nothing on screen can be measured.
const COMMENT_HEIGHT = 200;
const THREAD_CARD_HEIGHT = 420;

/** Something on the board, or the part of it a view shows, in board pixels. */
export interface BoardRect extends BoardPoint {
  readonly width: number;
  readonly height: number;
}

/** How big a new card of this kind is, for finding it a spot. */
export const boardNewNoteSize = (kind: RoomBoardNote["kind"]): RoomBoardSize =>
  boardNoteSize({ kind }) ?? { w: NOTE_WIDTH, h: NOTE_HEIGHT };

const PLACE_GAP = 16;
const PLACE_REACH = 1_200;
const PLACE_STEPS = 60;

/** The spot nearest `around` that covers least of what is `taken`, inside `area` when given. */
function searchBoardSpot(
  size: RoomBoardSize,
  around: BoardPoint,
  taken: ReadonlyArray<BoardRect>,
  area: BoardRect | undefined,
): { readonly at: BoardPoint; readonly cover: number } | null {
  const reach = area === undefined ? PLACE_REACH : Math.max(area.width, area.height);
  const step = Math.max(PLACE_GAP, Math.ceil(reach / PLACE_STEPS));
  const reachSteps = Math.ceil(reach / step);
  const start = { x: around.x - size.w / 2, y: around.y - size.h / 2 };
  const inside = (at: BoardPoint) =>
    area === undefined ||
    (at.x >= area.x + PLACE_GAP &&
      at.y >= area.y + PLACE_GAP &&
      at.x + size.w <= area.x + area.width - PLACE_GAP &&
      at.y + size.h <= area.y + area.height - PLACE_GAP);
  const covered = (at: BoardPoint) => {
    let sum = 0;
    for (const rect of taken) {
      const w =
        Math.min(at.x + size.w, rect.x + rect.width + PLACE_GAP) -
        Math.max(at.x, rect.x - PLACE_GAP);
      const h =
        Math.min(at.y + size.h, rect.y + rect.height + PLACE_GAP) -
        Math.max(at.y, rect.y - PLACE_GAP);
      if (w > 0 && h > 0) sum += w * h;
    }
    return sum;
  };
  const offsets: Array<readonly [number, number]> = [];
  for (let i = -reachSteps; i <= reachSteps; i += 1) {
    for (let j = -reachSteps; j <= reachSteps; j += 1) offsets.push([i, j]);
  }
  offsets.sort(
    ([ai, aj], [bi, bj]) => ai * ai + aj * aj - (bi * bi + bj * bj) || aj - bj || ai - bi,
  );
  let best: { at: BoardPoint; cover: number } | null = null;
  for (const [i, j] of offsets) {
    const at = { x: Math.round(start.x + i * step), y: Math.round(start.y + j * step) };
    if (!inside(at)) continue;
    const cover = covered(at);
    if (cover === 0) return { at, cover };
    if (best === null || cover < best.cover) best = { at, cover };
  }
  return best;
}

/**
 * Where a new item of `size` goes: centred on `around` when that is clear, else the nearest spot
 * that is clear of everything `taken` by a small gap, fully inside `within` when that has such a
 * spot, else outside it. With no clear spot anywhere near, the one that covers the least.
 */
export function placeBoardItem(
  size: RoomBoardSize,
  around: BoardPoint,
  taken: ReadonlyArray<BoardRect>,
  within?: BoardRect,
): BoardPoint {
  const area =
    within !== undefined &&
    within.width >= size.w + PLACE_GAP * 2 &&
    within.height >= size.h + PLACE_GAP * 2
      ? within
      : undefined;
  const inView = area === undefined ? null : searchBoardSpot(size, around, taken, area);
  if (inView !== null && inView.cover === 0) return inView.at;
  const anywhere = searchBoardSpot(size, around, taken, undefined);
  const best =
    anywhere !== null && (inView === null || anywhere.cover < inView.cover) ? anywhere : inView;
  return best?.at ?? { x: Math.round(around.x - size.w / 2), y: Math.round(around.y - size.h / 2) };
}

/**
 * The board's surface as it is on screen: where it starts in the window and how big it is. It is
 * the area beside any conversation, so it is the only area cards are seen, placed and dropped in.
 * A view's `x`/`y` are measured from its top-left corner.
 */
export interface BoardArea extends BoardSize {
  readonly left: number;
  readonly top: number;
}

/** Where a point in the window is on the board. */
export const clientToBoard = (view: BoardView, area: BoardArea, client: BoardPoint): BoardPoint =>
  screenToBoard(view, { x: client.x - area.left, y: client.y - area.top });

/** The part of the board the surface shows, in board pixels. */
export const visibleBoardRect = (view: BoardView, area: BoardSize): BoardRect => ({
  ...screenToBoard(view, { x: 0, y: 0 }),
  width: area.width / view.zoom,
  height: area.height / view.zoom,
});

/** A rect in the window, such as a button inside a card, in board pixels. */
export const clientRectToBoard = (
  view: BoardView,
  area: BoardArea,
  client: BoardRect,
): BoardRect => ({
  ...clientToBoard(view, area, client),
  width: client.width / view.zoom,
  height: client.height / view.zoom,
});

/**
 * The view moved as little as it takes to show `rect` whole, or as it is when it already does.
 * A rect too big to show whole needs only its top-left in the first half of the surface.
 */
export function panToShow(
  view: BoardView,
  rect: BoardRect,
  area: BoardSize,
  margin = 24,
): BoardView {
  const shift = (start: number, length: number, room: number) => {
    if (length > room - margin * 2) {
      if (start < margin) return margin - start;
      return start > room / 2 ? room / 2 - start : 0;
    }
    if (start < margin) return margin - start;
    return start + length > room - margin ? room - margin - (start + length) : 0;
  };
  const dx = shift(view.x + rect.x * view.zoom, rect.width * view.zoom, area.width);
  const dy = shift(view.y + rect.y * view.zoom, rect.height * view.zoom, area.height);
  return dx === 0 && dy === 0 ? view : { ...view, x: view.x + dx, y: view.y + dy };
}

/**
 * The view after a card is added at `rect`: as it is when the whole card shows, even nearer the
 * edge than `panToShow` keeps a card it reveals, else moved as little as it takes to show it whole.
 * Placement looks for a spot in view first, so this moves only for a card that found none.
 */
export function panToShowAdded(view: BoardView, rect: BoardRect, area: BoardSize): BoardView {
  const shows = (start: number, length: number, room: number) =>
    start >= 0 && start + length <= room;
  return shows(view.x + rect.x * view.zoom, rect.width * view.zoom, area.width) &&
    shows(view.y + rect.y * view.zoom, rect.height * view.zoom, area.height)
    ? view
    : panToShow(view, rect, area);
}

/**
 * The view that shows every rect in the surface, centred, at no more than full size. Cards too
 * spread out to fit even at the smallest zoom show from their top-left.
 */
export function fitBoardView(
  rects: ReadonlyArray<BoardRect>,
  area: BoardSize,
  margin = 40,
): BoardView {
  const bounds = boardBounds(rects);
  if (bounds === null) return INITIAL_BOARD_VIEW;
  const room = { width: area.width - margin * 2, height: area.height - margin * 2 };
  const zoom = Math.min(
    1,
    Math.max(BOARD_MIN_ZOOM, Math.min(room.width / bounds.width, room.height / bounds.height)),
  );
  const place = (start: number, length: number, space: number) =>
    length * zoom > space
      ? Math.round(margin - start * zoom)
      : Math.round(margin + (space - length * zoom) / 2 - start * zoom);
  return {
    zoom,
    x: place(bounds.x, bounds.width, room.width),
    y: place(bounds.y, bounds.height, room.height),
  };
}

/** How wide the line between the board and the conversation is. */
export const BOARD_SPLIT_DIVIDER = 6;

/**
 * How wide the conversation beside the board may be in a row this wide: the board keeps at least
 * half the row, and 480px where the row allows that and the panel's own 320px. The divider comes
 * out of the conversation's side.
 */
export const boardPanelMaxWidth = (row: number): number =>
  Math.max(
    0,
    row - Math.max(row / 2, Math.min(480, row - 320 - BOARD_SPLIT_DIVIDER)) - BOARD_SPLIT_DIVIDER,
  );

/** The smallest rect that holds all of these, or null for none. */
export function boardBounds(rects: ReadonlyArray<BoardRect>): BoardRect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

/**
 * Where a new item goes beside `rect`: to its right and level with its top, or the nearest clear
 * spot, inside `within` when that has one.
 */
export const besideBoardItem = (
  rect: BoardRect,
  size: RoomBoardSize,
  taken: ReadonlyArray<BoardRect>,
  within?: BoardRect,
): BoardPoint =>
  placeBoardItem(
    size,
    { x: rect.x + rect.width + CARD_GAP + size.w / 2, y: rect.y + size.h / 2 },
    taken,
    within,
  );

/**
 * What is on a board and where, at the sizes it was given or, for heights the browser decides,
 * a guess. For when nothing on screen can be measured.
 */
export function boardItemRects(
  board: RoomBoard,
  cardIds: ReadonlyArray<string>,
): ReadonlyArray<BoardRect> {
  const placed = {
    ...board.positions,
    ...placeBoardCards(cardIds, board.positions, undefined, board.sizes),
  };
  const cards = Object.entries(placed).map(([id, at]) => ({
    x: at.x,
    y: at.y,
    width: board.sizes?.[id]?.w ?? BOARD_CARD_WIDTH,
    height:
      board.sizes?.[id]?.h ??
      (id === ROOM_BOARD_THREAD_CARD ? THREAD_CARD_HEIGHT : CARD_ROW_HEIGHT),
  }));
  const notes = board.notes.map((note) => {
    const size = boardNoteSize(note);
    return {
      x: note.x,
      y: note.y,
      width: size?.w ?? NOTE_WIDTH,
      height: size?.h ?? (note.pinnedTo === undefined ? NOTE_HEIGHT : COMMENT_HEIGHT),
    };
  });
  return [...cards, ...notes];
}

/**
 * Where a comment pinned to a reply lands on the board: beside the thread's card, or the nearest
 * spot to that clear of the cards and notes there, including each guest's card.
 */
export function pinnedCommentSpot(
  board: RoomBoard,
  guestIds: ReadonlyArray<string> = [],
): BoardPoint {
  const cardIds = [ROOM_BOARD_THREAD_CARD, ...guestIds.map(roomBoardGuestCard)];
  const thread = placeBoardCards(cardIds, board.positions, undefined, board.sizes)[
    ROOM_BOARD_THREAD_CARD
  ]!;
  const width = board.sizes?.[ROOM_BOARD_THREAD_CARD]?.w ?? BOARD_CARD_WIDTH;
  const size = { w: NOTE_WIDTH, h: COMMENT_HEIGHT };
  return placeBoardItem(
    size,
    { x: thread.x + width + CARD_GAP + size.w / 2, y: thread.y + size.h / 2 },
    boardItemRects(board, cardIds),
  );
}

/** Where a card or note is, how wide it is, and how far down the middle of its header is. */
export interface BoardBox extends BoardPoint {
  readonly width: number;
  readonly headerY: number;
}

/** How big an artifact card is until someone resizes it. */
const BOARD_ARTIFACT_SIZE: RoomBoardSize = { w: 380, h: 400 };
/** How big a thread box is until someone resizes it, with room for its prompt box. */
const BOARD_THREAD_BOX_SIZE: RoomBoardSize = { w: 340, h: 460 };

const boardLength = (value: number) =>
  Math.round(Math.min(ROOM_BOARD_MAX_CARD_SIZE, Math.max(ROOM_BOARD_MIN_CARD_SIZE, value)));

/** A size dragged to, at the whole pixels and within the bounds the room takes. */
export const clampBoardSize = (size: RoomBoardSize): RoomBoardSize => ({
  w: boardLength(size.w),
  h: boardLength(size.h),
});

/**
 * A card resized by its bottom-left corner, `dx`/`dy` board pixels from where it was taken: the
 * left edge follows the pointer and the right edge stays, within the bounds the room takes.
 */
export function resizeBoardFromLeft(
  from: BoardRect,
  dx: number,
  dy: number,
): { readonly x: number; readonly y: number; readonly size: RoomBoardSize } {
  const size = clampBoardSize({ w: from.width - dx, h: from.height + dy });
  return { x: from.x + from.width - size.w, y: from.y, size };
}

/** The size a note shows at, or undefined for one that grows with its text. */
export const boardNoteSize = (
  note: Pick<RoomBoardNote, "kind" | "size">,
): RoomBoardSize | undefined =>
  note.size ??
  (note.kind === "artifact"
    ? BOARD_ARTIFACT_SIZE
    : note.kind === "thread"
      ? BOARD_THREAD_BOX_SIZE
      : undefined);

export const boardCardBox = (at: BoardPoint, size?: RoomBoardSize): BoardBox => ({
  x: at.x,
  y: at.y,
  width: size?.w ?? BOARD_CARD_WIDTH,
  headerY: 18,
});
/** A comment thread's pin, in board pixels before `boardPinScale`. */
export const BOARD_PIN_SIZE = 32;
const PIN_MIN_ON_SCREEN = 24;
const PIN_MAX_ON_SCREEN = 40;

/** How much a pin is scaled so it stays 24 to 40 screen pixels across at any zoom. */
export const boardPinScale = (zoom: number): number =>
  Math.min(PIN_MAX_ON_SCREEN, Math.max(PIN_MIN_ON_SCREEN, BOARD_PIN_SIZE * zoom)) /
  (BOARD_PIN_SIZE * zoom);

/** Where a line meets a card or note. A comment pin's depends on the zoom it is drawn at. */
export function boardNoteBox(
  note: BoardPoint & Partial<Pick<RoomBoardNote, "kind" | "size">>,
  zoom = 1,
): BoardBox {
  if (note.kind === "comment") {
    const size = BOARD_PIN_SIZE * boardPinScale(zoom);
    return { x: note.x, y: note.y, width: size, headerY: size / 2 };
  }
  return { x: note.x, y: note.y, width: boardNoteSize(note)?.w ?? NOTE_WIDTH, headerY: 12 };
}

const BOARD_COMMENT_PANEL_WIDTH = 288;
const PANEL_GAP = 8;

/**
 * Where an open comment thread sits on the board's surface, in screen pixels from its top-left:
 * beside its pin, on whichever side has room, growing down from a pin in the top half and up from
 * one in the bottom half, and never past the surface's edges.
 */
export function boardCommentPanelSpot(
  pin: BoardRect,
  area: BoardSize,
): {
  readonly left: number;
  readonly top?: number;
  readonly bottom?: number;
  readonly maxHeight: number;
} {
  const width = BOARD_COMMENT_PANEL_WIDTH;
  const right = pin.x + pin.width + PANEL_GAP;
  const left =
    right + width + PANEL_GAP <= area.width
      ? right
      : pin.x - PANEL_GAP - width >= PANEL_GAP
        ? pin.x - PANEL_GAP - width
        : Math.max(PANEL_GAP, Math.min(right, area.width - PANEL_GAP - width));
  if (pin.y + pin.height / 2 <= area.height / 2) {
    const top = Math.max(PANEL_GAP, pin.y);
    return { left, top, maxHeight: area.height - top - PANEL_GAP };
  }
  const bottom = Math.max(PANEL_GAP, area.height - pin.y - pin.height);
  return { left, bottom, maxHeight: area.height - bottom - PANEL_GAP };
}

type BoardSide = "left" | "right";
const sideX = (box: BoardBox, side: BoardSide) => box.x + (side === "right" ? box.width : 0);
// The facing sides first, so a tie between two pairs keeps the line between the cards.
const SIDE_PAIRS: ReadonlyArray<readonly [BoardSide, BoardSide]> = [
  ["right", "left"],
  ["left", "right"],
  ["right", "right"],
  ["left", "left"],
];

/**
 * A curve from the header of one box to the header of another, leaving and arriving level from
 * the sides of each that are nearest the other, and the point halfway along it.
 */
export function boardConnector(
  from: BoardBox,
  to: BoardBox,
): { readonly path: string; readonly middle: BoardPoint } {
  const toRight = from.x + from.width / 2 <= to.x + to.width / 2;
  const pairs = toRight ? SIDE_PAIRS : SIDE_PAIRS.map(([a, b]) => [b, a] as const);
  let best = pairs[0]!;
  for (const pair of pairs) {
    const gap = Math.abs(sideX(to, pair[1]) - sideX(from, pair[0]));
    if (gap < Math.abs(sideX(to, best[1]) - sideX(from, best[0]))) best = pair;
  }
  const [fromSide, toSide] = best;
  const start = { x: sideX(from, fromSide), y: from.y + from.headerY };
  const end = { x: sideX(to, toSide), y: to.y + to.headerY };
  // Each end leaves its card outward, away from the side it sits on.
  const bend = Math.max(40, Math.abs(end.x - start.x) / 2);
  const c1 = start.x + (fromSide === "right" ? bend : -bend);
  const c2 = end.x + (toSide === "right" ? bend : -bend);
  return {
    path: `M${start.x} ${start.y} C${c1} ${start.y}, ${c2} ${end.y}, ${end.x} ${end.y}`,
    middle: { x: (start.x + 3 * c1 + 3 * c2 + end.x) / 8, y: (start.y + end.y) / 2 },
  };
}

/** A card, a note or an arrow on the board, or how big a card is (`size`, by card id). */
export interface BoardTarget {
  readonly kind: "card" | "note" | "edge" | "size";
  readonly id: string;
}

/**
 * Where a card is, a note as it reads, an arrow, a card's size, or null for a note or arrow taken
 * off.
 */
export type BoardValue = BoardPoint | RoomBoardNote | RoomBoardEdge | RoomBoardSize | null;

/**
 * What this person did to one card, note or arrow, shown over the room's board so a drag does
 * not wait for the server.
 */
export interface BoardEdit {
  readonly target: BoardTarget;
  readonly value: BoardValue;
  /** Still being dragged or typed: it shows whatever the room's copy does. */
  readonly held: boolean;
  /** The room's copy when it was let go. The edit shows until the room's copy differs. */
  readonly base: BoardValue | undefined;
}
export type BoardEdits = Readonly<Record<string, BoardEdit>>;
export const NO_BOARD_EDITS: BoardEdits = {};

/** A card's or note's key, which is also how an arrow names its ends. */
export const boardEditKey = (target: BoardTarget) => `${target.kind}:${target.id}`;

const roomCopy = (board: RoomBoard, target: BoardTarget): BoardValue | undefined => {
  switch (target.kind) {
    case "card":
      return board.positions[target.id];
    case "size":
      return board.sizes?.[target.id];
    case "note":
      return board.notes.find((note) => note.id === target.id);
    case "edge":
      return board.edges?.find((edge) => edge.id === target.id);
  }
};

/** What the room's copy and an edit are compared on, in whatever order the server wrote it. */
const valueKey = (value: BoardValue | undefined): string => {
  if (value === undefined || value === null) return String(value);
  if ("from" in value) return `${value.from}>${value.to}`;
  if ("w" in value) return `${value.w}x${value.h}`;
  if (!("text" in value)) return `${value.x},${value.y}`;
  return JSON.stringify([
    value.x,
    value.y,
    value.text,
    value.done === true,
    value.assignee === undefined ? null : (value.assignee.guestId ?? ""),
    value.size === undefined ? null : `${value.size.w}x${value.size.h}`,
  ]);
};

const shows = (board: RoomBoard, edit: BoardEdit) =>
  edit.held || valueKey(edit.base) === valueKey(roomCopy(board, edit.target));

/**
 * Records an edit, and forgets the ones the room's copy has moved past. Held while the drag or
 * the typing goes on; let go, it stands in for the room's copy until the server answers.
 */
export function putBoardEdit(
  board: RoomBoard,
  edits: BoardEdits,
  target: BoardTarget,
  value: BoardValue,
  held: boolean,
): BoardEdits {
  const kept = Object.entries(edits).filter(([, edit]) => shows(board, edit));
  return {
    ...Object.fromEntries(kept),
    [boardEditKey(target)]: {
      target,
      value,
      held,
      base: held ? undefined : roomCopy(board, target),
    },
  };
}

/**
 * Sends one card's, note's or arrow's changes one after another, so the room takes them in the
 * order they were made: text typed into a new note cannot land before the empty note it fills.
 */
export function boardChangeQueue() {
  const last = new Map<string, Promise<unknown>>();
  return <A>(key: string, send: () => Promise<A>): Promise<A> => {
    const next = (last.get(key) ?? Promise.resolve()).then(send, send);
    last.set(key, next);
    const forget = () => {
      if (last.get(key) === next) last.delete(key);
    };
    next.then(forget, forget);
    return next;
  };
}

/** Takes back an edit the server refused, unless a newer one replaced it. */
export function dropBoardEdit(
  edits: BoardEdits,
  target: BoardTarget,
  value: BoardValue,
): BoardEdits {
  const key = boardEditKey(target);
  if (edits[key]?.value !== value) return edits;
  const { [key]: _dropped, ...rest } = edits;
  return rest;
}

const replaceById = <Item extends { readonly id: string }>(
  items: ReadonlyArray<Item>,
  item: Item,
): ReadonlyArray<Item> =>
  items.some((other) => other.id === item.id)
    ? items.map((other) => (other.id === item.id ? item : other))
    : [...items, item];

const CARD_REF = roomBoardCardRef("");

/**
 * A note as this person edits it, with what only the owner's server writes, and what changes of
 * their own set, taken from the room.
 */
const withServerFields = (note: RoomBoardNote, room: RoomBoardNote | undefined): RoomBoardNote => {
  const {
    answer: _answer,
    artifact: _artifact,
    thread: _thread,
    createdAt: _createdAt,
    replies: _replies,
    resolved: _resolved,
    ...own
  } = note;
  return {
    ...own,
    ...(room?.answer === undefined ? {} : { answer: room.answer }),
    ...(room?.artifact === undefined ? {} : { artifact: room.artifact }),
    ...(room?.thread === undefined ? {} : { thread: room.thread }),
    ...(room?.createdAt === undefined ? {} : { createdAt: room.createdAt }),
    ...(room?.replies === undefined ? {} : { replies: room.replies }),
    ...(room?.resolved === undefined ? {} : { resolved: room.resolved }),
  };
};

/** The room's board with this person's own edits over it. A note taken off takes its arrows. */
export function resolveBoard(board: RoomBoard, edits: BoardEdits): RoomBoard {
  const positions = { ...board.positions };
  const sizes = { ...board.sizes };
  let notes = board.notes;
  let edges = board.edges ?? [];
  for (const edit of Object.values(edits)) {
    if (!shows(board, edit)) continue;
    const { target, value } = edit;
    if (target.kind === "card") {
      if (value !== null && "x" in value) positions[target.id] = { x: value.x, y: value.y };
    } else if (target.kind === "size") {
      if (value !== null && "w" in value) sizes[target.id] = { w: value.w, h: value.h };
    } else if (target.kind === "edge") {
      if (value === null) edges = edges.filter((edge) => edge.id !== target.id);
      else if ("from" in value) edges = replaceById(edges, value);
    } else if (value === null) {
      notes = notes.filter((note) => note.id !== target.id);
    } else if ("text" in value) {
      const room = board.notes.find((note) => note.id === target.id);
      notes = replaceById(notes, withServerFields(value, room));
    }
  }
  const noteRefs = new Set(notes.map((note) => boardEditKey({ kind: "note", id: note.id })));
  const present = (ref: string) => ref.startsWith(CARD_REF) || noteRefs.has(ref);
  return {
    positions,
    notes,
    edges: edges.filter((edge) => present(edge.from) && present(edge.to)),
    sizes,
  };
}

const coordinate = (value: number) =>
  Math.round(Math.min(ROOM_BOARD_MAX_COORDINATE, Math.max(-ROOM_BOARD_MAX_COORDINATE, value)));

/** The value at the whole pixels the room keeps, so the server's copy equals what was let go. */
export const settleBoardValue = <Value extends BoardValue>(value: Value): Value => {
  if (value === null) return value;
  if ("w" in value) return { ...value, ...clampBoardSize(value) };
  if (!("x" in value)) return value;
  const at = { ...value, x: coordinate(value.x), y: coordinate(value.y) };
  return "size" in at && at.size !== undefined ? { ...at, size: clampBoardSize(at.size) } : at;
};

/** The change that makes the room's copy of a card, note or arrow this value. */
export function boardChangeOf(target: BoardTarget, value: BoardValue): RoomBoardChange {
  if (target.kind === "card") {
    const at = value !== null && "x" in value ? value : { x: 0, y: 0 };
    return { type: "card.move", cardId: target.id, x: at.x, y: at.y };
  }
  if (target.kind === "size") {
    const size = clampBoardSize(value !== null && "w" in value ? value : BOARD_ARTIFACT_SIZE);
    return { type: "card.resize", cardId: target.id, ...size };
  }
  if (target.kind === "edge") {
    return value === null || !("from" in value)
      ? { type: "edge.remove", edgeId: target.id }
      : { type: "edge.put", edgeId: target.id, from: value.from, to: value.to };
  }
  if (value === null || !("text" in value)) return { type: "note.remove", noteId: target.id };
  return {
    type: "note.put",
    noteId: target.id,
    text: value.text,
    x: value.x,
    y: value.y,
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    ...(value.url === undefined ? {} : { url: value.url }),
    ...(value.pinnedTo === undefined ? {} : { pinnedTo: value.pinnedTo }),
    ...(value.quote === undefined ? {} : { quote: value.quote }),
    ...(value.size === undefined ? {} : { size: value.size }),
    ...(value.kind === "task"
      ? { done: value.done === true, assignee: value.assignee ?? null }
      : {}),
  };
}

/** Where a pointer at `screen` is on the board, at the whole pixels the room takes. */
export const boardCursorAt = (view: BoardView, screen: BoardPoint): BoardPoint =>
  settleBoardValue(screenToBoard(view, screen));

const CURSOR_SEND_INTERVAL_MS = 80;

/**
 * What the room hears of this person on the board: their pointer, or null once it left, and their
 * view when it changed, or null once they closed the board.
 */
export interface BoardPresence {
  readonly at: BoardPoint | null;
  readonly view?: RoomBoardViewport | null;
}

const samePoint = (a: BoardPoint | null, b: BoardPoint | null) =>
  a === null || b === null ? a === b : a.x === b.x && a.y === b.y;
const sameViewport = (a: RoomBoardViewport | null, b: RoomBoardViewport | null) =>
  a === null || b === null ? a === b : samePoint(a, b) && a.zoom === b.zoom;

/**
 * Sends a pointer's position and the board's view at most every `CURSOR_SEND_INTERVAL_MS`,
 * always ending on the latest, and nothing already sent. A pointer leaving is sent at once, and
 * closing the board takes both away.
 */
export function cursorSender(send: (presence: BoardPresence) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let at: BoardPoint | null = null;
  let view: RoomBoardViewport | null = null;
  let sentAt: BoardPoint | null = null;
  let sentView: RoomBoardViewport | null = null;
  let lastSend = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const viewChanged = !sameViewport(view, sentView);
    if (samePoint(at, sentAt) && !viewChanged) return;
    sentAt = at;
    sentView = view;
    lastSend = Date.now();
    send(viewChanged ? { at, view } : { at });
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(flush, Math.max(0, lastSend + CURSOR_SEND_INTERVAL_MS - Date.now()));
  };
  return {
    move: (point: BoardPoint) => {
      at = point;
      schedule();
    },
    look: (next: RoomBoardViewport) => {
      view = next;
      schedule();
    },
    leave: () => {
      at = null;
      flush();
    },
    close: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      at = null;
      view = null;
      if (sentAt === null && sentView === null) return;
      sentAt = null;
      sentView = null;
      send({ at: null, view: null });
    },
  };
}

export interface BoardSize {
  readonly width: number;
  readonly height: number;
}

/** What this board shows, as the room hears it: the board point in its middle, and its zoom. */
export function boardViewportOf(view: BoardView, size: BoardSize): RoomBoardViewport {
  const middle = screenToBoard(view, { x: size.width / 2, y: size.height / 2 });
  return {
    x: coordinate(middle.x),
    y: coordinate(middle.y),
    zoom: Math.round(view.zoom * 1000) / 1000,
  };
}

/** The view that shows what someone else's board shows, on a board of this size. */
export function followBoardView(viewport: RoomBoardViewport, size: BoardSize): BoardView {
  const zoom = Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, viewport.zoom));
  return { zoom, x: size.width / 2 - viewport.x * zoom, y: size.height / 2 - viewport.y * zoom };
}

// Semantic colours that read on the board in both themes; guests take them in join order.
const GUEST_CURSOR_COLORS = [
  "var(--color-guest)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-update)",
  "var(--color-destructive)",
];

/** One colour per person for as long as the link lasts: the owner's, or the guest's by join order. */
export function boardCursorColor(
  guests: ReadonlyArray<{ readonly id: string }>,
  guestId: string | undefined,
): string {
  if (guestId === undefined) return "var(--color-primary)";
  const index = Math.max(
    0,
    guests.findIndex((guest) => guest.id === guestId),
  );
  return GUEST_CURSOR_COLORS[index % GUEST_CURSOR_COLORS.length]!;
}

/** Who someone is on the board, as follow mode names them: a guest's id, or the owner. */
export const boardPersonKey = (guestId: string | undefined) => guestId ?? "owner";

export interface BoardPeople {
  readonly guests: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** The guest looking, or null for the owner. */
  readonly viewer: string | null;
  /** What the owner is called, when they chose a name to show. */
  readonly ownerName?: string | undefined;
}

/** What the board calls someone: "You", the owner's name or "Owner", or a guest's name. */
export function boardPersonName(people: BoardPeople, guestId: string | undefined): string {
  if ((guestId ?? null) === people.viewer) return "You";
  if (guestId === undefined) return people.ownerName ?? "Owner";
  return people.guests.find((guest) => guest.id === guestId)?.name ?? "Guest";
}

/** Whose agent someone's is, as a sentence names it: "Sam's agent", or "your agent". */
export function boardAgentName(people: BoardPeople, guestId: string | undefined): string {
  const name = boardPersonName(people, guestId);
  return (guestId ?? null) === people.viewer ? "your agent" : `${name}'s agent`;
}

/**
 * The guests whose agent has a card: once it posted a turn or runs one now, with its turns and
 * what it runs.
 */
export function boardAgents<
  Guest extends { readonly id: string },
  Turn extends { readonly guestId: string },
>(
  guests: ReadonlyArray<Guest>,
  turns: ReadonlyArray<Turn>,
  running: ReadonlyArray<RoomAgentActivity>,
) {
  return guests.flatMap((guest) => {
    const own = turns.filter((turn) => turn.guestId === guest.id);
    const now = running.find((agent) => agent.guestId === guest.id);
    return own.length === 0 && now === undefined ? [] : [{ guest, turns: own, running: now }];
  });
}

/** Where an agent's code is: what it says while it runs, or what its last turn said. */
export const boardAgentCode = (agent: {
  readonly turns: ReadonlyArray<{ readonly code?: RoomCodeState | undefined }>;
  readonly running: RoomAgentActivity | undefined;
}): RoomCodeState | undefined => agent.running?.code ?? agent.turns.at(-1)?.code;

/** How a card says where someone's code is: "pushed", "2 commits not pushed", and so on. */
export function roomCodeStatus(code: RoomCodeState): string {
  const state = code.synced
    ? "pushed"
    : code.ahead === undefined
      ? "not pushed"
      : code.ahead > 0
        ? `${code.ahead} commit${code.ahead === 1 ? "" : "s"} not pushed`
        : "changes not committed";
  const behind = code.behind ?? 0;
  return behind > 0 ? `${state}, ${behind} behind` : state;
}

/**
 * The command that gets someone's pushed branch, or null for a name git would not take. A name
 * with anything but plain characters is quoted for the shell.
 */
export function roomFetchCommand(branch: string): string | null {
  if (!isRoomBranchName(branch)) return null;
  const arg = /^[\w./-]+$/.test(branch) ? branch : `'${branch.replaceAll("'", `'\\''`)}'`;
  return `git fetch origin ${arg} && git switch ${arg}`;
}

/** A card a line connects to a thread box, as a prompt from the board carries it. */
export interface BoardPromptCard {
  /** `note:<id>` as arrows name it. */
  readonly ref: string;
  /** As this viewer reads it: "Note from You", "Task from Sam", 'Artifact "Title"'. */
  readonly label: string;
  /** As everyone reads it, for what is sent and kept: "Note from the owner", "Note from Sam". */
  readonly sharedLabel: string;
  readonly text: string;
  /** The start of what the card itself says, for its chip. */
  readonly excerpt: string;
}

/** A message sent from a thread box on the board. */
export interface BoardPrompt {
  readonly text: string;
  /** The connected cards the sender left attached. */
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The artifact note the box has a line to, which the reply rewrites. */
  readonly artifactId: string | null;
}

/** A note added to a composer's draft as a paragraph of its own. */
export function appendNoteToDraft(draft: string, note: string): string {
  const text = note.trim();
  if (text === "") return draft;
  return draft.trim() === "" ? text : `${draft.trimEnd()}\n\n${text}`;
}

/** The text "Use as message" puts in a draft: a link card gives its address with its caption. */
export const boardNoteMessage = (note: RoomBoardNote): string =>
  note.url === undefined ? note.text : [note.text.trim(), note.url].filter(Boolean).join("\n");

/** A link card's address as the card shows it. GitHub pull requests, issues and files read short. */
export interface BoardLink {
  readonly href: string;
  readonly title: string;
  readonly detail: string;
}

const GITHUB_KINDS: Readonly<Record<string, string>> = { pull: "Pull request", issues: "Issue" };

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export function parseBoardLink(value: string): BoardLink | null {
  if (!isRoomBoardUrl(value)) return null;
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname
    .split("/")
    .filter((part) => part !== "")
    .map(decodeSegment);
  const [owner, repo, section, ...rest] = parts;
  if (host === "github.com" && owner !== undefined && repo !== undefined) {
    const name = `${owner}/${repo}`;
    const kind = section === undefined ? undefined : GITHUB_KINDS[section];
    if (kind !== undefined && /^\d+$/.test(rest[0] ?? "")) {
      return { href: url.href, title: `${name} #${rest[0]}`, detail: kind };
    }
    if ((section === "blob" || section === "tree") && rest.length >= 2) {
      return { href: url.href, title: rest.slice(1).join("/"), detail: `${name} · ${rest[0]}` };
    }
    return { href: url.href, title: name, detail: host };
  }
  return {
    href: url.href,
    title: host,
    detail: parts.length === 0 ? url.search : `/${parts.join("/")}`,
  };
}

/** The address in pasted or typed text that is one http or https URL and nothing else. */
export function boardUrlIn(text: string): string | null {
  const trimmed = text.trim();
  return /\s/.test(trimmed) || !isRoomBoardUrl(trimmed) ? null : trimmed;
}

export interface BoardMessage {
  readonly id: string;
  /** Who wrote it: null for the agent, the owner's label, a guest's name otherwise. */
  readonly author: string | null;
  readonly text: string;
}

interface MessageItem {
  readonly id: string;
  readonly type: string;
  readonly text?: unknown;
  readonly context?: unknown;
}

const GuestContext = Schema.Struct({
  guest: Schema.Struct({ name: Schema.String, text: Schema.String }),
});
const decodeGuestContext = Schema.decodeUnknownOption(GuestContext);
const EXCERPT_LENGTH = 280;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** Text cut to `max` characters with the ellipsis, never splitting a surrogate pair. */
const cutText = (text: string, max: number): string =>
  text.length <= max
    ? text
    : `${text
        .slice(0, max - 1)
        .replace(/[\uD800-\uDBFF]$/, "")
        .trimEnd()}…`;

/**
 * A message as a card shows it: one run of plain text, without code blocks, heading and list
 * marks, table rules or emphasis marks. A message that is only a code block keeps its text.
 */
function boardExcerpt(markdown: string, max = EXCERPT_LENGTH): string {
  const lines: Array<string> = [];
  let fenced = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || TABLE_RULE.test(raw)) continue;
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw)?.[1];
    const line = (heading ?? raw)
      .replace(/^\s*(?:>\s?)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`+|\*\*|~~/g, "")
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, "$1$2")
      .replace(/\|/g, " ")
      .trim();
    if (line === "") continue;
    lines.push(heading !== undefined && !/[.:!?]$/.test(line) ? `${line}:` : line);
  }
  const text = (lines.length === 0 ? markdown : lines.join(" ")).replace(/\s+/g, " ").trim();
  return cutText(text, max);
}

/** The start of a reply, as a comment pinned to it quotes it. */
export const boardReplyQuote = (reply: string): string =>
  boardExcerpt(reply, ROOM_BOARD_QUOTE_MAX_LENGTH);

/** What a comment quotes: what its author's client read, or the reply the thread's card shows. */
export const boardNoteQuote = (
  note: RoomBoardNote,
  messages: ReadonlyArray<BoardMessage>,
): string | undefined => {
  if (note.pinnedTo === undefined) return undefined;
  const quote = note.quote ?? messages.find((message) => message.id === note.pinnedTo)?.text;
  return quote === undefined || quote.trim() === "" ? undefined : quote;
};

const textOf = (value: unknown) => (typeof value === "string" ? boardExcerpt(value) : "");

/** The newest messages of a thread, oldest first, for the thread's card. */
export function boardMessages(
  items: ReadonlyArray<MessageItem>,
  limit: number,
  /** What the owner is called: "You" on their own board. */
  owner = "You",
): ReadonlyArray<BoardMessage> {
  const messages: Array<BoardMessage> = [];
  for (const item of items.toReversed()) {
    if (messages.length === limit) break;
    if (item.type === "user_message") {
      const context = decodeGuestContext(item.context);
      const guest = context._tag === "Some" ? context.value.guest : undefined;
      const text = textOf(guest?.text ?? item.text);
      if (text !== "") messages.push({ id: item.id, author: guest?.name ?? owner, text });
    } else if (item.type === "assistant_message") {
      const text = textOf(item.text);
      if (text !== "") messages.push({ id: item.id, author: null, text });
    }
  }
  return messages.toReversed();
}

/** Whether an artifact is a whole HTML page, which the board shows as a page of its own. */
export const isBoardHtmlArtifact = (body: string): boolean =>
  /^(?:<!doctype html|<html)/i.test(body.trimStart());

/** How many connected cards one message from the board carries. */
export const BOARD_PROMPT_MAX_CARDS = 8;
const PROMPT_ARTIFACT_LENGTH = 4_000;

/** What a thread box does with the lines at it: what goes with a prompt, and where the reply goes. */
export interface BoardPromptContext {
  /**
   * Every card with a line into the box or into the artifact it rewrites, and into those,
   * nearest first.
   */
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The lines that carry them. */
  readonly edgeIds: ReadonlySet<string>;
  /** The first artifact the box has a line to, which its replies rewrite, and that line. */
  readonly artifact: RoomBoardNote | null;
  readonly artifactEdgeId: string | null;
}

const isComment = (note: RoomBoardNote) => note.kind === undefined && note.pinnedTo !== undefined;

/** Who someone is as everyone in the room reads it: a guest's name, or the owner's, or "the owner". */
const sharedPersonName = (people: BoardPeople, guestId: string | undefined): string =>
  guestId === undefined
    ? (people.ownerName ?? "the owner")
    : (people.guests.find((guest) => guest.id === guestId)?.name ?? "a guest");

const EXCERPT_CHIP_LENGTH = 80;

/**
 * A comment thread as a prompt carries it: each comment on a line of its own after its author's
 * name, as everyone reads it. A thread too long for one card keeps its first comment and its
 * newest replies, and says how many it left out.
 */
function commentThreadText(note: RoomBoardNote, people: BoardPeople): string {
  const said = [{ guestId: note.guestId, text: note.text }, ...(note.replies ?? [])]
    .filter((comment) => comment.text.trim() !== "")
    .map(
      (comment) =>
        `${sentenceStart(sharedPersonName(people, comment.guestId))}: ${comment.text.trim()}`,
    );
  const [first, ...replies] = said;
  if (first === undefined) return "";
  const marker = (left: number) => `(${left} earlier ${left === 1 ? "reply" : "replies"} left out)`;
  const room = PROMPT_ARTIFACT_LENGTH - first.length - marker(replies.length).length - 2;
  const kept: Array<string> = [];
  let used = 0;
  for (const reply of replies.toReversed()) {
    if (used + reply.length + 1 > room) break;
    kept.unshift(reply);
    used += reply.length + 1;
  }
  const left = replies.length - kept.length;
  return [first, ...(left === 0 ? [] : [marker(left)]), ...kept].join("\n");
}

/** A card as a message from the board carries it, or null for one with nothing written. */
function boardPromptCard(
  note: RoomBoardNote,
  people: BoardPeople,
  quote?: string,
): BoardPromptCard | null {
  const text = note.text.trim();
  const comment = isComment(note);
  const labelBy = (by: string) => {
    switch (note.kind) {
      case "artifact":
        return text === "" ? "Artifact" : `Artifact "${text}"`;
      case "task":
        return `Task from ${by}`;
      case "link":
        return `Link from ${by}`;
      case "comment":
        return `Comment thread from ${by}`;
      default:
        return comment ? `Comment from ${by} on a reply` : `Note from ${by}`;
    }
  };
  const body =
    note.kind === "artifact"
      ? [text, cutText(note.artifact?.body.trim() ?? "", PROMPT_ARTIFACT_LENGTH)]
          .filter(Boolean)
          .join("\n\n")
      : note.kind === "task"
        ? text === ""
          ? ""
          : `${text}\nStatus: ${note.done === true ? "done" : "not done"}`
        : note.kind === "link"
          ? [note.url ?? "", text].filter(Boolean).join("\n")
          : note.kind === "comment"
            ? commentThreadText(note, people)
            : comment && text !== "" && quote !== undefined
              ? `On the reply: "${quote}"\n${text}`
              : text;
  if (body.trim() === "") return null;
  const said = (text === "" ? (note.url ?? "") : text).split("\n")[0] ?? "";
  return {
    ref: roomBoardNoteRef(note.id),
    label: labelBy(boardPersonName(people, note.guestId)),
    sharedLabel: labelBy(sharedPersonName(people, note.guestId)),
    text: body,
    // An artifact's label already names it.
    excerpt: note.kind === "artifact" ? "" : cutText(said.trim(), EXCERPT_CHIP_LENGTH),
  };
}

/** A thread box as lines name it: the room thread's own card, or a thread note. */
export const boardBoxRef = (boxId: string): string =>
  boxId === ROOM_BOARD_ROOM_BOX
    ? roomBoardCardRef(ROOM_BOARD_THREAD_CARD)
    : roomBoardNoteRef(boxId);

/**
 * The cards a prompt from a thread box carries: each note with a line into the box, or into the
 * artifact the box rewrites, and each note with a line into one of those, once each, nearest
 * first and in the order the lines were drawn. Thread boxes are never carried; the artifact the
 * box rewrites goes as its own record. The box's artifact is the first one it has a line to.
 */
export function boardPromptContext(
  board: RoomBoard,
  people: BoardPeople,
  messages: ReadonlyArray<BoardMessage> = [],
  boxId: string = ROOM_BOARD_ROOM_BOX,
): BoardPromptContext {
  const target = boardBoxRef(boxId);
  const notes = new Map(board.notes.map((note) => [roomBoardNoteRef(note.id), note]));
  const edges = board.edges ?? [];
  const artifactEdge = edges.find(
    (edge) => edge.from === target && notes.get(edge.to)?.kind === "artifact",
  );
  const roots = artifactEdge === undefined ? [target] : [target, artifactEdge.to];
  const reached = new Set<string>();
  const cards: Array<BoardPromptCard> = [];
  let frontier = roots;
  while (frontier.length > 0 && reached.size < BOARD_PROMPT_MAX_CARDS) {
    const next: Array<string> = [];
    for (const edge of edges) {
      const note = notes.get(edge.from);
      if (
        !frontier.includes(edge.to) ||
        note === undefined ||
        note.kind === "thread" ||
        roots.includes(edge.from) ||
        reached.has(edge.from)
      ) {
        continue;
      }
      if (reached.size === BOARD_PROMPT_MAX_CARDS) break;
      reached.add(edge.from);
      next.push(edge.from);
      const card = boardPromptCard(note, people, boardNoteQuote(note, messages));
      if (card !== null) cards.push(card);
    }
    frontier = next;
  }
  const carried = (ref: string) => roots.includes(ref) || reached.has(ref);
  return {
    cards,
    edgeIds: new Set(
      edges.filter((edge) => reached.has(edge.from) && carried(edge.to)).map((edge) => edge.id),
    ),
    artifact: artifactEdge === undefined ? null : (notes.get(artifactEdge.to) ?? null),
    artifactEdgeId: artifactEdge?.id ?? null,
  };
}

/** A thread box: the room thread's own card, or a thread note someone added. */
export interface BoardThreadBox {
  readonly id: string;
  /** The guest whose box it is. Absent: the owner's. */
  readonly guestId?: string | undefined;
  readonly title: string;
}

/** Every thread box on a board, the room thread's first. */
export function boardThreadBoxes(
  board: RoomBoard,
  roomTitle: string,
): ReadonlyArray<BoardThreadBox> {
  return [
    { id: ROOM_BOARD_ROOM_BOX, guestId: undefined, title: roomTitle },
    ...board.notes
      .filter((note) => note.kind === "thread")
      .map((note) => ({ id: note.id, guestId: note.guestId, title: note.text.trim() })),
  ];
}

/** Whether this person may prompt a box: only the person it belongs to. */
export const canPromptBoardBox = (
  box: Pick<BoardThreadBox, "guestId">,
  viewer: string | null,
): boolean => (box.guestId ?? null) === viewer;

/**
 * Whose agent a box runs on, as its card says it. A guest's box says whose agent ran its last
 * turn: their own ("Sam's agent"), or the owner's for a request the owner sent ("Sam, through
 * the owner's agent"). Before any turn it only says whose box it is.
 */
export function boardBoxAgentLabel(
  box: Pick<BoardThreadBox, "guestId">,
  people: BoardPeople,
  lastTurn?: { readonly guestId?: string | undefined } | undefined,
): string {
  const ownerAgent =
    people.viewer === null
      ? "your agent"
      : people.ownerName === undefined
        ? "the owner's agent"
        : `${people.ownerName}'s agent`;
  if (box.guestId === undefined) return sentenceStart(ownerAgent);
  const person = boardPersonName(people, box.guestId);
  const possessive = person === "You" ? "Your" : `${person}'s`;
  if (lastTurn === undefined) return `${possessive} thread`;
  return lastTurn.guestId === undefined
    ? `${person}, through ${ownerAgent}`
    : `${possessive} agent`;
}

/** A box as other cards name it: `Your thread "Pricing"`, or `Sam's thread`. */
export function boardBoxName(box: BoardThreadBox, people: BoardPeople): string {
  const person = boardPersonName(people, box.guestId);
  const whose = person === "You" ? "Your" : `${person}'s`;
  return box.title === "" ? `${whose} thread` : `${whose} thread "${box.title}"`;
}

/** The guests' requests for a box still waiting for the owner, oldest first. */
export const boardBoxRequests = (
  messages: ReadonlyArray<ThreadGuestMessage>,
  boxId: string,
): ReadonlyArray<ThreadGuestMessage> =>
  messages.filter((message) => message.status === "pending" && message.boxId === boxId);

/**
 * A guest's messages still waiting that no thread box shows, for their own card: a request made
 * from a box still on the board shows on that box only.
 */
export const boardGuestWaiting = (
  messages: ReadonlyArray<ThreadGuestMessage>,
  guestId: string,
  boxes: ReadonlyArray<Pick<BoardThreadBox, "id">>,
): ReadonlyArray<ThreadGuestMessage> =>
  messages.filter(
    (message) =>
      message.guestId === guestId &&
      message.status === "pending" &&
      !boxes.some((box) => box.id === message.boxId),
  );

/**
 * The viewer's own box that already rewrites this artifact, so "Attach my agent" reuses it
 * instead of adding another. Null when they have none.
 */
export function boardOwnBoxFor(
  board: RoomBoard,
  viewer: string | null,
  artifactId: string,
): string | null {
  const artifact = roomBoardNoteRef(artifactId);
  const own = [
    ...(viewer === null ? [ROOM_BOARD_ROOM_BOX] : []),
    ...board.notes
      .filter((note) => note.kind === "thread" && (note.guestId ?? null) === viewer)
      .map((note) => note.id),
  ];
  return (
    own.find((boxId) =>
      (board.edges ?? []).some((edge) => edge.from === boardBoxRef(boxId) && edge.to === artifact),
    ) ?? null
  );
}

const PROGRESS_PHASES: Readonly<Record<RoomBoxProgress["phase"], string>> = {
  queued: "Queued",
  thinking: "Thinking",
  tool: "Running a tool",
  writing: "Writing",
  approval: "Waiting for approval",
};

/**
 * What a box's agent is doing, in words: "Thinking", "Running pnpm test", "Writing". The server
 * names most tools as a phrase already ("Editing files"), which shows as it is.
 */
export const boardProgressPhase = (progress: Pick<RoomBoxProgress, "phase" | "detail">): string =>
  progress.phase === "tool" && progress.detail !== undefined && progress.detail.trim() !== ""
    ? /^[A-Z][a-z]+ing\b/.test(progress.detail.trim())
      ? progress.detail.trim()
      : `Running ${progress.detail.trim()}`
    : PROGRESS_PHASES[progress.phase];

/** How long something has run: "8s", "2m 05s", "1h 04m". */
export function formatBoardElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** A run's status line: its phase, its model, and how long it has run at `now`. */
export const boardProgressLine = (
  progress: Pick<RoomBoxProgress, "phase" | "detail" | "model" | "startedAt">,
  now: number,
): string =>
  [
    boardProgressPhase(progress),
    progress.model,
    formatBoardElapsed(now - Date.parse(progress.startedAt)),
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" · ");

/**
 * Whether an artifact draft still streaming is a page, which shows as source until it lands so a
 * half-written page never runs.
 */
export const boardDraftIsPage = (draft: string): boolean => /^\s*</.test(draft);

const sentenceStart = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Who wrote an artifact's current version: "Sam's agent", or "Your agent, asked by Sam" when the
 * owner sent a guest's message.
 */
export function boardArtifactAuthor(
  artifact: Pick<RoomArtifactContent, "guestId" | "askedBy">,
  people: BoardPeople,
): string {
  const agent = boardAgentName(people, artifact.guestId);
  const { askedBy } = artifact;
  if (askedBy === undefined || askedBy === artifact.guestId) return sentenceStart(agent);
  const asker = askedBy === people.viewer ? "you" : boardPersonName(people, askedBy);
  return sentenceStart(`${agent}, asked by ${asker}`);
}

/**
 * What restoring an artifact does, as its button says it: the version kept is the older one until
 * someone goes back to it, and then it is the newer.
 */
export const boardRestoreLabel = (artifact: {
  readonly updatedAt: string;
  readonly previous: { readonly updatedAt: string };
}): "Restore previous" | "Back to latest" =>
  Date.parse(artifact.previous.updatedAt) > Date.parse(artifact.updatedAt)
    ? "Back to latest"
    : "Restore previous";

/**
 * Whose agents are writing an artifact now, as its card says it: "Sam's agent is writing…", or
 * null when none is. The owner's comes first.
 */
export function boardArtifactWriting(
  noteId: string,
  running: ReadonlyArray<RoomAgentActivity>,
  ownerWritingArtifactId: string | null,
  people: BoardPeople,
): string | null {
  const names = [
    ...(ownerWritingArtifactId === noteId ? [boardAgentName(people, undefined)] : []),
    ...new Set(
      running
        .filter((agent) => agent.artifactId === noteId)
        .map((agent) => boardAgentName(people, agent.guestId)),
    ),
  ];
  const last = names.at(-1);
  if (last === undefined) return null;
  const who = names.length === 1 ? last : `${names.slice(0, -1).join(", ")} and ${last}`;
  return sentenceStart(`${who} ${names.length === 1 ? "is" : "are"} writing…`);
}
