import {
  CLOUD_BOARD_PREVIEW_MAX_CHARS,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoard,
  type RoomBoardNoteColor,
  type RoomBoardSummaryShape,
} from "@t3tools/contracts";

import {
  ROOM_BOARD_CARD_SIZE,
  ROOM_THREAD_CARD_SIZE,
  roomBoardNoteSize,
} from "./roomBoardAgent.ts";

/**
 * A board's preview: where its cards are, how big, what kind and which paint, on a 100 by 100
 * grid, with none of their text. Small enough to keep beside every listing of the board. Each
 * card is ten characters: its kind, x, y, width and height as two digits each, and its paint.
 */
const VERSION = "1:";
const SHAPE_CHARS = 10;
const GRID = 99;
/** As many cards as a preview carries: the sections first, then cards, then notes. */
export const BOARD_PREVIEW_MAX_SHAPES = Math.floor(
  (CLOUD_BOARD_PREVIEW_MAX_CHARS - VERSION.length) / SHAPE_CHARS,
);

const KIND_CODES: Readonly<Record<RoomBoardSummaryShape["kind"], string>> = {
  note: "n",
  task: "t",
  link: "l",
  artifact: "a",
  thread: "h",
  comment: "c",
  code: "o",
  "pull-request": "p",
  section: "s",
  card: "k",
};
const COLOR_CODES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "y",
  green: "g",
  blue: "b",
  pink: "p",
  purple: "u",
  grey: "e",
};
const NO_COLOR = "-";

const invert = <K extends string>(codes: Readonly<Record<K, string>>) =>
  new Map(Object.entries<string>(codes).map(([key, code]) => [code, key as K]));
const KINDS = invert(KIND_CODES);
const COLORS = invert(COLOR_CODES);

/** The board's cards as a thumbnail draws them, sections first so they sit behind. */
function boardShapes(board: RoomBoard): ReadonlyArray<RoomBoardSummaryShape> {
  const notes = board.notes
    .filter((note) => note.pinnedTo === undefined)
    .map((note): RoomBoardSummaryShape => {
      const size = roomBoardNoteSize(note);
      return {
        x: note.x,
        y: note.y,
        w: size.w,
        h: size.h,
        kind: note.section === true ? "section" : (note.kind ?? "note"),
        ...(note.color === undefined ? {} : { color: note.color }),
      };
    });
  const cards = Object.entries(board.positions).map(([id, at]): RoomBoardSummaryShape => {
    const thread = id === ROOM_BOARD_THREAD_CARD;
    const size = board.sizes?.[id] ?? (thread ? ROOM_THREAD_CARD_SIZE : ROOM_BOARD_CARD_SIZE);
    return { x: at.x, y: at.y, w: size.w, h: size.h, kind: thread ? "thread" : "card" };
  });
  return [
    ...notes.filter((shape) => shape.kind === "section"),
    ...cards,
    ...notes.filter((shape) => shape.kind !== "section"),
  ];
}

const twoDigits = (value: number) =>
  String(Math.min(GRID, Math.max(0, Math.round(value)))).padStart(2, "0");

/**
 * The preview of a board, or an empty string for a board with nothing on it. Never longer than
 * `CLOUD_BOARD_PREVIEW_MAX_CHARS`, however big the board.
 */
export function encodeBoardPreview(board: RoomBoard | undefined): string {
  const shapes = board === undefined ? [] : boardShapes(board).slice(0, BOARD_PREVIEW_MAX_SHAPES);
  const finite = shapes.filter((shape) =>
    [shape.x, shape.y, shape.w, shape.h].every((value) => Number.isFinite(value)),
  );
  if (finite.length === 0) return "";
  const minX = Math.min(...finite.map((shape) => shape.x));
  const minY = Math.min(...finite.map((shape) => shape.y));
  const maxX = Math.max(...finite.map((shape) => shape.x + shape.w));
  const maxY = Math.max(...finite.map((shape) => shape.y + shape.h));
  // One scale for both directions, so a wide board stays wide.
  const scale = GRID / Math.max(maxX - minX, maxY - minY, 1);
  return (
    VERSION +
    finite
      .map(
        (shape) =>
          KIND_CODES[shape.kind] +
          twoDigits((shape.x - minX) * scale) +
          twoDigits((shape.y - minY) * scale) +
          twoDigits(Math.max(1, shape.w * scale)) +
          twoDigits(Math.max(1, shape.h * scale)) +
          (shape.color === undefined ? NO_COLOR : COLOR_CODES[shape.color]),
      )
      .join("")
  );
}

const SHAPE_PATTERN = /^([a-z])(\d\d)(\d\d)(\d\d)(\d\d)([a-z-])$/;

/** The cards a preview holds, in grid units. Anything it cannot read is left out. */
export function decodeBoardPreview(
  preview: string | null | undefined,
): ReadonlyArray<RoomBoardSummaryShape> {
  if (preview == null || !preview.startsWith(VERSION)) return [];
  const body = preview.slice(VERSION.length, CLOUD_BOARD_PREVIEW_MAX_CHARS);
  const shapes: Array<RoomBoardSummaryShape> = [];
  for (let at = 0; at + SHAPE_CHARS <= body.length; at += SHAPE_CHARS) {
    const match = SHAPE_PATTERN.exec(body.slice(at, at + SHAPE_CHARS));
    const kind = match === null ? undefined : KINDS.get(match[1]!);
    if (match === null || kind === undefined) continue;
    const color = COLORS.get(match[6]!);
    shapes.push({
      x: Number(match[2]),
      y: Number(match[3]),
      w: Number(match[4]),
      h: Number(match[5]),
      kind,
      ...(color === undefined ? {} : { color }),
    });
  }
  return shapes;
}
