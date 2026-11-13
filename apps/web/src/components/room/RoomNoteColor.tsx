import { ROOM_BOARD_NOTE_COLORS, RoomBoardNoteColor } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { PaletteIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { useLocalStorage } from "~/hooks/useLocalStorage";
import { cn } from "~/lib/utils";

import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/** A note's paper and edge in each colour, from the theme's tokens so both themes read well. */
const NOTE_COLOR_CLASSES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "border-warning/40 bg-warning-surface",
  green: "border-success/40 bg-success/8 dark:bg-success/16",
  blue: "border-info/40 bg-info/8 dark:bg-info/16",
  pink: "border-guest/40 bg-guest/8 dark:bg-guest/16",
  purple: "border-violet-500/40 bg-violet-500/8 dark:bg-violet-500/16",
  grey: "border-muted-foreground/30 bg-muted-foreground/8 dark:bg-muted-foreground/16",
};

const SWATCH_CLASSES: Readonly<Record<RoomBoardNoteColor, string>> = {
  yellow: "bg-warning",
  green: "bg-success",
  blue: "bg-info",
  pink: "bg-guest",
  purple: "bg-violet-500",
  grey: "bg-muted-foreground",
};

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
                  className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
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
                <span aria-hidden className={cn("size-3 rounded-full", SWATCH_CLASSES[choice])} />
                {COLOR_NAMES[choice]}
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
