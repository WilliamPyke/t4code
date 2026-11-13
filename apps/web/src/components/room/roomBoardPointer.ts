import type { PointerEvent } from "react";

/** Whether an event's target is drawn inside the element handling it, not in a portal from it. */
export const isInside = (event: {
  readonly target: EventTarget;
  readonly currentTarget: Element;
}) => event.target instanceof Node && event.currentTarget.contains(event.target);

/**
 * Pointer handlers that report how far a held pointer moved, in screen pixels, and when it is
 * let go.
 */
export function dragHandlers(
  onMove: (dx: number, dy: number, event: PointerEvent<HTMLElement>) => void,
  onEnd?: (event: PointerEvent<HTMLElement>) => void,
) {
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onEnd?.(event);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // A menu, popover or dialog opened from here is portalled elsewhere, but React still
      // bubbles its presses here, and capturing them would steal their clicks.
      if (event.button !== 0 || !isInside(event)) return;
      // The board under a card must not start panning too.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      onMove(event.movementX, event.movementY, event);
    },
    onPointerUp: release,
    onPointerCancel: release,
  };
}
