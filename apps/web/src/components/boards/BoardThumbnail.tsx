import type { RoomBoardSummaryShape } from "@t3tools/contracts";
import { useId } from "react";

import { boardThumbnail } from "./boardsHome.logic";

const WIDTH = 240;
const HEIGHT = 135;
const PADDING = 10;

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
  section: "fill-paint-blue-deep/7 stroke-paint-blue-deep/30",
  card: WINDOW_FILL,
};
function fillOf(shape: {
  kind: RoomBoardSummaryShape["kind"];
  color: RoomBoardSummaryShape["color"];
}) {
  if (shape.kind === "section") return KIND_FILL.section;
  if (shape.kind === "note" && shape.color !== undefined) return NOTE_FILL[shape.color];
  return KIND_FILL[shape.kind];
}

/** A small map of a board's cards in their colours. No shapes yet draws an empty frame. */
export function BoardThumbnail({
  shapes,
}: {
  readonly shapes: ReadonlyArray<RoomBoardSummaryShape> | undefined;
}) {
  const dots = useId();
  const rects =
    shapes === undefined
      ? []
      : boardThumbnail(shapes, { width: WIDTH, height: HEIGHT, padding: PADDING });
  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="block aspect-video w-full bg-board-canvas"
      aria-hidden
      data-board-thumbnail
    >
      <defs>
        <pattern id={dots} width="8" height="8" patternUnits="userSpaceOnUse">
          <circle cx="4" cy="4" r="0.6" className="fill-board-dot" />
        </pattern>
      </defs>
      <rect width={WIDTH} height={HEIGHT} fill={`url(#${dots})`} />
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
