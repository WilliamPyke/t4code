import {
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoardNote,
  type RoomBoardNoteColor,
} from "@t3tools/contracts";
import { XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";

import {
  BOARD_HOVER_CHROME_CLASS,
  BOARD_ICON_BUTTON_CLASS,
  BOARD_SELECTED_CHROME_CLASS,
} from "./BoardChrome";
import { BOARD_SECTION_SIZE, boardEditKey } from "./roomBoard.logic";
import { boardStroke } from "./RoomBoardEdge";
import { boardLiveRect, boardLiveStyle, boardLiveText, useBoardLiveDrag } from "./roomBoardLive";
import { dragHandlers, leaveText } from "./roomBoardPointer";
import { useBoardSelected } from "./RoomBoardSelection";
import { NoteColorPicker, sectionColorClassName, sectionLabelClassName } from "./RoomNoteColor";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

const SECTION_TITLE_SIZE = "calc(17px * min(var(--board-line-scale, 1), 2.5))";

// A band along each edge that the section is moved by, thicker as the board zooms out. The top
// one reaches little into the title bar, and the sides start under it, clear of its buttons.
const FRAME_EDGES = [
  "inset-x-0 -top-[calc(8px*var(--board-line-scale,1))] h-[calc(12px*var(--board-line-scale,1))]",
  "inset-x-0 -bottom-[calc(8px*var(--board-line-scale,1))] h-[calc(16px*var(--board-line-scale,1))]",
  "top-9 bottom-0 -left-[calc(8px*var(--board-line-scale,1))] w-[calc(16px*var(--board-line-scale,1))]",
  "top-9 bottom-0 -right-[calc(8px*var(--board-line-scale,1))] w-[calc(16px*var(--board-line-scale,1))]",
];

/**
 * A section: a titled frame drawn behind the cards. Dragging its title, its title bar or its edge
 * moves it with what sits over it, which the board decides; it holds nothing of its own. Its
 * inside is the board's until it is selected: then dragging there moves it too.
 */
export function BoardSection({
  note,
  canRename,
  canDelete,
  canMove,
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
  /** Whether this person may move it; for whoever may not, a press on it pans the board. */
  readonly canMove: boolean;
  /** Dragged by this far, in screen pixels, and let go. */
  readonly onMove: (dx: number, dy: number) => void;
  readonly onDrop: () => void;
  /** Its resize and line grips. */
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
  const liveDrag = useBoardLiveDrag(ref);
  const live = boardLiveRect({ x: note.x, y: note.y, w: size.w, h: size.h }, liveDrag);
  // Once this person types here, their own draft shows until they leave it.
  const [drafting, setDrafting] = useState(false);
  const text = (drafting ? null : boardLiveText(note.text, liveDrag)) ?? note.text;
  // A click on the title types in it; a drag from it moves the section.
  const grab = canMove
    ? dragHandlers(onMove, onDrop, (_event, on) => {
        if (!canRename || !(on instanceof HTMLInputElement)) return;
        on.focus({ preventScroll: true });
        on.setSelectionRange(on.value.length, on.value.length);
      })
    : undefined;
  const marked = selected ? "" : undefined;
  return (
    <div
      className={cn(
        // Its title, edges and grips take the pointer; pressing inside pans or selects the board.
        "group/item pointer-events-none absolute flex flex-col rounded-2xl border",
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
        // Its frame thickens as the board zooms out, as lines do, so it still reads as a region.
        borderWidth: boardStroke(1),
        ...boardLiveStyle(note, live),
      }}
      data-board-item={ref}
      data-board-section=""
      data-board-selected={marked}
    >
      <div
        className={cn(
          "pointer-events-auto relative flex h-9 shrink-0 items-center justify-end gap-1 ps-2 pe-1",
          grab !== undefined && "cursor-move",
        )}
        data-board-selected={marked}
        {...grab}
      >
        <div className={cn("flex items-center gap-1", !selected && BOARD_HOVER_CHROME_CLASS)}>
          {onPickColor === undefined ? null : (
            <NoteColorPicker color={note.color ?? "grey"} onPick={onPickColor} section />
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
      {grab !== undefined && selected ? (
        <div
          aria-hidden
          data-board-section-body
          data-board-selected=""
          className="pointer-events-auto absolute inset-x-0 top-9 bottom-0 cursor-move touch-none"
          {...grab}
          // With Shift, Ctrl or Cmd held the inside is the board's: a marquee starts there.
          onPointerDown={(event) => {
            if (!event.shiftKey && !event.ctrlKey && !event.metaKey) grab.onPointerDown(event);
          }}
        />
      ) : null}
      {grab === undefined
        ? null
        : FRAME_EDGES.map((edge) => (
            <div
              key={edge}
              aria-hidden
              data-board-frame-edge
              data-board-selected={marked}
              className={cn("pointer-events-auto absolute cursor-move touch-none", edge)}
              {...grab}
            />
          ))}
      <div className="pointer-events-auto contents">{handles}</div>
      {/* After the grips, so a press on the title is the title's where the two meet. */}
      <input
        aria-label="Section title"
        // Resting, it is the section's to grab; focused, it is typed in.
        data-board-rest="title"
        data-board-selected={marked}
        value={text}
        readOnly={!canRename}
        maxLength={ROOM_BOARD_NOTE_MAX_LENGTH}
        placeholder={canRename ? "Name this section" : "Untitled section"}
        className={cn(
          // In the frame's top corner, as wide as its title and no wider than the frame's bar.
          "pointer-events-auto absolute top-1.5 left-3 field-sizing-content h-[1.6em] max-w-[calc(100%-6rem)] min-w-0 truncate rounded-sm bg-transparent px-1 font-heading font-semibold tracking-tight outline-none placeholder:font-semibold placeholder:text-paint-ink-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          sectionLabelClassName(note.color),
          grab !== undefined ? "cursor-move focus:cursor-text" : "cursor-default",
        )}
        // The board's heading: large, and larger as the board zooms out, up to 2.5 times.
        style={{ fontSize: SECTION_TITLE_SIZE }}
        {...grab}
        onChange={(event) => {
          setDrafting(true);
          onText(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.stopPropagation();
            onRevert();
          }
          if (event.key === "Enter" || event.key === "Escape") leaveText(event.currentTarget);
        }}
        onBlur={() => {
          setDrafting(false);
          onBlur();
        }}
      />
    </div>
  );
}
