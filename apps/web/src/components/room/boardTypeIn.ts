import { useRef } from "react";

// A closing menu hands focus back, and a board inert behind a menu refuses it, a frame or more
// after a card was added: this long, the new card's text takes the caret back.
const HOLD_FRAMES = 12;

/**
 * Puts the caret in a new card's text and keeps it there for a few frames, until the person
 * presses anywhere or puts the caret in another field, so what they type next goes into the card.
 */
export function holdCaretIn(find: () => HTMLElement | null): void {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  window.addEventListener("pointerdown", stop, { capture: true, once: true });
  const step = (left: number) => {
    const field = stopped ? null : find();
    const active = document.activeElement;
    // Only after the first frame: the field the card was added from gives the caret up at once.
    const chosen =
      left < HOLD_FRAMES &&
      active instanceof HTMLElement &&
      active !== field &&
      active.matches("input, textarea, [contenteditable='true']") &&
      active.closest("[data-command-palette]") === null;
    if (field === null || chosen) {
      window.removeEventListener("pointerdown", stop, { capture: true });
      return;
    }
    if (active !== field) field.focus({ preventScroll: true });
    if (left > 0) window.requestAnimationFrame(() => step(left - 1));
    else window.removeEventListener("pointerdown", stop, { capture: true });
  };
  step(HOLD_FRAMES);
}

/**
 * The Note tool's card, while the next press on the board may still place it: a click on the
 * empty board moves the card, still empty, to where it was clicked.
 */
export function useNotePlacement() {
  const armed = useRef<string | null>(null);
  return {
    arm: (noteId: string | null) => {
      armed.current = noteId;
    },
    /** The card the press may place, once: any press ends it. */
    take: (): string | null => {
      const noteId = armed.current;
      armed.current = null;
      return noteId;
    },
  };
}
