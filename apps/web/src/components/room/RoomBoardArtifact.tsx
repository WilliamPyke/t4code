import {
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomArtifactContent,
  type RoomBoardMark,
  type RoomBoxProgress,
} from "@t3tools/contracts";
import { RefreshCwIcon } from "lucide-react";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import { boardTimeLabel } from "../boards/boardsHome.logic";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardChip } from "./BoardChrome";
import {
  BOARD_MARK_MESSAGE,
  type BoardMarkPick,
  type BoardMarkPin,
  boardMarkMessage,
  boardPageWithMarks,
} from "./boardMark.logic";
import { BoardPageCover, useBoardPageRelease } from "./RoomBoardEmbed";
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
const nothing = () => {};

/** Pointing at parts of an artifact's page: its numbered marks, and how one is added. */
export interface ArtifactMarking {
  /** The marks still joined to this artifact by a line, as its page numbers them. */
  readonly pins: ReadonlyArray<BoardMarkPin>;
  /** Adds a note beside the card that says what should change there. A board edit, nothing more. */
  readonly onAdd: (mark: RoomBoardMark, words: string) => void;
}

/**
 * What an agent wrote into an artifact card: a whole HTML page in a sandboxed frame with no access
 * to this page, or markdown. Until the viewer clicks it (`active`) it lies under a cover, so the
 * wheel moves the board and a drag the card. A draft still streaming shows in place of it, a page
 * as its source so a half-written page never runs.
 */
export function RoomArtifactBody({
  artifact,
  draft,
  onWrite,
  frame = 0,
  active = false,
  onRelease = nothing,
  marking,
}: {
  /** Whether the viewer clicked its content, which then scrolls and takes the pointer. */
  readonly active?: boolean;
  /** Gives the board back: a press outside it, or Escape. */
  readonly onRelease?: (() => void) | undefined;
  /** Present while the viewer points at parts of its page ("Mark up"). */
  readonly marking?: (ArtifactMarking & { readonly onStop: () => void }) | undefined;
  /** Counts the times someone pressed Refresh: a new number loads a page's frame afresh. */
  readonly frame?: number;
  readonly artifact: RoomArtifactContent | undefined;
  /** The new version as it streams in; absent until its first text arrives. */
  readonly draft?: string | undefined;
  /** Opens the field to write it by hand, offered while it is empty. */
  readonly onWrite?: (() => void) | undefined;
}) {
  const bodyRef = useBoardPageRelease(active, onRelease);
  if (draft !== undefined) {
    return (
      <div
        ref={bodyRef}
        className="relative flex min-h-0 flex-1 flex-col border-t border-board-hairline"
      >
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
        {active ? null : <BoardPageCover label="Click to scroll" quiet />}
      </div>
    );
  }
  if (artifact === undefined) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-start gap-2 px-3 pb-3">
        <p className="text-xs text-muted-foreground">
          Nothing here yet. Draw a line from a thread box to this card, or use Attach my agent, then
          prompt that box. Its reply shows here for everyone. A line from another artifact makes
          this a live view of it.
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
      <div ref={bodyRef} className="relative flex min-h-0 flex-1 flex-col">
        {isBoardHtmlArtifact(artifact.body) ? (
          <ArtifactPage
            key={frame}
            body={artifact.body}
            active={active}
            marking={marking}
            onRelease={onRelease}
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
        {active || (marking !== undefined && isBoardHtmlArtifact(artifact.body)) ? null : (
          <BoardPageCover
            label={isBoardHtmlArtifact(artifact.body) ? "Click to interact" : "Click to scroll"}
            quiet
          />
        )}
      </div>
      {artifact.truncated === true ? (
        <p className="shrink-0 px-3 py-1 text-2xs text-muted-foreground">
          Cut short: the reply was longer than the board keeps.
        </p>
      ) : null}
    </div>
  );
}

/**
 * An artifact's HTML page in its frame, with our script after it (`boardPageWithMarks`). The frame
 * takes the pointer only once clicked or while marked up, and never while something on the board
 * is dragged, so a drag over it does not stall.
 */
function ArtifactPage({
  body,
  active,
  marking,
  onRelease,
}: {
  readonly body: string;
  readonly active: boolean;
  readonly marking: (ArtifactMarking & { readonly onStop: () => void }) | undefined;
  readonly onRelease: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const on = marking !== undefined;
  const pins = marking?.pins ?? NO_PINS;
  // As text, so the frame is told again only when the marks themselves change.
  const pinsJson = JSON.stringify(pins);
  const tell = useStableCallback((pointing: boolean, pinned: string) => {
    const frame = frameRef.current;
    const page = frame?.contentWindow;
    if (frame === null || page === null || page === undefined) return;
    const style = getComputedStyle(frame);
    const say = (message: Record<string, unknown>) =>
      // The frame's origin is opaque, so none can be named; nothing said here is private.
      page.postMessage({ source: BOARD_MARK_MESSAGE, ...message }, "*");
    say({ type: "pins", pins: pinned });
    say({
      type: "mode",
      on: pointing,
      color: style.getPropertyValue("--primary").trim(),
      ink: style.getPropertyValue("--primary-foreground").trim(),
    });
  });
  const leave = useStableCallback(() => (marking === undefined ? onRelease() : marking.onStop()));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hears this card's own frame, another document: that its script is ready, or Escape pressed inside it
  useEffect(() => {
    const heard = (event: MessageEvent) => {
      if (event.source === null || event.source !== frameRef.current?.contentWindow) return;
      const message = boardMarkMessage(event.data);
      if (message?.type === "ready") tell(on, pinsJson);
      if (message?.type === "escape") leave();
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [tell, leave, on, pinsJson]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the page's frame, another document, whether it is pointed at and where its pins are
  useEffect(() => {
    tell(on, pinsJson);
  }, [tell, on, pinsJson]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Escape pressed anywhere on the board's own page ends marking up
  useEffect(() => {
    if (!on) return;
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") leave();
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [on, leave]);
  return (
    <>
      <iframe
        ref={frameRef}
        aria-label="Artifact page"
        sandbox="allow-scripts"
        srcDoc={boardPageWithMarks(body)}
        className={cn(
          "min-h-0 w-full flex-1 rounded-b-board border-0 group-data-board-busy/board:pointer-events-none",
          !active && !on && "pointer-events-none",
        )}
        tabIndex={active || on ? 0 : -1}
      />
      {marking === undefined ? null : (
        <ArtifactMarkField
          frameRef={frameRef}
          onAdd={marking.onAdd}
          onDone={() => tell(on, pinsJson)}
        />
      )}
    </>
  );
}

const NO_PINS: ReadonlyArray<BoardMarkPin> = [];

/**
 * While an artifact's page is marked up: what its frame says was picked, and the field that asks
 * what should change there. Enter adds it as a note, Escape drops it, and marking up goes on.
 */
function ArtifactMarkField({
  frameRef,
  onAdd,
  onDone,
}: {
  readonly frameRef: RefObject<HTMLIFrameElement | null>;
  readonly onAdd: ArtifactMarking["onAdd"];
  /** Lets the page outline what is under the pointer again. */
  readonly onDone: () => void;
}) {
  const [picked, setPicked] = useState<{
    readonly pick: BoardMarkPick;
    readonly words: string;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hears what was picked in this card's own frame, another document
  useEffect(() => {
    const heard = (event: MessageEvent) => {
      // Only this card's frame is heard. Its page's own scripts can still fake or change a pick:
      // that only changes what this person sees in their own field before they add it.
      if (event.source === null || event.source !== frameRef.current?.contentWindow) return;
      const message = boardMarkMessage(event.data);
      if (message?.type === "pick") setPicked({ pick: message.pick, words: "" });
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [frameRef]);
  if (picked === null) return null;
  const { rect, mark } = picked.pick;
  const done = () => {
    setPicked(null);
    onDone();
  };
  return (
    <div
      className="absolute z-10 w-60"
      // Under what was picked, as the frame placed it, and always inside the card.
      style={{
        left: `clamp(0.5rem, ${rect.x}px, calc(100% - 15.5rem))`,
        top: `clamp(0.5rem, ${rect.y + rect.height + 6}px, calc(100% - 2.5rem))`,
      }}
      data-board-text
      data-artifact-mark-field
      onPointerDown={stopPointer}
    >
      <Input
        nativeInput
        size="compact"
        aria-label="What should change here?"
        placeholder="What should change here?"
        // Focused without scrolling: on the moved board, the browser would scroll its box.
        ref={(field) => field?.focus({ preventScroll: true })}
        value={picked.words}
        maxLength={ROOM_BOARD_NOTE_MAX_LENGTH - 100}
        onChange={(event) => setPicked({ pick: picked.pick, words: event.target.value })}
        onKeyDown={(event) => {
          // The board's own keys, and Escape ending marking up, stay out of the field.
          event.stopPropagation();
          if (event.key === "Escape") done();
          if (event.key !== "Enter" || picked.words.trim() === "") return;
          event.preventDefault();
          onAdd(mark, picked.words.trim());
          done();
        }}
      />
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
  versionNote = null,
  onKeep,
  active = false,
  onRelease,
  marks,
}: {
  /** Whether the viewer clicked its content to scroll and use it, and what gives the board back. */
  readonly active?: boolean;
  readonly onRelease?: (() => void) | undefined;
  /** Marking up its page. Absent where the viewer may not add to the board. */
  readonly marks?: ArtifactMarking | undefined;
  /** On a live view: makes it its own copy of what it shows, or just stops it following. */
  readonly onKeep?: { readonly label: string; readonly run: () => Promise<boolean> } | undefined;
  /** What tells this card from another of the same box: "Same version as …", or null. */
  readonly versionNote?: string | null;
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
  const [frame, setFrame] = useState(0);
  const page = draft === undefined && artifact !== undefined && isBoardHtmlArtifact(artifact.body);
  const [markingUp, setMarkingUp] = useState(false);
  const marking =
    markingUp && page && marks !== undefined
      ? { ...marks, onStop: () => setMarkingUp(false) }
      : undefined;
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
        onRefresh={page ? () => setFrame((current) => current + 1) : undefined}
        markUp={
          page && marks !== undefined
            ? { on: markingUp, toggle: () => setMarkingUp((current) => !current) }
            : undefined
        }
        people={people}
      />
      {versionNote === null && onKeep === undefined ? null : (
        <div className="flex min-w-0 shrink-0 items-center gap-1.5 px-3 pb-1.5">
          <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{versionNote}</p>
          {onKeep === undefined ? null : (
            <Button
              size="micro"
              variant="ghost-muted"
              onPointerDown={stopPointer}
              onClick={() => void onKeep.run()}
              data-artifact-keep
            >
              {onKeep.label}
            </Button>
          )}
        </div>
      )}
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
      <RoomArtifactBody
        artifact={artifact}
        draft={draft}
        onWrite={edit}
        frame={frame}
        active={active}
        onRelease={onRelease}
        marking={marking}
      />
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
  onRefresh,
  markUp,
  people,
}: {
  /** Turns pointing at parts of a page on and off. Absent for text, and where no one may mark. */
  readonly markUp: { readonly on: boolean; readonly toggle: () => void } | undefined;
  /** Loads a page's frame afresh. Absent for text, which has nothing to reload. */
  readonly onRefresh: (() => void) | undefined;
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
  // When the card was drawn: how long ago it was written is said in words, never a clock time.
  const [now] = useState(() => Date.now());
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
          {[author, artifact.model, boardTimeLabel(artifact.updatedAt, now)?.toLowerCase()]
            .filter((part) => part !== undefined && part !== "")
            .join(" · ")}
        </p>
        {onRefresh === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-micro"
                  variant="ghost-muted"
                  aria-label="Refresh page"
                  onPointerDown={stopPointer}
                  onClick={onRefresh}
                  data-artifact-refresh
                />
              }
            >
              <RefreshCwIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Refresh</TooltipPopup>
          </Tooltip>
        )}
        {markUp === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="micro"
                  variant={markUp.on ? "outline" : "ghost-muted"}
                  aria-pressed={markUp.on}
                  onPointerDown={stopPointer}
                  onClick={markUp.toggle}
                  data-artifact-mark
                />
              }
            >
              {markUp.on ? "Done marking" : "Mark up"}
            </TooltipTrigger>
            <TooltipPopup side="top">
              {markUp.on
                ? "Stop pointing at the page"
                : "Point at part of the page and say what should change. Each becomes a note for your next prompt."}
            </TooltipPopup>
          </Tooltip>
        )}
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
