import { type GuestId, RoomBoardNote } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

import type { BoardRect } from "./roomBoard.logic";

/** A card copied from a board: as it was, and where and how big it was drawn. */
interface BoardCopy {
  readonly note: RoomBoardNote;
  readonly rect: BoardRect;
}

/**
 * Copies pasted on a board: new ids, and the paster's own, as cards they added would be. Copied on
 * another board they were someone else's there, under another name.
 */
export const boardPastedCopies = (
  copies: ReadonlyArray<BoardCopy>,
  viewer: GuestId | null,
  newId: () => string,
): ReadonlyArray<BoardCopy> =>
  copies.map(({ note: { guestId: _guestId, ...note }, rect }) => ({
    note: { ...note, id: newId(), ...(viewer === null ? {} : { guestId: viewer }) },
    rect,
  }));

const Copied = Schema.Struct({
  text: Schema.String,
  copies: Schema.Array(
    Schema.Struct({
      note: RoomBoardNote,
      rect: Schema.Struct({
        x: Schema.Number,
        y: Schema.Number,
        width: Schema.Number,
        height: Schema.Number,
      }),
    }),
  ),
});
type Copied = typeof Copied.Type;

// Per browser, so cards copied on one board paste as cards on another, in any tab. What went on
// the system clipboard with them tells a paste of them from a paste of something copied since.
const COPIED_STORAGE_KEY = "t3code:room-board-copied:v1";
let copiedHere: Copied | null = null;

export function rememberBoardCopy(text: string, copies: ReadonlyArray<BoardCopy>) {
  copiedHere = { text, copies };
  try {
    setLocalStorageItem(COPIED_STORAGE_KEY, copiedHere, Copied);
  } catch {
    // Blocked or full storage keeps the copy in this tab only.
  }
}

/** The cards copied with `text`, or null when the clipboard holds something else now. */
export function boardCopyOf(text: string): ReadonlyArray<BoardCopy> | null {
  let copied = copiedHere;
  try {
    copied = getLocalStorageItem(COPIED_STORAGE_KEY, Copied) ?? copiedHere;
  } catch {
    // Unreadable storage leaves what this tab copied.
  }
  return copied !== null && lines(copied.text) === lines(text) ? copied.copies : null;
}

// Some systems hand pasted text back with other line endings than were copied.
const lines = (text: string) => text.replace(/\r\n?/g, "\n").trimEnd();
