import { type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";

const NO_HEIGHTS: ReadonlyMap<string, number> = new Map();

/**
 * How tall the browser drew each card and note on the board, by board ref, in board pixels: what
 * a line needs to meet a card that grows with its content at the middle of its side. It changes
 * only when a card's height does, never while cards are dragged.
 */
export function useBoardDrawnHeights(
  surfaceRef: RefObject<HTMLElement | null>,
): ReadonlyMap<string, number> {
  const [heights, setHeights] = useState(NO_HEIGHTS);
  const watched = useRef(new Map<HTMLElement, () => void>());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches the cards the browser drew after each render, which no React event reports
  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const measured = (entries: readonly ResizeObserverEntry[]) => {
      const changed: Array<readonly [string, number]> = [];
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const ref = element.dataset.boardItem;
        if (ref !== undefined) changed.push([ref, element.offsetHeight]);
      }
      setHeights((before) => {
        const moved = changed.filter(
          ([ref, height]) => Math.abs((before.get(ref) ?? -1) - height) >= 1,
        );
        return moved.length === 0 ? before : new Map([...before, ...moved]);
      });
    };
    for (const [element, stop] of watched.current) {
      if (element.isConnected) continue;
      stop();
      watched.current.delete(element);
    }
    for (const element of surface.querySelectorAll<HTMLElement>("[data-board-item]")) {
      if (!watched.current.has(element)) {
        watched.current.set(element, observeResize(element, measured));
      }
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- nothing stays watched once the board is gone
  useEffect(() => {
    const current = watched.current;
    return () => {
      for (const stop of current.values()) stop();
      current.clear();
    };
  }, []);
  return heights;
}
