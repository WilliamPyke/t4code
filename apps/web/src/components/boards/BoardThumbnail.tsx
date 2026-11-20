import type { RoomBoardSummaryShape } from "@t3tools/contracts";
import { useId } from "react";

import { cn } from "~/lib/utils";

import { boardThumbnail } from "./boardsHome.logic";

const WIDTH = 240;
const PADDING = 10;
// 16:9 in pickers, the boards home's 16:10 tiles, and the wide strip of its template row.
const HEIGHTS = { video: 135, tile: 150, strip: 116 } as const;
const RATIO_CLASS = {
  video: "aspect-video",
  tile: "aspect-[16/10]",
  strip: "aspect-[240/116]",
} as const;

// The board's own look in miniature: notes in their paints, windows as small cards, all from the
// board's tokens so every theme reads well.
const NOTE_FILL: Readonly<Record<NonNullable<RoomBoardSummaryShape["color"]>, string>> = {
  yellow: "fill-paint-yellow",
  green: "fill-paint-green",
  blue: "fill-paint-blue",
  pink: "fill-paint-pink",
  purple: "fill-paint-purple",
  grey: "fill-paint-grey",
};
// A section's background as the board tints it; grey is a section with none.
const SECTION_FILL: Readonly<Record<NonNullable<RoomBoardSummaryShape["color"]>, string>> = {
  yellow: "fill-paint-yellow-deep/12 stroke-paint-yellow-deep/55",
  green: "fill-paint-green-deep/12 stroke-paint-green-deep/55",
  blue: "fill-paint-blue-deep/12 stroke-paint-blue-deep/55",
  pink: "fill-paint-pink-deep/12 stroke-paint-pink-deep/55",
  purple: "fill-paint-purple-deep/12 stroke-paint-purple-deep/55",
  grey: "fill-paint-grey-deep/4 stroke-paint-grey-deep/45",
};
const WINDOW_FILL = "fill-card stroke-board-hairline";
const KIND_FILL: Readonly<Record<RoomBoardSummaryShape["kind"], string>> = {
  note: NOTE_FILL.yellow,
  task: NOTE_FILL.green,
  link: WINDOW_FILL,
  artifact: WINDOW_FILL,
  thread: WINDOW_FILL,
  comment: "fill-primary",
  code: WINDOW_FILL,
  "pull-request": WINDOW_FILL,
  section: SECTION_FILL.grey,
  card: WINDOW_FILL,
};
function fillOf(shape: {
  kind: RoomBoardSummaryShape["kind"];
  color: RoomBoardSummaryShape["color"];
}) {
  if (shape.kind === "section") return SECTION_FILL[shape.color ?? "grey"];
  if (shape.kind === "note" && shape.color !== undefined) return NOTE_FILL[shape.color];
  return KIND_FILL[shape.kind];
}

// A board with nothing to draw yet gets a few notes in its own paint, placed by its key, so a
// tile never looks empty or broken. Laid out on a 6 by 3 grid of spots, three of them taken.
const PATTERN_SPOTS = 18;
function patternNotes(seed: string): ReadonlyArray<{ x: number; y: number; size: number }> {
  let hash = 2166136261;
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const taken = new Set<number>();
  for (let step = 0; taken.size < 3 && step < 12; step++) {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    taken.add(Math.abs(hash) % PATTERN_SPOTS);
  }
  return [...taken].map((spot, index) => ({
    x: 28 + (spot % 6) * 32 + (index % 2) * 6,
    y: 22 + Math.floor(spot / 6) * 30 + (index % 3) * 4,
    size: index === 0 ? 34 : 26,
  }));
}

/**
 * A small map of a board's cards in their colours. With none to draw (a board not summarised
 * yet), a few notes in the board's `paint`, placed by its `seed`.
 */
export function BoardThumbnail({
  shapes,
  paint = "yellow",
  seed = "",
  ratio = "video",
}: {
  readonly shapes: ReadonlyArray<RoomBoardSummaryShape> | undefined;
  readonly paint?: NonNullable<RoomBoardSummaryShape["color"]>;
  readonly seed?: string;
  readonly ratio?: keyof typeof HEIGHTS;
}) {
  const dots = useId();
  const HEIGHT = HEIGHTS[ratio];
  const rects =
    shapes === undefined
      ? []
      : boardThumbnail(shapes, { width: WIDTH, height: HEIGHT, padding: PADDING });
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className={cn("block w-full bg-board-canvas", RATIO_CLASS[ratio])}
      aria-hidden
      data-board-thumbnail
      data-board-thumbnail-pattern={rects.length === 0 || undefined}
    >
      <defs>
        <pattern id={dots} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="0.6" className="fill-board-dot" />
        </pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill={`url(#${dots})`} />
      {rects.length === 0
        ? patternNotes(seed).map((note) => (
            <rect
              key={`${note.x}:${note.y}`}
              x={note.x}
              y={note.y}
              width={note.size}
              height={note.size}
              rx={1}
              className={NOTE_FILL[paint]}
              opacity={0.85}
            />
          ))
        : null}
      {rects.map((rect, index) => {
        const paper = rect.kind === "note" || rect.kind === "task";
        return (
          <rect
            // oxlint-disable-next-line react/no-array-index-key -- shapes carry no ids, and the list is redrawn whole
            key={index}
            data-kind={rect.kind}
            x={rect.x}
            y={rect.y}
            width={rect.width}
            height={rect.height}
            rx={paper ? 0.75 : Math.min(2.5, rect.width / 4, rect.height / 4)}
            className={fillOf(rect)}
            strokeWidth={0.75}
          />
        );
      })}
    </svg>
  );
}
