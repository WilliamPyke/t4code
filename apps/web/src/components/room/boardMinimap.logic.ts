import type { RoomBoard, RoomBoardNoteColor } from "@t3tools/contracts";

import {
  type BoardPoint,
  type BoardRect,
  type BoardSize,
  type BoardView,
  boardBounds,
  boardItemRects,
  placeBoardCards,
} from "./roomBoard.logic";

/** How the minimap draws something: a section's faint tint, a window, or a sticky's paint. */
export interface MinimapItem extends BoardRect {
  readonly id: string;
  readonly tone: "section" | "window" | "paint";
  readonly color?: RoomBoardNoteColor | undefined;
}

/**
 * What the minimap draws, sections first so cards sit over them. Comment pins are left out: they
 * are smaller than a pixel there.
 */
export function minimapItems(
  board: Pick<RoomBoard, "positions" | "sizes" | "notes">,
  cardIds: ReadonlyArray<string>,
): ReadonlyArray<MinimapItem> {
  const sizes = board.sizes === undefined ? {} : { sizes: board.sizes };
  const placed = placeBoardCards(cardIds, board.positions, undefined, board.sizes);
  const cards = cardIds.flatMap((id): ReadonlyArray<MinimapItem> => {
    const at = placed[id];
    if (at === undefined) return [];
    const [rect] = boardItemRects({ positions: { [id]: at }, notes: [], ...sizes }, []);
    return rect === undefined ? [] : [{ ...rect, id: `card:${id}`, tone: "window" }];
  });
  const notes = board.notes.filter((note) => note.kind !== "comment");
  const noteRects = boardItemRects({ positions: {}, notes }, []);
  const drawn = notes.map((note, index): MinimapItem => {
    const item = { ...noteRects[index]!, id: `note:${note.id}` };
    if (note.section === true) return { ...item, tone: "section", color: note.color };
    return note.kind === undefined
      ? { ...item, tone: "paint", color: note.color }
      : { ...item, tone: "window" };
  });
  return [
    ...drawn.filter((item) => item.tone === "section"),
    ...cards,
    ...drawn.filter((item) => item.tone !== "section"),
  ];
}

/** Where the board sits in the minimap: the part of it shown, and its scale to minimap pixels. */
export interface MinimapFrame {
  readonly world: BoardRect;
  readonly scale: number;
  /** Where the world's top-left corner lands, centring it in the minimap. */
  readonly offset: BoardPoint;
}

const MINIMAP_MARGIN = 0.06;

/**
 * Fits everything on the board and the part of it in view into the minimap, with a little room
 * around, so the view's rect is always somewhere on it.
 */
export function minimapFrame(
  content: BoardRect | null,
  viewport: BoardRect,
  size: BoardSize,
): MinimapFrame {
  const both = content === null ? viewport : boardBounds([content, viewport])!;
  const marginX = both.width * MINIMAP_MARGIN;
  const marginY = both.height * MINIMAP_MARGIN;
  const world = {
    x: both.x - marginX,
    y: both.y - marginY,
    width: Math.max(1, both.width + marginX * 2),
    height: Math.max(1, both.height + marginY * 2),
  };
  const scale = Math.min(size.width / world.width, size.height / world.height);
  return {
    world,
    scale,
    offset: {
      x: (size.width - world.width * scale) / 2,
      y: (size.height - world.height * scale) / 2,
    },
  };
}

export const boardToMinimap = (frame: MinimapFrame, point: BoardPoint): BoardPoint => ({
  x: frame.offset.x + (point.x - frame.world.x) * frame.scale,
  y: frame.offset.y + (point.y - frame.world.y) * frame.scale,
});

export const minimapToBoard = (frame: MinimapFrame, point: BoardPoint): BoardPoint => ({
  x: frame.world.x + (point.x - frame.offset.x) / frame.scale,
  y: frame.world.y + (point.y - frame.offset.y) / frame.scale,
});

export const minimapRect = (frame: MinimapFrame, rect: BoardRect): BoardRect => ({
  ...boardToMinimap(frame, rect),
  width: rect.width * frame.scale,
  height: rect.height * frame.scale,
});

/** The view at the same zoom with this board point in the middle of the board's area. */
export const boardViewCentredOn = (
  view: BoardView,
  area: BoardSize,
  point: BoardPoint,
): BoardView => ({
  zoom: view.zoom,
  x: area.width / 2 - point.x * view.zoom,
  y: area.height / 2 - point.y * view.zoom,
});
