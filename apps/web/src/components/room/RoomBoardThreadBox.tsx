import type { RoomBoard, RoomBoxTurn, ThreadGuestMessage } from "@t3tools/contracts";
import type { PointerEvent, ReactNode } from "react";

import { Button } from "../ui/button";
import { guestMessageArtifactTitle } from "../chat/roomBoardPrompt";
import { BoardProgressLine } from "./RoomBoardArtifact";
import { type BoardPeople, boardPersonName } from "./roomBoard.logic";
import { useBoxProgress } from "./roomBoardLive";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** The last few turns of a thread box: who asked what, with which cards, and the reply. */
export function BoxTurns({
  turns,
  people,
}: {
  readonly turns: ReadonlyArray<RoomBoxTurn>;
  readonly people: BoardPeople;
}) {
  if (turns.length === 0) return <p className="text-xs text-muted-foreground">No prompts yet.</p>;
  return (
    <ol className="flex flex-col gap-2.5">
      {turns.map((turn) => (
        <li key={turn.id} className="flex flex-col gap-1 text-xs">
          <span className="text-2xs font-medium text-muted-foreground">
            {boardPersonName(people, turn.askedBy ?? turn.guestId)}
            {turn.model === undefined ? "" : ` · ${turn.model}`}
          </span>
          <p className="line-clamp-2 border-s-2 border-info/50 ps-2 [overflow-wrap:anywhere]">
            {turn.prompt}
          </p>
          {turn.cards === undefined || turn.cards.length === 0 ? null : (
            <p className="truncate text-2xs text-muted-foreground">With {turn.cards.join(", ")}</p>
          )}
          {turn.reply === "" ? null : (
            <p className="line-clamp-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {turn.reply}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * What a box's agent is doing now: its phase, model and how long it has run, and the start of
 * what it is writing. Reads only its own box's run, so another box's tick does not render it.
 */
export function BoxProgress({
  boxId,
  onOpenConversation,
  fallback,
}: {
  readonly boxId: string;
  /** Offered to the owner, whose machine runs it, while the run waits for an approval. */
  readonly onOpenConversation: (() => void) | undefined;
  /** What shows when the server reports no runs for boxes, or none for this one. */
  readonly fallback?: ReactNode;
}) {
  const progress = useBoxProgress(boxId);
  if (progress === undefined) return fallback ?? null;
  return (
    <div role="status" className="flex flex-col gap-1">
      <p
        className={
          progress.phase === "approval"
            ? "text-2xs font-medium text-warning"
            : "text-2xs font-medium text-info"
        }
      >
        <BoardProgressLine progress={progress} />
      </p>
      {progress.phase === "writing" && progress.preview !== undefined && progress.preview !== "" ? (
        <p className="line-clamp-4 rounded-md bg-muted/50 px-2 py-1 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
          {progress.preview}
        </p>
      ) : null}
      {progress.phase === "approval" && onOpenConversation !== undefined ? (
        <div>
          <Button size="micro" onPointerDown={stopPointer} onClick={onOpenConversation}>
            Open conversation
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * The guests' requests for a box that wait for the owner: who asked, what, and the artifact the
 * reply would rewrite. The owner sends or dismisses each; everyone else sees it waiting.
 */
export function BoxRequests({
  requests,
  board,
  people,
  onResolve,
  resolving,
}: {
  readonly requests: ReadonlyArray<ThreadGuestMessage>;
  readonly board: RoomBoard;
  readonly people: BoardPeople;
  /** The owner's way to send or dismiss one. Absent for guests. */
  readonly onResolve:
    | ((message: ThreadGuestMessage, decision: "send" | "dismiss") => void)
    | undefined;
  readonly resolving: ReadonlySet<string>;
}) {
  if (requests.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1.5" aria-label="Waiting for the owner">
      {requests.map((message) => {
        const who = boardPersonName(people, message.guestId);
        const artifact = guestMessageArtifactTitle(board, message);
        const busy = resolving.has(message.id);
        return (
          <li
            key={message.id}
            className="flex flex-col gap-1 rounded-md border border-dashed border-border px-2 py-1.5 text-xs"
          >
            <span className="text-2xs font-medium text-muted-foreground">
              {who === "You" ? "You asked" : `${who} asked`}
              {artifact === null ? "" : ` · rewrites "${artifact}"`}
            </span>
            <p className="line-clamp-4 whitespace-pre-wrap [overflow-wrap:anywhere]">
              {message.text || "Sent files"}
            </p>
            {onResolve === undefined ? (
              <p className="text-2xs text-muted-foreground">Waiting for the owner</p>
            ) : (
              <div className="flex justify-end gap-1">
                <Button
                  size="micro"
                  variant="ghost-muted"
                  disabled={busy}
                  aria-label={`Dismiss request from ${who}`}
                  onPointerDown={stopPointer}
                  onClick={() => onResolve(message, "dismiss")}
                >
                  Dismiss
                </Button>
                <Button
                  size="micro"
                  disabled={busy}
                  aria-label={`Send request from ${who}`}
                  onPointerDown={stopPointer}
                  onClick={() => onResolve(message, "send")}
                >
                  Send
                </Button>
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}
