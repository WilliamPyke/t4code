import { PinIcon, RotateCcwIcon } from "lucide-react";
import { type PointerEvent, useState } from "react";

import { boardTimeLabel } from "../boards/boardsHome.logic";
import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardChip } from "./BoardChrome";
import { type BoardNoteAgentStatus, boardNoteAgentState } from "./roomBoard.logic";
import { useBoxProgress } from "./roomBoardLive";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * Where a note stands with the agent its line reaches, quiet under its text: going with the next
 * prompt, with the agent while that run works, sent, or done by the agent. A done note offers to
 * go again, which only arms it for the next prompt someone sends themselves.
 */
export function NoteAgentChip({
  status,
  boxName,
  onResend,
}: {
  readonly status: BoardNoteAgentStatus;
  readonly boxName: string;
  /** Absent where this person may not change the board. */
  readonly onResend: (() => void) | undefined;
}) {
  const progress = useBoxProgress(status.boxId);
  // When the note was drawn: how long ago its agent finished is said in words.
  const [now] = useState(() => Date.now());
  const state = boardNoteAgentState(status, progress);
  const finished =
    status.card.doneAt === undefined ? null : boardTimeLabel(status.card.doneAt, now);
  const pinned = status.card.status === "pinned";
  const label = pinned
    ? "Always sent"
    : state === "going"
      ? "To send"
      : state === "working"
        ? "With the agent"
        : state === "sent"
          ? "Sent"
          : "Done by agent";
  const detail = pinned
    ? `Goes with every prompt of ${boxName}`
    : state === "going"
      ? `Goes with the next prompt of ${boxName}`
      : state === "working"
        ? `${boxName} is working with it`
        : state === "sent"
          ? `Sent to ${boxName}. It goes again once it changes.`
          : `${boxName} finished with it${finished === null ? "" : ` · ${finished.toLowerCase()}`}`;
  return (
    <div
      className="flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1"
      role="status"
      data-note-agent={state}
    >
      <Tooltip>
        <TooltipTrigger render={<span className="flex min-w-0" />}>
          {/* A small pill on the card's paper, its words in the state's tone. */}
          <BoardChip
            tone={
              pinned || state === "going" || state === "working"
                ? "primary"
                : state === "done"
                  ? "success"
                  : "neutral"
            }
            className="bg-card dark:bg-card"
          >
            {pinned ? <PinIcon aria-hidden className="size-3" /> : null}
            {label}
          </BoardChip>
        </TooltipTrigger>
        <TooltipPopup side="top">{detail}</TooltipPopup>
      </Tooltip>
      {state === "done" && onResend !== undefined ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                size="micro"
                variant="ghost-muted"
                onPointerDown={stopPointer}
                onClick={onResend}
              />
            }
          >
            <RotateCcwIcon />
            Not fixed, send again
          </TooltipTrigger>
          <TooltipPopup side="top">Goes with the next prompt someone sends</TooltipPopup>
        </Tooltip>
      ) : null}
    </div>
  );
}
