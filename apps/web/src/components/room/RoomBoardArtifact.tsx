import type { RoomArtifactContent, RoomBoxProgress } from "@t3tools/contracts";
import { type PointerEvent, useState } from "react";

import { formatDayAwareTimestamp } from "~/timestampFormat";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import {
  boardDraftIsPage,
  boardProgressLine,
  boardRestoreLabel,
  isBoardHtmlArtifact,
} from "./roomBoard.logic";
import { useArtifactProgress, useBoardNow } from "./roomBoardLive";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * What an agent wrote into an artifact card: a whole HTML page in a sandboxed frame with no access
 * to this page, or markdown. The frame lets pointers through to the board while anything on it is
 * dragged, so a drag over the frame does not stall. A draft still streaming shows in place of it,
 * a page as its source so a half-written page never runs.
 */
export function RoomArtifactBody({
  artifact,
  draft,
}: {
  readonly artifact: RoomArtifactContent | undefined;
  /** The new version as it streams in; absent until its first text arrives. */
  readonly draft?: string | undefined;
}) {
  if (draft !== undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col border-t border-border">
        <div
          data-board-scroll
          className="min-h-0 flex-1 cursor-auto overflow-auto px-3 py-2"
          onPointerDown={stopPointer}
        >
          {boardDraftIsPage(draft) ? (
            <pre
              aria-label="Page being written"
              className="font-mono text-2xs whitespace-pre-wrap text-muted-foreground [overflow-wrap:anywhere]"
            >
              {draft}
            </pre>
          ) : (
            <ChatMarkdown text={draft} cwd={undefined} />
          )}
        </div>
      </div>
    );
  }
  if (artifact === undefined) {
    return (
      <p className="min-h-0 flex-1 px-3 pb-3 text-xs text-muted-foreground">
        Nothing here yet. Draw a line from a thread box to this card, or use Attach my agent, then
        prompt that box. Its reply shows here for everyone.
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      {isBoardHtmlArtifact(artifact.body) ? (
        <iframe
          aria-label="Artifact page"
          sandbox="allow-scripts"
          srcDoc={artifact.body}
          className="min-h-0 w-full flex-1 rounded-b-sm border-0 group-data-board-busy/board:pointer-events-none"
        />
      ) : (
        <div
          data-board-scroll
          className="min-h-0 flex-1 cursor-auto overflow-auto px-3 py-2"
          onPointerDown={stopPointer}
        >
          <ChatMarkdown text={artifact.body} cwd={undefined} />
        </div>
      )}
      {artifact.truncated === true ? (
        <p className="shrink-0 px-3 py-1 text-2xs text-muted-foreground">
          Cut short: the reply was longer than the board keeps.
        </p>
      ) : null}
    </div>
  );
}

/** A run's phase, model and elapsed time, on the board's shared clock. */
export function BoardProgressLine({
  progress,
}: {
  readonly progress: Pick<RoomBoxProgress, "phase" | "detail" | "model" | "startedAt">;
}) {
  const now = useBoardNow();
  return <>{boardProgressLine(progress, now)}</>;
}

/**
 * An artifact's content and who changed it: the version a box is writing now as it streams, with
 * whose box and how far along, or the version that landed, with who asked for it and how.
 */
export function RoomArtifactLive({
  noteId,
  artifact,
  author,
  writingFallback,
  boxName,
  onRestore,
}: {
  readonly noteId: string;
  readonly artifact: RoomArtifactContent | undefined;
  /** Whose agent wrote the current version; absent before anything was written. */
  readonly author: string | undefined;
  /** What an older server, or a guest's own machine, says about who is writing it. */
  readonly writingFallback: string | null;
  readonly boxName: (boxId: string) => string;
  readonly onRestore: (() => Promise<boolean>) | undefined;
}) {
  const progress = useArtifactProgress(noteId);
  const draft = progress?.draft === undefined || progress.draft === "" ? undefined : progress.draft;
  return (
    <>
      <RoomArtifactMeta author={author} artifact={artifact} onRestore={onRestore} />
      {progress !== undefined ? (
        <p role="status" className="shrink-0 truncate px-3 pb-1.5 text-2xs font-medium text-info">
          {boxName(progress.boxId)} · <BoardProgressLine progress={progress} />
        </p>
      ) : writingFallback === null ? null : (
        <p role="status" className="shrink-0 px-3 pb-1.5 text-2xs font-medium text-info">
          {writingFallback}
        </p>
      )}
      <RoomArtifactBody artifact={artifact} draft={draft} />
    </>
  );
}

/**
 * Who wrote an artifact's current version and when, what they asked and with which cards and
 * model, and the way to the version it replaced: back to it, or forward again.
 */
function RoomArtifactMeta({
  author,
  artifact,
  onRestore,
}: {
  /** Absent before anything was written. */
  readonly author: string | undefined;
  readonly artifact: RoomArtifactContent | undefined;
  /** Swaps in the version it replaced. Absent when there is none, or the viewer may not. */
  readonly onRestore: (() => Promise<boolean>) | undefined;
}) {
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    if (onRestore === undefined || restoring) return;
    setRestoring(true);
    await onRestore().catch(() => false);
    setRestoring(false);
  };
  if (author === undefined || artifact === undefined) return null;
  const cards = artifact.cards ?? [];
  return (
    <div className="flex shrink-0 flex-col gap-0.5 px-3 pb-1.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {[author, artifact.model, formatDayAwareTimestamp(artifact.updatedAt, "locale")]
            .filter((part) => part !== undefined && part !== "")
            .join(" · ")}
        </p>
        {onRestore === undefined ? null : (
          <Button
            size="micro"
            variant="ghost-muted"
            disabled={restoring}
            onPointerDown={stopPointer}
            onClick={() => void restore()}
          >
            {restoring
              ? "Restoring..."
              : artifact.previous === undefined
                ? "Restore previous"
                : boardRestoreLabel({ ...artifact, previous: artifact.previous })}
          </Button>
        )}
      </div>
      {artifact.prompt === undefined || artifact.prompt.trim() === "" ? null : (
        <p className="line-clamp-2 border-s-2 border-info/50 ps-2 text-2xs [overflow-wrap:anywhere]">
          {artifact.prompt}
        </p>
      )}
      {cards.length === 0 ? null : (
        <p className="truncate text-2xs text-muted-foreground">With {cards.join(", ")}</p>
      )}
    </div>
  );
}
