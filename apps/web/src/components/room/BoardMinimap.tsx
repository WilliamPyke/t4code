import type { RoomBoard } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { type PointerEvent, type RefObject, memo, useEffect, useState } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { observeResize } from "~/lib/observeResize";

import { MinimapAgentMarks } from "./BoardAgents";
import { BoardFloat } from "./BoardChrome";
import {
  type MinimapFrame,
  type MinimapItem,
  boardViewCentredOn,
  minimapFrame,
  minimapItems,
  minimapRect,
  minimapToBoard,
} from "./boardMinimap.logic";
import {
  type BoardPoint,
  type BoardSize,
  type BoardView,
  boardBounds,
  visibleBoardRect,
} from "./roomBoard.logic";
import { useBoardPointers } from "./roomBoardLive";

const MINIMAP_SIZE: BoardSize = { width: 168, height: 104 };
/** Below this window width the minimap starts hidden, until someone shows it. */
const MINIMAP_MIN_WINDOW_WIDTH = 900;

const MinimapChoice = Schema.NullOr(Schema.Boolean);

/** Whether this browser shows the minimap: its own choice, else only on a wide enough window. */
export function useBoardMinimap(): readonly [boolean, () => void] {
  const [choice, setChoice] = useLocalStorage("t3code.roomBoardMinimap", null, MinimapChoice);
  const [wide] = useState(
    () => typeof window === "undefined" || window.innerWidth >= MINIMAP_MIN_WINDOW_WIDTH,
  );
  const shown = choice ?? wide;
  return [shown, () => setChoice(!shown)];
}

const PAINTS = {
  yellow: "var(--color-paint-yellow)",
  green: "var(--color-paint-green)",
  blue: "var(--color-paint-blue)",
  pink: "var(--color-paint-pink)",
  purple: "var(--color-paint-purple)",
  grey: "var(--color-paint-grey)",
} as const;
const DEEP_PAINTS = {
  yellow: "var(--color-paint-yellow-deep)",
  green: "var(--color-paint-green-deep)",
  blue: "var(--color-paint-blue-deep)",
  pink: "var(--color-paint-pink-deep)",
  purple: "var(--color-paint-purple-deep)",
  grey: "var(--color-paint-grey-deep)",
} as const;

const minimapKey = (items: ReadonlyArray<MinimapItem>) =>
  items
    .map(
      (item) =>
        `${item.id}${item.tone}${item.color ?? ""}${item.x},${item.y},${item.width},${item.height}`,
    )
    .join("|");

/**
 * The cards, drawn in board pixels under one transform, so a pan only moves the group. Redrawn
 * only when what it draws changed, not on each render of the board.
 */
const MinimapCards = memo(
  function MinimapCards({
    items,
  }: {
    readonly items: ReadonlyArray<MinimapItem>;
    readonly drawn: string;
  }) {
    return items.map((item) => <MinimapCard key={item.id} item={item} />);
  },
  (before, after) => before.drawn === after.drawn,
);

function MinimapCard({ item }: { readonly item: MinimapItem }) {
  return (
    <rect
      x={item.x}
      y={item.y}
      width={item.width}
      height={item.height}
      rx={item.tone === "section" ? 0 : 8}
      vectorEffect="non-scaling-stroke"
      fill={
        item.tone === "paint"
          ? PAINTS[item.color ?? "yellow"]
          : item.tone === "section"
            ? DEEP_PAINTS[item.color ?? "grey"]
            : "var(--color-card)"
      }
      // A section's background shows as the board tints it; one with none stays faint.
      fillOpacity={item.tone !== "section" ? 1 : (item.color ?? "grey") === "grey" ? 0.08 : 0.2}
      stroke={item.tone === "window" ? "var(--color-board-hairline)" : undefined}
      strokeWidth={item.tone === "window" ? 1 : undefined}
    />
  );
}

/**
 * Everyone else's pointers as dots in their colour. Reads the live store itself, so a pointer
 * moving renders only these few circles; `scale` keeps them the same size at any zoom.
 */
function MinimapPointers({ scale }: { readonly scale: number }) {
  const pointers = useBoardPointers();
  return pointers.map((pointer) => (
    <circle
      key={pointer.key}
      cx={pointer.x}
      cy={pointer.y}
      r={3 / scale}
      fill={pointer.color}
      stroke="var(--color-card)"
      strokeWidth={1}
      vectorEffect="non-scaling-stroke"
    />
  ));
}

/**
 * A small map of the whole board in the corner: every card as a plain rect and the part in view
 * as an outline. Pressing it moves the view there, and dragging pans it.
 */
export function BoardMinimap({
  board,
  cardIds,
  view,
  surfaceRef,
  onView,
}: {
  readonly board: Pick<RoomBoard, "positions" | "sizes" | "notes">;
  /** The board's fixed cards: the room thread's, each person's and each agent's. */
  readonly cardIds: ReadonlyArray<string>;
  readonly view: BoardView;
  readonly surfaceRef: RefObject<HTMLElement | null>;
  readonly onView: (view: BoardView) => void;
}) {
  const [area, setArea] = useState<BoardSize | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the board surface's size, which the view rect is drawn from
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const measure = () => setArea({ width: surface.clientWidth, height: surface.clientHeight });
    measure();
    return observeResize(surface, measure);
  }, [surfaceRef]);

  const items = minimapItems(board, cardIds);
  const drawn = minimapKey(items);
  const content = boardBounds(items);
  // While a drag pans the view, the map holds still under the pointer.
  const [held, setHeld] = useState<{
    readonly frame: MinimapFrame;
    readonly grab: BoardPoint;
  } | null>(null);
  if (area === null || area.width === 0) return null;
  const viewport = visibleBoardRect(view, area);
  const frame = held?.frame ?? minimapFrame(content, viewport, MINIMAP_SIZE);
  const viewRect = minimapRect(frame, viewport);
  const worldTransform = `translate(${frame.offset.x} ${frame.offset.y}) scale(${frame.scale}) translate(${-frame.world.x} ${-frame.world.y})`;

  const boardPointOf = (event: PointerEvent<SVGSVGElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    return minimapToBoard(frame, { x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };
  const centreOn = (point: BoardPoint, grab: BoardPoint) =>
    onView(boardViewCentredOn(view, area, { x: point.x - grab.x, y: point.y - grab.y }));

  return (
    <BoardFloat className="overflow-hidden p-0">
      <svg
        aria-label="Minimap. Press or drag to move the view."
        role="img"
        width={MINIMAP_SIZE.width}
        height={MINIMAP_SIZE.height}
        className="block cursor-pointer touch-none bg-card"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const point = boardPointOf(event);
          const middle = {
            x: viewport.x + viewport.width / 2,
            y: viewport.y + viewport.height / 2,
          };
          const inside =
            point.x >= viewport.x &&
            point.x <= viewport.x + viewport.width &&
            point.y >= viewport.y &&
            point.y <= viewport.y + viewport.height;
          // Grabbing the view's rect drags it from where it was taken; anywhere else centres it.
          const grab = inside ? { x: point.x - middle.x, y: point.y - middle.y } : { x: 0, y: 0 };
          setHeld({ frame, grab });
          if (!inside) centreOn(point, grab);
        }}
        onPointerMove={(event) => {
          if (held === null) return;
          centreOn(boardPointOf(event), held.grab);
        }}
        onPointerUp={() => setHeld(null)}
        onPointerCancel={() => setHeld(null)}
      >
        <g transform={worldTransform}>
          <MinimapCards items={items} drawn={drawn} />
          <MinimapAgentMarks items={items} drawn={drawn} />
        </g>
        <rect
          x={viewRect.x}
          y={viewRect.y}
          width={viewRect.width}
          height={viewRect.height}
          rx={4}
          fill="var(--color-primary)"
          fillOpacity={0.06}
          stroke="var(--color-primary)"
          strokeWidth={1.5}
        />
        <g transform={worldTransform}>
          <MinimapPointers scale={frame.scale} />
        </g>
      </svg>
    </BoardFloat>
  );
}
