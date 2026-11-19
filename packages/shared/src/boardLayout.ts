/** A card's place and size on a board, in board pixels. */
interface BoardLayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

interface BoardLayoutItem {
  readonly ref: string;
  readonly rect: BoardLayoutRect;
}

/** The gap Tidy leaves between cards, and what a section keeps around the cards it frames. */
export const BOARD_TIDY_GAP = 24;
export const BOARD_SECTION_PADDING = 32;
export const BOARD_SECTION_TITLE_HEIGHT = 40;

/** Items in reading order: rows by their tops, then left to right. */
export function boardReadingOrder<T extends { readonly rect: BoardLayoutRect }>(
  items: ReadonlyArray<T>,
): ReadonlyArray<T> {
  const rows: Array<Array<T>> = [];
  let rowEnd = -Infinity;
  for (const item of [...items].sort((left, right) => left.rect.y - right.rect.y)) {
    const row = rows.at(-1);
    if (row === undefined || item.rect.y >= rowEnd) {
      rows.push([item]);
      rowEnd = item.rect.y + item.rect.height / 2;
    } else row.push(item);
  }
  return rows.flatMap((row) => row.sort((left, right) => left.rect.x - right.rect.x));
}

/** Tidy's grid: columns as wide as the widest item, rows as tall as their tallest, even gaps. */
export function boardGrid(ordered: ReadonlyArray<BoardLayoutItem>, columns: number) {
  const cell = Math.max(0, ...ordered.map(({ rect }) => rect.width));
  const heights: Array<number> = [];
  ordered.forEach(({ rect }, index) => {
    const row = Math.floor(index / columns);
    heights[row] = Math.max(heights[row] ?? 0, rect.height);
  });
  const used = Math.min(columns, ordered.length);
  return {
    width: used * cell + Math.max(0, used - 1) * BOARD_TIDY_GAP,
    height:
      heights.reduce((sum, rowHeight) => sum + rowHeight, 0) +
      Math.max(0, heights.length - 1) * BOARD_TIDY_GAP,
    at: (origin: { readonly x: number; readonly y: number }) =>
      ordered.map(({ ref }, index) => {
        const row = Math.floor(index / columns);
        return {
          ref,
          x: Math.round(origin.x + (index % columns) * (cell + BOARD_TIDY_GAP)),
          y: Math.round(
            origin.y +
              heights.slice(0, row).reduce((sum, rowHeight) => sum + rowHeight, 0) +
              row * BOARD_TIDY_GAP,
          ),
        };
      }),
  };
}

/** How many of Tidy's columns fit a section this wide, for these items: at least one. */
export function boardSectionColumns(
  ordered: ReadonlyArray<BoardLayoutItem>,
  sectionWidth: number,
): number {
  const cell = Math.max(0, ...ordered.map(({ rect }) => rect.width));
  const fit = Math.floor(
    (sectionWidth - BOARD_SECTION_PADDING * 2 + BOARD_TIDY_GAP) / (cell + BOARD_TIDY_GAP),
  );
  return Math.max(1, Math.min(ordered.length, fit));
}

/** The frame a section takes around these rects, with room for its title, or null for none. */
export function boardFrameAround(rects: ReadonlyArray<BoardLayoutRect>): BoardLayoutRect | null {
  if (rects.length === 0) return null;
  const left = Math.min(...rects.map((rect) => rect.x));
  const top = Math.min(...rects.map((rect) => rect.y));
  const right = Math.max(...rects.map((rect) => rect.x + rect.width));
  const bottom = Math.max(...rects.map((rect) => rect.y + rect.height));
  return {
    x: Math.round(left - BOARD_SECTION_PADDING),
    y: Math.round(top - BOARD_SECTION_PADDING - BOARD_SECTION_TITLE_HEIGHT),
    width: right - left + BOARD_SECTION_PADDING * 2,
    height: bottom - top + BOARD_SECTION_PADDING * 2 + BOARD_SECTION_TITLE_HEIGHT,
  };
}
