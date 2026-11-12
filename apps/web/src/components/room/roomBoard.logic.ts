import {
  ROOM_BOARD_MAX_COORDINATE,
  type RoomAgentActivity,
  type RoomBoard,
  type RoomBoardChange,
  type RoomBoardNote,
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

export const BOARD_MIN_ZOOM = 0.4;
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

const NOTE_WIDTH = 192;
const NOTE_HEIGHT = 128;
const NOTE_GAP = 16;
const NOTE_COLUMNS = 3;
const NOTE_ROWS = 24;

/**
 * Where a new note goes: `wanted`, or the nearest spot right of or below it that covers no note
 * and no card. A card is taken to be as tall as a grid row, since its height is the browser's.
 */
export function placeBoardNote(
  wanted: BoardPoint,
  notes: ReadonlyArray<BoardPoint>,
  cards: ReadonlyArray<BoardPoint>,
): BoardPoint {
  const covers = (at: BoardPoint, other: BoardPoint, width: number, height: number) =>
    at.x < other.x + width &&
    other.x < at.x + NOTE_WIDTH &&
    at.y < other.y + height &&
    other.y < at.y + NOTE_HEIGHT;
  for (let slot = 0; slot < NOTE_COLUMNS * NOTE_ROWS; slot += 1) {
    const at = {
      x: wanted.x + (slot % NOTE_COLUMNS) * (NOTE_WIDTH + NOTE_GAP),
      y: wanted.y + Math.floor(slot / NOTE_COLUMNS) * (NOTE_HEIGHT + NOTE_GAP),
    };
    if (
      !notes.some((note) => covers(at, note, NOTE_WIDTH, NOTE_HEIGHT)) &&
      !cards.some((card) => covers(at, card, BOARD_CARD_WIDTH, CARD_ROW_HEIGHT))
    ) {
      return at;
    }
  }
  return wanted;
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

/** A card or a note on the board. */
export interface BoardTarget {
  readonly kind: "card" | "note";
  readonly id: string;
}

/** Where a card is, a note as it reads, or null for a note taken off the board. */
export type BoardValue = BoardPoint | RoomBoardNote | null;

/**
 * What this person did to one card or note, shown over the room's board so a drag does not
 * wait for the server.
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

export const boardEditKey = (target: BoardTarget) => `${target.kind}:${target.id}`;

const roomCopy = (board: RoomBoard, target: BoardTarget): BoardValue | undefined =>
  target.kind === "card"
    ? board.positions[target.id]
    : board.notes.find((note) => note.id === target.id);

const noteText = (value: BoardValue | undefined) =>
  value !== null && value !== undefined && "text" in value ? value.text : undefined;
const sameValue = (a: BoardValue | undefined, b: BoardValue | undefined) =>
  a?.x === b?.x && a?.y === b?.y && noteText(a) === noteText(b);

const shows = (board: RoomBoard, edit: BoardEdit) =>
  edit.held || sameValue(edit.base, roomCopy(board, edit.target));

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

/** The room's board with this person's own edits over it. */
export function resolveBoard(board: RoomBoard, edits: BoardEdits): RoomBoard {
  const positions = { ...board.positions };
  let notes = board.notes;
  for (const edit of Object.values(edits)) {
    if (!shows(board, edit)) continue;
    const { target, value } = edit;
    if (target.kind === "card") {
      if (value !== null) positions[target.id] = { x: value.x, y: value.y };
    } else if (value === null) {
      notes = notes.filter((note) => note.id !== target.id);
    } else if ("text" in value) {
      notes = notes.some((note) => note.id === target.id)
        ? notes.map((note) => (note.id === target.id ? value : note))
        : [...notes, value];
    }
  }
  return { positions, notes };
}

const coordinate = (value: number) =>
  Math.round(Math.min(ROOM_BOARD_MAX_COORDINATE, Math.max(-ROOM_BOARD_MAX_COORDINATE, value)));

/** The value at the whole pixels the room keeps, so the server's copy equals what was let go. */
export const settleBoardValue = <Value extends BoardValue>(value: Value): Value =>
  value === null ? value : { ...value, x: coordinate(value.x), y: coordinate(value.y) };

/** The change that makes the room's copy of a card or note this value. */
export function boardChangeOf(target: BoardTarget, value: BoardValue): RoomBoardChange {
  if (target.kind === "card") {
    return { type: "card.move", cardId: target.id, x: value?.x ?? 0, y: value?.y ?? 0 };
  }
  return value === null
    ? { type: "note.remove", noteId: target.id }
    : { type: "note.put", noteId: target.id, text: noteText(value) ?? "", x: value.x, y: value.y };
}

/** Where a pointer at `screen` is on the board, at the whole pixels the room takes. */
export const boardCursorAt = (view: BoardView, screen: BoardPoint): BoardPoint =>
  settleBoardValue(screenToBoard(view, screen));

const CURSOR_SEND_INTERVAL_MS = 80;

/**
 * Sends a pointer's position at most every `CURSOR_SEND_INTERVAL_MS`, always ending on the
 * latest, and nothing for a position already sent or a pointer that is not moving.
 */
export function cursorSender(send: (at: BoardPoint | null) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let next: BoardPoint | null = null;
  let sent: BoardPoint | null = null;
  let sentAt = Number.NEGATIVE_INFINITY;
  const flush = () => {
    timer = null;
    if (next === null || (next.x === sent?.x && next.y === sent.y)) return;
    sent = next;
    sentAt = Date.now();
    send(next);
  };
  return {
    move: (at: BoardPoint) => {
      next = at;
      if (timer !== null) return;
      timer = setTimeout(flush, Math.max(0, sentAt + CURSOR_SEND_INTERVAL_MS - Date.now()));
    },
    leave: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      next = null;
      if (sent === null) return;
      sent = null;
      send(null);
    },
  };
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

/** A note added to a composer's draft as a paragraph of its own. */
export function appendNoteToDraft(draft: string, note: string): string {
  const text = note.trim();
  if (text === "") return draft;
  return draft.trim() === "" ? text : `${draft.trimEnd()}\n\n${text}`;
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

/**
 * A message as a card shows it: one run of plain text, without code blocks, heading and list
 * marks, table rules or emphasis marks. A message that is only a code block keeps its text.
 */
function boardExcerpt(markdown: string): string {
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
  return text.length > EXCERPT_LENGTH ? `${text.slice(0, EXCERPT_LENGTH).trimEnd()}…` : text;
}

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
