import type { PointerEvent } from "react";

import { type BoardBox, boardConnector } from "./roomBoard.logic";
import { type BoardLiveDrag, useBoardLiveDrag } from "./roomBoardLive";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** A line's end where someone else is dragging its card now, or where the card is stored. */
const liveEnd = (box: BoardBox, live: BoardLiveDrag | undefined): BoardBox =>
  live === undefined
    ? box
    : { ...box, x: live.x ?? box.x, y: live.y ?? box.y, width: live.w ?? box.width };

/**
 * One line between two cards. Each reads where someone else drags its own two ends from the live
 * store, so a drag redraws only the lines on the card that moves, never the board.
 */
export function BoardEdgeLine({
  id,
  fromRef,
  toRef,
  from,
  to,
  color,
  width,
  marker,
  selectable,
  onSelect,
}: {
  readonly id: string;
  readonly fromRef: string;
  readonly toRef: string;
  readonly from: BoardBox;
  readonly to: BoardBox;
  readonly color: string;
  readonly width: number;
  readonly marker: string;
  /** Whether a press on it selects it, for whoever may edit the board. */
  readonly selectable: boolean;
  readonly onSelect: () => void;
}) {
  const { path } = boardConnector(
    liveEnd(from, useBoardLiveDrag(fromRef)),
    liveEnd(to, useBoardLiveDrag(toRef)),
  );
  return (
    <g>
      {selectable ? (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          strokeWidth="14"
          pointerEvents="stroke"
          data-board-edge={id}
          className="cursor-pointer"
          onPointerDown={stopPointer}
          onClick={onSelect}
        />
      ) : null}
      <path d={path} fill="none" stroke={color} strokeWidth={width} markerEnd={marker} />
    </g>
  );
}
