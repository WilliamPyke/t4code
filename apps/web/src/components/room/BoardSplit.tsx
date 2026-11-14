import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from "react";

import { cn } from "~/lib/utils";

import { BOARD_SPLIT_DIVIDER, boardPanelMaxWidth } from "./roomBoard.logic";

const PANEL_WIDTH_KEY = "t3:room-board-panel-width";
// Until someone drags the split, the board keeps the larger side.
const DEFAULT_PANEL_WIDTH = "clamp(320px, 38%, 520px)";
const MIN_PANEL_WIDTH = 320;
// The CSS twin of `boardPanelMaxWidth`, applied on every render and window size.
const PANEL_MAX_WIDTH = `calc(100% - max(50%, min(480px, 100% - ${MIN_PANEL_WIDTH + BOARD_SPLIT_DIVIDER}px)) - ${BOARD_SPLIT_DIVIDER}px)`;
const KEY_STEP = 32;

function readPanelWidth(): number | null {
  try {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY) ?? "");
    return Number.isFinite(stored) && stored >= MIN_PANEL_WIDTH ? stored : null;
  } catch {
    return null;
  }
}

function writePanelWidth(width: number) {
  try {
    localStorage.setItem(PANEL_WIDTH_KEY, String(width));
  } catch {}
}

/**
 * The board with a conversation beside it. The split is dragged from the line between them and
 * kept per browser. On a narrow window the conversation covers the board. A closed panel stays
 * mounted and hidden, so its draft and scroll survive; a null one is not mounted at all.
 */
export function BoardSplit({
  board,
  panel,
  open,
}: {
  readonly board: ReactNode;
  readonly panel: ReactNode;
  readonly open: boolean;
}) {
  const [width, setWidth] = useState(readPanelWidth);
  const rowRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clamp = (next: number) => {
    const row = rowRef.current?.clientWidth ?? Number.POSITIVE_INFINITY;
    return Math.round(Math.min(Math.max(MIN_PANEL_WIDTH, next), boardPanelMaxWidth(row)));
  };
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    if (width !== null) writePanelWidth(width);
  };
  return (
    <div ref={rowRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-clip">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{board}</div>
      {panel === null ? null : (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the conversation"
            aria-valuenow={width ?? undefined}
            tabIndex={0}
            className={cn(
              "shrink-0 cursor-col-resize touch-none border-s border-board-hairline bg-background outline-none transition-colors hover:bg-primary/20 focus-visible:bg-primary/30",
              open ? "max-md:hidden" : "hidden",
            )}
            style={{ width: BOARD_SPLIT_DIVIDER }}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, width: panelRef.current?.offsetWidth ?? 0 };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (start === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
              setWidth(clamp(start.width - (event.clientX - start.x)));
            }}
            onPointerUp={release}
            onPointerCancel={release}
            onKeyDown={(event) => {
              if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
              event.preventDefault();
              const current = panelRef.current?.offsetWidth ?? 0;
              const next = clamp(current + (event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP));
              setWidth(next);
              writePanelWidth(next);
            }}
          />
          <aside
            ref={panelRef}
            aria-label="Conversation"
            className={cn(
              "z-20 flex min-h-0 flex-col bg-background max-md:absolute max-md:inset-0 md:w-(--board-panel-width) md:shrink-0",
              !open && "hidden",
            )}
            style={
              {
                // Whatever was stored, the board keeps the larger side of this row.
                "--board-panel-width": `min(${width === null ? DEFAULT_PANEL_WIDTH : `${width}px`}, ${PANEL_MAX_WIDTH})`,
              } as CSSProperties
            }
          >
            {panel}
          </aside>
        </>
      )}
    </div>
  );
}
