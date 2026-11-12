import { type CSSProperties, type PointerEvent, type ReactNode, useRef, useState } from "react";

import { cn } from "~/lib/utils";

const PANEL_WIDTH_KEY = "t3:room-board-panel-width";
const DEFAULT_PANEL_WIDTH = 480;
const MIN_PANEL_WIDTH = 360;
const MIN_BOARD_WIDTH = 360;
const KEY_STEP = 32;

function readPanelWidth(): number {
  try {
    const stored = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return Number.isFinite(stored) && stored >= MIN_PANEL_WIDTH ? stored : DEFAULT_PANEL_WIDTH;
  } catch {
    return DEFAULT_PANEL_WIDTH;
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
  const drag = useRef<{ readonly x: number; readonly width: number } | null>(null);
  const clamp = (next: number) => {
    const room = (rowRef.current?.clientWidth ?? Number.POSITIVE_INFINITY) - MIN_BOARD_WIDTH;
    return Math.round(Math.max(MIN_PANEL_WIDTH, Math.min(next, room)));
  };
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
    writePanelWidth(width);
  };
  return (
    <div ref={rowRef} className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">{board}</div>
      {panel === null ? null : (
        <>
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the conversation"
            aria-valuenow={width}
            tabIndex={0}
            className={cn(
              "w-1.5 shrink-0 cursor-col-resize touch-none border-s border-border bg-background outline-none hover:bg-primary/20 focus-visible:bg-primary/30",
              open ? "max-md:hidden" : "hidden",
            )}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = { x: event.clientX, width };
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
              const next = clamp(width + (event.key === "ArrowLeft" ? KEY_STEP : -KEY_STEP));
              setWidth(next);
              writePanelWidth(next);
            }}
          />
          <aside
            aria-label="Conversation"
            className={cn(
              "z-20 flex min-h-0 flex-col bg-background max-md:absolute max-md:inset-0 md:w-(--board-panel-width) md:shrink-0",
              !open && "hidden",
            )}
            style={{ "--board-panel-width": `${width}px` } as CSSProperties}
          >
            {panel}
          </aside>
        </>
      )}
    </div>
  );
}
