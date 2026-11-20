import type { PointerEvent } from "react";

import { BOARD_TOUCH_HOLD_MS, BOARD_TOUCH_SLOP, boardTouchPress } from "./roomBoard.logic";

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
  try {
    event.currentTarget.setPointerCapture(event.pointerId);
  } catch {
    // A pointer the browser no longer has (or a scripted one) cannot be captured; the gesture
    // still runs where it listens beyond the element.
  }
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

/** How far a held pointer of this kind may move and still be a tap: a finger drifts more. */
export const pressSlop = (pointerType: string) =>
  pointerType === "touch" ? BOARD_TOUCH_SLOP : CLICK_SLOP;

interface Press {
  readonly x: number;
  readonly y: number;
  readonly on: EventTarget;
  moved: boolean;
  last: { x: number; y: number };
  /** A finger's press: when it began, whether it rested, and whether it stopped resting. */
  readonly touch: { readonly at: number; held: boolean; done: boolean; timer: number } | null;
}

// `last` is where the pointer was at its previous move: touch pointers in Safari report no
// `movementX`, so how far it went is measured from client points.
const presses = new WeakMap<Element, Press>();

const boardOf = (element: Element) => element.closest<HTMLElement>("[role=application]");

/** A finger resting on the board now: it keeps the browser's own long-press menu and callout off. */
let touchResting = 0;
export const isTouchResting = () => touchResting > 0;

const endTouch = (element: Element, press: Press | undefined) => {
  const touch = press?.touch;
  if (touch === null || touch === undefined || touch.done) return;
  touch.done = true;
  clearTimeout(touch.timer);
  element.removeAttribute("data-board-lifted");
  touchResting = Math.max(0, touchResting - 1);
  if (touchResting === 0) boardOf(element)?.removeAttribute("data-board-resting");
};

/**
 * A finger moved off a card before resting on it: the board pans instead, as if pressed there.
 * The board's own handlers take the pointer from here, carrying on from where the finger is.
 */
function panInstead(card: HTMLElement, event: PointerEvent<HTMLElement>, press: Press) {
  const board = boardOf(card);
  endTouch(card, press);
  presses.delete(card);
  if (board === null || board === card) return;
  card.releasePointerCapture(event.pointerId);
  board.setPointerCapture(event.pointerId);
  holding = { element: board, pointerId: event.pointerId };
  presses.set(board, {
    x: press.x,
    y: press.y,
    on: board,
    moved: true,
    last: { x: press.x, y: press.y },
    touch: null,
  });
}

/**
 * Pointer handlers reporting how far a held pointer moved past a click's slop, its release, or a
 * tap (`onTap`). Text and controls are left alone. A finger on a card pans the board unless it
 * rests first, which lifts the card for the drag, or the card is selected (`data-board-selected`);
 * resting and letting go opens the board's menu.
 */
export function dragHandlers(
  onMove: (dx: number, dy: number, event: PointerEvent<HTMLElement>) => void,
  onEnd?: (event: PointerEvent<HTMLElement>) => void,
  onTap?: (event: PointerEvent<HTMLElement>, on: EventTarget) => void,
) {
  const release = (event: PointerEvent<HTMLElement>) => {
    const element = event.currentTarget;
    if (!element.hasPointerCapture(event.pointerId)) return;
    element.releasePointerCapture(event.pointerId);
    const press = presses.get(element);
    presses.delete(element);
    endTouch(element, press);
    if (press?.moved === true) onEnd?.(event);
    else if (press?.touch?.held === true && event.type === "pointerup") {
      element.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: event.clientX,
          clientY: event.clientY,
        }),
      );
    } else if (press !== undefined && event.type === "pointerup") onTap?.(event, press.on);
  };
  const hold = (element: HTMLElement, pointerId: number) => {
    const press = presses.get(element);
    const touch = press?.touch;
    if (touch === null || touch === undefined || touch.done) return;
    if (press?.moved !== false || !element.hasPointerCapture(pointerId)) return;
    touch.held = true;
    if (boardOf(element) !== element) element.setAttribute("data-board-lifted", "");
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
      const element = event.currentTarget;
      const pointerId = event.pointerId;
      const touch =
        event.pointerType === "touch"
          ? {
              at: event.timeStamp,
              held: false,
              done: false,
              timer: window.setTimeout(() => hold(element, pointerId), BOARD_TOUCH_HOLD_MS),
            }
          : null;
      if (touch !== null) {
        touchResting += 1;
        boardOf(element)?.setAttribute("data-board-resting", "");
      }
      presses.set(element, {
        x: event.clientX,
        y: event.clientY,
        on: event.target,
        moved: false,
        last: { x: event.clientX, y: event.clientY },
        touch,
      });
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const press = presses.get(event.currentTarget);
      if (press === undefined) {
        onMove(event.movementX, event.movementY, event);
        return;
      }
      if (press.moved) {
        const { x, y } = press.last;
        press.last = { x: event.clientX, y: event.clientY };
        onMove(event.clientX - x, event.clientY - y, event);
        return;
      }
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      const distance = Math.hypot(dx, dy);
      if (press.touch !== null && !press.touch.held && !press.touch.done) {
        const decision = boardTouchPress(event.timeStamp - press.touch.at, distance);
        if (decision === "wait") return;
        if (decision === "hold") hold(event.currentTarget, event.pointerId);
        else if (
          boardOf(event.currentTarget) !== event.currentTarget &&
          // A finger on a card already selected moves it at once, as a mouse does.
          !event.currentTarget.hasAttribute("data-board-selected")
        ) {
          return panInstead(event.currentTarget, event, press);
        } else endTouch(event.currentTarget, press);
      }
      if (distance < pressSlop(event.pointerType)) return;
      press.moved = true;
      press.last = { x: event.clientX, y: event.clientY };
      onMove(dx, dy, event);
    },
    onPointerUp: release,
    onPointerCancel: release,
    // A pinch's second finger, or a menu, can take the pointer away mid-press.
    onLostPointerCapture: (event: PointerEvent<HTMLElement>) => {
      // A card's lost capture bubbles to the board, which may just have taken the pointer.
      if (event.target !== event.currentTarget) return;
      const press = presses.get(event.currentTarget);
      if (press === undefined) return;
      presses.delete(event.currentTarget);
      endTouch(event.currentTarget, press);
    },
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
