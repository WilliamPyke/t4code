import { EllipsisIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

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
export function CardActionsMenu({ actions }: { readonly actions: ReadonlyArray<CardAction> }) {
  if (actions.length === 0) return null;
  return (
    <Menu>
      <MenuTrigger
        render={
          <button
            type="button"
            aria-label="Card actions"
            className="grid size-6 shrink-0 place-items-center rounded-sm opacity-60 hover:opacity-100"
            onPointerDown={stopPointer}
          />
        }
      >
        <EllipsisIcon className="size-3.5" />
      </MenuTrigger>
      <MenuPopup align="end">
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
