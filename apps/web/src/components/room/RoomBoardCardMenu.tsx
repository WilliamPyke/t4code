import type { RoomBoardNoteColor, RoomBoardReactionEmoji } from "@t3tools/contracts";
import { EllipsisIcon } from "lucide-react";
import { Fragment, type PointerEvent, useState } from "react";

import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
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
export interface CardAction {
  readonly label: string;
  readonly run: () => void;
  readonly destructive?: boolean;
}

/** What a card's menu offers: its header buttons, and reacting and colouring where it can. */
export interface CardMenu {
  readonly actions: ReadonlyArray<CardAction>;
  readonly onReact?: ((emoji: RoomBoardReactionEmoji) => void) | undefined;
  readonly color?:
    | {
        readonly value: RoomBoardNoteColor | undefined;
        readonly onPick: (color: RoomBoardNoteColor) => void;
      }
    | undefined;
}

const isEmpty = (menu: CardMenu) =>
  menu.actions.length === 0 && menu.onReact === undefined && menu.color === undefined;

function CardMenuItems({ actions, onReact, color }: CardMenu) {
  return (
    <>
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
    </>
  );
}

/**
 * A card's header buttons folded into one, for a card drawn too small for them: the rest of its
 * header is left to grab, and none of them is pressed by a grab that lands a little off.
 */
export function CardActionsMenu(menu: CardMenu) {
  if (isEmpty(menu)) return null;
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
        <CardMenuItems {...menu} />
      </MenuPopup>
    </Menu>
  );
}

/**
 * The board's right-click menu, open at a point on screen: a card's own menu first, then groups of
 * the board's entries, with a line between groups and the destructive ones last.
 */
export function BoardContextMenu({
  at,
  card,
  groups,
  onClose,
}: {
  readonly at: { readonly x: number; readonly y: number };
  readonly card: CardMenu | undefined;
  readonly groups: ReadonlyArray<ReadonlyArray<CardAction>>;
  /**
   * Once the menu has closed, so focus given then stays: while it is open it takes focus back. It
   * puts focus back itself; the menu leaves it alone.
   */
  readonly onClose: () => void;
}) {
  const [open, setOpen] = useState(true);
  const parts = [
    ...(card === undefined || isEmpty(card) ? [] : [card]),
    ...groups.filter((group) => group.length > 0).map((actions) => ({ actions })),
  ];
  if (parts.length === 0) return null;
  return (
    <Menu
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <MenuPopup
        anchor={{ getBoundingClientRect: () => new DOMRect(at.x, at.y, 0, 0) }}
        align="start"
        side="bottom"
        sideOffset={0}
        finalFocus={false}
      >
        {parts.map((part, index) => (
          <Fragment key={part.actions.map((action) => action.label).join() || "card"}>
            {index === 0 ? null : <MenuSeparator />}
            <CardMenuItems {...part} />
          </Fragment>
        ))}
      </MenuPopup>
    </Menu>
  );
}
