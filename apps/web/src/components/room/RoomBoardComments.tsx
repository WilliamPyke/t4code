import {
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoardNote,
  type RoomBoardReply,
} from "@t3tools/contracts";
import { shouldPreserveAssistantLineBreaks } from "@t3tools/shared/markdownPipeline";
import { isRoomCardOwnedBy } from "@t3tools/shared/roomBoard";
import {
  ArrowUpIcon,
  BotIcon,
  CircleCheckIcon,
  RotateCcwIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

import { formatRecentTimestamp } from "../../timestampFormat";
import ChatMarkdown from "../ChatMarkdown";
import { useInlineActionConfirm } from "../pullRequest/useInlineActionConfirm";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Textarea } from "../ui/textarea";
import {
  type BoardPeople,
  type BoardRect,
  type BoardSize,
  boardCommentAgentAuthor,
  boardCommentPanelSpot,
  boardCommentReplying,
  boardCursorColor,
  boardPersonName,
} from "./roomBoard.logic";
import {
  boardLiveRect,
  boardLiveStyle,
  useBoardLiveDrag,
  useBoardNow,
  useCommentProgress,
} from "./roomBoardLive";

// How far a held pointer goes before a press on a pin is a drag, not a click, in screen pixels.
const DRAG_SLOP = 4;

/** The first letter of someone's own name, never of "You". */
function initialOf(people: BoardPeople, guestId: string | undefined): string {
  const name =
    guestId === undefined
      ? (people.ownerName ?? "Owner")
      : (people.guests.find((guest) => guest.id === guestId)?.name ?? "Guest");
  return Array.from(name.trim())[0]?.toUpperCase() ?? "?";
}

function Avatar({
  people,
  guestId,
  large = false,
  agent = false,
}: {
  readonly people: BoardPeople;
  readonly guestId: string | undefined;
  readonly large?: boolean;
  /** Whose agent it is: a bot in their colour instead of their initial. */
  readonly agent?: boolean;
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-full font-semibold text-background",
        large ? "size-full text-sm" : "size-5 text-2xs",
      )}
      style={{ backgroundColor: boardCursorColor(people.guests, guestId) }}
    >
      {agent ? <BotIcon className="size-3" /> : initialOf(people, guestId)}
    </span>
  );
}

/** The sign on a pin that an agent is answering in its thread now. */
function AgentAnswering({ noteId }: { readonly noteId: string }) {
  if (useCommentProgress(noteId) === undefined) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -right-1.5 -bottom-1.5 grid size-4 place-items-center rounded-full border border-border bg-card text-card-foreground"
    >
      <BotIcon className="size-2.5" />
    </span>
  );
}

/**
 * A comment thread on the board: a pin with its author's initial and how many replies it has.
 * Pressing it opens the thread; holding and moving it moves it.
 */
export function CommentPin({
  note,
  people,
  open,
  scale,
  itemRef,
  handle,
  movable,
  onDrag,
  onDrop,
  onToggle,
  unread,
}: {
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly open: boolean;
  /** Has a reply this viewer has not seen on this device. */
  readonly unread: boolean;
  /** Keeps the pin a readable size on screen whatever the zoom. */
  readonly scale: number;
  /** The pin as lines name it. */
  readonly itemRef: string;
  /** The grip a line is drawn from, for whoever may edit the board. */
  readonly handle: ReactNode;
  /** False when the viewer cannot edit, or the thread is not on the board yet. */
  readonly movable: boolean;
  readonly onDrag: (note: RoomBoardNote, dx: number, dy: number) => void;
  readonly onDrop: (note: RoomBoardNote) => void;
  readonly onToggle: (note: RoomBoardNote) => void;
}) {
  const press = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const replies = note.replies?.length ?? 0;
  const author = boardPersonName(people, note.guestId);
  const release = (event: PointerEvent<HTMLButtonElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const moved = press.current?.moved === true;
    press.current = null;
    if (moved) onDrop(note);
    else if (event.type === "pointerup") onToggle(note);
  };
  const live = boardLiveRect(note, useBoardLiveDrag(itemRef));
  return (
    <div
      className="group/item absolute size-8 origin-top-left"
      style={{
        left: note.x,
        top: note.y,
        transform: scale === 1 ? undefined : `scale(${scale})`,
        ...boardLiveStyle(note, live, scale),
      }}
      data-board-item={itemRef}
      data-board-pin
    >
      <button
        type="button"
        aria-label={`Comment thread from ${author}${replies === 0 ? "" : `, ${replies} ${replies === 1 ? "reply" : "replies"}`}${unread ? ", new replies" : ""}${note.resolved === true ? ", resolved" : ""}`}
        aria-expanded={open}
        className={cn(
          "size-8 cursor-pointer touch-none overflow-hidden rounded-full rounded-bl-none border-2 border-background shadow-md",
          note.resolved === true && "opacity-50",
          open && "ring-2 ring-primary",
        )}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          // The board under a pin must not pan or close the thread.
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          press.current = { x: event.clientX, y: event.clientY, moved: false };
        }}
        onPointerMove={(event) => {
          const held = press.current;
          if (held === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
          if (!movable) return;
          if (held.moved) return onDrag(note, event.movementX, event.movementY);
          const dx = event.clientX - held.x;
          const dy = event.clientY - held.y;
          if (Math.hypot(dx, dy) < DRAG_SLOP) return;
          held.moved = true;
          onDrag(note, dx, dy);
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onClick={(event) => {
          // A pointer's press is handled when it is let go; this is the keyboard's.
          if (event.detail === 0) onToggle(note);
        }}
      >
        <Avatar people={people} guestId={note.guestId} large />
      </button>
      <AgentAnswering noteId={note.id} />
      {unread ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-0.5 -left-0.5 size-2.5 rounded-full border-2 border-background bg-primary"
        />
      ) : null}
      {replies === 0 ? null : (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1.5 -right-1.5 grid h-4 min-w-4 place-items-center rounded-full border border-border bg-card px-1 text-3xs leading-none font-medium text-card-foreground tabular-nums"
        >
          {replies}
        </span>
      )}
      {handle}
    </div>
  );
}

const scrollIntoViewOnMount = (element: HTMLElement | null) =>
  element?.scrollIntoView({ block: "nearest" });

type InlineConfirm = ReturnType<typeof useInlineActionConfirm>;

function CommentEntry({
  id,
  people,
  guestId,
  agent,
  text,
  at,
  now,
  confirm,
  onRemove,
}: {
  /** Names the entry to the confirm its delete button asks for. */
  readonly id: string;
  readonly people: BoardPeople;
  readonly guestId: string | undefined;
  /** Set on an agent's answer: `guestId` is then whose agent. */
  readonly agent?: RoomBoardReply["agent"];
  readonly text: string;
  readonly at: string | undefined;
  readonly now: number;
  readonly confirm: InlineConfirm;
  readonly onRemove: (() => void) | undefined;
}) {
  const armed = confirm.isArmed(id);
  return (
    <li ref={scrollIntoViewOnMount} className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <Avatar people={people} guestId={guestId} agent={agent !== undefined} />
        <span className="min-w-0 truncate text-xs font-medium">
          {agent === undefined
            ? boardPersonName(people, guestId)
            : boardCommentAgentAuthor({ guestId, agent }, people)}
        </span>
        {at === undefined ? null : (
          <time dateTime={at} className="shrink-0 text-2xs text-muted-foreground">
            {formatRecentTimestamp(at, "locale", now)}
          </time>
        )}
        {onRemove === undefined ? null : (
          <Button
            size={armed ? "micro" : "icon-micro"}
            variant={armed ? "destructive-outline" : "ghost-muted"}
            aria-label={armed ? "Confirm delete reply" : "Delete reply"}
            className="ms-auto"
            {...confirm.props(id, onRemove)}
          >
            <XIcon />
            {armed ? "Delete?" : null}
          </Button>
        )}
      </div>
      {agent === undefined ? (
        <p className="ps-6.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
      ) : (
        // An agent's answer is markdown from someone's machine, so without raw HTML.
        <div className="min-w-0 ps-6.5 text-sm [overflow-wrap:anywhere]">
          <ChatMarkdown
            text={text}
            cwd={undefined}
            lineBreaks={shouldPreserveAssistantLineBreaks(text)}
            parseRawHtml={false}
          />
        </div>
      )}
    </li>
  );
}

/** The line at the end of an open thread while an agent answers it, with what it is doing. */
function AgentReplying({
  noteId,
  people,
}: {
  readonly noteId: string;
  readonly people: BoardPeople;
}) {
  const progress = useCommentProgress(noteId);
  if (progress === undefined) return null;
  return (
    <li
      ref={scrollIntoViewOnMount}
      className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground"
    >
      <Avatar people={people} guestId={progress.guestId} agent />
      <span className="min-w-0 truncate">{boardCommentReplying(progress, people)}</span>
    </li>
  );
}

/**
 * An open comment thread, beside its pin: each comment with who wrote it and when, and a field to
 * reply. Escape closes it. `draft` is a thread not on the board yet, whose first comment its
 * field writes. `askBoxes` are the viewer's own thread boxes, whose agent they can ask to answer.
 */
export function CommentThreadPanel({
  note,
  people,
  draft,
  canEdit,
  pin,
  askBoxes,
  onSend,
  onAsk,
  onRemoveReply,
  onResolve,
  onDelete,
  onClose,
}: {
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly draft: boolean;
  readonly canEdit: boolean;
  /** Where the pin is on the board's surface, in screen pixels. */
  readonly pin: BoardRect;
  readonly askBoxes: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  /** Sends the first comment of a draft, or else a reply, and says whether it was taken. */
  readonly onSend: (text: string) => Promise<boolean>;
  /**
   * Posts `text` as a reply, when there is any, then asks a box's agent to answer the thread.
   * Says whether the field can be cleared.
   */
  readonly onAsk: (boxId: string, text: string) => Promise<boolean>;
  readonly onRemoveReply: (replyId: string) => void;
  readonly onResolve: (resolved: boolean) => void;
  /** Absent for whoever may not delete the thread. */
  readonly onDelete: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const boardNow = useBoardNow();
  // The board's clock ticks only while a run is in flight, so the one open thread keeps its own.
  const [openNow, setOpenNow] = useState(Date.now);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wall-clock tick so "2m ago" stays true while the thread is open
  useEffect(() => {
    const timer = window.setInterval(() => setOpenNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const now = Math.max(boardNow, openNow);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const replies = note.replies ?? [];
  const full = replies.length >= ROOM_BOARD_MAX_REPLIES;
  const resolved = note.resolved === true;
  const confirm = useInlineActionConfirm(note.id);
  const deleteArmed = confirm.isArmed("thread");
  const panel = useRef<HTMLElement | null>(null);
  const [area, setArea] = useState<BoardSize | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the thread inside the board, whose size only the browser knows, before it paints
  useLayoutEffect(() => {
    const board = panel.current?.parentElement;
    if (board === null || board === undefined) return;
    const measure = () => setArea({ width: board.clientWidth, height: board.clientHeight });
    measure();
    return observeResize(board, measure);
  }, []);
  const spot = area === null ? null : boardCommentPanelSpot(pin, area);
  const placed = spot !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the field cannot take focus while the panel is hidden for measuring, so it is focused once placed
  useLayoutEffect(() => {
    if (placed) panel.current?.querySelector("textarea")?.focus();
  }, [placed]);
  const send = async () => {
    const body = text.trim();
    if (body === "" || sending) return;
    setSending(true);
    const taken = await onSend(body);
    setSending(false);
    if (taken) setText("");
  };
  const ask = async (boxId: string) => {
    if (sending) return;
    setSending(true);
    const taken = await onAsk(boxId, text.trim());
    setSending(false);
    if (taken) setText("");
  };
  // The question and the answer each take a reply.
  const canAsk =
    !draft &&
    askBoxes.length > 0 &&
    replies.length + (text.trim() === "" ? 1 : 2) <= ROOM_BOARD_MAX_REPLIES;
  return (
    <section
      ref={panel}
      aria-label={draft ? "New comment" : "Comment thread"}
      data-board-overlay
      className={cn(
        "absolute z-30 flex w-72 cursor-default flex-col rounded-lg border border-border bg-popover text-popover-foreground shadow-lg",
        spot === null && "invisible",
      )}
      style={
        spot === null
          ? undefined
          : { left: spot.left, top: spot.top, bottom: spot.bottom, maxHeight: spot.maxHeight }
      }
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        // A menu opened from the thread is portalled elsewhere, and closes itself.
        const inside = event.target instanceof Node && event.currentTarget.contains(event.target);
        if (event.key !== "Escape" || !inside) return;
        event.stopPropagation();
        onClose();
      }}
    >
      <header className="flex shrink-0 items-center gap-1 border-b border-border py-1.5 ps-3 pe-1.5">
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium">
          {draft ? "New comment" : resolved ? "Resolved" : "Comment"}
        </h2>
        {draft || !canEdit ? null : (
          <Button size="micro" variant="outline" onClick={() => onResolve(!resolved)}>
            {resolved ? <RotateCcwIcon /> : <CircleCheckIcon />}
            {resolved ? "Reopen" : "Resolve"}
          </Button>
        )}
        {draft || onDelete === undefined ? null : (
          <Button
            size={deleteArmed ? "micro" : "icon-micro"}
            variant={deleteArmed ? "destructive-outline" : "ghost-muted"}
            aria-label={deleteArmed ? "Confirm delete thread" : "Delete thread"}
            {...(replies.length === 0 ? { onClick: onDelete } : confirm.props("thread", onDelete))}
          >
            <Trash2Icon />
            {deleteArmed ? "Delete?" : null}
          </Button>
        )}
        <Button size="icon-micro" variant="ghost-muted" aria-label="Close" onClick={onClose}>
          <XIcon />
        </Button>
      </header>
      {draft ? null : (
        <ol
          data-board-scroll
          className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-2.5"
        >
          <CommentEntry
            id="first"
            people={people}
            guestId={note.guestId}
            text={note.text}
            at={note.createdAt}
            now={now}
            confirm={confirm}
            onRemove={undefined}
          />
          {replies.map((reply) => (
            <CommentEntry
              key={reply.id}
              id={`reply:${reply.id}`}
              people={people}
              guestId={reply.guestId}
              agent={reply.agent}
              text={reply.text}
              at={reply.at}
              now={now}
              confirm={confirm}
              onRemove={
                canEdit && isRoomCardOwnedBy(reply, people.viewer)
                  ? () => onRemoveReply(reply.id)
                  : undefined
              }
            />
          ))}
          <AgentReplying noteId={note.id} people={people} />
        </ol>
      )}
      {!canEdit ? null : full ? (
        <p className="shrink-0 border-t border-border px-3 py-2 text-2xs text-muted-foreground">
          This thread holds {ROOM_BOARD_MAX_REPLIES} replies. Start a new one to keep talking.
        </p>
      ) : (
        <form
          className={cn("flex shrink-0 items-end gap-1.5 p-2", !draft && "border-t border-border")}
          onSubmit={(event) => {
            event.preventDefault();
            void send();
          }}
        >
          <Textarea
            size="sm"
            rows={1}
            aria-label={draft ? "Comment" : "Reply"}
            placeholder={draft ? "Add a comment" : "Reply"}
            value={text}
            readOnly={sending}
            maxLength={ROOM_BOARD_NOTE_MAX_LENGTH}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              void send();
            }}
          />
          {text.length < ROOM_BOARD_NOTE_MAX_LENGTH - 40 ? null : (
            <span className="shrink-0 pb-1.5 text-2xs text-muted-foreground tabular-nums">
              {text.length}/{ROOM_BOARD_NOTE_MAX_LENGTH}
            </span>
          )}
          {canAsk ? (
            <Menu>
              <MenuTrigger
                disabled={sending}
                render={<Button size="icon-sm" variant="ghost-muted" aria-label="Ask an agent" />}
              >
                <BotIcon />
              </MenuTrigger>
              <MenuPopup align="end" side="top">
                {askBoxes.map((box) => (
                  <MenuItem key={box.id} onClick={() => void ask(box.id)}>
                    {box.label}
                  </MenuItem>
                ))}
              </MenuPopup>
            </Menu>
          ) : null}
          <Button
            type="submit"
            size="icon-sm"
            aria-label={draft ? "Post comment" : "Send reply"}
            disabled={text.trim() === "" || sending}
          >
            <ArrowUpIcon />
          </Button>
        </form>
      )}
    </section>
  );
}
