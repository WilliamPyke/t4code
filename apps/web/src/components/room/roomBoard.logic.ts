import {
  GuestId,
  ROOM_BOARD_DRAG_MAX_ITEMS,
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_MAX_COORDINATE,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MIN_CARD_SIZE,
  ROOM_BOARD_QUOTE_MAX_LENGTH,
  ROOM_BOARD_REACTIONS,
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
  type RoomBoardDrag,
  type RoomBoardDragItem,
  type RoomBoardEdge,
  type RoomBoardNote,
  type RoomBoardReaction,
  type RoomBoardReactionEmoji,
  type RoomBoardReply,
  type RoomBoardSize,
  type RoomBoardViewport,
  type RoomBoxProgress,
  type RoomCodeState,
  type ThreadGuestMessage,
} from "@t3tools/contracts";
import { isRoomCardOwnedBy } from "@t3tools/shared/roomBoard";
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

// A wheel's notch is about 100px, a line 16px; a trackpad's pinch sends a few pixels at a time.
const WHEEL_LINE_PX = 16;
const WHEEL_PAGE_PX = 800;
const WHEEL_ZOOM_STEP_PX = 25;
const WHEEL_ZOOM_PX_PER_E = 200;

/**
 * How much one wheel or pinch event zooms by: in proportion to how far it turned, so a pinch is
 * smooth, but never more than one small step, however far a mouse reports a notch went.
 */
export function wheelZoomFactor(deltaY: number, deltaMode: number): number {
  const px = deltaY * (deltaMode === 1 ? WHEEL_LINE_PX : deltaMode === 2 ? WHEEL_PAGE_PX : 1);
  const step = Math.max(-WHEEL_ZOOM_STEP_PX, Math.min(WHEEL_ZOOM_STEP_PX, px));
  return Math.exp(-step / WHEEL_ZOOM_PX_PER_E);
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
  // A card no one sized takes the room it grows to: the thread's card is taller than a row.
  const sizeOf = (id: string): RoomBoardSize =>
    sizes?.[id] ?? {
      w: BOARD_CARD_WIDTH,
      h: id === ROOM_BOARD_THREAD_CARD ? THREAD_CARD_HEIGHT : CARD_ROW_HEIGHT,
    };
  const taken = new Set(
    cardIds.flatMap((id) => {
      const position = saved[id];
      return position === undefined ? [] : [slotOf(position), ...slotsUnder(position, sizeOf(id))];
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
    for (const under of slotsUnder(point, sizeOf(id))) taken.add(under);
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

/**
 * The view a board opens with: the one this device last had, unless it shows none of the cards,
 * when the board fits them all instead.
 */
export function openingBoardView(
  remembered: BoardView,
  area: BoardSize,
  rects: ReadonlyArray<BoardRect>,
): BoardView | null {
  const seen = visibleBoardRect(remembered, area);
  return rects.some(
    (rect) =>
      rect.x < seen.x + seen.width &&
      rect.x + rect.width > seen.x &&
      rect.y < seen.y + seen.height &&
      rect.y + rect.height > seen.y,
  )
    ? remembered
    : null;
}

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
 * What a new card must stay clear of: everything drawn, each card whose height follows its
 * content at least as tall as it grows to, notes on the board that are not drawn (just added, or
 * hidden resolved pins), and the grid slots `upcoming` cards will take when they appear, such as
 * the agent card of a guest whose agent has not run yet.
 */
export function boardTakenRects(
  drawn: ReadonlyArray<{ readonly ref: string; readonly rect: BoardRect }>,
  board: Pick<RoomBoard, "positions" | "sizes" | "notes">,
  cardIds: ReadonlyArray<string>,
  upcoming: ReadonlyArray<string>,
): Array<BoardRect> {
  const drawnRefs = new Set(drawn.map(({ ref }) => ref));
  const undrawn = board.notes
    .filter((note) => !drawnRefs.has(boardEditKey({ kind: "note", id: note.id })))
    .map(boardNoteRect);
  const grown = drawn.map(({ ref, rect }) => {
    const id = ref.startsWith("card:") ? ref.slice("card:".length) : null;
    if (id === null || board.sizes?.[id] !== undefined) return rect;
    const grows = id === ROOM_BOARD_THREAD_CARD ? THREAD_CARD_HEIGHT : CARD_ROW_HEIGHT;
    return { ...rect, height: Math.max(rect.height, grows) };
  });
  const placed = placeBoardCards(
    [...cardIds, ...upcoming],
    board.positions,
    undefined,
    board.sizes,
  );
  const slots = upcoming.flatMap((id) => {
    const at = placed[id];
    return at === undefined ? [] : [{ ...at, width: BOARD_CARD_WIDTH, height: CARD_ROW_HEIGHT }];
  });
  return [...grown, ...undrawn, ...slots];
}

/** Where a note is and how big, at its given size or, for heights the browser decides, a guess. */
function boardNoteRect(note: RoomBoardNote): BoardRect {
  const size = boardNoteSize(note);
  return {
    x: note.x,
    y: note.y,
    width: size?.w ?? NOTE_WIDTH,
    height: size?.h ?? (note.pinnedTo === undefined ? NOTE_HEIGHT : COMMENT_HEIGHT),
  };
}

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
  return [...cards, ...board.notes.map(boardNoteRect)];
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

/**
 * The card a new comment pin dropped on `under` goes with: a thread box or an artifact, which a
 * line from the pin carries the thread to. Null over anything else, or when the board holds no
 * more lines.
 */
export function boardCommentLineTo(board: RoomBoard, under: string | null): string | null {
  if (under === null || (board.edges?.length ?? 0) >= ROOM_BOARD_MAX_EDGES) return null;
  if (under === roomBoardCardRef(ROOM_BOARD_THREAD_CARD)) return under;
  const note = board.notes.find((candidate) => roomBoardNoteRef(candidate.id) === under);
  return note?.kind === "thread" || note?.kind === "artifact" ? under : null;
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
 * one in the bottom half, and never past the surface's edges. With room on neither side, it goes
 * below a pin in the top half and above one in the bottom half.
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
  const beside =
    right + width + PANEL_GAP <= area.width
      ? right
      : pin.x - PANEL_GAP - width >= PANEL_GAP
        ? pin.x - PANEL_GAP - width
        : null;
  const left = beside ?? Math.max(PANEL_GAP, Math.min(right, area.width - PANEL_GAP - width));
  const stacked = beside === null;
  if (pin.y + pin.height / 2 <= area.height / 2) {
    const top = Math.max(PANEL_GAP, stacked ? pin.y + pin.height + PANEL_GAP : pin.y);
    return { left, top, maxHeight: area.height - top - PANEL_GAP };
  }
  const bottom = Math.max(
    PANEL_GAP,
    stacked ? area.height - pin.y + PANEL_GAP : area.height - pin.y - pin.height,
  );
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
    value.color ?? null,
  ]);
};

const shows = (board: RoomBoard, edit: BoardEdit) =>
  edit.held || valueKey(edit.base) === valueKey(roomCopy(board, edit.target));

/**
 * Forgets the edits the room's copy has moved past, the same edits when there are none. Run on
 * every board the room sends: an edit kept past that would show again once the room's copy came
 * back to its base, as when someone else deletes a line this person drew.
 */
export function settleBoardEdits(board: RoomBoard, edits: BoardEdits): BoardEdits {
  const kept = Object.entries(edits).filter(([, edit]) => shows(board, edit));
  return kept.length === Object.keys(edits).length ? edits : Object.fromEntries(kept);
}

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
  return {
    ...settleBoardEdits(board, edits),
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

/**
 * The queue a change waits in. A line's is the two cards it joins, so taking a line off and
 * drawing it again reach the room in that order, not as a duplicate of the one going away.
 */
export function boardChangeQueueKey(
  board: RoomBoard,
  target: BoardTarget,
  value: BoardValue,
): string {
  if (target.kind !== "edge") return boardEditKey(target);
  const line =
    value !== null && "from" in value ? value : board.edges?.find((edge) => edge.id === target.id);
  return line === undefined ? boardEditKey(target) : `line:${line.from}>${line.to}`;
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

/** Takes back the edits still held for `keys`, as a cancelled drag does; let-go ones stay. */
export function dropHeldBoardEdits(edits: BoardEdits, keys: ReadonlySet<string>): BoardEdits {
  const kept = Object.entries(edits).filter(([key, edit]) => !(edit.held && keys.has(key)));
  return kept.length === Object.keys(edits).length ? edits : Object.fromEntries(kept);
}

const replaceById = <Item extends { readonly id: string }>(
  items: ReadonlyArray<Item>,
  item: Item,
): ReadonlyArray<Item> =>
  items.some((other) => other.id === item.id)
    ? items.map((other) => (other.id === item.id ? item : other))
    : [...items, item];

// As the server takes a line: one between the same two cards under another id changes nothing.
const sameLine = (edge: RoomBoardEdge, other: RoomBoardEdge) =>
  edge.id !== other.id && edge.from === other.from && edge.to === other.to;

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
    reactions: _reactions,
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
    ...(room?.reactions === undefined ? {} : { reactions: room.reactions }),
  };
};

/** The room's board with this person's own edits over it. A note taken off takes its arrows. */
export function resolveBoard(board: RoomBoard, edits: BoardEdits): RoomBoard {
  const positions = { ...board.positions };
  const sizes = { ...board.sizes };
  let notes = board.notes;
  let edges = board.edges ?? [];
  const drawn: Array<RoomBoardEdge> = [];
  for (const edit of Object.values(edits)) {
    if (!shows(board, edit)) continue;
    const { target, value } = edit;
    if (target.kind === "card") {
      if (value !== null && "x" in value) positions[target.id] = { x: value.x, y: value.y };
    } else if (target.kind === "size") {
      if (value !== null && "w" in value) sizes[target.id] = { w: value.w, h: value.h };
    } else if (target.kind === "edge") {
      if (value === null) edges = edges.filter((edge) => edge.id !== target.id);
      else if ("from" in value) drawn.push(value);
    } else if (value === null) {
      notes = notes.filter((note) => note.id !== target.id);
    } else if ("text" in value) {
      const room = board.notes.find((note) => note.id === target.id);
      notes = replaceById(notes, withServerFields(value, room));
    }
  }
  // After the lines taken off, so a line drawn again over one going away still shows.
  for (const line of drawn) {
    if (!edges.some((edge) => sameLine(edge, line))) edges = replaceById(edges, line);
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
    ...(value.color === undefined ? {} : { color: value.color }),
    ...(value.section === true ? { section: true } : {}),
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
 * What the room hears of this person on the board: their pointer, or null once it left, their
 * view when it changed, or null once they closed the board, and what they drag while they do.
 */
export interface BoardPresence {
  readonly at: BoardPoint | null;
  readonly view?: RoomBoardViewport | null;
  readonly drag?: RoomBoardDrag;
}

const samePoint = (a: BoardPoint | null, b: BoardPoint | null) =>
  a === null || b === null ? a === b : a.x === b.x && a.y === b.y;
const sameViewport = (a: RoomBoardViewport | null, b: RoomBoardViewport | null) =>
  a === null || b === null ? a === b : samePoint(a, b) && a.zoom === b.zoom;

/**
 * Sends a pointer's position, the board's view and what is dragged at most every
 * `CURSOR_SEND_INTERVAL_MS`, always ending on the latest, and nothing already sent. A pointer
 * leaving is sent at once, and closing the board takes both away. A drag rides the pointer's post;
 * where it landed is sent once, and the post after it says the drag is over.
 */
export function cursorSender(send: (presence: BoardPresence) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let at: BoardPoint | null = null;
  let view: RoomBoardViewport | null = null;
  let drag: RoomBoardDrag | null = null;
  let sentAt: BoardPoint | null = null;
  let sentView: RoomBoardViewport | null = null;
  let sentDrag: RoomBoardDrag | null = null;
  let lastSend = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const viewChanged = !sameViewport(view, sentView);
    const dragChanged = JSON.stringify(drag) !== JSON.stringify(sentDrag);
    if (samePoint(at, sentAt) && !viewChanged && !dragChanged) return;
    // A pointer off the board takes its drag with it.
    const sentWith = at === null ? null : drag;
    sentAt = at;
    sentView = view;
    sentDrag = sentWith;
    lastSend = Date.now();
    send({
      at,
      ...(viewChanged ? { view } : {}),
      ...(sentWith === null ? {} : { drag: sentWith }),
    });
    if (sentWith?.done === true) {
      drag = null;
      schedule();
    }
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
    /** What is dragged now; nothing is no drag. */
    drag: (items: ReadonlyArray<RoomBoardDragItem>) => {
      drag = items.length === 0 ? null : { items };
      schedule();
    },
    /** Where a drag landed as it was let go. */
    land: (items: ReadonlyArray<RoomBoardDragItem>) => {
      drag = items.length === 0 ? null : { items, done: true };
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
      drag = null;
      if (sentAt === null && sentView === null) return;
      sentAt = null;
      sentView = null;
      sentDrag = null;
      send({ at: null, view: null });
    },
  };
}

/**
 * What a person drags now, from the edits they hold: each card or note whose place or size moved
 * from where the gesture took it, at the whole pixels the room takes. A note only written in is
 * not dragged.
 */
export function boardDragItems(
  held: ReadonlyMap<string, BoardValue>,
  from: ReadonlyMap<string, BoardValue | undefined>,
): Array<RoomBoardDragItem> {
  const items = new Map<string, RoomBoardDragItem>();
  const put = (ref: string, fields: Omit<RoomBoardDragItem, "ref">) =>
    items.set(ref, { ...items.get(ref), ...fields, ref });
  for (const [key, raw] of held) {
    if (raw === null) continue;
    const colon = key.indexOf(":");
    const kind = key.slice(0, colon);
    const id = key.slice(colon + 1);
    const value = settleBoardValue(raw);
    if (kind === "note" && "text" in value) {
      const before = from.get(key);
      const was = before !== undefined && before !== null && "text" in before ? before : null;
      const sized =
        value.size !== undefined &&
        (was?.size?.w !== value.size.w || was?.size?.h !== value.size.h);
      if (was !== null && was.x === value.x && was.y === value.y && !sized) continue;
      put(key, {
        x: value.x,
        y: value.y,
        ...(sized && value.size !== undefined ? { w: value.size.w, h: value.size.h } : {}),
      });
    } else if (kind === "card" && "x" in value) {
      put(key, { x: value.x, y: value.y });
    } else if (kind === "size" && "w" in value) {
      put(`card:${id}`, clampBoardSize(value));
    }
  }
  return [...items.values()].slice(0, ROOM_BOARD_DRAG_MAX_ITEMS);
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

/**
 * Everyone the board can name: who is in the room, then people from earlier links and anyone
 * else who left, under the name they had. Only the first are in the room.
 */
export function boardPeopleOf(
  guests: BoardPeople["guests"],
  board: Pick<RoomBoard, "people"> | undefined,
  formerPeople: BoardPeople["guests"],
): BoardPeople["guests"] {
  const earlier = board?.people?.map((person) => ({ id: person.guestId, name: person.name }));
  return earlier === undefined || earlier.length === 0
    ? formerPeople.length === 0
      ? guests
      : [...guests, ...formerPeople]
    : [...guests, ...earlier, ...formerPeople];
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
  /** The comment thread the reply is posted in, when it was asked from one. */
  readonly commentId?: string | undefined;
}

/** A note added to a composer's draft as a paragraph of its own. */
export function appendNoteToDraft(draft: string, note: string): string {
  const text = note.trim();
  // A second press of "Use as message" on the same card adds nothing.
  if (text === "" || draft.trimEnd().endsWith(text)) return draft;
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
 * name, as everyone reads it, an agent's answer after whose agent it was. A thread too long for
 * one card keeps its first comment and its newest replies, and says how many it left out.
 */
function commentThreadText(note: RoomBoardNote, people: BoardPeople): string {
  const said = [
    { guestId: note.guestId, text: note.text, agent: undefined },
    ...(note.replies ?? []),
  ]
    .filter((comment) => comment.text.trim() !== "")
    .map((comment) => {
      const person = sharedPersonName(people, comment.guestId);
      const author = comment.agent === undefined ? person : `${person}'s agent`;
      return `${sentenceStart(author)}: ${comment.text.trim()}`;
    });
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

/**
 * A comment thread as a prompt asked from it carries it, with `asked`, the viewer's question just
 * sent and not on their board yet, as their last reply. Null for a thread with nothing said.
 */
export function boardCommentPromptCard(
  note: RoomBoardNote,
  people: BoardPeople,
  asked = "",
): BoardPromptCard | null {
  if (asked.trim() === "") return boardPromptCard(note, people);
  const question = {
    id: "asked",
    text: asked,
    at: "",
    ...(people.viewer === null ? {} : { guestId: GuestId.make(people.viewer) }),
  };
  return boardPromptCard({ ...note, replies: [...(note.replies ?? []), question] }, people);
}

/** What an agent asked from a comment thread is sent when the person asking typed nothing. */
export const BOARD_COMMENT_ASK_TEXT = "Respond to this comment thread.";

/**
 * The thread boxes someone can ask from a comment thread: their own, the room thread's card first
 * for the owner, each as the menu names it: "Your agent · Pricing".
 */
export function boardCommentAskBoxes(
  boxes: ReadonlyArray<BoardThreadBox>,
  viewer: string | null,
): ReadonlyArray<{ readonly id: string; readonly label: string }> {
  return boxes
    .filter((box) => canPromptBoardBox(box, viewer))
    .map((box) => ({ id: box.id, label: `Your agent · ${box.title || "Untitled thread"}` }));
}

/** Who wrote an agent's answer in a comment thread, and on what: "Sam's agent · Haiku". */
export const boardCommentAgentAuthor = (
  reply: {
    readonly guestId?: string | undefined;
    readonly agent: Pick<NonNullable<RoomBoardReply["agent"]>, "model">;
  },
  people: BoardPeople,
): string =>
  [sentenceStart(boardAgentName(people, reply.guestId)), reply.agent.model]
    .filter((part) => part !== undefined && part.trim() !== "")
    .join(" · ");

/** What an open comment thread says while an agent answers it: "Sam's agent is replying… · Writing". */
export const boardCommentReplying = (
  progress: Pick<RoomBoxProgress, "guestId" | "phase" | "detail">,
  people: BoardPeople,
): string =>
  `${sentenceStart(boardAgentName(people, progress.guestId))} is replying… · ${boardProgressPhase(progress)}`;

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

const BOX_TITLE_MAX_LENGTH = 80;

/** The title a thread box takes from the thread it is added for: one line, cut short. */
export function boardThreadBoxTitle(threadTitle: string): string {
  const title = threadTitle.replace(/\s+/g, " ").trim();
  if (title === "") return "Board thread";
  return title.length <= BOX_TITLE_MAX_LENGTH
    ? title
    : `${title.slice(0, BOX_TITLE_MAX_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
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

/** How many comment threads this device remembers having seen, across every board. */
export const BOARD_SEEN_COMMENTS_MAX = 300;
/** When this device last had each comment thread open: its newest reply's time, by thread. */
export type BoardSeenComments = Readonly<Record<string, string>>;
export const boardSeenCommentKey = (shareId: string, noteId: string) => `${shareId}/${noteId}`;

export const boardNewestReplyAt = (note: RoomBoardNote) =>
  (note.replies ?? []).reduce<string | undefined>(
    (newest, reply) =>
      newest === undefined || Date.parse(reply.at) > Date.parse(newest) ? reply.at : newest,
    undefined,
  );

/**
 * Whether a comment thread has a reply this viewer (null for the owner) has not seen: anyone
 * else's or any agent's, newer than when they last had it open. Their own replies never count.
 */
export function boardCommentUnread(
  note: RoomBoardNote,
  viewer: string | null,
  seenAt: string | undefined,
): boolean {
  const seen = seenAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(seenAt);
  return (note.replies ?? []).some(
    (reply) =>
      (reply.agent !== undefined || (reply.guestId ?? null) !== viewer) &&
      Date.parse(reply.at) > seen,
  );
}

/**
 * What this device remembers once a thread was open with its newest reply from `at`, keeping
 * the threads with the newest replies up to the cap. The same record when that changes nothing.
 */
export function boardCommentsSeen(
  seen: BoardSeenComments,
  key: string,
  at: string | undefined,
): BoardSeenComments {
  const before = seen[key];
  if (at === undefined || (before !== undefined && Date.parse(before) >= Date.parse(at))) {
    return seen;
  }
  const entries = Object.entries({ ...seen, [key]: at });
  if (entries.length <= BOARD_SEEN_COMMENTS_MAX) return Object.fromEntries(entries);
  return Object.fromEntries(
    entries
      .toSorted(([, left], [, right]) => Date.parse(right) - Date.parse(left))
      .slice(0, BOARD_SEEN_COMMENTS_MAX),
  );
}

/** The card or note a board item's ref names (`card:<id>` or `note:<id>`), or null. */
export function boardItemTarget(ref: string): BoardTarget | null {
  const split = ref.indexOf(":");
  const kind = ref.slice(0, split);
  const id = ref.slice(split + 1);
  if (split < 0 || id === "") return null;
  return kind === "card" || kind === "note" ? { kind, id } : null;
}

/** The items a marquee touches, of those drawn on the board, in board pixels. */
export function boardItemsInRect(
  items: ReadonlyArray<{ readonly ref: string; readonly rect: BoardRect }>,
  area: BoardRect,
): Array<string> {
  return items
    .filter(
      ({ rect }) =>
        rect.x <= area.x + area.width &&
        rect.x + rect.width >= area.x &&
        rect.y <= area.y + area.height &&
        rect.y + rect.height >= area.y,
    )
    .map(({ ref }) => ref);
}

/** How big a new section is when it frames nothing yet. */
export const BOARD_SECTION_SIZE: RoomBoardSize = { w: 640, h: 420 };
const SECTION_PADDING = 32;
const SECTION_TITLE_HEIGHT = 40;

/** The items whose centre is inside `area`, but `self`: what a section carries when dragged. */
export const boardItemsCentredIn = (
  items: ReadonlyArray<{ readonly ref: string; readonly rect: BoardRect }>,
  area: BoardRect,
  self: string,
): Array<string> =>
  items
    .filter(({ ref, rect }) => {
      const x = rect.x + rect.width / 2;
      const y = rect.y + rect.height / 2;
      return (
        ref !== self &&
        x >= area.x &&
        x <= area.x + area.width &&
        y >= area.y &&
        y <= area.y + area.height
      );
    })
    .map(({ ref }) => ref);

/** A section that frames these rects, with room for its title, or null for none. */
export function boardSectionAround(
  rects: ReadonlyArray<BoardRect>,
): (BoardPoint & { readonly size: RoomBoardSize }) | null {
  const bounds = boardBounds(rects);
  if (bounds === null) return null;
  const x = Math.round(bounds.x - SECTION_PADDING);
  const y = Math.round(bounds.y - SECTION_PADDING - SECTION_TITLE_HEIGHT);
  return {
    x,
    y,
    size: clampBoardSize({
      w: bounds.width + SECTION_PADDING * 2,
      h: bounds.height + SECTION_PADDING * 2 + SECTION_TITLE_HEIGHT,
    }),
  };
}

/**
 * Copies of the notes, tasks and links among `notes`, each named by `newId`, as `viewer`'s own
 * (null for the owner), where the originals are: a task as not done and given to no one. Thread
 * boxes, artifacts, comment threads, comments on replies and sections are not copied: what makes
 * them is their conversation, content or what sits on them.
 */
export function boardDuplicates(
  notes: ReadonlyArray<RoomBoardNote>,
  viewer: GuestId | null,
  newId: () => string,
): Array<{ readonly from: string; readonly note: RoomBoardNote }> {
  return notes.flatMap((note) => {
    const copies =
      note.section !== true &&
      note.pinnedTo === undefined &&
      (note.kind === undefined || note.kind === "task" || note.kind === "link");
    if (!copies) return [];
    return [
      {
        from: note.id,
        note: {
          id: newId(),
          text: note.text,
          x: note.x,
          y: note.y,
          ...(viewer === null ? {} : { guestId: viewer }),
          ...(note.kind === undefined ? {} : { kind: note.kind }),
          ...(note.url === undefined ? {} : { url: note.url }),
          ...(note.size === undefined ? {} : { size: note.size }),
          ...(note.color === undefined ? {} : { color: note.color }),
        },
      },
    ];
  });
}

const TIDY_GAP = 24;

/**
 * Where Tidy puts these items: a grid in their reading order (by rows as they sit, then left to
 * right), as near square as it goes, each column as wide as the widest item and each row as tall
 * as its tallest, with even gaps. It starts where they started when that is clear of `taken`, and
 * else at the nearest spot that is.
 */
export function boardTidy(
  items: ReadonlyArray<{ readonly ref: string; readonly rect: BoardRect }>,
  taken: ReadonlyArray<BoardRect>,
): Array<{ readonly ref: string; readonly x: number; readonly y: number }> {
  const bounds = boardBounds(items.map(({ rect }) => rect));
  if (bounds === null) return [];
  const rows: Array<Array<(typeof items)[number]>> = [];
  let rowEnd = -Infinity;
  for (const item of items.toSorted((left, right) => left.rect.y - right.rect.y)) {
    const row = rows.at(-1);
    if (row === undefined || item.rect.y >= rowEnd) {
      rows.push([item]);
      rowEnd = item.rect.y + item.rect.height / 2;
    } else row.push(item);
  }
  const ordered = rows.flatMap((row) => row.toSorted((left, right) => left.rect.x - right.rect.x));
  const columns = Math.ceil(Math.sqrt(ordered.length));
  const cell = Math.max(...ordered.map(({ rect }) => rect.width));
  const heights: Array<number> = [];
  ordered.forEach(({ rect }, index) => {
    const row = Math.floor(index / columns);
    heights[row] = Math.max(heights[row] ?? 0, rect.height);
  });
  const width = columns * cell + (columns - 1) * TIDY_GAP;
  const height =
    heights.reduce((sum, rowHeight) => sum + rowHeight, 0) + (heights.length - 1) * TIDY_GAP;
  const origin = placeBoardItem(
    { w: width, h: height },
    { x: bounds.x + width / 2, y: bounds.y + height / 2 },
    taken,
  );
  return ordered.map(({ ref }, index) => {
    const row = Math.floor(index / columns);
    return {
      ref,
      x: Math.round(origin.x + (index % columns) * (cell + TIDY_GAP)),
      y: Math.round(
        origin.y +
          heights.slice(0, row).reduce((sum, rowHeight) => sum + rowHeight, 0) +
          row * TIDY_GAP,
      ),
    };
  });
}

/** A selected card or note and where it is now. */
export interface BoardSelected {
  readonly target: BoardTarget;
  readonly value: BoardPoint | RoomBoardNote;
}

/**
 * The selected cards and notes still on the board, where each is now. Comment pins open their
 * thread and stay out of a selection.
 */
export function boardSelectionItems(
  board: RoomBoard,
  positions: Readonly<Record<string, BoardPoint>>,
  refs: Iterable<string>,
): Array<BoardSelected> {
  return [...refs].flatMap((ref) => {
    const target = boardItemTarget(ref);
    if (target === null) return [];
    if (target.kind === "card") {
      const at = positions[target.id];
      return at === undefined ? [] : [{ target, value: at }];
    }
    const note = board.notes.find((candidate) => candidate.id === target.id);
    return note === undefined || note.kind === "comment" ? [] : [{ target, value: note }];
  });
}

const SELECTION_BAR_GAP = 8;

/**
 * Where the selection's bar goes, in the board's screen pixels: centred just above the selected
 * cards, or just below them when there is no room above, and always inside the board, so it
 * never covers the cards being worked on nor the spot new ones land in.
 */
export function selectionBarSpot(
  selection: BoardRect,
  bar: BoardSize,
  board: BoardSize,
): { readonly left: number; readonly top: number } {
  const clamp = (value: number, max: number) =>
    Math.max(SELECTION_BAR_GAP, Math.min(value, max - SELECTION_BAR_GAP));
  const above = selection.y - SELECTION_BAR_GAP - bar.height;
  const below = selection.y + selection.height + SELECTION_BAR_GAP;
  return {
    left: clamp(selection.x + selection.width / 2 - bar.width / 2, board.width - bar.width),
    top: clamp(above >= SELECTION_BAR_GAP ? above : below, board.height - bar.height),
  };
}

/** Every selected item moved by the same amount, in board pixels, so they land together. */
export const boardGroupMove = (
  items: ReadonlyArray<BoardSelected>,
  dx: number,
  dy: number,
): Array<BoardSelected> =>
  items.map(({ target, value }) => ({
    target,
    value: { ...value, x: value.x + dx, y: value.y + dy },
  }));

/**
 * What Delete takes off the board of a selection: the notes this viewer (null for the owner) may
 * remove, and how many it leaves because they are someone else's. The room's own cards stay
 * and are not counted.
 */
export function boardSelectionRemoval(
  board: RoomBoard,
  refs: Iterable<string>,
  viewer: string | null,
): { readonly noteIds: ReadonlyArray<string>; readonly left: number } {
  const notes = boardSelectionItems(board, {}, refs).flatMap(({ value }) =>
    "id" in value ? [value] : [],
  );
  const noteIds = notes.filter((note) => isRoomCardOwnedBy(note, viewer)).map((note) => note.id);
  return { noteIds, left: notes.length - noteIds.length };
}

/** How many of this viewer's own board changes they can take back. */
export const BOARD_HISTORY_MAX = 50;

/** One card, note or line before and after one of this viewer's changes; null is not there. */
export interface BoardStep {
  readonly target: BoardTarget;
  readonly before: BoardValue;
  readonly after: BoardValue;
}
/** What one action of this viewer's changed: a drag of several cards is one. */
export type BoardHistoryEntry = ReadonlyArray<BoardStep>;

/** The card, note or line as the board shows it now, or null. */
export const boardValueOf = (board: RoomBoard, target: BoardTarget): BoardValue =>
  roomCopy(board, target) ?? null;

// A note's colour cannot be cleared, so going back to none is going back to yellow.
const withColorOf = (value: BoardValue, other: BoardValue): BoardValue =>
  value !== null &&
  other !== null &&
  "text" in value &&
  "text" in other &&
  value.color === undefined &&
  other.color !== undefined
    ? { ...value, color: "yellow" }
    : value;

// What only the owner's server writes into a card: taking back adding it would lose it.
const hasServerContent = (value: BoardValue) =>
  value !== null &&
  "text" in value &&
  [value.artifact, value.thread, value.answer, value.replies].some((field) => field !== undefined);

/**
 * The changes that take an entry back (`undo`) or make it again (`redo`), or null when the board
 * has moved on: someone changed one of its cards since, or a card added has gained what an agent
 * wrote. Taking back never undoes anyone else's change.
 */
export function boardHistoryChanges(
  board: RoomBoard,
  entry: BoardHistoryEntry,
  direction: "undo" | "redo",
): Array<{ readonly target: BoardTarget; readonly value: BoardValue }> | null {
  const steps = direction === "undo" ? entry.toReversed() : entry;
  const changes: Array<{ readonly target: BoardTarget; readonly value: BoardValue }> = [];
  for (const { target, before, after } of steps) {
    const [from, to] = direction === "undo" ? [after, before] : [before, after];
    const now = boardValueOf(board, target);
    if (valueKey(now) !== valueKey(from)) return null;
    if (to === null && hasServerContent(now)) return null;
    changes.push({ target, value: withColorOf(to, from) });
  }
  return changes;
}

/** The history with one more entry, the oldest dropped past the cap. */
export const boardHistoryWith = (
  history: ReadonlyArray<BoardHistoryEntry>,
  entry: BoardHistoryEntry,
): ReadonlyArray<BoardHistoryEntry> => [...history, entry].slice(-BOARD_HISTORY_MAX);

/** A card's reactions as its chips show them: each emoji once, in the fixed order, with who. */
export function boardReactionChips(
  reactions: ReadonlyArray<RoomBoardReaction>,
  people: BoardPeople,
): Array<{
  readonly emoji: RoomBoardReactionEmoji;
  readonly count: number;
  readonly mine: boolean;
  readonly names: string;
}> {
  return ROOM_BOARD_REACTIONS.flatMap((emoji) => {
    const by = reactions.filter((reaction) => reaction.emoji === emoji);
    if (by.length === 0) return [];
    return [
      {
        emoji,
        count: by.length,
        mine: by.some((reaction) => (reaction.guestId ?? null) === people.viewer),
        names: by.map((reaction) => boardPersonName(people, reaction.guestId)).join(", "),
      },
    ];
  });
}
