import {
  guestAgentName,
  type GuestId,
  type ThreadGuestShare,
  type ThreadGuestTurn,
} from "@t3tools/contracts";

import { cn } from "~/lib/utils";
import { guestBubbleClassName } from "./guestMessageStyle";

/**
 * Turns guests ran in their own T Code after joining from the room. They sit on the agent's
 * side with a guest's dashed edge, so no one reads them as the thread's own agent. Shown as plain
 * text: it comes from another machine.
 */
export function GuestTurnList({
  roster,
  turns,
  ownGuestId,
}: {
  readonly roster: Pick<ThreadGuestShare, "guests" | "guestName">;
  readonly turns: ReadonlyArray<ThreadGuestTurn>;
  /** The guest reading the list, on the shared page. */
  readonly ownGuestId?: GuestId | undefined;
}) {
  if (turns.length === 0) return null;
  return (
    <ol
      className="chat-content-lane flex flex-col gap-4 pb-4"
      aria-label="Turns guests ran on their own machines"
    >
      {turns.map((turn) => {
        const own = turn.guestId === ownGuestId;
        return (
          <li key={`${turn.guestId}:${turn.id}`} className="flex flex-col items-start gap-1">
            <p className="ms-1 text-2xs text-guest-foreground">
              {own ? "Your agent" : guestAgentName(roster, turn)}
              <span className="text-muted-foreground">
                {own ? " · ran on your machine" : " · ran on their machine"}
              </span>
            </p>
            <div
              className={cn(
                "flex max-h-96 min-w-0 max-w-[90%] flex-col gap-2 overflow-y-auto rounded-2xl p-3 text-foreground text-sm",
                guestBubbleClassName(true),
              )}
            >
              {turn.prompt ? (
                <p className="border-guest/50 border-s-2 ps-2 text-muted-foreground text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {turn.prompt}
                </p>
              ) : null}
              <p className="leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                {turn.reply}
              </p>
              {turn.truncated === true ? (
                <p className="text-2xs text-muted-foreground">Shortened for the room.</p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
