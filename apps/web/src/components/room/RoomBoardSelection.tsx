import { Trash2Icon, XIcon } from "lucide-react";
import {
  createContext,
  type PointerEvent,
  type ReactNode,
  use,
  useLayoutEffect,
  useRef,
} from "react";

import { cn } from "~/lib/utils";

import { useInlineActionConfirm } from "../pullRequest/useInlineActionConfirm";
import { Button } from "../ui/button";
import { selectionBarSpot } from "./roomBoard.logic";
import { holdPointer } from "./roomBoardPointer";

const NOTHING_SELECTED: ReadonlySet<string> = new Set();

/** The cards and notes this viewer selected, by the ref lines name them by. Only theirs. */
export const BoardSelectionContext = createContext(NOTHING_SELECTED);

export const useBoardSelected = (ref: string) => use(BoardSelectionContext).has(ref);

/** Whether this item is the whole selection. */
export const useBoardSelectedAlone = (ref: string) => {
  const selected = use(BoardSelectionContext);
  return selected.size === 1 && selected.has(ref);
};

/** A key the board takes as its own: not one typed into a field. */
export const isBoardKey = (target: EventTarget | null) =>
  !(target instanceof Element) ||
  target.closest("input, textarea, select, [contenteditable]") === null;

interface ClientRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A rectangle dragged on the empty board with Shift held. It is drawn straight to the page while
 * the pointer moves, so the board does not render again until it is let go.
 */
export function useBoardMarquee(onSelect: (rect: ClientRect) => void) {
  const box = useRef<HTMLDivElement | null>(null);
  const from = useRef<{ readonly x: number; readonly y: number } | null>(null);
  const rectTo = (event: PointerEvent<HTMLElement>): ClientRect | null => {
    const start = from.current;
    if (start === null) return null;
    return {
      x: Math.min(start.x, event.clientX),
      y: Math.min(start.y, event.clientY),
      width: Math.abs(event.clientX - start.x),
      height: Math.abs(event.clientY - start.y),
    };
  };
  return {
    layer: (
      <div
        ref={box}
        aria-hidden
        className="pointer-events-none absolute z-20 hidden rounded-xs border border-primary bg-primary/8"
      />
    ),
    start: (event: PointerEvent<HTMLElement>) => {
      from.current = { x: event.clientX, y: event.clientY };
      holdPointer(event);
    },
    /** Drops a marquee being drawn, selecting nothing. */
    cancel: () => {
      from.current = null;
      if (box.current !== null) box.current.style.display = "none";
    },
    /** Says whether a marquee took the move. */
    move: (event: PointerEvent<HTMLElement>) => {
      const rect = rectTo(event);
      const drawn = box.current;
      if (rect === null) return false;
      if (drawn !== null) {
        const surface = event.currentTarget.getBoundingClientRect();
        drawn.style.left = `${rect.x - surface.left}px`;
        drawn.style.top = `${rect.y - surface.top}px`;
        drawn.style.width = `${rect.width}px`;
        drawn.style.height = `${rect.height}px`;
        drawn.style.display = "block";
      }
      return true;
    },
    /** Says whether a marquee took the release. */
    end: (event: PointerEvent<HTMLElement>) => {
      const rect = rectTo(event);
      if (rect === null) return false;
      from.current = null;
      if (box.current !== null) box.current.style.display = "none";
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (event.type === "pointerup") onSelect(rect);
      return true;
    },
  };
}

/**
 * How many cards are selected, with Delete for the ones this viewer may remove (asked twice) and
 * Clear. It sits beside the selected cards, on the board, and steps out of the way while they move.
 */
export function SelectionBar({
  refs,
  hidden,
  count,
  removable,
  onDelete,
  onClear,
  children,
}: {
  /** The selected cards, by `data-board-item`, which it is placed against as they are drawn. */
  readonly refs: ReadonlySet<string>;
  /** Cards are being moved. */
  readonly hidden: boolean;
  readonly count: number;
  readonly removable: number;
  /** What else the selection can do, before Delete. */
  readonly children?: ReactNode;
  /** Its button, `data-selection-delete`, is what the Delete key presses. */
  readonly onDelete: () => void;
  readonly onClear: () => void;
}) {
  const confirm = useInlineActionConfirm("board-selection");
  const armed = confirm.isArmed("delete");
  const barRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- placed against the cards where the browser drew them, after every render that may have moved them or the view
  useLayoutEffect(() => {
    const bar = barRef.current;
    const board = bar?.offsetParent;
    if (hidden || bar === null || !(board instanceof HTMLElement)) return;
    const area = board.getBoundingClientRect();
    const rects = [...refs].flatMap((ref) => {
      const item = board.querySelector(`[data-board-item="${CSS.escape(ref)}"]`);
      return item === null ? [] : [item.getBoundingClientRect()];
    });
    if (rects.length === 0) return;
    const left = Math.min(...rects.map((rect) => rect.left));
    const top = Math.min(...rects.map((rect) => rect.top));
    const spot = selectionBarSpot(
      {
        x: left - area.left,
        y: top - area.top,
        width: Math.max(...rects.map((rect) => rect.right)) - left,
        height: Math.max(...rects.map((rect) => rect.bottom)) - top,
      },
      { width: bar.offsetWidth, height: bar.offsetHeight },
      { width: board.clientWidth, height: board.clientHeight },
    );
    bar.style.left = `${spot.left}px`;
    bar.style.top = `${spot.top}px`;
  });
  return (
    <div
      ref={barRef}
      data-board-overlay
      className={cn(
        "absolute top-2 left-2 z-20 flex items-center gap-1 rounded-board border border-board-hairline bg-card py-1 ps-2.5 pe-1 text-xs text-card-foreground shadow-board",
        hidden && "invisible",
      )}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span role="status" className="tabular-nums">
        {count} selected
      </span>
      {children}
      {removable === 0 ? null : (
        <Button
          size="micro"
          variant={armed ? "destructive-outline" : "ghost-muted"}
          aria-label={armed ? `Confirm delete ${removable}` : `Delete ${removable}`}
          data-selection-delete
          {...confirm.props("delete", onDelete)}
        >
          <Trash2Icon />
          {armed ? `Delete ${removable}?` : "Delete"}
        </Button>
      )}
      <Button size="micro" variant="ghost-muted" onClick={onClear}>
        <XIcon />
        Clear
      </Button>
    </div>
  );
}
