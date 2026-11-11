import {
  type GuestId,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoardChange,
  type RoomBoardNote,
  type ThreadGuest,
  type ThreadGuestShare,
  roomBoardAgentCard,
  roomBoardGuestCard,
} from "@t3tools/contracts";
import { ArrowLeftIcon, MinusIcon, PlusIcon, StickyNoteIcon, XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { cn, randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  BOARD_CARD_WIDTH,
  type BoardMessage,
  type BoardPoint,
  type BoardTarget,
  type BoardValue,
  type BoardView,
  EMPTY_ROOM_BOARD,
  INITIAL_BOARD_VIEW,
  NO_BOARD_EDITS,
  boardChangeOf,
  boardConnectorPath,
  boardEditKey,
  dropBoardEdit,
  panBoardBy,
  placeBoardCards,
  putBoardEdit,
  resolveBoard,
  screenToBoard,
  settleBoardValue,
  zoomBoardAt,
} from "./roomBoard.logic";

const guestCardId = (guest: ThreadGuest) => roomBoardGuestCard(guest.id);
const agentCardId = (guest: ThreadGuest) => roomBoardAgentCard(guest.id);
const GRID = 22;

/**
 * Pointer handlers that report how far a held pointer moved, in screen pixels, and when it is
 * let go.
 */
function dragHandlers(onMove: (dx: number, dy: number) => void, onEnd?: () => void) {
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onEnd?.();
  };
  return {
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      // The board under a card must not start panning too.
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    onPointerMove: (event: PointerEvent<HTMLElement>) => {
      if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
      onMove(event.movementX, event.movementY);
    },
    onPointerUp: release,
    onPointerCancel: release,
  };
}

/** What the board shows of a room: who joined, what they wait on, and what is arranged. */
type BoardRoom = Pick<ThreadGuestShare, "guests" | "messages" | "turns" | "board">;

/**
 * A shared thread laid out as a board: the thread, each person in the room, and notes, as cards.
 * The arrangement and the notes are the room's: the owner and every guest see the same ones.
 */
export function RoomBoard({
  title,
  room,
  online,
  messages,
  viewer,
  onOpenThread,
  onChange,
}: {
  readonly title: string;
  /** Null when the thread is not shared, so there is no room to arrange a board for. */
  readonly room: BoardRoom | null;
  readonly online: ReadonlyArray<GuestId>;
  readonly messages: ReadonlyArray<BoardMessage>;
  /** The guest looking at the board, or null for the owner. */
  readonly viewer: GuestId | null;
  readonly onOpenThread: () => void;
  /** Sends one change to the room and says whether it was taken. Absent when they may not. */
  readonly onChange: ((change: RoomBoardChange) => Promise<boolean>) | undefined;
}) {
  const board = room?.board ?? EMPTY_ROOM_BOARD;
  const [edits, setEdits] = useState(NO_BOARD_EDITS);
  // What each drag or draft has reached, read when it is let go. A render may not have caught up.
  const held = useRef(new Map<string, NonNullable<BoardValue>>());
  const [view, setView] = useState(INITIAL_BOARD_VIEW);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const canEdit = room !== null && onChange !== undefined;
  const shown = resolveBoard(board, edits);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wheel listener must be non-passive to stop the browser's own pinch zoom, which React's onWheel cannot be
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const bounds = surface.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      setView((current) =>
        event.ctrlKey || event.metaKey
          ? zoomBoardAt(current, anchor, Math.exp(-event.deltaY / 300))
          : panBoardBy(current, -event.deltaX, -event.deltaY),
      );
    };
    surface.addEventListener("wheel", onWheel, { passive: false });
    return () => surface.removeEventListener("wheel", onWheel);
  }, []);

  const guests = room?.guests ?? [];
  // A guest's agent gets a card once it has posted a turn from their machine.
  const agents = guests.flatMap((guest) => {
    const turns = room?.turns?.filter((turn) => turn.guestId === guest.id) ?? [];
    return turns.length === 0 ? [] : [{ guest, turns }];
  });
  const positions = placeBoardCards(
    [
      ROOM_BOARD_THREAD_CARD,
      ...guests.map(guestCardId),
      ...agents.map(({ guest }) => agentCardId(guest)),
    ],
    shown.positions,
  );
  const send = (target: BoardTarget, value: BoardValue) => {
    if (onChange === undefined) return;
    held.current.delete(boardEditKey(target));
    setEdits((current) => putBoardEdit(board, current, target, value, false));
    void onChange(boardChangeOf(target, value)).then((taken) => {
      if (!taken) setEdits((current) => dropBoardEdit(current, target, value));
    });
  };
  const hold = (target: BoardTarget, value: NonNullable<BoardValue>) => {
    held.current.set(boardEditKey(target), value);
    setEdits((current) => putBoardEdit(board, current, target, value, true));
  };
  // The room hears of a drag or a draft once, when it ends.
  const letGo = (target: BoardTarget) => {
    const value = held.current.get(boardEditKey(target));
    if (value !== undefined) send(target, settleBoardValue(value));
  };
  const dragBy = (target: BoardTarget, from: NonNullable<BoardValue>, dx: number, dy: number) => {
    if (!canEdit) return;
    const at = held.current.get(boardEditKey(target)) ?? from;
    hold(target, { ...at, x: at.x + dx / view.zoom, y: at.y + dy / view.zoom });
  };
  const writeNote = (note: RoomBoardNote, text: string) => {
    const target = { kind: "note", id: note.id } as const;
    hold(target, { ...(held.current.get(boardEditKey(target)) ?? note), text });
  };
  const zoomBy = (factor: number) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const center = { x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 };
    setView((current) => zoomBoardAt(current, center, factor));
  };
  const addNote = () => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const at = screenToBoard(view, { x: (bounds?.width ?? 600) / 2 - 90, y: 96 });
    const id = randomUUID();
    send(
      { kind: "note", id },
      settleBoardValue({ id, text: "", ...at, ...(viewer === null ? {} : { guestId: viewer }) }),
    );
  };
  const noteAuthor = (note: RoomBoardNote) =>
    note.guestId === viewer || (note.guestId === undefined && viewer === null)
      ? "You"
      : note.guestId === undefined
        ? "Owner"
        : (guests.find((guest) => guest.id === note.guestId)?.name ?? "Guest");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden overscroll-none">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onOpenThread}>
          <ArrowLeftIcon />
          Thread
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
          <span className="ms-2 font-normal text-muted-foreground">
            {room === null ? "Not shared" : roomSummary(room, online.length)}
          </span>
        </h1>
        <Button
          size="sm"
          variant="outline"
          disabled={!canEdit || shown.notes.length >= ROOM_BOARD_MAX_NOTES}
          onClick={addNote}
        >
          <StickyNoteIcon />
          Note
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Zoom out"
          onClick={() => zoomBy(1 / 1.2)}
        >
          <MinusIcon />
        </Button>
        <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">
          {Math.round(view.zoom * 100)}%
        </span>
        <Button size="icon-sm" variant="ghost" aria-label="Zoom in" onClick={() => zoomBy(1.2)}>
          <PlusIcon />
        </Button>
      </header>
      <div
        ref={surfaceRef}
        role="application"
        aria-label="Room board"
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-background active:cursor-grabbing"
        style={boardGridStyle(view)}
        {...dragHandlers((dx, dy) => setView((current) => panBoardBy(current, dx, dy)))}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <svg
            aria-hidden
            className="pointer-events-none absolute top-0 left-0 overflow-visible"
            width="1"
            height="1"
          >
            {agents.map(({ guest }) => (
              <path
                key={guest.id}
                d={boardConnectorPath(
                  positions[guestCardId(guest)]!,
                  positions[agentCardId(guest)]!,
                )}
                fill="none"
                stroke="var(--color-border)"
                strokeWidth="1.5"
                strokeDasharray="4 5"
              />
            ))}
          </svg>
          <BoardCard
            at={positions[ROOM_BOARD_THREAD_CARD]!}
            title={title}
            kind="thread"
            id={ROOM_BOARD_THREAD_CARD}
            onMove={dragBy}
            onDrop={letGo}
          >
            <ThreadMessages messages={messages} />
            <div>
              <Button size="xs" variant="outline" onClick={onOpenThread}>
                Open thread
              </Button>
            </div>
          </BoardCard>
          {guests.map((guest) => {
            const id = guestCardId(guest);
            return (
              <BoardCard
                key={id}
                at={positions[id]!}
                title={guest.name}
                kind={online.includes(guest.id) ? "viewing now" : "away"}
                dashed
                id={id}
                onMove={dragBy}
                onDrop={letGo}
              >
                <GuestDetails guest={guest} room={room} viewer={viewer} />
              </BoardCard>
            );
          })}
          {agents.map(({ guest, turns }) => {
            const id = agentCardId(guest);
            const latest = turns.at(-1)!;
            return (
              <BoardCard
                key={id}
                at={positions[id]!}
                title={`${guest.name}'s agent`}
                kind={`${turns.length} turn${turns.length === 1 ? "" : "s"}`}
                id={id}
                onMove={dragBy}
                onDrop={letGo}
              >
                <p className="text-2xs text-muted-foreground">Ran on their machine</p>
                {latest.prompt ? (
                  <p className="line-clamp-2 border-s-2 border-guest/50 ps-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {latest.prompt}
                  </p>
                ) : null}
                <p className="line-clamp-6 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {latest.reply}
                </p>
              </BoardCard>
            );
          })}
          {shown.notes.map((note) => (
            <BoardNote
              key={note.id}
              note={note}
              author={noteAuthor(note)}
              canEdit={canEdit}
              onMove={dragBy}
              onDrop={letGo}
              onText={writeNote}
              onDelete={send}
            />
          ))}
        </div>
        {room === null ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-muted-foreground">
            Share this thread with guests and each person who joins gets a card here.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function roomSummary(room: BoardRoom, online: number): string {
  const joined = room.guests?.length ?? 0;
  if (joined === 0) return "Shared, no one has joined yet";
  return `${joined} guest${joined === 1 ? "" : "s"}, ${online} viewing now`;
}

const boardGridStyle = (view: BoardView) => ({
  backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
  backgroundSize: `${GRID * view.zoom}px ${GRID * view.zoom}px`,
  backgroundPosition: `${view.x}px ${view.y}px`,
});

type DragBy = (target: BoardTarget, from: NonNullable<BoardValue>, dx: number, dy: number) => void;

function BoardNote({
  note,
  author,
  canEdit,
  onMove,
  onDrop,
  onText,
  onDelete,
}: {
  readonly note: RoomBoardNote;
  readonly author: string;
  readonly canEdit: boolean;
  readonly onMove: DragBy;
  readonly onDrop: (target: BoardTarget) => void;
  readonly onText: (note: RoomBoardNote, text: string) => void;
  readonly onDelete: (target: BoardTarget, value: null) => void;
}) {
  const target = { kind: "note", id: note.id } as const;
  return (
    <div
      className="absolute flex w-48 flex-col rounded-sm border border-warning/40 bg-warning-surface text-foreground shadow-lg"
      style={{ left: note.x, top: note.y }}
    >
      <div
        className="flex h-6 cursor-grab items-center gap-1 ps-3 active:cursor-grabbing"
        {...dragHandlers(
          (dx, dy) => onMove(target, note, dx, dy),
          () => onDrop(target),
        )}
      >
        <span className="min-w-0 flex-1 truncate text-2xs opacity-60">{author}</span>
        {canEdit ? (
          <button
            type="button"
            aria-label="Delete note"
            className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => onDelete(target, null)}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <textarea
        aria-label="Note"
        value={note.text}
        readOnly={!canEdit}
        maxLength={ROOM_BOARD_NOTE_MAX_LENGTH}
        rows={4}
        placeholder="Write a note"
        className="resize-none bg-transparent px-3 pb-3 text-sm leading-snug outline-none placeholder:text-placeholder"
        onPointerDown={(event) => event.stopPropagation()}
        onChange={(event) => onText(note, event.target.value)}
        onBlur={() => onDrop(target)}
      />
    </div>
  );
}

function BoardCard({
  at,
  title,
  kind,
  dashed = false,
  id,
  onMove,
  onDrop,
  children,
}: {
  readonly at: BoardPoint;
  readonly title: string;
  readonly kind: string;
  readonly dashed?: boolean;
  readonly id: string;
  readonly onMove: DragBy;
  readonly onDrop: (target: BoardTarget) => void;
  readonly children: ReactNode;
}) {
  const target = { kind: "card", id } as const;
  return (
    <section
      className={cn(
        "absolute flex flex-col rounded-xl border border-border bg-card text-card-foreground shadow-lg",
        dashed && "border-dashed",
      )}
      style={{ left: at.x, top: at.y, width: BOARD_CARD_WIDTH }}
    >
      <header
        className="flex cursor-grab items-center gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
        {...dragHandlers(
          (dx, dy) => onMove(target, at, dx, dy),
          () => onDrop(target),
        )}
      >
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</h2>
        <span className="shrink-0 rounded-full border border-border px-1.5 text-2xs text-muted-foreground">
          {kind}
        </span>
      </header>
      <div className="flex flex-col gap-2 p-3">{children}</div>
    </section>
  );
}

function ThreadMessages({ messages }: { readonly messages: ReadonlyArray<BoardMessage> }) {
  if (messages.length === 0) {
    return <p className="text-xs text-muted-foreground">No messages yet.</p>;
  }
  return (
    <ol className="flex flex-col gap-2">
      {messages.map((message) => (
        <li key={message.id} className="text-xs">
          <span className="font-medium text-muted-foreground">{message.author ?? "Agent"}</span>
          <p className="line-clamp-3 [overflow-wrap:anywhere]">{message.text}</p>
        </li>
      ))}
    </ol>
  );
}

function GuestDetails({
  guest,
  room,
  viewer,
}: {
  readonly guest: ThreadGuest;
  readonly room: BoardRoom | null;
  readonly viewer: GuestId | null;
}) {
  const waiting =
    room?.messages.filter(
      (message) => message.guestId === guest.id && message.status === "pending",
    ) ?? [];
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {guest.account === undefined ? "Not signed in" : `@${guest.account.login}`}
        {guest.trusted === true ? " · sends without asking" : ""}
      </p>
      {waiting.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {viewer === null ? "Nothing waiting for you." : "Nothing waiting for the owner."}
        </p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {waiting.map((message) => (
            <li
              key={message.id}
              className="line-clamp-3 rounded-md border border-dashed border-border px-2 py-1 text-xs [overflow-wrap:anywhere]"
            >
              {message.text || "Sent files"}
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
