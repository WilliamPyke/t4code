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

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { boardChromeAt, boardRailReach } from "./BoardChrome";
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

/** Where a key went: the board itself, a text field on it, or a field in a dialog or popover. */
export const boardKeyFocus = (target: EventTarget | null): "board" | "field" | "dialog-field" =>
  isBoardKey(target)
    ? "board"
    : target instanceof Element && target.closest('[role="dialog"], [role="alertdialog"]') !== null
      ? "dialog-field"
      : "field";

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
 * How many cards are selected, what they can do, Delete for the ones this viewer may remove (or
 * why there is none, when every card is someone else's) and Clear. It sits beside the selected cards and steps out of the way while they move;
 * on a phone it docks above the toolbar, clear of the cards' own controls, with icons and a menu.
 */
export function SelectionBar({
  refs,
  hidden,
  count,
  removable,
  kept = 0,
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
  /** How many this viewer may not remove, as they are someone else's. */
  readonly kept?: number;
  readonly actions: ReadonlyArray<SelectionAction>;
  /** Controls shown first, such as the colour picker. */
  readonly children?: ReactNode;
  readonly onDelete: () => void;
  readonly onClear: () => void;
}) {
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
    // How far the header, and the toolbar and zoom controls, float into the board.
    const reach = (edge: "top" | "bottom", corner = false) =>
      Math.max(
        0,
        ...[
          ...(board.parentElement === null ? [] : boardChromeAt(board.parentElement, edge)),
          ...(corner ? (board.parentElement?.querySelectorAll("[data-board-corner]") ?? []) : []),
        ].map((element) => {
          const drawn = element.getBoundingClientRect();
          if (drawn.height === 0) return 0;
          return edge === "top" ? drawn.bottom - area.top : area.bottom - drawn.top;
        }),
      );
    if (docked) {
      // Above the zoom corner too, whose minimap hides while the bar is docked.
      const cover = reach("bottom", true);
      bar.style.left = `${Math.max(DOCK_GAP, (board.clientWidth - bar.offsetWidth) / 2)}px`;
      bar.style.top = `${Math.max(DOCK_GAP, board.clientHeight - cover - DOCK_GAP - bar.offsetHeight)}px`;
      return;
    }
    const rects = [...refs].flatMap((ref) => {
      const item = board.querySelector(`[data-board-item="${CSS.escape(ref)}"]`);
      if (item === null) return [];
      const drawn = item.getBoundingClientRect();
      // A section's title sits above its frame, and the bar keeps clear of it too.
      const title = item.hasAttribute("data-board-section")
        ? item.querySelector("input")?.getBoundingClientRect()
        : undefined;
      if (title === undefined) return [drawn];
      const top = Math.min(drawn.top, title.top);
      return [new DOMRect(drawn.left, top, drawn.width, drawn.bottom - top)];
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
      {
        top: reach("top"),
        bottom: reach("bottom"),
        left: board.parentElement === null ? 0 : boardRailReach(board.parentElement, area.left),
      },
      rects.map((rect) => ({
        x: rect.left - area.left,
        y: rect.top - area.top,
        width: rect.width,
        height: rect.height,
      })),
    );
    bar.style.left = `${spot.left}px`;
    bar.style.top = `${spot.top}px`;
  });
  const deleteLabel = `Delete ${removable}`;
  return (
    <div
      ref={barRef}
      data-board-overlay
      data-selection-bar
      data-selection-docked={docked ? "" : undefined}
      className={cn(
        "absolute top-2 left-2 z-20 flex items-center gap-1 rounded-xl border border-board-hairline bg-card py-1 ps-3 pe-1 text-xs text-card-foreground shadow-board",
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
              size="icon-lg"
              variant="ghost-muted"
              aria-label={deleteLabel}
              data-selection-delete
              onClick={onDelete}
            >
              <Trash2Icon />
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
          {removable === 0 ? (
            kept === 0 ? null : (
              <span className="px-1.5 whitespace-nowrap text-muted-foreground" data-selection-kept>
                Only whoever added {kept === 1 ? "it" : "these"}, or the board owner, can delete
              </span>
            )
          ) : (
            <Button
              size="micro"
              variant="ghost-muted"
              aria-label={deleteLabel}
              data-selection-delete
              onClick={onDelete}
            >
              <Trash2Icon />
              Delete
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
