import { EllipsisIcon, Trash2Icon, XIcon } from "lucide-react";
import {
  createContext,
  type PointerEvent,
  type ReactNode,
  use,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

import { useInlineActionConfirm } from "../pullRequest/useInlineActionConfirm";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
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

/** Something a selection can do, which the bar shows as a labelled button or in its menu. */
export interface SelectionAction {
  readonly label: string;
  readonly icon: ReactNode;
  readonly run: () => void;
}

// A finger, or a board too narrow for the labels, gets the bar docked above the toolbar.
const COARSE_QUERY = "(pointer: coarse)";
const DOCKED_BELOW_WIDTH = 640;
const DOCK_GAP = 8;

/**
 * How many cards are selected, what they can do, Delete for the ones this viewer may remove (asked
 * twice) and Clear. It sits beside the selected cards and steps out of the way while they move;
 * on a phone it docks above the toolbar, clear of the cards' own controls, with icons and a menu.
 */
export function SelectionBar({
  refs,
  hidden,
  count,
  removable,
  onDelete,
  onClear,
  actions,
  children,
}: {
  /** The selected cards, by `data-board-item`, which it is placed against as they are drawn. */
  readonly refs: ReadonlySet<string>;
  /** Cards are being moved. */
  readonly hidden: boolean;
  readonly count: number;
  readonly removable: number;
  readonly actions: ReadonlyArray<SelectionAction>;
  /** Controls shown first, such as the colour picker. */
  readonly children?: ReactNode;
  /** Its button, `data-selection-delete`, is what the Delete key presses. */
  readonly onDelete: () => void;
  readonly onClear: () => void;
}) {
  const confirm = useInlineActionConfirm("board-selection");
  const armed = confirm.isArmed("delete");
  const coarse = useMediaQuery(COARSE_QUERY);
  const [narrow, setNarrow] = useState(false);
  const docked = coarse || narrow;
  const barRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the board surface's own width, which a split pane or narrow window sets, before the bar is painted
  useLayoutEffect(() => {
    const board = barRef.current?.offsetParent;
    if (!(board instanceof HTMLElement)) return;
    const measure = () => setNarrow(board.clientWidth < DOCKED_BELOW_WIDTH);
    measure();
    return observeResize(board, measure);
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- placed against the cards where the browser drew them, after every render that may have moved them or the view
  useLayoutEffect(() => {
    const bar = barRef.current;
    const board = bar?.offsetParent;
    if (hidden || bar === null || !(board instanceof HTMLElement)) return;
    const area = board.getBoundingClientRect();
    if (docked) {
      const chrome = board.parentElement?.querySelectorAll('[data-board-chrome="bottom"]') ?? [];
      const cover = Math.max(
        0,
        ...[...chrome].map((element) => area.bottom - element.getBoundingClientRect().top),
      );
      bar.style.left = `${Math.max(DOCK_GAP, (board.clientWidth - bar.offsetWidth) / 2)}px`;
      bar.style.top = `${Math.max(DOCK_GAP, board.clientHeight - cover - DOCK_GAP - bar.offsetHeight)}px`;
      return;
    }
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
  const deleteLabel = armed ? `Confirm delete ${removable}` : `Delete ${removable}`;
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
      <span role="status" className="whitespace-nowrap tabular-nums">
        {count} selected
      </span>
      {children}
      {docked ? (
        <>
          {actions.length === 0 ? null : (
            <Menu>
              <MenuTrigger
                render={
                  <Button
                    size="icon-lg"
                    variant="ghost-muted"
                    aria-label="More for the selection"
                  />
                }
              >
                <EllipsisIcon />
              </MenuTrigger>
              <MenuPopup align="center" side="top">
                {actions.map((action) => (
                  <MenuItem key={action.label} onClick={action.run}>
                    {action.icon}
                    {action.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          )}
          {removable === 0 ? null : (
            <Button
              size={armed ? "lg" : "icon-lg"}
              variant={armed ? "destructive-outline" : "ghost-muted"}
              aria-label={deleteLabel}
              data-selection-delete
              {...confirm.props("delete", onDelete)}
            >
              <Trash2Icon />
              {armed ? `Delete ${removable}?` : null}
            </Button>
          )}
          <Button
            size="icon-lg"
            variant="ghost-muted"
            aria-label="Clear selection"
            onClick={onClear}
          >
            <XIcon />
          </Button>
        </>
      ) : (
        <>
          {actions.map((action) => (
            <Button key={action.label} size="micro" variant="ghost-muted" onClick={action.run}>
              {action.icon}
              {action.label}
            </Button>
          ))}
          {removable === 0 ? null : (
            <Button
              size="micro"
              variant={armed ? "destructive-outline" : "ghost-muted"}
              aria-label={deleteLabel}
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
        </>
      )}
    </div>
  );
}
