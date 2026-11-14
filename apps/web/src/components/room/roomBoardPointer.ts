import type { PointerEvent } from "react";

/** How far a held pointer may move and still be a click, in screen pixels. */
export const CLICK_SLOP = 4;

/** Whether an event's target is drawn inside the element handling it, not in a portal from it. */
export const isInside = (event: {
  readonly target: EventTarget;
  readonly currentTarget: Element;
}) => event.target instanceof Node && event.currentTarget.contains(event.target);

const TEXT_ZONE =
  "input, textarea, select, [contenteditable], [data-board-text], [data-board-prompt]";
const CONTROL =
  "button, a, label, [role=button], [role=checkbox], [role=menuitem], [role=menuitemradio]";

/**
 * What a press on the board is for. Where people type or select text (fields, prompt boxes,
 * artifact content, comment threads, all marked `data-board-text`) it is the text's; on a button or
 * link it is the control's; anywhere else, grips included, it moves, pans, selects, resizes or draws.
 * A note's text (`data-board-rest`) is the note's to grab until it is focused for typing.
 */
export function boardPressKind(target: EventTarget | null): "text" | "control" | "gesture" {
  if (!(target instanceof Element)) return "gesture";
  const resting = target.closest("[data-board-rest]");
  if (resting !== null && resting !== document.activeElement) return "gesture";
  if (target.closest(TEXT_ZONE) !== null) return "text";
  if (target.closest("[data-board-grip]") !== null) return "gesture";
  return target.closest(CONTROL) === null ? "gesture" : "control";
}

let holding: { readonly element: Element; readonly pointerId: number } | null = null;

/** Takes the pointer for a gesture, which `dropHeldPointer` can cancel. */
export function holdPointer(event: PointerEvent<Element>) {
  event.currentTarget.setPointerCapture(event.pointerId);
  holding = { element: event.currentTarget, pointerId: event.pointerId };
}

/**
 * Lets go of the pointer a gesture holds without ending the gesture: its element hears no release,
 * so nothing is dropped or sent. Says whether a gesture was going on.
 */
export function dropHeldPointer(): boolean {
  const held = holding;
  holding = null;
  if (held === null || !held.element.hasPointerCapture(held.pointerId)) return false;
  held.element.releasePointerCapture(held.pointerId);
  return true;
}

const presses = new WeakMap<
  Element,
  { readonly x: number; readonly y: number; readonly on: EventTarget; moved: boolean }
>();

/**
 * Pointer handlers that report how far a held pointer moved, in screen pixels, once it moved further
 * than a click would, and when it is let go after that, or `onTap`, with where the press began, when
 * it never moved that far. A press on text or a control is left alone.
 */
export function dragHandlers(
  onMove: (dx: number, dy: number, event: PointerEvent<HTMLElement>) => void,
  onEnd?: (event: PointerEvent<HTMLElement>) => void,
  onTap?: (event: PointerEvent<HTMLElement>, on: EventTarget) => void,
) {
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const press = presses.get(event.currentTarget);
    presses.delete(event.currentTarget);
    if (press?.moved === true) onEnd?.(event);
    else if (press !== undefined && event.type === "pointerup") onTap?.(event, press.on);
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      // A menu, popover or dialog opened from here is portalled elsewhere, but React still
      // bubbles its presses here, and capturing them would steal their clicks.
      if (event.button !== 0 || !isInside(event) || boardPressKind(event.target) !== "gesture") {
        return;
      }
      // The board under a card must not start panning too.
      event.stopPropagation();
      holdPointer(event);
      presses.set(event.currentTarget, {
        x: event.clientX,
        y: event.clientY,
        on: event.target,
        moved: false,
      });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const press = presses.get(event.currentTarget);
      if (press === undefined || press.moved) {
        onMove(event.movementX, event.movementY, event);
        return;
      }
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (Math.hypot(dx, dy) < CLICK_SLOP) return;
      press.moved = true;
      onMove(dx, dy, event);
    },
    onPointerUp: release,
    onPointerCancel: release,
  };
}

/** Takes the caret out of a card's field and gives the board its keys back, not the page. */
export function leaveText(field: HTMLElement) {
  const board = field.closest<HTMLElement>("[role=application]");
  if (board === null) field.blur();
  else board.focus({ preventScroll: true });
}

/** Puts the caret in a field where a point falls on its text, or at its end where the browser cannot say. */
export function focusTextAt(field: HTMLTextAreaElement, x: number, y: number) {
  const position =
    "caretPositionFromPoint" in document ? document.caretPositionFromPoint(x, y) : null;
  const at = position?.offsetNode === field ? position.offset : field.value.length;
  field.focus({ preventScroll: true });
  field.setSelectionRange(at, at);
}
