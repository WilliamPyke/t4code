import {
  type GuestId,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_THREADS,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  type RoomAgentActivity,
  type RoomBoardAssignee,
  type RoomBoardChange,
  type RoomBoardNote,
  type RoomBoardSize,
  type RoomBoardViewport,
  type RoomCodeState,
  type RoomCursor,
  type RoomViewport,
  type ThreadGuest,
  type ThreadGuestMessage,
  type ThreadGuestShare,
  roomBoardAgentCard,
  roomBoardGuestCard,
} from "@t3tools/contracts";
import {
  AppWindowIcon,
  ArrowLeftIcon,
  BotIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  LinkIcon,
  ListTodoIcon,
  MessageSquareShareIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type PointerEvent,
  type ReactNode,
  createContext,
  use,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useStableCallback } from "~/hooks/useStableCallback";

import { cn, randomUUID } from "~/lib/utils";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  BOARD_CARD_WIDTH,
  type BoardBox,
  type BoardMessage,
  type BoardPeople,
  type BoardPoint,
  type BoardPresence,
  type BoardPrompt,
  type BoardRect,
  type BoardTarget,
  type BoardThreadBox,
  type BoardValue,
  type BoardView,
  EMPTY_ROOM_BOARD,
  boardAgentCode,
  boardAgentName,
  INITIAL_BOARD_VIEW,
  NO_BOARD_EDITS,
  besideBoardItem,
  boardAgents,
  boardArtifactAuthor,
  boardArtifactWriting,
  boardBoxAgentLabel,
  boardBoxName,
  boardBoxRef,
  boardBoxRequests,
  boardCardBox,
  boardChangeOf,
  boardChangeQueue,
  boardConnector,
  boardCursorAt,
  boardCursorColor,
  boardEditKey,
  boardNoteBox,
  boardNoteMessage,
  boardNewNoteSize,
  boardNoteQuote,
  boardNoteSize,
  boardOwnBoxFor,
  boardPersonKey,
  boardPersonName,
  boardPromptContext,
  boardThreadBoxes,
  boardUrlIn,
  boardViewportOf,
  canPromptBoardBox,
  clampBoardSize,
  cursorSender,
  dropBoardEdit,
  followBoardView,
  panBoardBy,
  parseBoardLink,
  placeBoardCards,
  placeBoardItem,
  putBoardEdit,
  resizeBoardFromLeft,
  resolveBoard,
  roomCodeStatus,
  roomFetchCommand,
  screenToBoard,
  settleBoardValue,
  zoomBoardAt,
} from "./roomBoard.logic";
import { RoomArtifactLive } from "./RoomBoardArtifact";
import { BoardPromptBox } from "./RoomBoardPrompt";
import { BoxProgress, BoxRequests, BoxTurns } from "./RoomBoardThreadBox";
import { useRoomHasProgress, useRoomRunning } from "./roomBoardLive";

const guestCardId = (guest: ThreadGuest) => roomBoardGuestCard(guest.id);
const agentCardId = (guest: ThreadGuest) => roomBoardAgentCard(guest.id);
const cardRef = (id: string) => boardEditKey({ kind: "card", id });
const noteRef = (id: string) => boardEditKey({ kind: "note", id });
const GRID = 22;
// How far past the cards and notes the arrows' drawing area reaches.
const EDGE_MARGIN = 400;
const FOLLOW_NOTICE_MS = 4_000;
// About what three clamped lines of a quote hold on a note of the default width.
const QUOTE_CLAMP_LENGTH = 90;

/** What a line does: carries a card into a thread box's prompts, or takes the box's replies. */
type EdgeRole = "plain" | "context" | "artifact";
type EdgeStroke = EdgeRole | "selected";
const EDGE_STROKE_COLORS: Readonly<Record<EdgeStroke, string>> = {
  plain: "var(--color-muted-foreground)",
  context: "var(--color-info)",
  artifact: "var(--color-success)",
  selected: "var(--color-primary)",
};
const EDGE_STROKES = Object.entries(EDGE_STROKE_COLORS);

/**
 * Pointer handlers that report how far a held pointer moved, in screen pixels, and when it is
 * let go.
 */
function dragHandlers(
  onMove: (dx: number, dy: number, event: PointerEvent<HTMLElement>) => void,
  onEnd?: (event: PointerEvent<HTMLElement>) => void,
) {
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    onEnd?.(event);
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
      onMove(event.movementX, event.movementY, event);
    },
    onPointerUp: release,
    onPointerCancel: release,
  };
}

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** Whether a wheel turned over a card's text or content can still scroll that, not the board. */
function scrollsInside(event: WheelEvent): boolean {
  const scroller =
    event.target instanceof Element
      ? event.target.closest<HTMLElement>("[data-board-scroll], textarea")
      : null;
  if (scroller === null) return false;
  const { scrollTop, scrollLeft, scrollHeight, scrollWidth, clientHeight, clientWidth } = scroller;
  return (
    (event.deltaY > 0 && scrollTop + clientHeight < scrollHeight - 1) ||
    (event.deltaY < 0 && scrollTop > 0) ||
    (event.deltaX > 0 && scrollLeft + clientWidth < scrollWidth - 1) ||
    (event.deltaX < 0 && scrollLeft > 0)
  );
}

type BoardCorner = "left" | "right";

/**
 * A bottom corner a card or note is resized by. It reports where the card was and how big when
 * it was taken, in board pixels, and how far the pointer went since, in screen pixels, so the size
 * never drifts from the pointer.
 */
function ResizeHandle({
  corner,
  onResize,
  onEnd,
}: {
  readonly corner: BoardCorner;
  readonly onResize: (from: BoardRect, dx: number, dy: number) => void;
  readonly onEnd: () => void;
}) {
  const start = useRef<{ readonly x: number; readonly y: number; from: BoardRect } | null>(null);
  const release = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    start.current = null;
    onEnd();
  };
  // A 24px grip centred on the corner: half of it is outside the card, so it covers only the
  // card's corner padding and never its buttons or text.
  return (
    <div
      aria-hidden
      className={cn(
        "absolute -bottom-3 z-10 grid size-6 touch-none place-items-center opacity-40 transition-opacity group-hover/item:opacity-100",
        corner === "right" ? "-right-3 cursor-nwse-resize" : "-left-3 cursor-nesw-resize",
      )}
      onPointerDown={(event) => {
        const box = event.currentTarget.parentElement;
        if (event.button !== 0 || box === null) return;
        // Neither the board nor the card under the corner moves.
        event.stopPropagation();
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        start.current = {
          x: event.clientX,
          y: event.clientY,
          from: {
            x: box.offsetLeft,
            y: box.offsetTop,
            width: box.offsetWidth,
            height: box.offsetHeight,
          },
        };
      }}
      onPointerMove={(event) => {
        const held = start.current;
        if (held === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
        onResize(held.from, event.clientX - held.x, event.clientY - held.y);
      }}
      onPointerUp={release}
      onPointerCancel={release}
    >
      <span
        className={cn(
          "size-2 -translate-y-1 border-b-2 border-muted-foreground",
          corner === "right"
            ? "-translate-x-1 rounded-br-xs border-e-2"
            : "translate-x-1 rounded-bl-xs border-s-2",
        )}
      />
    </div>
  );
}

const THREAD_DROP = "thread";
const OWN_AGENT_DROP = "own-agent";

/** The value of a `data-*` attribute on whatever is under a point on the screen. */
const dataAt = (x: number, y: number, key: "boardDrop" | "boardItem") =>
  document
    .elementsFromPoint(x, y)
    .find(
      (element): element is HTMLElement =>
        element instanceof HTMLElement && element.dataset[key] !== undefined,
    )?.dataset[key] ?? null;

/** What the board shows of a room: who joined, what they wait on, and what is arranged. */
type BoardRoom = Pick<ThreadGuestShare, "guests" | "messages" | "turns" | "board">;

/** Following someone's view of the board, as the pointers' layer reports it. */
interface BoardFollow {
  /** Whose view this board follows, as `boardPersonKey` names them, or null. */
  readonly following: string | null;
  readonly onFollow: (person: string) => void;
  /** The followed person's view, each time it changes. */
  readonly onView: (viewport: RoomBoardViewport) => void;
  /** The followed person has no view on the board: they closed it, or never opened it. */
  readonly onGone: () => void;
}

const NOT_FOLLOWING: BoardFollow = {
  following: null,
  onFollow: () => {},
  onView: () => {},
  onGone: () => {},
};
/** The board's follow mode, for the pointers' layer its parent hands it. */
const BoardFollowContext = createContext<BoardFollow>(NOT_FOLLOWING);

/** A card a board shows in place of the thread's and the room's people's, as a team's has. */
export interface BoardCardSpec {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly dashed?: boolean;
  readonly children: ReactNode;
}

/** A link being drawn from a card or note, to wherever the pointer is. */
interface Linking {
  readonly from: string;
  readonly box: BoardBox;
  readonly to: BoardPoint;
}

/**
 * A shared thread laid out as a board: the thread boxes everyone added, each its own
 * conversation, each person in the room, and their cards, with lines between them. The
 * arrangement and the cards are the room's: the owner and every guest see the same ones.
 */
const NO_FORMER_PEOPLE: BoardPeople["guests"] = [];
const NO_BOXES: ReadonlySet<string> = new Set();

export function RoomBoard({
  title,
  room,
  online,
  messages,
  agentWorking = false,
  viewer,
  ownerName,
  cursorLayer,
  onOpenThread,
  onBack,
  onOpenReply,
  onChange,
  onCursor,
  onUseNote,
  ownerCode,
  onTakeTask,
  onGiveNote,
  onOpenPullRequest,
  openingPullRequest,
  cards,
  summary,
  backLabel = "Thread",
  ownerAssignable = true,
  formerPeople = NO_FORMER_PEOPLE,
  onPromptBox,
  renderBoxModel,
  onOpenConversation,
  conversationBoxes = NO_BOXES,
  onResolveRequest,
  resolvingRequests = NO_BOXES,
  ownerWritingArtifactId = null,
  needsApproval = false,
}: {
  readonly title: string;
  /** Null when the thread is not shared, so there is no room to arrange a board for. */
  readonly room: BoardRoom | null;
  readonly online: ReadonlyArray<GuestId>;
  readonly messages: ReadonlyArray<BoardMessage>;
  /** The owner's agent is working on the room thread, for a server that reports no box runs. */
  readonly agentWorking?: boolean;
  /** The guest looking at the board, or null for the owner. */
  readonly viewer: GuestId | null;
  /** What the owner is called, when they chose a name to show. */
  readonly ownerName: string | undefined;
  /** Everyone else's pointers, drawn in board space. A component of its own reads them. */
  readonly cursorLayer: ReactNode;
  /** Shows the room thread's conversation, from its box. */
  readonly onOpenThread: () => void;
  /** The header's way back; `onOpenThread` when absent. */
  readonly onBack?: (() => void) | undefined;
  /** Opens the thread at the message a comment is pinned to. */
  readonly onOpenReply: (messageId: string) => void;
  /** Sends one change to the room and says whether it was taken. Absent when they may not. */
  readonly onChange: ((change: RoomBoardChange) => Promise<boolean>) | undefined;
  /** Tells the room where this person's pointer is and what their board shows. */
  readonly onCursor: ((presence: BoardPresence) => void) | undefined;
  /** Puts a card's text in this person's message box for the thread. It sends nothing. */
  readonly onUseNote: ((text: string) => void) | undefined;
  /** Where the owner's code is, once known. */
  readonly ownerCode?: RoomCodeState | undefined;
  /**
   * Gives a task to this person and opens it as a draft for their own agent. It sends nothing.
   * Absent when they have no agent to take it to.
   */
  readonly onTakeTask?: ((task: RoomBoardNote) => void) | undefined;
  /**
   * Opens a note as a draft for this guest's own agent, on their machine. It sends nothing, and
   * is offered once their agent has a card on the board.
   */
  readonly onGiveNote?: ((note: RoomBoardNote) => void) | undefined;
  /** Opens a pull request for the owner's branch, from their own card. Absent when they cannot. */
  readonly onOpenPullRequest?: (() => void) | undefined;
  readonly openingPullRequest?: boolean | undefined;
  /** Replaces the thread boxes and the room's people and agents. */
  readonly cards?: ReadonlyArray<BoardCardSpec>;
  /** Said beside the title instead of who joined the room. */
  readonly summary?: string;
  readonly backLabel?: string;
  /** Whether a task can be for the owner, who has no card of their own. */
  readonly ownerAssignable?: boolean;
  /** People named on a note who can no longer be given one. */
  readonly formerPeople?: BoardPeople["guests"];
  /**
   * Sends a prompt from one of the viewer's own thread boxes and says whether it went. Absent:
   * no prompt boxes.
   */
  readonly onPromptBox?: ((boxId: string, prompt: BoardPrompt) => Promise<boolean>) | undefined;
  /** Which model the viewer's own box runs, and the way to change it. */
  readonly renderBoxModel?: ((boxId: string) => ReactNode) | undefined;
  /** Shows a box's conversation beside the board; the owner's. */
  readonly onOpenConversation?: ((boxId: string) => void) | undefined;
  /** The boxes with a conversation to show yet. */
  readonly conversationBoxes?: ReadonlySet<string>;
  /** Sends or dismisses a guest's request waiting on a box; the owner's. */
  readonly onResolveRequest?:
    | ((message: ThreadGuestMessage, decision: "send" | "dismiss") => void)
    | undefined;
  readonly resolvingRequests?: ReadonlySet<string>;
  /** The artifact the owner's running turn will fill, for a server that reports no box runs. */
  readonly ownerWritingArtifactId?: string | null | undefined;
  /** The owner's thread is waiting for the owner to approve something. */
  readonly needsApproval?: boolean | undefined;
}) {
  const board = room?.board ?? EMPTY_ROOM_BOARD;
  const running = useRoomRunning();
  const hasProgress = useRoomHasProgress();
  const [edits, setEdits] = useState(NO_BOARD_EDITS);
  // What each drag or draft has reached, read when it is let go. A render may not have caught up.
  const held = useRef(new Map<string, NonNullable<BoardValue>>());
  const [queueChange] = useState(boardChangeQueue);
  const [view, setView] = useState(INITIAL_BOARD_VIEW);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const canEdit = room !== null && onChange !== undefined;
  const shown = resolveBoard(board, edits);
  const edges = shown.edges ?? [];
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [following, setFollowing] = useState<{ person: string; seen: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const sendCursor = useStableCallback((presence: BoardPresence) => onCursor?.(presence));
  const [cursor] = useState(() => cursorSender(sendCursor));
  const pointing = onCursor !== undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- takes this person's pointer and view off everyone else's board when the board closes
  useEffect(() => () => cursor.close(), [cursor]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the room what this board shows, so others can follow it
  useEffect(() => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (!pointing || bounds === undefined) return;
    cursor.look(boardViewportOf(view, bounds));
  }, [cursor, pointing, view]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a follow notice is brief: a timer takes it away
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), FOLLOW_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  const pointerOnBoard = (event: PointerEvent<HTMLElement>) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    return bounds === undefined
      ? null
      : { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  };
  const trackCursor = (event: PointerEvent<HTMLElement>) => {
    const at = pointerOnBoard(event);
    if (pointing && at !== null) cursor.move(boardCursorAt(view, at));
  };
  const pan = dragHandlers((dx, dy) => {
    setFollowing(null);
    setView((current) => panBoardBy(current, dx, dy));
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a wheel listener must be non-passive to stop the browser's own pinch zoom, which React's onWheel cannot be
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey && scrollsInside(event)) return;
      event.preventDefault();
      const bounds = surface.getBoundingClientRect();
      const anchor = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
      setFollowing(null);
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
  const people: BoardPeople = { guests: [...guests, ...formerPeople], viewer, ownerName };
  const guestCards = cards === undefined ? guests : [];
  const agents = cards === undefined ? boardAgents(guests, room?.turns ?? [], running) : [];
  const canGive = onGiveNote !== undefined && agents.some(({ guest }) => guest.id === viewer);
  const positions = placeBoardCards(
    cards?.map((card) => card.id) ?? [
      ROOM_BOARD_THREAD_CARD,
      ...guests.map(guestCardId),
      ...agents.map(({ guest }) => agentCardId(guest)),
    ],
    shown.positions,
    undefined,
    shown.sizes,
  );
  const sizes = shown.sizes ?? {};
  const boxes = new Map<string, BoardBox>([
    ...Object.entries(positions).map(
      ([id, at]) => [cardRef(id), boardCardBox(at, sizes[id])] as const,
    ),
    ...shown.notes.map((note) => [noteRef(note.id), boardNoteBox(note)] as const),
  ]);
  const threadBoxes = cards === undefined ? boardThreadBoxes(shown, title) : [];
  const contexts = new Map(
    threadBoxes.map((box) => [box.id, boardPromptContext(shown, people, messages, box.id)]),
  );
  const contextEdges = new Set([...contexts.values()].flatMap((context) => [...context.edgeIds]));
  const artifactEdges = new Set(
    [...contexts.values()].flatMap((context) =>
      context.artifactEdgeId === null ? [] : [context.artifactEdgeId],
    ),
  );
  const edgeRole = (id: string): EdgeRole =>
    contextEdges.has(id) ? "context" : artifactEdges.has(id) ? "artifact" : "plain";
  const boxName = (boxId: string) =>
    boardBoxName(
      threadBoxes.find((box) => box.id === boxId) ?? { id: boxId, guestId: undefined, title: "" },
      people,
    );
  const restoreOf = (note: RoomBoardNote) =>
    onChange === undefined || !canEdit || note.artifact?.previous === undefined
      ? undefined
      : () =>
          queueChange(noteRef(note.id), () =>
            onChange({ type: "artifact.restore", noteId: note.id }),
          );
  // `after` names the queue a change waits in: a line to a new card goes once the card is there.
  const send = (target: BoardTarget, value: BoardValue, after = boardEditKey(target)) => {
    if (onChange === undefined) return;
    held.current.delete(boardEditKey(target));
    setEdits((current) => putBoardEdit(board, current, target, value, false));
    const change = boardChangeOf(target, value);
    void queueChange(after, () => onChange(change)).then((taken) => {
      if (!taken) setEdits((current) => dropBoardEdit(current, target, value));
    });
  };
  const hold = (target: BoardTarget, value: NonNullable<BoardValue>) => {
    held.current.set(boardEditKey(target), value);
    setEdits((current) => putBoardEdit(board, current, target, value, true));
  };
  // The room hears of a drag or a draft once, when it ends.
  const letGo = (target: BoardTarget, after?: string) => {
    const value = held.current.get(boardEditKey(target));
    if (value !== undefined) send(target, settleBoardValue(value), after);
  };
  const dragBy = (target: BoardTarget, from: BoardPoint, dx: number, dy: number) => {
    if (!canEdit) return;
    const last = held.current.get(boardEditKey(target));
    const at = last !== undefined && "x" in last ? last : from;
    hold(target, { ...at, x: at.x + dx / view.zoom, y: at.y + dy / view.zoom });
  };
  const noteNow = (note: RoomBoardNote): RoomBoardNote => {
    const last = held.current.get(noteRef(note.id));
    return last !== undefined && "text" in last ? last : note;
  };
  const sizedBy = (from: BoardRect, dx: number, dy: number) =>
    clampBoardSize({ w: from.width + dx / view.zoom, h: from.height + dy / view.zoom });
  const resizeCard = (id: string, corner: BoardCorner, from: BoardRect, dx: number, dy: number) => {
    if (!canEdit) return;
    if (corner === "right") return hold({ kind: "size", id }, sizedBy(from, dx, dy));
    const next = resizeBoardFromLeft(from, dx / view.zoom, dy / view.zoom);
    hold({ kind: "size", id }, next.size);
    hold({ kind: "card", id }, { x: next.x, y: next.y });
  };
  // A card's size and place are two changes; one queue sends them in order.
  const endCardResize = (id: string, corner: BoardCorner) => {
    const queue = boardEditKey({ kind: "size", id });
    letGo({ kind: "size", id });
    if (corner === "left") letGo({ kind: "card", id }, queue);
  };
  const resizeNote = (
    note: RoomBoardNote,
    corner: BoardCorner,
    from: BoardRect,
    dx: number,
    dy: number,
  ) => {
    if (!canEdit) return;
    const now = noteNow(note);
    if (corner === "right") {
      return hold({ kind: "note", id: note.id }, { ...now, size: sizedBy(from, dx, dy) });
    }
    const next = resizeBoardFromLeft(from, dx / view.zoom, dy / view.zoom);
    hold({ kind: "note", id: note.id }, { ...now, x: next.x, size: next.size });
  };
  const dragNote = (
    note: RoomBoardNote,
    dx: number,
    dy: number,
    event: PointerEvent<HTMLElement>,
  ) => {
    dragBy({ kind: "note", id: note.id }, note, dx, dy);
    if (onUseNote !== undefined || canGive) {
      setDropTarget(dataAt(event.clientX, event.clientY, "boardDrop"));
    }
  };
  const takeOf = (note: RoomBoardNote) =>
    onTakeTask === undefined ||
    note.kind !== "task" ||
    note.done === true ||
    note.text.trim() === "" ||
    (viewer !== null && note.assignee !== undefined && note.assignee.guestId !== viewer)
      ? undefined
      : () => onTakeTask(note);
  const messageOf = (note: RoomBoardNote) =>
    onUseNote === undefined ||
    note.kind === "artifact" ||
    note.kind === "thread" ||
    boardNoteMessage(note).trim() === ""
      ? undefined
      : () => onUseNote(boardNoteMessage(note));
  const giveOf = (note: RoomBoardNote) =>
    onGiveNote === undefined ||
    !canGive ||
    note.kind === "task" ||
    note.kind === "artifact" ||
    note.kind === "thread" ||
    boardNoteMessage(note).trim() === ""
      ? undefined
      : () => onGiveNote(note);
  // The owner's own agent works on the thread; a guest's has a card of its own.
  const handOf = (note: RoomBoardNote, onto: string | null) => {
    const own = onto === OWN_AGENT_DROP || (onto === THREAD_DROP && viewer === null);
    const take = own ? takeOf(note) : undefined;
    if (take !== undefined) return take;
    if (onto === THREAD_DROP) return messageOf(note);
    return onto === OWN_AGENT_DROP ? giveOf(note) : undefined;
  };
  // Dropped on the thread or on this person's own agent, a card becomes a draft and goes back.
  const dropNote = (note: RoomBoardNote) => {
    const target = { kind: "note", id: note.id } as const;
    const hand = handOf(note, dropTarget);
    setDropTarget(null);
    if (hand === undefined) return letGo(target);
    const value = held.current.get(boardEditKey(target));
    held.current.delete(boardEditKey(target));
    if (value !== undefined) setEdits((current) => dropBoardEdit(current, target, value));
    hand();
  };
  const writeNote = (note: RoomBoardNote, text: string) =>
    hold({ kind: "note", id: note.id }, { ...noteNow(note), text });
  const changeNote: ChangeNote = (note, update) =>
    send({ kind: "note", id: note.id }, settleBoardValue(update(noteNow(note))));
  const zoomBy = (factor: number) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    const center = { x: (bounds?.width ?? 0) / 2, y: (bounds?.height ?? 0) / 2 };
    setFollowing(null);
    setView((current) => zoomBoardAt(current, center, factor));
  };
  const full = shown.notes.length >= ROOM_BOARD_MAX_NOTES;
  const artifactsFull =
    shown.notes.filter((note) => note.kind === "artifact").length >= ROOM_BOARD_MAX_ARTIFACTS;
  const threadsFull =
    shown.notes.filter((note) => note.kind === "thread").length >= ROOM_BOARD_MAX_THREADS;
  // Everything on the board at the size the browser drew it.
  const drawnRects = (): Array<BoardRect> => {
    const taken: Array<BoardRect> = [];
    for (const item of surfaceRef.current?.querySelectorAll<HTMLElement>("[data-board-item]") ??
      []) {
      taken.push({
        x: item.offsetLeft,
        y: item.offsetTop,
        width: item.offsetWidth,
        height: item.offsetHeight,
      });
    }
    return taken;
  };
  const drawnItem = (ref: string) =>
    surfaceRef.current?.querySelector<HTMLElement>(`[data-board-item="${CSS.escape(ref)}"]`) ??
    null;
  // A new card lands in view, clear of everything there at the size the browser drew it.
  const freeSpot = (kind: RoomBoardNote["kind"]): BoardPoint => {
    const surface = surfaceRef.current;
    const size = boardNewNoteSize(kind);
    if (surface === null) return placeBoardItem(size, screenToBoard(view, { x: 300, y: 200 }), []);
    const bounds = surface.getBoundingClientRect();
    const corner = screenToBoard(view, { x: 0, y: 0 });
    const within = {
      ...corner,
      width: bounds.width / view.zoom,
      height: bounds.height / view.zoom,
    };
    return placeBoardItem(
      size,
      { x: within.x + within.width / 2, y: within.y + within.height / 2 },
      drawnRects(),
      within,
    );
  };
  const newNote = (fields: Pick<RoomBoardNote, "kind" | "url">, at: BoardPoint) => {
    const id = randomUUID();
    send(
      { kind: "note", id },
      settleBoardValue({
        id,
        text: "",
        ...at,
        ...(viewer === null ? {} : { guestId: viewer }),
        ...(fields.kind === undefined ? {} : { kind: fields.kind }),
        ...(fields.url === undefined ? {} : { url: fields.url }),
      }),
    );
    return id;
  };
  const addCard = (fields: Pick<RoomBoardNote, "kind" | "url">, wanted?: BoardPoint) => {
    if (!canEdit || full) return;
    newNote(fields, wanted ?? freeSpot(fields.kind));
  };
  /** Adds a card of `kind` beside an item, with a line between them in the direction given. */
  const addBeside = (ref: string, kind: "artifact" | "thread", direction: "from" | "to") => {
    const element = drawnItem(ref);
    const box = boxes.get(ref);
    if (!canEdit || full || (element === null && box === undefined)) return;
    const rect =
      element === null
        ? { x: box!.x, y: box!.y, width: box!.width, height: 0 }
        : {
            x: element.offsetLeft,
            y: element.offsetTop,
            width: element.offsetWidth,
            height: element.offsetHeight,
          };
    const id = newNote({ kind }, besideBoardItem(rect, boardNewNoteSize(kind), drawnRects()));
    const line = randomUUID();
    const added = noteRef(id);
    send(
      { kind: "edge", id: line },
      direction === "from"
        ? { id: line, from: ref, to: added }
        : { id: line, from: added, to: ref },
      boardEditKey({ kind: "note", id }),
    );
  };
  // Centres an item in view and puts the caret in its prompt box.
  const focusItem = (ref: string) => {
    const element = drawnItem(ref);
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (element === null || bounds === undefined) return;
    setFollowing(null);
    setView((current) => ({
      ...current,
      x: bounds.width / 2 - (element.offsetLeft + element.offsetWidth / 2) * current.zoom,
      y: bounds.height / 2 - (element.offsetTop + element.offsetHeight / 2) * current.zoom,
    }));
    element.querySelector<HTMLElement>("[data-box-prompt]")?.focus({ preventScroll: true });
  };
  const attachAgentOf = (note: RoomBoardNote) => {
    if (note.kind !== "artifact" || cards !== undefined || room === null) return undefined;
    const existing = boardOwnBoxFor(shown, viewer, note.id);
    if (existing !== null) return () => focusItem(boardBoxRef(existing));
    if (!canEdit || full || threadsFull) return undefined;
    return () => addBeside(noteRef(note.id), "thread", "to");
  };
  const addLink = (url: string, wanted?: BoardPoint) => addCard({ kind: "link", url }, wanted);
  // A URL pasted in an empty note makes that note a link card.
  const pasteLinkInto = (note: RoomBoardNote, url: string) => {
    send({ kind: "note", id: note.id }, null);
    addLink(url, { x: note.x, y: note.y });
  };
  const pasteOnBoard = (event: ClipboardEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    const url = boardUrlIn(event.clipboardData.getData("text/plain"));
    if (url === null || !canEdit) return;
    event.preventDefault();
    addLink(url);
  };
  const submitLinkDraft = () => {
    const url = linkDraft === null ? null : boardUrlIn(linkDraft);
    if (url === null) return;
    addLink(url);
    setLinkDraft(null);
  };

  const startLink = (from: string, event: PointerEvent<HTMLElement>) => {
    const box = boxes.get(from);
    const at = pointerOnBoard(event);
    if (box === undefined || at === null || !canEdit) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setSelectedEdge(null);
    setLinking({ from, box, to: screenToBoard(view, at) });
  };
  const moveLink = (event: PointerEvent<HTMLElement>) => {
    const at = pointerOnBoard(event);
    if (at === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setLinking((current) =>
      current === null ? null : { ...current, to: screenToBoard(view, at) },
    );
  };
  const endLink = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const from = linking?.from;
    setLinking(null);
    const to = dataAt(event.clientX, event.clientY, "boardItem");
    if (from === undefined || to === null || to === from || edges.length >= ROOM_BOARD_MAX_EDGES) {
      return;
    }
    if (edges.some((edge) => edge.from === from && edge.to === to)) return;
    const id = randomUUID();
    send({ kind: "edge", id }, { id, from, to });
  };
  const link = canEdit ? { onStart: startLink, onMove: moveLink, onEnd: endLink } : undefined;
  const resize: CardResize | undefined = canEdit
    ? { onResize: resizeCard, onEnd: endCardResize }
    : undefined;
  const removeEdge = (id: string) => {
    setSelectedEdge(null);
    send({ kind: "edge", id }, null);
  };

  const personName = (person: string) =>
    boardPersonName(people, person === boardPersonKey(undefined) ? undefined : person);
  const followView = useStableCallback((viewport: RoomBoardViewport) => {
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (bounds === undefined) return;
    setView(followBoardView(viewport, bounds));
    setFollowing((current) =>
      current === null || current.seen ? current : { ...current, seen: true },
    );
  });
  const followGone = useStableCallback(() => {
    if (following === null) return;
    const name = personName(following.person);
    setNotice(following.seen ? `${name} left the board` : `${name} is not on the board`);
    setFollowing(null);
  });
  const follow: BoardFollow = {
    following: following?.person ?? null,
    onFollow: (person) => {
      setNotice(null);
      setFollowing((current) => (current?.person === person ? null : { person, seen: false }));
    },
    onView: followView,
    onGone: followGone,
  };
  const followButton = (person: string, name: string) => (
    <Button
      size="micro"
      variant={following?.person === person ? "secondary" : "ghost-muted"}
      aria-pressed={following?.person === person}
      onPointerDown={stopPointer}
      onClick={() => follow.onFollow(person)}
    >
      {following?.person === person ? "Following" : `Follow ${name}`}
    </Button>
  );

  /** What a thread box shows below its title, and its prompt box for the person it belongs to. */
  const boxParts = (box: BoardThreadBox, tail: ReactNode, fallback?: ReactNode) => {
    const context = contexts.get(box.id);
    const own = canPromptBoardBox(box, viewer);
    // A box rewrites one artifact; a second would draw a line that does nothing.
    const canAddArtifact = canEdit && !full && !artifactsFull && context?.artifact === null;
    const conversation =
      onOpenConversation !== undefined && conversationBoxes.has(box.id)
        ? () => onOpenConversation(box.id)
        : undefined;
    const prompt =
      onPromptBox === undefined || context === undefined || !own ? undefined : (
        <BoardPromptBox
          cards={context.cards}
          artifact={
            context.artifact === null
              ? null
              : { id: context.artifact.id, title: context.artifact.text }
          }
          label={box.title === "" ? "Prompt this thread" : `Prompt ${box.title}`}
          placeholder={box.guestId === undefined ? "Ask your agent" : "Ask the owner's agent"}
          model={renderBoxModel?.(box.id)}
          onPrompt={(prompt) => onPromptBox(box.id, prompt)}
        />
      );
    const body = (
      <>
        <p className="text-2xs text-muted-foreground">{boardBoxAgentLabel(box, people)}</p>
        {tail}
        <BoxProgress boxId={box.id} onOpenConversation={conversation} fallback={fallback} />
        <BoxRequests
          requests={boardBoxRequests(room?.messages ?? [], box.id)}
          board={shown}
          people={people}
          onResolve={onResolveRequest}
          resolving={resolvingRequests}
        />
        {canAddArtifact || (conversation !== undefined && box.id !== ROOM_BOARD_ROOM_BOX) ? (
          <div className="flex flex-wrap gap-1">
            {canAddArtifact ? (
              <Button
                size="micro"
                variant="outline"
                onPointerDown={stopPointer}
                onClick={() => addBeside(boardBoxRef(box.id), "artifact", "from")}
              >
                <AppWindowIcon />
                New artifact
              </Button>
            ) : null}
            {conversation !== undefined && box.id !== ROOM_BOARD_ROOM_BOX ? (
              <Button
                size="micro"
                variant="outline"
                onPointerDown={stopPointer}
                onClick={conversation}
              >
                <MessagesSquareIcon />
                Open conversation
              </Button>
            ) : null}
          </div>
        ) : null}
      </>
    );
    return { body, prompt };
  };
  const roomBox = threadBoxes[0];
  const roomParts =
    roomBox === undefined
      ? null
      : boxParts(
          roomBox,
          <ThreadMessages messages={messages} />,
          hasProgress ? undefined : needsApproval ? (
            <div className="flex flex-wrap items-center gap-2">
              <p role="status" className="min-w-0 flex-1 text-xs font-medium text-warning">
                {viewer === null ? "Waiting for your approval" : "Waiting for the owner's approval"}
              </p>
              <Button size="xs" onPointerDown={stopPointer} onClick={onOpenThread}>
                Open thread
              </Button>
            </div>
          ) : undefined,
        );

  const edgeArea = drawingArea([...boxes.values()]);
  // Marker ids land in `url(#…)`, which takes no colons.
  const markerId = `board-arrow${useId().replace(/[^\w-]/g, "")}`;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden overscroll-none">
      <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <Button size="sm" variant="ghost" onClick={onBack ?? onOpenThread}>
          <ArrowLeftIcon />
          {backLabel}
        </Button>
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">
          {title}
          <span className="ms-2 font-normal text-muted-foreground">
            {room === null ? "Not shared" : (summary ?? roomSummary(room, online.length))}
          </span>
        </h1>
        {notice === null ? null : (
          <span role="status" className="shrink-0 text-xs text-muted-foreground">
            {notice}
          </span>
        )}
        {following === null ? null : (
          <span className="flex shrink-0 items-center gap-1.5 text-xs">
            Following {personName(following.person)}
            <Button size="xs" variant="outline" onClick={() => setFollowing(null)}>
              Stop following
            </Button>
          </span>
        )}
        {linkDraft === null ? (
          <>
            {cards === undefined ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || full || threadsFull}
                onClick={() => addCard({ kind: "thread" })}
              >
                <MessagesSquareIcon />
                Thread
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || full}
              onClick={() => addCard({})}
            >
              <StickyNoteIcon />
              Note
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || full}
              onClick={() => addCard({ kind: "task" })}
            >
              <ListTodoIcon />
              Task
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || full}
              onClick={() => setLinkDraft("")}
            >
              <LinkIcon />
              Link
            </Button>
            {cards === undefined ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || full || artifactsFull}
                onClick={() => addCard({ kind: "artifact" })}
              >
                <AppWindowIcon />
                Artifact
              </Button>
            ) : null}
          </>
        ) : (
          <form
            className="flex items-center gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              submitLinkDraft();
            }}
          >
            <Input
              size="sm"
              aria-label="Link"
              placeholder="Paste or type a link"
              autoFocus
              value={linkDraft}
              aria-invalid={linkDraft.trim() !== "" && boardUrlIn(linkDraft) === null}
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setLinkDraft(null);
              }}
            />
            <Button size="sm" type="submit" disabled={boardUrlIn(linkDraft) === null}>
              Add
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLinkDraft(null)}>
              Cancel
            </Button>
          </form>
        )}
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
        // Focusable so a link pasted on the board lands as a card.
        tabIndex={0}
        className={cn(
          "group/board relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-background outline-none active:cursor-grabbing",
          following !== null && "transition-[background-position,background-size] duration-200",
        )}
        style={boardGridStyle(view)}
        {...pan}
        // While a pointer is held on the board, artifact pages let it through; see RoomArtifactBody.
        onPointerDownCapture={(event) => {
          event.currentTarget.dataset.boardBusy = "";
        }}
        onPointerUpCapture={(event) => {
          delete event.currentTarget.dataset.boardBusy;
        }}
        onPointerCancelCapture={(event) => {
          delete event.currentTarget.dataset.boardBusy;
        }}
        onPointerDown={(event) => {
          // A menu opened from a card is portalled elsewhere, but React still bubbles its events here.
          if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return;
          setSelectedEdge(null);
          pan.onPointerDown(event);
        }}
        onPointerMove={(event) => {
          pan.onPointerMove(event);
          trackCursor(event);
        }}
        onPointerLeave={cursor.leave}
        onPaste={pasteOnBoard}
      >
        <div
          className={cn(
            "absolute top-0 left-0 origin-top-left",
            following !== null && "transition-transform duration-200 ease-out",
          )}
          style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          <svg
            aria-hidden
            className="pointer-events-none absolute overflow-visible"
            style={{ left: edgeArea.x, top: edgeArea.y }}
            width={edgeArea.width}
            height={edgeArea.height}
          >
            <defs>
              {EDGE_STROKES.map(([state, color]) => (
                <marker
                  key={state}
                  id={`${markerId}-${state}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M0 0 L10 5 L0 10 z" fill={color} />
                </marker>
              ))}
            </defs>
            <g transform={`translate(${-edgeArea.x} ${-edgeArea.y})`}>
              {agents.map(({ guest }) => {
                const from = boxes.get(cardRef(guestCardId(guest)));
                const to = boxes.get(cardRef(agentCardId(guest)));
                if (from === undefined || to === undefined) return null;
                return (
                  <path
                    key={guest.id}
                    d={boardConnector(from, to).path}
                    fill="none"
                    stroke="var(--color-border)"
                    strokeWidth="1.5"
                    strokeDasharray="4 5"
                  />
                );
              })}
              {edges.map((edge) => {
                const from = boxes.get(edge.from);
                const to = boxes.get(edge.to);
                if (from === undefined || to === undefined) return null;
                const { path } = boardConnector(from, to);
                const selected = selectedEdge === edge.id;
                const state: EdgeStroke = selected ? "selected" : edgeRole(edge.id);
                return (
                  <g key={edge.id}>
                    {canEdit ? (
                      <path
                        d={path}
                        fill="none"
                        stroke="transparent"
                        strokeWidth="14"
                        pointerEvents="stroke"
                        className="cursor-pointer"
                        onPointerDown={stopPointer}
                        onClick={() => setSelectedEdge(selected ? null : edge.id)}
                      />
                    ) : null}
                    <path
                      d={path}
                      fill="none"
                      stroke={EDGE_STROKE_COLORS[state]}
                      strokeWidth={state === "plain" ? 1.5 : 2}
                      markerEnd={`url(#${markerId}-${state})`}
                    />
                  </g>
                );
              })}
              {linking === null ? null : (
                <path
                  d={boardConnector(linking.box, { ...linking.to, width: 0, headerY: 0 }).path}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth="1.5"
                  strokeDasharray="4 4"
                  markerEnd={`url(#${markerId}-selected)`}
                />
              )}
            </g>
          </svg>
          {cards?.map((card) => (
            <BoardCard
              key={card.id}
              at={positions[card.id]!}
              title={card.title}
              kind={card.kind}
              dashed={card.dashed === true}
              id={card.id}
              size={sizes[card.id]}
              link={link}
              resize={resize}
              onMove={dragBy}
              onDrop={letGo}
            >
              {card.children}
            </BoardCard>
          ))}
          {roomParts !== null ? (
            <BoardCard
              at={positions[ROOM_BOARD_THREAD_CARD]!}
              title={title}
              kind={
                hasProgress
                  ? "thread"
                  : needsApproval
                    ? "needs approval"
                    : agentWorking
                      ? "agent working"
                      : "thread"
              }
              id={ROOM_BOARD_THREAD_CARD}
              size={sizes[ROOM_BOARD_THREAD_CARD]}
              dropTarget={onUseNote === undefined ? undefined : THREAD_DROP}
              highlighted={dropTarget === THREAD_DROP}
              link={link}
              resize={resize}
              onMove={dragBy}
              onDrop={letGo}
              footer={roomParts.prompt}
            >
              {roomParts.body}
              <RoomCode
                code={ownerCode}
                onOpenPullRequest={onOpenPullRequest}
                openingPullRequest={openingPullRequest}
              />
              {!hasProgress && needsApproval ? null : (
                <div>
                  <Button size="xs" variant="outline" onClick={onOpenThread}>
                    <MessagesSquareIcon />
                    Open thread
                  </Button>
                </div>
              )}
            </BoardCard>
          ) : null}
          {guestCards.map((guest) => {
            const id = guestCardId(guest);
            const here = online.includes(guest.id);
            return (
              <BoardCard
                key={id}
                at={positions[id]!}
                title={guest.name}
                kind={here ? "viewing now" : "away"}
                dashed
                id={id}
                size={sizes[id]}
                action={
                  here && guest.id !== viewer ? followButton(guest.id, guest.name) : undefined
                }
                link={link}
                resize={resize}
                onMove={dragBy}
                onDrop={letGo}
              >
                <GuestDetails guest={guest} room={room} viewer={viewer} />
              </BoardCard>
            );
          })}
          {agents.map((agent) => {
            const { guest, turns, running: now } = agent;
            const id = agentCardId(guest);
            const latest = turns.at(-1);
            const own = canGive && guest.id === viewer;
            return (
              <BoardCard
                key={id}
                at={positions[id]!}
                title={guest.id === viewer ? "Your agent" : `${guest.name}'s agent`}
                kind={
                  now !== undefined
                    ? "working"
                    : `${turns.length} turn${turns.length === 1 ? "" : "s"}`
                }
                id={id}
                size={sizes[id]}
                dropTarget={own ? OWN_AGENT_DROP : undefined}
                highlighted={own && dropTarget === OWN_AGENT_DROP}
                link={link}
                resize={resize}
                onMove={dragBy}
                onDrop={letGo}
              >
                <p className="text-2xs text-muted-foreground">Runs on their machine</p>
                {now !== undefined ? (
                  <p role="status" className="text-xs font-medium text-info first-letter:uppercase">
                    {boardAgentName(people, guest.id)} is working
                  </p>
                ) : latest !== undefined ? (
                  <>
                    {latest.prompt ? (
                      <p className="line-clamp-2 border-s-2 border-guest/50 ps-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                        {latest.prompt}
                      </p>
                    ) : null}
                    <p className="line-clamp-6 text-xs whitespace-pre-wrap [overflow-wrap:anywhere]">
                      {latest.reply}
                    </p>
                  </>
                ) : null}
                <RoomCode code={boardAgentCode(agent)} />
              </BoardCard>
            );
          })}
          {shown.notes.map((note) => {
            const box =
              note.kind === "thread" && cards === undefined
                ? boxParts(
                    { id: note.id, guestId: note.guestId, title: note.text.trim() },
                    <BoxTurns turns={note.thread?.turns ?? []} people={people} />,
                  )
                : undefined;
            return (
              <BoardNote
                key={note.id}
                note={note}
                people={people}
                guests={guests}
                ownerAssignable={ownerAssignable}
                canEdit={canEdit}
                link={link}
                quote={boardNoteQuote(note, messages)}
                onResize={canEdit ? resizeNote : undefined}
                onMove={dragNote}
                onDrop={dropNote}
                onBlur={letGo}
                onText={writeNote}
                onChange={changeNote}
                onPasteLink={full ? undefined : pasteLinkInto}
                onDelete={send}
                onOpenReply={onOpenReply}
                worker={running.find((agent) => agent.taskId === note.id)}
                onTake={takeOf(note)}
                onUse={messageOf(note)}
                onGive={giveOf(note)}
                artifactAuthor={
                  note.artifact === undefined
                    ? undefined
                    : boardArtifactAuthor(note.artifact, people)
                }
                artifactWriting={
                  note.kind === "artifact"
                    ? boardArtifactWriting(
                        note.id,
                        running,
                        hasProgress ? null : ownerWritingArtifactId,
                        people,
                      )
                    : null
                }
                boxName={boxName}
                onRestore={restoreOf(note)}
                onAttachAgent={attachAgentOf(note)}
                box={
                  box === undefined
                    ? undefined
                    : {
                        label: boardBoxAgentLabel(note, people),
                        body: box.body,
                        footer: box.prompt,
                      }
                }
              />
            );
          })}
          {edges.map((edge) => {
            const from = boxes.get(edge.from);
            const to = boxes.get(edge.to);
            if (selectedEdge !== edge.id || from === undefined || to === undefined) return null;
            const { middle } = boardConnector(from, to);
            return (
              <div
                key={edge.id}
                className="absolute -translate-x-1/2 -translate-y-1/2"
                style={{ left: middle.x, top: middle.y }}
              >
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label="Delete line"
                  autoFocus
                  onPointerDown={stopPointer}
                  onClick={() => removeEdge(edge.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Delete" || event.key === "Backspace") removeEdge(edge.id);
                    if (event.key === "Escape") setSelectedEdge(null);
                  }}
                >
                  <Trash2Icon />
                </Button>
              </div>
            );
          })}
          <BoardFollowContext value={follow}>{cursorLayer}</BoardFollowContext>
        </div>
        {cards === undefined && room !== null ? <LineLegend /> : null}
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

/** The part of the board the arrows are drawn in, so the browser finds a pointer over one. */
function drawingArea(boxes: ReadonlyArray<BoardBox>) {
  const xs = boxes.flatMap((box) => [box.x, box.x + box.width]);
  const ys = boxes.map((box) => box.y);
  const x = Math.min(0, ...xs) - EDGE_MARGIN;
  const y = Math.min(0, ...ys) - EDGE_MARGIN;
  return {
    x,
    y,
    width: Math.max(0, ...xs) + EDGE_MARGIN - x,
    height: Math.max(0, ...ys) + EDGE_MARGIN * 2 - y,
  };
}

const boardGridStyle = (view: BoardView) => ({
  backgroundImage: "radial-gradient(var(--color-border) 1px, transparent 1px)",
  backgroundSize: `${GRID * view.zoom}px ${GRID * view.zoom}px`,
  backgroundPosition: `${view.x}px ${view.y}px`,
});

type DragBy = (target: BoardTarget, from: BoardPoint, dx: number, dy: number) => void;
/** Sends a card as `update` makes it from how it reads now. */
type ChangeNote = (note: RoomBoardNote, update: (note: RoomBoardNote) => RoomBoardNote) => void;

/** Draws an arrow from a card or note: hold it and let go over another. */
interface LinkHandlers {
  readonly onStart: (from: string, event: PointerEvent<HTMLElement>) => void;
  readonly onMove: (event: PointerEvent<HTMLElement>) => void;
  readonly onEnd: (event: PointerEvent<HTMLElement>) => void;
}

/** Resizes a card by its id and a bottom corner: while the corner is held, then once let go. */
interface CardResize {
  readonly onResize: (
    id: string,
    corner: BoardCorner,
    from: BoardRect,
    dx: number,
    dy: number,
  ) => void;
  readonly onEnd: (id: string, corner: BoardCorner) => void;
}

/** What the coloured lines do, said where people see them. */
function LineLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 flex flex-col gap-1 rounded-md border border-border bg-card/90 px-2 py-1.5 text-2xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-0.5 w-4 rounded-full bg-info" />
        Into a thread, or into the artifact it rewrites: goes with its prompts
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-0.5 w-4 rounded-full bg-success" />
        From a thread to an artifact: its replies rewrite it
      </span>
      <span className="flex items-center gap-1.5">
        <span aria-hidden className="h-0.5 w-4 rounded-full bg-muted-foreground" />
        Any other line: only shows a link
      </span>
    </div>
  );
}

/**
 * A 24px grip centred on one side of a card, level with its header. Cards and notes keep 12px of
 * padding at each end of their header so it covers none of their buttons.
 */
function LinkHandle({
  from,
  link,
  on,
  side,
}: {
  readonly from: string;
  readonly link: LinkHandlers;
  /** A card's header is taller than a note's; the grip sits level with its middle. */
  readonly on: "card" | "note";
  readonly side: BoardCorner;
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            aria-label={side === "right" ? "Draw a line" : "Draw a line from the left"}
            className={cn(
              "group/link absolute z-10 grid size-6 cursor-crosshair touch-none place-items-center",
              side === "right" ? "-right-3" : "-left-3",
              on === "card" ? "top-1.5" : "top-0",
            )}
            onPointerDown={(event) => link.onStart(from, event)}
            onPointerMove={link.onMove}
            onPointerUp={link.onEnd}
            onPointerCancel={link.onEnd}
          />
        }
      >
        <span className="size-3.5 rounded-full border-2 border-primary bg-background opacity-0 transition-opacity group-hover/item:opacity-100 group-focus-visible/link:opacity-100" />
      </TooltipTrigger>
      <TooltipPopup side={side}>Drag to another card to draw a line</TooltipPopup>
    </Tooltip>
  );
}

/** Both side grips and both bottom corners of a card or note, for whoever may edit the board. */
function ItemHandles({
  from,
  on,
  link,
  onResize,
  onEnd,
}: {
  readonly from: string;
  readonly on: "card" | "note";
  readonly link: LinkHandlers | undefined;
  readonly onResize:
    | ((corner: BoardCorner, from: BoardRect, dx: number, dy: number) => void)
    | undefined;
  readonly onEnd: (corner: BoardCorner) => void;
}) {
  return (
    <>
      {link === undefined ? null : (
        <>
          <LinkHandle from={from} link={link} on={on} side="left" />
          <LinkHandle from={from} link={link} on={on} side="right" />
        </>
      )}
      {onResize === undefined ? null : (
        <>
          <ResizeHandle
            corner="left"
            onResize={(rect, dx, dy) => onResize("left", rect, dx, dy)}
            onEnd={() => onEnd("left")}
          />
          <ResizeHandle
            corner="right"
            onResize={(rect, dx, dy) => onResize("right", rect, dx, dy)}
            onEnd={() => onEnd("right")}
          />
        </>
      )}
    </>
  );
}

function BoardNote({
  note,
  people,
  guests,
  ownerAssignable,
  canEdit,
  link,
  quote,
  onResize,
  onMove,
  onDrop,
  onBlur,
  onText,
  onChange,
  onPasteLink,
  onDelete,
  onOpenReply,
  worker,
  onTake,
  onUse,
  onGive,
  artifactAuthor,
  artifactWriting,
  boxName,
  onRestore,
  onAttachAgent,
  box,
}: {
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly ownerAssignable: boolean;
  readonly canEdit: boolean;
  readonly link: LinkHandlers | undefined;
  /** The start of the reply a comment is pinned to. */
  readonly quote: string | undefined;
  readonly onResize:
    | ((note: RoomBoardNote, corner: BoardCorner, from: BoardRect, dx: number, dy: number) => void)
    | undefined;
  readonly onMove: (
    note: RoomBoardNote,
    dx: number,
    dy: number,
    event: PointerEvent<HTMLElement>,
  ) => void;
  readonly onDrop: (note: RoomBoardNote) => void;
  readonly onBlur: (target: BoardTarget) => void;
  readonly onText: (note: RoomBoardNote, text: string) => void;
  readonly onChange: ChangeNote;
  /** Absent when a pasted link cannot become a card of its own, on a full board. */
  readonly onPasteLink: ((note: RoomBoardNote, url: string) => void) | undefined;
  readonly onDelete: (target: BoardTarget, value: null) => void;
  readonly onOpenReply: (messageId: string) => void;
  /** The guest's agent working on this task now. */
  readonly worker: RoomAgentActivity | undefined;
  readonly onTake: (() => void) | undefined;
  readonly onUse: (() => void) | undefined;
  /** Opens the note as a draft for this guest's own agent. */
  readonly onGive: (() => void) | undefined;
  /** Whose agent wrote the artifact's current version. */
  readonly artifactAuthor: string | undefined;
  /** Who is writing the artifact now, from a guest's machine or an older server, or null. */
  readonly artifactWriting: string | null;
  readonly boxName: (boxId: string) => string;
  readonly onRestore: (() => Promise<boolean>) | undefined;
  /** Gives the viewer a thread box that rewrites this artifact, or shows the one they have. */
  readonly onAttachAgent: (() => void) | undefined;
  /** A thread box's agent, conversation and prompt box. */
  readonly box:
    | { readonly label: string; readonly body: ReactNode; readonly footer: ReactNode }
    | undefined;
}) {
  const target = { kind: "note", id: note.id } as const;
  const author = boardPersonName(people, note.guestId);
  const parsed = note.url === undefined ? null : parseBoardLink(note.url);
  const plain = note.kind === undefined && note.pinnedTo === undefined;
  const artifact = note.kind === "artifact";
  const thread = note.kind === "thread";
  const titled = artifact || thread;
  const size = boardNoteSize(note);
  const [quoteOpen, setQuoteOpen] = useState(false);
  return (
    <div
      className={cn(
        "group/item absolute flex flex-col rounded-sm border text-foreground shadow-lg",
        size === undefined && "w-48",
        note.kind === undefined
          ? "border-warning/40 bg-warning-surface"
          : "border-border bg-card text-card-foreground",
      )}
      style={{ left: note.x, top: note.y, width: size?.w, height: size?.h }}
      data-board-item={noteRef(note.id)}
    >
      <div
        className="flex h-6 cursor-grab items-center gap-1 ps-3 pe-3 active:cursor-grabbing"
        {...dragHandlers(
          (dx, dy, event) => onMove(note, dx, dy, event),
          () => onDrop(note),
        )}
      >
        {note.kind === "task" ? (
          <span className="flex" onPointerDown={stopPointer}>
            <Checkbox
              aria-label="Done"
              checked={note.done === true}
              disabled={!canEdit}
              onCheckedChange={(done) => onChange(note, (current) => ({ ...current, done }))}
            />
          </span>
        ) : note.kind === "link" ? (
          <LinkIcon aria-hidden className="size-3 shrink-0 opacity-60" />
        ) : artifact ? (
          <AppWindowIcon aria-hidden className="size-3 shrink-0 opacity-60" />
        ) : thread ? (
          <MessagesSquareIcon aria-hidden className="size-3 shrink-0 opacity-60" />
        ) : note.pinnedTo !== undefined ? (
          <MessageSquareTextIcon aria-hidden className="size-3 shrink-0 opacity-60" />
        ) : null}
        <span className="min-w-0 flex-1 truncate text-2xs opacity-60">
          {box !== undefined
            ? box.label
            : thread
              ? `Thread from ${author}`
              : artifact
                ? `Artifact from ${author}`
                : note.pinnedTo === undefined
                  ? author
                  : `${author} on a reply`}
        </span>
        {onUse === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Use as message"
                  className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
                  onPointerDown={stopPointer}
                  onClick={onUse}
                />
              }
            >
              <MessageSquareShareIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">Use as message</TooltipPopup>
          </Tooltip>
        )}
        {onGive === undefined ? null : (
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  aria-label="Give to my agent"
                  className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
                  onPointerDown={stopPointer}
                  onClick={onGive}
                />
              }
            >
              <BotIcon className="size-3.5" />
            </TooltipTrigger>
            <TooltipPopup side="top">Give to my agent, as a draft</TooltipPopup>
          </Tooltip>
        )}
        {canEdit ? (
          <button
            type="button"
            aria-label={plain ? "Delete note" : "Delete card"}
            className="grid size-6 place-items-center rounded-sm opacity-60 hover:opacity-100"
            onPointerDown={stopPointer}
            onClick={() => onDelete(target, null)}
          >
            <XIcon className="size-3.5" />
          </button>
        ) : null}
      </div>
      <div className={cn("flex flex-col", size !== undefined && "min-h-0 flex-1 overflow-hidden")}>
        {parsed === null ? null : (
          <div className="flex items-start gap-2 px-3 pb-1">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">{parsed.title}</p>
              {parsed.detail === "" ? null : (
                <p className="truncate text-2xs text-muted-foreground">{parsed.detail}</p>
              )}
            </div>
            <Button
              size="micro"
              variant="outline"
              onPointerDown={stopPointer}
              render={<a href={parsed.href} target="_blank" rel="noreferrer noopener" />}
            >
              <ExternalLinkIcon />
              Open
            </Button>
          </div>
        )}
        {quote === undefined ? null : (
          <div className="mx-3 mb-1.5 flex shrink-0 flex-col items-start gap-0.5">
            <blockquote
              className={cn(
                "border-s-2 border-warning/60 ps-2 text-2xs italic opacity-70 [overflow-wrap:anywhere]",
                !quoteOpen && "line-clamp-3",
                quoteOpen && size !== undefined && "max-h-40 overflow-y-auto",
              )}
              data-board-scroll={quoteOpen ? "" : undefined}
            >
              {quote}
            </blockquote>
            {quote.length > QUOTE_CLAMP_LENGTH ? (
              <button
                type="button"
                aria-expanded={quoteOpen}
                className="text-2xs underline-offset-2 opacity-60 hover:underline hover:opacity-100"
                onPointerDown={stopPointer}
                onClick={() => setQuoteOpen((open) => !open)}
              >
                {quoteOpen ? "Show less" : "Show all"}
              </button>
            ) : null}
          </div>
        )}
        <textarea
          aria-label={
            note.kind === "task"
              ? "Task"
              : note.kind === "link"
                ? "Caption"
                : artifact
                  ? "Artifact title"
                  : thread
                    ? "Thread name"
                    : "Note"
          }
          value={note.text}
          readOnly={!canEdit}
          maxLength={ROOM_BOARD_NOTE_MAX_LENGTH}
          rows={titled ? 1 : note.kind === "link" ? 2 : note.kind === "task" ? 3 : 4}
          placeholder={
            note.kind === "task"
              ? "Write a task"
              : note.kind === "link"
                ? "Add a caption"
                : artifact
                  ? "Name this artifact"
                  : thread
                    ? "Name this thread"
                    : "Write a note, or paste a link"
          }
          className={cn(
            "resize-none bg-transparent px-3 pb-3 text-sm leading-snug outline-none placeholder:text-placeholder",
            note.kind === "task" && note.done === true && "text-muted-foreground line-through",
            titled ? "shrink-0 pb-2 font-medium" : size !== undefined && "min-h-0 flex-1",
          )}
          onPointerDown={stopPointer}
          onChange={(event) => onText(note, event.target.value)}
          onKeyDown={(event) => {
            if (titled && event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onBlur={() => onBlur(target)}
          onPaste={(event) => {
            if (!plain || note.text !== "" || onPasteLink === undefined) return;
            const url = boardUrlIn(event.clipboardData.getData("text/plain"));
            if (url === null) return;
            event.preventDefault();
            onPasteLink(note, url);
          }}
        />
        {note.kind === "task" ? <TaskProgress note={note} people={people} worker={worker} /> : null}
        {note.kind === "task" ? (
          <div className="flex flex-wrap items-center gap-1 px-2 pb-2">
            <AssigneeMenu
              note={note}
              people={people}
              guests={guests}
              ownerAssignable={ownerAssignable}
              canEdit={canEdit}
              onChange={onChange}
            />
            {onTake === undefined ? null : (
              <Button size="micro" variant="outline" onPointerDown={stopPointer} onClick={onTake}>
                Take it to my agent
              </Button>
            )}
          </div>
        ) : null}
        {note.pinnedTo === undefined ? null : (
          <div className="flex px-2 pb-2">
            <Button
              size="micro"
              variant="outline"
              onPointerDown={stopPointer}
              onClick={() => note.pinnedTo !== undefined && onOpenReply(note.pinnedTo)}
            >
              Go to reply
            </Button>
          </div>
        )}
        {artifact && onAttachAgent !== undefined ? (
          <div className="flex shrink-0 px-3 pb-1.5">
            <Button
              size="micro"
              variant="outline"
              onPointerDown={stopPointer}
              onClick={onAttachAgent}
            >
              <BotIcon />
              Attach my agent
            </Button>
          </div>
        ) : null}
        {artifact ? (
          <RoomArtifactLive
            noteId={note.id}
            artifact={note.artifact}
            author={artifactAuthor}
            writingFallback={artifactWriting}
            boxName={boxName}
            onRestore={onRestore}
          />
        ) : null}
        {box === undefined ? null : (
          <>
            <div
              data-board-scroll
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2"
            >
              {box.body}
            </div>
            {box.footer === undefined ? null : (
              <div className="shrink-0 border-t border-border px-3 pt-2 pb-3">{box.footer}</div>
            )}
          </>
        )}
      </div>
      <ItemHandles
        from={noteRef(note.id)}
        on="note"
        link={link}
        onResize={
          onResize === undefined
            ? undefined
            : (corner, from, dx, dy) => onResize(note, corner, from, dx, dy)
        }
        onEnd={() => onBlur(target)}
      />
    </div>
  );
}

/** A guest's agent working on a task, or the start of the reply that answered it. */
function TaskProgress({
  note,
  people,
  worker,
}: {
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly worker: RoomAgentActivity | undefined;
}) {
  if (worker !== undefined) {
    return (
      <p role="status" className="px-3 pb-2 text-2xs text-muted-foreground first-letter:uppercase">
        {boardAgentName(people, worker.guestId)} is working on this
      </p>
    );
  }
  if (note.answer === undefined) return null;
  return (
    <div className="flex flex-col gap-0.5 px-3 pb-2">
      <p className="text-2xs font-medium text-muted-foreground">
        Answered by {boardAgentName(people, note.answer.guestId)}
      </p>
      <p className="line-clamp-4 border-s-2 border-guest/50 ps-2 text-xs [overflow-wrap:anywhere]">
        {note.answer.excerpt}
      </p>
    </div>
  );
}

/** Who a task is for, and the people in the room it can be given to. */
function AssigneeMenu({
  note,
  people,
  guests,
  ownerAssignable,
  canEdit,
  onChange,
}: {
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly ownerAssignable: boolean;
  readonly canEdit: boolean;
  readonly onChange: ChangeNote;
}) {
  const label =
    note.assignee === undefined ? "No one" : boardPersonName(people, note.assignee.guestId);
  const choices: ReadonlyArray<RoomBoardAssignee> = [
    ...(ownerAssignable ? [{}] : []),
    ...guests.map((guest) => ({ guestId: guest.id })),
  ];
  const assign = (assignee: RoomBoardAssignee | undefined) =>
    onChange(note, ({ assignee: _assignee, ...rest }) =>
      assignee === undefined ? rest : { ...rest, assignee },
    );
  return (
    <Menu>
      <MenuTrigger
        disabled={!canEdit}
        render={<Button size="micro" variant="ghost-muted" onPointerDown={stopPointer} />}
        aria-label={`Assigned to ${label}`}
      >
        {note.assignee === undefined ? "Assign" : label}
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuItem onClick={() => assign(undefined)}>No one</MenuItem>
        {choices.map((choice) => (
          <MenuItem key={boardPersonKey(choice.guestId)} onClick={() => assign(choice)}>
            {boardPersonName(people, choice.guestId)}
          </MenuItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

function BoardCard({
  at,
  title,
  kind,
  dashed = false,
  id,
  size,
  dropTarget,
  highlighted = false,
  action,
  link,
  resize,
  onMove,
  onDrop,
  footer,
  children,
}: {
  readonly at: BoardPoint;
  readonly title: string;
  readonly kind: string;
  readonly dashed?: boolean;
  readonly id: string;
  /** Absent until someone resizes it: it is as tall as what it shows. */
  readonly size: RoomBoardSize | undefined;
  /** What a note dropped here does, as `dataAt` reads it from the page. */
  readonly dropTarget?: string | undefined;
  readonly highlighted?: boolean;
  readonly action?: ReactNode;
  readonly link: LinkHandlers | undefined;
  readonly resize: CardResize | undefined;
  readonly onMove: DragBy;
  readonly onDrop: (target: BoardTarget) => void;
  /** Kept in view below the card's content when that scrolls. */
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  const target = { kind: "card", id } as const;
  return (
    <section
      className={cn(
        "group/item absolute flex flex-col rounded-xl border border-border bg-card text-card-foreground shadow-lg",
        dashed && "border-dashed",
        highlighted && "ring-2 ring-primary",
      )}
      style={{ left: at.x, top: at.y, width: size?.w ?? BOARD_CARD_WIDTH, height: size?.h }}
      data-board-drop={dropTarget}
      data-board-item={cardRef(id)}
    >
      <header
        className="flex cursor-grab items-center gap-2 border-b border-border px-3 py-2 active:cursor-grabbing"
        {...dragHandlers(
          (dx, dy) => onMove(target, at, dx, dy),
          () => onDrop(target),
        )}
      >
        <h2 className="min-w-0 flex-1 truncate text-xs font-semibold">{title}</h2>
        {action}
        <span className="shrink-0 rounded-full border border-border px-1.5 text-2xs text-muted-foreground">
          {kind}
        </span>
      </header>
      <div
        data-board-scroll={size === undefined ? undefined : ""}
        className={cn(
          "flex flex-col gap-2 p-3",
          size !== undefined && "min-h-0 flex-1 overflow-y-auto",
        )}
      >
        {children}
      </div>
      {footer === undefined ? null : (
        <div className="shrink-0 border-t border-border px-3 pt-2 pb-3">{footer}</div>
      )}
      <ItemHandles
        from={cardRef(id)}
        on="card"
        link={link}
        onResize={
          resize === undefined
            ? undefined
            : (corner, from, dx, dy) => resize.onResize(id, corner, from, dx, dy)
        }
        onEnd={(corner) => resize?.onEnd(id, corner)}
      />
    </section>
  );
}

/** Someone's branch and whether it is pushed, with how to get it and its pull request. */
function RoomCode({
  code,
  onOpenPullRequest,
  openingPullRequest = false,
}: {
  readonly code: RoomCodeState | undefined;
  /** Offered on the viewer's own card, for a branch with no pull request yet. */
  readonly onOpenPullRequest?: (() => void) | undefined;
  readonly openingPullRequest?: boolean | undefined;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "fetch command" });
  if (code === undefined) return null;
  const command = code.synced ? roomFetchCommand(code.branch) : null;
  const openPullRequest = code.pullRequest === undefined ? onOpenPullRequest : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <p className="flex min-w-0 items-center gap-1.5 text-2xs text-muted-foreground">
        <GitBranchIcon aria-hidden className="size-3 shrink-0" />
        <span className="min-w-0 truncate font-mono">{code.branch}</span>
        <span className="shrink-0">· {roomCodeStatus(code)}</span>
      </p>
      {command === null &&
      code.pullRequest === undefined &&
      openPullRequest === undefined ? null : (
        <div className="flex flex-wrap gap-1">
          {openPullRequest === undefined ? null : (
            <Button
              size="micro"
              variant="outline"
              disabled={openingPullRequest}
              onPointerDown={stopPointer}
              onClick={openPullRequest}
            >
              <PullRequestGlyph.pullRequest />
              {openingPullRequest ? "Opening pull request..." : "Open pull request"}
            </Button>
          )}
          {command === null ? null : (
            <Button
              size="micro"
              variant="outline"
              onPointerDown={stopPointer}
              onClick={() => copyToClipboard(command, undefined)}
            >
              {isCopied ? "Copied" : "Copy fetch command"}
            </Button>
          )}
          {code.pullRequest === undefined ? null : (
            <Button
              size="micro"
              variant="outline"
              onPointerDown={stopPointer}
              render={<a href={code.pullRequest.url} target="_blank" rel="noreferrer noopener" />}
            >
              <ExternalLinkIcon />
              Pull request #{code.pullRequest.number}
            </Button>
          )}
        </div>
      )}
    </div>
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

/**
 * Everyone else's pointers, in board space, each named and in that person's colour. Clicking a
 * name follows that person's view, which this layer hands the board as it changes.
 */
export function RoomCursors({
  cursors,
  views,
  guests,
  ownerName,
}: {
  readonly cursors: ReadonlyArray<RoomCursor>;
  /** Absent from an older server, which sends no views. */
  readonly views: ReadonlyArray<RoomViewport> | undefined;
  readonly guests: ReadonlyArray<ThreadGuest>;
  /** What the owner's pointer is labelled; "Owner" when they set no name. */
  readonly ownerName: string | undefined;
}) {
  const { following, onView, onGone, onFollow } = use(BoardFollowContext);
  const followed =
    following === null
      ? undefined
      : views?.find((viewport) => boardPersonKey(viewport.guestId) === following);
  const [x, y, zoom] = [followed?.x, followed?.y, followed?.zoom];
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- moves this board to the followed person's view, which arrives on the room's live stream
  useEffect(() => {
    if (following === null) return;
    if (x === undefined || y === undefined || zoom === undefined) onGone();
    else onView({ x, y, zoom });
  }, [following, x, y, zoom, onGone, onView]);
  return cursors.map((cursor) => {
    const name =
      cursor.guestId === undefined
        ? (ownerName ?? "Owner")
        : guests.find((guest) => guest.id === cursor.guestId)?.name;
    if (name === undefined) return null;
    const color = boardCursorColor(guests, cursor.guestId);
    const person = boardPersonKey(cursor.guestId);
    return (
      <div
        key={person}
        className="pointer-events-none absolute top-0 left-0 flex items-start transition-transform duration-100 ease-linear"
        style={{ transform: `translate(${cursor.x}px, ${cursor.y}px)`, color }}
      >
        <MousePointer2Icon aria-hidden className="size-4 fill-current" />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={following === person}
                aria-label={following === person ? `Stop following ${name}` : `Follow ${name}`}
                className="pointer-events-auto mt-3 max-w-32 cursor-pointer truncate rounded-sm px-1.5 py-0.5 text-2xs font-medium text-background"
                style={{ backgroundColor: color }}
                onPointerDown={stopPointer}
                onClick={() => onFollow(person)}
              />
            }
          >
            {name}
          </TooltipTrigger>
          <TooltipPopup side="bottom">
            {following === person ? "Stop following" : "Follow"}
          </TooltipPopup>
        </Tooltip>
      </div>
    );
  });
}
