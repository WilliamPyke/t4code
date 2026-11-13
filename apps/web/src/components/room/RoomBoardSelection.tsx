import { Trash2Icon, XIcon } from "lucide-react";
import { createContext, type PointerEvent, use, useRef } from "react";

import { useInlineActionConfirm } from "../pullRequest/useInlineActionConfirm";
import { Button } from "../ui/button";

const NOTHING_SELECTED: ReadonlySet<string> = new Set();

/** The cards and notes this viewer selected, by the ref lines name them by. Only theirs. */
export const BoardSelectionContext = createContext(NOTHING_SELECTED);

export const useBoardSelected = (ref: string) => use(BoardSelectionContext).has(ref);

/** A press with Shift that selects instead of acting: not on a control or a text field. */
export const isSelectPress = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    "button, a, input, textarea, select, [contenteditable], [role=menuitem], [data-board-overlay], [data-board-pin]",
  ) === null;

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
        className="pointer-events-none absolute z-20 hidden rounded-sm border border-primary bg-primary/10"
      />
    ),
    start: (event: PointerEvent<HTMLElement>) => {
      from.current = { x: event.clientX, y: event.clientY };
      event.currentTarget.setPointerCapture(event.pointerId);
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
 * How many cards are selected, over the board so the toolbar never moves, with Delete for the
 * ones this viewer may remove (asked twice) and Clear.
 */
export function SelectionBar({
  count,
  removable,
  onDelete,
  onClear,
}: {
  readonly count: number;
  readonly removable: number;
  /** Its button, `data-selection-delete`, is what the Delete key presses. */
  readonly onDelete: () => void;
  readonly onClear: () => void;
}) {
  const confirm = useInlineActionConfirm("board-selection");
  const armed = confirm.isArmed("delete");
  return (
    <div
      data-board-overlay
      className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1 rounded-md border border-border bg-popover py-1 ps-2.5 pe-1 text-xs text-popover-foreground shadow-md"
      onPointerDown={(event) => event.stopPropagation()}
    >
      <span role="status" className="tabular-nums">
        {count} selected
      </span>
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
