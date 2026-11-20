import {
  GuestId,
  ROOM_BOARD_DRAG_MAX_ITEMS,
  ROOM_BOARD_LEGACY_MAX_CARD_SIZE,
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_MAX_COORDINATE,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_SECTION_SIZE,
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
  type RoomBoardAgentTurn,
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
  type RoomCodeChanges,
  type RoomCodeState,
  type RoomPullRequest,
  type RoomPullRequestRead,
  roomPullRequestOf,
  type ThreadGuestMessage,
} from "@t3tools/contracts";
import {
  canUndoRoomAgentTurn,
  isRoomCardOwnedBy,
  ROOM_BOARD_NOTE_SIZE,
  ROOM_BOARD_SECTION_SIZE,
  ROOM_BOARD_TASK_SIZE,
  roomArtifactSource,
  roomBoardCardChangedAt,
  roomBoardNoteOfRef,
  roomBoxIdOfRef,
  roomCardEditor,
  roomLinkLabel,
  roomLinkPromptText,
  roomMarkPromptText,
  roomPullRequestLabel,
  roomSectionCards,
  roomTaskStatus,
  roomWindowBoxId,
} from "@t3tools/shared/roomBoard";
import {
  BOARD_SECTION_PADDING,
  BOARD_SECTION_TITLE_HEIGHT,
  BOARD_TIDY_GAP,
  boardFrameAround,
  boardGrid,
  boardReadingOrder,
  boardSectionColumns,
} from "@t3tools/shared/boardLayout";
import { roomEmbedOf } from "@t3tools/shared/roomEmbed";
import * as Schema from "effect/Schema";

import {
  boardCutForPrompt,
  boardLinkTextWithSnapshot,
  boardLinkWithSnapshotChange,
} from "./boardSnapshot.logic";
import { boardVotable } from "./boardVotes.logic";

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

/**
 * A two-finger pinch: from the view when it began, zoomed by how far the fingers spread and
 * moved with their midpoint, so the board point first between them stays between them.
 */
export function pinchBoardView(
  start: BoardView,
  from: readonly [BoardPoint, BoardPoint],
  to: readonly [BoardPoint, BoardPoint],
): BoardView {
  const middle = ([a, b]: readonly [BoardPoint, BoardPoint]) => ({
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
  });
  const spread = ([a, b]: readonly [BoardPoint, BoardPoint]) => Math.hypot(a.x - b.x, a.y - b.y);
  const factor = spread(from) === 0 ? 1 : spread(to) / spread(from);
  const zoom = Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, start.zoom * factor));
  const held = screenToBoard(start, middle(from));
  const now = middle(to);
  return { zoom, x: now.x - held.x * zoom, y: now.y - held.y * zoom };
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

const NOTE_WIDTH = ROOM_BOARD_NOTE_SIZE.w;
const NOTE_HEIGHT = ROOM_BOARD_NOTE_SIZE.h;
// Guesses for heights the browser decides, used only where nothing on screen can be measured.
const COMMENT_HEIGHT = 200;
const THREAD_CARD_HEIGHT = 420;

/** Something on the board, or the part of it a view shows, in board pixels. */
export interface BoardRect extends BoardPoint {
  readonly width: number;
  readonly height: number;
}

/** How big a new card of this kind is, for finding it a spot. */
export const boardNewNoteSize = (kind: RoomBoardNote["kind"], url?: string): RoomBoardSize =>
  boardNoteSize({ kind, ...(url === undefined ? {} : { url }) }) ??
  (kind === "task" ? ROOM_BOARD_TASK_SIZE : ROOM_BOARD_NOTE_SIZE);

const PLACE_GAP = 16;
const PLACE_REACH = 1_200;
const PLACE_STEPS = 60;

/**
 * The spot nearest `around` that covers least of what is `taken`, inside `area` when given, and
 * only to the right of and below it when `onward`.
 */
function searchBoardSpot(
  size: RoomBoardSize,
  around: BoardPoint,
  taken: ReadonlyArray<BoardRect>,
  area: BoardRect | undefined,
  onward = false,
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
  const from = onward ? 0 : -reachSteps;
  for (let i = from; i <= reachSteps; i += 1) {
    for (let j = from; j <= reachSteps; j += 1) offsets.push([i, j]);
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

const containsPoint = (rect: BoardRect, at: BoardPoint) =>
  at.x >= rect.x && at.x <= rect.x + rect.width && at.y >= rect.y && at.y <= rect.y + rect.height;

/**
 * Where something pasted or dropped goes: centred on where the pointer is when that is in `view`
 * (the part of the board people see), else on the middle of the view; clear of what is `taken`,
 * and inside the view wherever it has a clear spot.
 */
export function boardPointedSpot(
  size: RoomBoardSize,
  pointer: BoardPoint | null,
  view: BoardRect,
  taken: ReadonlyArray<BoardRect>,
): BoardPoint {
  const around =
    pointer !== null && containsPoint(view, pointer)
      ? pointer
      : { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  return placeBoardItem(size, around, taken, view);
}

/**
 * The section a card added from the toolbar goes into: the one selected alone, else the one the
 * pointer was last over, else the one holding the card this person last added or selected. A
 * section out of view does not count.
 */
export function boardAddSection(
  sections: ReadonlyArray<{ readonly ref: string; readonly rect: BoardRect }>,
  view: BoardRect,
  hints: {
    readonly selected: string | null;
    readonly pointer: BoardPoint | null;
    readonly lastCard: BoardPoint | null;
  },
): BoardRect | null {
  const seen = sections.filter(
    ({ rect }) =>
      rect.x < view.x + view.width &&
      rect.x + rect.width > view.x &&
      rect.y < view.y + view.height &&
      rect.y + rect.height > view.y,
  );
  const under = (at: BoardPoint | null) =>
    at === null ? undefined : seen.findLast(({ rect }) => containsPoint(rect, at));
  return (
    (
      seen.find(({ ref }) => ref === hints.selected) ??
      under(hints.pointer) ??
      under(hints.lastCard)
    )?.rect ?? null
  );
}

/**
 * Where a card added from the toolbar goes: into `section`'s free space, nearest the middle of the
 * view, or beside the section when it is full; with no section, as near the middle of the view as
 * it is clear of what is `taken`.
 */
export function boardAddSpot(
  size: RoomBoardSize,
  taken: ReadonlyArray<BoardRect>,
  view: BoardRect,
  section: BoardRect | null,
): BoardPoint {
  const middle = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  if (section === null) return placeBoardItem(size, middle, taken, view);
  const inner = {
    x: section.x,
    y: section.y + SECTION_TITLE_HEIGHT,
    width: section.width,
    height: section.height - SECTION_TITLE_HEIGHT,
  };
  const fits =
    inner.width >= size.w + PLACE_GAP * 2 && inner.height >= size.h + PLACE_GAP * 2
      ? searchBoardSpot(
          size,
          {
            x: Math.min(Math.max(middle.x, inner.x), inner.x + inner.width),
            y: Math.min(Math.max(middle.y, inner.y), inner.y + inner.height),
          },
          taken,
          inner,
        )
      : null;
  if (fits !== null && fits.cover === 0) return fits.at;
  return placeBoardItem(
    size,
    { x: section.x + section.width + PLACE_GAP * 2 + size.w / 2, y: section.y + size.h / 2 },
    [...taken, section],
  );
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
 * The view at the same zoom that brings `rect` to the middle of the area, when `panToShow` would
 * move to show it at all; a side too long for the area shows from its start, as there.
 */
export function panToCentre(view: BoardView, rect: BoardRect, area: BoardSize, margin = 24) {
  if (panToShow(view, rect, area, margin) === view) return view;
  const shift = (start: number, length: number, room: number) =>
    Math.round(length > room - margin * 2 ? margin - start : (room - length) / 2 - start);
  return {
    ...view,
    x: view.x + shift(view.x + rect.x * view.zoom, rect.width * view.zoom, area.width),
    y: view.y + shift(view.y + rect.y * view.zoom, rect.height * view.zoom, area.height),
  };
}

/**
 * The view that shows every rect in the surface, centred, at no more than full size. Cards too
 * spread out to fit even at `minZoom` show from their top: the top card at the top-left.
 */
export function fitBoardView(
  rects: ReadonlyArray<BoardRect>,
  area: BoardSize,
  margin: number | BoardInsets = 40,
  minZoom = BOARD_MIN_ZOOM,
): BoardView {
  const bounds = boardBounds(rects);
  if (bounds === null) return INITIAL_BOARD_VIEW;
  const inset =
    typeof margin === "number"
      ? { top: margin, right: margin, bottom: margin, left: margin }
      : margin;
  const room = {
    width: Math.max(1, area.width - inset.left - inset.right),
    height: Math.max(1, area.height - inset.top - inset.bottom),
  };
  const zoom = Math.min(
    1,
    Math.max(minZoom, Math.min(room.width / bounds.width, room.height / bounds.height)),
  );
  // Too wide to show whole, the view starts at the top card, so it never opens on empty board.
  const top = rects.reduce((first, rect) =>
    rect.y < first.y || (rect.y === first.y && rect.x < first.x) ? rect : first,
  );
  const place = (start: number, length: number, space: number, before: number, from: number) =>
    length * zoom > space
      ? Math.round(before - from * zoom)
      : Math.round(before + (space - length * zoom) / 2 - start * zoom);
  return {
    zoom,
    x: place(bounds.x, bounds.width, room.width, inset.left, top.x),
    y: place(bounds.y, bounds.height, room.height, inset.top, bounds.y),
  };
}

/** Space kept clear on each side of a surface, in screen pixels. */
export interface BoardInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/** Below this width the board is a phone's: Fit keeps clear of its chrome and stays readable. */
const BOARD_NARROW_WIDTH = 640;
/** The smallest zoom Fit goes to on a narrow board, where smaller text cannot be read. */
export const BOARD_READABLE_ZOOM = 0.35;
const NARROW_GUTTER = 16;
const NARROW_CHROME_GAP = 12;

/**
 * Fit for this surface. A wide one keeps `margin` on every side. A narrow one keeps a 16px gutter
 * on the sides, clears the chrome floating over its top and bottom (`covered`, in screen pixels),
 * and never goes below 35%: a board too big for that shows from its top card at 35%.
 */
export function fitBoardOnSurface(
  rects: ReadonlyArray<BoardRect>,
  area: BoardSize,
  covered: { readonly top: number; readonly bottom: number },
  margin: number,
): BoardView {
  if (area.width >= BOARD_NARROW_WIDTH) return fitBoardView(rects, area, margin);
  return fitBoardView(
    rects,
    area,
    {
      top: covered.top + NARROW_CHROME_GAP,
      right: NARROW_GUTTER,
      bottom: covered.bottom + NARROW_CHROME_GAP,
      left: NARROW_GUTTER,
    },
    BOARD_READABLE_ZOOM,
  );
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
 * Where a new item goes beside `rect`, so the line between them stays short: to its right and
 * level with its top, else below it and level with its left, else the clear spot nearest its
 * right. Never where the view happens to be: the view moves to it instead.
 */
export function besideBoardItem(
  rect: BoardRect,
  size: RoomBoardSize,
  taken: ReadonlyArray<BoardRect>,
): BoardPoint {
  const clear = (at: BoardPoint) =>
    !taken.some((other) =>
      rectsMeet(
        {
          x: at.x - PLACE_GAP,
          y: at.y - PLACE_GAP,
          width: size.w + PLACE_GAP * 2,
          height: size.h + PLACE_GAP * 2,
        },
        other,
      ),
    );
  const right = { x: Math.round(rect.x + rect.width + CARD_GAP), y: Math.round(rect.y) };
  const below = { x: Math.round(rect.x), y: Math.round(rect.y + rect.height + CARD_GAP) };
  if (clear(right)) return right;
  if (clear(below)) return below;
  return placeBoardItem(size, { x: right.x + size.w / 2, y: right.y + size.h / 2 }, taken);
}

/**
 * Where new boxes for `items` go, in their order: one column right of `selection`, a card gap
 * clear of it, each box level with its item unless the box above reaches past that, then stacked
 * a card gap below it. The column moves right until it keeps that gap from everything `taken`.
 */
export function boardBoxColumn(
  selection: BoardRect,
  items: ReadonlyArray<BoardRect>,
  size: RoomBoardSize,
  taken: ReadonlyArray<BoardRect>,
): Array<BoardPoint> {
  const ys: Array<number> = [];
  let below = -Infinity;
  const fromTop = items
    .map((item, index) => ({ item, index }))
    .toSorted((a, b) => a.item.y - b.item.y);
  for (const { item, index } of fromTop) {
    const y = Math.max(item.y, below);
    ys[index] = y;
    below = y + size.h + CARD_GAP;
  }
  const padded = (x: number, y: number) => ({
    x: x - CARD_GAP + 1,
    y: y - CARD_GAP + 1,
    width: size.w + CARD_GAP * 2 - 2,
    height: size.h + CARD_GAP * 2 - 2,
  });
  let x = selection.x + selection.width + CARD_GAP;
  for (;;) {
    const blocking = taken.filter((rect) => ys.some((y) => rectsMeet(padded(x, y), rect)));
    if (blocking.length === 0) break;
    x = Math.max(...blocking.map((rect) => rect.x + rect.width)) + CARD_GAP;
  }
  return ys.map((y) => ({ x, y }));
}

/**
 * What a new card must stay clear of: everything drawn, cards that grow with their content at
 * their full height, notes not drawn (just added, or hidden resolved pins), and the grid slots
 * `upcoming` cards will take, such as a guest's agent card. Sections are not: cards land in them.
 */
export function boardTakenRects(
  drawn: ReadonlyArray<{ readonly ref: string; readonly rect: BoardRect }>,
  board: Pick<RoomBoard, "positions" | "sizes" | "notes">,
  cardIds: ReadonlyArray<string>,
  upcoming: ReadonlyArray<string>,
): Array<BoardRect> {
  const drawnRefs = new Set(drawn.map(({ ref }) => ref));
  const undrawn = board.notes
    .filter(
      (note) =>
        note.section !== true && !drawnRefs.has(boardEditKey({ kind: "note", id: note.id })),
    )
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
export function boardNoteRect(note: RoomBoardNote): BoardRect {
  const size = boardNoteSize(note);
  return {
    x: note.x,
    y: note.y,
    width: size?.w ?? NOTE_WIDTH,
    height:
      size?.h ??
      (note.pinnedTo !== undefined
        ? COMMENT_HEIGHT
        : note.kind === "task"
          ? ROOM_BOARD_TASK_SIZE.h
          : NOTE_HEIGHT),
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
  return note?.kind === "thread" ||
    note?.kind === "artifact" ||
    note?.kind === "code" ||
    note?.kind === "pull-request"
    ? under
    : null;
}

/** Where a card or note is and how big, in board pixels: what a line joins. */
export interface BoardBox extends BoardPoint {
  readonly width: number;
  readonly height: number;
}

/** How big an artifact card is until someone resizes it. */
const BOARD_ARTIFACT_SIZE: RoomBoardSize = { w: 380, h: 400 };
/** How big a thread box is until someone resizes it, with room for its prompt box. */
const BOARD_THREAD_BOX_SIZE: RoomBoardSize = { w: 340, h: 460 };
/** How big a code window is until someone resizes it: a file list beside a diff. */
const BOARD_CODE_WINDOW_SIZE: RoomBoardSize = { w: 560, h: 420 };
/** How big a pull request window is until someone resizes it. */
const BOARD_PULL_REQUEST_SIZE: RoomBoardSize = { w: 360, h: 300 };
/** A link card whose source frames its page, and one that shows only its title and address. */
const BOARD_EMBED_SIZE: RoomBoardSize = { w: 480, h: 360 };
const BOARD_LINK_SIZE: RoomBoardSize = { w: 288, h: 132 };
/** A link card someone chose to show its page in: wide enough for a site's own layout. */
const BOARD_PAGE_SIZE: RoomBoardSize = { w: 640, h: 480 };

const embeds = new Map<string, ReturnType<typeof roomEmbedOf>>();
/** `roomEmbedOf`, read once per address, as sizes and lines ask for it on every frame. */
export function boardEmbedOf(url: string) {
  let embed = embeds.get(url);
  if (embed === undefined) {
    embed = roomEmbedOf(url);
    if (embeds.size >= 256) embeds.clear();
    embeds.set(url, embed);
  }
  return embed;
}

/** The longest side a card of this kind can be given: a section frames many, so it goes further. */
export const boardMaxSide = (item: { readonly section?: boolean | undefined }): number =>
  item.section === true ? ROOM_BOARD_MAX_SECTION_SIZE : ROOM_BOARD_MAX_CARD_SIZE;

/** A size dragged to, at the whole pixels and within the bounds the room takes for its kind. */
export const clampBoardSize = (
  size: RoomBoardSize,
  max = ROOM_BOARD_MAX_CARD_SIZE,
): RoomBoardSize => {
  const side = (value: number) =>
    Math.round(Math.min(max, Math.max(ROOM_BOARD_MIN_CARD_SIZE, value)));
  return { w: side(size.w), h: side(size.h) };
};

/**
 * Whether a change gives a card a side longer than hosts took before the larger sizes. Such a
 * host refuses it, and the card goes back to the size it had.
 */
export const boardChangeOutgrowsOlderHosts = (change: RoomBoardChange): boolean => {
  const size =
    change.type === "card.resize" ? change : change.type === "note.put" ? change.size : undefined;
  return size !== undefined && Math.max(size.w, size.h) > ROOM_BOARD_LEGACY_MAX_CARD_SIZE;
};

/** Which edge a resize moves on each axis: one axis for a side, both for a corner. */
export interface BoardResizeEdges {
  readonly x?: "start" | "end";
  readonly y?: "start" | "end";
}

/**
 * A card resized by a side or a corner, its moving edges `dx`/`dy` board pixels from where they
 * were taken. The opposite edges stay where they are, also at the bounds the room takes, so a
 * left or top edge moves the card's origin; an axis with no moving edge keeps its length.
 */
export function resizeBoardRect(
  from: BoardRect,
  edges: BoardResizeEdges,
  dx: number,
  dy: number,
  max = ROOM_BOARD_MAX_CARD_SIZE,
): { readonly x: number; readonly y: number; readonly size: RoomBoardSize } {
  const grown = (side: "start" | "end" | undefined, by: number) =>
    side === undefined ? 0 : side === "start" ? -by : by;
  const size = clampBoardSize(
    { w: from.width + grown(edges.x, dx), h: from.height + grown(edges.y, dy) },
    max,
  );
  return {
    x: edges.x === "start" ? from.x + from.width - size.w : from.x,
    y: edges.y === "start" ? from.y + from.height - size.h : from.y,
    size,
  };
}

/** Resize grips keep their size on screen as the board zooms: from half to 4 times board pixels. */
export const boardGripScale = (zoom: number): number => Math.min(4, Math.max(0.5, 1 / zoom));

/** The size a note shows at, or undefined for one that grows with its text. */
export const boardNoteSize = (
  note: Pick<RoomBoardNote, "kind" | "size" | "url" | "section" | "framed">,
): RoomBoardSize | undefined =>
  note.size ??
  (note.section === true
    ? ROOM_BOARD_SECTION_SIZE
    : note.kind === "artifact"
      ? BOARD_ARTIFACT_SIZE
      : note.kind === "thread"
        ? BOARD_THREAD_BOX_SIZE
        : note.kind === "code"
          ? BOARD_CODE_WINDOW_SIZE
          : note.kind === "pull-request"
            ? BOARD_PULL_REQUEST_SIZE
            : note.kind === "link"
              ? note.url !== undefined && boardEmbedOf(note.url)?.embedUrl !== undefined
                ? BOARD_EMBED_SIZE
                : note.framed === true
                  ? BOARD_PAGE_SIZE
                  : BOARD_LINK_SIZE
              : undefined);

/** A card's box: at its given size, else its width and `drawnHeight`, or a row's height. */
export const boardCardBox = (
  at: BoardPoint,
  size?: RoomBoardSize,
  drawnHeight?: number,
): BoardBox => ({
  x: at.x,
  y: at.y,
  width: size?.w ?? BOARD_CARD_WIDTH,
  height: size?.h ?? drawnHeight ?? CARD_ROW_HEIGHT,
});
/** A comment thread's pin, in board pixels before `boardPinScale`. */
export const BOARD_PIN_SIZE = 32;
const PIN_MIN_ON_SCREEN = 24;
const PIN_MAX_ON_SCREEN = 40;

/** How much a pin is scaled so it stays 24 to 40 screen pixels across at any zoom. */
export const boardPinScale = (zoom: number): number =>
  Math.min(PIN_MAX_ON_SCREEN, Math.max(PIN_MIN_ON_SCREEN, BOARD_PIN_SIZE * zoom)) /
  (BOARD_PIN_SIZE * zoom);

/**
 * Where a line meets a card or note: at its size, else at `drawnHeight` where the browser decides
 * its height, else a guess. A comment pin's depends on the zoom it is drawn at.
 */
export function boardNoteBox(
  note: BoardPoint & Partial<Pick<RoomBoardNote, "kind" | "size" | "url" | "section">>,
  zoom = 1,
  drawnHeight?: number,
): BoardBox {
  if (note.kind === "comment") {
    const size = BOARD_PIN_SIZE * boardPinScale(zoom);
    return { x: note.x, y: note.y, width: size, height: size };
  }
  const size = boardNoteSize(note);
  return {
    x: note.x,
    y: note.y,
    width: size?.w ?? NOTE_WIDTH,
    height: size?.h ?? drawnHeight ?? (note.kind === "task" ? ROOM_BOARD_TASK_SIZE.h : NOTE_HEIGHT),
  };
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

export type BoardSide = "left" | "right" | "top" | "bottom";

const SIDE_OUT: Readonly<Record<BoardSide, BoardPoint>> = {
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  top: { x: 0, y: -1 },
  bottom: { x: 0, y: 1 },
};

/** A point along one side of a box, where a line attaches: its middle at `slot` 0.5. */
export function boardSidePoint(box: BoardBox, side: BoardSide, slot = 0.5): BoardPoint {
  const out = SIDE_OUT[side];
  return {
    x: box.x + box.width * (out.x === 0 ? slot : (out.x + 1) / 2),
    y: box.y + box.height * (out.y === 0 ? slot : (out.y + 1) / 2),
  };
}

// How much clearer another choice of sides must be before a line moves to it.
const SIDE_HYSTERESIS = 32;
// A line turns a corner only with this much room to run before and after it.
const TURN_LEG = 40;

const isAcross = (side: BoardSide) => SIDE_OUT[side].y === 0;

/**
 * The sides a line between two boxes leaves and arrives by, so it never cuts through either box.
 * Boxes apart both ways, with the far one too steeply off for an S, get one turn: the higher box
 * by its side, the lower by its top. Else the facing pair across the wider gap. Given the sides
 * it uses now (`previous`), it keeps them, the same tuple, until another choice is clearly better.
 */
export function boardConnectorSides(
  from: BoardBox,
  to: BoardBox,
  previous?: readonly [BoardSide, BoardSide],
): readonly [BoardSide, BoardSide] {
  const gapX = Math.max(to.x - (from.x + from.width), from.x - (to.x + to.width));
  const gapY = Math.max(to.y - (from.y + from.height), from.y - (to.y + to.height));
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  const [upper, lower] = dy >= 0 ? [from, to] : [to, from];
  const wasTurn = previous !== undefined && isAcross(previous[0]) !== isAcross(previous[1]);
  const ease = previous === undefined ? 0 : wasTurn ? SIDE_HYSTERESIS : -SIDE_HYSTERESIS;
  const turns =
    Math.min(gapX, gapY) >= -ease / 4 &&
    Math.min(Math.abs(dx) - upper.width / 2, Math.abs(dy) - lower.height / 2) >=
      TURN_LEG - ease / 4 &&
    Math.abs(dy) > gapX - ease &&
    Math.abs(dx) > gapY - ease;
  if (turns) {
    const turn: readonly [BoardSide, BoardSide] =
      dy >= 0 ? [dx >= 0 ? "right" : "left", "top"] : ["top", dx >= 0 ? "left" : "right"];
    return previous !== undefined && previous[0] === turn[0] && previous[1] === turn[1]
      ? previous
      : turn;
  }
  const facing = wasTurn ? undefined : previous;
  const wasAcross = facing !== undefined && isAcross(facing[0]);
  const across =
    facing === undefined
      ? gapX >= gapY
      : wasAcross
        ? gapY <= gapX + SIDE_HYSTERESIS
        : gapX > gapY + SIDE_HYSTERESIS;
  const next: readonly [BoardSide, BoardSide] = across
    ? dx >= 0
      ? ["right", "left"]
      : ["left", "right"]
    : dy >= 0
      ? ["bottom", "top"]
      : ["top", "bottom"];
  if (facing === undefined) return next;
  if (facing[0] === next[0]) return facing;
  // Facing the other way only once the centres have clearly passed each other.
  const kept = across === wasAcross && Math.abs(across ? dx : dy) < SIDE_HYSTERESIS;
  return kept ? facing : next;
}

/** Where along each end's side a line attaches; 0.5 is the middle. */
export interface BoardLineSlots {
  readonly from: number;
  readonly to: number;
}

/**
 * Where each line attaches along its sides: alone on a side, the middle; with others, spread
 * along it in the order of where their other ends are, so lines leaving one side do not cross.
 */
export function boardLineSlots(
  lines: ReadonlyArray<{
    readonly id: string;
    readonly fromRef: string;
    readonly toRef: string;
    readonly from: BoardBox;
    readonly to: BoardBox;
  }>,
): ReadonlyMap<string, BoardLineSlots> {
  const sides = new Map<string, Array<{ id: string; end: "from" | "to"; along: number }>>();
  const add = (key: string, id: string, end: "from" | "to", side: BoardSide, other: BoardBox) => {
    const along = SIDE_OUT[side].x === 0 ? other.x + other.width / 2 : other.y + other.height / 2;
    const group = sides.get(key) ?? [];
    group.push({ id, end, along });
    sides.set(key, group);
  };
  for (const line of lines) {
    const [fromSide, toSide] = boardConnectorSides(line.from, line.to);
    add(`${line.fromRef}|${fromSide}`, line.id, "from", fromSide, line.to);
    add(`${line.toRef}|${toSide}`, line.id, "to", toSide, line.from);
  }
  const slots = new Map<string, { from: number; to: number }>();
  for (const group of sides.values()) {
    if (group.length < 2) continue;
    group.sort((a, b) => a.along - b.along || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    group.forEach(({ id, end }, index) => {
      const slot = slots.get(id) ?? { from: 0.5, to: 0.5 };
      slot[end] = (index + 1) / (group.length + 1);
      slots.set(id, slot);
    });
  }
  return slots;
}

// A line whose end is behind its start hooks round by this much, more the further off it is.
const MIN_HOOK = 24;
const MAX_HOOK = 96;
// How far along each leg of a turn its curve is pulled: a little squarer than a quarter circle.
const TURN_BEND = 0.6;
// Room between an arrowhead's tip and the card it points at, so the card never covers it.
const ARROW_GAP = 4;

/** Which sides a line uses and where along them it attaches; see `boardLineSlots`. */
export interface BoardLineEnds {
  readonly sides?: readonly [BoardSide, BoardSide] | undefined;
  readonly slots?: BoardLineSlots | undefined;
}

// A line attaches no nearer a corner than this.
const SLOT_MARGIN = 12;
const SLOT_BAND = 32;

/**
 * Where a line between facing sides attaches along each: each end slides from its slot toward
 * the other end, so cards side by side but offset get a level or gentle line in place of a
 * tall S.
 */
function facingSlots(
  from: BoardBox,
  to: BoardBox,
  fromSide: BoardSide,
  toSide: BoardSide,
  slots: BoardLineSlots | undefined,
): readonly [number, number] {
  const held: readonly [number, number] = [slots?.from ?? 0.5, slots?.to ?? 0.5];
  if (isAcross(fromSide) !== isAcross(toSide)) return held;
  const across = isAcross(fromSide);
  const span = (box: BoardBox) => {
    const low = across ? box.y : box.x;
    const length = across ? box.height : box.width;
    const margin = Math.min(SLOT_MARGIN, length / 2);
    return { low, length, min: low + margin, max: low + length - margin };
  };
  const a = span(from);
  const b = span(to);
  const at = (side: typeof a, slot: number) => side.low + side.length * slot;
  // Lines sharing a side keep their order: slid all the way, they sit within this of its end.
  const reach = (side: typeof a, slot: number, point: number, up: boolean) => {
    const band = Math.min(SLOT_BAND, side.max - side.min);
    return Math.max(
      0,
      up ? side.max - (1 - slot) * band - point : point - (side.min + slot * band),
    );
  };
  let pa = at(a, held[0]);
  let pb = at(b, held[1]);
  // Only as far as it takes for the line to run no steeper than it is long.
  const gap = Math.max(
    0,
    across
      ? Math.max(to.x - from.x - from.width, from.x - to.x - to.width)
      : Math.max(to.y - from.y - from.height, from.y - to.y - to.height),
  );
  const way = Math.sign(pb - pa);
  let excess = Math.abs(pb - pa) - gap;
  if (excess <= 0) return held;
  const reachA = reach(a, held[0], pa, way > 0);
  const reachB = reach(b, held[1], pb, way < 0);
  excess = Math.min(excess, reachA + reachB);
  const moveA = clamp(excess / 2, excess - reachB, reachA);
  pa += way * moveA;
  pb -= way * (excess - moveA);
  const slot = (side: typeof a, point: number) =>
    side.length === 0 ? 0.5 : (point - side.low) / side.length;
  return [slot(a, pa), slot(b, pb)];
}

/**
 * Where a line starts and where its tip stops, just short of the far box, with the ways it leaves
 * (`out`) and the far side faces (`into`): by the sides `boardConnectorSides` picks or `ends.sides`.
 */
export function boardLineEnds(from: BoardBox, to: BoardBox, ends?: BoardLineEnds) {
  const [fromSide, toSide] = ends?.sides ?? boardConnectorSides(from, to);
  const [fromSlot, toSlot] = facingSlots(from, to, fromSide, toSide, ends?.slots);
  const start = boardSidePoint(from, fromSide, fromSlot);
  const tip = boardSidePoint(to, toSide, toSlot);
  const out = SIDE_OUT[fromSide];
  const into = SIDE_OUT[toSide];
  const end = { x: tip.x + into.x * ARROW_GAP, y: tip.y + into.y * ARROW_GAP };
  return { start, end, out, into };
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

/**
 * A curve from one box's side to another's, leaving and arriving square to its sides, and the
 * point halfway along it. Facing sides make an S whose bend grows with how far off to the side
 * the end is, never past the gap; a turn makes one quarter curve. `sway` pulls its belly off its
 * resting course while it springs back.
 */
export function boardConnector(
  from: BoardBox,
  to: BoardBox,
  sway?: BoardPoint,
  ends?: BoardLineEnds,
): { readonly path: string; readonly middle: BoardPoint } {
  const { start, end, out, into } = boardLineEnds(from, to, ends);
  const turning = out.x * into.x + out.y * into.y === 0;
  // How far each end's control point sits from it, the way that end faces.
  const bend = (way: BoardPoint, sign: number) => {
    const ahead = ((end.x - start.x) * way.x + (end.y - start.y) * way.y) * sign;
    const aside = Math.abs((end.x - start.x) * way.y) + Math.abs((end.y - start.y) * way.x);
    if (ahead <= 0) return clamp((aside - ahead) / 4, MIN_HOOK, MAX_HOOK);
    return turning ? ahead * TURN_BEND : clamp(aside / 2, ahead / 2, ahead);
  };
  const leave = bend(out, 1);
  const arrive = bend(into, -1);
  const c1 = { x: start.x + out.x * leave, y: start.y + out.y * leave };
  const c2 = { x: end.x + into.x * arrive, y: end.y + into.y * arrive };
  const middle = {
    x: (start.x + 3 * c1.x + 3 * c2.x + end.x) / 8,
    y: (start.y + 3 * c1.y + 3 * c2.y + end.y) / 8,
  };
  const round = (value: number) => Math.round(value * 10) / 10;
  const off = sway ?? { x: 0, y: 0 };
  return {
    path: `M${round(start.x)} ${round(start.y)} C${round(c1.x + off.x)} ${round(c1.y + off.y)}, ${round(c2.x + off.x)} ${round(c2.y + off.y)}, ${round(end.x)} ${round(end.y)}`,
    middle,
  };
}

/** Lines stay thick enough to follow when zoomed out: drawn this much thicker, up to 4 times. */
export const boardLineScale = (zoom: number): number => Math.min(4, Math.max(1, 1 / zoom));

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
  if ("from" in value) return `${value.from}>${value.to}${value.shape === "elbow" ? "|elbow" : ""}`;
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
    value.status ?? null,
    value.due ?? null,
    value.order ?? null,
    value.priority ?? null,
    value.framed === true,
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
 * A change in several queues waits for each, as a line put back between two cards put back.
 */
export function boardChangeQueue() {
  const last = new Map<string, Promise<unknown>>();
  return <A>(keys: string | ReadonlyArray<string>, send: () => Promise<A>): Promise<A> => {
    const all = typeof keys === "string" ? [keys] : keys;
    const settled = () => undefined;
    const next = Promise.all(
      all.map((key) => (last.get(key) ?? Promise.resolve()).then(settled, settled)),
    ).then(send);
    for (const key of all) last.set(key, next);
    const forget = () => {
      for (const key of all) if (last.get(key) === next) last.delete(key);
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
    viewOf: _viewOf,
    thread: _thread,
    changes: _changes,
    pullRequest: _pullRequest,
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
    ...(room?.viewOf === undefined ? {} : { viewOf: room.viewOf }),
    ...(room?.thread === undefined ? {} : { thread: room.thread }),
    ...(room?.changes === undefined ? {} : { changes: room.changes }),
    ...(room?.pullRequest === undefined ? {} : { pullRequest: room.pullRequest }),
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
  // The rest of the room's copy (agent turns, past people) shows as the server has it.
  return {
    ...board,
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
  return "size" in at && at.size !== undefined
    ? { ...at, size: clampBoardSize(at.size, boardMaxSide(at)) }
    : at;
};

/**
 * The change that makes the room's copy of a card, note or arrow this value. A line that is
 * already there (`before`) only changes its shape.
 */
export function boardChangeOf(
  target: BoardTarget,
  value: BoardValue,
  before?: BoardValue,
): RoomBoardChange {
  if (target.kind === "card") {
    const at = value !== null && "x" in value ? value : { x: 0, y: 0 };
    return { type: "card.move", cardId: target.id, x: at.x, y: at.y };
  }
  if (target.kind === "size") {
    const size = clampBoardSize(value !== null && "w" in value ? value : BOARD_ARTIFACT_SIZE);
    return { type: "card.resize", cardId: target.id, ...size };
  }
  if (target.kind === "edge") {
    if (value === null || !("from" in value)) return { type: "edge.remove", edgeId: target.id };
    if (before !== undefined && before !== null && "from" in before) {
      return { type: "edge.shape", edgeId: target.id, shape: value.shape ?? "curve" };
    }
    return {
      type: "edge.put",
      edgeId: target.id,
      from: value.from,
      to: value.to,
      ...(value.shape === undefined ? {} : { shape: value.shape }),
    };
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
    ...(value.mark === undefined ? {} : { mark: value.mark }),
    ...(value.size === undefined ? {} : { size: value.size }),
    ...(value.color === undefined ? {} : { color: value.color }),
    // Said either way, so hiding a page and undoing either clear it; only link cards say it.
    ...(value.kind === "link" ? { framed: value.framed === true } : {}),
    ...(value.section === true ? { section: true } : {}),
    ...(value.mentions === undefined ? {} : { mentions: value.mentions }),
    ...(value.kind === "task"
      ? {
          done: value.done === true,
          status: roomTaskStatus(value),
          due: value.due ?? null,
          ...(value.order === undefined ? {} : { order: value.order }),
          priority: value.priority ?? null,
          assignee: value.assignee ?? null,
        }
      : {}),
  };
}

/** Where a pointer at `screen` is on the board, at the whole pixels the room takes. */
export const boardCursorAt = (view: BoardView, screen: BoardPoint): BoardPoint =>
  settleBoardValue(screenToBoard(view, screen));

const CURSOR_SEND_INTERVAL_MS = 80;
// Within the two seconds the room keeps a drag nobody posted again before taking it for gone.
const DRAG_BEAT_MS = 1_000;

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
 * Sends pointer, view and drag at most every `CURSOR_SEND_INTERVAL_MS`, a held drag every
 * `DRAG_BEAT_MS`; a landing once, then no drag. The room keeps a drag only with a pointer, so one
 * held off the board (typing) goes with the pointer's last board spot, or the view's middle.
 */
export function cursorSender(send: (presence: BoardPresence) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let beat: ReturnType<typeof setTimeout> | null = null;
  let at: BoardPoint | null = null;
  let parked: BoardPoint | null = null;
  let view: RoomBoardViewport | null = null;
  let drag: RoomBoardDrag | null = null;
  let sentAt: BoardPoint | null = null;
  let sentView: RoomBoardViewport | null = null;
  let sentDrag: RoomBoardDrag | null = null;
  let lastSend = Number.NEGATIVE_INFINITY;
  const flush = (again = false) => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const point =
      at ?? (drag === null ? null : (parked ?? (view === null ? null : { x: view.x, y: view.y })));
    const viewChanged = !sameViewport(view, sentView);
    const dragChanged = JSON.stringify(drag) !== JSON.stringify(sentDrag);
    if (!again && samePoint(point, sentAt) && !viewChanged && !dragChanged) return;
    const sentWith = point === null ? null : drag;
    sentAt = point;
    sentView = view;
    sentDrag = sentWith;
    lastSend = Date.now();
    if (beat !== null) clearTimeout(beat);
    beat =
      sentWith !== null && sentWith.done !== true
        ? setTimeout(() => flush(true), DRAG_BEAT_MS)
        : null;
    send({
      at: point,
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
      parked = point;
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
      if (beat !== null) clearTimeout(beat);
      timer = null;
      beat = null;
      at = null;
      parked = null;
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
 * from where the gesture took it, at the whole pixels the room takes, and each note's text while
 * it is written in, so the room reads it as it is typed.
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
      const written = was !== null && was.text !== value.text;
      if (was === null || was.x !== value.x || was.y !== value.y || sized) {
        put(key, {
          x: value.x,
          y: value.y,
          ...(sized && value.size !== undefined ? { w: value.size.w, h: value.size.h } : {}),
        });
      }
      if (written) put(key, { text: value.text });
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
// The board's person colours (index.css), most distinct first: the owner, then guests by join order.
// Join order rather than a hash of the id, so up to eight people never share a colour.
// The raw tokens: Tailwind only emits a `--color-person-n` it finds spelled out in source.
export const BOARD_PERSON_COLORS = [2, 1, 3, 4, 5, 6, 7, 8].map((n) => `var(--person-${n})`);

/**
 * One colour per person for as long as the link lasts, for their cursor, avatar, pins, live drags
 * and agent: the owner's, or the guest's by join order.
 */
export function boardCursorColor(
  guests: ReadonlyArray<{ readonly id: string }>,
  guestId: string | undefined,
): string {
  const index =
    guestId === undefined
      ? 0
      : Math.max(
          0,
          guests.findIndex((guest) => guest.id === guestId),
        ) + 1;
  return BOARD_PERSON_COLORS[index % BOARD_PERSON_COLORS.length]!;
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
  /** Someone other than its author who last changed its text, as this viewer reads them. */
  readonly editedBy?: string | undefined;
  /** Someone other than this viewer who changed it since it last went along its lines. */
  readonly changedBy?: string | undefined;
  /** Whoever drew a line that carries it, when not this viewer. */
  readonly addedBy?: string | undefined;
  /** Whether it goes with the next prompt on its own; see `BoardPromptCardStatus`. */
  readonly status?: BoardPromptCardStatus | undefined;
  /** When it was last sent, while `sent`. */
  readonly sentAt?: string | undefined;
  /** When the run that carried it finished, while `sent`. Absent: not finished, or not known. */
  readonly doneAt?: string | undefined;
  /** The lines that carry it, which pinning it pins. */
  readonly edgeIds?: ReadonlyArray<string> | undefined;
  /** The section whose line carries it, and those lines, so its chips can show as one. */
  readonly section?: BoardPromptSection | undefined;
}

interface BoardPromptSection {
  /** `note:<id>` of the section. */
  readonly ref: string;
  readonly title: string;
  readonly edgeIds: ReadonlyArray<string>;
}

/**
 * A connected card as a box's next prompt takes it: `new` (never sent along its line, or newly
 * connected) and `updated` (changed since it was last sent) go, `sent` stays out unless put back
 * for one prompt, and `pinned` goes with every prompt.
 */
export type BoardPromptCardStatus = "new" | "updated" | "sent" | "pinned";

/** Whether a card goes with the next prompt unless someone leaves it out by hand. */
export const boardPromptCardGoes = (card: Pick<BoardPromptCard, "status">): boolean =>
  card.status !== "sent";

/** Two or more cards that go along one section's line, shown as one chip. */
export interface BoardPromptSectionChip {
  readonly section: BoardPromptSection;
  readonly first: BoardPromptCard;
  readonly cards: ReadonlyArray<BoardPromptCard>;
}

/**
 * The chips a prompt's cards show as, in their order: a section's cards as one chip where two or
 * more of them go, every other card as its own.
 */
export function boardPromptChips(
  cards: ReadonlyArray<BoardPromptCard>,
): ReadonlyArray<{ readonly card: BoardPromptCard } | BoardPromptSectionChip> {
  const counts = new Map<string, number>();
  for (const card of cards) {
    if (card.section !== undefined) {
      counts.set(card.section.ref, (counts.get(card.section.ref) ?? 0) + 1);
    }
  }
  const groups = new Map<string, Array<BoardPromptCard>>();
  const chips: Array<{ readonly card: BoardPromptCard } | BoardPromptSectionChip> = [];
  for (const card of cards) {
    const section = card.section;
    if (section === undefined || (counts.get(section.ref) ?? 0) < 2) {
      chips.push({ card });
      continue;
    }
    const group = groups.get(section.ref);
    if (group !== undefined) {
      group.push(card);
      continue;
    }
    const started = [card];
    groups.set(section.ref, started);
    chips.push({ section, first: card, cards: started });
  }
  return chips;
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
  /** The box whose model pick it runs on, when not its own: new boxes made together share one. */
  readonly modelOf?: string | undefined;
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

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** A code window's changes in a few words: "3 files, +42 −7". */
export const boardCodeTotals = (
  changes: Pick<RoomCodeChanges, "files" | "more" | "additions" | "deletions">,
): string =>
  `${plural(changes.files.length + (changes.more ?? 0), "file", "files")}, +${changes.additions} −${changes.deletions}`;

/**
 * What a code window carries to an agent: its totals and each file with its counts, never a
 * patch, which only its machine has.
 */
function boardCodeFileList(changes: RoomCodeChanges): string {
  return [
    `Changed ${boardCodeTotals(changes)}${changes.truncated === true ? " (counts cut short)" : ""}:`,
    ...changes.files.map((file) => `${file.path} +${file.additions} -${file.deletions}`),
    ...(changes.more === undefined
      ? []
      : [`and ${plural(changes.more, "more file", "more files")}`]),
  ].join("\n");
}

/** A pull request's checks in a few words: "1 failing (lint), 2 passing, 1 pending". */
function boardPullRequestChecks(checks: RoomPullRequest["checks"]): string {
  const failing =
    checks.failing === 0
      ? []
      : [
          `${checks.failing} failing${
            checks.failingNames.length === 0 ? "" : ` (${checks.failingNames.join(", ")})`
          }`,
        ];
  const said = [
    ...failing,
    ...(checks.passing === 0 ? [] : [`${checks.passing} passing`]),
    ...(checks.pending === 0 ? [] : [`${checks.pending} pending`]),
  ];
  return said.length === 0 ? "No checks" : said.join(", ");
}

/** A pull request's commits in a few words, or null when they were not counted. */
export const boardPullRequestCommits = (pullRequest: RoomPullRequest): string | null =>
  pullRequest.commits === undefined
    ? null
    : `${pullRequest.commits}${pullRequest.moreCommits === true ? "+" : ""} ${
        pullRequest.commits === 1 && pullRequest.moreCommits !== true ? "commit" : "commits"
      }`;

/** What a pull request window carries to an agent: what it last showed, and its address. */
function boardPullRequestText(note: RoomBoardNote): string {
  const shown = note.pullRequest?.pullRequest;
  const ref = note.url === undefined ? null : roomPullRequestOf(note.url);
  if (shown === undefined || ref === null) return note.url ?? "";
  const commits = boardPullRequestCommits(shown);
  return [
    `${ref.repository}#${ref.number}: ${shown.title}`,
    `State: ${shown.state}, ${shown.headBranch} into ${shown.baseBranch}`,
    `Checks: ${boardPullRequestChecks(shown.checks)}`,
    [
      ...(commits === null ? [] : [commits]),
      `${plural(shown.changedFiles, "file", "files")} changed, +${shown.additions} -${shown.deletions}`,
    ].join(", "),
    ref.url,
  ].join("\n");
}

/** How long a pull request window's read lasts while someone looks at it, before it asks again. */
export const BOARD_PULL_REQUEST_STALE_MS = 5 * 60_000;

/** Whether a pull request window that is on screen should ask for a fresh read. */
export const boardPullRequestStale = (read: RoomPullRequestRead | undefined, nowMs: number) =>
  read === undefined || nowMs - Date.parse(read.readAt) >= BOARD_PULL_REQUEST_STALE_MS;

/**
 * The lines that make a code window show a thread box's changes: for each window, the first line
 * into it from a box, the only one the room takes.
 */
export function boardCodeEdgeIds(board: RoomBoard): ReadonlySet<string> {
  return new Set(
    board.notes.flatMap((note) => {
      if (note.kind !== "code") return [];
      const boxId = roomWindowBoxId(board, note.id);
      const from = boxId === undefined ? undefined : boardBoxRef(boxId);
      const edge = (board.edges ?? []).find(
        (candidate) => candidate.from === from && candidate.to === roomBoardNoteRef(note.id),
      );
      return edge === undefined ? [] : [edge.id];
    }),
  );
}

/** Whether an artifact is a whole HTML page, which the board shows as a page of its own. */
export const isBoardHtmlArtifact = (body: string): boolean =>
  /^(?:<!doctype html|<html)/i.test(body.trimStart());

const HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  "#39": "'",
  nbsp: " ",
};

/** An HTML page's name: its `<title>`, else its first heading, as plain text; null if neither. */
export function boardHtmlTitle(html: string): string | null {
  for (const pattern of [
    /<title[^>]*>([\s\S]*?)<\/title>/i,
    /<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i,
  ]) {
    const text = (pattern.exec(html)?.[1] ?? "")
      .replace(/<[^>]*>/g, "")
      .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (_, name: string) => HTML_ENTITIES[name] ?? "")
      .replace(/\s+/g, " ")
      .trim();
    if (text !== "") return text;
  }
  return null;
}

/** How many connected cards one message from the board carries. */
export const BOARD_PROMPT_MAX_CARDS = 16;
/** How many cards a box's lines reach, sent ones too, before the board stops looking further. */
const BOARD_PROMPT_MAX_REACH = 32;
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
  /** What the card each of those lines carries does with the next prompt. */
  readonly edgeStatus: ReadonlyMap<string, BoardPromptCardStatus>;
  /** Every artifact the box has a line to, in the order the lines were drawn. */
  readonly artifacts: ReadonlyArray<RoomBoardNote>;
  /** The one its next reply rewrites: the one picked, else the first, as the server picks it. */
  readonly artifact: RoomBoardNote | null;
  /** The box's lines to its artifacts, each of which a reply went along or can. */
  readonly artifactEdgeIds: ReadonlyArray<string>;
}

const isComment = (note: RoomBoardNote) => note.kind === undefined && note.pinnedTo !== undefined;

/** Who someone is as everyone in the room reads it: a guest's name, or the owner's, or "the owner". */
const sharedPersonName = (people: BoardPeople, guestId: string | undefined): string =>
  guestId === undefined
    ? (people.ownerName ?? "the owner")
    : (people.guests.find((guest) => guest.id === guestId)?.name ?? "a guest");

// Each matches a card's kind ("Figma link" among links) and who it is from.
const CARD_LABEL_PLURALS: ReadonlyArray<readonly [RegExp, (kind: string) => string]> = [
  [/^(Note) from (.+)$/, () => "notes"],
  [/^(Task) from (.+)$/, () => "tasks"],
  [/^((?:[\w.-]+ ){0,2}[Ll]ink) from (.+)$/, (kind) => (kind === "Link" ? "links" : `${kind}s`)],
  [/^(Comment thread) from (.+)$/, () => "comment threads"],
];

/**
 * The cards a turn went with, kept as everyone reads them ("Note from the owner"), as this viewer's
 * chips name their authors ("Note from You"), the same card label once with how many it was.
 */
export function boardCardsLine(cards: ReadonlyArray<string>, people: BoardPeople): string {
  const owner = new Set([
    "the owner",
    ...(people.ownerName === undefined ? [] : [people.ownerName]),
  ]);
  const viewerName =
    people.viewer === null
      ? undefined
      : people.guests.find((guest) => guest.id === people.viewer)?.name;
  const counted = new Map<string, { count: number; plural: string | null }>();
  for (const sent of cards) {
    let label = sent;
    let plural: string | null = null;
    for (const [pattern, many] of CARD_LABEL_PLURALS) {
      const [, kind, by] = pattern.exec(sent) ?? [];
      if (kind === undefined || by === undefined) continue;
      const name = owner.has(by)
        ? boardPersonName(people, undefined)
        : by === viewerName
          ? "You"
          : by;
      label = `${kind} from ${name}`;
      plural = `${many(kind)} from ${name}`;
      break;
    }
    counted.set(label, { count: (counted.get(label)?.count ?? 0) + 1, plural });
  }
  return [...counted]
    .map(([label, { count, plural }]) =>
      count === 1 ? label : plural === null ? `${label} (${count})` : `${count} ${plural}`,
    )
    .join(", ");
}

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
export function boardPromptCard(
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
      case "code":
        return text === "" ? "Code window" : `Code window "${text}"`;
      case "pull-request":
        return roomPullRequestLabel(note);
      case "task":
        return `Task from ${by}`;
      case "link":
        return roomLinkLabel(note.url, by);
      case "comment":
        return `Comment thread from ${by}`;
      default:
        return comment ? `Comment from ${by} on a reply` : `Note from ${by}`;
    }
  };
  const body =
    note.kind === "artifact"
      ? [text, boardCutForPrompt(note.artifact?.body.trim() ?? "", PROMPT_ARTIFACT_LENGTH)]
          .filter(Boolean)
          .join("\n\n")
      : note.kind === "code"
        ? note.changes === undefined
          ? ""
          : [text, boardCodeFileList(note.changes)].filter(Boolean).join("\n")
        : note.kind === "pull-request"
          ? [text, boardPullRequestText(note)].filter(Boolean).join("\n")
          : note.kind === "task"
            ? text === ""
              ? ""
              : `${text}\nStatus: ${note.done === true ? "done" : "not done"}`
            : note.kind === "link"
              ? roomLinkPromptText(note)
              : note.kind === "comment"
                ? commentThreadText(note, people)
                : comment && text !== "" && quote !== undefined
                  ? `On the reply: "${quote}"\n${text}`
                  : roomMarkPromptText(note);
  if (body.trim() === "") return null;
  const said =
    (note.kind === "link" ? body : text === "" ? (note.url ?? "") : text).split("\n")[0] ?? "";
  const written = note.kind === "artifact" ? note.artifact : undefined;
  const editor = written === undefined ? roomCardEditor(note) : undefined;
  const editedBy =
    written !== undefined
      ? (written.guestId ?? null) === people.viewer
        ? undefined
        : written.byHand === true
          ? boardPersonName(people, written.guestId)
          : boardAgentName(people, written.guestId)
      : editor === undefined || editor === (note.guestId ?? null)
        ? undefined
        : boardPersonName(people, editor ?? undefined);
  return {
    ref: roomBoardNoteRef(note.id),
    label: labelBy(boardPersonName(people, note.guestId)),
    sharedLabel: labelBy(sharedPersonName(people, note.guestId)),
    ...(editedBy === undefined ? {} : { editedBy }),
    text: body,
    // An artifact's and a code window's label already names it.
    excerpt:
      note.kind === "artifact" || note.kind === "code" || note.kind === "pull-request"
        ? ""
        : cutText(said.trim(), EXCERPT_CHIP_LENGTH),
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

/** What a box is asked when someone puts the HTML page its agent last wrote in a new artifact. */
export const BOARD_PAGE_TO_ARTIFACT_TEXT =
  "Write the HTML page from your last reply into the artifact, unchanged.";

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
 * artifact it rewrites (`picked`, else the first it has a line to), and into those, once each,
 * nearest first; a section's line carries each card in it now. Thread boxes are never carried;
 * the artifact goes as its own record.
 */
export function boardPromptContext(
  board: RoomBoard,
  people: BoardPeople,
  messages: ReadonlyArray<BoardMessage> = [],
  boxId: string = ROOM_BOARD_ROOM_BOX,
  picked?: string,
): BoardPromptContext {
  const target = boardBoxRef(boxId);
  const notes = new Map(board.notes.map((note) => [roomBoardNoteRef(note.id), note]));
  const edges = board.edges ?? [];
  const artifactEdges = edges.filter(
    (edge) => edge.from === target && notes.get(edge.to)?.kind === "artifact",
  );
  // Each as the artifact it shows: a view's is its source, once however many views the box has.
  const artifacts = [
    ...new Set(
      artifactEdges.flatMap((edge) => roomArtifactSource(board, notes.get(edge.to)?.id) ?? []),
    ),
  ];
  const pickedSource = roomArtifactSource(board, picked);
  const artifact = artifacts.find((note) => note === pickedSource) ?? artifacts[0];
  const roots = artifact === undefined ? [target] : [target, roomBoardNoteRef(artifact.id)];
  // A line into another card can carry it to several boxes, so its marks are each box's own.
  const marked = (edge: RoomBoardEdge): BoardLineMarks => {
    if (roots.includes(edge.to)) return edge;
    const { sentAt: _shared, doneAt: _sharedDone, ...rest } = edge;
    const own = edge.sentFor?.[boxId];
    const done = edge.doneFor?.[boxId];
    return {
      ...rest,
      ...(own === undefined ? {} : { sentAt: own }),
      ...(done === undefined ? {} : { doneAt: done }),
    };
  };
  // A section's line carries each card in it with that card's own marks for this box.
  const sectionMarked = (edge: RoomBoardEdge, ref: string): BoardLineMarks => {
    const sentAt = edge.sentCards?.[boxId]?.[ref];
    const doneAt = edge.doneCards?.[boxId]?.[ref];
    return {
      ...(edge.pinned === true ? { pinned: true as const } : {}),
      ...(sentAt === undefined ? {} : { sentAt }),
      ...(doneAt === undefined ? {} : { doneAt }),
    };
  };
  const reached = new Set<string>();
  // Each section reached, by ref, with the cards in it.
  const held = new Map<string, ReadonlyArray<RoomBoardNote>>();
  const found: Array<RoomBoardNote> = [];
  // Cards already sent stay out of the next prompt, so only the ones that go use up its room.
  let going = 0;
  const full = () => going === BOARD_PROMPT_MAX_CARDS || reached.size === BOARD_PROMPT_MAX_REACH;
  let frontier = roots;
  while (frontier.length > 0 && !full()) {
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
      if (full()) break;
      reached.add(edge.from);
      next.push(edge.from);
      if (note.section !== true) {
        found.push(note);
        if (boardPromptCardStatus(note, [marked(edge)], boxId) !== "sent") going += 1;
        continue;
      }
      const inside = roomSectionCards(board, note);
      held.set(edge.from, inside);
      for (const card of inside) {
        const ref = roomBoardNoteRef(card.id);
        if (roots.includes(ref) || reached.has(ref)) continue;
        if (full()) break;
        reached.add(ref);
        next.push(ref);
        found.push(card);
        if (boardPromptCardStatus(card, [sectionMarked(edge, ref)], boxId) !== "sent") going += 1;
      }
    }
    frontier = next;
  }
  const carried = (ref: string) => roots.includes(ref) || reached.has(ref);
  const lines = edges.filter((edge) => reached.has(edge.from) && carried(edge.to));
  const edgeStatus = new Map<string, BoardPromptCardStatus>();
  const cards: Array<BoardPromptCard> = [];
  for (const view of found) {
    const ref = roomBoardNoteRef(view.id);
    // A view goes as what it shows, and not at all when that artifact goes itself.
    const source = view.viewOf === undefined ? undefined : roomArtifactSource(board, view.id);
    if (source !== undefined && carried(roomBoardNoteRef(source.id))) continue;
    const note = source?.artifact === undefined ? view : { ...view, artifact: source.artifact };
    const own = lines.filter((edge) => edge.from === ref);
    const through = lines.filter(
      (edge) => held.get(edge.from)?.some((card) => card.id === note.id) === true,
    );
    const marks = [...own.map(marked), ...through.map((edge) => sectionMarked(edge, ref))];
    const status = boardPromptCardStatus(boardLinkWithSnapshotChange(board, note), marks, boxId);
    for (const edge of own) edgeStatus.set(edge.id, status);
    // A section's line reads as the most any card in it does.
    for (const edge of through) {
      const before = edgeStatus.get(edge.id);
      if (before === undefined || STATUS_RANK[status] > STATUS_RANK[before]) {
        edgeStatus.set(edge.id, status);
      }
    }
    const card = boardPromptCard(note, people, boardNoteQuote(note, messages));
    if (card === null) continue;
    const text = boardLinkTextWithSnapshot(board, note, card.text, carried);
    const section = through[0] === undefined ? undefined : notes.get(through[0].from);
    const changedBy = boardChangedBy(note, marks, people);
    const drawer = [...own, ...through].find((edge) => (edge.guestId ?? null) !== people.viewer);
    cards.push({
      ...card,
      text,
      ...(changedBy === undefined ? {} : { changedBy }),
      ...(drawer === undefined ? {} : { addedBy: boardPersonName(people, drawer.guestId) }),
      status,
      ...(status === "sent" ? boardSentMarks(marks) : {}),
      edgeIds: [...own, ...through].map((edge) => edge.id),
      ...(section === undefined
        ? {}
        : {
            section: {
              ref: roomBoardNoteRef(section.id),
              title: section.text.trim(),
              edgeIds: through
                .filter((edge) => edge.from === roomBoardNoteRef(section.id))
                .map((edge) => edge.id),
            },
          }),
    });
  }
  return {
    cards,
    edgeIds: new Set(lines.map((edge) => edge.id)),
    edgeStatus,
    artifacts,
    artifact: artifact ?? null,
    artifactEdgeIds: artifactEdges.map((edge) => edge.id),
  };
}

/**
 * The artifact a new line from `from` makes the empty artifact it ends on a live view of: the one
 * `from` shows when it is an artifact, or when it is a thread box the one it has a line to,
 * `picked` before the first. Null when the line ends anywhere else, or on a view or its own source.
 */
export function boardArtifactViewSource(
  board: RoomBoard,
  from: string,
  to: string,
  picked?: string,
): string | null {
  const target = roomBoardNoteOfRef(board, to);
  if (target?.kind !== "artifact" || target.artifact !== undefined) return null;
  if (target.viewOf !== undefined || from === to) return null;
  const sources =
    roomBoxIdOfRef(board, from) === undefined
      ? [roomArtifactSource(board, roomBoardNoteOfRef(board, from)?.id)]
      : (board.edges ?? [])
          .filter((edge) => edge.from === from && edge.to !== to)
          .map((edge) => roomArtifactSource(board, roomBoardNoteOfRef(board, edge.to)?.id));
  const shown = sources.filter((note) => note !== undefined && note.id !== target.id);
  const pickedSource = roomArtifactSource(board, picked);
  return (shown.find((note) => note === pickedSource) ?? shown[0])?.id ?? null;
}

const STATUS_RANK: Readonly<Record<BoardPromptCardStatus, number>> = {
  sent: 0,
  new: 1,
  updated: 1,
  pinned: 2,
};

/**
 * What a card does with a box's next prompt, from the lines that carry it there: pinned on any of
 * them, new on any no prompt went along yet, updated when it changed after the oldest send, else
 * sent. A board from before sends were marked has no marks, so every card on it is new.
 */
function boardPromptCardStatus(
  note: RoomBoardNote,
  lines: ReadonlyArray<BoardLineMarks>,
  boxId: string,
): BoardPromptCardStatus {
  if (lines.some((edge) => edge.pinned === true)) return "pinned";
  const sent = lines.map((edge) => edge.sentAt);
  if (sent.length === 0 || sent.some((at) => at === undefined)) return "new";
  const oldest = Math.min(...sent.map((at) => Date.parse(at ?? "")));
  const changed = roomBoardCardChangedAt(note, boxId);
  return changed !== undefined && Date.parse(changed) > oldest ? "updated" : "sent";
}

/** A line's marks as one box's prompts read them. */
type BoardLineMarks = Pick<RoomBoardEdge, "sentAt" | "doneAt" | "pinned">;

/**
 * Who other than the viewer changed a card since it last went along every line carrying it, so a
 * pinned card someone else rewrote never goes unremarked. Undefined for a card never sent.
 */
function boardChangedBy(
  note: RoomBoardNote,
  lines: ReadonlyArray<BoardLineMarks>,
  people: BoardPeople,
): string | undefined {
  const sent = lines.flatMap((line) => line.sentAt ?? []);
  if (sent.length === 0 || sent.length < lines.length) return undefined;
  const oldest = Math.min(...sent.map((at) => Date.parse(at)));
  const written = note.kind === "artifact" ? note.artifact : undefined;
  if (written !== undefined) {
    if ((written.guestId ?? null) === people.viewer) return undefined;
    if (Date.parse(written.updatedAt) <= oldest) return undefined;
    return written.byHand === true
      ? boardPersonName(people, written.guestId)
      : boardAgentName(people, written.guestId);
  }
  const editor = roomCardEditor(note);
  if (editor === undefined || editor === people.viewer || note.editedAt === undefined) {
    return undefined;
  }
  return Date.parse(note.editedAt) > oldest
    ? boardPersonName(people, editor ?? undefined)
    : undefined;
}

const latest = (times: ReadonlyArray<string>): string | undefined =>
  times.reduce<string | undefined>(
    (last, at) => (last === undefined || Date.parse(at) > Date.parse(last) ? at : last),
    undefined,
  );

/**
 * When a sent card last went, and when the run that carried it finished: only once every line
 * that carried it is marked done since it went along it.
 */
function boardSentMarks(
  lines: ReadonlyArray<BoardLineMarks>,
): Pick<BoardPromptCard, "sentAt" | "doneAt"> {
  const sentAt = latest(lines.flatMap((line) => line.sentAt ?? []));
  const done = lines.every(
    (line) =>
      line.sentAt !== undefined &&
      line.doneAt !== undefined &&
      Date.parse(line.doneAt) >= Date.parse(line.sentAt),
  );
  const doneAt = done ? latest(lines.flatMap((line) => line.doneAt ?? [])) : undefined;
  return {
    ...(sentAt === undefined ? {} : { sentAt }),
    ...(doneAt === undefined ? {} : { doneAt }),
  };
}

/**
 * Where a note stands with the agents it has a line to: `going` with the next prompt, `working`
 * while the run that carried it runs, `sent` with nothing saying that run finished, or `done`.
 */
type BoardNoteAgentState = "going" | "working" | "sent" | "done";

export interface BoardNoteAgentStatus {
  readonly state: Exclude<BoardNoteAgentState, "working">;
  /** The box it says this of: the one that has done least with the note. */
  readonly boxId: string;
  readonly card: BoardPromptCard;
}

const AGENT_STATE_RANK: Readonly<Record<BoardNoteAgentStatus["state"], number>> = {
  going: 0,
  sent: 1,
  done: 2,
};

/** Each connected card's standing, by ref, from what every box's next prompt does with it. */
export function boardNoteAgentStatuses(
  contexts: ReadonlyMap<string, Pick<BoardPromptContext, "cards">>,
): ReadonlyMap<string, BoardNoteAgentStatus> {
  const found = new Map<string, BoardNoteAgentStatus>();
  for (const [boxId, context] of contexts) {
    for (const card of context.cards) {
      const state = card.status !== "sent" ? "going" : card.doneAt === undefined ? "sent" : "done";
      const before = found.get(card.ref);
      if (before === undefined || AGENT_STATE_RANK[state] < AGENT_STATE_RANK[before.state]) {
        found.set(card.ref, { state, boxId, card });
      }
    }
  }
  return found;
}

/** A run starts around when its prompt's cards are marked sent, either one first. */
const RUN_START_SLACK_MS = 60_000;

/**
 * A note's standing while its box's agent runs: a sent note is with the agent when it went with
 * the prompt of the run now running, not one sent long before it.
 */
export function boardNoteAgentState(
  status: BoardNoteAgentStatus,
  progress: Pick<RoomBoxProgress, "startedAt"> | undefined,
): BoardNoteAgentState {
  const sentAt = status.card.sentAt;
  return status.state === "sent" &&
    progress !== undefined &&
    sentAt !== undefined &&
    Date.parse(sentAt) >= Date.parse(progress.startedAt) - RUN_START_SLACK_MS
    ? "working"
    : status.state;
}

/** The changes that make a sent card go with the next prompt again, along each line carrying it. */
export const boardResendChanges = (
  board: RoomBoard,
  card: Pick<BoardPromptCard, "ref" | "edgeIds">,
): ReadonlyArray<Extract<RoomBoardChange, { type: "edge.resend" }>> =>
  (board.edges ?? [])
    .filter((edge) => card.edgeIds?.includes(edge.id) === true)
    .map((edge) => ({
      type: "edge.resend" as const,
      edgeId: edge.id,
      // A section's line carries other cards too, which stay as they are.
      ...(edge.from === card.ref ? {} : { card: card.ref }),
    }));

/** A plain note connected to a box, a mark among them, and where it stands. */
interface BoardConnectedNote {
  readonly note: RoomBoardNote;
  readonly state: BoardNoteAgentStatus["state"];
}

/**
 * The plain notes among a box's connected `cards`, each with its standing; with `into`, only
 * those with a line into that card, as an artifact's own notes.
 */
export function boardConnectedNotes(
  board: RoomBoard,
  statuses: ReadonlyMap<string, BoardNoteAgentStatus>,
  cards: ReadonlyArray<Pick<BoardPromptCard, "ref">>,
  into?: string,
): ReadonlyArray<BoardConnectedNote> {
  return cards.flatMap((card) => {
    const note = roomBoardNoteOfRef(board, card.ref);
    const status = statuses.get(card.ref);
    if (note === undefined || note.kind !== undefined || status === undefined) return [];
    const joined =
      into === undefined ||
      board.edges?.some((edge) => edge.from === card.ref && edge.to === into) === true;
    return joined ? [{ note, state: status.state }] : [];
  });
}

/** The notes an agent is done with that `viewer` may delete, once each. */
export const boardDoneNoteIds = (
  notes: ReadonlyArray<BoardConnectedNote>,
  viewer: string | null,
): ReadonlyArray<string> => [
  ...new Set(
    notes
      .filter(({ note, state }) => state === "done" && isRoomCardOwnedBy(note, viewer))
      .map(({ note }) => note.id),
  ),
];

/** What a box's connected notes come to: how many, how many an agent is done with, and the rest. */
export function boardNotesSummary(
  statuses: ReadonlyArray<Pick<BoardNoteAgentStatus, "state">>,
): string | null {
  if (statuses.length === 0) return null;
  const count = (state: BoardNoteAgentStatus["state"]) =>
    statuses.filter((status) => status.state === state).length;
  const parts = [
    [count("done"), "done"],
    [count("sent"), "sent"],
    [count("going"), "to send"],
  ] as const;
  const said = parts.flatMap(([many, word]) => (many === 0 ? [] : [`${many} ${word}`]));
  return `${statuses.length} ${statuses.length === 1 ? "note" : "notes"}: ${said.join(", ")}`;
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
  roomThread = true,
): ReadonlyArray<BoardThreadBox> {
  return [
    ...(roomThread ? [{ id: ROOM_BOARD_ROOM_BOX, guestId: undefined, title: roomTitle }] : []),
    ...board.notes
      .filter((note) => note.kind === "thread")
      .map((note) => ({ id: note.id, guestId: note.guestId, title: note.text.trim() })),
  ];
}

/**
 * A board the cloud host keeps, on nobody's machine: it has no thread, owner, code or pull
 * requests of its own. `agents`: people can bring their own machine's agent to it.
 */
export interface RoomBoardCloud {
  readonly agents: boolean;
}

/** What a room's board can hold, from where it is kept. */
export function roomBoardHolds(cloud: RoomBoardCloud | undefined) {
  return {
    /** The room's own thread card and box, its people's cards, and tasks for its owner. */
    room: cloud === undefined,
    /** Thread boxes and the cards of agents that ran. */
    agents: cloud === undefined || cloud.agents,
    /** Code and pull request windows, which the owner's machine reads. */
    windows: cloud === undefined,
  };
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

/** The box a request waits on: a request from a guest's side panel waits on the room thread. */
const requestBoxId = (message: ThreadGuestMessage): string => message.boxId ?? ROOM_BOARD_ROOM_BOX;

/** The guests' requests for a box still waiting for the owner, oldest first. */
export const boardBoxRequests = (
  messages: ReadonlyArray<ThreadGuestMessage>,
  boxId: string,
): ReadonlyArray<ThreadGuestMessage> =>
  messages.filter((message) => message.status === "pending" && requestBoxId(message) === boxId);

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
      !boxes.some((box) => box.id === requestBoxId(message)),
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
  // A view is rewritten by whatever rewrites the artifact it shows, along a line to either.
  const shows = (id: string | undefined) => roomArtifactSource(board, id)?.id ?? id;
  const artifact = shows(artifactId);
  const own = [
    ...(viewer === null ? [ROOM_BOARD_ROOM_BOX] : []),
    ...board.notes
      .filter((note) => note.kind === "thread" && (note.guestId ?? null) === viewer)
      .map((note) => note.id),
  ];
  return (
    own.find((boxId) =>
      (board.edges ?? []).some(
        (edge) =>
          edge.from === boardBoxRef(boxId) &&
          shows(roomBoardNoteOfRef(board, edge.to)?.id) === artifact,
      ),
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
  artifact: Pick<RoomArtifactContent, "guestId" | "askedBy" | "byHand">,
  people: BoardPeople,
): string {
  if (artifact.byHand === true) {
    const person = boardPersonName(people, artifact.guestId);
    return `Written by ${person === "You" ? "you" : person}`;
  }
  const agent = boardAgentName(people, artifact.guestId);
  const { askedBy } = artifact;
  if (askedBy === undefined || askedBy === artifact.guestId) return sentenceStart(agent);
  const asker = askedBy === people.viewer ? "you" : boardPersonName(people, askedBy);
  return sentenceStart(`${agent}, asked by ${asker}`);
}

/**
 * What tells an artifact card from another one of the same box, said quietly under its author:
 * the artifact a live view follows, or that the viewer's next reply lands here (`receives`).
 */
export function boardArtifactVersionNote(
  board: RoomBoard,
  note: RoomBoardNote,
  receives: boolean,
): string | null {
  if (note.viewOf === undefined) return receives ? "Next reply goes here" : null;
  const source = roomArtifactSource(board, note.id);
  return source === undefined
    ? null
    : `Live view of "${source.text.trim() || "Untitled artifact"}"`;
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
export const BOARD_SECTION_SIZE: RoomBoardSize = ROOM_BOARD_SECTION_SIZE;
const SECTION_PADDING = BOARD_SECTION_PADDING;
const SECTION_TITLE_HEIGHT = BOARD_SECTION_TITLE_HEIGHT;

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

/**
 * The first section whose rect holds every one of `points`: the one a selection centred inside it
 * is tidied in, and the one whose menu a right-click on its empty space opens. None for no points.
 */
export const boardSectionHolding = <Section extends { readonly rect: BoardRect }>(
  sections: ReadonlyArray<Section>,
  points: ReadonlyArray<BoardPoint>,
): Section | undefined =>
  points.length === 0
    ? undefined
    : sections.find(({ rect }) =>
        points.every(
          ({ x, y }) =>
            x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height,
        ),
      );

/**
 * The section whose frame `point` is on, within `band` of its edge either side, where a line can
 * end at the section; inside that, the board and its cards keep the pointer. The smallest
 * such section, or null.
 */
export function boardSectionFrameAt<Section extends { readonly rect: BoardRect }>(
  sections: ReadonlyArray<Section>,
  point: BoardPoint,
  band: number,
): Section | null {
  const within = (rect: BoardRect, grow: number) =>
    point.x >= rect.x - grow &&
    point.x <= rect.x + rect.width + grow &&
    point.y >= rect.y - grow &&
    point.y <= rect.y + rect.height + grow;
  return (
    sections
      .filter(({ rect }) => within(rect, band) && !within(rect, -band))
      .toSorted((a, b) => a.rect.width * a.rect.height - b.rect.width * b.rect.height)[0] ?? null
  );
}

/** A section that frames these rects, with room for its title, or null for none. */
export function boardSectionAround(
  rects: ReadonlyArray<BoardRect>,
): (BoardPoint & { readonly size: RoomBoardSize }) | null {
  const frame = boardFrameAround(rects);
  if (frame === null) return null;
  return {
    x: frame.x,
    y: frame.y,
    size: clampBoardSize({ w: frame.width, h: frame.height }, ROOM_BOARD_MAX_SECTION_SIZE),
  };
}

/** How far a duplicate sits from its original, right and down, in board pixels. */
const BOARD_DUPLICATE_STEP = 24;

/**
 * How far duplicates of cards at `copies` go: one small step right and down, and another for as
 * long as a copy would sit exactly where a card already is, as duplicating a duplicate does.
 */
export function boardDuplicateOffset(
  copies: ReadonlyArray<BoardPoint>,
  taken: ReadonlyArray<BoardPoint>,
): BoardPoint {
  const corners = new Set(taken.map((at) => `${Math.round(at.x)},${Math.round(at.y)}`));
  let step = BOARD_DUPLICATE_STEP;
  while (
    step < BOARD_DUPLICATE_STEP * 100 &&
    copies.some((at) => corners.has(`${Math.round(at.x + step)},${Math.round(at.y + step)}`))
  ) {
    step += BOARD_DUPLICATE_STEP;
  }
  return { x: step, y: step };
}

/**
 * Copies of the notes, tasks and links among `notes`, each named by `newId`, as `viewer`'s own
 * (null for the owner), where the originals are: a task as not done and given to no one. Thread
 * boxes, artifacts, code windows, comment threads, comments on replies and sections are not
 * copied: what makes them is their conversation, content or what sits on them.
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
          ...(note.framed === true ? { framed: true as const } : {}),
        },
      },
    ];
  });
}

/** What copying a selection left out, as a sentence, or null when it copied all of it. */
export function boardCopySkipped(
  notes: ReadonlyArray<RoomBoardNote>,
  cards: number,
): string | null {
  const kinds = new Set<string>();
  for (const note of notes) {
    if (note.section === true) kinds.add("Sections");
    else if (note.pinnedTo !== undefined) kinds.add("Comments on replies");
    else if (note.kind === "thread") kinds.add("Thread boxes");
    else if (note.kind === "artifact") kinds.add("Artifacts");
    else if (note.kind === "code") kinds.add("Code windows");
    else if (note.kind === "pull-request") kinds.add("Pull request windows");
    else if (note.kind === "comment") kinds.add("Comment threads");
  }
  if (cards > 0) kinds.add("The room's cards");
  const named = [...kinds].map((kind, index) => (index === 0 ? kind : kind.toLowerCase()));
  if (named.length === 0) return null;
  const list =
    named.length === 1 ? named[0] : `${named.slice(0, -1).join(", ")} and ${named.at(-1)}`;
  return `${list} are not copied.`;
}

const TIDY_GAP = BOARD_TIDY_GAP;

/**
 * Where Tidy puts these items: a near-square grid in reading order (or as `order` reorders it),
 * columns as wide as the widest item, rows as tall as their tallest, even gaps. It starts at their
 * top-left corner when clear of `taken`, else at the nearest clear spot right of or below it.
 */
export function boardTidy<T extends { readonly ref: string; readonly rect: BoardRect }>(
  items: ReadonlyArray<T>,
  taken: ReadonlyArray<BoardRect>,
  order: (inReadingOrder: ReadonlyArray<T>) => ReadonlyArray<T> = (same) => same,
): Array<{ readonly ref: string; readonly x: number; readonly y: number }> {
  const bounds = boardBounds(items.map(({ rect }) => rect));
  if (bounds === null) return [];
  const ordered = order(boardReadingOrder(items));
  const grid = boardGrid(ordered, Math.ceil(Math.sqrt(ordered.length)));
  const origin = searchBoardSpot(
    { w: grid.width, h: grid.height },
    { x: bounds.x + grid.width / 2, y: bounds.y + grid.height / 2 },
    taken,
    undefined,
    true,
  )?.at ?? { x: bounds.x, y: bounds.y };
  return grid.at(origin);
}

/**
 * Tidy inside a section: the same grid, as many columns as fit its width, from its top-left
 * inside its padding, and the size it grows to so the grid stays inside it.
 */
export function boardTidySection<T extends { readonly ref: string; readonly rect: BoardRect }>(
  items: ReadonlyArray<T>,
  section: BoardRect,
  order: (inReadingOrder: ReadonlyArray<T>) => ReadonlyArray<T> = (same) => same,
): {
  readonly places: Array<{ readonly ref: string; readonly x: number; readonly y: number }>;
  readonly size: RoomBoardSize;
} {
  const ordered = order(boardReadingOrder(items));
  const grid = boardGrid(ordered, boardSectionColumns(ordered, section.width));
  return {
    places: grid.at({
      x: section.x + SECTION_PADDING,
      y: section.y + SECTION_TITLE_HEIGHT + SECTION_PADDING,
    }),
    size: clampBoardSize(
      {
        w: Math.ceil(Math.max(section.width, grid.width + SECTION_PADDING * 2)),
        h: Math.ceil(
          Math.max(section.height, grid.height + SECTION_PADDING * 2 + SECTION_TITLE_HEIGHT),
        ),
      },
      ROOM_BOARD_MAX_SECTION_SIZE,
    ),
  };
}

const rectsMeet = (a: BoardRect, b: BoardRect) =>
  a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

interface BoardPushItem {
  readonly ref: string;
  readonly rect: BoardRect;
  readonly section?: boolean;
}

/**
 * What must move for `grown` to be clear, and how far: the `covered` items go past its bottom
 * edge (its right edge when `across`) with Tidy's gap, then whatever they would land on, and
 * whatever sits in a section that moves. All move by the same amount, so they keep their layout.
 */
function boardPushedPast<Item extends BoardPushItem>(
  grown: BoardRect,
  covered: ReadonlyArray<Item>,
  items: ReadonlyArray<Item>,
  across: boolean,
): { readonly by: number; readonly moved: ReadonlyArray<Item> } {
  if (covered.length === 0) return { by: 0, moved: [] };
  const clear = (rect: BoardRect) =>
    across ? grown.x + grown.width + TIDY_GAP - rect.x : grown.y + grown.height + TIDY_GAP - rect.y;
  const beside = (rect: BoardRect) =>
    across
      ? rect.y < grown.y + grown.height && grown.y < rect.y + rect.height
      : rect.x < grown.x + grown.width && grown.x < rect.x + rect.width;
  const shifted = (rect: BoardRect, by: number) =>
    across ? { ...rect, x: rect.x + by } : { ...rect, y: rect.y + by };
  let by = Math.ceil(Math.max(...covered.map(({ rect }) => clear(rect))));
  const moved = new Set(covered);
  for (let grew = true; grew;) {
    grew = false;
    for (const item of items) {
      if (moved.has(item)) continue;
      const lands = [...moved].some(
        (other) =>
          rectsMeet(item.rect, shifted(other.rect, by)) ||
          (other.section === true &&
            boardItemsCentredIn([item], other.rect, other.ref).length > 0) ||
          // A section goes with a card of its own that moves, so the card stays inside it.
          (item.section === true && boardItemsCentredIn([other], item.rect, item.ref).length > 0),
      );
      if (lands) {
        moved.add(item);
        grew = true;
      }
    }
    // A frame that came along started higher than its cards: everything moves far enough for it.
    const needed = Math.ceil(
      Math.max(...[...moved].filter(({ rect }) => beside(rect)).map(({ rect }) => clear(rect)), by),
    );
    if (needed > by) {
      by = needed;
      grew = true;
    }
  }
  return { by, moved: [...moved] };
}

/**
 * What a section grown from `from` to `grown` pushes down, and by how much: the items it now
 * covers move below it with Tidy's gap, then whatever they would land on, and whatever sits in a
 * section that moves. All move by the same amount, so what is pushed keeps its own layout.
 */
export function boardPushedBelow(
  from: BoardRect,
  grown: BoardRect,
  items: ReadonlyArray<BoardPushItem>,
): { readonly dy: number; readonly refs: ReadonlyArray<string> } {
  const covered = items.filter(({ rect }) => rectsMeet(rect, grown) && !rectsMeet(rect, from));
  const { by, moved } = boardPushedPast(grown, covered, items, false);
  // Each once, however often it was drawn, so nothing moves twice.
  return { dy: by, refs: [...new Set(moved.map(({ ref }) => ref))] };
}

/**
 * Room for a card of `size` right of `rect`, a card gap away and level with its top: where it
 * goes, and what it would cover pushed right as `boardPushedBelow` pushes down. A section `rect`
 * sits in stays. Null when something `fixed` would have to move: the card goes elsewhere then.
 */
export function boardRoomBeside(
  rect: BoardRect,
  size: RoomBoardSize,
  items: ReadonlyArray<BoardPushItem & { readonly fixed?: boolean }>,
): { readonly at: BoardPoint; readonly dx: number; readonly refs: ReadonlyArray<string> } | null {
  const at = { x: Math.round(rect.x + rect.width + CARD_GAP), y: Math.round(rect.y) };
  const wanted = { ...at, width: size.w, height: size.h };
  const others = items.filter(
    (item) =>
      item.section !== true ||
      boardItemsCentredIn([{ ref: "", rect }], item.rect, item.ref).length === 0,
  );
  const covered = others.filter((item) => item.section !== true && rectsMeet(item.rect, wanted));
  const { by, moved } = boardPushedPast(wanted, covered, others, true);
  if (moved.some((item) => item.fixed === true)) return null;
  return { at, dx: by, refs: [...new Set(moved.map(({ ref }) => ref))] };
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
 * Where the selection's bar goes, in board screen pixels: centred above the cards, else below,
 * else beside them (right, then left), else docked at the board's bottom, as near the middle as it
 * goes without covering a selected card (`cards`), or in the middle when nowhere is clear; always
 * clear of the chrome floating over the board (`cover`, how far it reaches in from each edge).
 */
export function selectionBarSpot(
  selection: BoardRect,
  bar: BoardSize,
  board: BoardSize,
  cover: { readonly top: number; readonly bottom: number; readonly left?: number } = {
    top: 0,
    bottom: 0,
  },
  cards: ReadonlyArray<BoardRect> = [],
): { readonly left: number; readonly top: number } {
  const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max));
  const highest = cover.top + SELECTION_BAR_GAP;
  const lowest = Math.max(highest, board.height - cover.bottom - SELECTION_BAR_GAP - bar.height);
  const leftmost = (cover.left ?? 0) + SELECTION_BAR_GAP;
  const rightmost = Math.max(leftmost, board.width - SELECTION_BAR_GAP - bar.width);
  const centred = clamp(selection.x + selection.width / 2 - bar.width / 2, leftmost, rightmost);
  const above = selection.y - SELECTION_BAR_GAP - bar.height;
  if (above >= highest) return { left: centred, top: Math.min(above, lowest) };
  const below = selection.y + selection.height + SELECTION_BAR_GAP;
  if (below <= lowest) return { left: centred, top: below };
  const besideTop = clamp(selection.y, highest, lowest);
  const right = selection.x + selection.width + SELECTION_BAR_GAP;
  if (right <= rightmost) return { left: right, top: besideTop };
  const left = selection.x - SELECTION_BAR_GAP - bar.width;
  if (left >= leftmost) return { left, top: besideTop };
  const middle = clamp((board.width - bar.width) / 2, leftmost, rightmost);
  const blocked = cards
    .filter((card) => card.y < lowest + bar.height && card.y + card.height > lowest)
    .map((card) => ({
      from: card.x - SELECTION_BAR_GAP - bar.width,
      to: card.x + card.width + SELECTION_BAR_GAP,
    }));
  const clear = (at: number) =>
    at >= leftmost && at <= rightmost && blocked.every(({ from, to }) => at <= from || at >= to);
  const dock = [middle, ...blocked.flatMap(({ from, to }) => [from, to])]
    .filter(clear)
    .reduce<number | undefined>(
      (best, at) =>
        best === undefined || Math.abs(at - middle) < Math.abs(best - middle) ? at : best,
      undefined,
    );
  return { left: dock ?? middle, top: lowest };
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

/**
 * The cards a section's deleting could take with it: those over the sections going (`over`, by
 * ref), but what goes anyway and what is not this viewer's to delete.
 */
export const boardSectionCardsToDelete = (
  board: RoomBoard,
  noteIds: ReadonlyArray<string>,
  over: Iterable<string>,
  viewer: string | null,
): ReadonlyArray<string> =>
  boardSelectionRemoval(board, new Set(over), viewer).noteIds.filter((id) => !noteIds.includes(id));

/**
 * Whether undo can put a deleted card back as it was. A thread box, code window or pull request
 * window is tied to a machine, and what the owner's server wrote into a card cannot be sent again,
 * so those are gone once deleted. The board keeps a removed comment thread, replies and all.
 */
export const boardNoteRestorable = (note: RoomBoardNote) =>
  note.kind === "comment" ||
  (note.kind !== "thread" &&
    note.kind !== "code" &&
    note.kind !== "pull-request" &&
    !hasServerContent(note));

/**
 * The comment threads on these cards, which go with them when they are deleted: each with a line
 * to or from one, or whose pin sits on one. `drawnHeight` is a card's height as drawn, where its
 * text decides it. A section holds cards, not the comments over it.
 */
export function boardCommentsOn(
  board: RoomBoard,
  noteIds: ReadonlyArray<string>,
  drawnHeight: (noteId: string) => number | undefined = () => undefined,
): ReadonlyArray<string> {
  const going = new Set(noteIds);
  const cards = board.notes.filter(
    (note) => going.has(note.id) && note.kind !== "comment" && note.section !== true,
  );
  const refs = new Set(cards.map((note) => roomBoardNoteRef(note.id)));
  const boxes = cards.map((note) => boardNoteBox(note, 1, drawnHeight(note.id)));
  const lined = (ref: string) =>
    (board.edges ?? []).some(
      (edge) =>
        (edge.from === ref && refs.has(edge.to)) || (edge.to === ref && refs.has(edge.from)),
    );
  const middle = BOARD_PIN_SIZE / 2;
  const pinnedOn = (note: RoomBoardNote) =>
    note.pinnedTo === undefined &&
    boxes.some(
      (box) =>
        note.x + middle >= box.x &&
        note.x + middle <= box.x + box.width &&
        note.y + middle >= box.y &&
        note.y + middle <= box.y + box.height,
    );
  return board.notes
    .filter(
      (note) =>
        note.kind === "comment" &&
        !going.has(note.id) &&
        (lined(roomBoardNoteRef(note.id)) || pinnedOn(note)),
    )
    .map((note) => note.id);
}

/**
 * What deleting these notes sends: first the lines on the ones undo can bring back, so one undo
 * draws them again, then the notes. Lines on the rest go with them on the server. `undoable` is
 * false when any of them cannot come back, which is worth a confirm.
 */
export function boardDeletion(
  board: RoomBoard,
  noteIds: ReadonlyArray<string>,
): { readonly edgeIds: ReadonlyArray<string>; readonly undoable: boolean } {
  const notes = board.notes.filter((note) => noteIds.includes(note.id));
  const lost = new Set(
    notes.filter((note) => !boardNoteRestorable(note)).map((note) => roomBoardNoteRef(note.id)),
  );
  const kept = new Set(
    notes.filter((note) => boardNoteRestorable(note)).map((note) => roomBoardNoteRef(note.id)),
  );
  const edgeIds = (board.edges ?? [])
    .filter(
      (edge) =>
        (kept.has(edge.from) || kept.has(edge.to)) && !lost.has(edge.from) && !lost.has(edge.to),
    )
    .map((edge) => edge.id);
  return { edgeIds, undoable: lost.size === 0 };
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

// A colour cannot be cleared, so going back to none is going back to the one it starts with:
// yellow for a note, grey for a section.
const withColorOf = (value: BoardValue, other: BoardValue): BoardValue =>
  value !== null &&
  other !== null &&
  "text" in value &&
  "text" in other &&
  value.color === undefined &&
  other.color !== undefined
    ? { ...value, color: value.section === true ? "grey" : "yellow" }
    : value;

// What only the owner's server writes into a card: taking back adding it would lose it.
const hasServerContent = (value: BoardValue) =>
  value !== null &&
  "text" in value &&
  [
    value.artifact,
    value.thread,
    value.changes,
    value.pullRequest,
    value.answer,
    value.replies,
  ].some((field) => field !== undefined);

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
    // An undo that took a first colour off left yellow, which redo has to know as its start.
    if (valueKey(now) !== valueKey(from) && valueKey(now) !== valueKey(withColorOf(from, to))) {
      return null;
    }
    // The board keeps a removed comment thread, so deleting it again loses nothing.
    const commentThread = now !== null && "text" in now && now.kind === "comment";
    if (to === null && hasServerContent(now) && !commentThread) return null;
    changes.push({ target, value: withColorOf(to, from) });
  }
  return changes;
}

/**
 * `entry` with what goes with the cards an undo or redo of it takes off, as deleting them takes
 * it: this viewer's comment threads on them and the lines undo can draw again. They join the
 * entry as they are now, so the same step put the other way brings them back.
 */
export function boardEntryWithAttached(
  board: RoomBoard,
  entry: BoardHistoryEntry,
  direction: "undo" | "redo",
  viewer: string | null,
  drawnHeight?: (noteId: string) => number | undefined,
): BoardHistoryEntry {
  const going = entry.flatMap(({ target, before, after }) => {
    const [from, to] = direction === "undo" ? [after, before] : [before, after];
    return target.kind === "note" && from !== null && to === null ? [target.id] : [];
  });
  if (going.length === 0) return entry;
  const inEntry = new Set(entry.map(({ target }) => boardEditKey(target)));
  const comments = boardCommentsOn(board, going, drawnHeight).filter((id) => {
    const comment = board.notes.find((note) => note.id === id);
    return (
      comment !== undefined &&
      isRoomCardOwnedBy(comment, viewer) &&
      !inEntry.has(boardEditKey({ kind: "note", id }))
    );
  });
  const lines = boardDeletion(board, [...going, ...comments]).edgeIds.filter(
    (id) => !inEntry.has(boardEditKey({ kind: "edge", id })),
  );
  const targets: ReadonlyArray<BoardTarget> = [
    ...comments.map((id) => ({ kind: "note", id }) as const),
    ...lines.map((id) => ({ kind: "edge", id }) as const),
  ];
  if (targets.length === 0) return entry;
  const now = targets.map((target) => ({ target, value: boardValueOf(board, target) }));
  // Taken back, they were added with the cards: lines last, so they go first. Made again, they
  // are deleted with them: lines first, as a delete sends them.
  return direction === "undo"
    ? [...entry, ...now.map(({ target, value }) => ({ target, before: null, after: value }))]
    : [
        ...now.toReversed().map(({ target, value }) => ({ target, before: value, after: null })),
        ...entry,
      ];
}

/**
 * The queues each change of an undo or redo waits in, undefined for its own: a line drawn again
 * waits until every card it joins that the same step puts back is there, so a line between two
 * cards deleted together comes back with them.
 */
export function boardHistoryQueues(
  changes: ReadonlyArray<{ readonly target: BoardTarget; readonly value: BoardValue }>,
): ReadonlyArray<ReadonlyArray<string> | undefined> {
  const restored = new Set(
    changes.flatMap(({ target, value }) =>
      target.kind === "note" && value !== null ? [boardEditKey(target)] : [],
    ),
  );
  return changes.map(({ value }) => {
    if (value === null || !("from" in value)) return undefined;
    const waits = [value.to, value.from].filter((ref) => restored.has(ref));
    return waits.length === 0 ? undefined : waits;
  });
}

/**
 * What a card was before this person's change, for undo to put back, at whole pixels: as their
 * gesture found it (null for a card the gesture made, as an Alt-drag copy), else as `board` shows.
 */
export const boardStepBefore = (
  gestureFrom: ReadonlyMap<string, BoardValue>,
  board: RoomBoard,
  target: BoardTarget,
): BoardValue => {
  const key = boardEditKey(target);
  return settleBoardValue(
    gestureFrom.has(key) ? (gestureFrom.get(key) ?? null) : boardValueOf(board, target),
  );
};

/** The history with one more entry, the oldest dropped past the cap. */
export const boardHistoryWith = <Entry>(
  history: ReadonlyArray<Entry>,
  entry: Entry,
): ReadonlyArray<Entry> => [...history, entry].slice(-BOARD_HISTORY_MAX);

/**
 * One step of this viewer's undo or redo: their own change, or an agent's turn they took back or
 * did again. `seen` is when the newest agent turn the board had then last changed it.
 */
export type BoardHistoryItem =
  | { readonly steps: BoardHistoryEntry; readonly seen: string }
  | { readonly turnId: string; readonly seen: string };

/**
 * The undo history with this viewer's newest change. The first text typed into a card they just
 * added joins the adding, so one undo takes the new card off instead of first emptying it.
 */
export function boardHistoryRemember(
  history: ReadonlyArray<BoardHistoryItem>,
  item: { readonly steps: BoardHistoryEntry; readonly seen: string },
): ReadonlyArray<BoardHistoryItem> {
  const last = history.at(-1);
  const added = last !== undefined && "steps" in last && last.steps.length === 1 && last.steps[0];
  const typed = item.steps.length === 1 && item.steps[0];
  if (
    added &&
    typed &&
    added.before === null &&
    boardEditKey(added.target) === boardEditKey(typed.target) &&
    valueKey(added.after) === valueKey(typed.before) &&
    typed.before !== null &&
    typed.after !== null &&
    "text" in typed.before &&
    typed.before.text === "" &&
    "text" in typed.after &&
    valueKey({ ...typed.before, text: typed.after.text }) === valueKey(typed.after)
  ) {
    const steps = [{ target: added.target, before: null, after: typed.after }];
    return [...history.slice(0, -1), { steps, seen: item.seen }];
  }
  return boardHistoryWith(history, item);
}

/** When an agent's turn last changed the board, or "" when none has. */
export const boardAgentTurnsSeen = (board: RoomBoard): string =>
  (board.agentTurns ?? []).reduce((newest, turn) => (turn.at > newest ? turn.at : newest), "");

/**
 * The agent turn Undo takes back before this viewer's own last step: the newest one they may undo,
 * when it changed the board after that step.
 */
export function boardAgentTurnToUndo(
  board: RoomBoard,
  viewer: GuestId | null,
  last: BoardHistoryItem | undefined,
): RoomBoardAgentTurn | undefined {
  const turn = (board.agentTurns ?? []).findLast(
    (candidate) => candidate.undone !== true && canUndoRoomAgentTurn(candidate, viewer),
  );
  return turn !== undefined && (last === undefined || turn.at > last.seen) ? turn : undefined;
}

const counted = (count: number, one: string, many: string) =>
  `${count} ${count === 1 ? one : many}`;
const listed = (parts: ReadonlyArray<string>) =>
  parts.length < 2 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

/** What an agent's turn did to the board, as one line: "Added 4 tasks and 1 section". */
export function boardAgentTurnLine(turn: RoomBoardAgentTurn): string {
  const added = turn.cards.filter((card) => card.before === undefined);
  const tasks = added.filter((card) => card.after.kind === "task").length;
  const sections = added.filter((card) => card.after.section === true).length;
  const notes = added.length - tasks - sections;
  // Only moved or resized: what it says and plans is as the turn found it.
  const arranged = turn.cards.filter(
    ({ before, after }) =>
      before !== undefined &&
      before.text === after.text &&
      (before.done === true) === (after.done === true) &&
      before.status === after.status &&
      before.due === after.due &&
      before.priority === after.priority &&
      (before.assignee === undefined) === (after.assignee === undefined) &&
      before.assignee?.guestId === after.assignee?.guestId,
  ).length;
  const changed = turn.cards.length - added.length - arranged;
  const lines = turn.edges?.length ?? 0;
  const adds = [
    tasks === 0 ? "" : counted(tasks, "task", "tasks"),
    notes === 0 ? "" : counted(notes, "note", "notes"),
    sections === 0 ? "" : counted(sections, "section", "sections"),
  ].filter((part) => part !== "");
  const line = [
    adds.length === 0 ? "" : `added ${listed(adds)}`,
    changed === 0 ? "" : `changed ${counted(changed, "card", "cards")}`,
    arranged === 0 ? "" : `arranged ${counted(arranged, "card", "cards")}`,
    lines === 0 ? "" : `drew ${counted(lines, "line", "lines")}`,
  ]
    .filter((part) => part !== "")
    .join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

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

const NOTE_CASCADE = 24;
const NOTE_CASCADE_MAX = 40;

/**
 * Where a toolbar note or task goes: the clear spot nearest the centre of the view, near it first,
 * else anywhere in view, else with `offView` (a phone, where a thread box can fill the screen) just
 * out of view for it to pan to, else on the centre, stepped down and right past any card there.
 */
export function boardCentreSpot(
  size: RoomBoardSize,
  taken: ReadonlyArray<BoardRect>,
  view: BoardRect,
  offView = false,
): BoardPoint {
  const middle = { x: view.x + view.width / 2, y: view.y + view.height / 2 };
  const left = Math.max(view.x, middle.x - size.w * 1.5);
  const top = Math.max(view.y, middle.y - size.h * 1.5);
  const near = {
    x: left,
    y: top,
    width: Math.min(view.x + view.width, middle.x + size.w * 1.5) - left,
    height: Math.min(view.y + view.height, middle.y + size.h * 1.5) - top,
  };
  const clear =
    near.width >= size.w + PLACE_GAP * 2 && near.height >= size.h + PLACE_GAP * 2
      ? searchBoardSpot(size, middle, taken, near)
      : null;
  if (clear !== null && clear.cover === 0) return clear.at;
  // A big card on the middle, as a thread box on a phone, sends it to the nearest clear spot in view.
  const inView =
    view.width >= size.w + PLACE_GAP * 2 && view.height >= size.h + PLACE_GAP * 2
      ? searchBoardSpot(size, middle, taken, view)
      : null;
  if (inView !== null && inView.cover === 0) return inView.at;
  const nearby = offView ? searchBoardSpot(size, middle, taken, undefined) : null;
  if (nearby !== null && nearby.cover === 0) return nearby.at;
  const start = { x: Math.round(middle.x - size.w / 2), y: Math.round(middle.y - size.h / 2) };
  for (let step = 0; step < NOTE_CASCADE_MAX; step += 1) {
    const at = { x: start.x + step * NOTE_CASCADE, y: start.y + step * NOTE_CASCADE };
    const sitting = taken.some(
      (rect) =>
        Math.abs(rect.x - at.x) < NOTE_CASCADE / 2 && Math.abs(rect.y - at.y) < NOTE_CASCADE / 2,
    );
    if (!sitting) return at;
  }
  return start;
}

/** How long a finger rests on a card, still, before it picks the card up instead of panning. */
export const BOARD_TOUCH_HOLD_MS = 350;
/** How far a resting finger may drift and still be resting, in screen pixels. */
export const BOARD_TOUCH_SLOP = 8;

/**
 * What one finger pressed on the board is doing so far: still resting (`wait`), moving before it
 * rested long enough (`pan`: the board pans, even from a card), or resting long enough (`hold`: the
 * card under it is picked up, or the board's menu opens if it lets go without moving).
 */
export function boardTouchPress(heldMs: number, distance: number): "wait" | "pan" | "hold" {
  if (heldMs >= BOARD_TOUCH_HOLD_MS) return "hold";
  return distance >= BOARD_TOUCH_SLOP ? "pan" : "wait";
}

const TOUCH_CONTROL_MAX_SCALE = 4;

/**
 * How much a selected card's touch controls are scaled so they stay finger-sized as the board
 * zooms out: not at all at full size or more, inversely to the zoom below it, at most 4 times.
 */
export const boardTouchScale = (zoom: number): number =>
  Math.min(TOUCH_CONTROL_MAX_SCALE, Math.max(1, 1 / zoom));

/** About how much of a phone's screen, from the top, its keyboard leaves in sight. */
const KEYBOARD_FREE_SHARE = 0.5;

/**
 * Where on a phone's board a new note goes so the keyboard opening for it leaves it in sight:
 * below the header floating over the board, and in the top half of the surface.
 */
export function boardTypingRect(
  view: BoardView,
  area: BoardSize,
  covered: { readonly top: number; readonly bottom: number },
): BoardRect {
  const bottom = Math.min(area.height - covered.bottom, area.height * KEYBOARD_FREE_SHARE);
  const height = Math.max(bottom - covered.top, area.height * 0.25);
  return {
    ...screenToBoard(view, { x: 0, y: covered.top }),
    width: area.width / view.zoom,
    height: height / view.zoom,
  };
}

/** An entry of the board's right-click menu, beside a card's own actions. */
export type BoardMenuEntry =
  | "add-note"
  | "add-task"
  | "add-section"
  | "add-thread"
  | "add-artifact"
  | "add-link"
  | "edit"
  | "connect"
  | "paste"
  | "select-all"
  | "fit"
  | "duplicate"
  | "copy"
  | "copy-link"
  | "start-here"
  | "tidy"
  | "sort-votes"
  | "vote"
  | "group"
  | "delete";

/**
 * What the right-click menu is for: the board itself, one card, a card that is not a note (the
 * room thread's card, a person's or an agent's), or a selection of several.
 */
export type BoardMenuOn =
  | { readonly kind: "canvas" }
  | { readonly kind: "card"; readonly note: RoomBoardNote }
  | { readonly kind: "fixed-card" }
  | {
      readonly kind: "selection";
      readonly notes: ReadonlyArray<RoomBoardNote>;
      readonly count: number;
    };

/** What this viewer may do on this board, as the toolbar and selection bar already decide it. */
export interface BoardMenuRights {
  readonly viewer: GuestId | null;
  readonly canEdit: boolean;
  /** A room's own board, with sections, thread boxes and artifacts; a team's board has none. */
  readonly roomBoard: boolean;
  readonly canAdd: boolean;
  readonly canAddThread: boolean;
  readonly canAddArtifact: boolean;
  /** The browser lets the page read the clipboard without asking. */
  readonly canPaste: boolean;
  /** The viewer says where new visitors start: the room's owner, or a cloud board's maker. */
  readonly marksStart?: boolean | undefined;
}

/**
 * The board's own entries of its right-click menu. A card's actions (react, colour, use, give,
 * delete) come from its "…" menu and go first; these never repeat them.
 */
export function boardMenuEntries(
  on: BoardMenuOn,
  rights: BoardMenuRights,
): ReadonlyArray<BoardMenuEntry> {
  const entries: Array<BoardMenuEntry> = [];
  const add = (entry: BoardMenuEntry, when: boolean) => {
    if (when) entries.push(entry);
  };
  if (on.kind === "canvas") {
    add("add-note", rights.canAdd);
    add("add-task", rights.canAdd);
    add("add-section", rights.canAdd && rights.roomBoard);
    add("add-link", rights.canAdd);
    add("add-thread", rights.canAddThread && rights.roomBoard);
    add("add-artifact", rights.canAddArtifact && rights.roomBoard);
    add("paste", rights.canEdit && rights.canPaste);
    add("select-all", rights.canEdit);
    add("fit", true);
    return entries;
  }
  // Never copied or deleted, and never the board's: only its own actions.
  if (on.kind === "fixed-card") return entries;
  const notes = on.kind === "card" ? [on.note] : on.notes;
  const copies =
    rights.canEdit &&
    rights.roomBoard &&
    boardDuplicates(notes, rights.viewer, () => "").length > 0;
  if (on.kind === "card") {
    // Notes, tasks and sections have words anyone who may change the board can edit.
    add(
      "edit",
      rights.canEdit &&
        (on.note.section === true || on.note.kind === undefined || on.note.kind === "task") &&
        on.note.pinnedTo === undefined,
    );
    add("connect", rights.canEdit && on.note.kind !== "comment");
  }
  add("duplicate", copies);
  add("copy", copies);
  if (on.kind === "card") {
    add("copy-link", on.note.url !== undefined);
    add("start-here", rights.marksStart === true && on.note.kind !== "comment");
    return entries;
  }
  add("tidy", rights.canEdit && on.count > 1);
  // Votes are reactions, which only a room's board takes.
  add("sort-votes", rights.canEdit && rights.roomBoard && on.count > 1);
  add("vote", rights.canEdit && rights.roomBoard && notes.some(boardVotable));
  add("group", rights.canAdd && rights.roomBoard);
  add("delete", rights.canEdit && notes.some((note) => isRoomCardOwnedBy(note, rights.viewer)));
  return entries;
}

/** Whether a key pressed on the board, with one note selected and not being edited, edits it. */
export const boardKeyEditsNote = (event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
}): boolean =>
  !event.ctrlKey &&
  !event.metaKey &&
  !event.altKey &&
  (event.key === "Enter" || (event.key.length === 1 && event.key !== " "));

const NEXT_NOTE_GAP = 24;

/**
 * Where the note after `from` goes, as FigJam puts the next sticky: just to its right, top edges
 * level, else just below it, left edges level, else the first clear spot scanning right along its
 * row and then down row by row. Never above it or left of it, and never over another card.
 */
export function boardNextNoteSpot(
  from: BoardRect,
  size: RoomBoardSize,
  taken: ReadonlyArray<BoardRect>,
): BoardPoint {
  const blocking = [from, ...taken];
  const clear = (at: BoardPoint) =>
    !blocking.some(
      (rect) =>
        at.x < rect.x + rect.width + PLACE_GAP &&
        at.x + size.w + PLACE_GAP > rect.x &&
        at.y < rect.y + rect.height + PLACE_GAP &&
        at.y + size.h + PLACE_GAP > rect.y,
    );
  const right = { x: Math.round(from.x + from.width + NEXT_NOTE_GAP), y: Math.round(from.y) };
  if (clear(right)) return right;
  const below = { x: Math.round(from.x), y: Math.round(from.y + from.height + NEXT_NOTE_GAP) };
  if (clear(below)) return below;
  for (let dy = 0; dy <= PLACE_REACH; dy += PLACE_GAP) {
    for (let dx = 0; dx <= PLACE_REACH; dx += PLACE_GAP) {
      const at = { x: Math.round(from.x + dx), y: Math.round(from.y + dy) };
      if (clear(at)) return at;
    }
  }
  // Below everything, which nothing can cover.
  const lowest = Math.max(...blocking.map((rect) => rect.y + rect.height));
  return { x: Math.round(from.x), y: Math.round(lowest + NEXT_NOTE_GAP) };
}
