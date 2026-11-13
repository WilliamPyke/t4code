import {
  type GuestId,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_THREADS,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  ROOM_BOX_REPLY_MAX_LENGTH,
  type RoomAgentActivity,
  type RoomBoardAssignee,
  type RoomBoardChange,
  type RoomBoardNote,
  type RoomBoardNoteColor,
  type RoomBoardReaction,
  type RoomBoardReactionEmoji,
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
  ChevronDownIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  GitBranchIcon,
  LinkIcon,
  ListTodoIcon,
  MessageCirclePlusIcon,
  MessageSquareShareIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  MinusIcon,
  MousePointer2Icon,
  PlusIcon,
  ScanIcon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  createContext,
  use,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import {
  canRestoreRoomArtifact,
  isRoomCardOwnedBy,
  roomBoxExcerpt,
} from "@t3tools/shared/roomBoard";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "~/hooks/useStableCallback";

import { cn, randomUUID } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  BOARD_CARD_WIDTH,
  BOARD_PIN_SIZE,
  type BoardArea,
  type BoardBox,
  type BoardHistoryEntry,
  type BoardMessage,
  type BoardPeople,
  type BoardPoint,
  type BoardPresence,
  type BoardPrompt,
  type BoardRect,
  type BoardStep,
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
  boardBounds,
  boardDragItems,
  boardTakenRects,
  boardAgents,
  boardArtifactAuthor,
  boardArtifactWriting,
  boardBoxAgentLabel,
  boardBoxName,
  boardBoxRef,
  boardBoxRequests,
  boardGuestWaiting,
  boardCardBox,
  boardChangeOf,
  boardChangeQueue,
  boardChangeQueueKey,
  boardCommentLineTo,
  boardConnector,
  boardCursorAt,
  clientRectToBoard,
  clientToBoard,
  boardCursorColor,
  boardEditKey,
  boardGroupMove,
  boardHistoryChanges,
  boardHistoryWith,
  boardItemsInRect,
  boardNoteBox,
  boardNoteMessage,
  boardNewNoteSize,
  boardNoteQuote,
  boardNoteSize,
  boardOwnBoxFor,
  boardPeopleOf,
  boardPersonKey,
  boardPersonName,
  boardPinScale,
  boardPromptContext,
  boardSelectionItems,
  boardSelectionRemoval,
  boardThreadBoxes,
  BOARD_COMMENT_ASK_TEXT,
  boardCommentAskBoxes,
  boardCommentPromptCard,
  boardUrlIn,
  boardValueOf,
  boardViewportOf,
  canPromptBoardBox,
  clampBoardSize,
  cursorSender,
  dropBoardEdit,
  fitBoardView,
  followBoardView,
  panBoardBy,
  panToShow,
  panToShowAdded,
  parseBoardLink,
  placeBoardCards,
  placeBoardItem,
  putBoardEdit,
  resizeBoardFromLeft,
  resolveBoard,
  settleBoardEdits,
  roomCodeStatus,
  roomFetchCommand,
  settleBoardValue,
  visibleBoardRect,
  zoomBoardAt,
} from "./roomBoard.logic";
import { RoomArtifactLive } from "./RoomBoardArtifact";
import { CommentPin, CommentThreadPanel } from "./RoomBoardComments";
import { useCommentUnread } from "./roomCommentSeen";
import { NoteColorPicker, noteColorClassName, useLastNoteColor } from "./RoomNoteColor";
import { BoardHistoryButtons } from "./RoomBoardHistory";
import { AddReaction, ReactionChips } from "./RoomBoardReactions";
import {
  BoardSelectionContext,
  SelectionBar,
  isBoardKey,
  isSelectPress,
  useBoardMarquee,
  useBoardSelected,
} from "./RoomBoardSelection";
import { BoardPromptBox } from "./RoomBoardPrompt";
import { BoxProgress, BoxRequests, BoxTurns } from "./RoomBoardThreadBox";
import {
  RoomLiveContext,
  boardLiveRect,
  boardLiveStyle,
  useBoardLiveDrag,
  useBoxProgress,
  useRoomHasProgress,
  useRoomRunning,
} from "./roomBoardLive";

const guestCardId = (guest: ThreadGuest) => roomBoardGuestCard(guest.id);
const agentCardId = (guest: ThreadGuest) => roomBoardAgentCard(guest.id);
const cardRef = (id: string) => boardEditKey({ kind: "card", id });
const NEXT_GUEST_CARD = "next-guest";
const NEXT_AGENT_CARD = "next-agent";
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

/** Whether an event's target is drawn inside the element handling it, not in a portal from it. */
const isInside = (event: { readonly target: EventTarget; readonly currentTarget: Element }) =>
  event.target instanceof Node && event.currentTarget.contains(event.target);

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
      // A menu, popover or dialog opened from here is portalled elsewhere, but React still
      // bubbles its presses here, and capturing them would steal their clicks.
      if (event.button !== 0 || !isInside(event)) return;
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

/** A toolbar button's words, read out but not shown while the board is too narrow for them. */
const ToolLabel = ({ children }: { readonly children: ReactNode }) => (
  <span className="sr-only @5xl/board:not-sr-only">{children}</span>
);

// Every count of resolved threads a board can hold fits in the room this one takes.
const RESOLVED_WIDEST_COUNT = Number("8".repeat(String(ROOM_BOARD_MAX_NOTES).length));

const ResolvedCount = ({ count }: { readonly count: number }) => (
  <span className="tabular-nums">
    <span className="hidden @5xl/board:inline">Resolved ({count})</span>
    <span className="@5xl/board:hidden">{count}</span>
  </span>
);

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

/**
 * The board surface's place and size on screen: the one measure every conversion between the
 * window, the surface and the board goes through.
 */
const boardAreaOf = (surface: HTMLElement | null): BoardArea | null => {
  if (surface === null) return null;
  const bounds = surface.getBoundingClientRect();
  return {
    left: bounds.left + surface.clientLeft,
    top: bounds.top + surface.clientTop,
    width: surface.clientWidth,
    height: surface.clientHeight,
  };
};

/** Where an item is drawn on the board and how big, in board pixels. */
const drawnRect = (element: HTMLElement): BoardRect => ({
  x: element.offsetLeft,
  y: element.offsetTop,
  width: element.offsetWidth,
  height: element.offsetHeight,
});

/** Everything on a board at the size the browser drew it. */
const drawnRectsIn = (surface: HTMLElement | null): Array<BoardRect> =>
  [...(surface?.querySelectorAll<HTMLElement>("[data-board-item]") ?? [])].map(drawnRect);

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
  /** Where on screen the grip was pressed. */
  readonly press: BoardPoint;
}

// How far a grip may move under a press that is still a click, in screen pixels.
const CLICK_SLOP = 4;

const edgeAt = (x: number, y: number) =>
  document
    .elementsFromPoint(x, y)
    .find(
      (element): element is SVGElement =>
        element instanceof SVGElement && element.dataset.boardEdge !== undefined,
    )?.dataset.boardEdge ?? null;

/**
 * A shared thread laid out as a board: the thread boxes everyone added, each its own
 * conversation, each person in the room, and their cards, with lines between them. The
 * arrangement and the cards are the room's: the owner and every guest see the same ones.
 */
const NO_FORMER_PEOPLE: BoardPeople["guests"] = [];
const NO_BOXES: ReadonlySet<string> = new Set();
const NO_SELECTION: ReadonlySet<string> = new Set();
const NO_REACTIONS: ReadonlyArray<RoomBoardReaction> = [];
const NO_HISTORY: {
  readonly undo: ReadonlyArray<BoardHistoryEntry>;
  readonly redo: ReadonlyArray<BoardHistoryEntry>;
} = { undo: [], redo: [] };
const NO_GUEST_MESSAGES: ReadonlyArray<ThreadGuestMessage> = [];

export function RoomBoard({
  title,
  room,
  shareId,
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
  onAddThread,
  renderBoxModel,
  onOpenConversation,
  conversationBoxIds,
  guestBoxPlaceholder = "Ask the owner's agent",
  renderRequestModel,
  onResolveRequest,
  resolvingRequests = NO_BOXES,
  ownerWritingArtifactId = null,
  needsApproval = false,
  renderBoxApproval,
  askInComments = false,
}: {
  readonly title: string;
  /** Null when the thread is not shared, so there is no room to arrange a board for. */
  readonly room: BoardRoom | null;
  /** The share the board is, which names what this device remembers of it. */
  readonly shareId?: string | undefined;
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
  /**
   * Offers to put one of the viewer's own threads on the board as a thread box, at a free spot.
   * Absent: the Thread button adds only new thread boxes.
   */
  readonly onAddThread?: ((at: BoardPoint) => void) | undefined;
  /** Which model the viewer's own box runs, and the way to change it. */
  readonly renderBoxModel?: ((boxId: string) => ReactNode) | undefined;
  /** Opens a box's conversation: beside the board for the owner, their own thread for a guest. */
  readonly onOpenConversation?: ((boxId: string) => void) | undefined;
  /** The boxes whose conversation the viewer can open. Absent: every box's, as for the owner. */
  readonly conversationBoxIds?: ReadonlyArray<string> | undefined;
  /** What the prompt box of a guest's own thread box says before they type. */
  readonly guestBoxPlaceholder?: string | undefined;
  /** Which model a guest's waiting request on a box would run on, shown to the owner. */
  readonly renderRequestModel?: ((boxId: string) => ReactNode) | undefined;
  /** Sends or dismisses a guest's request waiting on a box; the owner's. */
  readonly onResolveRequest?:
    | ((message: ThreadGuestMessage, decision: "send" | "dismiss") => void)
    | undefined;
  readonly resolvingRequests?: ReadonlySet<string>;
  /** The artifact the owner's running turn will fill, for a server that reports no box runs. */
  readonly ownerWritingArtifactId?: string | null | undefined;
  /** The owner's thread is waiting for the owner to approve something. */
  readonly needsApproval?: boolean | undefined;
  /**
   * What a box whose agent is this viewer's asks them to approve, shown on it while it waits.
   * Absent, or null for a box: others see only that it waits.
   */
  readonly renderBoxApproval?: ((boxId: string) => ReactNode) | undefined;
  /**
   * The viewer's own boxes run on their own agent, so a comment thread can ask one to answer it
   * through `onPromptBox`. Off for a guest whose box prompts wait for the owner.
   */
  readonly askInComments?: boolean | undefined;
}) {
  const board = room?.board ?? EMPTY_ROOM_BOARD;
  const running = useRoomRunning();
  const hasProgress = useRoomHasProgress();
  const [edits, setEdits] = useState(NO_BOARD_EDITS);
  // What each drag or draft has reached, read when it is let go. A render may not have caught up.
  const held = useRef(new Map<string, NonNullable<BoardValue>>());
  // How each card held now looked before the drag or the typing began, for undo.
  const gestureFrom = useRef(new Map<string, BoardValue>());
  const batch = useRef<Array<BoardStep> | null>(null);
  const unrecorded = useRef(false);
  const [history, setHistory] = useState(NO_HISTORY);
  const [queueChange] = useState(boardChangeQueue);
  const [view, setView] = useState(INITIAL_BOARD_VIEW);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fitted = useRef(false);
  const canEdit = room !== null && onChange !== undefined;
  // Each board the room sends retires the edits it moved past, before any can show again.
  const settledEdits = settleBoardEdits(board, edits);
  if (settledEdits !== edits) setEdits(settledEdits);
  const shown = resolveBoard(board, settledEdits);
  const edges = shown.edges ?? [];
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const [following, setFollowing] = useState<{ person: string; seen: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Choosing Comment, then pressing the board, starts a thread there.
  const [placingComment, setPlacingComment] = useState(false);
  const [openComment, setOpenComment] = useState<string | null>(null);
  // A thread started here and not written yet: only this person sees it, and closing drops it.
  // `on` is the card it was dropped on, which a line from it joins once it is written.
  const [draftComment, setDraftComment] = useState<
    (BoardPoint & { readonly id: string; readonly on: string | null }) | null
  >(null);
  const [showResolved, setShowResolved] = useState(false);
  // The colour this viewer last gave a note, which their new notes take.
  const [noteColor, setNoteColor] = useLastNoteColor();
  const [selection, setSelection] = useState<ReadonlySet<string>>(NO_SELECTION);
  const marquee = useBoardMarquee((rect) => {
    const area = boardAreaOf(surfaceRef.current);
    if (area === null) return;
    const items = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-pin])",
      ) ?? []),
    ].flatMap((element) => {
      const ref = element.dataset.boardItem;
      return ref === undefined ? [] : [{ ref, rect: drawnRect(element) }];
    });
    const touched = boardItemsInRect(items, clientRectToBoard(view, area, rect));
    setSelection((current) => new Set([...current, ...touched]));
  });
  const sendCursor = useStableCallback((presence: BoardPresence) => onCursor?.(presence));
  const [cursor] = useState(() => cursorSender(sendCursor));
  const pointing = onCursor !== undefined;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- takes this person's pointer and view off everyone else's board when the board closes
  useEffect(() => () => cursor.close(), [cursor]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the room what this board shows, so others can follow it
  useEffect(() => {
    const area = boardAreaOf(surfaceRef.current);
    if (!pointing || area === null) return;
    cursor.look(boardViewportOf(view, area));
  }, [cursor, pointing, view]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a follow notice is brief: a timer takes it away
  useEffect(() => {
    if (notice === null) return;
    const timer = setTimeout(() => setNotice(null), FOLLOW_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice]);
  // Where a pointer is on the board, measured against the surface's own place on screen.
  const pointerOnBoard = (event: { readonly clientX: number; readonly clientY: number }) => {
    const area = boardAreaOf(surfaceRef.current);
    return area === null ? null : clientToBoard(view, area, { x: event.clientX, y: event.clientY });
  };
  const trackCursor = (event: PointerEvent<HTMLElement>) => {
    const area = boardAreaOf(surfaceRef.current);
    if (!pointing || area === null) return;
    cursor.move(boardCursorAt(view, { x: event.clientX - area.left, y: event.clientY - area.top }));
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
      // An open comment thread scrolls itself, and is never zoomed with the board.
      if (event.target instanceof Element && event.target.closest("[data-board-overlay]")) {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
        return;
      }
      if (!event.ctrlKey && !event.metaKey && scrollsInside(event)) return;
      event.preventDefault();
      const area = boardAreaOf(surface);
      if (area === null) return;
      const anchor = { x: event.clientX - area.left, y: event.clientY - area.top };
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
  // The board opens showing every card, once: after that the view is the viewer's to move.
  const fittable = cards === undefined ? room !== null : cards.length + shown.notes.length > 0;
  const fitFirst = useStableCallback(() => {
    const area = boardAreaOf(surfaceRef.current);
    if (fitted.current || !fittable || area === null || area.width === 0 || area.height === 0) {
      return;
    }
    fitted.current = true;
    const rects = drawnRectsIn(surfaceRef.current);
    setView((current) => (current === INITIAL_BOARD_VIEW ? fitBoardView(rects, area) : current));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the first view is measured from the cards and the surface as the browser laid them out
  useLayoutEffect(fitFirst, [fitFirst, fittable]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the board's on-screen size, which a conversation opening beside it shrinks
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    let last = boardAreaOf(surface) ?? { width: 0, height: 0 };
    return observeResize(surface, () => {
      fitFirst();
      const size = boardAreaOf(surface);
      if (size === null) return;
      const shrank = size.width < last.width || size.height < last.height;
      last = size;
      const bounds = boardBounds(drawnRectsIn(surface));
      if (!shrank || bounds === null) return;
      // Cards that all fit in what is left stay in view; more than that is the Fit button's.
      setView((current) =>
        bounds.width * current.zoom <= size.width - 48 &&
        bounds.height * current.zoom <= size.height - 48
          ? panToShow(current, bounds, size)
          : current,
      );
    });
  }, [fitFirst]);

  const guests = room?.guests ?? [];
  const people: BoardPeople = {
    guests: boardPeopleOf(guests, room?.board, formerPeople),
    viewer,
    ownerName,
  };
  const guestCards = cards === undefined ? guests : [];
  const agents = cards === undefined ? boardAgents(guests, room?.turns ?? [], running) : [];
  const canGive = onGiveNote !== undefined && agents.some(({ guest }) => guest.id === viewer);
  const cardIds = cards?.map((card) => card.id) ?? [
    ROOM_BOARD_THREAD_CARD,
    ...guests.map(guestCardId),
    ...agents.map(({ guest }) => agentCardId(guest)),
  ];
  // Cards the board will add on its own grid: each guest's agent once it runs, and whoever joins
  // next with theirs. New cards keep clear of their slots.
  const upcomingCardIds =
    cards === undefined
      ? [
          ...guests
            .filter((guest) => !agents.some((agent) => agent.guest.id === guest.id))
            .map(agentCardId),
          NEXT_GUEST_CARD,
          NEXT_AGENT_CARD,
        ]
      : [];
  const positions = placeBoardCards(cardIds, shown.positions, undefined, shown.sizes);
  const sizes = shown.sizes ?? {};
  // What someone else took off the board leaves the selection.
  const selectedItems = boardSelectionItems(shown, positions, selection);
  const selected: ReadonlySet<string> = new Set(
    selectedItems.map(({ target }) => boardEditKey(target)),
  );
  const removal = boardSelectionRemoval(shown, selected, viewer);
  const inGroup = (target: BoardTarget) => selected.size > 1 && selected.has(boardEditKey(target));
  const commentNotes = shown.notes.filter((note) => note.kind === "comment");
  const resolvedComments = commentNotes.filter((note) => note.resolved === true).length;
  // Resolved threads are hidden until someone asks for them; an open one stays while it is open.
  const hiddenComment = (note: RoomBoardNote) =>
    note.kind === "comment" && note.resolved === true && !showResolved && note.id !== openComment;
  const draftNote: RoomBoardNote | null =
    draftComment === null
      ? null
      : {
          id: draftComment.id,
          x: draftComment.x,
          y: draftComment.y,
          text: "",
          kind: "comment",
          ...(viewer === null ? {} : { guestId: viewer }),
        };
  const openNote =
    openComment === null
      ? null
      : draftNote?.id === openComment
        ? draftNote
        : (commentNotes.find((note) => note.id === openComment) ?? null);
  const unread = useCommentUnread(shareId, openNote === draftNote ? null : openNote, viewer);
  const pinScale = boardPinScale(view.zoom);
  const boxes = new Map<string, BoardBox>([
    ...Object.entries(positions).map(
      ([id, at]) => [cardRef(id), boardCardBox(at, sizes[id])] as const,
    ),
    ...shown.notes
      .filter((note) => !hiddenComment(note))
      .map((note) => [noteRef(note.id), boardNoteBox(note, view.zoom)] as const),
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
    onChange === undefined ||
    !canEdit ||
    note.artifact?.previous === undefined ||
    !canRestoreRoomArtifact(note, viewer)
      ? undefined
      : () =>
          queueChange(noteRef(note.id), () =>
            onChange({ type: "artifact.restore", noteId: note.id }),
          );
  // `after` names the queue a change waits in: a line to a new card goes once the card is there.
  const send = (target: BoardTarget, value: BoardValue, after?: string) => {
    if (onChange === undefined) return;
    const key = boardEditKey(target);
    held.current.delete(key);
    const before = gestureFrom.current.get(key) ?? boardValueOf(shown, target);
    gestureFrom.current.delete(key);
    // Deleting a card cannot be taken back: its content and lines are not kept here.
    const undoable =
      !(target.kind === "note" && value === null) &&
      !(value !== null && "kind" in value && value.kind === "comment");
    if (undoable && !unrecorded.current) remember({ target, before, after: value });
    const queue = after ?? boardChangeQueueKey(shown, target, value);
    setEdits((current) => putBoardEdit(board, current, target, value, false));
    const change = boardChangeOf(target, value);
    void queueChange(queue, () => onChange(change)).then((taken) => {
      if (!taken) setEdits((current) => dropBoardEdit(current, target, value));
    });
  };
  const hold = (target: BoardTarget, value: NonNullable<BoardValue>) => {
    const key = boardEditKey(target);
    if (!held.current.has(key)) gestureFrom.current.set(key, boardValueOf(shown, target));
    held.current.set(key, value);
    setEdits((current) => putBoardEdit(board, current, target, value, true));
  };
  // Everything sent in one go, as a drag of several cards, is one entry to take back.
  const remember = (step: BoardStep) => {
    if (batch.current === null) {
      const steps: Array<BoardStep> = [];
      batch.current = steps;
      queueMicrotask(() => {
        batch.current = null;
        setHistory((current) => ({ undo: boardHistoryWith(current.undo, steps), redo: [] }));
      });
    }
    batch.current.push(step);
  };
  const travel = (direction: "undo" | "redo") => {
    const entry = (direction === "undo" ? history.undo : history.redo).at(-1);
    if (entry === undefined || !canEdit) return;
    const changes = boardHistoryChanges(shown, entry, direction);
    setHistory((current) =>
      direction === "undo"
        ? {
            undo: current.undo.slice(0, -1),
            redo: changes === null ? current.redo : [...current.redo, entry],
          }
        : {
            undo: changes === null ? current.undo : [...current.undo, entry],
            redo: current.redo.slice(0, -1),
          },
    );
    if (changes === null) {
      toastManager.add({
        type: "info",
        title: direction === "undo" ? "Skipped an undo" : "Skipped a redo",
        description: "Someone changed that card since, so it was left as it is.",
      });
      return;
    }
    unrecorded.current = true;
    try {
      for (const { target, value } of changes) send(target, value);
    } finally {
      unrecorded.current = false;
    }
  };
  // The room hears of a drag or a draft once, when it ends.
  const letGo = (target: BoardTarget, after?: string) => {
    const value = held.current.get(boardEditKey(target));
    if (value !== undefined) send(target, settleBoardValue(value), after);
  };
  // Everyone else sees a drag as it goes, with this person's pointer, and where it landed.
  const sendDrag = () => {
    if (pointing) cursor.drag(boardDragItems(held.current, gestureFrom.current));
  };
  const release = (go: () => void) => {
    const dragged = boardDragItems(held.current, gestureFrom.current);
    go();
    if (!pointing || dragged.length === 0) return;
    const still = boardDragItems(held.current, gestureFrom.current);
    if (still.length > 0) cursor.drag(still);
    else cursor.land(dragged);
  };
  // A selection dragged together lands together: one change for each card in it.
  const dropItem = (target: BoardTarget) =>
    release(() => {
      if (!inGroup(target)) return letGo(target);
      for (const item of selectedItems) letGo(item.target);
    });
  const dragBy = (target: BoardTarget, from: BoardPoint, dx: number, dy: number) => {
    if (!canEdit) return;
    if (inGroup(target)) {
      const now = selectedItems.map((item) => {
        const last = held.current.get(boardEditKey(item.target));
        return last !== undefined && "x" in last ? { ...item, value: last } : item;
      });
      for (const item of boardGroupMove(now, dx / view.zoom, dy / view.zoom)) {
        hold(item.target, item.value);
      }
      return sendDrag();
    }
    const last = held.current.get(boardEditKey(target));
    const at = last !== undefined && "x" in last ? last : from;
    hold(target, { ...at, x: at.x + dx / view.zoom, y: at.y + dy / view.zoom });
    sendDrag();
  };
  const noteNow = (note: RoomBoardNote): RoomBoardNote => {
    const last = held.current.get(noteRef(note.id));
    return last !== undefined && "text" in last ? last : note;
  };
  const sizedBy = (from: BoardRect, dx: number, dy: number) =>
    clampBoardSize({ w: from.width + dx / view.zoom, h: from.height + dy / view.zoom });
  const resizeCard = (id: string, corner: BoardCorner, from: BoardRect, dx: number, dy: number) => {
    if (!canEdit) return;
    if (corner === "right") hold({ kind: "size", id }, sizedBy(from, dx, dy));
    else {
      const next = resizeBoardFromLeft(from, dx / view.zoom, dy / view.zoom);
      hold({ kind: "size", id }, next.size);
      hold({ kind: "card", id }, { x: next.x, y: next.y });
    }
    sendDrag();
  };
  // A card's size and place are two changes; one queue sends them in order.
  const endCardResize = (id: string, corner: BoardCorner) =>
    release(() => {
      const queue = boardEditKey({ kind: "size", id });
      letGo({ kind: "size", id });
      if (corner === "left") letGo({ kind: "card", id }, queue);
    });
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
      hold({ kind: "note", id: note.id }, { ...now, size: sizedBy(from, dx, dy) });
    } else {
      const next = resizeBoardFromLeft(from, dx / view.zoom, dy / view.zoom);
      hold({ kind: "note", id: note.id }, { ...now, x: next.x, size: next.size });
    }
    sendDrag();
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
    note.kind === "comment" ||
    boardNoteMessage(note).trim() === ""
      ? undefined
      : () => onUseNote(boardNoteMessage(note));
  const giveOf = (note: RoomBoardNote) =>
    onGiveNote === undefined ||
    !canGive ||
    note.kind === "task" ||
    note.kind === "artifact" ||
    note.kind === "thread" ||
    note.kind === "comment" ||
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
    const hand = inGroup(target) ? undefined : handOf(note, dropTarget);
    setDropTarget(null);
    if (hand === undefined) return dropItem(target);
    const value = held.current.get(boardEditKey(target));
    held.current.delete(boardEditKey(target));
    gestureFrom.current.delete(boardEditKey(target));
    if (value !== undefined) setEdits((current) => dropBoardEdit(current, target, value));
    // It goes back where it was: nobody else is told it landed.
    sendDrag();
    hand();
  };
  const writeNote = (note: RoomBoardNote, text: string) =>
    hold({ kind: "note", id: note.id }, { ...noteNow(note), text });
  const changeNote: ChangeNote = (note, update) =>
    send({ kind: "note", id: note.id }, settleBoardValue(update(noteNow(note))));
  // A team's relay may not keep a colour yet, so only a room's notes offer one.
  const pickColor =
    canEdit && cards === undefined
      ? (note: RoomBoardNote, color: RoomBoardNoteColor) => {
          setNoteColor(color);
          changeNote(note, (current) => ({ ...current, color }));
        }
      : undefined;
  // A team's relay may not take reactions yet, so only a room's cards offer them.
  const reactTo =
    canEdit && cards === undefined && onChange !== undefined
      ? (note: RoomBoardNote, emoji: RoomBoardReactionEmoji) =>
          void queueChange(noteRef(note.id), () =>
            onChange({ type: "note.react", noteId: note.id, emoji }),
          )
      : undefined;
  const zoomBy = (factor: number) => {
    const area = boardAreaOf(surfaceRef.current);
    const center = { x: (area?.width ?? 0) / 2, y: (area?.height ?? 0) / 2 };
    setFollowing(null);
    setView((current) => zoomBoardAt(current, center, factor));
  };
  const full = shown.notes.length >= ROOM_BOARD_MAX_NOTES;
  const artifactsFull =
    shown.notes.filter((note) => note.kind === "artifact").length >= ROOM_BOARD_MAX_ARTIFACTS;
  const threadsFull =
    shown.notes.filter((note) => note.kind === "thread").length >= ROOM_BOARD_MAX_THREADS;
  const drawnRects = () => drawnRectsIn(surfaceRef.current);
  const takenRects = () =>
    boardTakenRects(
      [...(surfaceRef.current?.querySelectorAll<HTMLElement>("[data-board-item]") ?? [])].map(
        (element) => ({ ref: element.dataset.boardItem ?? "", rect: drawnRect(element) }),
      ),
      shown,
      cardIds,
      upcomingCardIds,
    );
  const drawnItem = (ref: string) =>
    surfaceRef.current?.querySelector<HTMLElement>(`[data-board-item="${CSS.escape(ref)}"]`) ??
    null;
  // Pans once, as little as it takes, and only when the rect is not already in view whole. A
  // card just added moves the view only when most of it is out of sight.
  const reveal = (rect: BoardRect, added = false) => {
    const area = boardAreaOf(surfaceRef.current);
    if (area === null) return;
    const next = added ? panToShowAdded(view, rect, area) : panToShow(view, rect, area);
    if (next === view) return;
    setFollowing(null);
    setView(next);
  };
  // A new card lands in view when there is room, clear of everything there at drawn sizes.
  const freeSpot = (kind: RoomBoardNote["kind"]): BoardPoint => {
    const size = boardNewNoteSize(kind);
    const within = visibleBoardRect(
      view,
      boardAreaOf(surfaceRef.current) ?? { width: 600, height: 400 },
    );
    return placeBoardItem(
      size,
      { x: within.x + within.width / 2, y: within.y + within.height / 2 },
      takenRects(),
      within,
    );
  };
  const newNote = (fields: Pick<RoomBoardNote, "kind" | "url">, at: BoardPoint) => {
    const id = randomUUID();
    const value = settleBoardValue({
      id,
      text: "",
      ...at,
      ...(viewer === null ? {} : { guestId: viewer }),
      ...(fields.kind === undefined ? {} : { kind: fields.kind }),
      ...(fields.url === undefined ? {} : { url: fields.url }),
      ...(fields.kind !== undefined || noteColor === null ? {} : { color: noteColor }),
    });
    send({ kind: "note", id }, value);
    const size = boardNewNoteSize(fields.kind);
    reveal({ x: value.x, y: value.y, width: size.w, height: size.h }, true);
    return id;
  };
  const addCard = (fields: Pick<RoomBoardNote, "kind" | "url">, wanted?: BoardPoint) => {
    if (!canEdit || full) return;
    newNote(fields, wanted ?? freeSpot(fields.kind));
  };
  /** Adds a card of `kind` beside an item, with a line between them in the direction given. */
  const addBeside = (ref: string, kind: "artifact" | "thread", direction: "from" | "to") => {
    const element = drawnItem(ref);
    if (!canEdit || full || element === null) return;
    const area = boardAreaOf(surfaceRef.current);
    const id = newNote(
      { kind },
      besideBoardItem(
        drawnRect(element),
        boardNewNoteSize(kind),
        takenRects(),
        area === null ? undefined : visibleBoardRect(view, area),
      ),
    );
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
  // Brings an item into view if it is not, and puts the caret in its prompt box.
  const focusItem = (ref: string) => {
    const element = drawnItem(ref);
    if (element === null) return;
    reveal(drawnRect(element));
    element.querySelector<HTMLElement>("[data-box-prompt]")?.focus({ preventScroll: true });
  };
  const fitAll = () => {
    const area = boardAreaOf(surfaceRef.current);
    if (area === null) return;
    setFollowing(null);
    setView(fitBoardView(drawnRects(), area));
  };
  const attachAgentOf = (note: RoomBoardNote) => {
    if (note.kind !== "artifact" || cards !== undefined || room === null) return undefined;
    const existing = boardOwnBoxFor(shown, viewer, note.id);
    if (existing !== null) {
      return { label: "Show my thread", run: () => focusItem(boardBoxRef(existing)) };
    }
    if (!canEdit || full || threadsFull) return undefined;
    return { label: "Attach my agent", run: () => addBeside(noteRef(note.id), "thread", "to") };
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
    setLinking({ from, box, to: at, press: { x: event.clientX, y: event.clientY } });
  };
  const moveLink = (event: PointerEvent<HTMLElement>) => {
    const at = pointerOnBoard(event);
    if (at === null || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    setLinking((current) => (current === null ? null : { ...current, to: at }));
  };
  const endLink = (event: PointerEvent<HTMLElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    const from = linking?.from;
    setLinking(null);
    // A grip sits on the end of any line drawn from it, so a click there is the line's.
    if (
      linking !== null &&
      Math.hypot(event.clientX - linking.press.x, event.clientY - linking.press.y) < CLICK_SLOP
    ) {
      setSelectedEdge(edgeAt(event.clientX, event.clientY));
      return;
    }
    const to = dataAt(event.clientX, event.clientY, "boardItem");
    if (from === undefined || to === null || to === from || edges.length >= ROOM_BOARD_MAX_EDGES) {
      return;
    }
    if (edges.some((edge) => edge.from === from && edge.to === to)) return;
    const id = randomUUID();
    send({ kind: "edge", id }, { id, from, to });
  };
  const link = canEdit ? { onStart: startLink, onMove: moveLink, onEnd: endLink } : undefined;

  const closeComment = () => {
    setOpenComment(null);
    setDraftComment(null);
  };
  const startComment = () => {
    closeComment();
    setPlacingComment((placing) => !placing);
    // Escape on the board stops placing.
    surfaceRef.current?.focus({ preventScroll: true });
  };
  // On click, not on press: the press's own focus change would take the caret out of the field.
  const placeComment = (event: MouseEvent<HTMLElement>) => {
    setPlacingComment(false);
    const at = pointerOnBoard(event);
    if (at === null || !canEdit || full) return;
    const half = (BOARD_PIN_SIZE * pinScale) / 2;
    const id = randomUUID();
    const on = dataAt(event.clientX, event.clientY, "boardItem");
    setDraftComment({ id, on, ...settleBoardValue({ x: at.x - half, y: at.y - half }) });
    setOpenComment(id);
  };
  const dragPin = (note: RoomBoardNote, dx: number, dy: number) =>
    dragBy({ kind: "note", id: note.id }, note, dx, dy);
  const dropPin = (note: RoomBoardNote) => release(() => letGo({ kind: "note", id: note.id }));
  const togglePin = (note: RoomBoardNote) => {
    setDraftComment(null);
    setOpenComment((open) => (open === note.id ? null : note.id));
  };
  const changeComment = (noteId: string, change: RoomBoardChange) =>
    onChange === undefined
      ? Promise.resolve(false)
      : queueChange(noteRef(noteId), () => onChange(change));
  const sendComment = (note: RoomBoardNote, text: string) => {
    if (note.id !== draftNote?.id) {
      return changeComment(note.id, {
        type: "comment.reply",
        noteId: note.id,
        replyId: randomUUID(),
        text,
      });
    }
    send({ kind: "note", id: note.id }, settleBoardValue({ ...note, text }));
    const to = boardCommentLineTo(shown, draftComment?.on ?? null);
    if (to !== null) {
      const line = randomUUID();
      // Part of starting the thread, which undo does not take back.
      unrecorded.current = true;
      try {
        send(
          { kind: "edge", id: line },
          { id: line, from: noteRef(note.id), to },
          boardEditKey({ kind: "note", id: note.id }),
        );
      } finally {
        unrecorded.current = false;
      }
    }
    setDraftComment(null);
    return Promise.resolve(true);
  };
  const askBoxes =
    askInComments && canEdit && onPromptBox !== undefined
      ? boardCommentAskBoxes(threadBoxes, viewer)
      : [];
  // The question goes in the thread as the asker's reply, then to the box with the whole thread.
  const askInComment = async (note: RoomBoardNote, boxId: string, text: string) => {
    if (onPromptBox === undefined) return false;
    if (text !== "") {
      const taken = await changeComment(note.id, {
        type: "comment.reply",
        noteId: note.id,
        replyId: randomUUID(),
        text,
      });
      if (!taken) return false;
    }
    // The board may not show the question yet, so the card adds it as the asker's.
    const card = boardCommentPromptCard(note, people, text);
    const sent = await onPromptBox(boxId, {
      text: text === "" ? BOARD_COMMENT_ASK_TEXT : text,
      cards: card === null ? [] : [card],
      artifactId: null,
      commentId: note.id,
    });
    // A question already in the thread leaves the field either way.
    return sent || text !== "";
  };
  const commentPanel = () => {
    if (openNote === null) return null;
    const pin = BOARD_PIN_SIZE * pinScale * view.zoom;
    return (
      <CommentThreadPanel
        key={openNote.id}
        note={openNote}
        people={people}
        draft={openNote === draftNote}
        canEdit={canEdit}
        pin={{
          x: view.x + openNote.x * view.zoom,
          y: view.y + openNote.y * view.zoom,
          width: pin,
          height: pin,
        }}
        askBoxes={askBoxes}
        onSend={(text) => sendComment(openNote, text)}
        onAsk={(boxId, text) => askInComment(openNote, boxId, text)}
        onRemoveReply={(replyId) =>
          void changeComment(openNote.id, {
            type: "comment.reply.remove",
            noteId: openNote.id,
            replyId,
          })
        }
        onResolve={(resolved) =>
          void changeComment(openNote.id, {
            type: "comment.resolve",
            noteId: openNote.id,
            resolved,
          })
        }
        onDelete={
          canEdit && isRoomCardOwnedBy(openNote, viewer)
            ? () => {
                closeComment();
                send({ kind: "note", id: openNote.id }, null);
              }
            : undefined
        }
        onClose={closeComment}
      />
    );
  };
  const toggleSelected = (ref: string) =>
    setSelection((current) => {
      const next = new Set(current);
      if (!next.delete(ref)) next.add(ref);
      return next;
    });
  // What is someone else's stays on the board, and selected.
  const deleteSelection = () => {
    for (const id of removal.noteIds) send({ kind: "note", id }, null);
    const gone = new Set(removal.noteIds.map(noteRef));
    setSelection(new Set([...selected].filter((ref) => !gone.has(ref))));
    if (removal.left > 0) {
      toastManager.add({
        type: "info",
        title: `Left ${removal.left} ${removal.left === 1 ? "card" : "cards"} that ${removal.left === 1 ? "is" : "are"} someone else's`,
        description: "Only the owner and whoever added a card can delete it.",
      });
    }
  };
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
    const area = boardAreaOf(surfaceRef.current);
    if (area === null) return;
    setView(followBoardView(viewport, area));
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
    // Always offered to the owner: a box with no conversation yet says so in the panel.
    // A box whose last turn ran on a guest's machine has its conversation there, not here.
    const ranElsewhere =
      conversationBoxIds === undefined &&
      shown.notes.find((note) => note.id === box.id)?.thread?.turns.at(-1)?.guestId !== undefined;
    const conversation =
      onOpenConversation === undefined ||
      ranElsewhere ||
      (conversationBoxIds !== undefined && !conversationBoxIds.includes(box.id))
        ? undefined
        : () => onOpenConversation(box.id);
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
          placeholder={box.guestId === undefined ? "Ask your agent" : guestBoxPlaceholder}
          model={renderBoxModel?.(box.id)}
          onPrompt={(prompt) => onPromptBox(box.id, prompt)}
        />
      );
    const body = (
      <>
        {tail}
        <BoxProgress boxId={box.id} fallback={fallback} approval={renderBoxApproval?.(box.id)} />
        <BoxRequests
          requests={boardBoxRequests(room?.messages ?? [], box.id)}
          board={shown}
          people={people}
          onResolve={onResolveRequest}
          resolving={resolvingRequests}
          model={renderRequestModel?.(box.id)}
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
          <>
            <p className="text-2xs text-muted-foreground">{boardBoxAgentLabel(roomBox, people)}</p>
            <ThreadMessages messages={messages} />
          </>,
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
    <div className="@container/board flex min-h-0 min-w-0 flex-1 flex-col overflow-clip overscroll-none">
      <header
        className={cn(
          "flex shrink-0 flex-wrap items-center gap-1 border-b border-border px-3 py-2 @5xl/board:gap-2",
          COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
        )}
      >
        <Button size="sm" variant="ghost" onClick={onBack ?? onOpenThread}>
          <ArrowLeftIcon />
          <ToolLabel>{backLabel}</ToolLabel>
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
            {cards !== undefined ? null : onAddThread === undefined ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || full || threadsFull}
                onClick={() => addCard({ kind: "thread" })}
              >
                <MessagesSquareIcon />
                <ToolLabel>Thread</ToolLabel>
              </Button>
            ) : (
              <Menu>
                <MenuTrigger
                  disabled={!canEdit || full || threadsFull}
                  render={<Button size="sm" variant="outline" />}
                >
                  <MessagesSquareIcon />
                  <ToolLabel>Thread</ToolLabel>
                  <ChevronDownIcon />
                </MenuTrigger>
                <MenuPopup align="start">
                  <MenuItem onClick={() => addCard({ kind: "thread" })}>New thread box</MenuItem>
                  <MenuItem
                    onClick={() => {
                      const at = freeSpot("thread");
                      const size = boardNewNoteSize("thread");
                      reveal({ ...at, width: size.w, height: size.h }, true);
                      onAddThread(at);
                    }}
                  >
                    Add one of your threads…
                  </MenuItem>
                </MenuPopup>
              </Menu>
            )}
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || full}
              onClick={() => addCard({})}
            >
              <StickyNoteIcon />
              <ToolLabel>Note</ToolLabel>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || full}
              onClick={() => addCard({ kind: "task" })}
            >
              <ListTodoIcon />
              <ToolLabel>Task</ToolLabel>
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!canEdit || full}
              onClick={() => setLinkDraft("")}
            >
              <LinkIcon />
              <ToolLabel>Link</ToolLabel>
            </Button>
            {cards === undefined ? (
              <Button
                size="sm"
                variant="outline"
                disabled={!canEdit || full || artifactsFull}
                onClick={() => addCard({ kind: "artifact" })}
              >
                <AppWindowIcon />
                <ToolLabel>Artifact</ToolLabel>
              </Button>
            ) : null}
            {cards === undefined ? (
              <Button
                size="sm"
                variant={placingComment ? "secondary" : "outline"}
                aria-pressed={placingComment}
                disabled={!canEdit || full}
                onClick={startComment}
              >
                <MessageCirclePlusIcon />
                <ToolLabel>Comment</ToolLabel>
              </Button>
            ) : null}
            {cards === undefined ? (
              // As wide as its widest count, and kept while nothing is resolved, so the tools
              // never move.
              <span className="grid">
                <span aria-hidden className="invisible col-start-1 row-start-1 flex">
                  <Button size="sm" variant="ghost" tabIndex={-1}>
                    <CircleCheckIcon />
                    <ResolvedCount count={RESOLVED_WIDEST_COUNT} />
                  </Button>
                </span>
                <span
                  className={cn(
                    "col-start-1 row-start-1 flex",
                    resolvedComments === 0 && "invisible",
                  )}
                >
                  <Button
                    size="sm"
                    variant={showResolved ? "secondary" : "ghost"}
                    aria-pressed={showResolved}
                    aria-label={`Resolved (${resolvedComments})`}
                    aria-hidden={resolvedComments === 0 || undefined}
                    tabIndex={resolvedComments === 0 ? -1 : undefined}
                    onClick={() => setShowResolved((shown) => !shown)}
                  >
                    <CircleCheckIcon />
                    <ResolvedCount count={resolvedComments} />
                  </Button>
                </span>
              </span>
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
        <BoardHistoryButtons
          canUndo={canEdit && history.undo.length > 0}
          canRedo={canEdit && history.redo.length > 0}
          onUndo={() => travel("undo")}
          onRedo={() => travel("redo")}
        />
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
        <Button size="sm" variant="ghost" onClick={fitAll}>
          <ScanIcon />
          <ToolLabel>Fit</ToolLabel>
        </Button>
      </header>
      <div
        ref={surfaceRef}
        role="application"
        aria-label="Room board"
        // Focusable so a link pasted on the board lands as a card. Clipped, not hidden, so
        // focusing a card at the edge cannot scroll the board out from under the pointer.
        tabIndex={0}
        className={cn(
          "group/board relative min-h-0 flex-1 cursor-grab touch-none overflow-clip bg-background outline-none active:cursor-grabbing",
          following !== null && "transition-[background-position,background-size] duration-200",
        )}
        style={boardGridStyle(view)}
        {...pan}
        // While a pointer is held on the board, artifact pages let it through; see RoomArtifactBody.
        onPointerDownCapture={(event) => {
          event.currentTarget.dataset.boardBusy = "";
          // Cards stop their presses from reaching the board, and a press on one closes the thread too.
          const target = event.target;
          if (
            openComment !== null &&
            target instanceof Element &&
            event.currentTarget.contains(target) &&
            target.closest("[data-board-overlay], [data-board-pin]") === null
          ) {
            closeComment();
          }
          // Shift and a press on a card selects it, or takes it out of the selection.
          const item =
            event.shiftKey && canEdit && target instanceof Element && isSelectPress(target)
              ? target.closest<HTMLElement>("[data-board-item]")
              : null;
          const ref = item?.dataset.boardItem;
          if (ref !== undefined && event.currentTarget.contains(target as Node)) {
            event.stopPropagation();
            toggleSelected(ref);
          }
        }}
        onMouseDownCapture={(event) => {
          // A Shift press that selects cards or draws a marquee would also extend the page's text
          // selection, which then makes the next drag a native one. Text fields keep theirs.
          if (event.shiftKey && canEdit && isInside(event) && isSelectPress(event.target)) {
            event.preventDefault();
          }
        }}
        onPointerUpCapture={(event) => {
          delete event.currentTarget.dataset.boardBusy;
        }}
        onPointerCancelCapture={(event) => {
          delete event.currentTarget.dataset.boardBusy;
        }}
        onPointerDown={(event) => {
          if (!isInside(event)) return;
          setSelectedEdge(null);
          if (event.shiftKey && canEdit && event.button === 0) return marquee.start(event);
          pan.onPointerDown(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (placingComment) setPlacingComment(false);
            else if (openComment !== null) closeComment();
            else if (selected.size > 0 && isBoardKey(event.target)) setSelection(NO_SELECTION);
            return;
          }
          if ((event.ctrlKey || event.metaKey) && !event.altKey && isBoardKey(event.target)) {
            const key = event.key.toLowerCase();
            const redo = (key === "z" && event.shiftKey) || (key === "y" && !event.metaKey);
            if (key === "z" || redo) {
              event.preventDefault();
              travel(redo ? "redo" : "undo");
              return;
            }
          }
          // Delete acts only on the board itself, so a focused card's own controls keep theirs.
          if (
            (event.key === "Delete" || event.key === "Backspace") &&
            event.target === event.currentTarget &&
            removal.noteIds.length > 0
          ) {
            event.preventDefault();
            event.currentTarget
              .querySelector<HTMLButtonElement>("[data-selection-delete]")
              ?.click();
          }
        }}
        onPointerMove={(event) => {
          if (!marquee.move(event)) pan.onPointerMove(event);
          trackCursor(event);
        }}
        onPointerUp={(event) => {
          if (!marquee.end(event)) pan.onPointerUp(event);
        }}
        onPointerCancel={(event) => {
          if (!marquee.end(event)) pan.onPointerCancel(event);
        }}
        onPointerLeave={cursor.leave}
        onPaste={pasteOnBoard}
        // A prompt box taking focus brings its Send button into the board's visible area.
        onFocusCapture={(event) => {
          const prompt =
            event.target instanceof Element
              ? event.target.closest<HTMLElement>("[data-board-prompt]")
              : null;
          const area = boardAreaOf(surfaceRef.current);
          if (prompt === null || area === null) return;
          const drawn = prompt.getBoundingClientRect();
          reveal(
            clientRectToBoard(view, area, {
              x: drawn.left,
              y: drawn.top,
              width: drawn.width,
              height: drawn.height,
            }),
          );
        }}
      >
        <BoardSelectionContext value={selected}>
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
                          data-board-edge={edge.id}
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
                onDrop={dropItem}
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
                onDrop={dropItem}
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
                  onDrop={dropItem}
                >
                  <GuestDetails
                    guest={guest}
                    messages={room?.messages ?? NO_GUEST_MESSAGES}
                    boxes={threadBoxes}
                    viewer={viewer}
                  />
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
                  onDrop={dropItem}
                >
                  <p className="text-2xs text-muted-foreground">Runs on their machine</p>
                  {now !== undefined ? (
                    <p
                      role="status"
                      className="text-xs font-medium text-info first-letter:uppercase"
                    >
                      {boardAgentName(people, guest.id)} is working
                    </p>
                  ) : latest !== undefined ? (
                    <>
                      {latest.prompt ? (
                        <p className="line-clamp-2 border-s-2 border-guest/50 ps-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                          {latest.prompt}
                        </p>
                      ) : null}
                      <p className="line-clamp-6 text-xs [overflow-wrap:anywhere]">
                        {roomBoxExcerpt(latest.reply, ROOM_BOX_REPLY_MAX_LENGTH)}
                      </p>
                    </>
                  ) : null}
                  <RoomCode code={boardAgentCode(agent)} />
                </BoardCard>
              );
            })}
            {shown.notes.map((note) => {
              if (note.kind === "comment") return null;
              const box =
                note.kind === "thread" && cards === undefined
                  ? boxParts(
                      { id: note.id, guestId: note.guestId, title: note.text.trim() },
                      <BoxTurns boxId={note.id} turns={note.thread?.turns ?? []} people={people} />,
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
                  onBlur={(target) => release(() => letGo(target))}
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
                  onPickColor={pickColor}
                  onReact={reactTo}
                  box={
                    box === undefined
                      ? undefined
                      : {
                          label: boardBoxAgentLabel(note, people, note.thread?.turns.at(-1)),
                          body: box.body,
                          footer: box.prompt,
                        }
                  }
                />
              );
            })}
            {[...commentNotes, ...(draftNote === null ? [] : [draftNote])].map((note) =>
              hiddenComment(note) ? null : (
                <CommentPin
                  key={note.id}
                  note={note}
                  people={people}
                  open={openComment === note.id}
                  scale={pinScale}
                  itemRef={noteRef(note.id)}
                  handle={
                    note === draftNote ? null : (
                      <PinLinkHandle from={noteRef(note.id)} link={link} />
                    )
                  }
                  movable={canEdit && note !== draftNote}
                  onDrag={dragPin}
                  onDrop={dropPin}
                  onToggle={togglePin}
                  unread={unread(note)}
                />
              ),
            )}
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
        </BoardSelectionContext>
        {marquee.layer}
        {selected.size === 0 ? null : (
          <SelectionBar
            count={selected.size}
            removable={canEdit ? removal.noteIds.length : 0}
            onDelete={deleteSelection}
            onClear={() => setSelection(NO_SELECTION)}
          />
        )}
        {placingComment ? (
          <div
            aria-hidden
            data-board-overlay
            className="absolute inset-0 z-20 cursor-crosshair"
            onPointerDown={stopPointer}
            onClick={placeComment}
          />
        ) : null}
        {commentPanel()}
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

/**
 * What the coloured lines do, said where people see them. Folded away until asked for, so it never
 * covers a card.
 */
function LineLegend() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div
      className="absolute bottom-3 left-3 flex flex-col items-start gap-1"
      onPointerDown={stopPointer}
    >
      {open ? (
        <div
          id={id}
          className="flex flex-col gap-1 rounded-md border border-border bg-card/90 px-2 py-1.5 text-2xs text-muted-foreground"
        >
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
      ) : null}
      <Button
        size="micro"
        variant="outline"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((shown) => !shown)}
      >
        {open ? "Hide lines" : "Lines"}
      </Button>
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
  /**
   * A card's header is taller than a note's; the grip sits level with its middle. A pin's sits
   * just outside it, so the pin itself stays easy to press.
   */
  readonly on: "card" | "note" | "pin";
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
              on === "pin" ? "-right-7" : side === "right" ? "-right-3" : "-left-3",
              on === "card" ? "top-1.5" : on === "pin" ? "top-1" : "top-0",
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

/** The grip a line is drawn from on a comment pin, for whoever may edit the board. */
function PinLinkHandle({
  from,
  link,
}: {
  readonly from: string;
  readonly link: LinkHandlers | undefined;
}) {
  return link === undefined ? null : <LinkHandle from={from} link={link} on="pin" side="right" />;
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
  onPickColor,
  onReact,
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
  readonly onAttachAgent: { readonly label: string; readonly run: () => void } | undefined;
  /** Colours a plain note. Absent where notes are not coloured. */
  readonly onPickColor: ((note: RoomBoardNote, color: RoomBoardNoteColor) => void) | undefined;
  /** Toggles the viewer's own reaction. Absent where they cannot react. */
  readonly onReact: ((note: RoomBoardNote, emoji: RoomBoardReactionEmoji) => void) | undefined;
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
  const mine = isRoomCardOwnedBy(note, people.viewer);
  const canChange = canEdit && (!thread || mine);
  const canDelete = canEdit && mine;
  const size = boardNoteSize(note);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const selected = useBoardSelected(noteRef(note.id));
  const live = boardLiveRect(
    { x: note.x, y: note.y, w: size?.w, h: size?.h },
    useBoardLiveDrag(noteRef(note.id)),
  );
  return (
    <div
      className={cn(
        "group/item absolute flex flex-col rounded-sm border text-foreground shadow-lg",
        size === undefined && live?.w === undefined && "w-48",
        selected && "ring-2 ring-primary ring-offset-2 ring-offset-background",
        note.kind === undefined
          ? noteColorClassName(note.color)
          : "border-border bg-card text-card-foreground",
      )}
      style={{
        left: note.x,
        top: note.y,
        width: live?.w ?? size?.w,
        height: live?.h ?? size?.h,
        ...boardLiveStyle(note, live),
      }}
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
        {onReact === undefined ? null : <AddReaction onReact={(emoji) => onReact(note, emoji)} />}
        {plain && onPickColor !== undefined ? (
          <NoteColorPicker color={note.color} onPick={(color) => onPickColor(note, color)} />
        ) : null}
        {canDelete ? (
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
          readOnly={!canChange}
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
                    ? canChange
                      ? "Name this thread"
                      : "Untitled thread"
                    : "Write a note, or paste a link"
          }
          className={cn(
            "resize-none bg-transparent px-3 pb-3 text-sm leading-snug outline-none placeholder:text-placeholder",
            note.kind === "task" && note.done === true && "text-muted-foreground line-through",
            titled ? "shrink-0 pb-2 font-medium" : size !== undefined && "min-h-0 flex-1",
            !canChange && "cursor-default",
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
              onClick={onAttachAgent.run}
            >
              <BotIcon />
              {onAttachAgent.label}
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
      <ReactionChips
        reactions={note.reactions ?? NO_REACTIONS}
        people={people}
        onReact={onReact === undefined ? undefined : (emoji) => onReact(note, emoji)}
      />
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
  const selected = useBoardSelected(cardRef(id));
  const live = boardLiveRect(
    { x: at.x, y: at.y, w: size?.w, h: size?.h },
    useBoardLiveDrag(cardRef(id)),
  );
  return (
    <section
      className={cn(
        "group/item absolute flex flex-col rounded-xl border border-border bg-card text-card-foreground shadow-lg",
        dashed && "border-dashed",
        (highlighted || selected) && "ring-2 ring-primary",
      )}
      style={{
        left: at.x,
        top: at.y,
        width: live?.w ?? size?.w ?? BOARD_CARD_WIDTH,
        height: live?.h ?? size?.h,
        ...boardLiveStyle(at, live),
      }}
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
  const running = useBoxProgress(ROOM_BOARD_ROOM_BOX) !== undefined;
  if (messages.length === 0) {
    return running ? null : <p className="text-xs text-muted-foreground">No messages yet.</p>;
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
  messages,
  boxes,
  viewer,
}: {
  readonly guest: ThreadGuest;
  readonly messages: ReadonlyArray<ThreadGuestMessage>;
  /** The thread boxes on the board: a request waiting on one shows there, not here. */
  readonly boxes: ReadonlyArray<BoardThreadBox>;
  readonly viewer: GuestId | null;
}) {
  const waiting = boardGuestWaiting(messages, guest.id, boxes);
  const onBoxes = boardGuestWaiting(messages, guest.id, []).length - waiting.length;
  return (
    <>
      <p className="text-xs text-muted-foreground">
        {guest.account === undefined ? "Not signed in" : `@${guest.account.login}`}
        {guest.trusted === true ? " · sends without asking" : ""}
      </p>
      {waiting.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          {onBoxes > 0
            ? `${onBoxes} waiting on ${onBoxes === 1 ? "a thread box" : "thread boxes"}.`
            : viewer === null
              ? "Nothing waiting for you."
              : "Nothing waiting for the owner."}
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
  const live = use(RoomLiveContext);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands what others drag to the board's live store, so only the cards they move render
  useEffect(() => {
    live.setDraggers(
      cursors.map((cursor) => ({
        color: boardCursorColor(guests, cursor.guestId),
        drag: cursor.drag,
      })),
    );
  }, [live, cursors, guests]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a board that closes takes everyone's drags off its live store
  useEffect(() => () => live.setDraggers([]), [live]);
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
