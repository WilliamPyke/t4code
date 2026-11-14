import { type RefObject, useEffect } from "react";

import { type BoardPoint, type BoardView, pinchBoardView } from "./roomBoard.logic";

/**
 * Two fingers on the board zoom and pan it. Listens on the surface in the capture phase, so once
 * a second finger lands the board's own one-finger gestures never see the pinch's events.
 */
export function useBoardPinch(
  surfaceRef: RefObject<HTMLElement | null>,
  handlers: {
    /** The view as it is now, read when a pinch begins. */
    readonly view: () => BoardView;
    /** A pinch began: whatever the first finger was doing stops. */
    readonly onStart: () => void;
    readonly onView: (view: BoardView) => void;
  },
) {
  const { view, onStart, onView } = handlers;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- native capture listeners, so a pinch's events can be kept from the board's React handlers
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const touches = new Map<number, BoardPoint>();
    let pinch: {
      readonly ids: readonly [number, number];
      readonly start: BoardView;
      readonly from: readonly [BoardPoint, BoardPoint];
    } | null = null;
    const pointOf = (event: PointerEvent): BoardPoint => {
      const bounds = surface.getBoundingClientRect();
      return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
    };
    const onDown = (event: PointerEvent) => {
      if (event.pointerType !== "touch") return;
      touches.set(event.pointerId, pointOf(event));
      if (pinch !== null || touches.size !== 2) return;
      const [first, second] = [...touches];
      if (first === undefined || second === undefined) return;
      pinch = { ids: [first[0], second[0]], start: view(), from: [first[1], second[1]] };
      onStart();
      event.stopPropagation();
    };
    const onMove = (event: PointerEvent) => {
      if (!touches.has(event.pointerId)) return;
      touches.set(event.pointerId, pointOf(event));
      if (pinch === null || !pinch.ids.includes(event.pointerId)) return;
      event.stopPropagation();
      const first = touches.get(pinch.ids[0]);
      const second = touches.get(pinch.ids[1]);
      if (first === undefined || second === undefined) return;
      onView(pinchBoardView(pinch.start, pinch.from, [first, second]));
    };
    const onUp = (event: PointerEvent) => {
      if (!touches.delete(event.pointerId)) return;
      if (pinch === null) return;
      if (pinch.ids.includes(event.pointerId)) pinch = null;
      event.stopPropagation();
    };
    surface.addEventListener("pointerdown", onDown, true);
    surface.addEventListener("pointermove", onMove, true);
    surface.addEventListener("pointerup", onUp, true);
    surface.addEventListener("pointercancel", onUp, true);
    return () => {
      surface.removeEventListener("pointerdown", onDown, true);
      surface.removeEventListener("pointermove", onMove, true);
      surface.removeEventListener("pointerup", onUp, true);
      surface.removeEventListener("pointercancel", onUp, true);
    };
  }, [surfaceRef, view, onStart, onView]);
}
