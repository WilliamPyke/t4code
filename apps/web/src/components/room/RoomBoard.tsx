import {
  type GuestId,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_CODE_WINDOWS,
  ROOM_BOARD_MAX_PULL_REQUESTS,
  roomPullRequestOf,
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
  FileCode2Icon,
  ArrowLeftIcon,
  BotIcon,
  ChevronDownIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  CodeXmlIcon,
  CopyIcon,
  ExternalLinkIcon,
  FrameIcon,
  GitBranchIcon,
  LayoutGridIcon,
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
  SquareDashedIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type ComponentProps,
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
import { flushSync } from "react-dom";

import {
  canRestoreRoomArtifact,
  isRoomCardOwnedBy,
  roomBoxCodeWindows,
  roomBoxExcerpt,
  roomWindowBoxId,
} from "@t3tools/shared/roomBoard";

import {
  readTextFromClipboard,
  useCopyToClipboard,
  writeTextToClipboard,
} from "~/hooks/useCopyToClipboard";
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
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
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
  type BoardPromptCard,
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
  boardDuplicates,
  boardCentreSpot,
  boardKeyEditsNote,
  type BoardMenuEntry,
  boardMenuEntries,
  boardTidy,
  boardDragItems,
  boardTakenRects,
  boardAddSection,
  boardAddSpot,
  boardCopySkipped,
  boardCodeEdgeIds,
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
  BOARD_PERSON_COLORS,
  boardCursorColor,
  boardEditKey,
  boardGroupMove,
  boardHistoryChanges,
  boardHistoryWith,
  boardItemsInRect,
  boardItemsCentredIn,
  boardSectionAround,
  BOARD_SECTION_SIZE,
  type BoardSelected,
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
  BOARD_PAGE_TO_ARTIFACT_TEXT,
  boardCommentAskBoxes,
  boardCommentPromptCard,
  boardUrlIn,
  boardValueOf,
  boardViewportOf,
  canPromptBoardBox,
  clampBoardSize,
  cursorSender,
  dropBoardEdit,
  dropHeldBoardEdits,
  fitBoardView,
  openingBoardView,
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
  wheelZoomFactor,
  zoomBoardAt,
} from "./roomBoard.logic";
import { rememberRoomBoardView, rememberedRoomBoardView } from "./roomBoardNavigation";
import { RoomArtifactLive } from "./RoomBoardArtifact";
import { type ReadRoomCodePatch, RoomCodeWindow } from "./RoomBoardCode";
import { PullRequestStateIcon, RoomPullRequestWindow } from "./RoomBoardPullRequest";
import { CommentPin, CommentThreadPanel } from "./RoomBoardComments";
import { useCommentUnread } from "./roomCommentSeen";
import {
  NoteColorPicker,
  noteColorClassName,
  paintSwatchClassName,
  useLastNoteColor,
} from "./RoomNoteColor";
import {
  BoardContextMenu,
  type CardAction,
  CardActionsMenu,
  type CardMenu,
} from "./RoomBoardCardMenu";
import { WhatItDoes, WhyNot } from "./RoomBoardWhy";
import { BoardHistoryButtons } from "./RoomBoardHistory";
import { AddReaction, ReactionChips } from "./RoomBoardReactions";
import {
  BoardSelectionContext,
  SelectionBar,
  isBoardKey,
  useBoardMarquee,
  useBoardSelected,
  useBoardSelectedAlone,
} from "./RoomBoardSelection";
import { BoardPromptBox } from "./RoomBoardPrompt";
import { BoardEdgeLine } from "./RoomBoardEdge";
import {
  CLICK_SLOP,
  boardPressKind,
  dragHandlers,
  dropHeldPointer,
  focusTextAt,
  holdPointer,
  isInside,
  leaveText,
} from "./roomBoardPointer";
import { BoardSection } from "./RoomBoardSection";
import {
  BOARD_HOVER_CHROME_CLASS,
  BOARD_ICON_BUTTON_CLASS,
  BOARD_SELECTED_CHROME_CLASS,
  BOARD_TITLE_BAR_CLASS,
  BOARD_WINDOW_CLASS,
  BoardChip,
  type BoardChipTone,
  BoardFloat,
  PersonDot,
} from "./BoardChrome";
import { BoxProgress, BoxRequests, BoxTurns } from "./RoomBoardThreadBox";
import {
  RoomLiveContext,
  boardLiveRect,
  boardLiveText,
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
const VIEW_SAVE_DELAY_MS = 500;
/** How far past the originals a duplicate is looked for, in board pixels. */
const DUPLICATE_OFFSET = 40;
// Below this zoom a card's header buttons are too small to miss, and fold into one menu.
const COMPACT_CARD_ZOOM = 0.8;
// Fitting keeps cards clear of the header pills and the toolbar floating over the board's edges.
const FIT_MARGIN = 72;
// The bottom toolbar's height with its gap below, which the board's own view keeps cards out of.
const BOARD_TOOLBAR_BAND = 60;
/** How far an arrow key moves the selection, in board pixels, and with Shift. */
const NUDGE_STEP = 4;
const NUDGE_STEP_LARGE = 40;
// Nudges this close together are one move, sent once and undone at once.
const NUDGE_SETTLE_MS = 500;
const NUDGES: Readonly<Record<string, readonly [number, number]>> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};
// About what three clamped lines of a quote hold on a note of the default width.
const QUOTE_CLAMP_LENGTH = 90;
const BOARD_CODE_WINDOW_HINT =
  "Adds a code window beside this thread box. Everyone in the room will see the files its thread changed and their diffs, updated as each turn ends.";

/**
 * What a line does: carries a card into a box's next prompt (`context`), every prompt (`pinned`),
 * or carried it already and waits for it to change (`sent`); or takes the box's replies.
 */
type EdgeRole = "plain" | "context" | "sent" | "pinned" | "artifact";
type EdgeStroke = EdgeRole | "selected";
// The accent carries context; dashed and muted, it was sent already. A line that rewrites an
// artifact takes its agent's person colour, drawn per line (see `lineColor`).
const EDGE_STROKE_COLORS: Readonly<Record<EdgeStroke, string>> = {
  plain: "color-mix(in srgb, var(--color-muted-foreground) 70%, transparent)",
  context: "var(--color-primary)",
  sent: "var(--color-muted-foreground)",
  pinned: "var(--color-primary)",
  artifact: "var(--color-muted-foreground)",
  selected: "var(--color-primary)",
};
const EDGE_STROKE_WIDTHS: Readonly<Record<EdgeStroke, number>> = {
  plain: 1.5,
  context: 1.5,
  sent: 1.5,
  pinned: 2.5,
  artifact: 1.5,
  selected: 2,
};
const EDGE_STROKES = Object.entries(EDGE_STROKE_COLORS);

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** A tool on the board's toolbar: an icon, named on hover and to screen readers. */
function BoardTool({
  label,
  hint,
  children,
  ...props
}: ComponentProps<typeof Button> & { readonly label: string; readonly hint?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button size="icon" variant="ghost" aria-label={label} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipPopup side="top">{hint ?? label}</TooltipPopup>
    </Tooltip>
  );
}

const BoardToolDivider = () => (
  <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-board-hairline" />
);

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
/** Whether the page may read the clipboard without the browser asking; Paste is offered only then. */
async function clipboardReadable(): Promise<boolean> {
  try {
    // "clipboard-read" is Chromium's, and missing from the DOM's permission names.
    const status = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
    return status.state === "granted";
  } catch {
    return false;
  }
}

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
  // A 16px grip on the corner, reaching only 4px past it: it covers the card's corner padding and
  // never its buttons or text, and a press just beside the card is the board's.
  return (
    <div
      aria-hidden
      data-board-grip
      className={cn(
        "absolute -bottom-1 z-10 grid size-4 touch-none place-items-center",
        BOARD_HOVER_CHROME_CLASS,
        corner === "right" ? "-right-1 cursor-nwse-resize" : "-left-1 cursor-nesw-resize",
      )}
      onPointerDown={(event) => {
        // A section's grips sit in a `display: contents` wrapper, which measures 0 by 0.
        const box = event.currentTarget.closest<HTMLElement>("[data-board-item]");
        if (event.button !== 0 || box === null) return;
        // Neither the board nor the card under the corner moves.
        event.stopPropagation();
        event.preventDefault();
        holdPointer(event);
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
          "size-2 border-b-2 border-muted-foreground",
          corner === "right" ? "rounded-br-xs border-e-2" : "rounded-bl-xs border-s-2",
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
  viewKey,
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
  sharing,
  titleEditor,
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
  readCodePatch,
  onRefreshPullRequest,
  boxPullRequestUrl,
}: {
  readonly title: string;
  /** Null when the thread is not shared, so there is no room to arrange a board for. */
  readonly room: BoardRoom | null;
  /** The share the board is, which names what this device remembers of it. */
  readonly shareId?: string | undefined;
  /** Names the view this device remembers for the board, so it reopens where it was left. */
  readonly viewKey?: string | undefined;
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
  /** Who is in the room and the way to share it, shown after the title in place of the summary. */
  readonly sharing?: ReactNode;
  /** Shown in place of the title in the header, to rename the board there. */
  readonly titleEditor?: ReactNode;
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
  /** Reads one file of a code window from the machine that has its box's thread. */
  readonly readCodePatch?: ReadRoomCodePatch | undefined;
  /** Asks the owner's server to read a pull request window's pull request again. */
  readonly onRefreshPullRequest?: ((noteId: string) => void) | undefined;
  /**
   * The pull request a thread box's thread is linked to, where this client knows it. The room's
   * own box falls back to the one its branch has.
   */
  readonly boxPullRequestUrl?: ((boxId: string) => string | undefined) | undefined;
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
  // The view left here last time, which the board reopens on when it still shows a card.
  const [remembered] = useState(() =>
    viewKey === undefined ? undefined : rememberedRoomBoardView(viewKey),
  );
  const [view, setView] = useState<BoardView>(remembered ?? INITIAL_BOARD_VIEW);
  const unsavedView = useRef<BoardView | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fitted = useRef(false);
  const canEdit = room !== null && onChange !== undefined;
  // Each board the room sends retires the edits it moved past, before any can show again.
  const settledEdits = settleBoardEdits(board, edits);
  if (settledEdits !== edits) setEdits(settledEdits);
  const shown = resolveBoard(board, settledEdits);
  const edges = shown.edges ?? [];
  // The card a note held over would be handed to, and what that does.
  const [dropTarget, setDropTarget] = useState<{
    readonly on: string;
    readonly label: string;
  } | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  // The right-click menu: where it opened on screen and on the board, and the note it is for.
  const [contextMenu, setContextMenu] = useState<{
    readonly x: number;
    readonly y: number;
    readonly at: BoardPoint;
    readonly ref: string | null;
    readonly canPaste: boolean;
  } | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  // What the address typed in the toolbar adds: a link card or a pull request window.
  const [draftKind, setDraftKind] = useState<"link" | "pull-request">("link");
  const draftUrl = (text: string) =>
    draftKind === "pull-request" ? (roomPullRequestOf(text)?.url ?? null) : boardUrlIn(text);
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
  // A press on a card (its ref) or on the empty board (null), to tell a click from a drag.
  const press = useRef<{
    readonly on: string | null;
    readonly x: number;
    readonly y: number;
    moved: boolean;
  } | null>(null);
  const marquee = useBoardMarquee((rect) => {
    const area = boardAreaOf(surfaceRef.current);
    if (area === null) return;
    // A section is selected by its title bar, so a marquee over one picks out its cards.
    const items = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-pin]):not([data-board-section])",
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- takes this person's pointer, view and drag off everyone else's board when the board or its page closes
  useEffect(() => {
    const close = () => cursor.close();
    window.addEventListener("pagehide", close);
    return () => {
      window.removeEventListener("pagehide", close);
      close();
    };
  }, [cursor]);
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
          ? zoomBoardAt(current, anchor, wheelZoomFactor(event.deltaY, event.deltaMode))
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
    setView((current) =>
      current === INITIAL_BOARD_VIEW ||
      (current === remembered && openingBoardView(current, area, rects) === null)
        ? fitBoardView(rects, area, FIT_MARGIN)
        : current,
    );
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the first view is measured from the cards and the surface as the browser laid them out
  useLayoutEffect(fitFirst, [fitFirst, fittable]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keeps the view in this device's storage, written once it settles
  useEffect(() => {
    if (viewKey === undefined || !fitted.current) return;
    unsavedView.current = view;
    const timer = setTimeout(() => {
      unsavedView.current = null;
      rememberRoomBoardView(viewKey, view);
    }, VIEW_SAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [view, viewKey]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a view still settling when the board closes is kept too
  useEffect(
    () => () => {
      if (viewKey !== undefined && unsavedView.current !== null) {
        rememberRoomBoardView(viewKey, unsavedView.current);
      }
    },
    [viewKey],
  );
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
  // A line into several boxes reads as the most a card does along it: pinned, then going, then sent.
  const pinnedEdges = new Set<string>();
  const goingEdges = new Set<string>();
  for (const context of contexts.values()) {
    for (const [id, status] of context.edgeStatus) {
      if (status === "pinned") pinnedEdges.add(id);
      else if (status !== "sent") goingEdges.add(id);
    }
  }
  // A box's line to the code window that shows its changes fills it, as one to its artifact does.
  const artifactEdges = new Set([
    ...[...contexts.values()].flatMap((context) =>
      context.artifactEdgeId === null ? [] : [context.artifactEdgeId],
    ),
    ...(cards === undefined ? boardCodeEdgeIds(shown) : []),
  ]);
  const edgeRole = (id: string): EdgeRole =>
    pinnedEdges.has(id)
      ? "pinned"
      : goingEdges.has(id)
        ? "context"
        : contextEdges.has(id)
          ? "sent"
          : artifactEdges.has(id)
            ? "artifact"
            : "plain";
  // Pinning takes one of the card's lines; unpinning clears every pinned one.
  const pinPromptCard = (card: BoardPromptCard, pinned: boolean) => {
    if (onChange === undefined) return;
    const lines = (shown.edges ?? []).filter(
      (edge) => card.edgeIds?.includes(edge.id) === true && (edge.pinned === true) !== pinned,
    );
    for (const edge of pinned ? lines.slice(0, 1) : lines) {
      void queueChange(boardChangeQueueKey(shown, { kind: "edge", id: edge.id }, null), () =>
        onChange({ type: "edge.pin", edgeId: edge.id, pinned }),
      );
    }
  };
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
      const group = inGroup(target) ? selectedItems : carried.current.get(boardEditKey(target));
      carried.current.delete(boardEditKey(target));
      if (group === undefined) return letGo(target);
      for (const item of group) letGo(item.target);
    });
  // A section dragged on its own carries what sits over it when the drag starts.
  const carried = useRef(new Map<string, ReadonlyArray<BoardSelected>>());
  // Escape mid-gesture: everything held goes back where it was, nothing is sent, and everyone
  // else's view of the drag ends now rather than landing.
  const cancelGesture = () => {
    const keys = new Set(held.current.keys());
    held.current.clear();
    gestureFrom.current.clear();
    carried.current.clear();
    press.current = null;
    setEdits((current) => dropHeldBoardEdits(current, keys));
    setDropTarget(null);
    setLinking(null);
    marquee.cancel();
    if (pointing) cursor.drag([]);
  };
  const sectionGroup = (target: BoardTarget): ReadonlyArray<BoardSelected> | null => {
    const key = boardEditKey(target);
    const known = carried.current.get(key);
    if (known !== undefined) return known;
    const section =
      target.kind === "note" ? shown.notes.find((note) => note.id === target.id) : undefined;
    const element = drawnItem(key);
    if (section?.section !== true || element === null) return null;
    const items = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-pin])",
      ) ?? []),
    ].map((item) => ({ ref: item.dataset.boardItem ?? "", rect: drawnRect(item) }));
    const group = boardSelectionItems(shown, positions, [
      key,
      ...boardItemsCentredIn(items, drawnRect(element), key),
    ]);
    carried.current.set(key, group);
    return group;
  };
  const isSectionRef = (ref: string) =>
    shown.notes.some((note) => note.section === true && noteRef(note.id) === ref);
  const groupOf = (target: BoardTarget) => (inGroup(target) ? selectedItems : sectionGroup(target));
  const dragBy = (target: BoardTarget, from: BoardPoint, dx: number, dy: number) => {
    if (!canEdit) return;
    const group = groupOf(target);
    if (group !== null) {
      const now = group.map((item) => {
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
  // Arrow keys move the selection as a drag does, and it lands once they stop.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudged = useRef(new Map<string, BoardTarget>());
  const endNudge = useStableCallback(() => {
    nudgeTimer.current = null;
    const targets = [...nudged.current.values()];
    nudged.current.clear();
    release(() => {
      for (const target of targets) letGo(target);
    });
  });
  const nudge = (dx: number, dy: number) => {
    if (!canEdit || selectedItems.length === 0) return;
    const now = selectedItems.map((item) => {
      const last = held.current.get(boardEditKey(item.target));
      return last !== undefined && "x" in last ? { ...item, value: last } : item;
    });
    for (const item of boardGroupMove(now, dx, dy)) {
      nudged.current.set(boardEditKey(item.target), item.target);
      hold(item.target, item.value);
    }
    sendDrag();
    if (nudgeTimer.current !== null) clearTimeout(nudgeTimer.current);
    nudgeTimer.current = setTimeout(endNudge, NUDGE_SETTLE_MS);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a board closing mid-nudge sends where the keys left the cards
  useEffect(
    () => () => {
      if (nudgeTimer.current === null) return;
      clearTimeout(nudgeTimer.current);
      endNudge();
    },
    [endNudge],
  );
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
    const target = { kind: "note", id: note.id } as const;
    dragBy(target, note, dx, dy);
    if (onUseNote === undefined && !canGive) return;
    // Only a card a drop does something on lights up, with what that is; over any other it moves.
    const on = inGroup(target) ? null : dataAt(event.clientX, event.clientY, "boardDrop");
    const label = on === null ? undefined : handOf(note, on)?.label;
    setDropTarget((current) =>
      label === undefined || on === null
        ? null
        : current?.on === on && current.label === label
          ? current
          : { on, label },
    );
  };
  const takeOf = (note: RoomBoardNote) =>
    onTakeTask === undefined ||
    note.kind !== "task" ||
    note.done === true ||
    note.text.trim() === "" ||
    // Someone else's task stays theirs: the owner's is assigned with no guest.
    (note.assignee !== undefined && (note.assignee.guestId ?? null) !== viewer)
      ? undefined
      : () => onTakeTask(note);
  const messageOf = (note: RoomBoardNote) =>
    onUseNote === undefined ||
    note.kind === "artifact" ||
    note.kind === "code" ||
    note.kind === "pull-request" ||
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
    note.kind === "code" ||
    note.kind === "pull-request" ||
    note.kind === "thread" ||
    note.kind === "comment" ||
    boardNoteMessage(note).trim() === ""
      ? undefined
      : () => onGiveNote(note);
  // The owner's own agent works on the thread; a guest's has a card of its own.
  const handOf = (
    note: RoomBoardNote,
    onto: string,
  ): { readonly label: string; readonly run: () => void } | undefined => {
    const own = onto === OWN_AGENT_DROP || (onto === THREAD_DROP && viewer === null);
    const take = own ? takeOf(note) : undefined;
    if (take !== undefined) return { label: "Take it to my agent", run: take };
    const use = onto === THREAD_DROP ? messageOf(note) : undefined;
    if (use !== undefined) return { label: "Use as message", run: use };
    const give = onto === OWN_AGENT_DROP ? giveOf(note) : undefined;
    return give === undefined ? undefined : { label: "Give to my agent", run: give };
  };
  // Dropped on the thread or on this person's own agent, a card becomes a draft and goes back.
  const dropNote = (note: RoomBoardNote) => {
    const target = { kind: "note", id: note.id } as const;
    const hand =
      dropTarget === null || inGroup(target) ? undefined : handOf(note, dropTarget.on)?.run;
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
  // Everyone else reads the text as it is typed, with the pointer; the board stores it on blur.
  const writeNote = (note: RoomBoardNote, text: string) => {
    hold({ kind: "note", id: note.id }, { ...noteNow(note), text });
    sendDrag();
  };
  // Escape in a title: back to what is stored, sending nothing.
  const revertText = (target: BoardTarget) => {
    const key = boardEditKey(target);
    held.current.delete(key);
    gestureFrom.current.delete(key);
    setEdits((current) => dropHeldBoardEdits(current, new Set([key])));
    sendDrag();
  };
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
  // Why the toolbar cannot add a card for this person now, said on its disabled buttons.
  const cannotAdd =
    room === null
      ? "Share this thread to add to its board"
      : !canEdit
        ? "This link lets you look at the board, not change it"
        : full
          ? `The board holds ${ROOM_BOARD_MAX_NOTES} cards at most. Delete one to add another.`
          : null;
  const cannotAddThread =
    cannotAdd ??
    (threadsFull ? `The board holds ${ROOM_BOARD_MAX_THREADS} thread boxes at most` : null);
  const cannotAddArtifact =
    cannotAdd ??
    (artifactsFull ? `The board holds ${ROOM_BOARD_MAX_ARTIFACTS} artifacts at most` : null);
  const codeFull =
    shown.notes.filter((note) => note.kind === "code").length >= ROOM_BOARD_MAX_CODE_WINDOWS;
  const cannotAddCode =
    cannotAdd ??
    (codeFull ? `The board holds ${ROOM_BOARD_MAX_CODE_WINDOWS} code windows at most` : null);
  const pullRequestsFull =
    shown.notes.filter((note) => note.kind === "pull-request").length >=
    ROOM_BOARD_MAX_PULL_REQUESTS;
  const cannotAddPullRequest =
    cannotAdd ??
    (pullRequestsFull
      ? `The board holds ${ROOM_BOARD_MAX_PULL_REQUESTS} pull request windows at most`
      : null);
  const drawnRects = () => drawnRectsIn(surfaceRef.current);
  const takenRects = () =>
    boardTakenRects(
      // A new card may land over a section.
      [
        ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
          "[data-board-item]:not([data-board-section])",
        ) ?? []),
      ].map((element) => ({ ref: element.dataset.boardItem ?? "", rect: drawnRect(element) })),
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
    const surface = boardAreaOf(surfaceRef.current);
    if (surface === null) return;
    // What the bottom toolbar covers is out of view: a card shown is shown above it.
    const area = {
      width: surface.width,
      height: Math.max(surface.height / 2, surface.height - BOARD_TOOLBAR_BAND),
    };
    const next = added ? panToShowAdded(view, rect, area) : panToShow(view, rect, area);
    if (next === view) return;
    setFollowing(null);
    setView(next);
  };
  // The card this person last added or selected alone, which a new card joins in its section.
  const lastCard = useRef<string | null>(null);
  const lastPointer = useRef<BoardPoint | null>(null);
  // A new card lands where this person is working: in the section they are on, else nearest the
  // middle of the view, clear of everything there at drawn sizes.
  const freeSpot = (
    kind: RoomBoardNote["kind"],
    size: RoomBoardSize = boardNewNoteSize(kind),
    intoSection = true,
  ): BoardPoint => {
    const within = visibleBoardRect(
      view,
      boardAreaOf(surfaceRef.current) ?? { width: 600, height: 400 },
    );
    const sections = shown.notes.flatMap((note) => {
      if (note.section !== true) return [];
      const { w, h } = note.size ?? BOARD_SECTION_SIZE;
      return [{ ref: noteRef(note.id), rect: { x: note.x, y: note.y, width: w, height: h } }];
    });
    const last = lastCard.current === null ? null : drawnItem(lastCard.current);
    const lastRect = last === null ? null : drawnRect(last);
    if (!intoSection) {
      return boardAddSpot(
        size,
        [...takenRects(), ...sections.map(({ rect }) => rect)],
        within,
        null,
      );
    }
    const paper = kind === undefined || kind === "task";
    const section = boardAddSection(sections, within, {
      selected: selected.size === 1 ? ([...selected][0] ?? null) : null,
      // A note or task joins a section only when it is selected; else it lands mid-view.
      pointer: paper ? null : lastPointer.current,
      lastCard:
        paper || lastRect === null
          ? null
          : { x: lastRect.x + lastRect.width / 2, y: lastRect.y + lastRect.height / 2 },
    });
    if (paper && section === null) {
      const area = boardAreaOf(surfaceRef.current) ?? { width: 600, height: 400 };
      return boardCentreSpot(
        size,
        takenRects(),
        visibleBoardRect(view, {
          width: area.width,
          height: Math.max(area.height / 2, area.height - BOARD_TOOLBAR_BAND),
        }),
      );
    }
    return boardAddSpot(size, takenRects(), within, section);
  };
  const newNote = (
    fields: Partial<Pick<RoomBoardNote, "kind" | "url" | "text">>,
    at: BoardPoint,
  ) => {
    const id = randomUUID();
    const value = settleBoardValue({
      id,
      text: fields.text ?? "",
      ...at,
      ...(viewer === null ? {} : { guestId: viewer }),
      ...(fields.kind === undefined ? {} : { kind: fields.kind }),
      ...(fields.url === undefined ? {} : { url: fields.url }),
      ...(fields.kind !== undefined || noteColor === null ? {} : { color: noteColor }),
    });
    send({ kind: "note", id }, value);
    lastCard.current = noteRef(id);
    const size = boardNewNoteSize(fields.kind);
    reveal({ x: value.x, y: value.y, width: size.w, height: size.h }, true);
    return id;
  };
  const addCard = (fields: Pick<RoomBoardNote, "kind" | "url">, wanted?: BoardPoint) => {
    if (!canEdit || full) return null;
    return newNote(fields, wanted ?? freeSpot(fields.kind));
  };
  // Draws the card added at once and puts the caret in its text, so what is typed next goes there
  // and never to the button that added it.
  const typeIn = (id: string) => {
    const item = drawnItem(noteRef(id));
    // The text first: a task's checkbox comes before its text.
    (
      item?.querySelector<HTMLElement>("textarea:not([data-box-prompt])") ??
      item?.querySelector<HTMLElement>("input:not([type=checkbox])")
    )?.focus({ preventScroll: true });
  };
  const addAndType = (add: () => string | null) => {
    const id = flushSync(add);
    if (id !== null) typeIn(id);
  };
  // A card the right-click menu added, whose text takes the caret once the menu has closed.
  const typeInAfterMenu = useRef<string | null>(null);
  /** Adds a section in view, or round the rects given, as one change of this viewer's. */
  const addSection = (around?: ReadonlyArray<BoardRect>, wanted?: BoardPoint) => {
    if (!canEdit || full) return null;
    const framed = around === undefined ? null : boardSectionAround(around);
    const size = framed?.size ?? BOARD_SECTION_SIZE;
    const at = framed ?? wanted ?? freeSpot(undefined, size, false);
    const id = randomUUID();
    const value = settleBoardValue({
      id,
      text: "",
      x: at.x,
      y: at.y,
      size,
      section: true,
      ...(viewer === null ? {} : { guestId: viewer }),
    });
    send({ kind: "note", id }, value);
    lastCard.current = noteRef(id);
    reveal({ x: value.x, y: value.y, width: size.w, height: size.h }, true);
    return id;
  };
  const selectedNotes = selectedItems.flatMap(({ value }) => ("id" in value ? [value] : []));
  const canDuplicate =
    canEdit && cards === undefined && boardDuplicates(selectedNotes, viewer, () => "").length > 0;
  // The notes, tasks and links of a selection Duplicate copies, each as it is drawn now.
  const copiesOf = (notes: ReadonlyArray<RoomBoardNote>) =>
    boardDuplicates(notes, viewer, randomUUID).flatMap((copy) => {
      const element = drawnItem(noteRef(copy.from));
      return element === null ? [] : [{ ...copy, rect: drawnRect(element) }];
    });
  // Copies land together, clear of every card, near `around` (or just below the originals, a
  // little to the right), and become the selection.
  const landCopies = (
    made: ReadonlyArray<{ readonly note: RoomBoardNote; readonly rect: BoardRect }>,
    around?: BoardPoint,
  ) => {
    const copies = made.slice(0, Math.max(0, ROOM_BOARD_MAX_NOTES - shown.notes.length));
    const bounds = boardBounds(copies.map(({ rect }) => rect));
    if (!canEdit || bounds === null) return;
    const spot = placeBoardItem(
      { w: bounds.width, h: bounds.height },
      around ?? {
        x: bounds.x + bounds.width / 2 + DUPLICATE_OFFSET,
        y: bounds.y + bounds.height * 1.5 + DUPLICATE_OFFSET,
      },
      takenRects(),
    );
    for (const { note } of copies) {
      const value = settleBoardValue({
        ...note,
        x: note.x + spot.x - bounds.x,
        y: note.y + spot.y - bounds.y,
      });
      send({ kind: "note", id: note.id }, value);
    }
    setSelection(new Set(copies.map(({ note }) => noteRef(note.id))));
    reveal({ ...spot, width: bounds.width, height: bounds.height }, true);
  };
  // Copying a mixed selection says what it left out, as Delete does.
  const sayCopied = (copied: number) => {
    const skipped = boardCopySkipped(
      selectedNotes,
      selectedItems.filter(({ target }) => target.kind === "card").length,
    );
    if (skipped !== null) {
      toastManager.add({ type: "info", title: `Copied ${copied}`, description: skipped });
    }
  };
  const duplicateSelection = () => {
    if (!canDuplicate) return;
    const copies = copiesOf(selectedNotes);
    landCopies(copies);
    sayCopied(copies.length);
  };
  // Copied cards stay on this board only. What went on the system clipboard with them tells a
  // paste of them from a paste of something copied since, elsewhere.
  const copied = useRef<{
    readonly text: string;
    readonly copies: ReadonlyArray<{ readonly note: RoomBoardNote; readonly rect: BoardRect }>;
  } | null>(null);
  const viewCentre = () => {
    const within = visibleBoardRect(
      view,
      boardAreaOf(surfaceRef.current) ?? { width: 0, height: 0 },
    );
    return { x: within.x + within.width / 2, y: within.y + within.height / 2 };
  };
  /** Copies the selection's notes, tasks and links, saying what it left out; null if none. */
  const copyCards = () => {
    const copies = canDuplicate ? copiesOf(selectedNotes) : [];
    if (copies.length === 0) return null;
    const text = copies.map(({ note }) => boardNoteMessage(note)).join("\n\n");
    copied.current = { text, copies };
    sayCopied(copies.length);
    return text;
  };
  const copySelection = (event: ClipboardEvent<HTMLDivElement>) => {
    // Text someone selected on a card or in a field is theirs to copy.
    if (!isBoardKey(event.target) || !window.getSelection()?.isCollapsed) return;
    const text = copyCards();
    if (text === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
  };
  /** Puts what was copied on the board near `at`, saying whether it took it. */
  const pasteText = (text: string, at: BoardPoint): boolean => {
    if (!canEdit) return false;
    const own = copied.current;
    if (own !== null && own.text === text) {
      landCopies(
        own.copies.map(({ note, rect }) => ({ note: { ...note, id: randomUUID() }, rect })),
        at,
      );
      return true;
    }
    const url = boardUrlIn(text);
    // A pull request pasted on a room's board shows itself, live, instead of as a plain link.
    const pullRequest =
      url === null || cards !== undefined || pullRequestsFull ? null : roomPullRequestOf(url);
    if (pullRequest !== null) {
      addCard({ kind: "pull-request", url: pullRequest.url });
      return true;
    }
    if (url !== null) {
      addLink(url);
      return true;
    }
    if (text.trim() === "" || full) return false;
    noteAt(at, text.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH));
    return true;
  };
  const pasteOnBoard = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!isBoardKey(event.target)) return;
    const text = event.clipboardData.getData("text/plain");
    if (pasteText(text, lastPointer.current ?? viewCentre())) event.preventDefault();
  };
  /**
   * A plain note centred on `at`, in this viewer's last colour: exactly there when `exact`, as for
   * a double-click, else as near as it fits beside what is there.
   */
  const noteAt = (at: BoardPoint, text = "", exact = false) => {
    if (!canEdit || full) return null;
    const size = boardNewNoteSize(undefined);
    return newNote(
      { text },
      exact
        ? { x: Math.round(at.x - size.w / 2), y: Math.round(at.y - size.h / 2) }
        : placeBoardItem(size, at, takenRects()),
    );
  };
  // Plain notes in the selection, which its colour control recolours together.
  const colorable = selectedNotes.filter(
    (note) => note.kind === undefined && note.pinnedTo === undefined && note.section !== true,
  );
  const firstColor = colorable[0]?.color ?? "yellow";
  const sharedColor = colorable.every((note) => (note.color ?? "yellow") === firstColor)
    ? firstColor
    : undefined;
  const colorSelection = (color: RoomBoardNoteColor) => {
    setNoteColor(color);
    for (const note of colorable) changeNote(note, (current) => ({ ...current, color }));
  };
  const tidySelection = () => {
    if (!canEdit) return;
    const items = selectedItems.flatMap((item) => {
      const element = drawnItem(boardEditKey(item.target));
      return element === null
        ? []
        : [{ ...item, ref: boardEditKey(item.target), rect: drawnRect(element) }];
    });
    if (items.length < 2) return;
    const taken = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-section])",
      ) ?? []),
    ].flatMap((element) =>
      selected.has(element.dataset.boardItem ?? "") ? [] : [drawnRect(element)],
    );
    for (const { ref, x, y } of boardTidy(items, taken)) {
      const item = items.find((candidate) => candidate.ref === ref);
      if (item === undefined) continue;
      const now = "text" in item.value ? noteNow(item.value) : item.value;
      send(item.target, settleBoardValue({ ...now, x, y }));
    }
  };
  const groupInSection = () => {
    const rects = [...selected].flatMap((ref) => {
      const element = drawnItem(ref);
      return element === null ? [] : [drawnRect(element)];
    });
    if (rects.length > 0) addSection(rects);
  };
  /** Adds a card of `kind` beside an item, with a line between them in the direction given. */
  const addBeside = (
    ref: string,
    kind: "artifact" | "thread" | "code" | "pull-request",
    direction: "from" | "to",
    url?: string,
    text?: string,
  ) => {
    const element = drawnItem(ref);
    if (!canEdit || full || element === null) return null;
    const area = boardAreaOf(surfaceRef.current);
    const id = newNote(
      { kind, ...(url === undefined ? {} : { url }), ...(text === undefined ? {} : { text }) },
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
    return id;
  };
  // The page a box's agent last wrote, in a new artifact beside the box: the box is asked to write
  // it there, as its replies fill any artifact it has a line to.
  const pageToArtifact = async (boxId: string, title: string | null) => {
    if (onPromptBox === undefined) return;
    const name = title?.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH);
    const id = addBeside(boardBoxRef(boxId), "artifact", "from", undefined, name);
    if (id === null) return;
    // The artifact and its line wait in the note's queue; the prompt naming it goes after them.
    await queueChange(noteRef(id), () => Promise.resolve(true));
    await onPromptBox(boxId, { text: BOARD_PAGE_TO_ARTIFACT_TEXT, cards: [], artifactId: id });
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
    setView(fitBoardView(drawnRects(), area, FIT_MARGIN));
  };
  const attachAgentOf = (note: RoomBoardNote) => {
    if (note.kind !== "artifact" || cards !== undefined || room === null) return undefined;
    const existing = boardOwnBoxFor(shown, viewer, note.id);
    if (existing !== null) {
      return { label: "Show my thread", run: () => focusItem(boardBoxRef(existing)) };
    }
    if (!canEdit || full || threadsFull) return undefined;
    return {
      label: "Attach my agent",
      hint:
        viewer === null
          ? "Adds a thread box beside this artifact. What you prompt it runs on your agent, and its replies rewrite the artifact for everyone."
          : "Adds a thread box of yours beside this artifact. What you prompt it runs on your own agent, on your machine, or asks the owner's agent when yours is not connected. Its replies rewrite the artifact for everyone.",
      run: () => addBeside(noteRef(note.id), "thread", "to"),
    };
  };
  const codeWindowOf = (note: RoomBoardNote) => {
    const boxId = roomWindowBoxId(shown, note.id);
    const changes = note.changes;
    // The owner opens the thread of a box of their own, where the whole diff is.
    const openThread =
      viewer !== null || changes === undefined || changes.guestId !== undefined
        ? undefined
        : changes.boxId === ROOM_BOARD_ROOM_BOX
          ? onOpenThread
          : onOpenConversation === undefined
            ? undefined
            : () => onOpenConversation(changes.boxId);
    return (
      <RoomCodeWindow
        note={note}
        boxId={boxId}
        boxName={boxName}
        people={people}
        readPatch={readCodePatch}
        onOpenThread={openThread}
      />
    );
  };
  const addLink = (url: string, wanted?: BoardPoint) => addCard({ kind: "link", url }, wanted);
  // A URL pasted in an empty note makes that note a link card.
  const pasteLinkInto = (note: RoomBoardNote, url: string) => {
    send({ kind: "note", id: note.id }, null);
    addLink(url, { x: note.x, y: note.y });
  };
  const submitLinkDraft = () => {
    const url = linkDraft === null ? null : draftUrl(linkDraft);
    if (url === null) return;
    addAndType(() => {
      setLinkDraft(null);
      return draftKind === "pull-request" ? addCard({ kind: "pull-request", url }) : addLink(url);
    });
  };
  const pullRequestWindowOf = (note: RoomBoardNote) => (
    <RoomPullRequestWindow
      note={note}
      onRefresh={
        onRefreshPullRequest === undefined ? undefined : () => onRefreshPullRequest(note.id)
      }
    />
  );
  // After a toolbar action that types nothing, the board's own keys work again at once.
  const thenBoard = (action: () => void) => {
    action();
    surfaceRef.current?.focus({ preventScroll: true });
  };

  const startLink = (from: string, event: PointerEvent<HTMLElement>) => {
    const box = boxes.get(from);
    const at = pointerOnBoard(event);
    if (box === undefined || at === null || !canEdit) return;
    event.stopPropagation();
    holdPointer(event);
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
    if (
      from === undefined ||
      to === null ||
      to === from ||
      isSectionRef(to) ||
      edges.length >= ROOM_BOARD_MAX_EDGES
    ) {
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
    const under = dataAt(event.clientX, event.clientY, "boardItem");
    const on = under === null || isSectionRef(under) ? null : under;
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
  // What Select all takes: what a marquee over the whole board would.
  const selectableRefs = () =>
    [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-pin]):not([data-board-section])",
      ) ?? []),
    ].flatMap((element) => element.dataset.boardItem ?? []);
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
  // A card's "…" menu, which its right-click menu starts with too.
  const noteMenu = (note: RoomBoardNote): CardMenu => {
    const section = note.section === true;
    const plain = note.kind === undefined && note.pinnedTo === undefined;
    const use = section ? undefined : messageOf(note);
    const give = section ? undefined : giveOf(note);
    const canDelete = canEdit && isRoomCardOwnedBy(note, viewer);
    return {
      onReact: section || reactTo === undefined ? undefined : (emoji) => reactTo(note, emoji),
      color:
        plain && pickColor !== undefined
          ? {
              value: note.color,
              onPick: section
                ? (color) => changeNote(note, (current) => ({ ...current, color }))
                : (color) => pickColor(note, color),
            }
          : undefined,
      actions: [
        ...(use === undefined ? [] : [{ label: "Use as message", run: use }]),
        ...(give === undefined ? [] : [{ label: "Give to my agent", run: give }]),
        ...(canDelete
          ? [
              {
                label: section ? "Delete section" : plain ? "Delete note" : "Delete card",
                run: () => send({ kind: "note", id: note.id }, null),
                destructive: true,
              },
            ]
          : []),
      ],
    };
  };
  const menuNoteOf = (ref: string | null) =>
    ref === null
      ? undefined
      : shown.notes.find((note) => note.kind !== "comment" && noteRef(note.id) === ref);
  // The room thread's card, and a person's or an agent's: not notes, with menus of their own.
  const isFixedCard = (ref: string | null) =>
    ref !== null && menuNoteOf(ref) === undefined && ref.startsWith(cardRef(""));
  /** Opens the right-click menu at a point on screen, for the card there, which it selects. */
  const openMenu = (x: number, y: number, ref: string | null) => {
    const note = menuNoteOf(ref)?.id;
    const on = note !== undefined ? noteRef(note) : isFixedCard(ref) ? ref : null;
    if (on !== null && !selected.has(on)) {
      setSelection(new Set([on]));
      lastCard.current = on;
    }
    setSelectedEdge(null);
    setContextMenu({
      x,
      y,
      at: pointerOnBoard({ clientX: x, clientY: y }) ?? viewCentre(),
      ref: on,
      canPaste: false,
    });
    void clipboardReadable().then((canPaste) => {
      if (!canPaste) return;
      setContextMenu((open) => (open?.x === x && open.y === y ? { ...open, canPaste } : open));
    });
  };
  const contextMenuParts = () => {
    if (contextMenu === null) return null;
    const { at, ref } = contextMenu;
    const note = menuNoteOf(ref);
    const several = ref !== null && selected.size > 1 && selected.has(ref);
    const fixed = !several && isFixedCard(ref);
    const entries = boardMenuEntries(
      several
        ? { kind: "selection", notes: selectedNotes, count: selected.size }
        : note !== undefined
          ? { kind: "card", note }
          : fixed
            ? { kind: "fixed-card" }
            : { kind: "canvas" },
      {
        viewer,
        canEdit,
        roomBoard: cards === undefined,
        canAdd: cannotAdd === null,
        canAddThread: cannotAddThread === null,
        canAddArtifact: cannotAddArtifact === null,
        canPaste: contextMenu.canPaste,
      },
    );
    const near = (kind: RoomBoardNote["kind"]) =>
      placeBoardItem(boardNewNoteSize(kind), at, takenRects());
    const addThenType = (add: () => string | null) => () => {
      typeInAfterMenu.current = add();
    };
    const runs: Record<BoardMenuEntry, { readonly label: string; readonly run: () => void }> = {
      "add-note": { label: "Add note", run: addThenType(() => noteAt(at, "", true)) },
      "add-task": {
        label: "Add task",
        run: addThenType(() => addCard({ kind: "task" }, near("task"))),
      },
      "add-section": {
        label: "Add section",
        run: addThenType(() => addSection(undefined, { x: Math.round(at.x), y: Math.round(at.y) })),
      },
      "add-thread": {
        label: "Add thread box",
        run: addThenType(() => addCard({ kind: "thread" }, near("thread"))),
      },
      "add-artifact": {
        label: "Add artifact",
        run: addThenType(() => addCard({ kind: "artifact" }, near("artifact"))),
      },
      paste: {
        label: "Paste",
        run: () =>
          void readTextFromClipboard().then(
            (text) => pasteText(text, at),
            () => undefined,
          ),
      },
      "select-all": { label: "Select all", run: () => setSelection(new Set(selectableRefs())) },
      fit: { label: "Fit to view", run: fitAll },
      duplicate: { label: "Duplicate", run: duplicateSelection },
      copy: {
        label: "Copy",
        run: () => {
          const text = copyCards();
          if (text !== null) void writeTextToClipboard(text).catch(() => undefined);
        },
      },
      "copy-link": {
        label: "Copy link",
        run: () => {
          if (note?.url !== undefined)
            void writeTextToClipboard(note.url, "link").catch(() => undefined);
        },
      },
      tidy: { label: "Tidy", run: tidySelection },
      group: { label: "Group in a section", run: groupInSection },
      delete: { label: "Delete", run: deleteSelection },
    };
    const pick = (...wanted: ReadonlyArray<BoardMenuEntry>) =>
      entries.filter((entry) => wanted.includes(entry)).map((entry) => runs[entry]);
    const box =
      several || ref === null
        ? undefined
        : threadBoxes.find((candidate) => boardBoxRef(candidate.id) === ref);
    const boxEntries = box === undefined ? [] : boxMenuActions(box);
    const guest = fixed ? guestCards.find((one) => cardRef(guestCardId(one)) === ref) : undefined;
    const own = note === undefined || several ? undefined : noteMenu(note);
    const card: CardMenu | undefined =
      own !== undefined
        ? { ...own, actions: [...boxEntries, ...own.actions] }
        : fixed
          ? {
              actions: [
                ...boxEntries,
                ...(ref === cardRef(ROOM_BOARD_THREAD_CARD)
                  ? [{ label: "Open thread", run: onOpenThread }]
                  : []),
                ...(guest !== undefined && online.includes(guest.id) && guest.id !== viewer
                  ? [{ label: `Follow ${guest.name}`, run: () => follow.onFollow(guest.id) }]
                  : []),
              ],
            }
          : undefined;
    return {
      card:
        card === undefined
          ? undefined
          : { ...card, actions: card.actions.filter((action) => action.destructive !== true) },
      groups: [
        pick("add-note", "add-task", "add-section", "add-thread", "add-artifact"),
        pick("paste", "duplicate", "copy", "copy-link"),
        pick("tidy", "group", "select-all", "fit"),
        [
          ...(card?.actions.filter((action) => action.destructive === true) ?? []),
          ...pick("delete").map((entry) => ({ ...entry, destructive: true })),
        ],
      ],
    };
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

  /** What a thread box offers below its conversation, as its buttons and its right-click menu. */
  const boxActions = (box: BoardThreadBox) => {
    const context = contexts.get(box.id);
    // A box rewrites one artifact; a second would draw a line that does nothing.
    const canAddArtifact = canEdit && !full && !artifactsFull && context?.artifact === null;
    // Offered once per box; a box's changes show in each window it has a line to.
    const canAddCode =
      canEdit && !full && !codeFull && roomBoxCodeWindows(shown, box.id).length === 0;
    // The pull request the box's thread is linked to, once, beside the box.
    const linkedPullRequest =
      cards !== undefined || !canEdit || full || pullRequestsFull
        ? null
        : roomPullRequestOf(
            boxPullRequestUrl?.(box.id) ??
              (box.id === ROOM_BOARD_ROOM_BOX ? ownerCode?.pullRequest?.url : undefined) ??
              "",
          );
    const boxPullRequest =
      linkedPullRequest !== null &&
      !shown.notes.some(
        (note) => note.kind === "pull-request" && note.url === linkedPullRequest.url,
      )
        ? linkedPullRequest
        : null;
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
    return {
      from: boardBoxRef(box.id),
      artifact: canAddArtifact,
      code: canAddCode,
      pullRequest: boxPullRequest?.url ?? null,
      // The room thread's card opens its thread instead.
      conversation: box.id === ROOM_BOARD_ROOM_BOX ? undefined : conversation,
    };
  };
  /** A thread box's actions as entries of its right-click menu. */
  const boxMenuActions = (box: BoardThreadBox): ReadonlyArray<CardAction> => {
    const { from, artifact, code, pullRequest, conversation } = boxActions(box);
    return [
      ...(artifact
        ? [{ label: "New artifact", run: () => addBeside(from, "artifact", "from") }]
        : []),
      ...(code ? [{ label: "New code window", run: () => addBeside(from, "code", "from") }] : []),
      ...(pullRequest === null
        ? []
        : [
            {
              label: "Show pull request",
              run: () => addBeside(from, "pull-request", "from", pullRequest),
            },
          ]),
      ...(conversation === undefined ? [] : [{ label: "Open conversation", run: conversation }]),
    ];
  };
  /** What a thread box shows below its title, and its prompt box for the person it belongs to. */
  const boxParts = (box: BoardThreadBox, tail: ReactNode, fallback?: ReactNode) => {
    const context = contexts.get(box.id);
    const own = canPromptBoardBox(box, viewer);
    const actions = boxActions(box);
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
          onPin={canEdit && onChange !== undefined ? pinPromptCard : undefined}
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
        {actions.artifact ||
        actions.code ||
        actions.pullRequest !== null ||
        actions.conversation !== undefined ? (
          <div className="flex flex-wrap gap-1">
            {actions.artifact ? (
              <Button
                size="micro"
                variant="outline"
                onPointerDown={stopPointer}
                onClick={() => addBeside(actions.from, "artifact", "from")}
              >
                <AppWindowIcon />
                New artifact
              </Button>
            ) : null}
            {actions.code ? (
              <WhatItDoes hint={BOARD_CODE_WINDOW_HINT}>
                <Button
                  size="micro"
                  variant="outline"
                  onPointerDown={stopPointer}
                  onClick={() => addBeside(actions.from, "code", "from")}
                >
                  <FileCode2Icon />
                  New code window
                </Button>
              </WhatItDoes>
            ) : null}
            {actions.pullRequest === null ? null : (
              <Button
                size="micro"
                variant="outline"
                onPointerDown={stopPointer}
                onClick={() => {
                  if (actions.pullRequest !== null) {
                    addBeside(actions.from, "pull-request", "from", actions.pullRequest);
                  }
                }}
              >
                <PullRequestGlyph.pullRequest />
                Show pull request
              </Button>
            )}
            {actions.conversation === undefined ? null : (
              <Button
                size="micro"
                variant="outline"
                onPointerDown={stopPointer}
                onClick={actions.conversation}
              >
                <MessagesSquareIcon />
                Open conversation
              </Button>
            )}
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

  // Something is being dragged, resized or nudged: each such step renders the board again.
  // oxlint-disable-next-line react-hooks/refs -- held edits are what the drag has reached, and every step sets them in state too
  const moving = boardDragItems(held.current, gestureFrom.current).some(
    (item) => item.x !== undefined || item.w !== undefined,
  );
  const edgeArea = drawingArea([...boxes.values()]);
  // Marker ids land in `url(#…)`, which takes no colons.
  // The person colour of whoever owns the card a line starts from: the agent that rewrites.
  const lineColor = (ref: string) =>
    boardCursorColor(guests, shown.notes.find((note) => noteRef(note.id) === ref)?.guestId);
  const markerId = `board-arrow${useId().replace(/[^\w-]/g, "")}`;
  // oxlint-disable-next-line react-hooks/refs -- builds the open menu's entries; none runs until it is picked
  const menuParts = contextMenuParts();

  return (
    <div className="@container/board flex min-h-0 min-w-0 flex-1 flex-col overflow-clip overscroll-none">
      {/* The board fills this; its chrome floats over the canvas. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <header
          className={cn(
            "pointer-events-none absolute inset-x-3 top-3 z-30 flex flex-wrap items-start gap-2",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <BoardFloat className="pointer-events-auto max-w-full min-w-0 gap-0.5 p-1 pe-3">
            <Button size="sm" variant="ghost" onClick={onBack ?? onOpenThread}>
              <ArrowLeftIcon />
              <ToolLabel>{backLabel}</ToolLabel>
            </Button>
            <span aria-hidden className="me-1.5 h-4 w-px shrink-0 bg-board-hairline" />
            <h1 className="min-w-0 truncate text-sm font-semibold">
              {titleEditor ?? title}
              {sharing === undefined ? (
                <span className="ms-2 font-normal text-muted-foreground">
                  {room === null ? "Not shared" : (summary ?? roomSummary(room, online.length))}
                </span>
              ) : null}
            </h1>
          </BoardFloat>
          <div className="pointer-events-auto ms-auto flex flex-wrap items-center justify-end gap-2">
            {notice === null ? null : (
              <BoardFloat className="px-3 py-1.5">
                <span role="status" className="text-xs text-muted-foreground">
                  {notice}
                </span>
              </BoardFloat>
            )}
            {following === null ? null : (
              <BoardFloat className="gap-2 py-1 ps-3 pe-1 text-xs">
                Following {personName(following.person)}
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => thenBoard(() => setFollowing(null))}
                >
                  Stop following
                </Button>
              </BoardFloat>
            )}
            {sharing === undefined ? null : (
              <BoardFloat className="min-w-0 gap-1.5 p-1 ps-2">{sharing}</BoardFloat>
            )}
          </div>
        </header>
        <div className="pointer-events-none absolute inset-x-3 bottom-3 z-30 flex justify-center">
          <BoardFloat className="pointer-events-auto max-w-full gap-0.5 overflow-x-auto rounded-xl p-1">
            {linkDraft === null ? (
              <>
                <WhyNot reason={cannotAdd}>
                  <BoardTool
                    label="Note"
                    hint="Sticky note"
                    disabled={cannotAdd !== null}
                    onClick={() => addAndType(() => addCard({}))}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "size-4 rounded-sm ring-1 ring-foreground/15",
                        paintSwatchClassName(noteColor ?? undefined),
                      )}
                    />
                  </BoardTool>
                </WhyNot>
                <WhyNot reason={cannotAdd}>
                  <BoardTool
                    label="Task"
                    disabled={cannotAdd !== null}
                    onClick={() => addAndType(() => addCard({ kind: "task" }))}
                  >
                    <ListTodoIcon />
                  </BoardTool>
                </WhyNot>
                {cards === undefined ? (
                  <WhyNot reason={cannotAdd}>
                    <BoardTool
                      label="Section"
                      disabled={cannotAdd !== null}
                      onClick={() => addAndType(() => addSection())}
                    >
                      <SquareDashedIcon />
                    </BoardTool>
                  </WhyNot>
                ) : null}
                <WhyNot reason={cannotAdd}>
                  <BoardTool
                    label="Link"
                    disabled={cannotAdd !== null}
                    onClick={() => {
                      setDraftKind("link");
                      setLinkDraft("");
                    }}
                  >
                    <LinkIcon />
                  </BoardTool>
                </WhyNot>
                {cards !== undefined ? null : <BoardToolDivider />}
                {cards !== undefined ? null : onAddThread === undefined ? (
                  <WhyNot reason={cannotAddThread}>
                    <BoardTool
                      label="Thread"
                      hint="Thread box: an agent the room can prompt"
                      disabled={cannotAddThread !== null}
                      onClick={() => addAndType(() => addCard({ kind: "thread" }))}
                    >
                      <BotIcon />
                    </BoardTool>
                  </WhyNot>
                ) : (
                  <Menu>
                    <WhyNot reason={cannotAddThread}>
                      <MenuTrigger
                        disabled={cannotAddThread !== null}
                        render={<Button size="sm" variant="ghost" aria-label="Thread" />}
                      >
                        <BotIcon />
                        <ChevronDownIcon className="-ms-1.5 size-3 opacity-60" />
                      </MenuTrigger>
                    </WhyNot>
                    {/* The new box's name field keeps the caret it took. */}
                    <MenuPopup align="start" finalFocus={() => isBoardKey(document.activeElement)}>
                      <MenuItem onClick={() => addAndType(() => addCard({ kind: "thread" }))}>
                        New thread box
                      </MenuItem>
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
                {cards === undefined ? (
                  <WhyNot reason={cannotAddArtifact}>
                    <BoardTool
                      label="Artifact"
                      disabled={cannotAddArtifact !== null}
                      onClick={() => addAndType(() => addCard({ kind: "artifact" }))}
                    >
                      <AppWindowIcon />
                    </BoardTool>
                  </WhyNot>
                ) : null}
                {cards === undefined ? (
                  <WhyNot reason={cannotAddCode}>
                    <BoardTool
                      label="Code"
                      hint="A code window shows the changes of the thread box you draw a line from it. Everyone in the room sees its files and diffs."
                      disabled={cannotAddCode !== null}
                      onClick={() => addAndType(() => addCard({ kind: "code" }))}
                    >
                      <CodeXmlIcon />
                    </BoardTool>
                  </WhyNot>
                ) : null}
                {cards === undefined ? (
                  <WhyNot reason={cannotAddPullRequest}>
                    <BoardTool
                      label="Pull request"
                      hint="Shows a GitHub pull request to the room, kept up to date by the board owner's GitHub sign-in."
                      disabled={cannotAddPullRequest !== null}
                      onClick={() => {
                        setDraftKind("pull-request");
                        setLinkDraft("");
                      }}
                    >
                      <PullRequestGlyph.pullRequest />
                    </BoardTool>
                  </WhyNot>
                ) : null}
                {cards !== undefined ? null : <BoardToolDivider />}
                {cards === undefined ? (
                  <WhyNot reason={cannotAdd}>
                    <BoardTool
                      label="Comment"
                      variant={placingComment ? "default" : "ghost"}
                      aria-pressed={placingComment}
                      disabled={cannotAdd !== null}
                      onClick={() => thenBoard(startComment)}
                    >
                      <MessageCirclePlusIcon />
                    </BoardTool>
                  </WhyNot>
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
                        onClick={() => thenBoard(() => setShowResolved((shown) => !shown))}
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
                className="flex items-center gap-1.5 ps-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitLinkDraft();
                }}
              >
                <Input
                  size="sm"
                  aria-label={draftKind === "pull-request" ? "Pull request address" : "Link"}
                  placeholder={
                    draftKind === "pull-request"
                      ? "Paste a GitHub pull request link"
                      : "Paste or type a link"
                  }
                  autoFocus
                  value={linkDraft}
                  aria-invalid={linkDraft.trim() !== "" && draftUrl(linkDraft) === null}
                  onChange={(event) => setLinkDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") thenBoard(() => setLinkDraft(null));
                  }}
                />
                <Button size="sm" type="submit" disabled={draftUrl(linkDraft) === null}>
                  Add
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => thenBoard(() => setLinkDraft(null))}
                >
                  Cancel
                </Button>
              </form>
            )}
            <BoardToolDivider />
            <BoardHistoryButtons
              canUndo={canEdit && history.undo.length > 0}
              canRedo={canEdit && history.redo.length > 0}
              onUndo={() => thenBoard(() => travel("undo"))}
              onRedo={() => thenBoard(() => travel("redo"))}
            />
          </BoardFloat>
        </div>
        <BoardFloat className="absolute bottom-16 left-3 z-30 gap-0.5 p-1 @4xl/board:bottom-3">
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom out"
            onClick={() => thenBoard(() => zoomBy(1 / 1.2))}
          >
            <MinusIcon />
          </Button>
          <span className="w-10 text-center text-xs text-muted-foreground tabular-nums">
            {Math.round(view.zoom * 100)}%
          </span>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Zoom in"
            onClick={() => thenBoard(() => zoomBy(1.2))}
          >
            <PlusIcon />
          </Button>
          <BoardToolDivider />
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="Fit"
                  onClick={() => thenBoard(fitAll)}
                />
              }
            >
              <ScanIcon />
            </TooltipTrigger>
            <TooltipPopup side="top">Fit everything in view</TooltipPopup>
          </Tooltip>
          {cards === undefined && room !== null ? <LineLegend /> : null}
        </BoardFloat>
        <div
          ref={surfaceRef}
          role="application"
          aria-label="Room board"
          // Focusable so a link pasted on the board lands as a card. Clipped, not hidden, so
          // focusing a card at the edge cannot scroll the board out from under the pointer.
          tabIndex={0}
          className={cn(
            "group/board relative min-h-0 flex-1 cursor-grab touch-none overflow-clip bg-board-canvas outline-none active:cursor-grabbing",
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
            press.current = null;
            if (event.button !== 0 || !isInside(event) || boardPressKind(target) !== "gesture") {
              return;
            }
            // Keys act on the board during and after a gesture: Escape, Delete, the arrows.
            event.currentTarget.focus({ preventScroll: true });
            if (
              !canEdit ||
              !(target instanceof Element) ||
              target.closest("[data-board-overlay], [data-board-grip], [data-board-pin]") !== null
            ) {
              return;
            }
            const ref = target.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem ?? null;
            // Shift and a press on a card selects it, or takes it out of the selection.
            if (event.shiftKey) {
              if (ref === null) return;
              event.stopPropagation();
              return toggleSelected(ref);
            }
            press.current = { on: ref, x: event.clientX, y: event.clientY, moved: false };
          }}
          onMouseDownCapture={(event) => {
            // A press that moves, pans, selects or draws would also select the page's text, or start
            // a native drag of it, and take focus off the board. A right press would put the caret in
            // a note's text, and its menu would then be the browser's.
            if (
              (event.button === 0 || event.button === 2) &&
              isInside(event) &&
              boardPressKind(event.target) === "gesture"
            ) {
              event.preventDefault();
            }
          }}
          onPointerMoveCapture={(event) => {
            const held = press.current;
            if (held === null || held.moved) return;
            if (Math.hypot(event.clientX - held.x, event.clientY - held.y) < CLICK_SLOP) return;
            held.moved = true;
            // A card dragged from outside the selection goes alone, and becomes the selection.
            if (held.on !== null && !selected.has(held.on)) setSelection(new Set([held.on]));
            if (held.on !== null) lastCard.current = held.on;
          }}
          onPointerUpCapture={(event) => {
            delete event.currentTarget.dataset.boardBusy;
            const held = press.current;
            press.current = null;
            if (held === null || held.moved) return;
            if (Math.hypot(event.clientX - held.x, event.clientY - held.y) >= CLICK_SLOP) return;
            setSelection(held.on === null ? NO_SELECTION : new Set([held.on]));
            if (held.on !== null) lastCard.current = held.on;
          }}
          onPointerCancelCapture={(event) => {
            delete event.currentTarget.dataset.boardBusy;
            press.current = null;
          }}
          onPointerDown={(event) => {
            if (!isInside(event)) return;
            setSelectedEdge(null);
            if (boardPressKind(event.target) !== "gesture") return;
            if (event.shiftKey && canEdit && event.button === 0) return marquee.start(event);
            pan.onPointerDown(event);
          }}
          // Escape leaves a note's text with the note selected; the note gives the board focus.
          onKeyDownCapture={(event) => {
            const ref =
              event.key === "Escape" && event.target instanceof Element
                ? event.target
                    .closest("[data-board-rest]")
                    ?.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem
                : undefined;
            if (ref === undefined) return;
            setSelection(new Set([ref]));
            lastCard.current = ref;
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              if (dropHeldPointer()) cancelGesture();
              else if (placingComment) setPlacingComment(false);
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
              if (key === "d" && !event.shiftKey && selected.size > 0) {
                event.preventDefault();
                duplicateSelection();
                return;
              }
              if (key === "a" && !event.shiftKey && canEdit) {
                event.preventDefault();
                setSelection(new Set(selectableRefs()));
                return;
              }
            }
            if (
              (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) &&
              boardPressKind(event.target) !== "text"
            ) {
              event.preventDefault();
              const focused =
                event.target instanceof Element
                  ? (event.target.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem ??
                    null)
                  : null;
              const ref = focused ?? [...selected][0] ?? null;
              const drawn = (
                (ref === null ? null : drawnItem(ref)) ?? event.currentTarget
              ).getBoundingClientRect();
              openMenu(
                ref === null ? drawn.left + drawn.width / 2 : drawn.left + 12,
                ref === null ? drawn.top + drawn.height / 2 : drawn.top + 12,
                ref,
              );
              return;
            }
            // Typing on a note selected alone types into it, as a click on it would.
            const only = selected.size === 1 ? [...selected][0] : undefined;
            if (
              only !== undefined &&
              event.target === event.currentTarget &&
              boardKeyEditsNote(event)
            ) {
              const field = drawnItem(only)?.querySelector<HTMLTextAreaElement>(
                "textarea[data-board-rest]:not([readonly])",
              );
              if (field !== null && field !== undefined) {
                if (event.key === "Enter") event.preventDefault();
                const end = field.value.length;
                field.focus({ preventScroll: true });
                field.setSelectionRange(end, end);
                return;
              }
            }
            const direction = NUDGES[event.key];
            if (
              direction !== undefined &&
              event.target === event.currentTarget &&
              selected.size > 0
            ) {
              event.preventDefault();
              const step = event.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
              nudge(direction[0] * step, direction[1] * step);
              return;
            }
            // Delete acts only on the board itself, so a focused card's own controls keep theirs.
            // The selection's own Delete, focused by a click that asked to confirm, takes it too.
            if (
              (event.key === "Delete" || event.key === "Backspace") &&
              (event.target === event.currentTarget ||
                (event.target instanceof Element &&
                  event.target.closest("[data-selection-delete]") !== null)) &&
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
            lastPointer.current = pointerOnBoard(event);
            trackCursor(event);
          }}
          onDoubleClick={(event) => {
            const target = event.target;
            if (
              !isInside(event) ||
              boardPressKind(target) !== "gesture" ||
              (target instanceof Element &&
                target.closest("[data-board-item], [data-board-overlay], [data-board-grip]") !==
                  null)
            ) {
              return;
            }
            const at = pointerOnBoard(event);
            if (at !== null) addAndType(() => noteAt(at, "", true));
          }}
          onContextMenu={(event) => {
            const target = event.target;
            // Text, links, comment threads and pins keep the browser's own menu.
            if (
              !isInside(event) ||
              !(target instanceof Element) ||
              boardPressKind(target) === "text" ||
              target.closest("a[href], [data-board-overlay], [data-board-pin]") !== null
            ) {
              return;
            }
            event.preventDefault();
            openMenu(
              event.clientX,
              event.clientY,
              target.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem ?? null,
            );
          }}
          onCopy={copySelection}
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
              {shown.notes.map((note) => {
                if (note.section !== true) return null;
                const target = { kind: "note", id: note.id } as const;
                const own = canEdit && isRoomCardOwnedBy(note, viewer);
                return (
                  <BoardSection
                    key={note.id}
                    note={note}
                    canRename={own}
                    canDelete={own}
                    onMove={(dx, dy) => dragBy(target, note, dx, dy)}
                    onDrop={() => dropItem(target)}
                    handles={
                      <ItemHandles
                        from={noteRef(note.id)}
                        on="note"
                        link={undefined}
                        onResize={
                          canEdit
                            ? (corner, from, dx, dy) => resizeNote(note, corner, from, dx, dy)
                            : undefined
                        }
                        onEnd={() => release(() => letGo(target))}
                      />
                    }
                    onText={(text) => writeNote(note, text)}
                    onBlur={() => release(() => letGo(target))}
                    onRevert={() => revertText(target)}
                    onDelete={() => send(target, null)}
                    onPickColor={
                      canEdit && cards === undefined
                        ? (color) => changeNote(note, (current) => ({ ...current, color }))
                        : undefined
                    }
                  />
                );
              })}
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
                  {BOARD_PERSON_COLORS.map((color, index) => (
                    <marker
                      key={color}
                      id={`${markerId}-person-${index}`}
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
                        stroke="var(--color-muted-foreground)"
                        strokeOpacity={0.45}
                        strokeWidth="1.5"
                        strokeDasharray="4 5"
                      />
                    );
                  })}
                  {edges.map((edge) => {
                    const from = boxes.get(edge.from);
                    const to = boxes.get(edge.to);
                    if (from === undefined || to === undefined) return null;
                    const selected = selectedEdge === edge.id;
                    const state: EdgeStroke = selected ? "selected" : edgeRole(edge.id);
                    return (
                      <BoardEdgeLine
                        key={edge.id}
                        id={edge.id}
                        fromRef={edge.from}
                        toRef={edge.to}
                        from={from}
                        to={to}
                        color={
                          state === "artifact" ? lineColor(edge.from) : EDGE_STROKE_COLORS[state]
                        }
                        width={EDGE_STROKE_WIDTHS[state]}
                        dashed={state === "sent"}
                        marker={
                          state === "artifact"
                            ? `url(#${markerId}-person-${BOARD_PERSON_COLORS.indexOf(lineColor(edge.from))})`
                            : `url(#${markerId}-${state})`
                        }
                        selectable={canEdit}
                        onSelect={() => setSelectedEdge(selected ? null : edge.id)}
                      />
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
                  dropLabel={dropTarget?.on === THREAD_DROP ? dropTarget.label : undefined}
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
                    color={boardCursorColor(guests, guest.id)}
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
                    color={boardCursorColor(guests, guest.id)}
                    kind={
                      now !== undefined
                        ? "working"
                        : `${turns.length} turn${turns.length === 1 ? "" : "s"}`
                    }
                    id={id}
                    size={sizes[id]}
                    dropTarget={own ? OWN_AGENT_DROP : undefined}
                    dropLabel={
                      own && dropTarget?.on === OWN_AGENT_DROP ? dropTarget.label : undefined
                    }
                    link={link}
                    resize={resize}
                    onMove={dragBy}
                    onDrop={dropItem}
                  >
                    <p className="text-2xs text-muted-foreground">Runs on their machine</p>
                    {now !== undefined ? (
                      <p
                        role="status"
                        className="text-xs font-medium text-primary first-letter:uppercase"
                      >
                        {boardAgentName(people, guest.id)} is working
                      </p>
                    ) : latest !== undefined ? (
                      <>
                        {latest.prompt ? (
                          <p className="line-clamp-2 border-s-2 border-foreground/15 ps-2 text-xs text-muted-foreground [overflow-wrap:anywhere]">
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
                if (note.kind === "comment" || note.section === true) return null;
                const threadBox = { id: note.id, guestId: note.guestId, title: note.text.trim() };
                // Like "New artifact", and only for whoever can prompt the box.
                const canPage =
                  onPromptBox !== undefined &&
                  canEdit &&
                  !full &&
                  !artifactsFull &&
                  canPromptBoardBox(threadBox, viewer) &&
                  contexts.get(note.id)?.artifact === null;
                const box =
                  note.kind === "thread" && cards === undefined
                    ? boxParts(
                        threadBox,
                        <BoxTurns
                          boxId={note.id}
                          turns={note.thread?.turns ?? []}
                          people={people}
                          onPageToArtifact={
                            canPage ? (title) => void pageToArtifact(note.id, title) : undefined
                          }
                        />,
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
                    onRevert={revertText}
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
                    compact={view.zoom < COMPACT_CARD_ZOOM}
                    menuOf={noteMenu}
                    box={
                      box === undefined
                        ? undefined
                        : {
                            label: boardBoxAgentLabel(note, people, note.thread?.turns.at(-1)),
                            body: box.body,
                            footer: box.prompt,
                          }
                    }
                    codeWindow={
                      note.kind === "code"
                        ? codeWindowOf(note)
                        : note.kind === "pull-request"
                          ? pullRequestWindowOf(note)
                          : null
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
                        if (event.key === "Delete" || event.key === "Backspace")
                          removeEdge(edge.id);
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
              refs={selected}
              hidden={moving}
              count={selected.size}
              removable={canEdit ? removal.noteIds.length : 0}
              onDelete={deleteSelection}
              onClear={() => setSelection(NO_SELECTION)}
            >
              {canEdit && cards === undefined && colorable.length > 0 ? (
                <NoteColorPicker color={sharedColor} onPick={colorSelection} />
              ) : null}
              {canEdit && selected.size > 1 ? (
                <Button size="micro" variant="ghost-muted" onClick={tidySelection}>
                  <LayoutGridIcon />
                  Tidy
                </Button>
              ) : null}
              {canDuplicate ? (
                <Button size="micro" variant="ghost-muted" onClick={duplicateSelection}>
                  <CopyIcon />
                  Duplicate
                </Button>
              ) : null}
              {canEdit && cards === undefined && !full ? (
                <Button size="micro" variant="ghost-muted" onClick={groupInSection}>
                  <FrameIcon />
                  Group in a section
                </Button>
              ) : null}
            </SelectionBar>
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
          {room === null ? (
            <p className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-4">
              <span className="rounded-board border border-board-hairline bg-card px-3 py-1.5 text-center text-xs text-muted-foreground shadow-board">
                Share this thread with guests and each person who joins gets a card here.
              </span>
            </p>
          ) : canEdit && shown.notes.length === 0 && (cards?.length ?? 0) === 0 ? (
            // Above the toolbar, never on the room thread's own card, which a new board shows.
            <div className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-4">
              <div className="flex max-w-xs flex-col items-center gap-1 text-center">
                <p className="text-sm font-semibold text-foreground">An empty board</p>
                <p className="text-xs text-muted-foreground">
                  Double-click anywhere for a sticky note, or pick a tool below.
                </p>
              </div>
            </div>
          ) : null}
        </div>
        {contextMenu === null || menuParts === null ? null : (
          // A right-click on the open menu, or the Menu key in it, opens no browser menu over it.
          <div className="contents" onContextMenu={(event) => event.preventDefault()}>
            <BoardContextMenu
              key={`${contextMenu.x},${contextMenu.y}`}
              at={contextMenu}
              card={menuParts.card}
              groups={menuParts.groups}
              onClose={() => {
                setContextMenu(null);
                const added = typeInAfterMenu.current;
                typeInAfterMenu.current = null;
                if (added !== null) return typeIn(added);
                const surface = surfaceRef.current;
                if (surface !== null && !surface.contains(document.activeElement)) {
                  surface.focus({ preventScroll: true });
                }
              }}
            />
          </div>
        )}
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
  backgroundImage: "radial-gradient(var(--color-board-dot) 1px, transparent 1px)",
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
  const swatch = "h-0 w-5 shrink-0 border-t-2";
  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              render={
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label="What the lines mean"
                  onPointerDown={stopPointer}
                />
              }
            />
          }
        >
          <CircleHelpIcon />
        </TooltipTrigger>
        <TooltipPopup side="top">What the lines mean</TooltipPopup>
      </Tooltip>
      <PopoverPopup side="top" align="start" width="md" padding="compact">
        <div className="flex flex-col gap-1.5 text-2xs text-muted-foreground">
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn(swatch, "border-primary")} />
            Into a thread, or into the artifact it rewrites: goes with the next prompt
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn(swatch, "border-t-3 border-primary")} />
            Pinned: goes with every prompt
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn(swatch, "border-dashed border-muted-foreground")} />
            Already sent: goes again once the card changes
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn(swatch, "border-person-2")} />
            From a thread to an artifact, in its owner's colour: its replies rewrite it. To a code
            window: it shows the thread's changes
          </span>
          <span className="flex items-center gap-2">
            <span aria-hidden className={cn(swatch, "border-muted-foreground/70")} />
            Any other line: only shows a link
          </span>
        </div>
      </PopoverPopup>
    </Popover>
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
            data-board-grip
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
  onRevert,
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
  codeWindow,
  compact,
  menuOf,
}: {
  /** Drawn too small for its header's buttons, which fold into one menu. */
  readonly compact: boolean;
  /** Its header's buttons as one menu, which its right-click menu starts with too. */
  readonly menuOf: (note: RoomBoardNote) => CardMenu;
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
  readonly onRevert: (target: BoardTarget) => void;
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
  readonly onAttachAgent:
    | { readonly label: string; readonly hint?: string; readonly run: () => void }
    | undefined;
  /** Colours a plain note. Absent where notes are not coloured. */
  readonly onPickColor: ((note: RoomBoardNote, color: RoomBoardNoteColor) => void) | undefined;
  /** Toggles the viewer's own reaction. Absent where they cannot react. */
  readonly onReact: ((note: RoomBoardNote, emoji: RoomBoardReactionEmoji) => void) | undefined;
  /** A thread box's agent, conversation and prompt box. */
  readonly box:
    | { readonly label: string; readonly body: ReactNode; readonly footer: ReactNode }
    | undefined;
  /** A code window's files and diffs, or a pull request window's pull request. */
  readonly codeWindow: ReactNode;
}) {
  const target = { kind: "note", id: note.id } as const;
  const author = boardPersonName(people, note.guestId);
  const plain = note.kind === undefined && note.pinnedTo === undefined;
  const artifact = note.kind === "artifact";
  const thread = note.kind === "thread";
  const code = note.kind === "code";
  const pullRequest = note.kind === "pull-request";
  // A pull request window names its pull request, links to it and shows its own title.
  const parsed = note.url === undefined || pullRequest ? null : parseBoardLink(note.url);
  const titled = artifact || thread || code || pullRequest;
  const mine = isRoomCardOwnedBy(note, people.viewer);
  const canChange = canEdit && (!thread || mine);
  const canDelete = canEdit && mine;
  const size = boardNoteSize(note);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const selected = useBoardSelected(noteRef(note.id));
  const liveDrag = useBoardLiveDrag(noteRef(note.id));
  const live = boardLiveRect({ x: note.x, y: note.y, w: size?.w, h: size?.h }, liveDrag);
  // Once this person types here, their own draft shows until they leave it, whoever else types.
  const [drafting, setDrafting] = useState(false);
  const text = (drafting ? null : boardLiveText(note.text, liveDrag)) ?? note.text;
  // Notes and tasks are paper in a paint; titled cards are windows; a link is a plain card.
  const paper = note.kind === undefined || note.kind === "task";
  // Paper's text moves the note like the rest of it; a click on the note selected alone types.
  const alone = useBoardSelectedAlone(noteRef(note.id));
  // Whether it was selected alone is kept from the press: the board selects on release before
  // this card hears it, so `alone` then would make the click that selected it type too.
  const drag = dragHandlers(
    (dx, dy, event) => onMove(note, dx, dy, event),
    () => onDrop(note),
    (event, on) => {
      if (
        paper &&
        event.currentTarget.hasAttribute("data-pressed-alone") &&
        on instanceof HTMLTextAreaElement
      ) {
        focusTextAt(on, event.clientX, event.clientY);
      }
    },
  );
  return (
    <div
      className={cn(
        "group/item absolute flex flex-col",
        size === undefined && live?.w === undefined && "w-48",
        selected &&
          cn(
            "ring-2 ring-primary ring-offset-2 ring-offset-board-canvas",
            BOARD_SELECTED_CHROME_CLASS,
          ),
        paper
          ? cn(
              "rounded-xs text-paint-ink shadow-paint",
              noteColorClassName(note.kind === "task" ? (note.color ?? "green") : note.color),
            )
          : titled
            ? BOARD_WINDOW_CLASS
            : "rounded-board border border-board-hairline bg-card text-card-foreground shadow-paint",
      )}
      style={{
        left: note.x,
        top: note.y,
        width: live?.w ?? size?.w,
        height: live?.h ?? size?.h,
        ...boardLiveStyle(note, live),
      }}
      data-board-item={noteRef(note.id)}
      {...drag}
      onPointerDown={(event) => {
        event.currentTarget.toggleAttribute("data-pressed-alone", alone);
        drag.onPointerDown(event);
      }}
    >
      <div
        className={cn(
          "flex cursor-grab items-center gap-1 active:cursor-grabbing",
          titled ? BOARD_TITLE_BAR_CLASS : "h-6 ps-3 pe-3",
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
          <AppWindowIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : thread ? (
          <PersonDot color={boardCursorColor(people.guests, note.guestId)} className="size-2" />
        ) : code ? (
          <CodeXmlIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        ) : pullRequest ? (
          <PullRequestStateIcon note={note} />
        ) : note.pinnedTo !== undefined ? (
          <MessageSquareTextIcon aria-hidden className="size-3 shrink-0 opacity-60" />
        ) : null}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            box !== undefined || titled ? "font-semibold" : "text-2xs opacity-60",
          )}
        >
          {box !== undefined
            ? box.label
            : thread
              ? `Thread from ${author}`
              : artifact
                ? `Artifact from ${author}`
                : code
                  ? `Code window from ${author}`
                  : pullRequest
                    ? `Pull request from ${author}`
                    : note.pinnedTo === undefined
                      ? paper
                        ? null
                        : author
                      : `${author} on a reply`}
        </span>
        <div className={cn("flex items-center gap-1", !selected && BOARD_HOVER_CHROME_CLASS)}>
          {compact ? <CardActionsMenu {...menuOf(note)} /> : null}
          {compact || onUse === undefined ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Use as message"
                    className={BOARD_ICON_BUTTON_CLASS}
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
          {compact || onGive === undefined ? null : (
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    type="button"
                    aria-label="Give to my agent"
                    className={BOARD_ICON_BUTTON_CLASS}
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
          {compact || onReact === undefined ? null : (
            <AddReaction onReact={(emoji) => onReact(note, emoji)} />
          )}
          {!compact && plain && onPickColor !== undefined ? (
            <NoteColorPicker color={note.color} onPick={(color) => onPickColor(note, color)} />
          ) : null}
          {!compact && canDelete ? (
            <button
              type="button"
              aria-label={plain ? "Delete note" : "Delete card"}
              className={BOARD_ICON_BUTTON_CLASS}
              onPointerDown={stopPointer}
              onClick={() => onDelete(target, null)}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
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
                "border-s-2 border-current/30 ps-2 text-2xs italic opacity-70 [overflow-wrap:anywhere]",
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
        {pullRequest && note.text === "" ? null : (
          <textarea
            aria-label={
              note.kind === "task"
                ? "Task"
                : note.kind === "link"
                  ? "Caption"
                  : artifact
                    ? "Artifact title"
                    : code
                      ? "Code window title"
                      : pullRequest
                        ? "Pull request window title"
                        : thread
                          ? "Thread name"
                          : "Note"
            }
            value={text}
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
                    : code
                      ? "Name this code window"
                      : pullRequest
                        ? "Add a title"
                        : thread
                          ? canChange
                            ? "Name this thread"
                            : "Untitled thread"
                          : "Write a note, or paste a link"
            }
            className={cn(
              "resize-none bg-transparent px-3 pb-3 text-sm leading-snug outline-none placeholder:text-placeholder",
              paper && "pt-1 pb-1 placeholder:text-paint-ink-muted",
              note.kind === "task" && note.done === true && "text-paint-ink-muted line-through",
              titled
                ? "shrink-0 pt-2.5 pb-2 font-semibold"
                : size !== undefined && "min-h-0 flex-1",
              !canChange && "cursor-default",
              paper && "cursor-default focus:cursor-text",
            )}
            data-board-rest={paper ? "" : undefined}
            onPointerDown={paper ? undefined : stopPointer}
            onChange={(event) => {
              setDrafting(true);
              onText(note, event.target.value);
            }}
            onKeyDown={(event) => {
              // A title goes back to what is stored on Escape; a note's text is kept, and saved.
              if (event.key === "Escape") {
                event.stopPropagation();
                if (titled) onRevert(target);
                leaveText(event.currentTarget);
              }
              if (titled && event.key === "Enter") {
                event.preventDefault();
                leaveText(event.currentTarget);
              }
            }}
            onBlur={() => {
              setDrafting(false);
              onBlur(target);
            }}
            onPaste={(event) => {
              if (!plain || note.text !== "" || onPasteLink === undefined) return;
              const url = boardUrlIn(event.clipboardData.getData("text/plain"));
              if (url === null) return;
              event.preventDefault();
              onPasteLink(note, url);
            }}
          />
        )}
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
        {paper && note.pinnedTo === undefined ? (
          <p className="shrink-0 truncate px-3 pt-1 pb-2.5 text-2xs text-paint-ink-muted">
            {author}
          </p>
        ) : null}
        {artifact && onAttachAgent !== undefined ? (
          <div className="flex shrink-0 px-3 pb-1.5">
            <WhatItDoes hint={onAttachAgent.hint}>
              <Button
                size="micro"
                variant="outline"
                onPointerDown={stopPointer}
                onClick={onAttachAgent.run}
              >
                <BotIcon />
                {onAttachAgent.label}
              </Button>
            </WhatItDoes>
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
            people={people}
          />
        ) : null}
        {code || pullRequest ? codeWindow : null}
        {box === undefined ? null : (
          <>
            <div
              data-board-scroll
              className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 pb-2"
            >
              {box.body}
            </div>
            {box.footer === undefined ? null : (
              <div className="shrink-0 border-t border-board-hairline px-3 pt-2 pb-3">
                {box.footer}
              </div>
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
      <p role="status" className="px-3 pb-2 text-2xs text-paint-ink-muted first-letter:uppercase">
        {boardAgentName(people, worker.guestId)} is working on this
      </p>
    );
  }
  if (note.answer === undefined) return null;
  return (
    <div className="flex flex-col gap-0.5 px-3 pb-2">
      <p className="text-2xs font-medium text-paint-ink-muted">
        Answered by {boardAgentName(people, note.answer.guestId)}
      </p>
      <p className="line-clamp-4 border-s-2 border-current/25 ps-2 text-xs [overflow-wrap:anywhere]">
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

/** A card's state chip: working in the accent, waiting on someone in the warning tone. */
const boardCardKindTone = (kind: string): BoardChipTone =>
  kind === "working" || kind === "agent working"
    ? "primary"
    : kind === "needs approval"
      ? "warning"
      : "neutral";

function BoardCard({
  at,
  title,
  kind,
  dashed = false,
  id,
  size,
  dropTarget,
  dropLabel,
  action,
  link,
  resize,
  onMove,
  onDrop,
  footer,
  color,
  children,
}: {
  readonly at: BoardPoint;
  readonly title: string;
  readonly kind: string;
  /** Whose card it is, as a dot in their person colour on its title bar. */
  readonly color?: string | undefined;
  readonly dashed?: boolean;
  readonly id: string;
  /** Absent until someone resizes it: it is as tall as what it shows. */
  readonly size: RoomBoardSize | undefined;
  /** What a note dropped here does, as `dataAt` reads it from the page. */
  readonly dropTarget?: string | undefined;
  /** What letting go of the note held over this card does, while one is. */
  readonly dropLabel?: string | undefined;
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
        "group/item absolute flex flex-col",
        BOARD_WINDOW_CLASS,
        dashed && "border-dashed border-foreground/20",
        (dropLabel !== undefined || selected) && "ring-2 ring-primary",
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
      {...dragHandlers(
        (dx, dy) => onMove(target, at, dx, dy),
        () => onDrop(target),
      )}
    >
      {dropLabel === undefined ? null : (
        <span className="pointer-events-none absolute -top-8 left-0 rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground shadow-board">
          {dropLabel}
        </span>
      )}
      <header className={cn("cursor-grab active:cursor-grabbing", BOARD_TITLE_BAR_CLASS)}>
        {color === undefined ? null : <PersonDot color={color} className="size-2" />}
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        {action}
        <BoardChip tone={boardCardKindTone(kind)}>{kind}</BoardChip>
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
        <div className="shrink-0 border-t border-board-hairline px-3 pt-2 pb-3">{footer}</div>
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
              className="line-clamp-3 rounded-md border border-dashed border-foreground/15 px-2 py-1 text-xs [overflow-wrap:anywhere]"
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
        <MousePointer2Icon
          aria-hidden
          strokeWidth={1.5}
          className="size-4.5 shrink-0 fill-current stroke-white drop-shadow-sm"
        />
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-pressed={following === person}
                aria-label={following === person ? `Stop following ${name}` : `Follow ${name}`}
                className="pointer-events-auto -ms-0.5 mt-3.5 max-w-36 cursor-pointer truncate rounded-md px-1.5 py-0.5 text-xs leading-4 font-medium text-white shadow-paint focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
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
