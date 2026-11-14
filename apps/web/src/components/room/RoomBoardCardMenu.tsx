import type { RoomBoardNoteColor, RoomBoardReactionEmoji } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import type { PointerEvent } from "react";

import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSub,
  MenuSubPopup,
  MenuSubTrigger,
  MenuTrigger,
} from "../ui/menu";
import { BOARD_ICON_BUTTON_CLASS } from "./BoardChrome";
import { ReactionChoices } from "./RoomBoardReactions";
import { NoteColorChoices } from "./RoomNoteColor";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** One of a card's header buttons, as an entry of its menu. */
interface CardAction {
  readonly label: string;
  readonly run: () => void;
  readonly destructive?: boolean;
}

/**
 * A card's header buttons folded into one, for a card drawn too small for them: the rest of its
 * header is left to grab, and none of them is pressed by a grab that lands a little off.
 */
export function CardActionsMenu({
  actions,
  onReact,
  color,
}: {
  readonly actions: ReadonlyArray<CardAction>;
  readonly onReact?: ((emoji: RoomBoardReactionEmoji) => void) | undefined;
  readonly color?:
    | {
        readonly value: RoomBoardNoteColor | undefined;
        readonly onPick: (color: RoomBoardNoteColor) => void;
      }
    | undefined;
}) {
  if (actions.length === 0 && onReact === undefined && color === undefined) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Card actions"
            className={BOARD_ICON_BUTTON_CLASS}
            onPointerDown={stopPointer}
          />
        }
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
        {onReact === undefined ? null : (
          <MenuSub>
            <MenuSubTrigger>React</MenuSubTrigger>
            <MenuSubPopup>
              <ReactionChoices onReact={onReact} />
            </MenuSubPopup>
          </MenuSub>
        )}
        {color === undefined ? null : (
          <MenuSub>
            <MenuSubTrigger>Colour</MenuSubTrigger>
            <MenuSubPopup>
              <NoteColorChoices color={color.value} onPick={color.onPick} />
            </MenuSubPopup>
          </MenuSub>
        )}
        {actions.map((action) => (
          <MenuItem
            key={action.label}
            variant={action.destructive === true ? "destructive" : "default"}
            onClick={action.run}
          >
            {action.label}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}
