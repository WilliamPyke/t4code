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
  type RoomBoardAgentTurn,
  type RoomBoardAssignee,
  type RoomBoardChange,
  type RoomBoardMark,
  type RoomBoardMention,
  type RoomBoardNote,
  type RoomBoardNoteColor,
  type RoomBoardReaction,
  type RoomBoardEdge,
  type RoomBoardReactionEmoji,
  type RoomBoardSize,
  type RoomBoardViewport,
  type RoomTaskStatus,
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
  EllipsisIcon,
  ExternalLinkIcon,
  FrameIcon,
  GitBranchIcon,
  LayoutGridIcon,
  LinkIcon,
  ListOrderedIcon,
  ListTodoIcon,
  MapIcon,
  MessageCirclePlusIcon,
  MessageSquareShareIcon,
  MessageSquareTextIcon,
  MessagesSquareIcon,
  MinusIcon,
  MousePointer2Icon,
  PlayIcon,
  PlusIcon,
  ScanIcon,
  SplineIcon,
  SquareDashedIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type ClipboardEvent,
  type ComponentProps,
  type DragEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
  createContext,
  use,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";

import {
  canRestoreRoomArtifact,
  canUndoRoomAgentTurn,
  isRoomCardOwnedBy,
  roomArtifactSource,
  roomBoardAfterAgentTurn,
  roomBoardNoteOfRef,
  roomBoxCodeWindows,
  roomBoxIdOfRef,
  roomBoxExcerpt,
  roomMarkWhere,
  roomMentionsIn,
  roomTaskStatus,
  roomWindowBoxId,
  type RoomBoardScope,
} from "@t3tools/shared/roomBoard";

import {
  readTextFromClipboard,
  useCopyToClipboard,
  writeTextToClipboard,
} from "~/hooks/useCopyToClipboard";
import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "~/hooks/useStableCallback";

import { cn, isMacPlatform, randomUUID } from "~/lib/utils";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  BOARD_CARD_WIDTH,
  BOARD_PIN_SIZE,
  type BoardArea,
  type BoardBox,
  type BoardHistoryEntry,
  type BoardHistoryItem,
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
  boardBoxColumn,
  boardDuplicates,
  boardCentreSpot,
  boardKeyEditsNote,
  type BoardMenuEntry,
  boardMenuEntries,
  boardPushedBelow,
  boardRoomBeside,
  boardTidy,
  boardTidySection,
  boardDragItems,
  boardTakenRects,
  boardAddSection,
  boardAddSpot,
  boardCopySkipped,
  boardCodeEdgeIds,
  boardAgents,
  boardArtifactAuthor,
  boardArtifactVersionNote,
  boardArtifactViewSource,
  boardArtifactWriting,
  boardBoxAgentLabel,
  boardBoxName,
  boardAgentTurnLine,
  boardBoxRef,
  boardBoxRequests,
  boardGuestWaiting,
  boardCardBox,
  boardChangeOf,
  boardChangeOutgrowsOlderHosts,
  boardChangeQueue,
  boardChangeQueueKey,
  boardCommentAgentAuthor,
  boardCommentLineTo,
  boardConnector,
  type BoardSide,
  boardLineScale,
  boardMaxSide,
  boardPointedSpot,
  boardCursorAt,
  clientRectToBoard,
  clientToBoard,
  BOARD_PERSON_COLORS,
  boardCursorColor,
  boardEditKey,
  boardGroupMove,
  boardAgentTurnToUndo,
  boardAgentTurnsSeen,
  boardEntryWithAttached,
  boardHistoryChanges,
  boardHistoryQueues,
  boardHistoryRemember,
  boardHistoryWith,
  boardStepBefore,
  boardItemsInRect,
  boardItemsCentredIn,
  boardSectionAround,
  boardSectionCardsToDelete,
  boardSectionFrameAt,
  boardSectionHolding,
  BOARD_SECTION_SIZE,
  type BoardSelected,
  boardNoteBox,
  boardNoteMessage,
  boardNewNoteSize,
  boardNextNoteSpot,
  boardNoteQuote,
  boardNoteAgentStatuses,
  boardConnectedNotes,
  boardDoneNoteIds,
  boardNotesSummary,
  boardResendChanges,
  boardNoteSize,
  boardOwnBoxFor,
  boardPeopleOf,
  boardPersonKey,
  boardPersonName,
  boardPinScale,
  boardPromptCard,
  boardPromptContext,
  boardThreadBoxTitle,
  boardSelectionItems,
  boardSelectionRemoval,
  boardCommentsOn,
  boardDeletion,
  boardDuplicateOffset,
  boardLineSlots,
  boardNoteRestorable,
  boardThreadBoxes,
  BOARD_COMMENT_ASK_TEXT,
  BOARD_PAGE_TO_ARTIFACT_TEXT,
  boardCommentAskBoxes,
  boardCommentPromptCard,
  boardEmbedOf,
  boardUrlIn,
  boardValueOf,
  boardViewportOf,
  canPromptBoardBox,
  clampBoardSize,
  type RoomBoardCloud,
  roomBoardHolds,
  cursorSender,
  dropBoardEdit,
  dropHeldBoardEdits,
  fitBoardOnSurface,
  boardTouchScale,
  boardGripScale,
  type BoardResizeEdges,
  boardTypingRect,
  openingBoardView,
  followBoardView,
  panBoardBy,
  panToCentre,
  panToShow,
  panToShowAdded,
  placeBoardCards,
  placeBoardItem,
  putBoardEdit,
  resizeBoardRect,
  resolveBoard,
  settleBoardEdits,
  roomCodeStatus,
  roomFetchCommand,
  settleBoardValue,
  visibleBoardRect,
  wheelZoomFactor,
  zoomBoardAt,
} from "./roomBoard.logic";
import {
  forgetRoomBoardFitOnOpen,
  rememberRoomBoardView,
  rememberedRoomBoardView,
  roomBoardFitAwaits,
} from "./roomBoardNavigation";
import { type ArtifactLinks, type ArtifactMarking, RoomArtifactLive } from "./RoomBoardArtifact";
import { type BoardMarkPin, type BoardPageLink, boardMarks } from "./boardMark.logic";
import { useBoardDrawnHeights } from "./roomBoardHeights";
import { BoardGuide } from "./BoardGuide";
import { boardGuideStepOfChange } from "./boardGuide.logic";
import { type BoardLineShape, boardLine } from "./boardLineRoute.logic";
import { markBoardGuideStep, showBoardGuide } from "./boardGuideState";
import { BoardEmbedIcon, RoomEmbedBody, useBoardSurfaceSize } from "./RoomBoardEmbed";
import {
  BOARD_EMBED_MIN_ZOOM,
  boardCanFramePage,
  boardEmbedTitleOf,
  boardEmbedTitleUrl,
  boardLiveEmbeds,
} from "./boardEmbed.logic";
import { boardOwnHosts } from "./boardFrameCheck";
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
import { BoardMinimap, useBoardMinimap } from "./BoardMinimap";
import { WhatItDoes, WhyNot } from "./RoomBoardWhy";
import { BoardHistoryButtons } from "./RoomBoardHistory";
import { AddReaction, ReactionChips } from "./RoomBoardReactions";
import { CatchUpMark, CatchUpPill, useBoardCatchUp } from "./BoardCatchUp";
import { VoteButton, boardVoteShortcut } from "./BoardVote";
import {
  AgentWorkMark,
  type BoardAsking,
  BoardAskPopover,
  BoardBoxPicker,
  boardAskShortcut,
  isBoardAskKey,
  lastBoardAskTarget,
  newBoardAsking,
  rememberBoardAskTarget,
  useBoardAgentWork,
} from "./BoardAsk";
import {
  BOARD_ASK_NEW_BOX,
  boardAskCards,
  boardAskDefaultTarget,
  boardAskLines,
  boardAskSuggestions,
  boardAskTargets,
  boardDraftBox,
} from "./boardAsk.logic";
import { type BoardRunning, BoardRunPopover, TaskRunChip, newBoardRunning } from "./BoardRun";
import { NoteAgentChip } from "./BoardNoteAgent";
import {
  BOARD_RUN_MAX_BOXES,
  type BoardRunMode,
  boardRunPrompt,
  boardRunTargets,
  boardRunTasks,
  canRunBoardTask,
} from "./boardRun.logic";
import {
  BOARD_VOTE,
  boardByVotes,
  boardVotable,
  boardVoteCount,
  boardVotedBy,
  boardVoteToggles,
  isBoardVoteKey,
} from "./boardVotes.logic";
import {
  BoardSelectionContext,
  SelectionBar,
  boardKeyFocus,
  isBoardKey,
  useBoardMarquee,
  useBoardSelected,
  useBoardSelectedAlone,
} from "./RoomBoardSelection";
import { BoardPromptBox } from "./RoomBoardPrompt";
import { useBoardBringIn } from "./BoardBringIn";
import { boardLinkTextWithSnapshot } from "./boardSnapshot.logic";
import { boardCopyOf, boardPastedCopies, rememberBoardCopy } from "./boardClipboard";
import { useBoardPower } from "./BoardPower";
import { boardKeyLabel } from "./boardShortcuts";
import { BoardPlan, BoardViewSwitch, useBoardViewMode } from "./BoardPlan";
import {
  type BoardPlanSpot,
  type BoardViewMode,
  boardPlanAppendOrder,
  boardPlanAttachments,
  boardPlanColumns,
  boardPlanMove,
  boardPlanMoveAll,
  boardPlanTaskPlace,
  boardPlanToday,
  boardPlanUntick,
  boardPlanWithStatus,
} from "./boardPlan.logic";
import {
  type BoardLineObstacle,
  BoardEdgeLine,
  boardStroke,
  lastBoardLineShape,
  rememberBoardLineShape,
  useBoardLineFocus,
} from "./RoomBoardEdge";
import { TaskAssigneeDot, TaskDueChip, TaskPriorityMark } from "./BoardTaskMarks";
import { MentionChips, useMentionPicker } from "./BoardMentions";
import { type BoardFocus, useBoardFocusRequest } from "./boardFocus";
import { boardStartRect } from "./boardFirstView";
import { holdCaretIn } from "./boardTypeIn";
import { firstBoardView } from "./boardFirstView.logic";
import {
  CLICK_SLOP,
  boardPressKind,
  dragHandlers,
  dropHeldPointer,
  focusTextAt,
  holdPointer,
  isInside,
  isTouchResting,
  leaveText,
  pressSlop,
} from "./roomBoardPointer";
import { useBoardPinch } from "./roomBoardPinch";
import { BoardSection } from "./RoomBoardSection";
import {
  BOARD_SNAP_SCREEN_PX,
  type BoardSnapTargets,
  boardRectsBounds,
  boardSnapMove,
  boardSnapResize,
  boardSnapTargets,
  NO_SNAP_DRAWN,
} from "./boardSnap.logic";
import { BoardSnapGuides, createBoardSnapStore } from "./RoomBoardSnapGuides";
import {
  AddedBy,
  BOARD_HOVER_CHROME_CLASS,
  BOARD_ICON_BUTTON_CLASS,
  BOARD_SELECTED_CHROME_CLASS,
  BOARD_TITLE_BAR_CLASS,
  BOARD_WINDOW_CLASS,
  BoardChip,
  type BoardChipTone,
  BoardFloat,
  boardChromeAt,
  BoardScrollTail,
  PersonDot,
} from "./BoardChrome";
import {
  BoxBoardWork,
  BoxProgress,
  BoxRequests,
  BoxStateEdge,
  BoxTurns,
} from "./RoomBoardThreadBox";
import {
  type BoardAgentEntry,
  type BoardAgentRecent,
  BoardAgents,
  BoardAgentsMoreButton,
  BoardAgentsNeedsBadge,
} from "./BoardAgents";
import {
  type BoardAgentEnd,
  boardAgentActivity,
  boardAgentModel,
  boardAgentRecentTurns,
  boardAgentRunTasks,
  boardAltShortcutAllowed,
  isBoardAgentsKey,
} from "./boardAgents.logic";
import {
  type BoardOwnRect,
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

/** Ctrl or Cmd with Z undoes; with Shift, or Ctrl+Y, redoes. */
const boardHistoryKey = (event: {
  readonly key: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}) => {
  if (!(event.ctrlKey || event.metaKey) || event.altKey) return null;
  const key = event.key.toLowerCase();
  if ((key === "z" && event.shiftKey) || (key === "y" && !event.metaKey)) return "redo";
  return key === "z" ? "undo" : null;
};

const OWN_KEYS_OUTSIDE =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="combobox"], [role="grid"], [role="tree"], [role="application"], [role="textbox"]';

/** A focused element outside the board whose keys the board may take: not a field or a widget. */
const isBoardKeyOutside = (target: Element) =>
  isBoardKey(target) && target.closest(OWN_KEYS_OUTSIDE) === null;
/** Whether the board's Alt+G and Alt+A act from where this key went. */
const altShortcutHere = (target: EventTarget | null) =>
  boardAltShortcutAllowed(boardKeyFocus(target), isMacPlatform(navigator.platform));
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
  plain: 2.5,
  context: 2.5,
  sent: 2.5,
  pinned: 3.5,
  artifact: 2.5,
  selected: 3.5,
};
const EDGE_STROKES = Object.entries(EDGE_STROKE_COLORS);

// Which artifact each box's next reply goes into, by box id, for this tab: a reload keeps it.
const REPLY_CARDS_KEY = "tinkjam:board-reply-cards:v1";
const readReplyCards = (): Readonly<Record<string, string>> => {
  try {
    const held: unknown = JSON.parse(sessionStorage.getItem(REPLY_CARDS_KEY) ?? "{}");
    if (typeof held !== "object" || held === null) return {};
    return Object.fromEntries(
      Object.entries(held).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    );
  } catch {
    return {};
  }
};
const keepReplyCards = (cards: Readonly<Record<string, string>>) => {
  try {
    sessionStorage.setItem(REPLY_CARDS_KEY, JSON.stringify(cards));
  } catch {}
  return cards;
};

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * Renders what `build` makes, or nothing for null. `build` runs as this renders, not as the board
 * does: the menu it builds holds the board's handlers, which the board's render must not call.
 */
function Built<Parts>({
  build,
  children,
}: {
  readonly build: () => Parts | null;
  readonly children: (parts: Parts) => ReactNode;
}) {
  const parts = build();
  return parts === null ? null : children(parts);
}

/** Focuses an element as it mounts without the browser scrolling the board to it. */
const focusInPlace = (element: HTMLElement | null) => {
  element?.focus({ preventScroll: true });
};

/** Runs `run` with `flag` up, and puts it down after, even when `run` throws. */
function withFlag(flag: { current: boolean }, run: () => void) {
  flag.current = true;
  try {
    run();
  } finally {
    flag.current = false;
  }
}

/** A tool on the board's rail: an icon, named on hover and to screen readers. */
function BoardTool({
  label,
  hint,
  children,
  ...props
}: ComponentProps<typeof Button> & { readonly label: string; readonly hint?: string }) {
  return (
    <Tooltip>
      {/* A tool's name shows soon after the pointer rests on it: the tools are icons only. */}
      <TooltipTrigger
        delay={200}
        render={<Button size="icon" variant="ghost" aria-label={label} {...props} />}
      >
        {children}
      </TooltipTrigger>
      <TooltipPopup side="right">{hint ?? label}</TooltipPopup>
    </Tooltip>
  );
}

type ArmedCardTool = "note" | "task" | "section";

/**
 * What a picked tool waits for, above the toolbar and the zoom corner. A keyboard stops it with
 * Esc; a finger has none, so it gets a Cancel.
 */
function BoardToolHint({
  onCancel,
  children,
  ...props
}: ComponentProps<"p"> & { readonly onCancel: () => void }) {
  const touch = touchFirst();
  return (
    <p
      {...props}
      className="pointer-events-none absolute inset-x-0 bottom-28 z-30 flex justify-center px-4 @xl/board:bottom-5"
    >
      <span className="flex items-center gap-1 rounded-full border border-board-hairline bg-card py-1 ps-3.5 pe-1 text-center text-xs text-muted-foreground shadow-board">
        <span className="py-0.5 pe-2">
          {children}
          {touch ? null : " Esc to stop."}
        </span>
        {touch ? (
          <span className="pointer-events-auto flex">
            <Button size="xs" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
          </span>
        ) : null}
      </span>
    </p>
  );
}

// Across the rail, or upright in the narrow board's bottom bar. A phone's bar has no room for
// them: without, its last tool stays inside it.
const BoardToolDivider = () => (
  <span
    aria-hidden
    className="my-1 h-px w-5.5 shrink-0 bg-board-hairline @max-xl/board:mx-1 @max-xl/board:my-0 @max-xl/board:h-5 @max-xl/board:w-px @max-md/board:hidden"
  />
);

/** A toolbar button's words, read out but not shown while the board is too narrow for them. */
const ToolLabel = ({ children }: { readonly children: ReactNode }) => (
  <span className="sr-only @5xl/board:not-sr-only">{children}</span>
);

// One text, read the same everywhere; the rail shows only the number.
const ResolvedCount = ({ count }: { readonly count: number }) => (
  <span className="tabular-nums">
    <span className="sr-only">Resolved (</span>
    {count}
    <span className="sr-only">)</span>
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
  // Anything that scrolls on the wheel's axis keeps the wheel, even at its end, so scrolling a
  // reply to its newest line never carries on into panning the board.
  const { scrollHeight, scrollWidth, clientHeight, clientWidth } = scroller;
  return Math.abs(event.deltaY) >= Math.abs(event.deltaX)
    ? scrollHeight > clientHeight + 1
    : scrollWidth > clientWidth + 1;
}

// How far a card's resize grips reach, in screen pixels at any zoom: a side's band 2px out and 5px
// in, a corner's square 12px reaching 4px out. So a press just beside the card is the board's, and
// its buttons, text and title bar stay their own. A finger gets more on a selected card.
const GRIP_REACH = cn(
  "[--o:calc(2px*var(--board-grip-scale,1))] [--i:calc(5px*var(--board-grip-scale,1))]",
  "[--co:calc(4px*var(--board-grip-scale,1))] [--c:calc(12px*var(--board-grip-scale,1))]",
  "pointer-coarse:group-data-[board-selected]/item:[--o:calc(10px*var(--board-grip-scale,1))]",
  "pointer-coarse:group-data-[board-selected]/item:[--i:calc(8px*var(--board-grip-scale,1))]",
  "pointer-coarse:group-data-[board-selected]/item:[--co:calc(12px*var(--board-grip-scale,1))]",
  "pointer-coarse:group-data-[board-selected]/item:[--c:calc(28px*var(--board-grip-scale,1))]",
);
// A section's frame moves it, so only the outer 5px of its 16px edge band resizes it (`--i` is
// negative: the band ends outside the frame), and its corners cover the band's corners.
const FRAME_GRIP_REACH = cn(
  "[--o:calc(8px*var(--board-line-scale,1))] [--i:calc(-3px*var(--board-line-scale,1))]",
  "[--co:calc(8px*var(--board-line-scale,1))] [--c:calc(12px*var(--board-line-scale,1))]",
  "pointer-coarse:group-data-[board-selected]/item:[--o:calc(14px*var(--board-line-scale,1))]",
  "pointer-coarse:group-data-[board-selected]/item:[--co:calc(14px*var(--board-line-scale,1))]",
  "pointer-coarse:group-data-[board-selected]/item:[--c:calc(28px*var(--board-line-scale,1))]",
);
// A side's band has no z-index: a card lying over this one's edge covers it, and the line grip in
// the side's middle (z-10) is pressed before it.
const GRIP_ROW =
  "inset-x-[calc(var(--c)_-_var(--co))] h-[calc(var(--o)_+_var(--i))] cursor-ns-resize";
const GRIP_COLUMN =
  "inset-y-[calc(var(--c)_-_var(--co))] w-[calc(var(--o)_+_var(--i))] cursor-ew-resize";
const GRIP_CORNER = "size-(--c)";
// Only the bottom corners are marked and taken by a finger on a card that is not selected; a
// finger on the other grips of such a card moves it or pans, as it always has.
const GRIP_SELECTED_TOUCH =
  "pointer-coarse:pointer-events-none pointer-coarse:group-data-[board-selected]/item:pointer-events-auto";

/** Each grip a card is resized by: the bottom corners first, then the top ones, then the sides. */
const RESIZE_GRIPS: ReadonlyArray<{
  readonly name: string;
  readonly edges: BoardResizeEdges;
  readonly className: string;
  readonly mark?: string;
}> = [
  {
    name: "sw",
    edges: { x: "start", y: "end" },
    className: cn(GRIP_CORNER, "-bottom-(--co) -left-(--co) cursor-nesw-resize"),
    mark: "bottom-(--co) left-(--co) rounded-bl-xs border-s-2",
  },
  {
    name: "se",
    edges: { x: "end", y: "end" },
    className: cn(GRIP_CORNER, "-right-(--co) -bottom-(--co) cursor-nwse-resize"),
    mark: "right-(--co) bottom-(--co) rounded-br-xs border-e-2",
  },
  {
    name: "nw",
    edges: { x: "start", y: "start" },
    className: cn(GRIP_CORNER, GRIP_SELECTED_TOUCH, "-top-(--co) -left-(--co) cursor-nwse-resize"),
  },
  {
    name: "ne",
    edges: { x: "end", y: "start" },
    className: cn(GRIP_CORNER, GRIP_SELECTED_TOUCH, "-top-(--co) -right-(--co) cursor-nesw-resize"),
  },
  { name: "n", edges: { y: "start" }, className: cn(GRIP_ROW, GRIP_SELECTED_TOUCH, "-top-(--o)") },
  {
    name: "e",
    edges: { x: "end" },
    className: cn(GRIP_COLUMN, GRIP_SELECTED_TOUCH, "-right-(--o)"),
  },
  {
    name: "s",
    edges: { y: "end" },
    className: cn(GRIP_ROW, GRIP_SELECTED_TOUCH, "-bottom-(--o)"),
  },
  {
    name: "w",
    edges: { x: "start" },
    className: cn(GRIP_COLUMN, GRIP_SELECTED_TOUCH, "-left-(--o)"),
  },
];

/**
 * A side or corner a card or note is resized by. It reports where the card was and how big when
 * it was taken, in board pixels, and how far the pointer went since, in screen pixels, so the size
 * never drifts from the pointer.
 */
function ResizeHandle({
  className,
  mark,
  onResize,
  onEnd,
}: {
  readonly className: string;
  /** The small corner drawn on a bottom corner's grip, placed on the card's own corner. */
  readonly mark: string | undefined;
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
  return (
    <div
      aria-hidden
      data-board-grip
      className={cn("absolute touch-none", BOARD_HOVER_CHROME_CLASS, className)}
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
      {mark === undefined ? null : (
        <span className={cn("absolute size-2 border-b-2 border-muted-foreground", mark)} />
      )}
    </div>
  );
}

const THREAD_DROP = "thread";
const CLOUD_NO_AGENTS = "Agents cannot join this board.";
const CLOUD_NO_WINDOWS =
  "Needs a board kept on your computer. Start one from New board with On this computer switched on.";
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

/** Whether this device's main pointer is a finger, so typing brings up an on-screen keyboard. */
const touchFirst = () =>
  typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;

/**
 * How far the chrome floating over the surface reaches into it from the top (the header) and from
 * the bottom (the toolbar and zoom), in screen pixels.
 */
const chromeCoverOf = (surface: HTMLElement | null) => {
  const area = boardAreaOf(surface);
  const root = surface?.parentElement;
  if (area === null || root === null || root === undefined) return { top: 0, bottom: 0 };
  const reach = (edge: "top" | "bottom") =>
    Math.max(
      0,
      ...boardChromeAt(root, edge).map((chrome) => {
        const drawn = chrome.getBoundingClientRect();
        return edge === "top" ? drawn.bottom - area.top : area.top + area.height - drawn.top;
      }),
    );
  return { top: reach("top"), bottom: reach("bottom") };
};

/** A note or task, which Ctrl+Enter and its + follow with a blank one beside it. */
const followsOn = (note: RoomBoardNote) =>
  note.section !== true &&
  note.pinnedTo === undefined &&
  (note.kind === undefined || note.kind === "task");

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
  /** The pointer dragging from a grip; absent with the Line tool, which picks by clicks. */
  readonly pointerId?: number;
}

const edgeAt = (x: number, y: number) =>
  document
    .elementsFromPoint(x, y)
    .find(
      (element): element is SVGElement =>
        element instanceof SVGElement && element.dataset.boardEdge !== undefined,
    )?.dataset.boardEdge ?? null;

/** A grip's band reaches outside its card; past the card's edge a press it covers is the line's. */
const linePressOnGrip = (target: EventTarget | null, x: number, y: number) => {
  if (!(target instanceof Element) || target.closest("[data-board-grip]") === null) return null;
  const box = target.closest<HTMLElement>("[data-board-item]")?.getBoundingClientRect();
  if (box === undefined || (x >= box.left && x <= box.right && y >= box.top && y <= box.bottom)) {
    return null;
  }
  return edgeAt(x, y);
};

/**
 * A shared thread laid out as a board: the thread boxes everyone added, each its own
 * conversation, each person in the room, and their cards, with lines between them. The
 * arrangement and the cards are the room's: the owner and every guest see the same ones.
 */
const NO_FORMER_PEOPLE: BoardPeople["guests"] = [];
const NO_BOXES: ReadonlySet<string> = new Set();
const NO_SELECTION: ReadonlySet<string> = new Set();
const NO_AGENT_TURNS: ReadonlyArray<RoomBoardAgentTurn> = [];
const NO_REACTIONS: ReadonlyArray<RoomBoardReaction> = [];
const NO_MARK_PINS: ReadonlyArray<BoardMarkPin> = [];
const NO_HISTORY: {
  readonly undo: ReadonlyArray<BoardHistoryItem>;
  readonly redo: ReadonlyArray<BoardHistoryItem>;
} = { undo: [], redo: [] };
// Which cards an undo leaves depends only on the cards themselves.
const ANY_CARD: RoomBoardScope = { hasCard: () => true, hasPerson: () => true };
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
  sharingFolds = false,
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
  stopBox,
  boxChatDeleter,
  boxRunEnd,
  roomModel,
  cloud,
  bringAgent,
  ownAgentAway = false,
  takeAgentAway,
  ownBoxHandle,
  view: viewMode,
  onViewChange,
  onToggleChat,
  viewOnly = false,
  marksStart,
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
  /** `sharing` narrows itself on a narrow board, so it stays in the header, not behind a menu. */
  readonly sharingFolds?: boolean;
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
  /** Stops the run of a box's agent, where this viewer may: absent for a box they may not. */
  readonly stopBox?: ((boxId: string) => (() => void) | undefined) | undefined;
  /** Deletes a box's chat, where it is this viewer's own here: absent for a box whose it is not. */
  readonly boxChatDeleter?: ((boxId: string) => (() => void) | undefined) | undefined;
  /**
   * How a box's last run ended, from the machine that ran it, where this client reads that
   * machine: null when none ended yet there. Undefined for a box whose machine it cannot read.
   */
  readonly boxRunEnd?: ((boxId: string) => BoardAgentEnd | null | undefined) | undefined;
  /** The model the room thread's own agent runs on, as this client can name it. */
  readonly roomModel?: string | undefined;
  /** The board is on the cloud host, on nobody's machine. */
  readonly cloud?: RoomBoardCloud | undefined;
  /**
   * The viewer has no agent on this board yet: Thread, Ask an agent, Run with an agent and
   * Attach my agent open this instead, which says how to bring one.
   */
  readonly bringAgent?: (() => void) | undefined;
  /** The viewer's agent was on this board, and their computer is not connected now. */
  readonly ownAgentAway?: boolean | undefined;
  /** The viewer's agent is on this board: takes it off again, the way out of bringing it. */
  readonly takeAgentAway?: (() => Promise<void>) | undefined;
  /**
   * Set by the board: adds the viewer's own agent box mid-view, selected, with the caret in its
   * prompt, as when their agent has just come. Returns its id, or null when it cannot.
   */
  readonly ownBoxHandle?: Ref<(() => string | null) | null> | undefined;
  /** Board or Plan, as the host's URL keeps it. Absent: the board keeps it in the page's URL. */
  readonly view?: BoardViewMode | undefined;
  readonly onViewChange?: ((view: BoardViewMode) => void) | undefined;
  /** Shows or hides the conversation beside the board, where it has one. */
  readonly onToggleChat?: (() => void) | undefined;
  /** The viewer can only look: the tools to add, undo and redo are not shown at all. */
  readonly viewOnly?: boolean | undefined;
  /**
   * The viewer says where new visitors start: a cloud board's maker. Absent: the room's owner
   * (no `viewer`) does.
   */
  readonly marksStart?: boolean | undefined;
}) {
  const board = room?.board ?? EMPTY_ROOM_BOARD;
  const [pickedView, pickView] = useBoardViewMode(viewMode, onViewChange);
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
  // Cards whose deleting Undo could not take back, waiting for a yes.
  const [confirmingDelete, setConfirmingDelete] = useState<ReadonlyArray<string> | null>(null);
  // A section being deleted with cards over it: what goes anyway, and the cards that could.
  const [deletingSection, setDeletingSection] = useState<{
    readonly noteIds: ReadonlyArray<string>;
    readonly cardIds: ReadonlyArray<string>;
  } | null>(null);
  // The viewer's own boxes a draft could go to, while they pick one.
  const [pickingBox, setPickingBox] = useState<{
    readonly ids: ReadonlyArray<string>;
    readonly onPick: (boxId: string) => void;
  } | null>(null);
  // Whether deleting the boxes among them deletes their chats too: off unless the person ticks it.
  const [deletingChats, setDeletingChats] = useState(false);
  const [queueChange] = useState(boardChangeQueue);
  // The view left here last time, which the board reopens on when it still shows a card.
  const [remembered] = useState(() =>
    viewKey === undefined ? undefined : rememberedRoomBoardView(viewKey),
  );
  const [view, setView] = useState<BoardView>(remembered ?? INITIAL_BOARD_VIEW);
  const unsavedView = useRef<BoardView | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const fitted = useRef(false);
  // The view the board opened on when it showed only its start; a hint offers the rest until it moves.
  const [firstView, setFirstView] = useState<BoardView | null>(null);
  const canEdit = room !== null && onChange !== undefined;
  // Each board the room sends retires the edits it moved past, before any can show again.
  const settledEdits = settleBoardEdits(board, edits);
  if (settledEdits !== edits) setEdits(settledEdits);
  const shown = resolveBoard(board, settledEdits);
  const edges = shown.edges ?? [];
  const marks = boardMarks(shown);
  // The card a note held over would be handed to, and what that does.
  const [dropTarget, setDropTarget] = useState<{
    readonly on: string;
    readonly label: string;
  } | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  // The layer above the cards, where each line draws a faint copy of itself.
  const [edgesOver, setEdgesOver] = useState<SVGGElement | null>(null);
  // The right-click menu: where it opened on screen and on the board, and the note it is for.
  const [contextMenu, setContextMenu] = useState<{
    readonly x: number;
    readonly y: number;
    readonly at: BoardPoint;
    readonly ref: string | null;
    /** The section whose empty space it opened on, by note id; its frame takes no pointer. */
    readonly section: string | undefined;
    readonly canPaste: boolean;
  } | null>(null);
  const [linking, setLinking] = useState<Linking | null>(null);
  // The Line tool: picking a card, then another, draws a line between them.
  const [lineTool, setLineTool] = useState(false);
  const linkPath = useRef<SVGPathElement | null>(null);
  const linkTarget = useRef<HTMLElement | null>(null);
  const drawnHeights = useBoardDrawnHeights(surfaceRef);
  // The card a line being drawn would land on, outlined; set on the page, not in state, so a
  // pointer moving over the board draws only the line.
  const markLinkTarget = (element: HTMLElement | null) => {
    const before = linkTarget.current;
    if (before === element) return;
    before?.style.removeProperty("outline");
    before?.style.removeProperty("outline-offset");
    linkTarget.current = element;
    element?.style.setProperty("outline", "2px solid var(--color-primary)");
    element?.style.setProperty("outline-offset", "4px");
  };
  const stopLinking = () => {
    markLinkTarget(null);
    setLinking(null);
  };
  const selectEdge = useStableCallback((id: string) =>
    setSelectedEdge((current) => (current === id ? null : id)),
  );
  // Where this person's last choice of line shape is kept, for the next line they draw here.
  const lineBoard = viewKey ?? shareId ?? title;
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  // The embeds this viewer clicked to show, newest last, and the one they are using now.
  const [embedsOpened, setEmbedsOpened] = useState<ReadonlyArray<string>>([]);
  const [embedInUse, setEmbedInUse] = useState<string | null>(null);
  // The pages people chose to show that this viewer asked to load, for this visit to the board.
  const [pagesShown, setPagesShown] = useState<ReadonlySet<string>>(() => new Set());
  const surfaceSize = useBoardSurfaceSize(surfaceRef);
  const liveEmbeds = boardLiveEmbeds(
    shown.notes,
    surfaceSize === null ? null : visibleBoardRect(view, surfaceSize),
    view.zoom,
    embedsOpened,
    pagesShown,
  );
  const showEmbed = (noteId: string) => {
    setEmbedsOpened((opened) => [...opened.filter((id) => id !== noteId), noteId].slice(-8));
    setPagesShown((pages) => (pages.has(noteId) ? pages : new Set(pages).add(noteId)));
  };
  const openEmbed = (noteId: string) => {
    showEmbed(noteId);
    setEmbedInUse(noteId);
    // Too far out for its page to load, a click zooms in to the card instead.
    if (view.zoom < BOARD_EMBED_MIN_ZOOM) zoomToCard(noteRef(noteId));
  };
  // What the address typed in the toolbar adds: a link card or a pull request window.
  const [draftKind, setDraftKind] = useState<"link" | "pull-request">("link");
  const draftUrl = (text: string) =>
    draftKind === "pull-request" ? (roomPullRequestOf(text)?.url ?? null) : boardUrlIn(text);
  const [following, setFollowing] = useState<{ person: string; seen: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Choosing Comment, then pressing the board, starts a thread there.
  const [placingComment, setPlacingComment] = useState(false);
  // Choosing Note, Task or Section, then clicking the board, adds that card there.
  const [armedTool, setArmedTool] = useState<ArmedCardTool | null>(null);
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
    // A wheel gesture that is panning the board keeps panning when it passes over a card that
    // scrolls, as the browser latches a scroll to where it began.
    let pannedAt = Number.NEGATIVE_INFINITY;
    const onWheel = (event: WheelEvent) => {
      // An open comment thread scrolls itself, and is never zoomed with the board.
      if (event.target instanceof Element && event.target.closest("[data-board-overlay]")) {
        if (event.ctrlKey || event.metaKey) event.preventDefault();
        return;
      }
      const zooming = event.ctrlKey || event.metaKey;
      if (!zooming && event.timeStamp - pannedAt > 300 && scrollsInside(event)) return;
      if (!zooming) pannedAt = event.timeStamp;
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
  // A phone's keyboard covers the lower part of the board: the field typed in is panned into what
  // it leaves in sight, below the header.
  const keepTypingInSight = useStableCallback(() => {
    const viewport = window.visualViewport;
    const surface = surfaceRef.current;
    const area = boardAreaOf(surface);
    const field = document.activeElement;
    if (
      viewport === null ||
      area === null ||
      !(field instanceof HTMLElement) ||
      surface?.contains(field) !== true ||
      !field.matches("textarea, input")
    ) {
      return;
    }
    const top = Math.max(0, viewport.offsetTop - area.top, chromeCoverOf(surface).top);
    const bottom = Math.min(area.height, viewport.offsetTop + viewport.height - area.top);
    if (bottom - top < 48) return;
    const drawn = field.getBoundingClientRect();
    const rect = clientRectToBoard(view, area, {
      x: drawn.left,
      y: drawn.top,
      width: drawn.width,
      height: drawn.height,
    });
    const shifted = { ...view, y: view.y - top };
    const next = panToShow(shifted, rect, { width: area.width, height: bottom - top });
    if (next === shifted) return;
    setFollowing(null);
    setView({ ...next, y: next.y + top });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the on-screen keyboard, which only the visual viewport reports
  useEffect(() => {
    const viewport = window.visualViewport;
    if (viewport === null) return;
    viewport.addEventListener("resize", keepTypingInSight);
    return () => viewport.removeEventListener("resize", keepTypingInSight);
  }, [keepTypingInSight]);
  // The board opens showing every card, once: after that the view is the viewer's to move. A
  // board just made from a template waits for its cards, which can reach it after it opens.
  const [fitAwaits] = useState(() => (viewKey === undefined ? 0 : roomBoardFitAwaits(viewKey)));
  const fittable =
    (cards === undefined ? room !== null : cards.length + shown.notes.length > 0) &&
    shown.notes.length >= fitAwaits;
  const fitFirst = useStableCallback(() => {
    const area = boardAreaOf(surfaceRef.current);
    if (fitted.current || !fittable || area === null || area.width === 0 || area.height === 0) {
      return;
    }
    fitted.current = true;
    if (viewKey !== undefined) forgetRoomBoardFitOnOpen(viewKey);
    const rects = drawnRectsIn(surfaceRef.current);
    // Readable from the first moment: a board too big to read whole opens on its start.
    const first = firstBoardView({
      rects,
      start: boardStartRect(surfaceRef.current, shown),
      area,
      covered: chromeCoverOf(surfaceRef.current),
      margin: FIT_MARGIN,
    });
    setFirstView(first.whole ? null : first.view);
    setView((current) =>
      current === INITIAL_BOARD_VIEW ||
      (current === remembered && openingBoardView(current, area, rects) === null)
        ? first.view
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the browser scrolls a box that hides its overflow to bring a focused element into view, which no React event reports
  useEffect(() => {
    // Focus on a card far out on the board would scroll a clipped box around it, moving the
    // whole board on screen. Such a box is never scrolled on purpose: put it back.
    const unscroll = (event: Event) => {
      const box = event.target;
      const surface = surfaceRef.current;
      if (!(box instanceof Element) || surface === null || !box.contains(surface)) return;
      if (box.scrollTop === 0 && box.scrollLeft === 0) return;
      if (!/hidden|clip/.test(getComputedStyle(box).overflow)) return;
      box.scrollTop = 0;
      box.scrollLeft = 0;
    };
    document.addEventListener("scroll", unscroll, true);
    return () => document.removeEventListener("scroll", unscroll, true);
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the board's on-screen size, which a conversation opening beside it shrinks
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    let last = boardAreaOf(surface) ?? { width: 0, height: 0 };
    return observeResize(surface, () => {
      // Laid out under the Plan at another size, the board keeps the view it was left at, and
      // comes back to it at the size it had.
      if (surface.inert) return;
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
  const holds = roomBoardHolds(cloud);
  // A cloud board has no owner to wait on, so nobody gets a card of their own there.
  const guestCards = cards === undefined && holds.room ? guests : [];
  const agents =
    cards === undefined && holds.agents ? boardAgents(guests, room?.turns ?? [], running) : [];
  const canGive = onGiveNote !== undefined && agents.some(({ guest }) => guest.id === viewer);
  const cardIds = cards?.map((card) => card.id) ?? [
    ...(holds.room ? [ROOM_BOARD_THREAD_CARD] : []),
    ...guestCards.map(guestCardId),
    ...agents.map(({ guest }) => agentCardId(guest)),
  ];
  // Cards the board will add on its own grid: each guest's agent once it runs, and whoever joins
  // next with theirs. New cards keep clear of their slots.
  const upcomingCardIds =
    cards === undefined && holds.agents
      ? [
          ...guestCards
            .filter((guest) => !agents.some((agent) => agent.guest.id === guest.id))
            .map(agentCardId),
          ...(holds.room ? [NEXT_GUEST_CARD] : []),
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
  const { ref: linesRef, ...lineHover } = useBoardLineFocus(selected, selectedEdge, edges.length);
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
  const catchUp = useBoardCatchUp(viewKey ?? shareId, board, viewer, people);
  const catchUpLabels = new Map(
    catchUp.changes.map(({ note }) => [
      note.id,
      `${boardPersonName(people, note.changed?.guestId)} added or changed this since you were here`,
    ]),
  );
  const pinScale = boardPinScale(view.zoom);
  const boxes = new Map<string, BoardBox>([
    ...Object.entries(positions).map(
      ([id, at]) =>
        [cardRef(id), boardCardBox(at, sizes[id], drawnHeights.get(cardRef(id)))] as const,
    ),
    ...shown.notes
      .filter((note) => !hiddenComment(note))
      .map(
        (note) =>
          [
            noteRef(note.id),
            boardNoteBox(note, view.zoom, drawnHeights.get(noteRef(note.id))),
          ] as const,
      ),
  ]);
  const threadBoxes =
    cards === undefined && holds.agents ? boardThreadBoxes(shown, title, holds.room) : [];
  // Where an agent is working: the cards its turn just added or changed, in its box's colour.
  const agentWork = useBoardAgentWork(room === null ? null : (shown.agentTurns ?? NO_AGENT_TURNS));
  const agentWorkOf = (noteId: string) => {
    const work = agentWork.get(noteId);
    if (work === undefined) return undefined;
    const box = threadBoxes.find((candidate) => candidate.id === work.boxId);
    return {
      name: box === undefined ? "Agent" : box.title || boardBoxName(box, people),
      color: boardCursorColor(guests, box?.guestId),
      stamp: work.stamp,
    };
  };
  // Which of a box's several artifacts this person's next reply rewrites, by box, until they leave.
  const [replyCards, setReplyCards] = useState(readReplyCards);
  const contexts = new Map(
    threadBoxes.map((box) => [
      box.id,
      boardPromptContext(shown, people, messages, box.id, replyCards[box.id]),
    ]),
  );
  // Said on a card only where the viewer's own box has several to choose from.
  const replyTargets = new Set(
    threadBoxes.flatMap((box) => {
      const context = contexts.get(box.id);
      return context !== undefined &&
        context.artifact !== null &&
        context.artifacts.length > 1 &&
        onPromptBox !== undefined &&
        canPromptBoardBox(box, viewer)
        ? [context.artifact.id]
        : [];
    }),
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
    ...[...contexts.values()].flatMap((context) => context.artifactEdgeIds),
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
  // Where each connected card stands with the agents its lines reach.
  const noteStatuses = boardNoteAgentStatuses(contexts);
  // A box's connected notes, or with `into` only those on that artifact.
  const connectedNotes = (boxIds: ReadonlyArray<string>, into?: string) =>
    boxIds.flatMap((boxId) =>
      boardConnectedNotes(shown, noteStatuses, contexts.get(boxId)?.cards ?? [], into),
    );
  // Said on plain notes, marks among them: a task has its own status, a window its own bar.
  const noteStatusOf = (note: RoomBoardNote) =>
    note.kind === undefined ? noteStatuses.get(noteRef(note.id)) : undefined;
  const noteStatusChip = (note: RoomBoardNote) => {
    const status = noteStatusOf(note);
    return status === undefined ? null : (
      <NoteAgentChip
        status={status}
        boxName={boxName(status.boxId)}
        onResend={canEdit && onChange !== undefined ? () => resendCard(status.card) : undefined}
      />
    );
  };
  // The notes with a line into an artifact, a view's being those of the artifact it shows.
  const artifactNotes = (note: RoomBoardNote) => {
    const source = roomArtifactSource(shown, note.id) ?? note;
    return connectedNotes(
      threadBoxes
        .filter((box) => contexts.get(box.id)?.artifact?.id === source.id)
        .map((box) => box.id),
      noteRef(source.id),
    );
  };
  // Only arms the card for the next prompt someone sends themselves; nothing is sent here.
  const resendCard = (card: BoardPromptCard) => {
    if (onChange === undefined) return;
    for (const change of boardResendChanges(shown, card)) {
      void queueChange(boardChangeQueueKey(shown, { kind: "edge", id: change.edgeId }, null), () =>
        onChange(change),
      );
    }
  };
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
  // On a cloud board a box runs only on its person's machine: theirs is away while they are not on
  // the board, and the viewer's own until they bring their agent. A viewer cannot prompt anyway.
  const boxOffline = (box: Pick<BoardThreadBox, "guestId">) =>
    !viewOnly &&
    cloud !== undefined &&
    box.guestId !== undefined &&
    (box.guestId === viewer
      ? bringAgent !== undefined
      : !online.some((id) => id === box.guestId) &&
        !running.some((agent) => agent.guestId === box.guestId));
  // Why a box cannot run now, in the words of whoever looks at it: their own is theirs to fix.
  const boxOfflineNote = (box: Pick<BoardThreadBox, "guestId">) =>
    !boxOffline(box)
      ? undefined
      : box.guestId !== viewer
        ? "Offline"
        : ownAgentAway
          ? "Your computer is not connected"
          : "Your agent is not here";
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
  const writeOf = (note: RoomBoardNote) =>
    onChange === undefined || !canEdit || note.kind !== "artifact"
      ? undefined
      : (body: string) =>
          queueChange(noteRef(note.id), () =>
            onChange({ type: "artifact.write", noteId: note.id, body }),
          );
  // A view that takes what it shows as its own and stops following, so two versions sit side by
  // side. One of an artifact still empty only stops following.
  const keepOf = (view: RoomBoardNote, source: RoomBoardNote | undefined) =>
    onChange === undefined || !canEdit || view.viewOf === undefined
      ? undefined
      : {
          label: source?.artifact === undefined ? "Stop following" : "Keep this version",
          run: () =>
            queueChange(noteRef(view.id), () =>
              onChange({
                type: "artifact.copy",
                noteId: view.id,
                fromNoteId: source?.id ?? view.id,
              }),
            ),
        };
  const liveStore = use(RoomLiveContext);
  // What a drag moves on the page, by edit key: the element and where it was drawn as the drag
  // began, found on its first step after that.
  const framed = useRef(new Map<string, { el: HTMLElement; x: number; y: number } | null>());
  // Elements a landed drag moved, put back once the board renders them where they landed.
  const landedFrames = useRef<Array<HTMLElement>>([]);
  // Something is being dragged, resized or nudged.
  const [moving, setMoving] = useState(false);
  // This person's own drag or resize: what it moves from where, how far the pointer went in board
  // pixels, and what it snaps to (gathered once as it starts; null when it does not snap).
  const gesture = useRef<{
    readonly key: string;
    readonly items: ReadonlyArray<BoardSelected>;
    readonly box: BoardRect | null;
    readonly targets: BoardSnapTargets | null;
    dx: number;
    dy: number;
  } | null>(null);
  const [snapStore] = useState(createBoardSnapStore);
  // Ctrl or Cmd held as the pointer moves: this drag goes where it is put, as in FigJam.
  const snapOff = useRef(false);
  const endSnap = () => {
    gesture.current = null;
    snapStore.set(NO_SNAP_DRAWN);
  };
  const paintFrames = () => {
    const rects = new Map<string, BoardOwnRect>();
    const put = (ref: string, rect: BoardOwnRect) => rects.set(ref, { ...rects.get(ref), ...rect });
    for (const [key, drawn] of framed.current) {
      const value = held.current.get(key);
      if (value === undefined || value === null) continue;
      if ("w" in value) {
        put(cardRef(key.slice(key.indexOf(":") + 1)), { w: value.w, h: value.h });
        continue;
      }
      if (!("x" in value)) continue;
      const was = gestureFrom.current.get(key);
      const sized =
        "size" in value &&
        value.size !== undefined &&
        (was === null ||
          was === undefined ||
          !("size" in was) ||
          was.size?.w !== value.size.w ||
          was.size?.h !== value.size.h);
      put(key, {
        x: value.x,
        y: value.y,
        ...(sized && "size" in value && value.size !== undefined
          ? { w: value.size.w, h: value.size.h }
          : {}),
      });
      let at = drawn;
      if (at === null) {
        const el =
          surfaceRef.current?.querySelector<HTMLElement>(
            `[data-board-item="${CSS.escape(key)}"]`,
          ) ?? null;
        if (el === null) continue;
        at = { el, x: el.offsetLeft, y: el.offsetTop };
        framed.current.set(key, at);
      }
      at.el.style.setProperty("translate", `${value.x - at.x}px ${value.y - at.y}px`);
    }
    liveStore.setOwnDrags(rects);
  };
  const letFrameGo = (key: string) => {
    const drawn = framed.current.get(key);
    if (drawn === undefined) return;
    framed.current.delete(key);
    if (drawn !== null) landedFrames.current.push(drawn.el);
    if (framed.current.size === 0) setMoving(false);
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a landed drag's cards are moved back on the page in the same paint the board draws them where they landed
  useLayoutEffect(() => {
    if (landedFrames.current.length === 0) return;
    for (const el of landedFrames.current) el.style.removeProperty("translate");
    landedFrames.current = [];
    paintFrames();
  });
  // `after` names the queue a change waits in: a line to a new card goes once the card is there.
  const send = (target: BoardTarget, value: BoardValue, after?: string | ReadonlyArray<string>) => {
    if (onChange === undefined) return;
    const key = boardEditKey(target);
    held.current.delete(key);
    letFrameGo(key);
    const before = boardStepBefore(gestureFrom.current, shown, target);
    gestureFrom.current.delete(key);
    // A deleted card comes back with what a change can send again; `removeNotes` takes its lines
    // off first so the same undo draws them again.
    const undoable =
      !(
        target.kind === "note" &&
        value === null &&
        (before === null || !("text" in before) || !boardNoteRestorable(before))
      ) && !(value !== null && "kind" in value && value.kind === "comment");
    if (undoable && !unrecorded.current) remember({ target, before, after: value });
    const queue = after ?? boardChangeQueueKey(shown, target, value);
    setEdits((current) => putBoardEdit(board, current, target, value, false));
    const change = boardChangeOf(target, value, before);
    const guideStep = boardGuideStepOfChange(change, before === null);
    void queueChange(queue, () => onChange(change)).then((taken) => {
      if (taken) {
        if (guideStep !== null) markBoardGuideStep(guideStep);
        return;
      }
      setEdits((current) => dropBoardEdit(current, target, value));
      if (boardChangeOutgrowsOlderHosts(change)) {
        toastManager.add({
          type: "info",
          title: "Could not make it that big",
          description:
            "If this board is kept by an older version of Tinkjam, update it to go past 1,600 pixels.",
        });
      }
    });
  };
  // A drag, nudge or resize (`frame`) renders the board once as it starts; after that each step
  // moves the cards on the page and tells the lines on them, and the board renders as it lands.
  const hold = (target: BoardTarget, value: NonNullable<BoardValue>, frame = false) => {
    const key = boardEditKey(target);
    const first = !held.current.has(key);
    if (first) gestureFrom.current.set(key, boardValueOf(shown, target));
    held.current.set(key, value);
    if (frame && !first && framed.current.has(key)) return paintFrames();
    if (frame) {
      framed.current.set(key, null);
      setMoving(true);
    }
    setEdits((current) => putBoardEdit(board, current, target, value, true));
  };
  // Everything sent in one go, as a drag of several cards, is one entry to take back.
  const remember = (step: BoardStep) => {
    if (batch.current === null) {
      const steps: Array<BoardStep> = [];
      const seen = boardAgentTurnsSeen(shown);
      batch.current = steps;
      queueMicrotask(() => {
        batch.current = null;
        setHistory((current) => ({
          undo: boardHistoryRemember(current.undo, { steps, seen }),
          redo: [],
        }));
      });
    }
    batch.current.push(step);
  };
  // Everything one agent turn did, taken back or done again in one change.
  const undoAgentTurn = (turn: RoomBoardAgentTurn, undone: boolean) => {
    if (onChange === undefined) return;
    const left = roomBoardAfterAgentTurn(shown, ANY_CARD, turn, undone, viewer, turn.at).left;
    void queueChange(`agent-turn:${turn.id}`, () =>
      onChange({ type: "agent-turn.undo", turnId: turn.id, undone }),
    );
    if (left.length > 0) {
      toastManager.add({
        type: "info",
        title: left.length === 1 ? "Left 1 card as it is" : `Left ${left.length} cards as they are`,
        description: "Someone changed them after the agent did.",
      });
    }
  };
  /** Undo or Redo for one agent turn, absent for whoever may not take it back. */
  const agentTurnUndo = (turn: RoomBoardAgentTurn) =>
    canEdit && onChange !== undefined && canUndoRoomAgentTurn(turn, viewer)
      ? (undone: boolean) => undoAgentTurn(turn, undone)
      : undefined;
  const travel = (direction: "undo" | "redo") => {
    if (!canEdit) return;
    const stack = direction === "undo" ? history.undo : history.redo;
    const newer =
      direction === "undo" ? boardAgentTurnToUndo(shown, viewer, stack.at(-1)) : undefined;
    if (newer !== undefined) {
      undoAgentTurn(newer, true);
      setHistory((current) => ({
        ...current,
        redo: boardHistoryWith(current.redo, { turnId: newer.id, seen: newer.at }),
      }));
      return;
    }
    const item = stack.at(-1);
    if (item === undefined) return;
    const now = { ...item, seen: boardAgentTurnsSeen(shown) };
    if ("turnId" in item) {
      const turn = shown.agentTurns?.find((candidate) => candidate.id === item.turnId);
      setHistory((current) =>
        direction === "undo"
          ? {
              undo: current.undo.slice(0, -1),
              redo: turn === undefined ? current.redo : [...current.redo, item],
            }
          : {
              undo: turn === undefined ? current.undo : [...current.undo, now],
              redo: current.redo.slice(0, -1),
            },
      );
      if (turn === undefined) {
        toastManager.add({
          type: "info",
          title: direction === "undo" ? "Skipped an undo" : "Skipped a redo",
          description: "The board no longer keeps that agent's work.",
        });
        return;
      }
      undoAgentTurn(turn, direction === "undo");
      return;
    }
    const steps = boardEntryWithAttached(
      shown,
      item.steps,
      direction,
      viewer,
      (id) =>
        surfaceRef.current?.querySelector<HTMLElement>(
          `[data-board-item="${CSS.escape(noteRef(id))}"]`,
        )?.offsetHeight,
    );
    const changes = boardHistoryChanges(shown, steps, direction);
    setHistory((current) =>
      direction === "undo"
        ? {
            undo: current.undo.slice(0, -1),
            redo: changes === null ? current.redo : [...current.redo, { ...item, steps }],
          }
        : {
            undo: changes === null ? current.undo : [...current.undo, { ...now, steps }],
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
    const queues = boardHistoryQueues(changes);
    withFlag(unrecorded, () => {
      changes.forEach(({ target, value }, index) => send(target, value, queues[index]));
    });
  };
  // A link card's title read from its source, once it arrives: only while nobody named it.
  const nameLink = useStableCallback((id: string, title: string) => {
    const note = shown.notes.find((candidate) => candidate.id === id);
    if (
      note?.kind !== "link" ||
      note.text !== "" ||
      held.current.has(boardEditKey({ kind: "note", id }))
    ) {
      return;
    }
    send({ kind: "note", id }, settleBoardValue({ ...note, text: title }));
  });
  // A toast's Undo takes back its own deleting, while it is still the newest step.
  const undoDeletion = useStableCallback((steps: BoardHistoryEntry) => {
    const last = history.undo.at(-1);
    if (last !== undefined && "steps" in last && last.steps === steps) travel("undo");
  });
  // Undo and redo reach the board while focus rests on a plain control outside it, such as the
  // sidebar's toggle; fields, dialogs, menus and other widgets keep their keys.
  const historyKeyOutside = useStableCallback((event: KeyboardEvent) => {
    const surface = surfaceRef.current;
    const target = event.target;
    if (event.defaultPrevented || surface === null || surface.getClientRects().length === 0) {
      return;
    }
    if (target instanceof Node && surface.contains(target)) return;
    if (target instanceof Element && !isBoardKeyOutside(target)) return;
    const direction = boardHistoryKey(event);
    if (direction === null || !canEdit) return;
    event.preventDefault();
    travel(direction);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keys pressed with focus outside the board reach only the window
  useEffect(() => {
    window.addEventListener("keydown", historyKeyOutside);
    return () => window.removeEventListener("keydown", historyKeyOutside);
  }, [historyKeyOutside]);
  // The room hears of a drag or a draft once, when it ends.
  const letGo = (target: BoardTarget, after?: string) => {
    const value = held.current.get(boardEditKey(target));
    if (value !== undefined) send(target, settleBoardValue(value), after);
  };
  // Typed text goes to the room when its field blurs, but a phone leaving the board, or hiding
  // the page, unmounts or freezes the field without one: send what is typed then too.
  const sendTyping = useStableCallback(() => {
    for (const value of held.current.values()) {
      if ("text" in value) letGo({ kind: "note", id: value.id });
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- sends typed text when the page is hidden or the board unmounts, which no React event reports
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === "hidden") sendTyping();
    };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", sendTyping);
    return () => {
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("pagehide", sendTyping);
      sendTyping();
    };
  }, [sendTyping]);
  // Everyone else sees a drag as it goes, with this person's pointer, and where it landed.
  const sendDrag = () => {
    if (pointing) cursor.drag(boardDragItems(held.current, gestureFrom.current));
  };
  const release = (go: () => void) => {
    const dragged = boardDragItems(held.current, gestureFrom.current);
    endSnap();
    go();
    if (!pointing || dragged.length === 0) return;
    const still = boardDragItems(held.current, gestureFrom.current);
    if (still.length > 0) cursor.drag(still);
    else cursor.land(dragged);
  };
  // A selection dragged together lands together: one change for each card in it.
  const dropItem = (target: BoardTarget) =>
    release(() => {
      const group = inGroup(target)
        ? withSectionCards(selectedItems)
        : carried.current.get(boardEditKey(target));
      carried.current.clear();
      if (group === undefined) return letGo(target);
      for (const item of group) letGo(item.target);
    });
  // A section dragged on its own carries what sits over it when the drag starts.
  const carried = useRef(new Map<string, ReadonlyArray<BoardSelected>>());
  // The copies an Alt-drag carries, and how far it has gone in board pixels, until it lands.
  const altCopies = useRef<{
    readonly notes: ReadonlyArray<RoomBoardNote>;
    readonly box: BoardRect | null;
    readonly targets: BoardSnapTargets | null;
    dx: number;
    dy: number;
  } | null>(null);
  // Escape mid-gesture: everything held goes back where it was, nothing is sent, and everyone
  // else's view of the drag ends now rather than landing.
  const cancelGesture = () => {
    const keys = new Set(held.current.keys());
    altCopies.current = null;
    endSnap();
    held.current.clear();
    gestureFrom.current.clear();
    for (const key of keys) letFrameGo(key);
    carried.current.clear();
    press.current = null;
    setEdits((current) => dropHeldBoardEdits(current, keys));
    setDropTarget(null);
    stopLinking();
    marquee.cancel();
    if (pointing) cursor.drag([]);
  };
  useBoardPinch(surfaceRef, {
    view: useStableCallback(() => view),
    onStart: useStableCallback(() => {
      if (dropHeldPointer()) cancelGesture();
      press.current = null;
      setFollowing(null);
    }),
    onView: useStableCallback((next: BoardView) => setView(next)),
  });
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
  // A selection moved together takes what sits over each section in it, once.
  const withSectionCards = (items: ReadonlyArray<BoardSelected>): ReadonlyArray<BoardSelected> => {
    const all = new Map(items.map((item) => [boardEditKey(item.target), item]));
    for (const { target } of items) {
      for (const item of sectionGroup(target) ?? []) {
        const key = boardEditKey(item.target);
        if (!all.has(key)) all.set(key, item);
      }
    }
    return [...all.values()];
  };
  const groupOf = (target: BoardTarget) =>
    inGroup(target) ? withSectionCards(selectedItems) : sectionGroup(target);
  // What a gesture snaps to: the cards in sight, less what it moves and what others drag now.
  const snapTargetsFor = (moving: ReadonlySet<string>, box: BoardRect | null) => {
    const surface = surfaceRef.current;
    const area = boardAreaOf(surface);
    if (box === null || surface === null || area === null) return null;
    const items = [
      ...surface.querySelectorAll<HTMLElement>("[data-board-item]:not([data-board-pin])"),
    ].flatMap((element) => {
      const ref = element.dataset.boardItem ?? "";
      const live = liveStore.drag(ref);
      if (moving.has(ref) || (live !== undefined && live.own !== true)) return [];
      return [{ rect: drawnRect(element), section: element.hasAttribute("data-board-section") }];
    });
    return boardSnapTargets(items, box, visibleBoardRect(view, area));
  };
  // The gesture going on for this edit key, or a new one when it is not held yet.
  const gestureFor = (key: string, start: () => NonNullable<typeof gesture.current>) => {
    const now = gesture.current;
    if (now !== null && now.key === key && held.current.has(key)) return now;
    gesture.current = start();
    return gesture.current;
  };
  const snapThreshold = () => BOARD_SNAP_SCREEN_PX / view.zoom;
  // How far a drag moves its box: as far as the pointer went, snapped unless Ctrl or Cmd is held.
  const snappedShift = (now: {
    readonly box: BoardRect | null;
    readonly targets: BoardSnapTargets | null;
    readonly dx: number;
    readonly dy: number;
  }) => {
    if (now.box === null || now.targets === null || snapOff.current) {
      snapStore.set(NO_SNAP_DRAWN);
      return { dx: now.dx, dy: now.dy };
    }
    const box = { ...now.box, x: now.box.x + now.dx, y: now.box.y + now.dy };
    const snapped = boardSnapMove(box, now.targets, snapThreshold());
    snapStore.set(snapped);
    return { dx: now.dx + snapped.dx, dy: now.dy + snapped.dy };
  };
  // The drawn box of the cards a drag takes, by their refs.
  const drawnBounds = (refs: Iterable<string>) =>
    boardRectsBounds(
      [...refs].flatMap((ref) => {
        const element = drawnItem(ref);
        return element === null ? [] : [drawnRect(element)];
      }),
    );
  // A drag moves what it took from where it was by how far the pointer went, snapped by its box.
  const dragBy = (target: BoardTarget, from: BoardPoint, dx: number, dy: number, snap = true) => {
    if (!canEdit) return;
    const key = boardEditKey(target);
    const now = gestureFor(key, () => {
      const group = groupOf(target);
      const items = (group ?? [{ target, value: from }]).map((item) => {
        const last = held.current.get(boardEditKey(item.target));
        return last !== undefined && "x" in last ? { ...item, value: last } : item;
      });
      const moving = new Set(items.map((item) => boardEditKey(item.target)));
      // A section carrying what sits over it snaps by its own frame.
      const box = drawnBounds(group !== null && !inGroup(target) ? [key] : moving);
      return { key, items, box, targets: snap ? snapTargetsFor(moving, box) : null, dx: 0, dy: 0 };
    });
    now.dx += dx / view.zoom;
    now.dy += dy / view.zoom;
    const shift = snappedShift(now);
    for (const item of boardGroupMove(now.items, shift.dx, shift.dy)) {
      hold(item.target, item.value, true);
    }
    sendDrag();
  };
  // Arrow keys move the selection as a drag does, and it lands once they stop.
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nudged = useRef(new Map<string, BoardTarget>());
  const endNudge = useStableCallback(() => {
    nudgeTimer.current = null;
    const targets = [...nudged.current.values()];
    nudged.current.clear();
    carried.current.clear();
    release(() => {
      for (const target of targets) letGo(target);
    });
  });
  const nudge = (dx: number, dy: number) => {
    if (!canEdit || selectedItems.length === 0) return;
    const now = withSectionCards(selectedItems).map((item) => {
      const last = held.current.get(boardEditKey(item.target));
      return last !== undefined && "x" in last ? { ...item, value: last } : item;
    });
    for (const item of boardGroupMove(now, dx, dy)) {
      nudged.current.set(boardEditKey(item.target), item.target);
      hold(item.target, item.value, true);
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
  // Where a resize from a side or corner takes a card (`ref`, held as `key`): the pointer's way,
  // its moving edges snapped unless Ctrl or Cmd is held. The opposite edges stay where they are.
  const resized = (
    key: string,
    ref: string,
    edges: BoardResizeEdges,
    from: BoardRect,
    dx: number,
    dy: number,
    max?: number,
  ) => {
    const x = edges.x === undefined ? 0 : dx / view.zoom;
    const y = edges.y === undefined ? 0 : dy / view.zoom;
    const pointed = {
      x: edges.x === "start" ? from.x + x : from.x,
      y: edges.y === "start" ? from.y + y : from.y,
      width: from.width + (edges.x === "start" ? -x : x),
      height: from.height + (edges.y === "start" ? -y : y),
    };
    const now = gestureFor(key, () => ({
      key,
      items: [],
      box: from,
      targets: snapTargetsFor(new Set([ref]), from),
      dx: 0,
      dy: 0,
    }));
    let rect = pointed;
    if (now.targets !== null && !snapOff.current) {
      const snapped = boardSnapResize(pointed, edges, now.targets, snapThreshold());
      snapStore.set(snapped);
      rect = snapped.rect;
    } else snapStore.set(NO_SNAP_DRAWN);
    return resizeBoardRect(
      from,
      edges,
      edges.x === "start" ? rect.x - from.x : rect.width - from.width,
      edges.y === "start" ? rect.y - from.y : rect.height - from.height,
      max,
    );
  };
  // A left or top edge moves the card's origin as it resizes.
  const movesOrigin = (edges: BoardResizeEdges) => edges.x === "start" || edges.y === "start";
  const resizeCard = (
    id: string,
    edges: BoardResizeEdges,
    from: BoardRect,
    dx: number,
    dy: number,
  ) => {
    if (!canEdit) return;
    const next = resized(boardEditKey({ kind: "size", id }), cardRef(id), edges, from, dx, dy);
    hold({ kind: "size", id }, next.size, true);
    if (movesOrigin(edges)) hold({ kind: "card", id }, { x: next.x, y: next.y }, true);
    sendDrag();
  };
  // A card's size and place are two changes; one queue sends them in order, as one step to undo.
  const endCardResize = (id: string, edges: BoardResizeEdges) =>
    release(() => {
      const queue = boardEditKey({ kind: "size", id });
      letGo({ kind: "size", id });
      if (movesOrigin(edges)) letGo({ kind: "card", id }, queue);
    });
  // A note's place and size are one value, so a resize from any side is one change.
  const resizeNote = (
    note: RoomBoardNote,
    edges: BoardResizeEdges,
    from: BoardRect,
    dx: number,
    dy: number,
  ) => {
    if (!canEdit) return;
    const now = noteNow(note);
    const ref = noteRef(note.id);
    const next = resized(ref, ref, edges, from, dx, dy, boardMaxSide(note));
    hold(
      { kind: "note", id: note.id },
      {
        ...now,
        ...(edges.x === "start" ? { x: next.x } : {}),
        ...(edges.y === "start" ? { y: next.y } : {}),
        size: next.size,
      },
      true,
    );
    sendDrag();
  };
  const dragNote = (
    note: RoomBoardNote,
    dx: number,
    dy: number,
    event: PointerEvent<HTMLElement>,
  ) => {
    const target = { kind: "note", id: note.id } as const;
    // Alt held as a drag starts leaves the originals, and their lines, where they are: copies
    // follow the pointer instead.
    if (
      altCopies.current === null &&
      event.altKey &&
      canEdit &&
      !held.current.has(boardEditKey(target))
    ) {
      const copies = boardDuplicates(
        (inGroup(target) ? selectedNotes : [note]).map(noteNow),
        viewer,
        randomUUID,
      ).slice(0, Math.max(0, ROOM_BOARD_MAX_NOTES - shown.notes.length));
      if (copies.length > 0) {
        // The copies start over their originals, which stay behind to snap to.
        const box = drawnBounds(copies.map(({ from }) => noteRef(from)));
        altCopies.current = {
          notes: copies.map(({ note }) => note),
          box,
          targets: snapTargetsFor(new Set(), box),
          dx: 0,
          dy: 0,
        };
      }
    }
    const copying = altCopies.current;
    if (copying !== null) {
      copying.dx += dx / view.zoom;
      copying.dy += dy / view.zoom;
      const shift = snappedShift(copying);
      for (const copy of copying.notes) {
        hold(
          { kind: "note", id: copy.id },
          { ...copy, x: copy.x + shift.dx, y: copy.y + shift.dy },
          true,
        );
      }
      return sendDrag();
    }
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
    const copying = altCopies.current;
    if (copying !== null) {
      altCopies.current = null;
      release(() => {
        for (const copy of copying.notes) letGo({ kind: "note", id: copy.id });
      });
      setSelection(new Set(copying.notes.map((copy) => noteRef(copy.id))));
      return;
    }
    const target = { kind: "note", id: note.id } as const;
    const hand =
      dropTarget === null || inGroup(target) ? undefined : handOf(note, dropTarget.on)?.run;
    setDropTarget(null);
    if (hand === undefined) return dropItem(target);
    endSnap();
    const value = held.current.get(boardEditKey(target));
    held.current.delete(boardEditKey(target));
    gestureFrom.current.delete(boardEditKey(target));
    letFrameGo(boardEditKey(target));
    if (value !== undefined) setEdits((current) => dropBoardEdit(current, target, value));
    // It goes back where it was: nobody else is told it landed.
    sendDrag();
    hand();
  };
  // Everyone else reads the text as it is typed, with the pointer; the board stores it on blur.
  const writeNote = (note: RoomBoardNote, text: string, added?: RoomBoardMention) => {
    const current = noteNow(note);
    // Someone picked with `@` stays mentioned while the text names them.
    const mentions = roomMentionsIn([...(current.mentions ?? []), ...(added ? [added] : [])], text);
    hold(
      { kind: "note", id: note.id },
      current.mentions === undefined && mentions.length === 0
        ? { ...current, text }
        : { ...current, text, mentions },
    );
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
  // Where each task this person ticked was in the Plan before, for as long as this board is open.
  const beforeDone = useRef(new Map<string, BoardPlanSpot>());
  // Unticked, a task goes back to where it was before it was done, else to the bottom of To do.
  const tickTask = (note: RoomBoardNote, done: boolean) => {
    if (done) {
      if (note.done !== true) {
        beforeDone.current.set(note.id, { status: roomTaskStatus(note), order: note.order });
      }
      changeNote(note, (current) => ({ ...current, done: true }));
      return;
    }
    const before = beforeDone.current.get(note.id);
    beforeDone.current.delete(note.id);
    placeTasks(boardPlanUntick(boardPlanColumns(shown.notes), note.id, before));
  };
  // A team's relay may not keep a colour yet, so only a room's notes offer one.
  const pickColor =
    canEdit && cards === undefined
      ? (note: RoomBoardNote, color: RoomBoardNoteColor) => {
          setNoteColor(color);
          changeNote(note, (current) => ({ ...current, color }));
        }
      : undefined;
  // Shows a link card's own page in it, or hides it, for everyone; whoever shows it has asked to
  // load it. A team's relay may not keep it yet, so only a room's cards offer it.
  const framePage =
    canEdit && cards === undefined
      ? (note: RoomBoardNote, framed: boolean) => {
          if (framed) showEmbed(note.id);
          changeNote(note, ({ framed: _framed, ...rest }) =>
            framed ? { ...rest, framed: true } : rest,
          );
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
  // A vote is the thumbs-up reaction. On several cards it votes for all, or takes them all back.
  const voteOn = (notes: ReadonlyArray<RoomBoardNote>) => {
    if (reactTo === undefined) return;
    for (const note of boardVoteToggles(notes, viewer)) reactTo(note, BOARD_VOTE);
  };
  const [minimapShown, toggleMinimap] = useBoardMinimap();
  const [agentsOpen, setAgentsOpen] = useState(false);
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
  const cannotAddLine =
    room === null || !canEdit
      ? cannotAdd
      : edges.length >= ROOM_BOARD_MAX_EDGES
        ? `The board holds ${ROOM_BOARD_MAX_EDGES} lines at most. Delete one to add another.`
        : null;
  const cannotAddThread =
    cannotAdd ??
    (!holds.agents
      ? CLOUD_NO_AGENTS
      : threadsFull
        ? `The board holds ${ROOM_BOARD_MAX_THREADS} thread boxes at most`
        : null);
  const cannotAddArtifact =
    cannotAdd ??
    (artifactsFull ? `The board holds ${ROOM_BOARD_MAX_ARTIFACTS} artifacts at most` : null);
  const codeFull =
    shown.notes.filter((note) => note.kind === "code").length >= ROOM_BOARD_MAX_CODE_WINDOWS;
  // A cloud board has no machine to read code or pull requests from; its tools show disabled.
  const noMachineWindows = cards === undefined && !holds.windows;
  const cannotAddCode =
    cannotAdd ??
    (noMachineWindows
      ? CLOUD_NO_WINDOWS
      : codeFull
        ? `The board holds ${ROOM_BOARD_MAX_CODE_WINDOWS} code windows at most`
        : null);
  const pullRequestsFull =
    shown.notes.filter((note) => note.kind === "pull-request").length >=
    ROOM_BOARD_MAX_PULL_REQUESTS;
  const cannotAddPullRequest =
    cannotAdd ??
    (noMachineWindows
      ? CLOUD_NO_WINDOWS
      : pullRequestsFull
        ? `The board holds ${ROOM_BOARD_MAX_PULL_REQUESTS} pull request windows at most`
        : null);
  const machineTools = cards === undefined && holds.windows;
  const machineToolsShown = cards === undefined;
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
  // Pans once, and only when the rect is not already in view whole: a card just added as little
  // as it takes, anything else shown to the middle of what the header and toolbar leave in sight.
  const reveal = (rect: BoardRect, added = false) => {
    const surface = boardAreaOf(surfaceRef.current);
    if (surface === null) return;
    if (added) {
      // What the bottom toolbar covers is out of view: a card added is shown above it.
      const area = {
        width: surface.width,
        height: Math.max(surface.height / 2, surface.height - BOARD_TOOLBAR_BAND),
      };
      const next = panToShowAdded(view, rect, area);
      if (next === view) return;
      setFollowing(null);
      setView(next);
      return;
    }
    const cover = chromeCoverOf(surfaceRef.current);
    const height = surface.height - cover.top - cover.bottom;
    const top = height < surface.height / 2 ? 0 : cover.top;
    const shifted = { ...view, y: view.y - top };
    const next = panToCentre(shifted, rect, {
      width: surface.width,
      height: top === 0 ? surface.height : height,
    });
    if (next === shifted) return;
    setFollowing(null);
    setView({ ...next, y: next.y + top });
  };
  // Far enough in for a card's page to load, as `reveal` centres it, when the board is too far out.
  const zoomToCard = (ref: string) => {
    const element = drawnItem(ref);
    const area = boardAreaOf(surfaceRef.current);
    if (element === null || area === null) return;
    const rect = drawnRect(element);
    const cover = chromeCoverOf(surfaceRef.current);
    const height = area.height - cover.top - cover.bottom;
    const top = height < area.height / 2 ? 0 : cover.top;
    const zoomed = {
      ...view,
      zoom: Math.max(view.zoom, BOARD_EMBED_MIN_ZOOM),
      y: view.y - top,
    };
    const next = panToCentre(zoomed, rect, {
      width: area.width,
      height: top === 0 ? area.height : height,
    });
    setFollowing(null);
    setView({ ...next, y: next.y + top });
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
      // Clear of the header and toolbar floating over the board, where it would hide.
      const cover = chromeCoverOf(surfaceRef.current);
      return boardAddSpot(
        size,
        [...takenRects(), ...sections.map(({ rect }) => rect)],
        {
          ...within,
          y: within.y + cover.top / view.zoom,
          height: Math.max(0, within.height - (cover.top + cover.bottom) / view.zoom),
        },
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
      const touch = touchFirst();
      return boardCentreSpot(
        size,
        takenRects(),
        // On a touch screen the keyboard opens for it: it goes where the keyboard leaves in sight.
        touch
          ? boardTypingRect(view, area, chromeCoverOf(surfaceRef.current))
          : visibleBoardRect(view, {
              width: area.width,
              height: Math.max(area.height / 2, area.height - BOARD_TOOLBAR_BAND),
            }),
        touch,
      );
    }
    return boardAddSpot(size, takenRects(), within, section);
  };
  const newNote = (
    fields: Partial<Pick<RoomBoardNote, "kind" | "url" | "text" | "mark">>,
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
      ...(fields.mark === undefined ? {} : { mark: fields.mark }),
      ...(fields.kind !== undefined || noteColor === null ? {} : { color: noteColor }),
    });
    send({ kind: "note", id }, value);
    lastCard.current = noteRef(id);
    const size = boardNewNoteSize(fields.kind, fields.url);
    const rect = { x: value.x, y: value.y, width: size.w, height: size.h };
    if (touchFirst() && (fields.kind === undefined || fields.kind === "task"))
      revealForTyping(rect);
    else reveal(rect, true);
    return id;
  };
  // A note typed on a phone shows below the header, where its keyboard leaves the board in sight.
  const revealForTyping = (rect: BoardRect) => {
    const surface = surfaceRef.current;
    const area = boardAreaOf(surface);
    if (area === null) return;
    const cover = chromeCoverOf(surface);
    const typing = boardTypingRect(view, area, cover);
    const shifted = { ...view, y: view.y - cover.top };
    const next = panToShowAdded(shifted, rect, {
      width: area.width,
      height: typing.height * view.zoom,
    });
    if (next === shifted) return;
    setFollowing(null);
    setView({ ...next, y: next.y + cover.top });
  };
  const addCard = (fields: Pick<RoomBoardNote, "kind" | "url">, wanted?: BoardPoint) => {
    if (!canEdit || full) return null;
    return newNote(
      fields,
      wanted ?? freeSpot(fields.kind, boardNewNoteSize(fields.kind, fields.url)),
    );
  };
  // Draws the card added at once and puts the caret in its text, so what is typed next goes there
  // and never to the button that added it.
  const typeIn = (id: string) => {
    holdCaretIn(() => {
      const item = drawnItem(noteRef(id));
      // The text first: a task's checkbox comes before its text.
      return (
        item?.querySelector<HTMLElement>("textarea:not([data-box-prompt])") ??
        item?.querySelector<HTMLElement>("input:not([type=checkbox])") ??
        null
      );
    });
  };
  const addAndType = (add: () => string | null) => {
    const id = flushSync(add);
    if (id !== null) typeIn(id);
  };
  // A card the right-click menu added, whose text takes the caret once the menu has closed.
  const typeInAfterMenu = useRef<string | null>(null);
  const typeAfterMenu = useStableCallback((id: string | null) => {
    typeInAfterMenu.current = id;
  });
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
  /** Adds a tool's card at `at`, kept in the part of the view the floating chrome leaves; caret in it. */
  const addToolCard = (tool: ArmedCardTool, at: BoardPoint | null) => {
    const size =
      tool === "section"
        ? BOARD_SECTION_SIZE
        : boardNewNoteSize(tool === "task" ? "task" : undefined);
    // A tap means "here", over a card or not, so no taken rect dislodges it; the seen rect does.
    const wanted = at === null ? undefined : boardPointedSpot(size, at, seenRect(), []);
    addAndType(() =>
      tool === "section"
        ? addSection(undefined, wanted)
        : addCard(tool === "task" ? { kind: "task" } : {}, wanted),
    );
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
  // Copies land together and become the selection: pasted, clear of every card near `around`;
  // duplicated, a small step right and down from the originals, as in FigJam.
  const landCopies = (
    made: ReadonlyArray<{ readonly note: RoomBoardNote; readonly rect: BoardRect }>,
    around?: BoardPoint,
  ) => {
    const copies = made.slice(0, Math.max(0, ROOM_BOARD_MAX_NOTES - shown.notes.length));
    const bounds = boardBounds(copies.map(({ rect }) => rect));
    if (!canEdit || bounds === null) return;
    const offset =
      around === undefined
        ? boardDuplicateOffset(
            copies.map(({ rect }) => rect),
            takenRects(),
          )
        : null;
    const spot =
      offset !== null
        ? { x: bounds.x + offset.x, y: bounds.y + offset.y }
        : placeBoardItem({ w: bounds.width, h: bounds.height }, around ?? bounds, takenRects());
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
  /** A blank note of the same kind, paint and size just right of `note`, selected; null if none fits. */
  const addNextNote = (note: RoomBoardNote) => {
    const element = drawnItem(noteRef(note.id));
    if (!canEdit || full || !followsOn(note) || element === null) return null;
    const from = drawnRect(element);
    const size = note.size ?? boardNewNoteSize(note.kind);
    const id = randomUUID();
    const value = settleBoardValue({
      id,
      text: "",
      ...boardNextNoteSpot(from, size, takenRects()),
      ...(viewer === null ? {} : { guestId: viewer }),
      ...(note.kind === undefined ? {} : { kind: note.kind }),
      ...(note.size === undefined ? {} : { size: note.size }),
      ...(note.color === undefined ? {} : { color: note.color }),
    });
    send({ kind: "note", id }, value);
    lastCard.current = noteRef(id);
    setSelection(new Set([noteRef(id)]));
    reveal({ x: value.x, y: value.y, width: size.w, height: size.h }, true);
    return id;
  };
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
    rememberBoardCopy(text, copies);
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
  // The part of the board people see, clear of the header and toolbar floating over it.
  const seenRect = (): BoardRect => {
    const within = visibleBoardRect(
      view,
      boardAreaOf(surfaceRef.current) ?? { width: 0, height: 0 },
    );
    const cover = chromeCoverOf(surfaceRef.current);
    const height = within.height - (cover.top + cover.bottom) / view.zoom;
    return height < within.height / 2
      ? within
      : { ...within, y: within.y + cover.top / view.zoom, height };
  };
  /** Where something pasted or dropped lands: at the pointer when it points into view, else mid-view. */
  const pointedSpot = (size: RoomBoardSize, pointer: BoardPoint | null) =>
    boardPointedSpot(size, pointer, seenRect(), takenRects());
  /** A card just pasted or dropped becomes the selection, so the person sees what came in. */
  const selectAdded = (id: string | null) => {
    if (id === null) return;
    setSelection(new Set([noteRef(id)]));
    lastCard.current = noteRef(id);
  };
  /**
   * Puts what was copied on the board at `pointer` when it points into view, else mid-view, clear
   * of every card, and selects it; says whether it took it.
   */
  const pasteText = (text: string, pointer: BoardPoint | null): boolean => {
    if (!canEdit) return false;
    const own = boardCopyOf(text);
    if (own !== null) {
      const bounds = boardBounds(own.map(({ rect }) => rect));
      const spot =
        bounds === null ? null : pointedSpot({ w: bounds.width, h: bounds.height }, pointer);
      landCopies(
        boardPastedCopies(own, viewer, randomUUID),
        spot === null || bounds === null
          ? undefined
          : { x: spot.x + bounds.width / 2, y: spot.y + bounds.height / 2 },
      );
      return true;
    }
    const url = boardUrlIn(text);
    // A pull request pasted on a room's board shows itself, live, instead of as a plain link.
    const pullRequest =
      url === null || cards !== undefined || !holds.windows || pullRequestsFull
        ? null
        : roomPullRequestOf(url);
    if (pullRequest !== null) {
      selectAdded(
        addCard(
          { kind: "pull-request", url: pullRequest.url },
          pointedSpot(boardNewNoteSize("pull-request"), pointer),
        ),
      );
      return true;
    }
    if (url !== null) {
      selectAdded(addLink(url, pointedSpot(boardNewNoteSize("link", url), pointer)));
      return true;
    }
    if (text.trim() === "" || full) return false;
    selectAdded(
      newNote(
        { text: text.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH) },
        pointedSpot(boardNewNoteSize(undefined), pointer),
      ),
    );
    return true;
  };
  // Whether the pointer is over the board now: a paste after it left lands mid-view.
  const pointerOver = useRef(false);
  // N, T or S pressed with the pointer on the board adds the card under the pointer.
  const toolPoint = (atPointer: boolean | undefined) =>
    atPointer === true && pointerOver.current ? lastPointer.current : null;
  const pasteOnBoard = (event: ClipboardEvent<HTMLDivElement>) => {
    if (!isBoardKey(event.target)) return;
    const text = event.clipboardData.getData("text/plain");
    if (pasteText(text, pointerOver.current ? lastPointer.current : null)) event.preventDefault();
  };
  // A link dragged in from a browser tab or another app lands as a card where it is dropped. A
  // drop on a text field is that field's.
  const takesDrop = (event: DragEvent<HTMLDivElement>) =>
    canEdit &&
    !full &&
    isBoardKey(event.target) &&
    ["text/uri-list", "text/plain"].some((type) => event.dataTransfer.types.includes(type));
  const dragOverBoard = (event: DragEvent<HTMLDivElement>) => {
    if (!takesDrop(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };
  const dropOnBoard = (event: DragEvent<HTMLDivElement>) => {
    if (!takesDrop(event)) return;
    const listed = event.dataTransfer
      .getData("text/uri-list")
      .split(/\r?\n/)
      .find((line) => line.trim() !== "" && !line.startsWith("#"));
    const url = boardUrlIn(listed ?? event.dataTransfer.getData("text/plain"));
    const at = pointerOnBoard(event);
    if (url === null || at === null) return;
    event.preventDefault();
    selectAdded(addLink(url, pointedSpot(boardNewNoteSize("link", url), at)));
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
  /**
   * Lays these items out as Tidy does, most-voted first when `byVotes`, as one undo step. In a
   * section, the grid fills it from its top-left and the section grows to keep it inside.
   */
  const tidyItems = (
    chosen: ReadonlyArray<BoardSelected>,
    byVotes = false,
    section?: { readonly note: RoomBoardNote; readonly rect: BoardRect },
  ) => {
    if (!canEdit) return;
    const items = chosen.flatMap((item) => {
      const element = drawnItem(boardEditKey(item.target));
      return element === null
        ? []
        : [{ ...item, ref: boardEditKey(item.target), rect: drawnRect(element) }];
    });
    if (items.length < (section === undefined ? 2 : 1)) return;
    const order = byVotes
      ? (inOrder: ReadonlyArray<(typeof items)[number]>) =>
          boardByVotes(inOrder, ({ value }) => ("text" in value ? boardVoteCount(value) : 0))
      : undefined;
    const taken = () =>
      [
        ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
          "[data-board-item]:not([data-board-section])",
        ) ?? []),
      ].flatMap((element) =>
        items.some((item) => item.ref === element.dataset.boardItem) ? [] : [drawnRect(element)],
      );
    const laid =
      section === undefined
        ? { places: boardTidy(items, taken(), order), size: null }
        : boardTidySection(items, section.rect, order);
    for (const { ref, x, y } of laid.places) {
      const item = items.find((candidate) => candidate.ref === ref);
      if (item === undefined) continue;
      const now = "text" in item.value ? noteNow(item.value) : item.value;
      send(item.target, settleBoardValue({ ...now, x, y }));
    }
    if (
      section !== undefined &&
      laid.size !== null &&
      (laid.size.w > section.rect.width || laid.size.h > section.rect.height)
    ) {
      send(
        { kind: "note", id: section.note.id },
        settleBoardValue({ ...noteNow(section.note), size: laid.size }),
      );
      // What the grown section would cover moves down, in the same undo step.
      const self = noteRef(section.note.id);
      const others = [
        ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
          "[data-board-item]:not([data-board-pin])",
        ) ?? []),
      ].flatMap((element) => {
        const ref = element.dataset.boardItem ?? "";
        return ref === self || items.some((item) => item.ref === ref)
          ? []
          : [
              {
                ref,
                rect: drawnRect(element),
                section: element.hasAttribute("data-board-section"),
              },
            ];
      });
      const grown = { ...section.rect, width: laid.size.w, height: laid.size.h };
      const pushed = boardPushedBelow(section.rect, grown, others);
      for (const { target, value } of boardSelectionItems(shown, positions, pushed.refs)) {
        const now = "text" in value ? noteNow(value) : value;
        send(target, settleBoardValue({ ...now, y: now.y + pushed.dy }));
      }
    }
  };
  // The sections where the browser drew them, but those in `leaving`.
  const drawnSections = (leaving: ReadonlySet<string> = NO_SELECTION) =>
    shown.notes.flatMap((note) => {
      if (note.section !== true || leaving.has(noteRef(note.id))) return [];
      const element = drawnItem(noteRef(note.id));
      return element === null ? [] : [{ note, rect: drawnRect(element) }];
    });
  // A selection that sits wholly in one section is tidied inside it, not moved out of it.
  const sectionOfSelection = () =>
    boardSectionHolding(
      drawnSections(selected),
      selectedItems.flatMap((item) => {
        const element = drawnItem(boardEditKey(item.target));
        if (element === null) return [];
        const rect = drawnRect(element);
        return [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }];
      }),
    );
  const tidySelection = () => tidyItems(selectedItems, false, sectionOfSelection());
  const showChange = (note: RoomBoardNote) => {
    const ref = noteRef(note.id);
    const element = drawnItem(ref);
    if (note.kind === "comment") {
      setDraftComment(null);
      setOpenComment(note.id);
    } else {
      setSelection(new Set([ref]));
      lastCard.current = ref;
    }
    if (element !== null) reveal(drawnRect(element));
  };
  const sortSelectionByVotes = () => tidyItems(selectedItems, true, sectionOfSelection());
  // What sits over a section, as dragging it would carry, laid out inside it.
  const tidySection = (section: RoomBoardNote, byVotes = false) => {
    const key = noteRef(section.id);
    const element = drawnItem(key);
    if (element === null) return;
    const items = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-pin]):not([data-board-section])",
      ) ?? []),
    ].map((item) => ({ ref: item.dataset.boardItem ?? "", rect: drawnRect(item) }));
    const rect = drawnRect(element);
    tidyItems(
      boardSelectionItems(shown, positions, boardItemsCentredIn(items, rect, key)),
      byVotes,
      { note: section, rect },
    );
  };
  const sortSectionByVotes = (section: RoomBoardNote) => tidySection(section, true);
  const soleSection =
    selected.size === 1 ? selectedNotes.find((note) => note.section === true) : undefined;
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
    // It lands beside what it came from, and the view follows it there.
    const id = newNote(
      { kind, ...(url === undefined ? {} : { url }), ...(text === undefined ? {} : { text }) },
      besideBoardItem(drawnRect(element), boardNewNoteSize(kind), takenRects()),
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
  // A mark on an artifact's page: a note beside the card it was made on, with a line into the
  // artifact that card shows, so it goes with the next prompt of whoever rewrites it, as any card
  // with a line into an artifact does. A board edit: it sends nothing and starts nothing.
  const markArtifact = (
    on: RoomBoardNote,
    artifact: RoomBoardNote,
    mark: RoomBoardMark,
    words: string,
  ) => {
    const element = drawnItem(noteRef(on.id));
    if (!canEdit || element === null) return;
    if (full || edges.length >= ROOM_BOARD_MAX_EDGES) {
      toastManager.add({
        type: "info",
        title: "This board is full",
        description: "Remove a card or a line first, then mark the page again.",
      });
      return;
    }
    const id = newNote(
      { text: `${roomMarkWhere(mark)}\n${words}`.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH), mark },
      besideBoardItem(drawnRect(element), boardNewNoteSize(undefined), takenRects()),
    );
    const line = randomUUID();
    send(
      { kind: "edge", id: line },
      { id: line, from: noteRef(id), to: noteRef(artifact.id) },
      boardEditKey({ kind: "note", id }),
    );
  };
  // The spot each card a page's link opened starts scrolled to: this viewer's, for this visit.
  const [pageSpots, setPageSpots] = useState<ReadonlyMap<string, string>>(() => new Map());
  // What a link in an artifact's page leads to, in a card right of the card it was pressed in,
  // with a line to it and room made for it, as one undo step. Another site is a link card showing
  // its page, a spot on the page a live view opened there, any other address an empty artifact
  // for the page nobody made yet. A board edit: it sends nothing and starts nothing.
  const openLinkBeside = (on: RoomBoardNote, link: BoardPageLink) => {
    const from = noteRef(on.id);
    const element = drawnItem(from);
    if (!canEdit || element === null || link.kind === "tab" || link.kind === "other") return;
    const kind = link.kind === "site" ? "link" : "artifact";
    if (full || edges.length >= ROOM_BOARD_MAX_EDGES || (kind === "artifact" && artifactsFull)) {
      toastManager.add({
        type: "info",
        title: "This board is full",
        description: "Remove a card or a line first, then open the link again.",
      });
      return;
    }
    const rect = drawnRect(element);
    const url = link.kind === "site" ? link.url : undefined;
    const framed =
      framePage !== undefined && url !== undefined && boardCanFramePage(url, boardOwnHosts());
    // As big as the card it came from, but a link card that only names its address.
    const size =
      kind === "artifact" || framed ? clampBoardSize({ w: rect.width, h: rect.height }) : undefined;
    const taking = size ?? boardNewNoteSize(kind, url);
    // Never moved: another person's agent box or card, and a section that feeds one.
    const theirs = new Set(
      shown.notes
        .filter((note) => note.kind === "thread" && (note.guestId ?? null) !== viewer)
        .map((note) => noteRef(note.id)),
    );
    const mine =
      viewer === null
        ? [cardRef(ROOM_BOARD_THREAD_CARD)]
        : [cardRef(roomBoardGuestCard(viewer)), cardRef(roomBoardAgentCard(viewer))];
    const fixed = (ref: string) =>
      theirs.has(ref) ||
      (ref.startsWith("card:") && !mine.includes(ref)) ||
      edges.some((edge) => edge.from === ref && theirs.has(edge.to));
    const room = boardRoomBeside(
      rect,
      taking,
      [
        ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
          "[data-board-item]:not([data-board-pin])",
        ) ?? []),
      ].flatMap((item) => {
        const ref = item.dataset.boardItem ?? "";
        return ref === from
          ? []
          : [
              {
                ref,
                rect: drawnRect(item),
                section: item.hasAttribute("data-board-section"),
                fixed: fixed(ref),
              },
            ];
      }),
    );
    const at = room?.at ?? besideBoardItem(rect, taking, takenRects());
    const id = randomUUID();
    const added: RoomBoardNote = settleBoardValue({
      id,
      text: link.kind === "page" ? link.name : "",
      ...at,
      kind,
      ...(viewer === null ? {} : { guestId: viewer }),
      ...(url === undefined ? {} : { url }),
      ...(framed ? { framed: true as const } : {}),
      ...(size === undefined ? {} : { size }),
    });
    const to = noteRef(id);
    send({ kind: "note", id }, added);
    for (const { target, value } of boardSelectionItems(shown, positions, room?.refs ?? [])) {
      const now = "text" in value ? noteNow(value) : value;
      send(target, settleBoardValue({ ...now, x: now.x + (room?.dx ?? 0) }));
    }
    const line = randomUUID();
    send({ kind: "edge", id: line }, { id: line, from, to }, to);
    // Whoever opened it asked for its page, so it loads for them at once.
    if (framed) showEmbed(id);
    if (link.kind === "spot") {
      setPageSpots((spots) => new Map(spots).set(id, link.id));
      viewArtifactAlong(from, to, to, { ...shown, notes: [...shown.notes, added] });
    }
    lastCard.current = to;
    setEmbedInUse(null);
    reveal({ ...at, width: taking.w, height: taking.h }, true);
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
  // Asking an agent about the selection: the cards go along lines into a box, as drawn ones do,
  // so everyone sees what it was given. A selected artifact is the one the ask edits: the box gets
  // a line to it and the prompt names it, so the reply rewrites that artifact alone.
  const [asking, setAsking] = useState<BoardAsking | null>(null);
  const askAfterMenu = useRef(false);
  const askKey = viewKey ?? shareId ?? title;
  // Asking about a view asks about the artifact it shows.
  const askNotes = [
    ...new Set(
      selectedNotes
        .filter((note) => note.kind !== "thread" && note.section !== true)
        .map((note) => roomArtifactSource(shown, note.id) ?? note),
    ),
  ];
  const askCards = boardAskCards(askNotes, (note) => {
    const card = boardPromptCard(note, people, boardNoteQuote(note, messages));
    // A link goes with what its snapshot says, unless the snapshot is asked about too.
    return card === null
      ? null
      : {
          ...card,
          text: boardLinkTextWithSnapshot(shown, note, card.text, (ref) => selected.has(ref)),
        };
  });
  const askTargets =
    cards !== undefined || onPromptBox === undefined || !canEdit
      ? []
      : boardAskTargets(
          threadBoxes,
          viewer,
          cannotAddThread === null,
          (boxId) => shown.notes.find((note) => note.id === boxId)?.thread?.turns.at(-1)?.model,
        );
  const canAsk = (askCards.cards.length > 0 || askCards.artifact !== null) && askTargets.length > 0;
  // An ask whose cards went, or that this person may no longer send, closes and stays closed.
  if (asking !== null && !canAsk) setAsking(null);
  // With no agent of this person's here, Ask brings one first, with or without a selection.
  const openAsk = () => {
    if (bringAgent !== undefined) bringAgent();
    else if (canAsk) setAsking(newBoardAsking(selected));
  };
  // The artifact card's own way in: on that artifact alone, or, when it is selected, as the
  // selection's Ask with it first, since the first selected artifact is the one edited.
  const askAboutArtifact = (note: RoomBoardNote) => {
    if (bringAgent !== undefined) return bringAgent();
    const ref = noteRef(note.id);
    const refs = selected.has(ref) ? [ref, ...[...selected].filter((one) => one !== ref)] : [ref];
    setSelection(new Set(refs));
    lastCard.current = ref;
    setAsking(newBoardAsking(refs));
  };
  // It closes at once; a failure opens it again on the same cards, with what was typed.
  const sendAsk = (ask: BoardAsking, target: string, text: string) => {
    setAsking(null);
    void askAgent(target, text, ask).then((sent) => {
      if (sent) return;
      setSelection(new Set(ask.refs));
      setAsking({ ...ask, text, target, failed: true });
    });
  };
  // Where the cards asked about are drawn, kept inside the board, for the ask to sit beside.
  const askAnchor = (refs: ReadonlySet<string>) => {
    const area = surfaceRef.current?.getBoundingClientRect() ?? new DOMRect();
    const rects = [...refs].flatMap((ref) => drawnItem(ref)?.getBoundingClientRect() ?? []);
    if (rects.length === 0) return area;
    const left = Math.max(area.left, Math.min(...rects.map((rect) => rect.left)));
    const top = Math.max(area.top, Math.min(...rects.map((rect) => rect.top)));
    const right = Math.min(area.right, Math.max(...rects.map((rect) => rect.right)));
    const bottom = Math.min(area.bottom, Math.max(...rects.map((rect) => rect.bottom)));
    return new DOMRect(left, top, Math.max(0, right - left), Math.max(0, bottom - top));
  };
  const revealItem = useStableCallback((ref: string) => {
    const element = drawnItem(ref);
    if (element !== null) reveal(drawnRect(element));
  });
  const askAgent = async (
    target: string,
    text: string,
    ask: Pick<BoardAsking, "refs" | "newBoxId">,
  ): Promise<boolean> => {
    if (onPromptBox === undefined || onChange === undefined) return false;
    const made = target === BOARD_ASK_NEW_BOX;
    const boxId = made ? ask.newBoxId : target;
    const boxRef = boardBoxRef(boxId);
    // The box, its lines and then the prompt go in this order.
    const queue = made ? noteRef(boxId) : `ask:${boxId}`;
    const edited = askCards.artifact;
    const plan = boardAskLines(
      edges,
      askCards.cards.map((card) => card.ref),
      boxRef,
      ROOM_BOARD_MAX_EDGES,
      edited === null ? null : noteRef(edited.id),
    );
    const lines = plan.add.map((line) => ({ id: randomUUID(), ...line }));
    // Part of asking, which undo does not take back: the lines are marked sent once it goes.
    withFlag(unrecorded, () => {
      if (made) {
        const bounds = boardBounds(
          [...ask.refs].flatMap((ref) => {
            const element = drawnItem(ref);
            return element === null ? [] : [drawnRect(element)];
          }),
        );
        const size = boardNewNoteSize("thread");
        const at =
          (bounds === null ? undefined : boardBoxColumn(bounds, [bounds], size, takenRects())[0]) ??
          freeSpot("thread", size, false);
        send(
          { kind: "note", id: boxId },
          settleBoardValue({
            id: boxId,
            text: boardThreadBoxTitle(text),
            ...at,
            kind: "thread",
            ...(viewer === null ? {} : { guestId: viewer }),
          }),
          queue,
        );
      }
      for (const line of lines) send({ kind: "edge", id: line.id }, line, queue);
    });
    await queueChange(queue, () => Promise.resolve(true));
    const going = new Set(plan.going);
    // Else, as from the box's own prompt, the artifact the box already rewrites.
    const artifact = edited ?? (made ? null : (contexts.get(boxId)?.artifact ?? null));
    const sent = await onPromptBox(boxId, {
      text,
      cards: askCards.cards.filter((card) => going.has(card.ref)),
      artifactId: artifact?.id ?? null,
    }).catch(() => false);
    if (!sent) {
      withFlag(unrecorded, () => {
        for (const line of lines) send({ kind: "edge", id: line.id }, null, queue);
        if (made) send({ kind: "note", id: boxId }, null, queue);
      });
      return false;
    }
    rememberBoardAskTarget(askKey, boxId);
    revealItem(boxRef);
    return true;
  };
  // Running tasks with an agent: as with an ask, each task goes along a line into its box as a
  // card, first marked as run there so everyone sees which box has it; that box's next turn on the
  // board answers it. Only idle boxes are offered, so that next turn is the run's.
  const live = use(RoomLiveContext);
  const boxWaiting = (boxId: string) =>
    boardBoxRequests(room?.messages ?? NO_GUEST_MESSAGES, boxId).length > 0;
  // A task a box is on now: its box runs, or a request for that box waits on the owner.
  const taskBusy = (task: RoomBoardNote) =>
    task.run !== undefined &&
    task.done !== true &&
    (live.box(task.run.boxId) !== undefined || boxWaiting(task.run.boxId));
  const runTargets = boardRunTargets(askTargets, (boxId) => live.box(boxId) !== undefined);
  const runTasksOf = (notes: ReadonlyArray<RoomBoardNote>, busy = taskBusy) =>
    runTargets.length === 0 ? { tasks: [], left: 0 } : boardRunTasks(notes, viewer, busy);
  const selectionRun = runTasksOf(selectedNotes);
  const [runningTasks, setRunningTasks] = useState<BoardRunning | null>(null);
  const runAfterMenu = useRef(false);
  // Once open, it keeps the tasks it was opened on while they can still run.
  const runPlan = runTasksOf(
    runningTasks === null
      ? []
      : shown.notes.filter((note) => runningTasks.refs.has(noteRef(note.id))),
    () => false,
  );
  if (runningTasks !== null && runPlan.tasks.length === 0) setRunningTasks(null);
  const threadCount = shown.notes.filter((note) => note.kind === "thread").length;
  const boxesLeft =
    cannotAddThread === null
      ? Math.max(
          0,
          Math.min(ROOM_BOARD_MAX_THREADS - threadCount, ROOM_BOARD_MAX_NOTES - shown.notes.length),
        )
      : 0;
  const openRun = (notes: ReadonlyArray<RoomBoardNote>) => {
    const { tasks } = runTasksOf(notes);
    if (tasks.length === 0) return false;
    if (bringAgent !== undefined) {
      bringAgent();
      return true;
    }
    const refs = tasks.map((task) => noteRef(task.id));
    setSelection(new Set(refs));
    lastCard.current = refs[0] ?? null;
    setAsking(null);
    setRunningTasks(newBoardRunning(refs));
    return true;
  };
  // A section's open tasks: what sits over it, as Tidy takes it.
  const runSection = (section: RoomBoardNote) => {
    const element = drawnItem(noteRef(section.id));
    if (element === null) return;
    const items = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-pin]):not([data-board-section])",
      ) ?? []),
    ].map((item) => ({ ref: item.dataset.boardItem ?? "", rect: drawnRect(item) }));
    const refs = new Set(boardItemsCentredIn(items, drawnRect(element), noteRef(section.id)));
    if (!openRun(shown.notes.filter((note) => refs.has(noteRef(note.id))))) {
      setNotice("This section has no open tasks you can run.");
    }
  };
  type RunGroup = {
    readonly tasks: ReadonlyArray<RoomBoardNote>;
    readonly boxId: string;
    readonly at: BoardPoint | null;
  };
  // One box's share of a run: its box if new, the lines in, the tasks marked, then the prompt.
  // A prompt that does not go takes back all it added.
  const runGroup = async (group: RunGroup, modelOf: string | undefined): Promise<boolean> => {
    if (onPromptBox === undefined || onChange === undefined) return false;
    const queue = group.at === null ? `ask:${group.boxId}` : noteRef(group.boxId);
    const cards = group.tasks.flatMap((task) => boardPromptCard(task, people) ?? []);
    const plan = boardAskLines(
      edges,
      cards.map((card) => card.ref),
      boardBoxRef(group.boxId),
      ROOM_BOARD_MAX_EDGES,
    );
    const lines = plan.add.map((line) => ({ id: randomUUID(), ...line }));
    withFlag(unrecorded, () => {
      if (group.at !== null) {
        send(
          { kind: "note", id: group.boxId },
          settleBoardValue({
            id: group.boxId,
            text: boardThreadBoxTitle(group.tasks.map((task) => task.text).join("; ")),
            ...group.at,
            kind: "thread",
            ...(viewer === null ? {} : { guestId: viewer }),
          }),
          queue,
        );
      }
      for (const line of lines) send({ kind: "edge", id: line.id }, line, queue);
    });
    const mark = (task: RoomBoardNote, boxId: string | null) =>
      queueChange(queue, () => onChange({ type: "task.run", noteId: task.id, boxId }));
    const marked = await Promise.all(group.tasks.map((task) => mark(task, group.boxId)));
    // The task always goes in the prompt, with a line into the box or, on a full board, without.
    const sent =
      marked.every(Boolean) &&
      (await onPromptBox(group.boxId, {
        text: boardRunPrompt(group.tasks.length),
        cards,
        artifactId: null,
        modelOf,
      }).catch(() => false));
    if (sent) return true;
    for (const task of group.tasks) void mark(task, null);
    withFlag(unrecorded, () => {
      for (const line of lines) send({ kind: "edge", id: line.id }, null, queue);
      if (group.at !== null) send({ kind: "note", id: group.boxId }, null, queue);
    });
    return false;
  };
  // It closes at once; boxes run one after another, and what did not go opens it again.
  const runTasks = async (run: BoardRunning, mode: BoardRunMode, target: string) => {
    const tasks = runPlan.tasks;
    setRunningTasks(null);
    const size = boardNewNoteSize("thread");
    const drawn = tasks.map((task) => {
      const element = drawnItem(noteRef(task.id));
      return element === null ? null : drawnRect(element);
    });
    const bounds = boardBounds(drawn.filter((rect) => rect !== null));
    // New boxes go in one column right of the tasks, each level with its own task.
    const spots = (items: ReadonlyArray<BoardRect | null>): ReadonlyArray<BoardPoint> =>
      bounds === null
        ? items.map(() => freeSpot("thread", size, false))
        : boardBoxColumn(
            bounds,
            items.map((rect) => rect ?? bounds),
            size,
            takenRects(),
          );
    const eachAt = mode === "each" ? spots(drawn) : [];
    const groups: ReadonlyArray<RunGroup> =
      mode === "each"
        ? tasks.map((task, index) => ({
            tasks: [task],
            boxId: index === 0 ? run.newBoxId : randomUUID(),
            at: eachAt[index] ?? null,
          }))
        : [
            target === BOARD_ASK_NEW_BOX
              ? { tasks, boxId: run.newBoxId, at: spots([bounds])[0] ?? null }
              : { tasks, boxId: target, at: null },
          ];
    const failed: Array<RunGroup> = [];
    for (const group of groups) {
      // New boxes all run on the model picked for the first.
      if (!(await runGroup(group, group.at === null ? undefined : run.newBoxId))) {
        failed.push(group);
      }
    }
    if (mode === "one" && target !== BOARD_ASK_NEW_BOX) rememberBoardAskTarget(askKey, target);
    if (failed.length === 0) {
      const first = groups[0];
      if (first !== undefined) revealItem(boardBoxRef(first.boxId));
      return;
    }
    const refs = new Set(failed.flatMap((group) => group.tasks.map((task) => noteRef(task.id))));
    setSelection(refs);
    setRunningTasks({
      ...run,
      refs,
      mode,
      target,
      failed:
        groups.length === 1
          ? "Could not run it. Nothing was added to the board."
          : `Could not run ${failed.length} of ${groups.length}. Nothing was added for ${failed.length === 1 ? "it" : "them"}.`,
    });
  };
  // Brings an item into view if it is not, and puts the caret in its prompt box.
  const focusItem = (ref: string) => {
    const element = drawnItem(ref);
    if (element === null) return;
    reveal(drawnRect(element));
    element.querySelector<HTMLElement>("[data-box-prompt]")?.focus({ preventScroll: true });
  };
  useImperativeHandle(ownBoxHandle, () => () => {
    const id = flushSync(() => addCard({ kind: "thread" }, freeSpot("thread", undefined, false)));
    if (id === null) return null;
    const ref = noteRef(id);
    flushSync(() => setSelection(new Set([ref])));
    focusItem(ref);
    return id;
  });
  // The viewer's own boxes by name and model, to pick one from.
  const askTargetsFor = boardAskTargets(threadBoxes, viewer, false, (boxId) => {
    if (boxId === ROOM_BOARD_ROOM_BOX) return shown.roomBoxModel?.name ?? roomModel;
    const box = shown.notes.find((note) => note.id === boxId);
    return box?.boxModel?.name ?? box?.thread?.turns.at(-1)?.model;
  });
  // Which of the viewer's own boxes a draft for their agent goes to, asking when nothing says.
  const chooseDraftBox = (preferred: string | null, then: (boxId: string) => void) => {
    const own = threadBoxes
      .filter((box) => (box.guestId ?? null) === viewer)
      .map((box) => ({
        id: box.id,
        ranAt: shown.notes.find((note) => note.id === box.id)?.thread?.turns.at(-1)?.at,
      }));
    const choice = boardDraftBox(own, {
      selected: own.map((box) => box.id).filter((id) => selected.has(boardBoxRef(id))),
      preferred,
      lastUsed: lastBoardAskTarget(askKey),
    });
    if (choice === null) return false;
    const go = (boxId: string) => {
      rememberBoardAskTarget(askKey, boxId);
      then(boxId);
    };
    if ("boxId" in choice) go(choice.boxId);
    else setPickingBox({ ids: choice.pick, onPick: go });
    return true;
  };
  const bringIn = useBoardBringIn({
    board: shown,
    people,
    viewer,
    boxes: threadBoxes,
    canPrompt: onPromptBox !== undefined && cards === undefined && holds.agents && room !== null,
    canEdit,
    canAddArtifact: !full && !artifactsFull,
    canAddBox: cannotAddThread === null,
    bringAgent: cards === undefined && holds.agents ? bringAgent : undefined,
    addBeside: (ref, kind, title) => addBeside(ref, kind, "from", undefined, title),
    settle: (ref) => queueChange(ref, () => Promise.resolve(true)),
    prompt: (boxId, prompt) => onPromptBox?.(boxId, prompt) ?? Promise.resolve(false),
    focusBox: (boxId) => focusItem(boardBoxRef(boxId)),
    chooseBox: (preferred, then) => void chooseDraftBox(preferred, then),
  });
  const fitAll = () => {
    const area = boardAreaOf(surfaceRef.current);
    if (area === null) return;
    setFollowing(null);
    setView(fitBoardOnSurface(drawnRects(), area, chromeCoverOf(surfaceRef.current), FIT_MARGIN));
  };
  const showCards = (noteIds: ReadonlyArray<string>) => {
    const refs = noteIds.map(noteRef).filter((ref) => drawnItem(ref) !== null);
    if (refs.length === 0) return;
    setSelection(new Set(refs));
    const rects = refs.flatMap((ref) => {
      const element = drawnItem(ref);
      return element === null ? [] : [drawnRect(element)];
    });
    const area = boardAreaOf(surfaceRef.current);
    const bounds = boardBounds(rects);
    if (area === null || bounds === null) return;
    // Pans when they fit in view as it is, else zooms out to show them all.
    if (
      bounds.width * view.zoom <= area.width - FIT_MARGIN * 2 &&
      bounds.height * view.zoom <= area.height - FIT_MARGIN * 2
    ) {
      reveal(bounds);
      return;
    }
    setFollowing(null);
    setView(fitBoardOnSurface(rects, area, chromeCoverOf(surfaceRef.current), FIT_MARGIN));
  };
  // Stable, as a toast's Show keeps it after the view has moved on.
  const showBox = useStableCallback((boxId: string) => {
    const ref = boardBoxRef(boxId);
    const element = drawnItem(ref);
    if (element === null) return;
    setSelection(new Set([ref]));
    lastCard.current = ref;
    reveal(drawnRect(element));
  });
  const boxOnScreen = useStableCallback((boxId: string) => {
    const drawn = drawnItem(boardBoxRef(boxId))?.getBoundingClientRect();
    const area = surfaceRef.current?.getBoundingClientRect();
    return (
      drawn !== undefined &&
      area !== undefined &&
      drawn.right > area.left &&
      drawn.left < area.right &&
      drawn.bottom > area.top &&
      drawn.top < area.bottom
    );
  });
  const attachAgentOf = (note: RoomBoardNote) => {
    if (note.kind !== "artifact" || cards !== undefined || !holds.agents || room === null) {
      return undefined;
    }
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
          : holds.room
            ? "Adds a thread box of yours beside this artifact. What you prompt it runs on your own agent, on your machine, or asks the owner's agent when yours is not connected. Its replies rewrite the artifact for everyone."
            : "Adds a thread box of yours beside this artifact. What you prompt it runs on your own agent, on your machine. Its replies rewrite the artifact for everyone.",
      run: bringAgent ?? (() => addBeside(noteRef(note.id), "thread", "to")),
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
  const addLink = (url: string, wanted?: BoardPoint) => {
    const id = addCard({ kind: "link", url }, wanted);
    const from = boardEmbedTitleUrl(url);
    // A video's real title, read by this person's browser from its source's public oEmbed (the
    // server never fetches it), names the card unless someone named it first.
    if (id !== null && from !== null) {
      void fetch(from, { credentials: "omit", referrerPolicy: "no-referrer" })
        .then((response) => (response.ok ? response.json() : null))
        .then((answer: unknown) => {
          const title = boardEmbedTitleOf(answer);
          if (title !== null) nameLink(id, title);
        })
        .catch(() => undefined);
    }
    return id;
  };
  // A URL pasted in an empty note makes that note a link card.
  const pasteLinkInto = (note: RoomBoardNote, url: string) => {
    send({ kind: "note", id: note.id }, null);
    addLink(url, { x: note.x, y: note.y });
  };
  // A menu hands its trigger the focus back as it closes, after the field mounted, so a
  // frame on the field takes it; preventScroll keeps the page where the bar left it.
  const linkFieldRef = useRef<HTMLInputElement | null>(null);
  const linkField = useStableCallback((element: HTMLInputElement | null) => {
    linkFieldRef.current = element;
    if (element === null) return;
    window.requestAnimationFrame(() => element.focus({ preventScroll: true }));
  });
  // While the link bar is open, keys typed with focus on the board or the page are the bar's:
  // a letter goes into its field, never to a board shortcut, and Escape closes it.
  const linkBarKey = useStableCallback((event: KeyboardEvent) => {
    const field = linkFieldRef.current;
    const focus = document.activeElement;
    if (field === null || (focus !== surfaceRef.current && focus !== document.body)) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      setLinkDraft(null);
      return;
    }
    if (event.key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) return;
    // Focus moved during keydown takes the typed character, as the key is not prevented.
    event.stopPropagation();
    field.focus({ preventScroll: true });
  });
  const linkBarOpen = linkDraft !== null;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- keys pressed while focus rests on the page reach only the window, before the board's own key handlers
  useEffect(() => {
    if (!linkBarOpen) return;
    window.addEventListener("keydown", linkBarKey, true);
    return () => window.removeEventListener("keydown", linkBarKey, true);
  }, [linkBarOpen, linkBarKey]);
  const startLinkDraft = () => {
    setDraftKind("link");
    setLinkDraft("");
  };
  const startPullRequest = () => {
    setDraftKind("pull-request");
    setLinkDraft("");
  };
  const submitLinkDraft = (andBringIn = false) => {
    const url = linkDraft === null ? null : draftUrl(linkDraft);
    if (url === null) return;
    if (andBringIn && draftKind === "link") {
      const id = flushSync(() => {
        setLinkDraft(null);
        return addLink(url);
      });
      if (id !== null) bringIn.bringInOf({ id, kind: "link", url, text: "", x: 0, y: 0 })?.run?.();
      return;
    }
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

  /**
   * The card or note under a point a line from `from` may end on, if any: a section by its title
   * or near its edge, as its middle is the board's and its cards'.
   */
  const linkTargetAt = (x: number, y: number, from: string | null) => {
    const hit = document
      .elementsFromPoint(x, y)
      .find(
        (each): each is HTMLElement =>
          each instanceof HTMLElement &&
          !each.hasAttribute("data-board-section-body") &&
          each.closest("[data-board-item]") !== null,
      );
    const at = hit === undefined ? pointerOnBoard({ clientX: x, clientY: y }) : null;
    const frame =
      at === null
        ? null
        : boardSectionFrameAt(drawnSections(), at, LINK_FRAME_BAND / view.zoom)?.note;
    const element =
      hit?.closest<HTMLElement>("[data-board-item]") ??
      (frame === undefined || frame === null ? null : drawnItem(noteRef(frame.id)));
    const ref = element?.dataset.boardItem;
    return element === null || ref === undefined || ref === from ? null : { ref, element };
  };
  // While drawing, the line snaps to the card under the pointer, as it will land there.
  const drawLinkTo = (event: { readonly clientX: number; readonly clientY: number }) => {
    const at = pointerOnBoard(event);
    if (linking === null || at === null) return;
    const target = linkTargetAt(event.clientX, event.clientY, linking.from);
    markLinkTarget(target?.element ?? null);
    const box = (target === null ? undefined : boxes.get(target.ref)) ?? {
      ...at,
      width: 0,
      height: 0,
    };
    linkPath.current?.setAttribute(
      "d",
      boardLine(lastBoardLineShape(lineBoard), linking.box, box).path,
    );
  };
  // A new line into an empty artifact makes it a live view of the artifact at its start, once the
  // line is on the board. A board edit only, and not an undo step: "Stop following" is its way
  // out. A board held by an older server refuses it, and the card stays empty as it was.
  const viewArtifactAlong = (from: string, to: string, queue: string, on = shown) => {
    if (onChange === undefined) return;
    const boxId = roomBoxIdOfRef(on, from);
    const fromNoteId = boardArtifactViewSource(
      on,
      from,
      to,
      boxId === undefined ? undefined : contexts.get(boxId)?.artifact?.id,
    );
    const noteId = roomBoardNoteOfRef(on, to)?.id;
    if (fromNoteId === null || noteId === undefined) return;
    void queueChange(queue, () => onChange({ type: "artifact.view", noteId, fromNoteId }));
  };
  /** A box's "New artifact": a second one opens as a live view of the one the box rewrites. */
  const addBoxArtifact = (from: string) => {
    const id = addBeside(from, "artifact", "from");
    if (id === null) return;
    const added: RoomBoardNote = { id, text: "", x: 0, y: 0, kind: "artifact" };
    const to = noteRef(id);
    viewArtifactAlong(from, to, to, { ...shown, notes: [...shown.notes, added] });
  };
  /** Draws a line between two cards, unless one is there or the board holds no more. */
  const addEdge = (from: string, to: string) => {
    if (to === from || edges.length >= ROOM_BOARD_MAX_EDGES) return;
    if (edges.some((edge) => edge.from === from && edge.to === to)) return;
    const id = randomUUID();
    const elbow = lastBoardLineShape(lineBoard) === "elbow";
    const line = { id, from, to, ...(elbow ? { shape: "elbow" as const } : {}) };
    send({ kind: "edge", id }, line);
    viewArtifactAlong(from, to, boardChangeQueueKey(shown, { kind: "edge", id }, line));
  };
  const startLink = (from: string, event: PointerEvent<HTMLElement>) => {
    const box = boxes.get(from);
    const at = pointerOnBoard(event);
    if (box === undefined || at === null || !canEdit) return;
    event.stopPropagation();
    holdPointer(event);
    setSelectedEdge(null);
    setLinking({
      from,
      box,
      to: at,
      press: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
    });
  };
  type LinkPointer = Pick<globalThis.PointerEvent, "clientX" | "clientY" | "pointerId" | "type">;
  const moveLink = useStableCallback((event: LinkPointer) => {
    if (linking?.pointerId === event.pointerId) drawLinkTo(event);
  });
  const endLink = useStableCallback((event: LinkPointer) => {
    if (linking === null || linking.pointerId !== event.pointerId) return;
    dropHeldPointer();
    const { from, press } = linking;
    stopLinking();
    if (event.type === "pointercancel") return;
    // A grip sits on the end of any line drawn from it, so a click there is the line's.
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) < CLICK_SLOP) {
      setSelectedEdge(edgeAt(event.clientX, event.clientY));
      return;
    }
    const to = linkTargetAt(event.clientX, event.clientY, from);
    if (to !== null) addEdge(from, to.ref);
  });
  // A line drawn from a grip follows its pointer anywhere: over other cards, off the grip after
  // a fast flick, and where the browser could not capture it, such as a scripted drag.
  const linkPointer = linking?.pointerId;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens on the window for the pointer a grip drag holds, wherever it goes, until it lets go
  useEffect(() => {
    if (linkPointer === undefined) return;
    window.addEventListener("pointermove", moveLink, true);
    window.addEventListener("pointerup", endLink, true);
    window.addEventListener("pointercancel", endLink, true);
    return () => {
      window.removeEventListener("pointermove", moveLink, true);
      window.removeEventListener("pointerup", endLink, true);
      window.removeEventListener("pointercancel", endLink, true);
    };
  }, [linkPointer, moveLink, endLink]);
  /** With the Line tool: a click picks the card a line starts from, the next the one it ends on. */
  const pickLineEnd = (event: MouseEvent<HTMLElement>) => {
    const target = linkTargetAt(event.clientX, event.clientY, linking?.from ?? null);
    const at = pointerOnBoard(event);
    if (target === null || at === null || !canEdit) {
      stopLinking();
      setLineTool(false);
      return;
    }
    if (linking === null) {
      const box = boxes.get(target.ref);
      if (box === undefined) return;
      markLinkTarget(null);
      setLinking({ from: target.ref, box, to: at, press: { x: event.clientX, y: event.clientY } });
      return;
    }
    addEdge(linking.from, target.ref);
    stopLinking();
    setLineTool(false);
    surfaceRef.current?.focus({ preventScroll: true });
  };
  const startLineTool = () => {
    stopLinking();
    setPlacingComment(false);
    setArmedTool(null);
    setLineTool((on) => !on);
    surfaceRef.current?.focus({ preventScroll: true });
  };
  const link = canEdit ? { onStart: startLink } : undefined;

  const closeComment = () => {
    setOpenComment(null);
    setDraftComment(null);
  };
  const startComment = () => {
    closeComment();
    setLineTool(false);
    stopLinking();
    setArmedTool(null);
    setPlacingComment((placing) => !placing);
    // Escape on the board stops placing.
    surfaceRef.current?.focus({ preventScroll: true });
  };
  // A card tool clicked waits for a click on the board; picked with a key, nothing points, so its
  // card is added at once where it fits.
  const pickCardTool = (tool: ArmedCardTool, event: MouseEvent<HTMLElement>) => {
    if (event.detail === 0) return addToolCard(tool, null);
    closeComment();
    setLineTool(false);
    stopLinking();
    setPlacingComment(false);
    setArmedTool((armed) => (armed === tool ? null : tool));
    surfaceRef.current?.focus({ preventScroll: true });
  };
  const placeToolCard = (event: MouseEvent<HTMLElement>) => {
    setArmedTool(null);
    const at = pointerOnBoard(event);
    if (armedTool !== null && at !== null) addToolCard(armedTool, at);
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
    dragBy({ kind: "note", id: note.id }, note, dx, dy, false);
  const dropPin = (note: RoomBoardNote) => release(() => letGo({ kind: "note", id: note.id }));
  const togglePin = (note: RoomBoardNote) => {
    setDraftComment(null);
    setOpenComment((open) => (open === note.id ? null : note.id));
  };
  const changeComment = (noteId: string, change: RoomBoardChange) =>
    onChange === undefined
      ? Promise.resolve(false)
      : queueChange(noteRef(noteId), () => onChange(change));
  const sendComment = (
    note: RoomBoardNote,
    text: string,
    mentions: ReadonlyArray<RoomBoardMention> = [],
  ) => {
    const named = mentions.length === 0 ? {} : { mentions };
    if (note.id !== draftNote?.id) {
      return changeComment(note.id, {
        type: "comment.reply",
        noteId: note.id,
        replyId: randomUUID(),
        text,
        ...named,
      });
    }
    send({ kind: "note", id: note.id }, settleBoardValue({ ...note, text, ...named }));
    const to = boardCommentLineTo(shown, draftComment?.on ?? null);
    if (to !== null) {
      const line = randomUUID();
      // Part of starting the thread, which undo does not take back.
      withFlag(unrecorded, () => {
        send(
          { kind: "edge", id: line },
          { id: line, from: noteRef(note.id), to },
          boardEditKey({ kind: "note", id: note.id }),
        );
      });
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
        onSend={(text, mentions) => sendComment(openNote, text, mentions)}
        onAsk={(boxId, text) => askInComment(openNote, boxId, text)}
        onRemoveReply={(replyId) =>
          void changeComment(openNote.id, {
            type: "comment.reply.remove",
            noteId: openNote.id,
            replyId,
          })
        }
        onReact={
          reactTo === undefined || openNote === draftNote
            ? undefined
            : (replyId, emoji) =>
                void changeComment(openNote.id, {
                  type: "note.react",
                  noteId: openNote.id,
                  emoji,
                  ...(replyId === undefined ? {} : { replyId }),
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
  // Deleting takes effect at once, since Undo, or the toast's, puts it back. What Undo cannot put
  // back, as a thread box's conversation, asks first.
  // The comment threads on a deleted card go with it, and the same undo brings them back.
  const withCommentsOn = (noteIds: ReadonlyArray<string>) => [
    ...noteIds,
    ...boardCommentsOn(shown, noteIds, (id) => drawnItem(noteRef(id))?.offsetHeight).filter(
      (id) => {
        const comment = shown.notes.find((note) => note.id === id);
        return comment !== undefined && isRoomCardOwnedBy(comment, viewer);
      },
    ),
  ];
  const removeNotes = (chosen: ReadonlyArray<string>) => {
    const noteIds = withCommentsOn(chosen);
    const { edgeIds } = boardDeletion(shown, noteIds);
    for (const id of edgeIds) send({ kind: "edge", id }, null);
    for (const id of noteIds) send({ kind: "note", id }, null);
    const steps = batch.current;
    if (steps === null) return;
    const toast = toastManager.add({
      type: "info",
      title: chosen.length === 1 ? "Deleted" : `Deleted ${chosen.length}`,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toastManager.close(toast);
          undoDeletion(steps);
        },
      },
    });
  };
  const deleteNow = (noteIds: ReadonlyArray<string>) => {
    if (boardDeletion(shown, withCommentsOn(noteIds)).undoable) removeNotes(noteIds);
    else setConfirmingDelete(noteIds);
  };
  // A section with cards over it asks whether they go with it; they stay unless chosen.
  const deleteNotes = (noteIds: ReadonlyArray<string>) => {
    if (noteIds.length === 0) return;
    const items = [
      ...(surfaceRef.current?.querySelectorAll<HTMLElement>(
        "[data-board-item]:not([data-board-pin]):not([data-board-section])",
      ) ?? []),
    ].map((item) => ({ ref: item.dataset.boardItem ?? "", rect: drawnRect(item) }));
    const over = drawnSections().flatMap(({ note, rect }) =>
      noteIds.includes(note.id) ? boardItemsCentredIn(items, rect, noteRef(note.id)) : [],
    );
    const cardIds = boardSectionCardsToDelete(shown, noteIds, over, viewer);
    if (cardIds.length === 0) deleteNow(noteIds);
    else setDeletingSection({ noteIds, cardIds });
  };
  // A box's chat stays where it is unless its owner, asked, deletes it too.
  const deletingBoxes = shown.notes.filter(
    (note) => note.kind === "thread" && confirmingDelete?.includes(note.id) === true,
  );
  const boxChats = deletingBoxes.flatMap((box) => boxChatDeleter?.(box.id) ?? []);
  // Plain notes go without asking, except the done ones someone clears away together.
  const deletingDoneNotes =
    confirmingDelete?.every(
      (id) => shown.notes.find((note) => note.id === id)?.kind === undefined,
    ) === true;
  // What is someone else's stays on the board, and selected; what goes leaves the selection with
  // it, and comes back selected with an undo.
  const deleteSelection = () => {
    deleteNotes(removal.noteIds);
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
  const shapeEdge = (edge: RoomBoardEdge, shape: BoardLineShape) => {
    rememberBoardLineShape(lineBoard, shape);
    if ((edge.shape ?? "curve") === shape) return;
    const { shape: _shape, ...rest } = edge;
    send({ kind: "edge", id: edge.id }, shape === "elbow" ? { ...rest, shape } : rest);
  };
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
    const task = note.kind === "task";
    const take = task ? takeOf(note) : undefined;
    const assignTo = (assignee: RoomBoardAssignee | undefined) =>
      changeNote(note, ({ assignee: _assignee, ...rest }) =>
        assignee === undefined ? rest : { ...rest, assignee },
      );
    return {
      assign:
        task && canEdit
          ? [
              { label: "No one", run: () => assignTo(undefined) },
              ...(ownerAssignable ? [{}] : []).map((owner) => ({
                label: boardPersonName(people, undefined),
                run: () => assignTo(owner),
              })),
              ...guests.map((guest) => ({
                label: boardPersonName(people, guest.id),
                run: () => assignTo({ guestId: guest.id }),
              })),
            ]
          : undefined,
      onReact: section || reactTo === undefined ? undefined : (emoji) => reactTo(note, emoji),
      color:
        plain && pickColor !== undefined
          ? {
              value: note.color,
              section,
              onPick: section
                ? (color) => changeNote(note, (current) => ({ ...current, color }))
                : (color) => pickColor(note, color),
            }
          : undefined,
      actions: [
        ...(section && canEdit ? [{ label: "Tidy", run: () => tidySection(note) }] : []),
        ...(section && runTargets.length > 0
          ? [{ label: "Run this section's tasks", run: () => runSection(note) }]
          : []),
        ...(reactTo === undefined
          ? []
          : section
            ? [{ label: "Sort by votes", run: () => sortSectionByVotes(note) }]
            : boardVotable(note)
              ? [
                  {
                    label: boardVotedBy(note, viewer) ? "Remove my vote" : "Vote",
                    run: () => voteOn([note]),
                  },
                ]
              : []),
        ...(take === undefined ? [] : [{ label: "Take it to my agent", run: take }]),
        ...(task && canRunBoardTask(note, viewer) && runTargets.length > 0 && !taskBusy(note)
          ? [{ label: "Run with an agent", run: () => void openRun([note]) }]
          : []),
        ...(use === undefined ? [] : [{ label: "Use as message", run: use }]),
        ...(give === undefined ? [] : [{ label: "Give to my agent", run: give }]),
        ...(framePage !== undefined &&
        note.kind === "link" &&
        boardCanFramePage(note.url, boardOwnHosts())
          ? [
              {
                label: note.framed === true ? "Hide page" : "Show page here",
                run: () => framePage(note, note.framed !== true),
              },
            ]
          : []),
        ...(note.kind === "artifact" ? removeDoneAction(artifactNotes(note)) : []),
        ...(canDelete
          ? [
              {
                label: section ? "Delete section" : plain ? "Delete note" : "Delete card",
                run: () => deleteNotes([note.id]),
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
  const followAction = (guest: { readonly id: GuestId; readonly name: string }) =>
    online.includes(guest.id) && guest.id !== viewer
      ? [{ label: `Follow ${guest.name}`, run: () => follow.onFollow(guest.id) }]
      : [];
  const fixedCardActions = (ref: string): ReadonlyArray<CardAction> => {
    const box = threadBoxes.find((candidate) => boardBoxRef(candidate.id) === ref);
    const guest = guestCards.find((one) => cardRef(guestCardId(one)) === ref);
    const agent = agents.find((one) => cardRef(agentCardId(one.guest)) === ref);
    const workingOn = agent?.running?.artifactId ?? agent?.running?.taskId;
    const workedOn = workingOn === undefined ? null : drawnItem(noteRef(workingOn));
    return [
      ...(box === undefined ? [] : boxMenuActions(box)),
      ...(ref === cardRef(ROOM_BOARD_THREAD_CARD)
        ? [{ label: "Open thread", run: onOpenThread }]
        : []),
      ...(guest === undefined ? [] : followAction(guest)),
      ...(workingOn === undefined || workedOn === null
        ? []
        : [
            {
              label: "Show what it's working on",
              run: () => {
                setSelection(new Set([noteRef(workingOn)]));
                reveal(drawnRect(workedOn));
              },
            },
          ]),
      ...(agent === undefined ? [] : followAction(agent.guest)),
    ];
  };
  /** Opens the right-click menu at a point on screen, for the card there, which it selects. */
  const openMenu = (x: number, y: number, ref: string | null) => {
    const note = menuNoteOf(ref)?.id;
    const on = note !== undefined ? noteRef(note) : isFixedCard(ref) ? ref : null;
    if (on !== null && !selected.has(on)) {
      setSelection(new Set([on]));
      lastCard.current = on;
    }
    setSelectedEdge(null);
    const at = pointerOnBoard({ clientX: x, clientY: y }) ?? viewCentre();
    setContextMenu({
      x,
      y,
      at,
      ref: on,
      section: on === null ? boardSectionHolding(drawnSections(), [at])?.note.id : undefined,
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
        marksStart: canEdit && (marksStart ?? viewer === null),
      },
    );
    const near = (kind: RoomBoardNote["kind"]) =>
      placeBoardItem(boardNewNoteSize(kind), at, takenRects());
    const runs: Record<BoardMenuEntry, CardAction> = {
      "add-note": {
        label: "Add note",
        shortcut: "N",
        run: () => typeAfterMenu(noteAt(at, "", true)),
      },
      "add-task": {
        label: "Add task",
        shortcut: "T",
        run: () => typeAfterMenu(addCard({ kind: "task" }, near("task"))),
      },
      "add-section": {
        label: "Add section",
        shortcut: "S",
        run: () =>
          typeAfterMenu(addSection(undefined, { x: Math.round(at.x), y: Math.round(at.y) })),
      },
      "add-link": {
        label: "Add link here",
        run: () => {
          // A link on the clipboard lands at once; else the link field opens.
          void readTextFromClipboard().then(
            (text) => {
              const url = boardUrlIn(text);
              if (url === null) startLinkDraft();
              else selectAdded(addLink(url, near("link")));
            },
            () => startLinkDraft(),
          );
        },
      },
      edit: {
        label: "Edit text",
        shortcut: "Enter",
        run: () => {
          if (ref === null) return;
          // Once the menu has closed, so focus stays in the text.
          window.requestAnimationFrame(() =>
            drawnItem(ref)
              ?.querySelector<HTMLElement>(
                'textarea[data-board-rest=""]:not([readonly]), input:not([type=checkbox]):not([readonly])',
              )
              ?.focus({ preventScroll: true }),
          );
        },
      },
      connect: {
        label: "Connect to…",
        shortcut: "L",
        run: () => {
          const box = ref === null ? undefined : boxes.get(ref);
          if (ref === null || box === undefined || cannotAddLine !== null) return;
          setPlacingComment(false);
          setLineTool(true);
          setLinking({
            from: ref,
            box,
            to: { x: box.x + box.width, y: box.y + box.height / 2 },
            press: { x: contextMenu.x, y: contextMenu.y },
          });
        },
      },
      "add-thread": {
        label: "Add thread box",
        run: bringAgent ?? (() => typeAfterMenu(addCard({ kind: "thread" }, near("thread")))),
      },
      "add-artifact": {
        label: "Add artifact",
        run: () => typeAfterMenu(addCard({ kind: "artifact" }, near("artifact"))),
      },
      paste: {
        label: "Paste",
        run: () =>
          void readTextFromClipboard().then(
            (text) => pasteText(text, at),
            () => undefined,
          ),
      },
      "select-all": {
        label: "Select all",
        shortcut: boardKeyLabel({ key: "A", mod: true }, isMacPlatform(navigator.platform)),
        run: () => setSelection(new Set(selectableRefs())),
      },
      fit: {
        label: "Fit to view",
        shortcut: boardKeyLabel({ key: "1", shift: true }, isMacPlatform(navigator.platform)),
        run: fitAll,
      },
      duplicate: {
        label: "Duplicate",
        shortcut: boardKeyLabel({ key: "D", mod: true }, isMacPlatform(navigator.platform)),
        run: duplicateSelection,
      },
      copy: {
        label: "Copy",
        shortcut: boardKeyLabel({ key: "C", mod: true }, isMacPlatform(navigator.platform)),
        run: () => {
          const text = copyCards();
          if (text !== null) void writeTextToClipboard(text).catch(() => undefined);
        },
      },
      "start-here": {
        label:
          note !== undefined && shown.start === note.id
            ? "Stop starting new visitors here"
            : "Start here for new visitors",
        run: () => {
          if (note === undefined) return;
          onChange?.({ type: "board.start", noteId: shown.start === note.id ? null : note.id });
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
      "sort-votes": { label: "Sort by votes", run: sortSelectionByVotes },
      vote: {
        label: boardVoteToggles(selectedNotes, viewer).every((one) => boardVotedBy(one, viewer))
          ? "Remove my votes"
          : "Vote",
        run: () => voteOn(selectedNotes),
      },
      group: {
        label: "Group in a section",
        shortcut: boardKeyLabel({ key: "G", mod: true }, isMacPlatform(navigator.platform)),
        run: groupInSection,
      },
      delete: { label: "Delete", shortcut: "Delete", run: deleteSelection },
    };
    const pick = (...wanted: ReadonlyArray<BoardMenuEntry>) =>
      entries.filter((entry) => wanted.includes(entry)).map((entry) => runs[entry]);
    const box =
      several || ref === null
        ? undefined
        : threadBoxes.find((candidate) => boardBoxRef(candidate.id) === ref);
    const boxEntries = box === undefined ? [] : boxMenuActions(box);
    // Empty space in a section offers the section's own actions beside the board's.
    const menuNote =
      ref === null
        ? shown.notes.find((one) => one.section === true && one.id === contextMenu.section)
        : note;
    const own = several || menuNote === undefined ? undefined : noteMenu(menuNote);
    const card: CardMenu | undefined =
      own !== undefined
        ? { ...own, actions: [...boxEntries, ...own.actions] }
        : fixed && ref !== null
          ? { actions: fixedCardActions(ref) }
          : undefined;
    return {
      card:
        card === undefined
          ? undefined
          : { ...card, actions: card.actions.filter((action) => action.destructive !== true) },
      groups: [
        pick("edit", "connect"),
        pick("add-note", "add-task", "add-section", "add-link", "add-thread", "add-artifact"),
        // The ask and the run open once the menu has closed, so it does not take their focus back.
        [
          ...(ref !== null && canAsk
            ? [
                {
                  label: "Ask an agent…",
                  run: () => {
                    askAfterMenu.current = true;
                  },
                },
              ]
            : []),
          ...(ref !== null && selectionRun.tasks.length > 0
            ? [
                {
                  label: "Run with an agent…",
                  run: () => {
                    runAfterMenu.current = true;
                  },
                },
              ]
            : []),
        ],
        pick("vote", "paste", "duplicate", "copy", "copy-link"),
        pick("tidy", "sort-votes", "group", "select-all", "fit"),
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
    // A box with several keeps a version in each: a reply rewrites the one its prompt box names.
    const canAddArtifact = canEdit && !full && !artifactsFull && context !== undefined;
    // Offered once per box; a box's changes show in each window it has a line to.
    const canAddCode =
      machineTools &&
      canEdit &&
      !full &&
      !codeFull &&
      roomBoxCodeWindows(shown, box.id).length === 0;
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
  // Clears away the notes an agent is done with; it asks first, and one Undo brings them back.
  const removeDoneAction = (
    notes: ReturnType<typeof boardConnectedNotes>,
  ): ReadonlyArray<CardAction> => {
    const done = canEdit ? boardDoneNoteIds(notes, viewer) : [];
    return done.length === 0
      ? []
      : [
          {
            label: done.length === 1 ? "Remove 1 done note" : `Remove ${done.length} done notes`,
            run: () => setConfirmingDelete(done),
            destructive: true,
          },
        ];
  };
  /** A thread box's actions as entries of its right-click menu. */
  const boxMenuActions = (box: BoardThreadBox): ReadonlyArray<CardAction> => {
    const { from, artifact, code, pullRequest, conversation } = boxActions(box);
    return [
      ...removeDoneAction(connectedNotes([box.id])),
      ...(artifact ? [{ label: "New artifact", run: () => addBoxArtifact(from) }] : []),
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
    const work = shown.agentTurns?.findLast((turn) => turn.boxId === box.id);
    const prompt =
      onPromptBox === undefined || context === undefined || !own ? undefined : (
        <BoardPromptBox
          cards={context.cards}
          artifact={
            context.artifact === null
              ? null
              : { id: context.artifact.id, title: context.artifact.text }
          }
          artifacts={context.artifacts.map((artifact) => ({
            id: artifact.id,
            title: artifact.text,
            updatedAt: artifact.artifact?.updatedAt,
          }))}
          onPickArtifact={(artifactId) =>
            setReplyCards((current) => keepReplyCards({ ...current, [box.id]: artifactId }))
          }
          label={box.title === "" ? "Prompt this thread" : `Prompt ${box.title}`}
          placeholder={box.guestId === undefined ? "Ask your agent" : guestBoxPlaceholder}
          model={renderBoxModel?.(box.id)}
          onPrompt={(prompt) => {
            rememberBoardAskTarget(askKey, box.id);
            return onPromptBox(box.id, prompt);
          }}
          onPin={canEdit && onChange !== undefined ? pinPromptCard : undefined}
          summary={boardNotesSummary(connectedNotes([box.id]))}
          draft={bringIn.draftFor(box.id)}
        />
      );
    const body = (
      <>
        {tail}
        <BoxProgress
          boxId={box.id}
          fallback={fallback}
          approval={renderBoxApproval?.(box.id)}
          onStop={stopBox?.(box.id)}
          ended={boxRunEnd?.(box.id)?.outcome}
        />
        {work === undefined ? null : (
          <BoxBoardWork
            turn={work}
            onShow={() => showCards(work.cards.map((card) => card.id))}
            onUndo={agentTurnUndo(work)}
          />
        )}
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
                onClick={() => addBoxArtifact(actions.from)}
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
  const roomBox = threadBoxes.find((box) => box.id === ROOM_BOARD_ROOM_BOX);
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
  // Every thread box as the Agents panel lists it; their runs it reads from the live store.
  const agentEntries = threadBoxes.map((box): BoardAgentEntry => {
    const note = shown.notes.find((candidate) => candidate.id === box.id);
    const turn = note?.thread?.turns.at(-1);
    const work = shown.agentTurns?.findLast((candidate) => candidate.boxId === box.id);
    const workLine = work === undefined || work.undone === true ? "" : boardAgentTurnLine(work);
    const isRoom = box.id === ROOM_BOARD_ROOM_BOX;
    const picked = note?.boxModel;
    return {
      id: box.id,
      name: box.title || "Untitled thread",
      whose: boardPersonName(people, box.guestId),
      color: boardCursorColor(guests, box.guestId),
      model: isRoom
        ? (roomModel ?? work?.model)
        : boardAgentModel([
            turn,
            work,
            picked === undefined ? undefined : { model: picked.name, at: picked.at },
          ]),
      end: boxRunEnd?.(box.id),
      work: workLine === "" ? undefined : workLine,
      tasks: boardAgentRunTasks(shown.notes, box.id),
      stop: stopBox?.(box.id),
      requests: boardBoxRequests(room?.messages ?? NO_GUEST_MESSAGES, box.id),
      canResolve: onResolveRequest !== undefined,
      answered: (isRoom ? messages.length > 0 : turn !== undefined) || work !== undefined,
      activity: boardAgentActivity([turn?.at, work?.at]),
      turnKey: `${isRoom ? (messages.at(-1)?.id ?? "") : (turn?.id ?? "")}|${work?.id ?? ""}|${work?.at ?? ""}`,
      offline: boxOffline(box),
      offlineOwn:
        !boxOffline(box) || box.guestId !== viewer ? undefined : ownAgentAway ? "away" : "absent",
      fallback:
        !isRoom || hasProgress
          ? undefined
          : needsApproval
            ? "approval"
            : agentWorking
              ? "working"
              : undefined,
    };
  });

  const agentRecent = boardAgentRecentTurns(shown.agentTurns ?? NO_AGENT_TURNS).map(
    ({ turn, line }): BoardAgentRecent => {
      const box = threadBoxes.find((candidate) => candidate.id === turn.boxId);
      return {
        id: turn.id,
        name: box === undefined ? "Removed thread" : box.title || "Untitled thread",
        color: boardCursorColor(guests, box?.guestId ?? turn.guestId),
        line,
        at: turn.at,
        undone: turn.undone === true,
        onShow: () => showCards(turn.cards.map((card) => card.id)),
        onUndo: agentTurnUndo(turn),
      };
    },
  );

  const edgeArea = drawingArea([...boxes.values()]);
  const lineSlots = boardLineSlots(
    edges.flatMap((edge) => {
      const from = boxes.get(edge.from);
      const to = boxes.get(edge.to);
      return from === undefined || to === undefined
        ? []
        : [{ id: edge.id, fromRef: edge.from, toRef: edge.to, from, to }];
    }),
  );
  // What an elbow line goes around: every card but the sections and comment pins it may cross.
  const lineObstacles: ReadonlyArray<BoardLineObstacle> = edges.some(
    (edge) => edge.shape === "elbow",
  )
    ? shown.notes
        .filter((note) => note.section !== true && note.kind !== "comment")
        .map((note) => noteRef(note.id))
        .concat(Object.keys(positions).map(cardRef))
        .flatMap((ref) => {
          const box = boxes.get(ref);
          return box === undefined ? [] : [{ ref, ...box }];
        })
    : [];
  // Marker ids land in `url(#…)`, which takes no colons.
  // The person colour of whoever owns the card a line starts from: the agent that rewrites.
  const lineColor = (ref: string) =>
    boardCursorColor(guests, shown.notes.find((note) => noteRef(note.id) === ref)?.guestId);
  const markerId = `board-arrow${useId().replace(/[^\w-]/g, "")}`;
  // The Plan is the same tasks as the board's: a team's relay may not keep their status yet.
  const plannable = cards === undefined && room !== null;
  const planShown = plannable && pickedView !== "board";
  // A selection belongs to the view it was made in: switching views lets go of it.
  const switchView = (next: BoardViewMode) => {
    setSelection(NO_SELECTION);
    setSelectedEdge(null);
    pickView(next);
  };
  const planColumns = planShown ? boardPlanColumns(shown.notes) : null;
  const planAttachments = planShown ? boardPlanAttachments(shown) : null;
  // A task an inbox item opened in the Plan.
  // Each new stamp opens a new task to write in the Plan, as the command menu asks.
  const [planAdd, setPlanAdd] = useState(0);
  const [planTask, setPlanTask] = useState<{ readonly id: string; readonly stamp: number } | null>(
    null,
  );
  const showFocus = (focus: BoardFocus) => {
    const roomBox = focus.noteId === ROOM_BOARD_ROOM_BOX;
    if (!roomBox && !shown.notes.some((note) => note.id === focus.noteId)) return room !== null;
    if (roomBox) {
      if (planShown) {
        pickView("board");
        return false;
      }
      // The room thread's own box is a card, not a note: a board without one lets the ask go.
      if (drawnItem(boardBoxRef(focus.noteId)) === null) return room !== null;
      showBox(focus.noteId);
      return true;
    }
    if (focus.plan && plannable) {
      if (!planShown) pickView("plan");
      setPlanTask({ id: focus.noteId, stamp: focus.stamp });
      return true;
    }
    if (planShown) {
      pickView("board");
      return false;
    }
    if (drawnItem(noteRef(focus.noteId)) === null) return false;
    showCards([focus.noteId]);
    return true;
  };
  useBoardFocusRequest(shareId, showFocus);
  // The owner's own board is asked by its view key: a board list knows no share id for it.
  useBoardFocusRequest(viewKey, showFocus);
  const placeTasks = (
    placements: ReadonlyArray<{ id: string; status: RoomTaskStatus; order: number }>,
  ) => {
    for (const placement of placements) {
      const note = shown.notes.find((candidate) => candidate.id === placement.id);
      if (note === undefined) continue;
      changeNote(note, (current) => ({
        ...boardPlanWithStatus(current, placement.status),
        order: placement.order,
      }));
    }
  };
  // Where each task this person moved to Done was before, so unticking it takes it back there.
  const rememberUndone = (placements: ReadonlyArray<{ id: string; status: RoomTaskStatus }>) => {
    for (const placement of placements) {
      const note = shown.notes.find((candidate) => candidate.id === placement.id);
      if (note === undefined || placement.status !== "done" || note.done === true) continue;
      beforeDone.current.set(note.id, { status: roomTaskStatus(note), order: note.order });
    }
  };
  const movePlanTask = (taskId: string, to: RoomTaskStatus, index: number) => {
    if (!canEdit || planColumns === null) return;
    const placements = boardPlanMove(planColumns, taskId, to, index);
    rememberUndone(placements);
    placeTasks(placements);
  };
  const movePlanTasks = (taskIds: ReadonlySet<string>, to: RoomTaskStatus) => {
    if (!canEdit || planColumns === null) return;
    const placements = boardPlanMoveAll(planColumns, taskIds, to);
    rememberUndone(placements);
    placeTasks(placements);
  };
  const addPlanTask = (status: RoomTaskStatus, text: string) => {
    if (!canEdit || full || planColumns === null) return;
    const { order, placements } = boardPlanAppendOrder(planColumns[status]);
    placeTasks(placements);
    const id = randomUUID();
    const { grow, ...at } = boardPlanTaskPlace(shown, [...cardIds, ...upcomingCardIds], (note) =>
      drawnHeights.get(noteRef(note.id)),
    );
    // The section it lands in grows first, so it never shows the task over its edge.
    const frame = grow === undefined ? undefined : shown.notes.find((note) => note.id === grow.id);
    if (frame !== undefined && grow !== undefined) {
      changeNote(frame, (current) => ({ ...current, size: grow.size }));
    }
    send(
      { kind: "note", id },
      settleBoardValue({
        ...boardPlanWithStatus(
          {
            id,
            text: text.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH),
            ...at,
            kind: "task",
            ...(viewer === null ? {} : { guestId: viewer }),
          },
          status,
        ),
        order,
      }),
    );
  };
  const showOnBoard = (task: RoomBoardNote) => {
    pickView("board");
    showCards([task.id]);
  };
  const planBox = (task: RoomBoardNote) => {
    const boxId = task.run?.boxId ?? planAttachments?.get(task.id)?.boxIds[0];
    if (boxId === undefined) return undefined;
    const box = threadBoxes.find((candidate) => candidate.id === boxId);
    return {
      id: boxId,
      name: box === undefined ? "Thread box" : box.title || boardBoxName(box, people),
      color: boardCursorColor(guests, box?.guestId),
    };
  };
  const planActions = (task: RoomBoardNote) => {
    const take = takeOf(task);
    return {
      onShow: () => showOnBoard(task),
      onRun:
        canRunBoardTask(task, viewer) && runTargets.length > 0 && !taskBusy(task)
          ? () => {
              showOnBoard(task);
              openRun([task]);
            }
          : undefined,
      onTake: take,
      onDelete:
        canEdit && isRoomCardOwnedBy(task, viewer) ? () => deleteNotes([task.id]) : undefined,
    };
  };
  const canAddOwnBox =
    cards === undefined && holds.agents && bringAgent === undefined && cannotAddThread === null;
  // The guide's steps, stable so a pan or a drag does not render the guide again. The invite link
  // and Share live in the header the host gives the board.
  // Only a control that is drawn: a narrow board folds some away, and a popover opened from a
  // hidden button would have nowhere to open from.
  const inviteFromGuide = useStableCallback(() => {
    const control = (selector: string) =>
      [...(surfaceRef.current?.parentElement?.querySelectorAll<HTMLElement>(selector) ?? [])].find(
        (element) => element.getClientRects().length > 0,
      ) ?? null;
    (
      control("[data-cloud-board-invite]") ??
      control("[data-board-share], [data-cloud-board-people]") ??
      control("[data-board-share-more]")
    )?.click();
  });
  const noteFromGuide = useStableCallback((event: MouseEvent<HTMLElement>) =>
    pickCardTool("note", event),
  );
  const lineFromGuide = useStableCallback(startLineTool);
  const power = useBoardPower({
    surfaceRef,
    onBoard: !planShown,
    viewOnly,
    onShowGuide: canEdit
      ? () => {
          if (planShown) pickView("board");
          showBoardGuide();
        }
      : undefined,
    onAddTaskInPlan:
      planShown && canEdit && cannotAdd === null
        ? () => setPlanAdd((stamp) => stamp + 1)
        : undefined,
    title,
    board: shown,
    people,
    followable: guests
      .filter((guest) => guest.id !== viewer && online.includes(guest.id))
      .map((guest) => ({ id: guest.id, name: boardPersonName(people, guest.id) })),
    onFollow: follow.onFollow,
    zoom: view.zoom,
    selection: selected,
    onSelect: setSelection,
    onShowCard: (ref) => {
      setSelection(new Set([ref]));
      lastCard.current = ref;
      const element = drawnItem(ref);
      if (element !== null) reveal(drawnRect(element));
    },
    ...(cannotAdd === null && !viewOnly
      ? {
          onAddNote: (atPointer?: boolean) => addToolCard("note", toolPoint(atPointer)),
          onAddTask: (atPointer?: boolean) => addToolCard("task", toolPoint(atPointer)),
          onAddSection:
            cards === undefined
              ? (atPointer?: boolean) => addToolCard("section", toolPoint(atPointer))
              : undefined,
          onAddLink: (url: string | null) =>
            url === null ? startLinkDraft() : selectAdded(addLink(url)),
        }
      : {}),
    onAddAgentBox:
      cards === undefined && holds.agents && !viewOnly
        ? (bringAgent ??
          (cannotAddThread === null
            ? () => addAndType(() => addCard({ kind: "thread" }))
            : undefined))
        : undefined,
    onLineTool: cannotAddLine === null && !viewOnly ? startLineTool : undefined,
    onSelectTool: () => {
      stopLinking();
      setLineTool(false);
      setPlacingComment(false);
    },
    onFit: fitAll,
    onZoomBy: zoomBy,
    onPanBy: (dx, dy) => {
      setFollowing(null);
      setView((current) => panBoardBy(current, dx, dy));
    },
    onGroup: cannotAdd === null && cards === undefined ? groupInSection : undefined,
    onSelectAll: canEdit ? () => setSelection(new Set(selectableRefs())) : undefined,
    onUndo: canEdit ? () => travel("undo") : undefined,
    onRedo: canEdit ? () => travel("redo") : undefined,
    view: planShown ? pickedView : "board",
    onView: plannable ? switchView : undefined,
    chooseOwnBox: (then) => chooseDraftBox(null, (boxId) => then(boardBoxRef(boxId))),
    onAddOwnBox: canAddOwnBox
      ? () => {
          const id = flushSync(() =>
            addCard({ kind: "thread" }, freeSpot("thread", undefined, false)),
          );
          return id === null ? null : noteRef(id);
        }
      : undefined,
    onBringAgent: cards === undefined && !viewOnly ? bringAgent : undefined,
    onToggleChat,
  });

  return (
    <div className="@container/board flex min-h-0 min-w-0 flex-1 flex-col overflow-clip overscroll-none">
      {/* The board fills this below its header; the tools, zoom and minimap float over the canvas. */}
      <div
        className={cn(
          "group/room relative flex min-h-0 flex-1 flex-col",
          planShown && "bg-background",
        )}
      >
        {power.overlay}
        {/* One bar above the canvas and the Plan alike: the board's name, its views, its people. */}
        <header
          data-board-chrome="top"
          className={cn(
            // One row where it fits; a narrow board puts the views on a row of their own.
            "relative z-30 flex h-14 shrink-0 items-center gap-3 border-b border-board-hairline bg-background pr-3 pl-4 @3xl/board:pr-4 @3xl/board:pl-5",
            "@max-xl/board:h-auto @max-xl/board:flex-wrap @max-xl/board:gap-x-2 @max-xl/board:gap-y-2 @max-xl/board:py-2 @max-xl/board:pl-2",
            COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS,
          )}
        >
          <div className="flex min-w-0 flex-1 basis-0 items-center gap-1">
            <Button size="sm" variant="ghost" onClick={onBack ?? onOpenThread}>
              <ArrowLeftIcon />
              <ToolLabel>{backLabel}</ToolLabel>
            </Button>
            <span aria-hidden className="me-1.5 h-4 w-px shrink-0 bg-board-hairline" />
            <h1 className="min-w-0 truncate text-ui-md font-semibold text-foreground">
              {titleEditor ?? title}
              {sharing === undefined ? (
                <span className="ms-2 text-ui-sm font-normal text-muted-foreground">
                  {room === null ? "Not shared" : (summary ?? roomSummary(room, online.length))}
                </span>
              ) : null}
            </h1>
            {power.menu}
          </div>
          {plannable ? (
            <div className="flex shrink-0 justify-center @max-xl/board:order-last @max-xl/board:basis-full">
              <BoardViewSwitch view={planShown ? pickedView : "board"} onView={switchView} />
            </div>
          ) : null}
          {/* Passing states sit under the header's right end, never squeezing the title. */}
          <div className="absolute end-3 top-full mt-3 flex flex-col items-end gap-2">
            {firstView === null || view !== firstView || planShown ? null : (
              <BoardFloat className="gap-2 py-1 ps-3 pe-1 text-xs" data-board-first-view>
                Showing where to start
                <Button size="xs" variant="outline" onClick={() => thenBoard(fitAll)}>
                  Fit all
                </Button>
              </BoardFloat>
            )}
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
          </div>
          <div
            className="flex min-w-0 flex-1 basis-0 items-center justify-end gap-2 @max-xl/board:flex-none"
            // Copying the invite link, from here or from the guide, is the guide's invite step.
            onClickCapture={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("[data-cloud-board-invite]") !== null
              ) {
                markBoardGuideStep("invite");
              }
            }}
          >
            {cards !== undefined || room === null ? null : (
              <BoardAgents
                entries={agentEntries}
                viewer={viewer}
                open={agentsOpen}
                onOpenChange={setAgentsOpen}
                onShow={(boxId) => {
                  if (planShown) pickView("board");
                  showBox(boxId);
                }}
                onShowTask={(noteId) => {
                  if (planShown) pickView("board");
                  showCards([noteId]);
                }}
                isOnScreen={boxOnScreen}
                hasThreadBoxes={threadBoxes.some((box) => box.id !== ROOM_BOARD_ROOM_BOX)}
                cloud={!holds.agents}
                viewing={viewOnly}
                bringAgent={bringAgent}
                takeAgentAway={takeAgentAway}
                recent={agentRecent}
                renderNeeds={(entry, need) =>
                  need === "approval" ? (
                    (renderBoxApproval?.(entry.id) ?? null)
                  ) : (
                    <BoxRequests
                      requests={entry.requests}
                      board={shown}
                      people={people}
                      onResolve={onResolveRequest}
                      resolving={resolvingRequests}
                      model={renderRequestModel?.(entry.id)}
                    />
                  )
                }
              />
            )}
            {sharing === undefined ? null : sharingFolds ? (
              <div className="flex min-w-0 items-center gap-2 @max-xl/board:gap-1">{sharing}</div>
            ) : (
              <>
                <div className="flex min-w-0 items-center gap-2 @max-xl/board:hidden">
                  {sharing}
                </div>
                <div className="flex @xl/board:hidden">
                  <Popover>
                    <PopoverTrigger
                      render={
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Share and people"
                          data-board-share-more
                        />
                      }
                    >
                      <EllipsisIcon />
                    </PopoverTrigger>
                    <PopoverPopup side="bottom" align="end" sideOffset={8}>
                      <div className="flex flex-wrap items-center gap-1.5">{sharing}</div>
                    </PopoverPopup>
                  </Popover>
                </div>
              </>
            )}
          </div>
        </header>
        {/* Someone who can only look gets no tools at all, not hidden ones. */}
        {viewOnly ? null : (
          <div
            data-board-chrome="rail"
            inert={planShown}
            className={cn(
              // A rail down the board's left, centred between the header and the zoom corner. A
              // narrow board lays it along the bottom instead, as a phone's thumb expects.
              "pointer-events-none absolute top-[4.375rem] bottom-[8.75rem] left-3.5 z-30 flex items-center",
              "@max-xl/board:inset-x-3 @max-xl/board:top-auto @max-xl/board:bottom-3 @max-xl/board:justify-center",
              planShown && "invisible",
            )}
          >
            {/* Tighter on the narrowest phones, so the last tool stays inside it. */}
            <BoardFloat
              className={cn(
                "pointer-events-auto max-h-full max-w-full gap-0.5 overflow-y-auto rounded-2xl p-1.5 @max-xl/board:flex-row @max-xl/board:overflow-x-auto @max-xl/board:overflow-y-visible @max-sm/board:gap-0 @max-sm/board:px-0.5",
                linkDraft === null && "flex-col",
              )}
            >
              {linkDraft === null ? (
                <>
                  <WhyNot reason={cannotAdd}>
                    <BoardTool
                      label="Note"
                      hint="Sticky note: click the board to place it"
                      variant={armedTool === "note" ? "default" : "ghost"}
                      aria-pressed={armedTool === "note"}
                      disabled={cannotAdd !== null}
                      onClick={(event) => pickCardTool("note", event)}
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
                      variant={armedTool === "task" ? "default" : "ghost"}
                      aria-pressed={armedTool === "task"}
                      disabled={cannotAdd !== null}
                      onClick={(event) => pickCardTool("task", event)}
                    >
                      <ListTodoIcon />
                    </BoardTool>
                  </WhyNot>
                  {cards === undefined ? (
                    <span className="contents @max-xl/board:hidden">
                      <WhyNot reason={cannotAdd}>
                        <BoardTool
                          label="Section"
                          variant={armedTool === "section" ? "default" : "ghost"}
                          aria-pressed={armedTool === "section"}
                          disabled={cannotAdd !== null}
                          onClick={(event) => pickCardTool("section", event)}
                        >
                          <SquareDashedIcon />
                        </BoardTool>
                      </WhyNot>
                    </span>
                  ) : null}
                  <span className="contents @max-xl/board:hidden">
                    <WhyNot reason={cannotAdd}>
                      <BoardTool
                        label="Link"
                        disabled={cannotAdd !== null}
                        onClick={startLinkDraft}
                      >
                        <LinkIcon />
                      </BoardTool>
                    </WhyNot>
                  </span>
                  {cards !== undefined ? null : <BoardToolDivider />}
                  {cards !== undefined || !holds.agents ? null : onAddThread === undefined ? (
                    <WhyNot reason={cannotAddThread}>
                      <BoardTool
                        label="Thread"
                        hint="Thread box: an agent the room can prompt"
                        disabled={cannotAddThread !== null}
                        onClick={
                          bringAgent ?? (() => addAndType(() => addCard({ kind: "thread" })))
                        }
                      >
                        <BotIcon />
                      </BoardTool>
                    </WhyNot>
                  ) : (
                    <Menu>
                      <WhyNot reason={cannotAddThread}>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <MenuTrigger
                                disabled={cannotAddThread !== null}
                                render={<Button size="icon" variant="ghost" aria-label="Thread" />}
                              />
                            }
                          >
                            <BotIcon />
                            <ChevronDownIcon className="absolute end-0.5 bottom-0.5 size-2.5 opacity-60" />
                          </TooltipTrigger>
                          <TooltipPopup side="right">
                            Thread box: an agent the room can prompt
                          </TooltipPopup>
                        </Tooltip>
                      </WhyNot>
                      {/* The new box's name field keeps the caret it took. */}
                      <MenuPopup
                        align="start"
                        finalFocus={() => isBoardKey(document.activeElement)}
                      >
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
                  {machineToolsShown ? (
                    <span className="contents @max-xl/board:hidden">
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
                    </span>
                  ) : null}
                  {machineToolsShown ? (
                    <span className="contents @max-xl/board:hidden">
                      <WhyNot reason={cannotAddPullRequest}>
                        <BoardTool
                          label="Pull request"
                          hint="Shows a GitHub pull request to the room, kept up to date by the board owner's GitHub sign-in."
                          disabled={cannotAddPullRequest !== null}
                          onClick={startPullRequest}
                        >
                          <PullRequestGlyph.pullRequest />
                        </BoardTool>
                      </WhyNot>
                    </span>
                  ) : null}
                  {cards !== undefined ? null : <BoardToolDivider />}
                  <WhyNot reason={cannotAddLine}>
                    <BoardTool
                      label="Line"
                      hint="Draw a line: click a card, then another. Or drag from the dot on any side of a card."
                      variant={lineTool ? "default" : "ghost"}
                      aria-pressed={lineTool}
                      disabled={cannotAddLine !== null}
                      onClick={startLineTool}
                    >
                      <SplineIcon />
                    </BoardTool>
                  </WhyNot>
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
                  {cards === undefined && resolvedComments > 0 ? (
                    // Only while something is resolved; a narrow board keeps it in More.
                    <span className="flex @max-xl/board:hidden">
                      <Button
                        size="sm"
                        variant={showResolved ? "secondary" : "ghost"}
                        aria-pressed={showResolved}
                        onClick={() => thenBoard(() => setShowResolved((shown) => !shown))}
                      >
                        <CircleCheckIcon />
                        <ResolvedCount count={resolvedComments} />
                      </Button>
                    </span>
                  ) : null}
                  <span className="contents @xl/board:hidden">
                    <Menu>
                      <MenuTrigger
                        render={<BoardAgentsMoreButton entries={agentEntries} viewer={viewer} />}
                      >
                        <EllipsisIcon />
                      </MenuTrigger>
                      <MenuPopup side="top" align="end">
                        {cards === undefined ? (
                          <MenuItem
                            disabled={cannotAdd !== null}
                            onClick={() => addAndType(() => addSection())}
                          >
                            <SquareDashedIcon />
                            Section
                          </MenuItem>
                        ) : null}
                        <MenuItem disabled={cannotAdd !== null} onClick={startLinkDraft}>
                          <LinkIcon />
                          Link
                        </MenuItem>
                        {machineToolsShown ? (
                          <MenuItem
                            disabled={cannotAddCode !== null}
                            onClick={() => addAndType(() => addCard({ kind: "code" }))}
                          >
                            <CodeXmlIcon />
                            Code window
                          </MenuItem>
                        ) : null}
                        {machineToolsShown ? (
                          <MenuItem
                            disabled={cannotAddPullRequest !== null}
                            onClick={startPullRequest}
                          >
                            <PullRequestGlyph.pullRequest />
                            Pull request
                          </MenuItem>
                        ) : null}
                        {cards === undefined && resolvedComments > 0 ? (
                          <MenuItem
                            onClick={() => thenBoard(() => setShowResolved((shown) => !shown))}
                          >
                            <CircleCheckIcon />
                            {showResolved
                              ? "Hide resolved comments"
                              : `Show resolved comments (${resolvedComments})`}
                          </MenuItem>
                        ) : null}
                        {cards === undefined && room !== null ? (
                          <MenuItem onClick={() => setAgentsOpen(true)}>
                            <BotIcon />
                            Agents
                            <BoardAgentsNeedsBadge entries={agentEntries} viewer={viewer} />
                          </MenuItem>
                        ) : null}
                      </MenuPopup>
                    </Menu>
                  </span>
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
                    ref={linkField}
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
                  {draftKind === "link" && cards === undefined && holds.agents ? (
                    <WhatItDoes hint="Adds the link and writes a prompt in your thread box asking your agent to read it onto the board. Nothing runs until you press Send.">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={draftUrl(linkDraft) === null}
                        onClick={() => submitLinkDraft(true)}
                      >
                        Add and bring in
                      </Button>
                    </WhatItDoes>
                  ) : null}
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
                side="right"
                canUndo={
                  canEdit &&
                  (history.undo.length > 0 ||
                    boardAgentTurnToUndo(shown, viewer, undefined) !== undefined)
                }
                canRedo={canEdit && history.redo.length > 0}
                onUndo={() => thenBoard(() => travel("undo"))}
                onRedo={() => thenBoard(() => travel("redo"))}
              />
            </BoardFloat>
          </div>
        )}
        <div
          data-board-corner
          inert={planShown}
          className={cn(
            // Below the rail; above the bottom bar of a narrow board, and in its corner when the
            // board has no tools to lay along the bottom.
            "absolute bottom-3.5 left-3.5 z-30 flex flex-col items-start gap-2",
            !viewOnly && "@max-xl/board:bottom-16 @max-xl/board:left-3",
            planShown && "invisible",
          )}
        >
          {catchUp.away.length === 0 ? null : (
            <CatchUpPill
              changes={catchUp.changes}
              away={catchUp.away}
              onShow={showChange}
              onShowCards={showCards}
              onDismiss={catchUp.dismiss}
            />
          )}
          <div className="flex items-end gap-2.5">
            {minimapShown ? (
              // A selection docked above the toolbar would sit under it.
              <div className="group-has-[[data-selection-docked]]/room:hidden">
                <BoardMinimap
                  board={shown}
                  cardIds={cardIds}
                  view={view}
                  surfaceRef={surfaceRef}
                  onView={(next) => {
                    setFollowing(null);
                    setView(next);
                  }}
                />
              </div>
            ) : null}
            <BoardFloat data-board-chrome="bottom" className="h-9 gap-0.5 rounded-full px-1">
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Zoom out"
                onClick={() => thenBoard(() => zoomBy(1 / 1.2))}
              >
                <MinusIcon />
              </Button>
              <span className="w-10 text-center text-xs font-semibold text-foreground tabular-nums">
                {Math.round(view.zoom * 100)}%
              </span>
              <Button
                size="icon-xs"
                variant="ghost"
                aria-label="Zoom in"
                onClick={() => thenBoard(() => zoomBy(1.2))}
              >
                <PlusIcon />
              </Button>
              <span aria-hidden className="mx-1 h-4 w-px shrink-0 bg-board-hairline" />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
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
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant={minimapShown ? "secondary" : "ghost"}
                      aria-label="Minimap"
                      aria-pressed={minimapShown}
                      onClick={() => thenBoard(toggleMinimap)}
                    />
                  }
                >
                  <MapIcon />
                </TooltipTrigger>
                <TooltipPopup side="top">
                  {minimapShown ? "Hide minimap" : "Show minimap"}
                </TooltipPopup>
              </Tooltip>
              {cards === undefined && room !== null ? <LineLegend /> : null}
            </BoardFloat>
          </div>
        </div>
        <BoardGuide
          canEdit={canEdit && !viewOnly}
          canInvite={sharing !== undefined && (marksStart ?? viewer === null)}
          othersJoined={guests.some((guest) => guest.id !== viewer)}
          agent={
            cards !== undefined || !holds.agents
              ? "none"
              : bringAgent !== undefined
                ? "absent"
                : takeAgentAway !== undefined
                  ? "here"
                  : "none"
          }
          hidden={planShown}
          noteColor={noteColor ?? undefined}
          onNote={cannotAdd === null ? noteFromGuide : undefined}
          onLine={cannotAddLine === null ? lineFromGuide : undefined}
          onInvite={inviteFromGuide}
          onAgent={bringAgent}
        />
        <div
          ref={surfaceRef}
          role="application"
          aria-label="Room board"
          // Focusable so a link pasted on the board lands as a card. Clipped, not hidden, so
          // focusing a card at the edge cannot scroll the board out from under the pointer.
          tabIndex={0}
          className={cn(
            "group/board relative min-h-0 flex-1 cursor-grab touch-none overflow-clip bg-board-canvas outline-none active:cursor-grabbing",
            // A resting finger never selects text or opens the browser's callout; a card it picked
            // up lifts a little.
            "data-[board-resting]:select-none data-[board-resting]:[-webkit-touch-callout:none] [&_[data-board-lifted]]:shadow-lg [&_[data-board-lifted]]:outline-2 [&_[data-board-lifted]]:-outline-offset-2 [&_[data-board-lifted]]:outline-primary/60",
            following !== null && "transition-[background-position,background-size] duration-200",
            // Laid out still under the Plan, so Show on board finds each card where it is.
            planShown && "absolute inset-x-0 top-14 bottom-0 invisible",
          )}
          inert={planShown}
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
            const linkBar = linkFieldRef.current;
            const leftLinkBar = linkBar !== null && document.activeElement !== linkBar;
            event.currentTarget.focus({ preventScroll: true });
            // With the link bar open, a press on the empty board keeps a typed link in its field;
            // with none typed, the first press only leaves the field and a second closes the bar.
            if (
              linkBar !== null &&
              target instanceof Element &&
              target.closest("[data-board-item]") === null
            ) {
              if (linkBar.value.trim() !== "") linkBar.focus({ preventScroll: true });
              else if (leftLinkBar) setLinkDraft(null);
            }
            // A press past a card's edge that a grip's band covers is the line's; claiming it
            // here keeps the grip from starting a resize, and the click selects the line.
            if (linePressOnGrip(target, event.clientX, event.clientY) !== null) {
              event.preventDefault();
              event.stopPropagation();
            }
            if (
              !canEdit ||
              !(target instanceof Element) ||
              target.closest("[data-board-overlay], [data-board-grip], [data-board-pin]") !== null
            ) {
              return;
            }
            const ref = target.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem ?? null;
            // Shift, Ctrl or Cmd and a press on a card selects it, or takes it out of the selection.
            // A Mac's Ctrl-click is its right-click.
            if (
              event.shiftKey ||
              event.metaKey ||
              (event.ctrlKey && !isMacPlatform(navigator.platform))
            ) {
              // The inside of a selected section is the board's then, as while it is not selected.
              if (ref === null || target.hasAttribute("data-board-section-body")) return;
              event.stopPropagation();
              return toggleSelected(ref);
            }
            press.current = { on: ref, x: event.clientX, y: event.clientY, moved: false };
          }}
          onClickCapture={(event) => {
            // The line a covered grip's press belongs to (see onPointerDownCapture).
            const edge = linePressOnGrip(event.target, event.clientX, event.clientY);
            if (edge === null) return;
            event.preventDefault();
            event.stopPropagation();
            selectEdge(edge);
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
            snapOff.current = event.ctrlKey || event.metaKey;
            const held = press.current;
            if (held === null || held.moved) return;
            const distance = Math.hypot(event.clientX - held.x, event.clientY - held.y);
            if (distance < pressSlop(event.pointerType)) return;
            held.moved = true;
            // A finger moving off a card it did not rest on pans the board, picking out nothing.
            if (
              event.pointerType === "touch" &&
              surfaceRef.current?.querySelector("[data-board-lifted]") === null
            ) {
              return;
            }
            // A card dragged from outside the selection goes alone, and becomes the selection.
            if (held.on !== null && !selected.has(held.on)) setSelection(new Set([held.on]));
            if (held.on !== null) lastCard.current = held.on;
          }}
          onPointerUpCapture={(event) => {
            delete event.currentTarget.dataset.boardBusy;
            const held = press.current;
            press.current = null;
            if (held === null || held.moved) return;
            const distance = Math.hypot(event.clientX - held.x, event.clientY - held.y);
            if (distance >= pressSlop(event.pointerType)) return;
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
            // A menu or popover opened from a card or the selection is drawn elsewhere on the
            // page; its keys, Escape among them, are its own.
            if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) {
              return;
            }
            if (event.key === "Escape") {
              if (dropHeldPointer()) cancelGesture();
              else if (placingComment) setPlacingComment(false);
              else if (armedTool !== null) setArmedTool(null);
              else if (lineTool) {
                stopLinking();
                setLineTool(false);
              } else if (openComment !== null) closeComment();
              else if (selected.size > 0 && isBoardKey(event.target)) setSelection(NO_SELECTION);
              return;
            }
            // Ctrl+Enter on a note selected alone, or while typing in one, starts the next beside it.
            if (
              (event.ctrlKey || event.metaKey) &&
              event.key === "Enter" &&
              !event.altKey &&
              !event.shiftKey
            ) {
              const typing =
                event.target instanceof HTMLTextAreaElement &&
                event.target.matches("[data-board-rest]")
                  ? event.target
                  : null;
              const ref =
                typing !== null
                  ? typing.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem
                  : event.target === event.currentTarget && selected.size === 1
                    ? [...selected][0]
                    : undefined;
              const note = shown.notes.find((candidate) => noteRef(candidate.id) === ref);
              if (note !== undefined && followsOn(note) && canEdit && !full) {
                event.preventDefault();
                if (typing !== null) leaveText(typing);
                addAndType(() => addNextNote(note));
                return;
              }
            }
            if ((event.ctrlKey || event.metaKey) && !event.altKey && isBoardKey(event.target)) {
              const key = event.key.toLowerCase();
              const direction = boardHistoryKey(event);
              if (direction !== null) {
                event.preventDefault();
                travel(direction);
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
            if (isBoardVoteKey(event) && isBoardKey(event.target) && selected.size > 0) {
              event.preventDefault();
              voteOn(selectedNotes);
              return;
            }
            if (
              isBoardAskKey(event) &&
              altShortcutHere(event.target) &&
              (canAsk || bringAgent !== undefined)
            ) {
              event.preventDefault();
              openAsk();
              return;
            }
            if (
              isBoardAgentsKey(event) &&
              altShortcutHere(event.target) &&
              cards === undefined &&
              room !== null
            ) {
              event.preventDefault();
              setAgentsOpen((shown) => !shown);
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
                'textarea[data-board-rest=""]:not([readonly])',
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
            // Delete takes the selection at once wherever focus is on the board but in text, a
            // button's own keys, or a menu.
            if (
              (event.key === "Delete" || event.key === "Backspace") &&
              boardPressKind(event.target) !== "text" &&
              isBoardKey(event.target) &&
              canEdit &&
              removal.noteIds.length > 0
            ) {
              event.preventDefault();
              deleteSelection();
            }
          }}
          onPointerMove={(event) => {
            if (!marquee.move(event)) pan.onPointerMove(event);
            lastPointer.current = pointerOnBoard(event);
            pointerOver.current = true;
            trackCursor(event);
          }}
          onDoubleClick={(event) => {
            const target = event.target;
            if (
              !isInside(event) ||
              boardPressKind(target) !== "gesture" ||
              (target instanceof Element &&
                !target.hasAttribute("data-board-section-body") &&
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
            // A resting finger's menu is the board's, opened when it lets go without moving.
            if (isTouchResting()) {
              event.preventDefault();
              return;
            }
            // Text, links, comment threads and pins keep the browser's own menu.
            if (
              !isInside(event) ||
              !(target instanceof Element) ||
              boardPressKind(target) === "text" ||
              target.closest("a[href], [data-board-overlay], [data-board-pin]") !== null
            ) {
              return;
            }
            const ref = target.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem ?? null;
            // A card with nothing to offer leaves the browser's menu, never an empty one.
            if (
              ref !== null &&
              isFixedCard(ref) &&
              !(selected.size > 1 && selected.has(ref)) &&
              fixedCardActions(ref).length === 0
            ) {
              return;
            }
            event.preventDefault();
            openMenu(event.clientX, event.clientY, ref);
          }}
          onCopy={copySelection}
          onPointerUp={(event) => {
            if (!marquee.end(event)) pan.onPointerUp(event);
          }}
          onPointerCancel={(event) => {
            if (!marquee.end(event)) pan.onPointerCancel(event);
          }}
          onPointerLeave={() => {
            pointerOver.current = false;
            cursor.leave();
          }}
          onPaste={pasteOnBoard}
          onDragOver={dragOverBoard}
          onDrop={dropOnBoard}
          // A prompt box taking focus brings its Send button into the board's visible area.
          onFocusCapture={(event) => {
            // A keyboard already open for another field stays open for this one.
            if (touchFirst()) keepTypingInSight();
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
              ref={linesRef}
              {...lineHover}
              className={cn(
                // Cards are placed and sized in board pixels, so spacing inside the world is
                // pinned to pixels: a person's text size changes the words, never the geometry.
                "group/lines absolute top-0 left-0 origin-top-left [--spacing:4px]",
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
                    canMove={canEdit}
                    onMove={(dx, dy) => dragBy(target, note, dx, dy)}
                    onDrop={() => dropItem(target)}
                    handles={
                      <ItemHandles
                        from={noteRef(note.id)}
                        link={link}
                        frame
                        onResize={
                          canEdit
                            ? (edges, from, dx, dy) => resizeNote(note, edges, from, dx, dy)
                            : undefined
                        }
                        onEnd={() => release(() => letGo(target))}
                      />
                    }
                    onText={(text) => writeNote(note, text)}
                    onBlur={() => release(() => letGo(target))}
                    onRevert={() => revertText(target)}
                    onDelete={() => deleteNotes([note.id])}
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
                      markerWidth="4.5"
                      markerHeight="4.5"
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
                      markerWidth="4.5"
                      markerHeight="4.5"
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
                        strokeOpacity={0.6}
                        style={{ strokeWidth: boardStroke(2) }}
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
                    const slots = lineSlots.get(edge.id);
                    return (
                      <BoardEdgeLine
                        key={edge.id}
                        id={edge.id}
                        fromRef={edge.from}
                        toRef={edge.to}
                        from={from}
                        to={to}
                        fromSlot={slots?.from ?? 0.5}
                        toSlot={slots?.to ?? 0.5}
                        color={
                          state === "artifact" ? lineColor(edge.from) : EDGE_STROKE_COLORS[state]
                        }
                        width={EDGE_STROKE_WIDTHS[state]}
                        dashed={state === "sent"}
                        shape={edge.shape ?? "curve"}
                        obstacles={edge.shape === "elbow" ? lineObstacles : undefined}
                        marker={
                          state === "artifact"
                            ? `url(#${markerId}-person-${BOARD_PERSON_COLORS.indexOf(lineColor(edge.from))})`
                            : `url(#${markerId}-${state})`
                        }
                        selectable={canEdit}
                        onSelect={selectEdge}
                        over={edgesOver}
                      />
                    );
                  })}
                  {linking === null ? null : (
                    // Moved on the page as the pointer goes; see `drawLinkTo`.
                    <path
                      ref={linkPath}
                      d={
                        boardLine(lastBoardLineShape(lineBoard), linking.box, {
                          ...linking.to,
                          width: 0,
                          height: 0,
                        }).path
                      }
                      fill="none"
                      stroke="var(--color-primary)"
                      style={{ strokeWidth: boardStroke(2.5) }}
                      strokeDasharray="6 5"
                      markerEnd={`url(#${markerId}-selected)`}
                    />
                  )}
                </g>
              </svg>
              <BoardSnapGuides store={snapStore} zoom={view.zoom} />
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
                  steadyFor={
                    roomBox === undefined
                      ? undefined
                      : { boxId: roomBox.id, begun: messages.length > 0 || agentWorking }
                  }
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
                // A live view shows, restores and edits the artifact it follows.
                const artifactSource =
                  note.viewOf === undefined ? undefined : roomArtifactSource(shown, note.id);
                const artifactOf = artifactSource ?? note;
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
                    canEdit={canEdit}
                    link={link}
                    quote={boardNoteQuote(note, messages)}
                    onResize={canEdit ? resizeNote : undefined}
                    embed={
                      note.kind === "link"
                        ? {
                            live: liveEmbeds.has(note.id),
                            active: embedInUse === note.id && liveEmbeds.has(note.id),
                            zoomedOut: view.zoom < BOARD_EMBED_MIN_ZOOM,
                            onUse: () => openEmbed(note.id),
                            onRelease: () => setEmbedInUse(null),
                          }
                        : note.kind === "artifact"
                          ? {
                              live: true,
                              active: embedInUse === note.id,
                              onUse: () => setEmbedInUse(note.id),
                              onRelease: () => setEmbedInUse(null),
                            }
                          : undefined
                    }
                    markNumber={marks.numbers.get(note.id)}
                    artifactMarks={
                      note.kind === "artifact" && canEdit && onChange !== undefined
                        ? {
                            pins: marks.pins.get(artifactOf.id) ?? NO_MARK_PINS,
                            onAdd: (mark, words) => markArtifact(note, artifactOf, mark, words),
                          }
                        : undefined
                    }
                    artifactLinks={
                      note.kind === "artifact"
                        ? {
                            spot: pageSpots.get(note.id),
                            unmade:
                              note.viewOf === undefined &&
                              note.artifact === undefined &&
                              edges.some(
                                (edge) =>
                                  edge.to === noteRef(note.id) &&
                                  roomBoardNoteOfRef(shown, edge.from)?.kind === "artifact",
                              ),
                            onOpenBeside:
                              canEdit && onChange !== undefined
                                ? (link) => openLinkBeside(note, link)
                                : undefined,
                          }
                        : undefined
                    }
                    onAddNext={
                      canEdit && !full && followsOn(note)
                        ? () => addAndType(() => addNextNote(note))
                        : undefined
                    }
                    onMove={dragNote}
                    onDrop={dropNote}
                    onBlur={(target) => release(() => letGo(target))}
                    onRevert={revertText}
                    onText={writeNote}
                    onTick={tickTask}
                    onPasteLink={full ? undefined : pasteLinkInto}
                    onDelete={(target) => deleteNotes([target.id])}
                    onOpenReply={onOpenReply}
                    worker={running.find((agent) => agent.taskId === note.id)}
                    taskRun={
                      note.kind === "task" && note.run !== undefined ? (
                        <TaskRunChip
                          run={note.run}
                          done={note.done === true}
                          boxName={boxName(note.run.boxId)}
                          color={boardCursorColor(
                            guests,
                            threadBoxes.find((box) => box.id === note.run?.boxId)?.guestId,
                          )}
                          waiting={boxWaiting(note.run.boxId)}
                          end={boxRunEnd?.(note.run.boxId)}
                          onShowBox={() => note.run !== undefined && showBox(note.run.boxId)}
                          onStop={stopBox?.(note.run.boxId)}
                          onClear={
                            canEdit && onChange !== undefined
                              ? () =>
                                  void queueChange(noteRef(note.id), () =>
                                    onChange({ type: "task.run", noteId: note.id, boxId: null }),
                                  )
                              : undefined
                          }
                        />
                      ) : null
                    }
                    onUse={messageOf(note)}
                    onGive={giveOf(note)}
                    artifactSource={artifactSource}
                    onKeepArtifact={keepOf(note, artifactSource)}
                    artifactAuthor={
                      artifactOf.artifact === undefined
                        ? undefined
                        : boardArtifactAuthor(artifactOf.artifact, people)
                    }
                    artifactWriting={
                      note.kind === "artifact"
                        ? boardArtifactWriting(
                            artifactOf.id,
                            running,
                            hasProgress ? null : ownerWritingArtifactId,
                            people,
                          )
                        : null
                    }
                    artifactVersionNote={
                      note.kind === "artifact"
                        ? boardArtifactVersionNote(shown, note, replyTargets.has(note.id))
                        : null
                    }
                    boxName={boxName}
                    onRestore={restoreOf(artifactOf)}
                    onAttachAgent={attachAgentOf(note)}
                    bringIn={bringIn.partOf(note)}
                    onWrite={writeOf(artifactOf)}
                    onAsk={
                      note.kind === "artifact" && askTargets.length > 0
                        ? () => askAboutArtifact(note)
                        : undefined
                    }
                    onPickColor={pickColor}
                    onFramePage={framePage}
                    onReact={reactTo}
                    changedLabel={catchUpLabels.get(note.id)}
                    agentWork={agentWorkOf(note.id)}
                    agentStatus={noteStatusChip(note)}
                    agentDone={noteStatusOf(note)?.state === "done"}
                    compact={view.zoom < COMPACT_CARD_ZOOM}
                    menuOf={noteMenu}
                    box={
                      box === undefined
                        ? undefined
                        : {
                            label: `${boardBoxAgentLabel(note, people, note.thread?.turns.at(-1))}${boxOffline(note) ? ` · ${boxOfflineNote(note)}` : ""}`,
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
                const shape = edge.shape ?? "curve";
                const { middle } = boardLine(
                  shape,
                  from,
                  to,
                  { slots: lineSlots.get(edge.id) },
                  lineObstacles.filter((box) => box.ref !== edge.from && box.ref !== edge.to),
                );
                return (
                  <div
                    key={edge.id}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-lg border border-border bg-popover p-1 shadow-sm"
                    style={{ left: middle.x, top: middle.y }}
                    onPointerDown={stopPointer}
                    // On the group, so the keys work from the shape buttons too.
                    onKeyDown={(event) => {
                      if (event.key === "Delete" || event.key === "Backspace") {
                        event.stopPropagation();
                        removeEdge(edge.id);
                      }
                      if (event.key === "Escape") setSelectedEdge(null);
                    }}
                  >
                    <ToggleGroup
                      aria-label="Line shape"
                      value={[shape]}
                      onValueChange={(next) => {
                        const picked = next[0];
                        if (picked === "curve" || picked === "elbow") shapeEdge(edge, picked);
                      }}
                    >
                      <Toggle value="curve">Curved</Toggle>
                      <Toggle value="elbow">Elbow</Toggle>
                    </ToggleGroup>
                    <Tooltip>
                      <TooltipTrigger
                        render={
                          <Button
                            size="xs"
                            variant="outline"
                            aria-label="Delete line"
                            // Focused without scrolling: inside the moved board, the browser
                            // would scroll the board's box to bring it into view.
                            ref={focusInPlace}
                            onPointerDown={stopPointer}
                            onClick={() => removeEdge(edge.id)}
                          />
                        }
                      >
                        <Trash2Icon />
                        <span className="hidden sm:inline">Delete</span>
                      </TooltipTrigger>
                      <TooltipPopup side="top">Delete line</TooltipPopup>
                    </Tooltip>
                  </div>
                );
              })}
              <svg
                aria-hidden
                className="pointer-events-none absolute overflow-visible"
                style={{ left: edgeArea.x, top: edgeArea.y }}
                width={edgeArea.width}
                height={edgeArea.height}
              >
                <g ref={setEdgesOver} transform={`translate(${-edgeArea.x} ${-edgeArea.y})`} />
              </svg>
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
              kept={canEdit ? removal.left : 0}
              onDelete={deleteSelection}
              onClear={() => setSelection(NO_SELECTION)}
              actions={[
                ...(canAsk ? [{ label: "Ask an agent", icon: <BotIcon />, run: openAsk }] : []),
                ...(selectionRun.tasks.length > 0
                  ? [
                      {
                        label: "Run with an agent",
                        icon: <PlayIcon />,
                        run: () => openRun(selectedNotes),
                      },
                    ]
                  : []),
                ...(canEdit && selected.size > 1
                  ? [{ label: "Tidy", icon: <LayoutGridIcon />, run: tidySelection }]
                  : []),
                ...(selected.size > 1 && reactTo !== undefined
                  ? [
                      {
                        label: "Sort by votes",
                        icon: <ListOrderedIcon />,
                        run: sortSelectionByVotes,
                      },
                    ]
                  : []),
                ...(canEdit && soleSection !== undefined
                  ? [
                      {
                        label: "Tidy",
                        icon: <LayoutGridIcon />,
                        run: () => tidySection(soleSection),
                      },
                    ]
                  : []),
                ...(canEdit && soleSection !== undefined && reactTo !== undefined
                  ? [
                      {
                        label: "Sort by votes",
                        icon: <ListOrderedIcon />,
                        run: () => sortSectionByVotes(soleSection),
                      },
                    ]
                  : []),
                ...(canDuplicate
                  ? [{ label: "Duplicate", icon: <CopyIcon />, run: duplicateSelection }]
                  : []),
                ...(canEdit && cards === undefined && !full
                  ? [{ label: "Group in a section", icon: <FrameIcon />, run: groupInSection }]
                  : []),
              ]}
            >
              {canEdit && cards === undefined && colorable.length > 0 ? (
                <NoteColorPicker color={sharedColor} onPick={colorSelection} />
              ) : null}
            </SelectionBar>
          )}
          {pickingBox === null ? null : (
            <BoardBoxPicker
              boxes={pickingBox.ids.map((id) => {
                const target = askTargetsFor.find((candidate) => candidate.id === id);
                const title = threadBoxes.find((box) => box.id === id)?.title ?? "";
                return {
                  id,
                  title: target?.label ?? (title === "" ? "Untitled thread" : title),
                  ...(target?.model === undefined ? {} : { model: target.model }),
                };
              })}
              onPick={(boxId) => {
                setPickingBox(null);
                pickingBox.onPick(boxId);
              }}
              onClose={() => setPickingBox(null)}
            />
          )}
          <AlertDialog
            open={confirmingDelete !== null}
            onOpenChange={(open) => {
              if (open) return;
              setConfirmingDelete(null);
              setDeletingChats(false);
            }}
          >
            <AlertDialogPopup>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deletingDoneNotes
                    ? confirmingDelete?.length === 1
                      ? "Remove this done note?"
                      : `Remove ${confirmingDelete?.length ?? 0} done notes?`
                    : confirmingDelete?.length !== 1
                      ? `Delete ${confirmingDelete?.length ?? 0} cards?`
                      : deletingBoxes.length === 1
                        ? "Delete this agent box?"
                        : "Delete this card?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deletingDoneNotes
                    ? "An agent finished with them. Undo brings them back."
                    : deletingBoxes.length === 0
                      ? "What an agent wrote, a code window or a pull request window cannot be brought back with Undo."
                      : `Undo can't bring ${deletingBoxes.length === 1 ? "the box" : "the boxes"} back. ${
                          boxChats.length > 0
                            ? `${boxChats.length === 1 ? "The chat stays" : "The chats stay"} in your list.`
                            : "The chat stays with whoever runs the box."
                        }`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              {boxChats.length > 0 ? (
                <label className="flex cursor-pointer items-center gap-2 px-6 pb-4 text-sm">
                  <Checkbox
                    checked={deletingChats}
                    onCheckedChange={(checked) => setDeletingChats(checked === true)}
                  />
                  {boxChats.length === 1 ? "Also delete the chat" : "Also delete the chats"}
                </label>
              ) : null}
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                  Cancel
                </AlertDialogClose>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirmingDelete !== null) removeNotes(confirmingDelete);
                    if (deletingChats) for (const deleteChat of boxChats) deleteChat();
                    setConfirmingDelete(null);
                    setDeletingChats(false);
                  }}
                >
                  Delete
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
          <AlertDialog
            open={deletingSection !== null}
            onOpenChange={(open) => {
              if (!open) setDeletingSection(null);
            }}
          >
            <AlertDialogPopup finalFocus={surfaceRef}>
              <AlertDialogHeader>
                <AlertDialogTitle>
                  {deletingSection?.noteIds.length === 1
                    ? "Delete this section?"
                    : "Delete the selection?"}
                </AlertDialogTitle>
                <AlertDialogDescription>
                  {deletingSection?.cardIds.length === 1
                    ? "1 card sits on a section you are deleting. Keep it on the board, or delete it too."
                    : `${deletingSection?.cardIds.length ?? 0} cards sit on a section you are deleting. Keep them on the board, or delete them too.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" size="sm" />}>
                  Cancel
                </AlertDialogClose>
                <Button
                  variant="destructive-outline"
                  size="sm"
                  onClick={() => {
                    if (deletingSection === null) return;
                    setDeletingSection(null);
                    deleteNow([...deletingSection.noteIds, ...deletingSection.cardIds]);
                  }}
                >
                  {deletingSection?.noteIds.length === 1
                    ? `Delete section and ${deletingSection.cardIds.length} ${deletingSection.cardIds.length === 1 ? "card" : "cards"}`
                    : deletingSection?.cardIds.length === 1
                      ? "Also delete that card"
                      : `Also delete those ${deletingSection?.cardIds.length ?? 0} cards`}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (deletingSection === null) return;
                    setDeletingSection(null);
                    deleteNow(deletingSection.noteIds);
                  }}
                >
                  {deletingSection?.noteIds.length === 1
                    ? "Delete section only"
                    : deletingSection?.cardIds.length === 1
                      ? "Keep that card"
                      : "Keep those cards"}
                </Button>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>
          {placingComment ? (
            <div
              aria-hidden
              data-board-overlay
              className="absolute inset-0 z-20 cursor-crosshair"
              onPointerDown={stopPointer}
              onClick={placeComment}
            />
          ) : null}
          {armedTool === null ? null : (
            <div
              aria-hidden
              data-board-overlay
              data-board-place={armedTool}
              className="absolute inset-0 z-20 cursor-crosshair"
              onPointerDown={stopPointer}
              onClick={placeToolCard}
            />
          )}
          {lineTool ? (
            <div
              aria-hidden
              data-board-overlay
              className="absolute inset-0 z-20 cursor-crosshair"
              onPointerDown={stopPointer}
              onPointerMove={(event) => {
                if (linking !== null) return drawLinkTo(event);
                const target = linkTargetAt(event.clientX, event.clientY, null);
                markLinkTarget(target?.element ?? null);
              }}
              onPointerLeave={() => markLinkTarget(null)}
              onClick={pickLineEnd}
            />
          ) : null}
          {armedTool === null ? null : (
            <BoardToolHint data-board-place-hint onCancel={() => setArmedTool(null)}>
              {touchFirst() ? "Tap" : "Click"} the board where the {armedTool} goes.
            </BoardToolHint>
          )}
          {lineTool ? (
            <BoardToolHint
              role="status"
              onCancel={() => {
                stopLinking();
                setLineTool(false);
              }}
            >
              {linking === null
                ? `${touchFirst() ? "Tap" : "Click"} the card the line starts from.`
                : `Now ${touchFirst() ? "tap" : "click"} the card it points to.`}
            </BoardToolHint>
          ) : null}
          {commentPanel()}
          {room === null ? (
            <p className="pointer-events-none absolute inset-x-0 bottom-20 flex justify-center px-4">
              <span className="rounded-full border border-board-hairline bg-card px-3 py-1.5 text-center text-xs text-muted-foreground shadow-board">
                Share this thread with guests and each person who joins gets a card here.
              </span>
            </p>
          ) : null}
        </div>
        {planColumns === null || planAttachments === null ? null : (
          <BoardPlan
            layout={pickedView === "list" ? "list" : "columns"}
            columns={planColumns}
            attachments={planAttachments}
            people={people}
            guests={guests}
            viewer={viewer}
            ownerAssignable={ownerAssignable}
            canEdit={canEdit}
            cannotAdd={cannotAdd}
            boxOf={planBox}
            workerOf={(task) => {
              const worker = running.find((agent) => agent.taskId === task.id);
              return worker === undefined ? undefined : boardAgentName(people, worker.guestId);
            }}
            history={
              <BoardHistoryButtons
                canUndo={
                  canEdit &&
                  (history.undo.length > 0 ||
                    boardAgentTurnToUndo(shown, viewer, undefined) !== undefined)
                }
                canRedo={canEdit && history.redo.length > 0}
                onUndo={() => travel("undo")}
                onRedo={() => travel("redo")}
              />
            }
            onAdd={addPlanTask}
            onChange={changeNote}
            onMove={movePlanTask}
            onMoveAll={movePlanTasks}
            onDeleteAll={deleteNotes}
            actionsOf={planActions}
            openTask={planTask}
            addStamp={planAdd}
          />
        )}
        {contextMenu === null ? null : (
          <Built build={contextMenuParts}>
            {(menuParts) => (
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
                    if (askAfterMenu.current) {
                      askAfterMenu.current = false;
                      return openAsk();
                    }
                    if (runAfterMenu.current) {
                      runAfterMenu.current = false;
                      openRun(selectedNotes);
                      return;
                    }
                    const surface = surfaceRef.current;
                    if (surface !== null && !surface.contains(document.activeElement)) {
                      surface.focus({ preventScroll: true });
                    }
                  }}
                />
              </div>
            )}
          </Built>
        )}
        {asking === null || !canAsk ? null : (
          <BoardAskPopover
            anchor={{ getBoundingClientRect: () => askAnchor(asking.refs) }}
            count={askCards.cards.length}
            left={askCards.left}
            artifactTitle={askCards.artifact?.text.trim() ?? null}
            suggestions={boardAskSuggestions(
              askNotes.filter((note) =>
                askCards.cards.some((card) => card.ref === noteRef(note.id)),
              ),
              askCards.artifact,
            )}
            targets={askTargets}
            initialTarget={
              boardAskDefaultTarget(askTargets, {
                selectedBoxes: [
                  ...(asking.target === null ? [] : [asking.target]),
                  ...threadBoxes
                    .filter((box) => asking.refs.has(boardBoxRef(box.id)))
                    .map((box) => box.id),
                ],
                artifactBox:
                  askCards.artifact === null
                    ? null
                    : boardOwnBoxFor(shown, viewer, askCards.artifact.id),
                lastUsed: lastBoardAskTarget(askKey),
              }) ?? BOARD_ASK_NEW_BOX
            }
            initialText={asking.text}
            failed={asking.failed}
            newBoxId={asking.newBoxId}
            renderModel={renderBoxModel}
            finalFocus={surfaceRef}
            board={surfaceRef}
            onSend={(target, text) => sendAsk(asking, target, text)}
            onClose={() => setAsking(null)}
          />
        )}
        {runningTasks === null ? null : (
          <BoardRunPopover
            anchor={{ getBoundingClientRect: () => askAnchor(runningTasks.refs) }}
            count={runPlan.tasks.length}
            left={runPlan.left}
            targets={runTargets}
            initialTarget={
              boardAskDefaultTarget(runTargets, {
                selectedBoxes: runningTasks.target === null ? [] : [runningTasks.target],
                lastUsed: lastBoardAskTarget(askKey),
              }) ?? BOARD_ASK_NEW_BOX
            }
            initialMode={runningTasks.mode}
            newBoxId={runningTasks.newBoxId}
            boxesLeft={boxesLeft}
            maxBoxes={BOARD_RUN_MAX_BOXES}
            failed={runningTasks.failed}
            renderModel={renderBoxModel}
            finalFocus={surfaceRef}
            board={surfaceRef}
            onRun={(mode, target) => void runTasks(runningTasks, mode, target)}
            onClose={() => setRunningTasks(null)}
          />
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
  const ys = boxes.flatMap((box) => [box.y, box.y + box.height]);
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
  "--board-touch-scale": boardTouchScale(view.zoom),
  "--board-line-scale": boardLineScale(view.zoom),
  "--board-grip-scale": boardGripScale(view.zoom),
});

type DragBy = (target: BoardTarget, from: BoardPoint, dx: number, dy: number) => void;
/** Sends a card as `update` makes it from how it reads now. */
type ChangeNote = (note: RoomBoardNote, update: (note: RoomBoardNote) => RoomBoardNote) => void;

/** Draws an arrow from a card or note: hold it and let go over another. The board follows the drag. */
interface LinkHandlers {
  readonly onStart: (from: string, event: PointerEvent<HTMLElement>) => void;
}

/** Resizes a card by its id and a side or corner: while the grip is held, then once let go. */
interface CardResize {
  readonly onResize: (
    id: string,
    edges: BoardResizeEdges,
    from: BoardRect,
    dx: number,
    dy: number,
  ) => void;
  readonly onEnd: (id: string, edges: BoardResizeEdges) => void;
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
                  size="icon-xs"
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
            Into a thread, or into the artifact it rewrites: goes with the next prompt. From a
            section, every card in it goes
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
          <span className="mt-1 border-t border-board-hairline pt-1.5 pointer-coarse:hidden">
            {boardVoteShortcut()} votes for the selected cards, or takes your votes back
          </span>
          <span className="pointer-coarse:hidden">
            {boardAskShortcut()} asks an agent about the selected cards
          </span>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** How near a section's edge, in screen pixels, a line being drawn lands on the section. */
const LINK_FRAME_BAND = 16;

/** Where each side's grip sits: 28px, mostly outside the side's middle, its dot just outside. */
const LINK_HANDLE_SPOTS: Readonly<Record<BoardSide, string>> = {
  top: "-top-5 left-1/2 -translate-x-1/2",
  right: "-right-5 top-1/2 -translate-y-1/2",
  bottom: "-bottom-5 left-1/2 -translate-x-1/2",
  left: "-left-5 top-1/2 -translate-y-1/2",
};
const LINK_SIDES = Object.keys(LINK_HANDLE_SPOTS) as ReadonlyArray<BoardSide>;

/**
 * A grip in the middle of one side of a card, shown while the card is hovered or selected: drag
 * from it to another card to draw a line. Hidden, it takes no presses, so the board pans there.
 */
function LinkHandle({
  from,
  link,
  side,
  pin = false,
}: {
  readonly from: string;
  readonly link: LinkHandlers;
  readonly side: BoardSide;
  /** A comment pin's sits further out, so the pin itself stays easy to press. */
  readonly pin?: boolean;
}) {
  return (
    <button
      type="button"
      data-board-grip
      data-board-link
      aria-label="Drag to another card to draw a line"
      className={cn(
        "group/link pointer-events-none absolute z-10 grid size-7 cursor-crosshair touch-none place-items-center opacity-0 transition-opacity group-hover/item:pointer-events-auto group-hover/item:opacity-100 group-data-[board-selected]/item:pointer-events-auto group-data-[board-selected]/item:opacity-100 focus-visible:pointer-events-auto focus-visible:opacity-100",
        // A pin's touches its right side, so the pointer reaches it without leaving the pin.
        pin ? "-right-7 top-0.5" : LINK_HANDLE_SPOTS[side],
      )}
      onPointerDown={(event) => link.onStart(from, event)}
    >
      <span className="size-3 rounded-full border-2 border-primary bg-background shadow-board transition-transform group-hover/link:scale-150 group-hover/link:bg-primary" />
    </button>
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
  return link === undefined ? null : <LinkHandle from={from} link={link} side="right" pin />;
}

/**
 * A card's, note's or section's grips, for whoever may edit the board: a line grip in the middle
 * of each side, and a resize grip along every side and on every corner.
 */
function ItemHandles({
  from,
  link,
  frame = false,
  onResize,
  onEnd,
}: {
  readonly from: string;
  readonly link: LinkHandlers | undefined;
  /** A section's: its frame moves it, so its sides resize it by their outer few pixels only. */
  readonly frame?: boolean;
  readonly onResize:
    | ((edges: BoardResizeEdges, from: BoardRect, dx: number, dy: number) => void)
    | undefined;
  readonly onEnd: (edges: BoardResizeEdges) => void;
}) {
  return (
    <>
      {link === undefined
        ? null
        : LINK_SIDES.map((side) => <LinkHandle key={side} from={from} link={link} side={side} />)}
      {onResize === undefined
        ? null
        : RESIZE_GRIPS.map((grip) => (
            <ResizeHandle
              key={grip.name}
              className={cn(
                frame ? FRAME_GRIP_REACH : GRIP_REACH,
                // A card's corners stay above what it shows; a section's stay behind the cards.
                !frame && grip.edges.x !== undefined && grip.edges.y !== undefined && "z-10",
                grip.className,
              )}
              mark={grip.mark}
              onResize={(rect, dx, dy) => onResize(grip.edges, rect, dx, dy)}
              onEnd={() => onEnd(grip.edges)}
            />
          ))}
    </>
  );
}

/**
 * A selected note's finger-sized controls on a touch screen: above the note, or below it where the
 * board's header would cover them.
 */
function TouchNoteControls({ children }: { readonly children: ReactNode }) {
  const ref = useRef<HTMLDivElement | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- placed against the header where the browser drew it, after every render that may have panned the note
  useLayoutEffect(() => {
    const controls = ref.current;
    const note = controls?.parentElement;
    if (controls === null || note === null || note === undefined) return;
    const header =
      note
        .closest('[role="application"]')
        ?.parentElement?.querySelectorAll('[data-board-chrome="top"]') ?? [];
    const cover = Math.max(0, ...[...header].map((each) => each.getBoundingClientRect().bottom));
    const height = controls.getBoundingClientRect().height;
    controls.toggleAttribute("data-below", note.getBoundingClientRect().top - height < cover);
  });
  return (
    <div
      ref={ref}
      className="absolute bottom-full left-0 z-20 hidden origin-bottom-left pb-2 [scale:var(--board-touch-scale,1)] pointer-coarse:flex data-below:top-full data-below:bottom-auto data-below:origin-top-left data-below:pt-2 data-below:pb-0"
      onPointerDown={stopPointer}
    >
      {children}
    </div>
  );
}

function BoardNote({
  note,
  people,
  guests,
  canEdit,
  link,
  quote,
  onResize,
  onMove,
  onDrop,
  onBlur,
  onRevert,
  onText,
  onTick,
  onPasteLink,
  onDelete,
  onOpenReply,
  worker,
  taskRun,
  onUse,
  onGive,
  artifactAuthor,
  artifactWriting,
  artifactVersionNote,
  artifactSource,
  onKeepArtifact,
  boxName,
  onRestore,
  onAttachAgent,
  onWrite,
  onAsk,
  onPickColor,
  onFramePage,
  onReact,
  box,
  codeWindow,
  compact,
  menuOf,
  onAddNext,
  changedLabel,
  agentStatus,
  agentDone,
  agentWork,
  embed,
  bringIn,
  markNumber,
  artifactMarks,
  artifactLinks,
}: {
  /** What the links in an artifact's page open, and what a card one of them opened shows first. */
  readonly artifactLinks?: ArtifactLinks | undefined;
  /** A link card's Bring in, or a snapshot artifact's mark with Refresh. */
  readonly bringIn?: ReactNode;
  /** A marked note's number on the artifact it points into, while a line joins them. */
  readonly markNumber?: number | undefined;
  /** An artifact's marks and how one is added. Absent where the viewer may not add to the board. */
  readonly artifactMarks?: ArtifactMarking | undefined;
  /** A link card's page or an artifact's content: whether it loads and is in use, and the ways in and out. */
  readonly embed?:
    | {
        readonly live: boolean;
        readonly active: boolean;
        /** The board is too far out for a framed page to load. */
        readonly zoomedOut?: boolean;
        readonly onUse: () => void;
        readonly onRelease: () => void;
      }
    | undefined;
  /** Why it is marked as changed since this person was last here; absent when it is not. */
  readonly changedLabel?: string | undefined;
  /** Where a connected note stands with the agent its line reaches, and whether that is done. */
  readonly agentStatus?: ReactNode;
  readonly agentDone?: boolean | undefined;
  /** The box whose agent just added or changed it, for a few seconds. */
  readonly agentWork?:
    | { readonly name: string; readonly color: string; readonly stamp: number }
    | undefined;
  /** Adds a blank note beside this one, ready to type. Absent where none can be added. */
  readonly onAddNext?: (() => void) | undefined;
  /** Drawn too small for its header's buttons, which fold into one menu. */
  readonly compact: boolean;
  /** Its header's buttons as one menu, which its right-click menu starts with too. */
  readonly menuOf: (note: RoomBoardNote) => CardMenu;
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly canEdit: boolean;
  readonly link: LinkHandlers | undefined;
  /** The start of the reply a comment is pinned to. */
  readonly quote: string | undefined;
  readonly onResize:
    | ((
        note: RoomBoardNote,
        edges: BoardResizeEdges,
        from: BoardRect,
        dx: number,
        dy: number,
      ) => void)
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
  /** `added`: someone just picked with `@`. */
  readonly onText: (note: RoomBoardNote, text: string, added?: RoomBoardMention) => void;
  /** Ticks a task done, or unticks it back to where it was in the Plan. */
  readonly onTick: (note: RoomBoardNote, done: boolean) => void;
  /** Absent when a pasted link cannot become a card of its own, on a full board. */
  readonly onPasteLink: ((note: RoomBoardNote, url: string) => void) | undefined;
  readonly onDelete: (target: BoardTarget) => void;
  readonly onOpenReply: (messageId: string) => void;
  /** The guest's agent working on this task now. */
  readonly worker: RoomAgentActivity | undefined;
  /** Which box runs this task and how that goes, while it has a run. */
  readonly taskRun?: ReactNode;
  readonly onUse: (() => void) | undefined;
  /** Opens the note as a draft for this guest's own agent. */
  readonly onGive: (() => void) | undefined;
  /** Whose agent wrote the artifact's current version. */
  readonly artifactAuthor: string | undefined;
  /** Who is writing the artifact now, from a guest's machine or an older server, or null. */
  readonly artifactWriting: string | null;
  /** What tells this artifact from another of the same box, or null. */
  readonly artifactVersionNote: string | null;
  /** The artifact a live view shows, whose content, progress and edits the card carries. */
  readonly artifactSource: RoomBoardNote | undefined;
  /** Makes a live view its own copy of what it shows, or just stops it following. */
  readonly onKeepArtifact:
    | { readonly label: string; readonly run: () => Promise<boolean> }
    | undefined;
  readonly boxName: (boxId: string) => string;
  readonly onRestore: (() => Promise<boolean>) | undefined;
  /** Gives the viewer a thread box that rewrites this artifact, or shows the one they have. */
  readonly onAttachAgent:
    | { readonly label: string; readonly hint?: string; readonly run: () => void }
    | undefined;
  /** Opens Ask an agent on this artifact alone. Absent where the viewer cannot ask. */
  readonly onAsk?: (() => void) | undefined;
  /** Saves an artifact's text a person wrote by hand. Absent where they may not. */
  readonly onWrite?: ((body: string) => Promise<boolean>) | undefined;
  /** Colours a plain note. Absent where notes are not coloured. */
  readonly onPickColor: ((note: RoomBoardNote, color: RoomBoardNoteColor) => void) | undefined;
  /** Shows a link card's own page in it, or hides it. Absent where the viewer may not. */
  readonly onFramePage: ((note: RoomBoardNote, framed: boolean) => void) | undefined;
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
  const author =
    note.agent === undefined
      ? boardPersonName(people, note.guestId)
      : boardCommentAgentAuthor({ guestId: note.guestId, agent: note.agent }, people);
  const plain = note.kind === undefined && note.pinnedTo === undefined;
  const artifact = note.kind === "artifact";
  const thread = note.kind === "thread";
  const code = note.kind === "code";
  const pullRequest = note.kind === "pull-request";
  // A link card is a window named after its source, with the page when the source frames it.
  const linked = note.kind === "link" && note.url !== undefined ? boardEmbedOf(note.url) : null;
  const titled = artifact || thread || code || pullRequest || linked !== null;
  const titleLine = titled;
  const mine = isRoomCardOwnedBy(note, people.viewer);
  const canChange = canEdit && (!thread || mine);
  const canDelete = canEdit && mine;
  const size = boardNoteSize(note);
  const [quoteOpen, setQuoteOpen] = useState(false);
  // The day the card was drawn on, which its due day is read against.
  const [today] = useState(() => boardPlanToday(new Date()));
  const selected = useBoardSelected(noteRef(note.id));
  const liveDrag = useBoardLiveDrag(noteRef(note.id));
  const live = boardLiveRect({ x: note.x, y: note.y, w: size?.w, h: size?.h }, liveDrag);
  // Once this person types here, their own draft shows until they leave it, whoever else types.
  const [drafting, setDrafting] = useState(false);
  const text = (drafting ? null : boardLiveText(note.text, liveDrag)) ?? note.text;
  const mention = useMentionPicker((pick) =>
    onText(note, pick.text.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH), pick.mention),
  );
  // Notes and tasks are paper in a paint; titled cards, links among them, are windows.
  const paper = note.kind === undefined || note.kind === "task";
  // A task's actions sit in its menu, as on its Plan card: a card full of buttons is easy to
  // press by mistake. Any card drawn small folds its buttons into the menu too.
  const folded = compact || note.kind === "task";
  // A card's text moves the card like the rest of it. As in FigJam, a double-click (or Enter)
  // types in it, and a click on a card already selected keeps it selected, so Delete still
  // deletes the card. A finger, which a board without browser gestures gives no double-tap,
  // types with a second tap on the card it selected alone.
  const alone = useBoardSelectedAlone(noteRef(note.id));
  const typesAt = (on: EventTarget | null, x: number, y: number) => {
    if (
      (paper || titled) &&
      on instanceof HTMLTextAreaElement &&
      on.hasAttribute("data-board-rest")
    ) {
      focusTextAt(on, x, y);
    }
  };
  // Whether it was selected alone is kept from the press: the board selects on release before
  // this card hears it, so `alone` then would make the tap that selected it type too.
  const drag = dragHandlers(
    (dx, dy, event) => onMove(note, dx, dy, event),
    () => onDrop(note),
    (event, on) => {
      if (event.pointerType === "touch" && event.currentTarget.hasAttribute("data-pressed-alone")) {
        typesAt(on, event.clientX, event.clientY);
      }
      // A click on an embed's page, not a drag, hands the page the pointer.
      if (on instanceof Element && on.closest("[data-board-embed-cover]") !== null) embed?.onUse();
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
              "rounded-md text-paint-ink shadow-paint",
              noteColorClassName(note.kind === "task" ? (note.color ?? "green") : note.color),
            )
          : titled
            ? cn(BOARD_WINDOW_CLASS, linked !== null && "rounded-xl")
            : "rounded-xl border border-board-hairline bg-card text-card-foreground shadow-paint",
      )}
      style={{
        left: note.x,
        top: note.y,
        width: live?.w ?? size?.w,
        height: live?.h ?? size?.h,
        ...boardLiveStyle(note, live),
      }}
      data-board-item={noteRef(note.id)}
      data-board-selected={selected ? "" : undefined}
      {...drag}
      onPointerDown={(event) => {
        event.currentTarget.toggleAttribute("data-pressed-alone", alone);
        drag.onPointerDown(event);
      }}
      onDoubleClick={(event) => {
        // The card holds the pointer while pressed, so the click lands on it, not on its text.
        const under = document.elementFromPoint(event.clientX, event.clientY);
        const field =
          under !== null && event.currentTarget.contains(under) && under.matches("textarea")
            ? under
            : paper
              ? event.currentTarget.querySelector('textarea[data-board-rest=""]')
              : null;
        typesAt(field, event.clientX, event.clientY);
      }}
    >
      {changedLabel === undefined ? null : <CatchUpMark label={changedLabel} />}
      {agentWork === undefined ? null : (
        <AgentWorkMark key={agentWork.stamp} name={agentWork.name} color={agentWork.color} />
      )}
      {box === undefined ? null : <BoxStateEdge boxId={note.id} />}
      <div
        className={cn(
          "flex cursor-grab items-center gap-1 active:cursor-grabbing",
          titled ? BOARD_TITLE_BAR_CLASS : "h-6 ps-3 pe-3",
        )}
      >
        {note.kind === "task" ? (
          <span
            // A finger gets more of the corner than the box itself.
            className="flex items-center pointer-coarse:[&_[data-slot=checkbox]]:after:absolute pointer-coarse:[&_[data-slot=checkbox]]:after:-inset-2.5"
            onPointerDown={stopPointer}
          >
            <Checkbox
              aria-label="Done"
              checked={note.done === true}
              disabled={!canEdit}
              onCheckedChange={(done) => onTick(note, done)}
            />
            {roomTaskStatus(note) === "doing" ? (
              <BoardChip tone="primary" className="ms-1.5">
                In progress
              </BoardChip>
            ) : null}
          </span>
        ) : linked !== null ? (
          <BoardEmbedIcon source={linked.source} />
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
        {markNumber === undefined ? null : (
          <BoardChip tone="primary" aria-label={`Mark ${markNumber} on the page`} data-board-mark>
            {markNumber}
          </BoardChip>
        )}
        {/* A window's bar says what it is; its own title is below, and who added it beside. */}
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            box !== undefined
              ? "font-semibold"
              : titled
                ? "font-medium text-muted-foreground"
                : "text-2xs opacity-60",
          )}
        >
          {box !== undefined
            ? box.label
            : thread
              ? "Thread"
              : artifact
                ? "Artifact"
                : code
                  ? "Code window"
                  : pullRequest
                    ? "Pull request"
                    : linked !== null
                      ? linked.kind
                      : note.pinnedTo === undefined
                        ? paper
                          ? null
                          : author
                        : `${author} on a reply`}
        </span>
        {artifact && note.viewOf !== undefined ? <BoardChip tone="live">Live</BoardChip> : null}
        {box === undefined && titled && linked === null && !thread ? (
          <AddedBy name={author} color={boardCursorColor(people.guests, note.guestId)} />
        ) : null}
        <div className={cn("flex items-center gap-1", !selected && BOARD_HOVER_CHROME_CLASS)}>
          {folded ? <CardActionsMenu {...menuOf(note)} /> : null}
          {folded || onUse === undefined ? null : (
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
          {folded || onGive === undefined ? null : (
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
          {folded || onReact === undefined || !paper ? null : (
            <VoteButton
              note={note}
              viewer={people.viewer}
              onVote={() => onReact(note, BOARD_VOTE)}
            />
          )}
          {folded || onReact === undefined ? null : (
            <AddReaction onReact={(emoji) => onReact(note, emoji)} />
          )}
          {!folded && plain && onPickColor !== undefined ? (
            <NoteColorPicker color={note.color} onPick={(color) => onPickColor(note, color)} />
          ) : null}
          {!folded && canDelete ? (
            <button
              type="button"
              aria-label={plain ? "Delete note" : "Delete card"}
              className={BOARD_ICON_BUTTON_CLASS}
              onPointerDown={stopPointer}
              onClick={() => onDelete(target)}
            >
              <XIcon className="size-3.5" />
            </button>
          ) : null}
        </div>
      </div>
      <div className={cn("flex flex-col", size !== undefined && "min-h-0 flex-1 overflow-hidden")}>
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
                  ? "Title"
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
            rows={titleLine ? 1 : note.kind === "link" ? 2 : note.kind === "task" ? 3 : 4}
            placeholder={
              note.kind === "task"
                ? "Write a task"
                : note.kind === "link"
                  ? (linked?.title ?? "Add a title")
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
              // Paper reads like the designs' sticky notes: larger, medium-weight words.
              paper &&
                "px-4 pt-0.5 pb-1 text-ui-md leading-snug font-medium placeholder:text-paint-ink-muted",
              note.kind === "task" && note.done === true && "text-paint-ink-muted line-through",
              // Finished with, so it reads quieter; its words stay as they were written.
              agentDone === true && "text-paint-ink-muted",
              titleLine
                ? "shrink-0 pt-2.5 pb-2 font-semibold"
                : size !== undefined && "min-h-0 flex-1",
              !canChange && "cursor-default",
              paper && "cursor-default focus:cursor-text",
              titled && "cursor-grab focus:cursor-text",
              // A link's title read from its address shows as its title until someone names it.
              linked !== null &&
                "placeholder:text-card-foreground focus:placeholder:text-placeholder",
            )}
            // A window's title, like a note's text, moves its card until a click on the card
            // selected alone puts the caret in it.
            data-board-rest={paper ? "" : titled ? "title" : undefined}
            onPointerDown={paper || titled ? undefined : stopPointer}
            onChange={(event) => {
              setDrafting(true);
              onText(note, event.target.value);
              if (paper) mention.track(event.currentTarget);
            }}
            onKeyDown={(event) => {
              if (mention.keyDown(event)) return;
              // A title goes back to what is stored on Escape; a note's text is kept, and saved.
              if (event.key === "Escape") {
                event.stopPropagation();
                if (titleLine) onRevert(target);
                leaveText(event.currentTarget);
              }
              if (titleLine && event.key === "Enter") {
                event.preventDefault();
                leaveText(event.currentTarget);
              }
            }}
            onBlur={() => {
              setDrafting(false);
              mention.close();
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
        {mention.popup}
        {paper ? <MentionChips mentions={note.mentions} /> : null}
        {note.kind === "task" ? (
          <TaskProgress note={note} people={people} worker={worker} boxName={boxName} />
        ) : null}
        {note.kind === "task" ? taskRun : null}
        {/* Paper says where it stands with its agent beside who wrote it, in its footer. */}
        {paper && note.pinnedTo === undefined ? null : agentStatus === undefined ||
          agentStatus === null ? null : (
          <div className="px-3 pb-1.5">{agentStatus}</div>
        )}
        {note.kind === "task" &&
        (note.priority !== undefined || note.due !== undefined || note.assignee !== undefined) ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1 px-3 pb-2">
            {note.priority === undefined ? null : <TaskPriorityMark priority={note.priority} />}
            {note.due === undefined ? null : (
              <TaskDueChip due={note.due} today={today} done={note.done === true} />
            )}
            {note.assignee === undefined ? null : (
              <span className="ms-auto">
                <TaskAssigneeDot
                  assignee={note.assignee}
                  name={boardPersonName(people, note.assignee.guestId)}
                  color={boardCursorColor(guests, note.assignee.guestId)}
                />
              </span>
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
          <div className="mt-auto flex shrink-0 items-center justify-between gap-2 px-4 pt-1.5 pb-3">
            <p className="min-w-0 truncate text-xs font-semibold text-paint-ink-muted">{author}</p>
            {agentStatus}
          </div>
        ) : null}
        {artifact && (onAttachAgent !== undefined || onAsk !== undefined) ? (
          <div className="flex shrink-0 flex-wrap gap-1 px-3 pb-1.5">
            {onAsk === undefined ? null : (
              <WhatItDoes hint="Ask one of your thread boxes to change this artifact. Its reply replaces what it shows, for everyone; Restore previous brings this version back.">
                <Button size="micro" variant="outline" onPointerDown={stopPointer} onClick={onAsk}>
                  Ask an agent
                </Button>
              </WhatItDoes>
            )}
            {onAttachAgent === undefined ? null : (
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
            )}
          </div>
        ) : null}
        {artifact ? bringIn : null}
        {artifact ? (
          <RoomArtifactLive
            noteId={(artifactSource ?? note).id}
            artifact={(artifactSource ?? note).artifact}
            onKeep={onKeepArtifact}
            author={artifactAuthor}
            writingFallback={artifactWriting}
            versionNote={artifactVersionNote}
            boxName={boxName}
            onRestore={onRestore}
            onWrite={onWrite}
            people={people}
            active={embed?.active === true}
            onRelease={embed?.onRelease}
            marks={artifactMarks}
            links={artifactLinks}
          />
        ) : null}
        {code || pullRequest ? codeWindow : null}
        {linked === null || note.url === undefined ? null : (
          <RoomEmbedBody
            embed={linked}
            url={note.url}
            live={embed?.live === true}
            active={embed?.active === true}
            zoomedOut={embed?.zoomedOut === true}
            onRelease={() => embed?.onRelease()}
            framed={note.framed === true}
            onFrame={onFramePage === undefined ? undefined : (framed) => onFramePage(note, framed)}
            addedBy={
              <AddedBy name={author} color={boardCursorColor(people.guests, note.guestId)} named />
            }
            actions={bringIn}
          />
        )}
        {box === undefined ? null : (
          <>
            <BoardScrollTail
              className={cn("px-3 pb-2", size === undefined ? "max-h-80" : "flex-1")}
            >
              {box.body}
            </BoardScrollTail>
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
        // A window's body (a page, a diff, a prompt box) runs to its edges, so its chips get a
        // band of their own with the card's inset; paper has its text's inset already above.
        className={titled ? "border-t border-board-hairline px-3 py-2" : "px-4 pb-3"}
      />
      <ItemHandles
        from={noteRef(note.id)}
        link={link}
        onResize={
          onResize === undefined
            ? undefined
            : (edges, from, dx, dy) => onResize(note, edges, from, dx, dy)
        }
        onEnd={() => onBlur(target)}
      />
      {alone && paper && (onAddNext !== undefined || onReact !== undefined) ? (
        // A touch screen has no hover: the selected note's +1 and next note sit above it,
        // finger-sized at any zoom.
        <TouchNoteControls>
          <BoardFloat className="gap-1 p-1">
            {onReact === undefined ? null : (
              <VoteButton
                note={note}
                viewer={people.viewer}
                touch
                onVote={() => onReact(note, BOARD_VOTE)}
              />
            )}
            {onAddNext === undefined ? null : (
              <Button
                size="icon"
                variant="ghost"
                aria-label="Add a note beside it"
                onClick={onAddNext}
              >
                <PlusIcon />
              </Button>
            )}
          </BoardFloat>
        </TouchNoteControls>
      ) : null}
      {alone && onAddNext !== undefined ? (
        <span
          className="absolute top-1/2 -right-9 z-10 -translate-y-1/2 pointer-coarse:hidden"
          onPointerDown={stopPointer}
          data-board-add-next
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="outline"
                  aria-label="Add a note beside it"
                  onClick={onAddNext}
                />
              }
            >
              <PlusIcon />
            </TooltipTrigger>
            <TooltipPopup side="right">Add a note beside it (Ctrl+Enter)</TooltipPopup>
          </Tooltip>
        </span>
      ) : null}
    </div>
  );
}

/** A guest's agent working on a task, or the start of the reply that answered it. */
function TaskProgress({
  note,
  people,
  worker,
  boxName,
}: {
  readonly note: RoomBoardNote;
  readonly people: BoardPeople;
  readonly worker: RoomAgentActivity | undefined;
  readonly boxName: (boxId: string) => string;
}) {
  if (worker !== undefined) {
    return (
      <p role="status" className="px-3 pb-2 text-2xs text-paint-ink-muted first-letter:uppercase">
        {boardAgentName(people, worker.guestId)} is working on this
      </p>
    );
  }
  if (note.answer === undefined) return null;
  const by = `Answered by ${
    note.answer.boxId === undefined
      ? boardAgentName(people, note.answer.guestId)
      : boxName(note.answer.boxId)
  }`;
  // One line, so a finished task keeps its size and never grows over the card below it.
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <p className="truncate px-3 pb-2 text-2xs font-medium text-paint-ink-muted">
            {by}: <span className="font-normal">{note.answer.excerpt}</span>
          </p>
        }
      />
      <TooltipPopup side="bottom" className="max-w-80">
        <p className="font-medium">{by}</p>
        <p className="line-clamp-8 whitespace-pre-line [overflow-wrap:anywhere]">
          {note.answer.excerpt}
        </p>
      </TooltipPopup>
    </Tooltip>
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
  steadyFor,
  children,
}: {
  readonly at: BoardPoint;
  readonly title: string;
  readonly kind: string;
  /**
   * The conversation this card shows. Once it has begun, its content keeps one height and
   * scrolls, so a run starting or ending does not resize the card under anyone.
   */
  readonly steadyFor?: { readonly boxId: string; readonly begun: boolean } | undefined;
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
  const running = useBoxProgress(steadyFor?.boxId ?? "") !== undefined;
  const steady = steadyFor !== undefined && (steadyFor.begun || running);
  return (
    <section
      className={cn(
        "group/item absolute flex flex-col",
        BOARD_WINDOW_CLASS,
        dashed && "border-dashed border-foreground/20",
        (dropLabel !== undefined || selected) && "ring-2 ring-primary",
        selected && BOARD_SELECTED_CHROME_CLASS,
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
      data-board-selected={selected ? "" : undefined}
      {...dragHandlers(
        (dx, dy) => onMove(target, at, dx, dy),
        () => onDrop(target),
      )}
    >
      {steadyFor === undefined ? null : <BoxStateEdge boxId={steadyFor.boxId} />}
      {dropLabel === undefined ? null : (
        <span className="pointer-events-none absolute -top-8 left-0 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-board">
          {dropLabel}
        </span>
      )}
      <header className={cn("cursor-grab active:cursor-grabbing", BOARD_TITLE_BAR_CLASS)}>
        {color === undefined ? null : <PersonDot color={color} className="size-2" />}
        <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
        {action}
        <BoardChip tone={boardCardKindTone(kind)}>{kind}</BoardChip>
      </header>
      <BoardScrollTail
        className={cn("p-3", size !== undefined ? "flex-1" : steady ? "h-80" : "max-h-80")}
      >
        {children}
      </BoardScrollTail>
      {footer === undefined ? null : (
        <div className="shrink-0 border-t border-board-hairline px-3 pt-2 pb-3">{footer}</div>
      )}
      <ItemHandles
        from={cardRef(id)}
        link={link}
        onResize={
          resize === undefined
            ? undefined
            : (edges, from, dx, dy) => resize.onResize(id, edges, from, dx, dy)
        }
        onEnd={(edges) => resize?.onEnd(id, edges)}
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
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands everyone's pointers to the live store, so the minimap's dots move without the board rendering
  useEffect(() => {
    live.setPointers(
      cursors.flatMap((cursor) =>
        cursor.guestId === undefined || guests.some((guest) => guest.id === cursor.guestId)
          ? [
              {
                key: boardPersonKey(cursor.guestId),
                color: boardCursorColor(guests, cursor.guestId),
                x: cursor.x,
                y: cursor.y,
              },
            ]
          : [],
      ),
    );
  }, [live, cursors, guests]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a board that closes takes everyone's drags and pointers off its live store
  useEffect(
    () => () => {
      live.setDraggers([]);
      live.setPointers([]);
    },
    [live],
  );
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
                className="pointer-events-auto -ms-0.5 mt-3.5 max-w-36 cursor-pointer truncate rounded-full px-2.5 py-0.5 text-2xs leading-4 font-semibold text-white shadow-paint focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none"
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
