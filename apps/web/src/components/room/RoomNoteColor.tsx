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

/**
 * A section's background in each colour: the notes' own paint, a little see-through so the board
 * shows under it, behind a hairline frame. Grey is "None": the plain frame, as before any colour.
 */
const SECTION_COLOR_CLASSES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "border-foreground/8 bg-paint-yellow/70",
  green: "border-foreground/8 bg-paint-green/70",
  blue: "border-foreground/8 bg-paint-blue/70",
  pink: "border-foreground/8 bg-paint-pink/70",
  purple: "border-foreground/8 bg-paint-purple/70",
  grey: "border-foreground/18 bg-foreground/2",
};

/** A section's backgrounds as its menu lists them: none first, which a section starts with. */
const SECTION_COLORS: ReadonlyArray<RoomBoardNoteColor> = [
  "grey",
  ...ROOM_BOARD_NOTE_COLORS.filter((color) => color !== "grey"),
];

export const sectionColorClassName = (color: RoomBoardNoteColor | undefined) =>
  SECTION_COLOR_CLASSES[color ?? "grey"];

/** A section's title in its top corner, in the paper's ink so it reads on every paint and theme. */
export const sectionLabelClassName = (_color: RoomBoardNoteColor | undefined) => "text-paint-ink";

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

/** A choice's name: a section's grey is no background at all. */
const colorName = (color: RoomBoardNoteColor, section: boolean) =>
  section && color === "grey" ? "None" : COLOR_NAMES[color];

/** The swatches a plain note is coloured from, or a section's background, on its header. */
export function NoteColorPicker({
  color,
  onPick,
  section = false,
}: {
  readonly color: RoomBoardNoteColor | undefined;
  readonly onPick: (color: RoomBoardNoteColor) => void;
  /** A section's: its background, with "None" for the plain frame. */
  readonly section?: boolean;
}) {
  const label = section ? "Background" : "Colour";
  return (
    <Menu>
      <Tooltip>
        <TooltipTrigger
          render={
            <MenuTrigger
              render={
                <button
                  type="button"
                  aria-label={`${label}: ${colorName(color ?? (section ? "grey" : "yellow"), section)}`}
                  className={BOARD_ICON_BUTTON_CLASS}
                  onPointerDown={stopPointer}
                />
              }
            />
          }
        >
          <PaletteIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">{label}</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        <NoteColorChoices color={color} onPick={onPick} section={section} />
      </MenuPopup>
    </Menu>
  );
}

/** The colours a plain note can take, or a section's backgrounds, as items of a menu. */
export function NoteColorChoices({
  color,
  onPick,
  section = false,
}: {
  readonly color: RoomBoardNoteColor | undefined;
  readonly onPick: (color: RoomBoardNoteColor) => void;
  readonly section?: boolean;
}) {
  return (
    <MenuRadioGroup
      value={color ?? (section ? "grey" : "yellow")}
      onValueChange={(value) => {
        const picked = ROOM_BOARD_NOTE_COLORS.find((choice) => choice === value);
        if (picked !== undefined) onPick(picked);
      }}
    >
      {(section ? SECTION_COLORS : ROOM_BOARD_NOTE_COLORS).map((choice) => (
        <MenuRadioItem key={choice} value={choice} closeOnClick>
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className={cn(
                "size-3 rounded-sm ring-1 ring-foreground/10",
                // No background is an empty swatch; the others show their paint.
                section && choice === "grey" ? "bg-transparent" : SWATCH_CLASSES[choice],
              )}
            />
            {colorName(choice, section)}
          </span>
        </MenuRadioItem>
      ))}
    </MenuRadioGroup>
  );
}
