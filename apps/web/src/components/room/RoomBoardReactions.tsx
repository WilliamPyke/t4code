import {
  ROOM_BOARD_REACTIONS,
  type RoomBoardReaction,
  type RoomBoardReactionEmoji,
} from "@t3tools/contracts";
import { SmilePlusIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { cn } from "~/lib/utils";

import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { type BoardPeople, boardReactionChips } from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** The control on a card's header that adds one of the fixed reactions, or takes it back. */
export function AddReaction({
  onReact,
}: {
  readonly onReact: (emoji: RoomBoardReactionEmoji) => void;
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
                  aria-label="Add reaction"
                  className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
                  onPointerDown={stopPointer}
                />
              }
            />
          }
        >
          <SmilePlusIcon className="size-3.5" />
        </TooltipTrigger>
        <TooltipPopup side="top">React</TooltipPopup>
      </Tooltip>
      <MenuPopup align="end">
        <div className="grid grid-cols-6 gap-0.5">
          {ROOM_BOARD_REACTIONS.map((emoji) => (
            <MenuItem key={emoji} aria-label={`React ${emoji}`} onClick={() => onReact(emoji)}>
              <span className="text-base">{emoji}</span>
            </MenuItem>
          ))}
        </div>
      </MenuPopup>
    </Menu>
  );
}

/** A card's reactions under it, each a chip with its count that toggles the viewer's own. */
export function ReactionChips({
  reactions,
  people,
  onReact,
}: {
  readonly reactions: ReadonlyArray<RoomBoardReaction>;
  readonly people: BoardPeople;
  /** Absent for a viewer who cannot change the board. */
  readonly onReact: ((emoji: RoomBoardReactionEmoji) => void) | undefined;
}) {
  const chips = boardReactionChips(reactions, people);
  if (chips.length === 0) return null;
  return (
    <div className="flex shrink-0 flex-wrap gap-1 px-2 pb-2">
      {chips.map(({ emoji, count, mine, names }) => (
        <Tooltip key={emoji}>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={mine}
                aria-label={`${emoji} ${count}: ${names}`}
                disabled={onReact === undefined}
                className={cn(
                  "flex h-5 items-center gap-1 rounded-full border px-1.5 text-2xs tabular-nums",
                  mine ? "border-primary/50 bg-primary/10" : "border-border bg-background/60",
                  onReact !== undefined && "hover:border-primary/70",
                )}
                onPointerDown={stopPointer}
                onClick={() => onReact?.(emoji)}
              />
            }
          >
            <span aria-hidden>{emoji}</span>
            {count}
          </TooltipTrigger>
          <TooltipPopup side="bottom">{names}</TooltipPopup>
        </Tooltip>
      ))}
    </div>
  );
}
