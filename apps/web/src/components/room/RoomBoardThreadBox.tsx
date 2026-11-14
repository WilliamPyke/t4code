import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH,
  type RoomBoard,
  type RoomBoxTurn,
  type ScopedThreadRef,
  type ThreadGuestMessage,
} from "@t3tools/contracts";
import { roomBoxExcerpt } from "@t3tools/shared/roomBoard";
import { type PointerEvent, type ReactNode, useState } from "react";

import { useEnvironmentScope } from "~/state/session";
import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";

import { Button } from "../ui/button";
import { ComposerPendingApprovalActions } from "../chat/ComposerPendingApprovalActions";
import { guestMessageArtifactTitle } from "../chat/roomBoardPrompt";
import { BoardProgressLine } from "./RoomBoardArtifact";
import { BoardChip } from "./BoardChrome";
import { type BoardPeople, boardPersonName } from "./roomBoard.logic";
import { useBoxProgress } from "./roomBoardLive";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * The last few turns of a thread box: who asked what, with which cards, and the reply. While a
 * run is in flight, its prompt and who asked come last, before any reply has.
 */
export function BoxTurns({
  boxId,
  turns,
  people,
}: {
  readonly boxId: string;
  readonly turns: ReadonlyArray<RoomBoxTurn>;
  readonly people: BoardPeople;
}) {
  const running = useBoxProgress(boxId);
  if (turns.length === 0 && running === undefined) {
    return <p className="text-xs text-muted-foreground">No prompts yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2.5">
      {turns.map((turn) => (
        <li key={turn.id} className="flex flex-col gap-1 text-xs">
          <span className="text-2xs font-medium text-muted-foreground">
            {boardPersonName(people, turn.askedBy ?? turn.guestId)}
            {turn.model === undefined ? "" : ` · ${turn.model}`}
          </span>
          <p className="line-clamp-2 border-s-2 border-primary/40 ps-2 [overflow-wrap:anywhere]">
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
      {running?.prompt === undefined || running.prompt === "" ? null : (
        <li className="flex flex-col gap-1 text-xs">
          <span className="text-2xs font-medium text-muted-foreground">
            {boardPersonName(people, running.askedBy ?? running.guestId)}
          </span>
          <p className="line-clamp-2 border-s-2 border-primary/40 ps-2 [overflow-wrap:anywhere]">
            {running.prompt}
          </p>
        </li>
      )}
    </ol>
  );
}

/**
 * What a box's agent is doing now: its phase, model and how long it has run, and the start of
 * what it is writing. Reads only its own box's run, so another box's tick does not render it.
 */
export function BoxProgress({
  boxId,
  fallback,
  approval,
}: {
  readonly boxId: string;
  /** What shows when the server reports no runs for boxes, or none for this one. */
  readonly fallback?: ReactNode;
  /** Mounted only while the run waits on approval, so it reads the box's requests only then. */
  readonly approval?: ReactNode;
}) {
  const progress = useBoxProgress(boxId);
  if (progress === undefined) return fallback ?? null;
  const preview =
    progress.phase === "writing" && progress.preview !== undefined
      ? roomBoxExcerpt(progress.preview, ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH)
      : "";
  return (
    <div role="status" className="flex flex-col gap-1">
      <p className="flex">
        <BoardChip tone={progress.phase === "approval" ? "warning" : "primary"}>
          <BoardProgressLine progress={progress} />
        </BoardChip>
      </p>
      {progress.phase === "approval" ? approval : null}
      {preview === "" ? null : (
        <p className="line-clamp-4 rounded-md bg-foreground/4 px-2 py-1 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
          {preview}
        </p>
      )}
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
  model,
}: {
  readonly requests: ReadonlyArray<ThreadGuestMessage>;
  readonly board: RoomBoard;
  readonly people: BoardPeople;
  /** The owner's way to send or dismiss one. Absent for guests. */
  readonly onResolve:
    | ((message: ThreadGuestMessage, decision: "send" | "dismiss") => void)
    | undefined;
  readonly resolving: ReadonlySet<string>;
  /** Which model the owner's Send runs it on. */
  readonly model?: ReactNode;
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
            className="flex flex-col gap-1 rounded-md border border-dashed border-foreground/20 px-2 py-1.5 text-xs"
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
              <div className="flex items-center justify-end gap-1">
                <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
                  {model}
                </span>
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

/**
 * The first approval a box's run waits on, for the person whose agent it is: what it asks, cut to
 * a couple of lines, and the thread page's own answers. A question is answered in the conversation.
 */
export function BoxApproval({
  threadRef,
  onOpen,
}: {
  readonly threadRef: ScopedThreadRef;
  /** Opens the box's conversation, when the box has no button of its own for it. */
  readonly onOpen?: (() => void) | undefined;
}) {
  const approval = useAtomValue(environmentThreadDetails.pendingRequestsAtom(threadRef))
    ?.approvals[0];
  const canRespond = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const respond = useAtomCommand(threadEnvironment.respondToApproval, { reportFailure: false });
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open =
    onOpen === undefined ? null : (
      <Button size="micro" variant="outline" onPointerDown={stopPointer} onClick={onOpen}>
        Open conversation
      </Button>
    );
  if (approval === undefined) return open;
  return (
    <div
      role="group"
      aria-label="Approval"
      className="flex flex-col gap-1.5 rounded-md border border-warning/30 bg-warning/8 px-2 py-1.5 text-xs"
      onPointerDown={stopPointer}
    >
      <p className="line-clamp-2 font-mono text-2xs whitespace-pre-wrap [overflow-wrap:anywhere]">
        {approval.detail || approval.requestKind}
      </p>
      {approval.responseCapability === "live" ? null : (
        <p className="text-2xs text-warning-foreground">
          The agent stopped. Open the conversation to go on.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-1">
        <ComposerPendingApprovalActions
          requestId={approval.requestId}
          isResponding={responding}
          canRespond={approval.responseCapability === "live"}
          disabled={!canRespond}
          options={approval.options}
          onRespondToApproval={async (requestId, decision) => {
            if (!canRespond || responding) return;
            setResponding(true);
            setError(null);
            const result = await respond({
              environmentId: threadRef.environmentId,
              input: { threadId: threadRef.threadId, requestId, decision },
            });
            if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
              const failure = squashAtomCommandFailure(result);
              setError(
                failure instanceof Error ? failure.message : "Could not answer the approval.",
              );
            }
            setResponding(false);
            return result;
          }}
        />
        {open}
      </div>
      {error === null ? null : (
        <p role="alert" className="text-2xs text-error-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
