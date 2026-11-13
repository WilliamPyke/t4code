import {
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoardNote,
  type RoomBoardNoteColor,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import type { PointerEvent, ReactNode } from "react";

import { cn } from "~/lib/utils";

import { BOARD_SECTION_SIZE, boardEditKey } from "./roomBoard.logic";
import { boardLiveRect, boardLiveStyle, useBoardLiveDrag } from "./roomBoardLive";
import { dragHandlers } from "./roomBoardPointer";
import { useBoardSelected } from "./RoomBoardSelection";
import { NoteColorPicker, sectionColorClassName } from "./RoomNoteColor";

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
        "group/item pointer-events-none absolute flex flex-col rounded-md border-2 border-dashed",
        sectionColorClassName(note.color),
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
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
        className="pointer-events-auto flex h-9 shrink-0 cursor-grab items-center gap-1 ps-2 pe-1 active:cursor-grabbing"
        {...dragHandlers(onMove, onDrop)}
      >
        <input
          aria-label="Section title"
          value={note.text}
          readOnly={!canRename}
          maxLength={ROOM_BOARD_NOTE_MAX_LENGTH}
          placeholder={canRename ? "Name this section" : "Untitled section"}
          className={cn(
            // As wide as its title, so the rest of the bar is left to drag by.
            "field-sizing-content min-w-0 max-w-[70%] truncate bg-transparent px-1 text-sm font-semibold outline-none placeholder:text-placeholder",
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
        <span aria-hidden className="flex-1" />
        {onPickColor === undefined ? null : (
          <NoteColorPicker color={note.color ?? "grey"} onPick={onPickColor} />
        )}
        {canDelete ? (
          <button
            type="button"
            aria-label="Delete section"
            className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
            onPointerDown={stopPointer}
            onClick={onDelete}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className="pointer-events-auto contents">{handles}</div>
    </div>
  );
}
