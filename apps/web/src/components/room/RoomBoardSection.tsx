import {
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoardNote,
  type RoomBoardNoteColor,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";

import {
  BOARD_HOVER_CHROME_CLASS,
  BOARD_ICON_BUTTON_CLASS,
  BOARD_SELECTED_CHROME_CLASS,
} from "./BoardChrome";
import { BOARD_SECTION_SIZE, boardEditKey } from "./roomBoard.logic";
import { boardLiveRect, boardLiveStyle, useBoardLiveDrag } from "./roomBoardLive";
import { dragHandlers } from "./roomBoardPointer";
import { useBoardSelected } from "./RoomBoardSelection";
import { NoteColorPicker, sectionColorClassName, sectionLabelClassName } from "./RoomNoteColor";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * A section: a titled frame drawn behind the cards. Dragging its title bar moves it with what sits
 * over it, which the board decides; it holds nothing of its own.
 */
export function BoardSection({
  note,
  canRename,
  canDelete,
  onMove,
  onDrop,
  handles,
  onText,
  onBlur,
  onRevert,
  onDelete,
  onPickColor,
}: {
  readonly note: RoomBoardNote;
  readonly canRename: boolean;
  readonly canDelete: boolean;
  /** The title bar dragged by this far, in screen pixels, and let go. */
  readonly onMove: (dx: number, dy: number) => void;
  readonly onDrop: () => void;
  /** Its resize grips. */
  readonly handles: ReactNode;
  readonly onText: (text: string) => void;
  readonly onBlur: () => void;
  /** Escape: the title goes back to what is stored. */
  readonly onRevert: () => void;
  readonly onDelete: () => void;
  readonly onPickColor: ((color: RoomBoardNoteColor) => void) | undefined;
}) {
  const size = note.size ?? BOARD_SECTION_SIZE;
  const ref = boardEditKey({ kind: "note", id: note.id });
  const selected = useBoardSelected(ref);
  const live = boardLiveRect({ x: note.x, y: note.y, w: size.w, h: size.h }, useBoardLiveDrag(ref));
  return (
    <div
      className={cn(
        // Only its title bar and grips take the pointer: pressing inside pans or selects the board.
        "group/item pointer-events-none absolute flex flex-col rounded-lg border",
        sectionColorClassName(note.color),
        selected &&
          cn(
            "ring-2 ring-primary ring-offset-2 ring-offset-board-canvas",
            BOARD_SELECTED_CHROME_CLASS,
          ),
      )}
      style={{
        left: note.x,
        top: note.y,
        width: live?.w ?? size.w,
        height: live?.h ?? size.h,
        ...boardLiveStyle(note, live),
      }}
      data-board-item={ref}
      data-board-section=""
    >
      <div
        className="pointer-events-auto relative flex h-9 shrink-0 cursor-grab items-center justify-end gap-1 ps-2 pe-1 active:cursor-grabbing"
        {...dragHandlers(onMove, onDrop)}
      >
        <input
          aria-label="Section title"
          value={note.text}
          readOnly={!canRename}
          maxLength={ROOM_BOARD_NOTE_MAX_LENGTH}
          placeholder={canRename ? "Name this section" : "Untitled section"}
          className={cn(
            // Above the frame's corner, as wide as its title, so it never covers or clips a card.
            "absolute bottom-full -left-1 mb-0.5 field-sizing-content h-6 min-w-0 max-w-full truncate rounded-sm bg-transparent px-1 text-sm font-semibold outline-none placeholder:text-placeholder focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            sectionLabelClassName(note.color),
            !canRename && "cursor-default",
          )}
          onPointerDown={stopPointer}
          onChange={(event) => onText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.stopPropagation();
              onRevert();
            }
            if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
          }}
          onBlur={onBlur}
        />
        <div className={cn("flex items-center gap-1", !selected && BOARD_HOVER_CHROME_CLASS)}>
          {onPickColor === undefined ? null : (
            <NoteColorPicker color={note.color ?? "grey"} onPick={onPickColor} />
          )}
          {canDelete ? (
            <button
              type="button"
              aria-label="Delete section"
              className={BOARD_ICON_BUTTON_CLASS}
              onPointerDown={stopPointer}
              onClick={onDelete}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className="pointer-events-auto contents">{handles}</div>
    </div>
  );
}
