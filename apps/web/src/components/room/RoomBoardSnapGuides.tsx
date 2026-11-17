import { useSyncExternalStore } from "react";

import { type BoardSnapDrawn, NO_SNAP_DRAWN, sameSnapDrawn } from "./boardSnap.logic";

/**
 * The guides this person's own drag or resize snaps to, kept outside React so a pointer move
 * renders only the guides, and only when they change.
 */
export interface BoardSnapStore {
  readonly set: (drawn: BoardSnapDrawn) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly get: () => BoardSnapDrawn;
}

export function createBoardSnapStore(): BoardSnapStore {
  const listeners = new Set<() => void>();
  let drawn = NO_SNAP_DRAWN;
  return {
    set: (next) => {
      if (sameSnapDrawn(next, drawn)) return;
      drawn = next.guides.length === 0 && next.marks.length === 0 ? NO_SNAP_DRAWN : next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => drawn,
  };
}

/** How far a mark's end ticks reach each way, in screen pixels. */
const TICK = 4;

/** Thin lines through the edges a drag snapped to, and marks on equal gaps, in board pixels. */
export function BoardSnapGuides({
  store,
  zoom,
}: {
  readonly store: BoardSnapStore;
  readonly zoom: number;
}) {
  const { guides, marks } = useSyncExternalStore(store.subscribe, store.get);
  if (guides.length === 0 && marks.length === 0) return null;
  const tick = TICK / zoom;
  const segment = (axis: "x" | "y", at: number, from: number, to: number) =>
    axis === "x" ? { x1: at, y1: from, x2: at, y2: to } : { x1: from, y1: at, x2: to, y2: at };
  return (
    <svg
      aria-hidden
      data-board-snap-guides
      className="pointer-events-none absolute top-0 left-0 z-40 overflow-visible"
      width={1}
      height={1}
      stroke="var(--color-primary)"
      strokeWidth={1}
    >
      {guides.map((guide) => (
        <line
          key={`${guide.axis}${guide.at}`}
          {...segment(guide.axis, guide.at, guide.from, guide.to)}
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {marks.map((mark) => {
        // A mark across a gap on axis `x` runs along x, so its ticks stand upright.
        const along = mark.axis === "x" ? "y" : "x";
        return (
          <g key={`${mark.axis}${mark.from}:${mark.to}:${mark.at}`}>
            <line
              {...segment(along, mark.at, mark.from, mark.to)}
              vectorEffect="non-scaling-stroke"
            />
            {[mark.from, mark.to].map((end) => (
              <line
                key={end}
                {...segment(mark.axis, end, mark.at - tick, mark.at + tick)}
                vectorEffect="non-scaling-stroke"
              />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
