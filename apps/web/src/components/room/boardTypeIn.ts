// A closing menu hands focus back, and a board inert behind a menu refuses it, a frame or more
// after a card was added: this long, the new card's text takes the caret back.
const HOLD_FRAMES = 12;

const DIALOG = '[role="dialog"], [role="alertdialog"], [data-command-palette]';

/**
 * Puts the caret in a new card's text and keeps it there for a few frames, until the person
 * presses anywhere, presses a key, or the caret goes to another field or to a dialog opened since,
 * such as the command menu, so what they type next goes into the card.
 */
export function holdCaretIn(find: () => HTMLElement | null): void {
  let stopped = false;
  const stop = () => {
    stopped = true;
  };
  const end = () => {
    window.removeEventListener("pointerdown", stop, { capture: true });
    window.removeEventListener("keydown", stop, { capture: true });
  };
  window.addEventListener("pointerdown", stop, { capture: true });
  window.addEventListener("keydown", stop, { capture: true });
  // A dialog that had the caret as the card was added is closing; any other is the person's.
  const closing = document.activeElement?.closest(DIALOG) ?? null;
  const step = (left: number) => {
    const field = stopped ? null : find();
    const active = document.activeElement;
    const dialog = active instanceof Element ? active.closest(DIALOG) : null;
    const chosen =
      active instanceof HTMLElement &&
      active !== field &&
      (dialog === null
        ? // Only after the first frame: the field the card was added from gives the caret up.
          left < HOLD_FRAMES && active.matches("input, textarea, [contenteditable='true']")
        : dialog !== closing);
    if (field === null || chosen) return end();
    if (active !== field) field.focus({ preventScroll: true });
    if (left > 0) window.requestAnimationFrame(() => step(left - 1));
    else end();
  };
  step(HOLD_FRAMES);
}
