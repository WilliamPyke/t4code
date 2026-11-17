import {
  ROOM_ARTIFACT_MAX_LENGTH,
  type RoomArtifactContent,
  type RoomBoxProgress,
} from "@t3tools/contracts";
import { type PointerEvent, useRef, useState } from "react";

import { formatDayAwareTimestamp } from "~/timestampFormat";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { BoardChip } from "./BoardChrome";
import {
  type BoardPeople,
  boardCardsLine,
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
  onWrite,
}: {
  readonly artifact: RoomArtifactContent | undefined;
  /** The new version as it streams in; absent until its first text arrives. */
  readonly draft?: string | undefined;
  /** Opens the field to write it by hand, offered while it is empty. */
  readonly onWrite?: (() => void) | undefined;
}) {
  if (draft !== undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col border-t border-board-hairline">
        {/* Reversed, so it opens at the newest text and stays there as more streams in. */}
        <div
          data-board-scroll
          data-board-text
          aria-busy
          className="flex min-h-0 flex-1 cursor-auto flex-col-reverse overflow-auto px-3 py-2"
          onPointerDown={stopPointer}
        >
          <div>
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
      </div>
    );
  }
  if (artifact === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-start gap-2 px-3 pb-3">
        <p className="text-xs text-muted-foreground">
          Nothing here yet. Draw a line from a thread box to this card, or use Attach my agent, then
          prompt that box. Its reply shows here for everyone.
        </p>
        {onWrite === undefined ? null : (
          <Button
            size="xs"
            variant="outline"
            onPointerDown={stopPointer}
            onClick={onWrite}
            data-artifact-write
          >
            Write it yourself
          </Button>
        )}
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-board-hairline">
      {isBoardHtmlArtifact(artifact.body) ? (
        <iframe
          aria-label="Artifact page"
          sandbox="allow-scripts"
          srcDoc={artifact.body}
          className="min-h-0 w-full flex-1 rounded-b-board border-0 group-data-board-busy/board:pointer-events-none"
        />
      ) : (
        <div
          data-board-scroll
          data-board-text
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
  onWrite,
  people,
}: {
  readonly noteId: string;
  readonly artifact: RoomArtifactContent | undefined;
  /** Whose agent wrote the current version; absent before anything was written. */
  readonly author: string | undefined;
  /** What an older server, or a guest's own machine, says about who is writing it. */
  readonly writingFallback: string | null;
  readonly boxName: (boxId: string) => string;
  readonly onRestore: (() => Promise<boolean>) | undefined;
  /** Saves what a person wrote as the artifact's new version. Absent where they may not. */
  readonly onWrite?: ((body: string) => Promise<boolean>) | undefined;
  readonly people: BoardPeople;
}) {
  const progress = useArtifactProgress(noteId);
  const draft = progress?.draft === undefined || progress.draft === "" ? undefined : progress.draft;
  const [editing, setEditing] = useState(false);
  // Not while an agent writes a new version: saving would race it.
  const edit =
    onWrite === undefined || progress !== undefined || writingFallback !== null
      ? undefined
      : () => setEditing(true);
  if (editing && onWrite !== undefined) {
    return (
      <RoomArtifactEditor
        initial={artifact?.body ?? ""}
        onDone={async (body) => {
          setEditing(false);
          if (body !== null) await onWrite(body);
        }}
      />
    );
  }
  return (
    <>
      <RoomArtifactMeta
        author={author}
        artifact={artifact}
        onRestore={onRestore}
        onEdit={edit}
        people={people}
      />
      {progress !== undefined ? (
        <p role="status" className="flex shrink-0 px-3 pb-1.5">
          <BoardChip tone="primary">
            {boxName(progress.boxId)} · <BoardProgressLine progress={progress} />
          </BoardChip>
        </p>
      ) : writingFallback === null ? null : (
        <p role="status" className="flex shrink-0 px-3 pb-1.5">
          <BoardChip tone="primary">{writingFallback}</BoardChip>
        </p>
      )}
      <RoomArtifactBody artifact={artifact} draft={draft} onWrite={edit} />
    </>
  );
}

/**
 * A person writing an artifact's text by hand: its Markdown or page source, saved when they
 * leave the field or press Ctrl+Enter; Escape drops the change. Empty or unchanged saves nothing.
 */
function RoomArtifactEditor({
  initial,
  onDone,
}: {
  readonly initial: string;
  readonly onDone: (body: string | null) => void;
}) {
  const [text, setText] = useState(initial);
  // Ctrl+Enter or Escape closes the field, and the blur that may follow must not save again.
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const body = text.trim();
    onDone(save && body !== "" && body !== initial.trim() ? body : null);
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1 border-t border-board-hairline px-3 py-2">
      <textarea
        aria-label="Artifact text"
        // Focused without scrolling: on the moved board, the browser would scroll its box.
        ref={(field) => field?.focus({ preventScroll: true })}
        value={text}
        maxLength={ROOM_ARTIFACT_MAX_LENGTH}
        placeholder="Write Markdown, or paste a whole HTML page"
        className="min-h-24 flex-1 resize-none bg-transparent font-mono text-xs leading-snug outline-none placeholder:text-placeholder"
        data-board-text
        onPointerDown={stopPointer}
        onChange={(event) => setText(event.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          // The board's own keys stay out of a field someone is typing in.
          event.stopPropagation();
          if (event.key === "Escape") {
            event.preventDefault();
            finish(false);
          } else if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
            event.preventDefault();
            finish(true);
          }
        }}
      />
      <p className="shrink-0 text-2xs text-muted-foreground">
        Saves when you click away or press Ctrl+Enter. Esc cancels.
        {text.length > ROOM_ARTIFACT_MAX_LENGTH * 0.9
          ? ` ${text.length.toLocaleString()} of ${ROOM_ARTIFACT_MAX_LENGTH.toLocaleString()} characters.`
          : ""}
      </p>
    </div>
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
  onEdit,
  people,
}: {
  /** Absent before anything was written. */
  readonly author: string | undefined;
  readonly artifact: RoomArtifactContent | undefined;
  /** Swaps in the version it replaced. Absent when there is none, or the viewer may not. */
  readonly onRestore: (() => Promise<boolean>) | undefined;
  /** Opens the field to change its text by hand. */
  readonly onEdit: (() => void) | undefined;
  readonly people: BoardPeople;
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
        {onEdit === undefined ? null : (
          <Button
            size="micro"
            variant="ghost-muted"
            onPointerDown={stopPointer}
            onClick={onEdit}
            data-artifact-edit
          >
            Edit
          </Button>
        )}
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
        <p className="line-clamp-2 border-s-2 border-foreground/15 ps-2 text-2xs [overflow-wrap:anywhere]">
          {artifact.prompt}
        </p>
      )}
      {cards.length === 0 ? null : (
        <p className="truncate text-2xs text-muted-foreground">
          With {boardCardsLine(cards, people)}
        </p>
      )}
    </div>
  );
}
