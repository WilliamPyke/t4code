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

export const BOARD_MIN_ZOOM = 0.4;
export const BOARD_MAX_ZOOM = 2;
export const INITIAL_BOARD_VIEW: BoardView = { x: 0, y: 0, zoom: 1 };

export const BOARD_CARD_WIDTH = 320;
const CARD_ROW_HEIGHT = 240;
const CARD_GAP = 40;
const BOARD_ORIGIN: BoardPoint = { x: 80, y: 72 };
const NOTE_LIMIT = 50;
export const BOARD_NOTE_MAX_LENGTH = 280;

export const BoardNote = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  x: Schema.Number,
  y: Schema.Number,
});
export type BoardNote = typeof BoardNote.Type;

/** What one person arranged on a thread's board. Kept on their device. */
export const BoardLayout = Schema.Struct({
  positions: Schema.Record(Schema.String, Schema.Struct({ x: Schema.Number, y: Schema.Number })),
  notes: Schema.Array(BoardNote),
});
export type BoardLayout = typeof BoardLayout.Type;

export const EMPTY_BOARD_LAYOUT: BoardLayout = { positions: {}, notes: [] };

const decodeLayout = Schema.decodeUnknownOption(Schema.fromJsonString(BoardLayout));
const encodeLayout = Schema.encodeSync(Schema.fromJsonString(BoardLayout));

export const boardLayoutStorageKey = (threadKey: string) => `t3:room-board:${threadKey}`;

/** A stored layout, or an empty one when nothing usable is stored. */
export function parseBoardLayout(stored: string | null): BoardLayout {
  if (stored === null) return EMPTY_BOARD_LAYOUT;
  const layout = decodeLayout(stored);
  return layout._tag === "Some" ? layout.value : EMPTY_BOARD_LAYOUT;
}

export const serializeBoardLayout = (layout: BoardLayout): string => encodeLayout(layout);

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
  saved: BoardLayout["positions"],
  columns = 3,
): Record<string, BoardPoint> {
  const stepX = BOARD_CARD_WIDTH + CARD_GAP;
  const stepY = CARD_ROW_HEIGHT + CARD_GAP;
  const slotOf = (point: BoardPoint) =>
    `${Math.round((point.x - BOARD_ORIGIN.x) / stepX)}:${Math.round((point.y - BOARD_ORIGIN.y) / stepY)}`;
  const taken = new Set(
    cardIds.flatMap((id) => {
      const position = saved[id];
      return position === undefined ? [] : [slotOf(position)];
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
  }
  return placed;
}

/** A curve from the header of one card to the header of another, leaving and arriving level. */
export function boardConnectorPath(from: BoardPoint, to: BoardPoint): string {
  const headerY = 18;
  const leftToRight = from.x <= to.x;
  const start = { x: from.x + (leftToRight ? BOARD_CARD_WIDTH : 0), y: from.y + headerY };
  const end = { x: to.x + (leftToRight ? 0 : BOARD_CARD_WIDTH), y: to.y + headerY };
  const bend = Math.max(40, Math.abs(end.x - start.x) / 2) * (leftToRight ? 1 : -1);
  return `M${start.x} ${start.y} C${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

export const moveBoardCard = (layout: BoardLayout, id: string, to: BoardPoint): BoardLayout => ({
  ...layout,
  positions: { ...layout.positions, [id]: to },
});

export function addBoardNote(layout: BoardLayout, note: BoardNote): BoardLayout {
  return layout.notes.length >= NOTE_LIMIT ? layout : { ...layout, notes: [...layout.notes, note] };
}

export const updateBoardNote = (
  layout: BoardLayout,
  id: string,
  change: Partial<Pick<BoardNote, "text" | "x" | "y">>,
): BoardLayout => ({
  ...layout,
  notes: layout.notes.map((note) => (note.id === id ? { ...note, ...change } : note)),
});

export const removeBoardNote = (layout: BoardLayout, id: string): BoardLayout => ({
  ...layout,
  notes: layout.notes.filter((note) => note.id !== id),
});

export interface BoardMessage {
  readonly id: string;
  /** Who wrote it: null for the agent, "You" for the owner, a guest's name otherwise. */
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
const textOf = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** The newest messages of a thread, oldest first, for the thread's card. */
export function boardMessages(
  items: ReadonlyArray<MessageItem>,
  limit: number,
): ReadonlyArray<BoardMessage> {
  const messages: Array<BoardMessage> = [];
  for (const item of items.toReversed()) {
    if (messages.length === limit) break;
    if (item.type === "user_message") {
      const context = decodeGuestContext(item.context);
      const guest = context._tag === "Some" ? context.value.guest : undefined;
      const text = textOf(guest?.text ?? item.text);
      if (text !== "") messages.push({ id: item.id, author: guest?.name ?? "You", text });
    } else if (item.type === "assistant_message") {
      const text = textOf(item.text);
      if (text !== "") messages.push({ id: item.id, author: null, text });
    }
  }
  return messages.toReversed();
}
