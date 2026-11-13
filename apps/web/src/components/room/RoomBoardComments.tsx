import {
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoardNote,
} from "@t3tools/contracts";
import { isRoomCardOwnedBy } from "@t3tools/shared/roomBoard";
import { ArrowUpIcon, CircleCheckIcon, RotateCcwIcon, Trash2Icon, XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useLayoutEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { cn } from "~/lib/utils";

import { formatRelativeTimeLabel } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import {
  type BoardPeople,
  type BoardRect,
  type BoardSize,
  boardCommentPanelSpot,
  boardCursorColor,
  boardPersonName,
} from "./roomBoard.logic";
import { useBoardNow } from "./roomBoardLive";

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
}: {
  readonly people: BoardPeople;
  readonly guestId: string | undefined;
  readonly large?: boolean;
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
      {initialOf(people, guestId)}
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
}: {
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly open: boolean;
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
  return (
    <div
      className="group/item absolute size-8 origin-top-left"
      style={{ left: note.x, top: note.y, transform: scale === 1 ? undefined : `scale(${scale})` }}
      data-board-item={itemRef}
    >
      <button
        type="button"
        aria-label={`Comment thread from ${author}${replies === 0 ? "" : `, ${replies} ${replies === 1 ? "reply" : "replies"}`}${note.resolved === true ? ", resolved" : ""}`}
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

function CommentEntry({
  people,
  guestId,
  text,
  at,
  now,
  onRemove,
}: {
  readonly people: BoardPeople;
  readonly guestId: string | undefined;
  readonly text: string;
  readonly at: string | undefined;
  readonly now: number;
  readonly onRemove: (() => void) | undefined;
}) {
  return (
    <li ref={scrollIntoViewOnMount} className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1.5">
        <Avatar people={people} guestId={guestId} />
        <span className="min-w-0 truncate text-xs font-medium">
          {boardPersonName(people, guestId)}
        </span>
        {at === undefined ? null : (
          <time dateTime={at} className="shrink-0 text-2xs text-muted-foreground">
            {formatRelativeTimeLabel(at, now)}
          </time>
        )}
        {onRemove === undefined ? null : (
          <Button
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Delete reply"
            className="ms-auto"
            onClick={onRemove}
          >
            <XIcon />
          </Button>
        )}
      </div>
      <p className="ps-6.5 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]">{text}</p>
    </li>
  );
}

/**
 * An open comment thread, beside its pin: each comment with who wrote it and when, and a field to
 * reply. Escape closes it. `draft` is a thread not on the board yet, whose first comment its
 * field writes.
 */
export function CommentThreadPanel({
  note,
  people,
  draft,
  canEdit,
  pin,
  onSend,
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
  /** Sends the first comment of a draft, or else a reply, and says whether it was taken. */
  readonly onSend: (text: string) => Promise<boolean>;
  readonly onRemoveReply: (replyId: string) => void;
  readonly onResolve: (resolved: boolean) => void;
  /** Absent for whoever may not delete the thread. */
  readonly onDelete: (() => void) | undefined;
  readonly onClose: () => void;
}) {
  const boardNow = useBoardNow();
  // The board's clock ticks only while a run is in flight; otherwise times read from opening.
  const [openedAt] = useState(Date.now);
  const now = Math.max(boardNow, openedAt);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const replies = note.replies ?? [];
  const full = replies.length >= ROOM_BOARD_MAX_REPLIES;
  const resolved = note.resolved === true;
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
  const send = async () => {
    const body = text.trim();
    if (body === "" || sending) return;
    setSending(true);
    const taken = await onSend(body);
    setSending(false);
    if (taken) setText("");
  };
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
        if (event.key !== "Escape") return;
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
            size="icon-micro"
            variant="ghost-muted"
            aria-label="Delete thread"
            onClick={onDelete}
          >
            <Trash2Icon />
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
            people={people}
            guestId={note.guestId}
            text={note.text}
            at={note.createdAt}
            now={now}
            onRemove={undefined}
          />
          {replies.map((reply) => (
            <CommentEntry
              key={reply.id}
              people={people}
              guestId={reply.guestId}
              text={reply.text}
              at={reply.at}
              now={now}
              onRemove={
                canEdit && isRoomCardOwnedBy(reply, people.viewer)
                  ? () => onRemoveReply(reply.id)
                  : undefined
              }
            />
          ))}
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
            autoFocus
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
