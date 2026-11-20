import { roomBoardNoteRef, type RoomBoard } from "@t3tools/contracts";
import { roomBoardStartNote } from "@t3tools/shared/roomBoard";

import type { BoardRect } from "./roomBoard.logic";

/** Where the board's start (the card or section it marks, else its top-left section) is drawn. */
export function boardStartRect(
  surface: HTMLElement | null,
  board: Pick<RoomBoard, "notes" | "start">,
): BoardRect | null {
  const note = roomBoardStartNote(board);
  if (note === null || surface === null) return null;
  const element = surface.querySelector<HTMLElement>(
    `[data-board-item="${CSS.escape(roomBoardNoteRef(note.id))}"]`,
  );
  return element === null
    ? null
    : {
        x: element.offsetLeft,
        y: element.offsetTop,
        width: element.offsetWidth,
        height: element.offsetHeight,
      };
}
