import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef, ThreadGuest, ThreadGuestShare } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ArrowLeftIcon, MinusIcon, PlusIcon, StickyNoteIcon, XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from "react";

import { cn, randomUUID } from "~/lib/utils";
import {
  useQuietThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";

import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import {
  BOARD_CARD_WIDTH,
  BOARD_NOTE_MAX_LENGTH,
  type BoardPoint,
  type BoardView,
  EMPTY_BOARD_LAYOUT,
  INITIAL_BOARD_VIEW,
  addBoardNote,
  boardConnectorPath,
  boardLayoutStorageKey,
  boardMessages,
  moveBoardCard,
  panBoardBy,
  parseBoardLayout,
  placeBoardCards,
  removeBoardNote,
  screenToBoard,
  serializeBoardLayout,
  updateBoardNote,
  zoomBoardAt,
} from "./roomBoard.logic";

const THREAD_CARD = "thread";
const guestCardId = (guest: ThreadGuest) => `guest:${guest.id}`;
const agentCardId = (guest: ThreadGuest) => `agent:${guest.id}`;
const GRID = 22;
const THREAD_MESSAGE_COUNT = 3;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // The arrangement then lasts until the page closes.
  }
}

/** Pointer handlers that report how far a held pointer moved, in screen pixels. */
function dragHandlers(onMove: (dx: number, dy: number) => void) {
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
    onPointerUp: (event: PointerEvent<HTMLElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
  };
}

/**
 * A shared thread laid out as a board: the thread, each person in the room, and notes, as cards
 * the owner arranges. The arrangement and the notes stay on this device.
 */
export function RoomBoard({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const share = useQuietThreadProjection(threadRef)?.projection.thread.guestShare ?? null;
  const items = useThreadVisibleTurnItems(threadRef);
  const { data: presence } = useEnvironmentQuery(
    serverEnvironment.guestPresence({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const storageKey = boardLayoutStorageKey(scopedThreadKey(threadRef));
  const [layout, setLayout] = useState(() => parseBoardLayout(readStored(storageKey)));
  const [view, setView] = useState(INITIAL_BOARD_VIEW);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves the arrangement to localStorage, which lives outside React
  useEffect(() => {
    if (layout !== EMPTY_BOARD_LAYOUT) writeStored(storageKey, serializeBoardLayout(layout));
  }, [layout, storageKey]);

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

  const guests = share?.guests ?? [];
  // A guest's agent gets a card once it has posted a turn from their machine.
  const agents = guests.flatMap((guest) => {
    const turns = share?.turns?.filter((turn) => turn.guestId === guest.id) ?? [];
    return turns.length === 0 ? [] : [{ guest, turns }];
  });
  const positions = placeBoardCards(
    [THREAD_CARD, ...guests.map(guestCardId), ...agents.map(({ guest }) => agentCardId(guest))],
    layout.positions,
  );
  const moveCard = (id: string, from: BoardPoint) =>
    dragHandlers((dx, dy) =>
      setLayout((current) => {
        const at = current.positions[id] ?? from;
        return moveBoardCard(current, id, { x: at.x + dx / view.zoom, y: at.y + dy / view.zoom });
      }),
    );
  const zoomBy = (factor: number) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const center = { x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 };
    setView((current) => zoomBoardAt(current, center, factor));
  };
  const addNote = () => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const at = screenToBoard(view, { x: (bounds?.width ?? 600) / 2 - 90, y: 96 });
    setLayout(addBoardNote(layout, { id: randomUUID(), text: "", x: at.x, y: at.y }));
  };
  const openThread = () =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
    });

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-none">
      <header className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="ghost" onClick={openThread}>
          <ArrowLeftIcon />
          Thread
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {shell?.title ?? "Board"}
          <span className="ms-2 font-normal text-muted-foreground">
            {share === null ? "Not shared" : roomSummary(share, presence?.online.length ?? 0)}
          </span>
        </h1>
        <span className="hidden text-xs text-muted-foreground md:inline">
          Your arrangement and notes stay on this device
        </span>
        <Button size="sm" variant="outline" onClick={addNote}>
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
            at={positions[THREAD_CARD]!}
            title={shell?.title ?? "Thread"}
            kind="thread"
            drag={moveCard(THREAD_CARD, positions[THREAD_CARD]!)}
          >
            <ThreadMessages items={items} />
            <div>
              <Button size="xs" variant="outline" onClick={openThread}>
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
                kind={presence?.online.includes(guest.id) ? "viewing now" : "away"}
                dashed
                drag={moveCard(id, positions[id]!)}
              >
                <GuestDetails guest={guest} share={share} />
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
                drag={moveCard(id, positions[id]!)}
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
          {layout.notes.map((note) => (
            <div
              key={note.id}
              className="absolute flex w-48 flex-col rounded-sm border border-warning/40 bg-warning-surface text-foreground shadow-lg"
              style={{ left: note.x, top: note.y }}
            >
              <div
                className="flex h-6 cursor-grab items-center justify-end ps-2 active:cursor-grabbing"
                {...dragHandlers((dx, dy) =>
                  setLayout((current) => {
                    const at = current.notes.find((other) => other.id === note.id) ?? note;
                    return updateBoardNote(current, note.id, {
                      x: at.x + dx / view.zoom,
                      y: at.y + dy / view.zoom,
                    });
                  }),
                )}
              >
                <button
                  type="button"
                  aria-label="Delete note"
                  className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
                  onPointerDown={(event) => event.stopPropagation()}
                  onClick={() => setLayout(removeBoardNote(layout, note.id))}
                >
                  <XIcon className="size-3.5" />
                </button>
              </div>
              <textarea
                aria-label="Note"
                value={note.text}
                maxLength={BOARD_NOTE_MAX_LENGTH}
                rows={4}
                placeholder="Write a note"
                className="resize-none bg-transparent px-3 pb-3 text-sm leading-snug outline-none placeholder:text-placeholder"
                onPointerDown={(event) => event.stopPropagation()}
                onChange={(event) =>
                  setLayout(updateBoardNote(layout, note.id, { text: event.target.value }))
                }
              />
            </div>
          ))}
        </div>
        {share === null ? (
          <p className="pointer-events-none absolute inset-x-0 bottom-6 text-center text-sm text-muted-foreground">
            Share this thread with guests and each person who joins gets a card here.
          </p>
        ) : null}
      </div>
    </SidebarInset>
  );
}

function roomSummary(share: ThreadGuestShare, online: number): string {
  const joined = share.guests?.length ?? 0;
  if (joined === 0) return "Shared, no one has joined yet";
  return `${joined} guest${joined === 1 ? "" : "s"}, ${online} viewing now`;
}

const boardGridStyle = (view: BoardView) => ({
  backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
  backgroundSize: `${GRID * view.zoom}px ${GRID * view.zoom}px`,
  backgroundPosition: `${view.x}px ${view.y}px`,
});

function BoardCard({
  at,
  title,
  kind,
  dashed = false,
  drag,
  children,
}: {
  readonly at: BoardPoint;
  readonly title: string;
  readonly kind: string;
  readonly dashed?: boolean;
  readonly drag: ReturnType<typeof dragHandlers>;
  readonly children: ReactNode;
}) {
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
        {...drag}
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

function ThreadMessages({
  items,
}: {
  readonly items: ReturnType<typeof useThreadVisibleTurnItems>;
}) {
  const messages = boardMessages(
    items.map((projected) => projected.item),
    THREAD_MESSAGE_COUNT,
  );
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
  share,
}: {
  readonly guest: ThreadGuest;
  readonly share: ThreadGuestShare | null;
}) {
  const waiting =
    share?.messages.filter(
      (message) => message.guestId === guest.id && message.status === "pending",
    ) ?? [];
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {guest.account === undefined ? "Not signed in" : `@${guest.account.login}`}
        {guest.trusted === true ? " · sends without asking" : ""}
      </p>
      {waiting.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing waiting for you.</p>
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
