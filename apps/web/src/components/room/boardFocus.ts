import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { useEffect } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";

/**
 * A card someone asked the board to show, from their inbox or a board list: on the board, or a
 * task in the Plan. Boards are named by share id, or by view key for an owner's own board.
 */
export interface BoardFocus {
  /** A note's id, or the room box's for the room thread's own card. */
  readonly noteId: string;
  readonly plan: boolean;
  /** Tells two asks for the same card apart. */
  readonly stamp: number;
}

const boardFocusAtom = Atom.family((shareId: string) =>
  Atom.make<BoardFocus | null>(null).pipe(Atom.keepAlive, Atom.withLabel(`board-focus:${shareId}`)),
);

/** Asks the board to show this card when it next draws, opened now or later. */
export const requestBoardFocus = (shareId: string, focus: Omit<BoardFocus, "stamp">) =>
  appAtomRegistry.set(boardFocusAtom(shareId), { ...focus, stamp: Date.now() });

/**
 * Hands the board's waiting ask to `show`, every render until it says it is done: the card may
 * draw only after the board's view switched, or once the board arrived.
 */
export function useBoardFocusRequest(
  shareId: string | undefined,
  show: (focus: BoardFocus) => boolean,
) {
  const focus = useAtomValue(boardFocusAtom(shareId ?? ""));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- shows the card an inbox item names once the board has drawn it, which only the DOM knows
  useEffect(() => {
    if (focus === null || shareId === undefined) return;
    if (show(focus)) appAtomRegistry.set(boardFocusAtom(shareId), null);
  });
}
