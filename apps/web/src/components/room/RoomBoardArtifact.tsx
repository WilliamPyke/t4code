import {
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  isRoomBoardUrl,
  type RoomArtifactContent,
  type RoomBoardMark,
  type RoomBoxProgress,
} from "@t3tools/contracts";
import { CodeXmlIcon, PenLineIcon, RefreshCwIcon, RotateCcwIcon } from "lucide-react";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import { boardTimeLabel } from "../boards/boardsHome.logic";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardChip } from "./BoardChrome";
import {
  BOARD_MARK_MESSAGE,
  type BoardMarkPick,
  type BoardMarkPin,
  type BoardPageLink,
  type BoardPageLinkSaid,
  boardMarkMessage,
  boardPageLinkOf,
  boardPageWithMarks,
} from "./boardMark.logic";
import { boardOwnHosts } from "./boardFrameCheck";
import { BoardContextMenu, type CardAction } from "./RoomBoardCardMenu";
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

/** The links in an artifact's page, and what a card one of them opened shows first. */
export interface ArtifactLinks {
  /** The spot its page opens scrolled to: this viewer's alone, for this visit. */
  readonly spot?: string | undefined;
  /** Whether it is the empty card of a page a link named, which says how to get it written. */
  readonly unmade?: boolean | undefined;
  /** Adds a card beside this one for what a link leads to. Absent for whoever may not add. */
  readonly onOpenBeside?: ((link: BoardPageLink) => void) | undefined;
}

// Opened by the board, never by the page: only an http or https address, with no way back to us.
const openInNewTab = (url: string) => {
  if (isRoomBoardUrl(url)) window.open(url, "_blank", "noopener,noreferrer");
};

const copyLink = (text: string) =>
  void navigator.clipboard.writeText(text).then(
    () => toastManager.add({ type: "info", title: "Link copied" }),
    () => toastManager.add({ type: "info", title: "Could not copy the link" }),
  );

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
  links,
}: {
  /** What its page's links open, and where its page starts. */
  readonly links?: ArtifactLinks | undefined;
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
          {links?.unmade === true
            ? "This page isn't made yet. Ask your agent to write it: the first page goes along as context."
            : "Nothing here yet. Draw a line from a thread box to this card, or use Attach my agent, then prompt that box. Its reply shows here for everyone. A line from another artifact makes this a live view of it."}
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
            links={links}
            onRelease={onRelease}
          />
        ) : (
          <ArtifactText body={artifact.body} links={links} />
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
  links,
  onRelease,
}: {
  readonly body: string;
  readonly active: boolean;
  readonly marking: (ArtifactMarking & { readonly onStop: () => void }) | undefined;
  readonly links: ArtifactLinks | undefined;
  readonly onRelease: () => void;
}) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const linkMenu = usePressedLink();
  const spot = links?.spot;
  const tellSpot = useStableCallback(() => {
    if (spot === undefined) return;
    frameRef.current?.contentWindow?.postMessage(
      { source: BOARD_MARK_MESSAGE, type: "scroll", id: spot },
      "*",
    );
  });
  // What the page says is only read: the menu is the board's own, at the pointer on our screen,
  // which the frame's pixels reach through the board's zoom.
  const pressLink = useStableCallback((said: BoardPageLinkSaid) => {
    const frame = frameRef.current;
    const link = boardPageLinkOf(said, boardOwnHosts());
    if (frame === null || link === null) return;
    const drawn = frame.getBoundingClientRect();
    const scale = frame.offsetWidth === 0 ? 1 : drawn.width / frame.offsetWidth;
    linkMenu.press(link, {
      x: drawn.left + Math.min(said.x, frame.offsetWidth) * scale,
      y: drawn.top + Math.min(said.y, frame.offsetHeight) * scale,
    });
  });
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
      if (message?.type === "ready") {
        tell(on, pinsJson);
        tellSpot();
      }
      if (message?.type === "escape") leave();
      // While marking up, a press picks a part of the page and this menu stays shut.
      if (message?.type === "link" && !on) pressLink(message.link);
    };
    window.addEventListener("message", heard);
    return () => window.removeEventListener("message", heard);
  }, [tell, tellSpot, pressLink, leave, on, pinsJson]);
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
      {on ? null : <ArtifactLinkMenu menu={linkMenu} onOpenBeside={links?.onOpenBeside} />}
    </>
  );
}

const NO_PINS: ReadonlyArray<BoardMarkPin> = [];

interface PressedLink {
  readonly link: BoardPageLink;
  /** Where the pointer was, on our own screen. */
  readonly at: { readonly x: number; readonly y: number };
  /** Tells one press from the next at the same spot, so each opens a menu of its own. */
  readonly press: number;
}

/** The link someone last pressed in an artifact, while its menu is open. */
function usePressedLink() {
  const [pressed, setPressed] = useState<PressedLink | null>(null);
  const presses = useRef(0);
  return {
    pressed,
    press: (link: BoardPageLink, at: PressedLink["at"]) => {
      presses.current += 1;
      setPressed({ link, at, press: presses.current });
    },
    // Only the menu that closed: a later press may have opened another by then.
    close: (closed: PressedLink) => setPressed((open) => (open === closed ? null : open)),
  };
}

/**
 * The board's own menu for a link pressed in an artifact: a card beside it for whoever may add
 * to the board, a new tab for an http or https address, and Copy link.
 */
function ArtifactLinkMenu({
  menu: { pressed, close },
  onOpenBeside,
}: {
  readonly menu: ReturnType<typeof usePressedLink>;
  readonly onOpenBeside: ArtifactLinks["onOpenBeside"];
}) {
  if (pressed === null) return null;
  const { link } = pressed;
  const actions: ReadonlyArray<CardAction> = [
    ...(onOpenBeside === undefined || link.kind === "tab" || link.kind === "other"
      ? []
      : [{ label: "Open beside this artifact", run: () => onOpenBeside(link) }]),
    ...(link.kind === "site" || link.kind === "tab"
      ? [{ label: "Open in a new tab", run: () => openInNewTab(link.url) }]
      : []),
    { label: "Copy link", run: () => copyLink(link.copy) },
  ];
  return (
    // The menu is drawn elsewhere on the page, but what happens in it still reaches the card.
    <div
      className="contents"
      onPointerDown={stopPointer}
      onKeyDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <BoardContextMenu
        key={pressed.press}
        at={pressed.at}
        card={undefined}
        groups={[actions]}
        onClose={() => close(pressed)}
      />
    </div>
  );
}

/**
 * An artifact's Markdown. A right-click on a link to another site opens the board's menu in
 * place of the chat's, so it too can open beside the card; any other link keeps what it had.
 */
function ArtifactText({
  body,
  links,
}: {
  readonly body: string;
  readonly links: ArtifactLinks | undefined;
}) {
  const linkMenu = usePressedLink();
  return (
    <div
      data-board-scroll
      data-board-text
      className="min-h-0 flex-1 cursor-auto overflow-auto px-3 py-2"
      onPointerDown={stopPointer}
      onContextMenuCapture={(event) => {
        const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
        if (!(anchor instanceof HTMLAnchorElement)) return;
        const link = boardPageLinkOf(
          { href: anchor.getAttribute("href") ?? "", url: anchor.href, text: anchor.innerText },
          boardOwnHosts(),
        );
        if (link?.kind !== "site" && link?.kind !== "tab") return;
        event.preventDefault();
        event.stopPropagation();
        linkMenu.press(link, { x: event.clientX, y: event.clientY });
      }}
    >
      <ChatMarkdown text={body} cwd={undefined} />
      <ArtifactLinkMenu menu={linkMenu} onOpenBeside={links?.onOpenBeside} />
    </div>
  );
}

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
  links,
}: {
  /** What its page's links open, where its page starts, and whether it is a page not yet made. */
  readonly links?: ArtifactLinks | undefined;
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
      <RoomArtifactToolbar
        artifact={artifact}
        onRestore={onRestore}
        onEdit={edit}
        onRefresh={page ? () => setFrame((current) => current + 1) : undefined}
        markUp={
          page && marks !== undefined
            ? { on: markingUp, toggle: () => setMarkingUp((current) => !current) }
            : undefined
        }
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
        links={links}
      />
      <RoomArtifactMeta author={author} artifact={artifact} people={people} />
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
 * An artifact's actions, in a bar floating above the card while it is hovered, focused or
 * selected: reload its page, mark it up, write it by hand, and go back to the version it replaced
 * (or forward again). Out of sight it takes no presses, so the board above the card stays the
 * board's.
 */
function RoomArtifactToolbar({
  artifact,
  onRestore,
  onEdit,
  onRefresh,
  markUp,
}: {
  /** Turns pointing at parts of a page on and off. Absent for text, and where no one may mark. */
  readonly markUp: { readonly on: boolean; readonly toggle: () => void } | undefined;
  /** Loads a page's frame afresh. Absent for text, which has nothing to reload. */
  readonly onRefresh: (() => void) | undefined;
  readonly artifact: RoomArtifactContent | undefined;
  /** Swaps in the version it replaced. Absent when there is none, or the viewer may not. */
  readonly onRestore: (() => Promise<boolean>) | undefined;
  /** Opens the field to change its text by hand. */
  readonly onEdit: (() => void) | undefined;
}) {
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    if (onRestore === undefined || restoring) return;
    setRestoring(true);
    await onRestore().catch(() => false);
    setRestoring(false);
  };
  const restorable = onRestore !== undefined && artifact !== undefined;
  if (onRefresh === undefined && markUp === undefined && onEdit === undefined && !restorable) {
    return null;
  }
  return (
    <div
      data-artifact-toolbar
      className={cn(
        // Its gap is its own padding, so the pointer crosses from the card to it without leaving.
        "pointer-events-none invisible absolute bottom-full left-1/2 z-20 flex -translate-x-1/2 pb-2.5",
        "[@media(hover:hover)]:group-hover/item:pointer-events-auto [@media(hover:hover)]:group-hover/item:visible",
        "group-focus-within/item:pointer-events-auto group-focus-within/item:visible",
        "group-data-[board-selected]/item:pointer-events-auto group-data-[board-selected]/item:visible",
        "has-[[data-popup-open]]:pointer-events-auto has-[[data-popup-open]]:visible",
        markUp?.on === true && "pointer-events-auto visible",
      )}
      onPointerDown={stopPointer}
    >
      <div className="flex items-center gap-0.5 rounded-xl border border-board-hairline bg-card p-1 whitespace-nowrap text-card-foreground shadow-board">
        {onRefresh === undefined ? null : (
          <Button
            size="xs"
            variant="ghost"
            aria-label="Refresh page"
            onClick={onRefresh}
            data-artifact-refresh
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        )}
        {markUp === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="xs"
                  variant={markUp.on ? "secondary" : "ghost"}
                  aria-pressed={markUp.on}
                  onClick={markUp.toggle}
                  data-artifact-mark
                />
              }
            >
              <PenLineIcon />
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
          <Button size="xs" variant="ghost" onClick={onEdit} data-artifact-edit>
            <CodeXmlIcon />
            Edit
          </Button>
        )}
        {!restorable || artifact === undefined ? null : (
          <>
            <span aria-hidden className="mx-0.5 h-4.5 w-px shrink-0 bg-board-hairline" />
            <Button size="xs" variant="ghost" disabled={restoring} onClick={() => void restore()}>
              <RotateCcwIcon />
              {restoring
                ? "Restoring..."
                : artifact.previous === undefined
                  ? "Restore previous"
                  : boardRestoreLabel({ ...artifact, previous: artifact.previous })}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Who wrote an artifact's current version and when, and what they asked with which cards and
 * model, under what it shows.
 */
function RoomArtifactMeta({
  author,
  artifact,
  people,
}: {
  /** Absent before anything was written. */
  readonly author: string | undefined;
  readonly artifact: RoomArtifactContent | undefined;
  readonly people: BoardPeople;
}) {
  // When the card was drawn: how long ago it was written is said in words, never a clock time.
  const [now] = useState(() => Date.now());
  if (author === undefined || artifact === undefined) return null;
  const cards = artifact.cards ?? [];
  return (
    <div className="flex shrink-0 flex-col gap-0.5 border-t border-board-hairline px-3 py-2">
      <p className="min-w-0 truncate text-2xs text-muted-foreground">
        {[author, artifact.model, boardTimeLabel(artifact.updatedAt, now)?.toLowerCase()]
          .filter((part) => part !== undefined && part !== "")
          .join(" · ")}
      </p>
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
