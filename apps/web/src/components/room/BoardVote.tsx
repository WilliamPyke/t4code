import type { RoomBoardNote } from "@t3tools/contracts";
import { ThumbsUpIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { cn, isMacPlatform } from "~/lib/utils";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BOARD_ICON_BUTTON_CLASS } from "./BoardChrome";
import { boardVotedBy } from "./boardVotes.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** How the vote shortcut reads on this device. */
export const boardVoteShortcut = () =>
  typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌥V" : "Alt+V";

/**
 * A card's quick +1 in its header: a vote, or taking it back. The count shows in its 👍 chip.
 * `touch` is the finger-sized one shown above a selected note on a touch screen.
 */
export function VoteButton({
  note,
  viewer,
  touch = false,
  onVote,
}: {
  readonly note: RoomBoardNote;
  readonly viewer: string | null;
  readonly touch?: boolean;
  readonly onVote: () => void;
}) {
  const voted = boardVotedBy(note, viewer);
  // Read out as "Vote, pressed": the pressed state, not the name, says it is this person's.
  const label = voted ? "Remove my vote" : "Vote";
  if (touch) {
    return (
      <Button
        size="icon"
        variant={voted ? "secondary" : "ghost"}
        aria-label="Vote"
        aria-pressed={voted}
        onClick={onVote}
      >
        <ThumbsUpIcon className={cn(voted && "fill-current")} />
      </Button>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label="Vote"
            aria-pressed={voted}
            className={cn(BOARD_ICON_BUTTON_CLASS, voted && "text-primary opacity-100")}
            onPointerDown={stopPointer}
            onClick={onVote}
          />
        }
      >
        <ThumbsUpIcon className={cn("size-3.5", voted && "fill-current")} />
      </TooltipTrigger>
      <TooltipPopup side="top">
        {label} ({boardVoteShortcut()})
      </TooltipPopup>
    </Tooltip>
  );
}
