import { ROOM_BOARD_NOTE_COLORS, RoomBoardNoteColor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { PaletteIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BOARD_ICON_BUTTON_CLASS } from "./BoardChrome";

/** A note's paper in each colour: a full paint fill from the board's tokens (index.css). */
const NOTE_COLOR_CLASSES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "bg-paint-yellow",
  green: "bg-paint-green",
  blue: "bg-paint-blue",
  pink: "bg-paint-pink",
  purple: "bg-paint-purple",
  grey: "bg-paint-grey",
};

/** A section's frame and faint fill in each colour, quieter than a note so cards read over it. */
const SECTION_COLOR_CLASSES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "border-paint-yellow-deep/35 bg-paint-yellow-deep/7",
  green: "border-paint-green-deep/35 bg-paint-green-deep/7",
  blue: "border-paint-blue-deep/35 bg-paint-blue-deep/7",
  pink: "border-paint-pink-deep/35 bg-paint-pink-deep/7",
  purple: "border-paint-purple-deep/35 bg-paint-purple-deep/7",
  grey: "border-paint-grey-deep/30 bg-paint-grey-deep/4",
};

export const sectionColorClassName = (color: RoomBoardNoteColor | undefined) =>
  SECTION_COLOR_CLASSES[color ?? "grey"];

/** A section's label above its corner, in the deeper hue of its paint. */
const SECTION_LABEL_CLASSES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "text-paint-yellow-deep",
  green: "text-paint-green-deep",
  blue: "text-paint-blue-deep",
  pink: "text-paint-pink-deep",
  purple: "text-paint-purple-deep",
  grey: "text-paint-grey-deep",
};

export const sectionLabelClassName = (color: RoomBoardNoteColor | undefined) =>
  SECTION_LABEL_CLASSES[color ?? "grey"];

const SWATCH_CLASSES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "bg-paint-yellow",
  green: "bg-paint-green",
  blue: "bg-paint-blue",
  pink: "bg-paint-pink",
  purple: "bg-paint-purple",
  grey: "bg-paint-grey",
};

/** A small square in a paint, as the toolbar's sticky button and the colour menu show it. */
export const paintSwatchClassName = (color: RoomBoardNoteColor | undefined) =>
  SWATCH_CLASSES[color ?? "yellow"];

const COLOR_NAMES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "Yellow",
  green: "Green",
  blue: "Blue",
  pink: "Pink",
  purple: "Purple",
  grey: "Grey",
};

export const noteColorClassName = (color: RoomBoardNoteColor | undefined) =>
  NOTE_COLOR_CLASSES[color ?? "yellow"];

const LastNoteColor = Schema.NullOr(RoomBoardNoteColor);

/** The colour this person last gave a note on this device, which their new notes take. */
export const useLastNoteColor = () =>
  useLocalStorage("t3code.roomBoardNoteColor", null, LastNoteColor);

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** The swatches a plain note is coloured from, on its header. */
export function NoteColorPicker({
  color,
  onPick,
}: {
  readonly color: RoomBoardNoteColor | undefined;
  readonly onPick: (color: RoomBoardNoteColor) => void;
}) {
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`Colour: ${COLOR_NAMES[color ?? "yellow"]}`}
                  className={BOARD_ICON_BUTTON_CLASS}
                  onPointerDown={stopPointer}
                />
              }
            />
          }
        >
          <PaletteIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">Colour</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        <NoteColorChoices color={color} onPick={onPick} />
      </MenuPopup>
    </Menu>
  );
}

/** The colours a plain note can take, as items of a menu. */
export function NoteColorChoices({
  color,
  onPick,
}: {
  readonly color: RoomBoardNoteColor | undefined;
  readonly onPick: (color: RoomBoardNoteColor) => void;
}) {
  return (
    <MenuRadioGroup
      value={color ?? "yellow"}
      onValueChange={(value) => {
        const picked = ROOM_BOARD_NOTE_COLORS.find((choice) => choice === value);
        if (picked !== undefined) onPick(picked);
      }}
    >
      {ROOM_BOARD_NOTE_COLORS.map((choice) => (
        <MenuRadioItem key={choice} value={choice} closeOnClick>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn("size-3 rounded-sm ring-1 ring-foreground/10", SWATCH_CLASSES[choice])}
            />
            {COLOR_NAMES[choice]}
          </span>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}
