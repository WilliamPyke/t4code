import type { RoomBoard } from "@t3tools/contracts";
import {
  BotIcon,
  ChevronDownIcon,
  ClipboardCopyIcon,
  CommandIcon,
  DownloadIcon,
  FileDownIcon,
  FrameIcon,
  HandIcon,
  ImageDownIcon,
  KeyboardIcon,
  LayoutGridIcon,
  LinkIcon,
  ListChecksIcon,
  ListTodoIcon,
  MessagesSquareIcon,
  MousePointer2Icon,
  PencilIcon,
  Redo2Icon,
  ScanIcon,
  SearchIcon,
  SparklesIcon,
  SplineIcon,
  SquareDashedIcon,
  StickyNoteIcon,
  Undo2Icon,
  UserPlusIcon,
  UsersIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useState } from "react";

import { openCommandPalette } from "~/commandPaletteBus";
import { writeTextToClipboard } from "~/hooks/useCopyToClipboard";
import { useStableCallback } from "~/hooks/useStableCallback";
import { isMacPlatform } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Kbd, KbdGroup } from "../ui/kbd";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuShortcut,
  MenuTrigger,
} from "../ui/menu";
import { toastManager } from "../ui/toast";
import { BoardFloat } from "./BoardChrome";
import {
  boardAskQuery,
  boardCardKindName,
  boardCardLabel,
  boardNextCard,
  boardReadingOrder,
} from "./boardCommands.logic";
import { boardExportFileName, boardMarkdown, boardPlanMarkdown } from "./boardMarkdown.logic";
import { type BoardCommand, useBoardPalette } from "./boardPalette";
import type { BoardViewMode } from "./boardPlan.logic";
import { boardPng, saveBoardFile } from "./boardPng";
import {
  BOARD_SHORTCUTS,
  type BoardKey,
  boardKeyAction,
  boardKeyLabel,
  boardShortcutsMatching,
} from "./boardShortcuts";
import { type BoardPeople, type BoardRect, boardEditKey, boardUrlIn } from "./roomBoard.logic";
import { boardPressKind } from "./roomBoardPointer";
import { isBoardKey } from "./RoomBoardSelection";

/** What the board can do, handed to its keys, its command menu entries and its board menu. */
export interface BoardPowerProps {
  readonly surfaceRef: RefObject<HTMLDivElement | null>;
  /** The board, not the Plan, is on screen. */
  readonly onBoard: boolean;
  /** The viewer can only look: nothing that changes the board, or asks an agent, is offered. */
  readonly viewOnly?: boolean | undefined;
  /** Opens a new task to write in the Plan, while the Plan is on screen. */
  readonly onAddTaskInPlan?: (() => void) | undefined;
  readonly title: string;
  readonly board: RoomBoard;
  readonly people: BoardPeople;
  /** Others on the board now whom the viewer can follow. */
  readonly followable: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly onFollow: (person: string) => void;
  readonly zoom: number;
  readonly selection: ReadonlySet<string>;
  readonly onSelect: (refs: ReadonlySet<string>) => void;
  /** Selects a card alone and brings it into view. */
  readonly onShowCard: (ref: string) => void;
  /** Each absent where the viewer may not; a key passes `atPointer`, to add under the pointer. */
  readonly onAddNote?: ((atPointer?: boolean) => void) | undefined;
  readonly onAddTask?: ((atPointer?: boolean) => void) | undefined;
  readonly onAddSection?: ((atPointer?: boolean) => void) | undefined;
  /** Adds a link card for an address, or opens the link field when there is none. */
  readonly onAddLink?: ((url: string | null) => void) | undefined;
  /** Adds the viewer's own agent box, or says how to bring their agent. */
  readonly onAddAgentBox?: (() => void) | undefined;
  readonly onLineTool?: (() => void) | undefined;
  readonly onSelectTool: () => void;
  readonly onFit: () => void;
  readonly onZoomBy: (factor: number) => void;
  readonly onPanBy: (dx: number, dy: number) => void;
  readonly onGroup?: (() => void) | undefined;
  readonly onSelectAll?: (() => void) | undefined;
  readonly onUndo?: (() => void) | undefined;
  readonly onRedo?: (() => void) | undefined;
  readonly view: BoardViewMode;
  readonly onView?: ((view: BoardViewMode) => void) | undefined;
  /**
   * Picks which of the viewer's own agent boxes takes a draft, asking them when nothing says, then
   * runs `then` with its ref. False when they have none.
   */
  readonly chooseOwnBox: (then: (ref: string) => void) => boolean;
  /** Adds the viewer's own agent box and gives its ref, where they can; null when it could not. */
  readonly onAddOwnBox?: (() => string | null) | undefined;
  readonly onBringAgent?: (() => void) | undefined;
  readonly onToggleChat?: (() => void) | undefined;
  /** Brings the first-run guide back; absent for someone it has no steps for. */
  readonly onShowGuide?: (() => void) | undefined;
}

const mac = () => typeof navigator !== "undefined" && isMacPlatform(navigator.platform);
const label = (key: BoardKey) => boardKeyLabel(key, mac());

// Keys a focused widget outside the board keeps: fields, menus, dialogs and the like.
const OWN_KEYS =
  'input, textarea, select, [contenteditable], [role="dialog"], [role="alertdialog"], [role="menu"], [role="menubar"], [role="listbox"], [role="combobox"], [role="grid"], [role="tree"], [role="textbox"]';

const HIGHLIGHT_MS = 1_600;

/** Rings a card for a moment, so the eye finds it after a jump. Drawn once, never animated. */
function flash(element: HTMLElement) {
  element.style.setProperty("outline", "3px solid var(--color-primary)");
  element.style.setProperty("outline-offset", "6px");
  window.setTimeout(() => {
    element.style.removeProperty("outline");
    element.style.removeProperty("outline-offset");
  }, HIGHLIGHT_MS);
}

/** Types `text` into a field React owns, as if a person had: its own change handler takes it. */
function typeInto(field: HTMLTextAreaElement, text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(field, text);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus({ preventScroll: true });
  field.setSelectionRange(text.length, text.length);
}

/**
 * The board's power tools: FigJam's keys, the board's entries in the app's command menu, a
 * board menu with Export and the shortcuts, and the shortcuts sheet. Nothing here sends a prompt:
 * "Ask my agent" only puts the words in the viewer's own agent box for them to send.
 */
export function useBoardPower(props: BoardPowerProps): {
  readonly menu: ReactNode;
  readonly overlay: ReactNode;
} {
  const { surfaceRef } = props;
  const [sheetOpen, setSheetOpen] = useState(false);
  const [hand, setHand] = useState(false);

  const itemOf = (ref: string) =>
    surfaceRef.current?.querySelector<HTMLElement>(`[data-board-item="${CSS.escape(ref)}"]`) ??
    null;
  const showCard = (ref: string) => {
    props.onShowCard(ref);
    window.requestAnimationFrame(() => {
      const element = itemOf(ref);
      if (element !== null) flash(element);
      surfaceRef.current?.focus({ preventScroll: true });
    });
  };
  const drawnRects = (): Map<string, BoardRect> =>
    new Map(
      [...(surfaceRef.current?.querySelectorAll<HTMLElement>("[data-board-item]") ?? [])].map(
        (element) => [
          element.dataset.boardItem ?? "",
          {
            x: element.offsetLeft,
            y: element.offsetTop,
            width: element.offsetWidth,
            height: element.offsetHeight,
          },
        ],
      ),
    );
  // Cards in reading order, as Tab steps through them; comments' pins are not cards.
  const cardOrder = () =>
    boardReadingOrder(
      [...drawnRects()]
        .filter(([ref]) => {
          const element = itemOf(ref);
          return (
            element !== null &&
            !element.hasAttribute("data-board-pin") &&
            !element.hasAttribute("data-board-section")
          );
        })
        .map(([ref, rect]) => ({ ref, rect })),
    ).map(({ ref }) => ref);

  const askMyAgent = (text: string) => {
    const prompt = (ref: string) =>
      itemOf(ref)?.querySelector<HTMLTextAreaElement>(
        "textarea[data-box-prompt]:not([readonly])",
      ) ?? null;
    const fill = (ref: string) => {
      props.onShowCard(ref);
      window.requestAnimationFrame(() => {
        const field = prompt(ref);
        if (field !== null) typeInto(field, text);
        else {
          toastManager.add({
            type: "info",
            title: "That agent box is busy",
            description: "Wait for it to finish, or pick another box, then ask again.",
          });
        }
      });
    };
    if (props.chooseOwnBox(fill)) return;
    const added = props.onAddOwnBox?.() ?? null;
    if (added !== null) return fill(added);
    if (props.onBringAgent !== undefined) {
      props.onBringAgent();
      return;
    }
    toastManager.add({
      type: "info",
      title: "You have no agent box on this board",
      description: "Add your agent to the board first, then ask it here.",
    });
  };

  const copyText = (text: string, what: string) =>
    void writeTextToClipboard(text).then(
      () => toastManager.add({ type: "success", title: `Copied ${what}` }),
      () =>
        toastManager.add({
          type: "error",
          title: "Could not copy",
          description: "Your browser did not allow it.",
        }),
    );
  const exports = {
    copyBoard: () =>
      copyText(boardMarkdown(props.board, props.title, props.people), "the board as Markdown"),
    downloadBoard: () =>
      saveBoardFile(
        new Blob([boardMarkdown(props.board, props.title, props.people)], {
          type: "text/markdown",
        }),
        boardExportFileName(props.title, "", "md"),
      ),
    copyPlan: () =>
      copyText(boardPlanMarkdown(props.board, props.title, props.people), "the Plan as Markdown"),
    downloadPlan: () =>
      saveBoardFile(
        new Blob([boardPlanMarkdown(props.board, props.title, props.people)], {
          type: "text/markdown",
        }),
        boardExportFileName(props.title, "plan", "md"),
      ),
    downloadPng: () =>
      void boardPng(props.board, drawnRects()).then((blob) => {
        if (blob === null) {
          toastManager.add({ type: "info", title: "Nothing on the board to save yet" });
          return;
        }
        saveBoardFile(blob, boardExportFileName(props.title, "", "png"));
      }),
  };

  // Rename, Share and the invite link live in the header the host gives the board.
  const headerControl = (selector: string) =>
    surfaceRef.current?.parentElement?.querySelector<HTMLElement>(selector) ?? null;

  const icon = (Icon: typeof StickyNoteIcon) => <Icon className="size-4 text-icon-muted" />;
  const has = <T,>(value: T | undefined, command: (value: T) => BoardCommand) =>
    value === undefined ? [] : [command(value)];

  useBoardPalette(() => {
    const onBoard = props.onBoard;
    const looks = props.viewOnly === true;
    // From the Plan, a note goes on the board, which shows first; a task is added in the Plan.
    const onTheBoard = (run: () => void) =>
      onBoard
        ? run
        : () => {
            props.onView?.("board");
            window.requestAnimationFrame(() => window.requestAnimationFrame(run));
          };
    const commands: Array<BoardCommand> = [
      ...(!onBoard && !looks
        ? [
            ...has(props.onAddNote, (run) => ({
              id: "add-note",
              title: "Add note",
              keywords: ["sticky"],
              description: "On the board",
              icon: icon(StickyNoteIcon),
              run: onTheBoard(run),
            })),
            ...has(props.onAddTaskInPlan ?? props.onAddTask, (run) => ({
              id: "add-task",
              title: "Add task",
              keywords: ["todo"],
              icon: icon(ListTodoIcon),
              run: props.onAddTaskInPlan ?? onTheBoard(run),
            })),
          ]
        : []),
      ...(onBoard
        ? [
            ...has(props.onAddNote, (run) => ({
              id: "add-note",
              title: "Add note",
              keywords: ["sticky"],
              shortcut: "N",
              icon: icon(StickyNoteIcon),
              run,
            })),
            ...has(props.onAddTask, (run) => ({
              id: "add-task",
              title: "Add task",
              keywords: ["todo"],
              shortcut: "T",
              icon: icon(ListTodoIcon),
              run,
            })),
            ...has(props.onAddSection, (run) => ({
              id: "add-section",
              title: "Add section",
              keywords: ["frame", "group"],
              shortcut: "S",
              icon: icon(SquareDashedIcon),
              run,
            })),
            ...has(props.onAddLink, (add) => ({
              id: "add-link",
              title: "Add link…",
              keywords: ["url", "embed", "paste"],
              icon: icon(LinkIcon),
              run: () => add(null),
            })),
            ...has(props.onAddAgentBox, (run) => ({
              id: "add-agent-box",
              title: "Add my agent box",
              keywords: ["thread", "agent", "bot"],
              icon: icon(BotIcon),
              run,
            })),
            ...has(props.onLineTool, (run) => ({
              id: "line-tool",
              title: "Draw a line",
              keywords: ["connect", "arrow"],
              shortcut: "L",
              icon: icon(SplineIcon),
              run,
            })),
            {
              id: "zoom-fit",
              title: "Zoom to fit",
              keywords: ["fit", "everything"],
              shortcut: label({ key: "1", shift: true }),
              icon: icon(ScanIcon),
              run: props.onFit,
            },
            {
              id: "zoom-100",
              title: "Zoom to 100%",
              keywords: ["actual size", "reset zoom"],
              shortcut: label({ key: "0", shift: true }),
              icon: icon(ZoomInIcon),
              run: () => props.onZoomBy(1 / props.zoom),
            },
            {
              id: "zoom-in",
              title: "Zoom in",
              shortcut: label({ key: "+", mod: true }),
              icon: icon(ZoomInIcon),
              run: () => props.onZoomBy(1.2),
            },
            {
              id: "zoom-out",
              title: "Zoom out",
              shortcut: label({ key: "-", mod: true }),
              icon: icon(ZoomOutIcon),
              run: () => props.onZoomBy(1 / 1.2),
            },
            ...has(props.onSelectAll, (run) => ({
              id: "select-all",
              title: "Select all",
              shortcut: label({ key: "A", mod: true }),
              icon: icon(MousePointer2Icon),
              run,
            })),
            ...(props.selection.size > 0
              ? has(props.onGroup, (run) => ({
                  id: "group",
                  title: "Group selection in a section",
                  shortcut: label({ key: "G", mod: true }),
                  icon: icon(FrameIcon),
                  run,
                }))
              : []),
          ]
        : []),
      ...(props.onView === undefined
        ? []
        : (["board", "plan", "list"] as const)
            .filter((view) => view !== props.view)
            .map((view): BoardCommand => ({
              id: `view-${view}`,
              title:
                view === "board"
                  ? "Show the board"
                  : view === "plan"
                    ? "Show the Plan"
                    : "Show the list",
              keywords: ["view", "switch", view === "plan" ? "kanban" : view],
              icon: icon(view === "board" ? LayoutGridIcon : ListTodoIcon),
              run: () => props.onView?.(view),
            }))),
      ...has(props.onUndo, (run) => ({
        id: "undo",
        title: "Undo",
        shortcut: label({ key: "Z", mod: true }),
        icon: icon(Undo2Icon),
        run,
      })),
      ...has(props.onRedo, (run) => ({
        id: "redo",
        title: "Redo",
        shortcut: label({ key: "Z", mod: true, shift: true }),
        icon: icon(Redo2Icon),
        run,
      })),
      ...(headerControl("[data-cloud-board-invite]") === null
        ? []
        : [
            {
              id: "copy-invite",
              title: "Copy invite link",
              keywords: ["share", "invite"],
              icon: icon(UserPlusIcon),
              run: () => headerControl("[data-cloud-board-invite]")?.click(),
            },
          ]),
      ...(headerControl("[data-board-share], [data-cloud-board-people]") === null
        ? []
        : [
            {
              id: "share",
              title: "Share…",
              keywords: ["invite", "people"],
              icon: icon(UsersIcon),
              run: () => headerControl("[data-board-share], [data-cloud-board-people]")?.click(),
            },
          ]),
      ...(headerControl("[data-board-title]") === null
        ? []
        : [
            {
              id: "rename",
              title: "Rename board",
              keywords: ["title", "name"],
              icon: icon(PencilIcon),
              run: () => headerControl("[data-board-title]")?.click(),
            },
          ]),
      ...has(props.onToggleChat, (run) => ({
        id: "toggle-chat",
        title: "Show or hide the side chat",
        keywords: ["conversation", "panel", "thread"],
        icon: icon(MessagesSquareIcon),
        run,
      })),
      ...has(looks ? undefined : props.onBringAgent, (run) => ({
        id: "bring-agent",
        title: "Bring my agent",
        keywords: ["connect", "machine"],
        icon: icon(BotIcon),
        run,
      })),
      ...(looks
        ? []
        : [
            {
              id: "ask-agent",
              title: "Ask my agent…",
              keywords: ["prompt", "question"],
              icon: icon(SparklesIcon),
              run: () => askMyAgent(""),
            },
          ]),
      {
        id: "export-copy",
        title: "Copy board as Markdown",
        keywords: ["export"],
        icon: icon(ClipboardCopyIcon),
        run: exports.copyBoard,
      },
      {
        id: "export-download",
        title: "Download board as Markdown",
        keywords: ["export", "file"],
        icon: icon(FileDownIcon),
        run: exports.downloadBoard,
      },
      {
        id: "export-plan",
        title: "Copy Plan as Markdown",
        keywords: ["export", "tasks"],
        icon: icon(ClipboardCopyIcon),
        run: exports.copyPlan,
      },
      {
        id: "export-plan-download",
        title: "Download Plan as Markdown",
        keywords: ["export", "tasks", "file"],
        icon: icon(FileDownIcon),
        run: exports.downloadPlan,
      },
      {
        id: "export-png",
        title: "Download board as PNG",
        keywords: ["export", "image", "picture"],
        icon: icon(ImageDownIcon),
        run: exports.downloadPng,
      },
      ...has(props.onShowGuide, (run) => ({
        id: "getting-started",
        title: "Getting started",
        keywords: ["guide", "help", "first steps", "tour"],
        icon: icon(ListChecksIcon),
        run,
      })),
      {
        id: "shortcuts",
        title: "Keyboard shortcuts",
        keywords: ["keys", "help"],
        shortcut: "?",
        icon: icon(KeyboardIcon),
        run: () => setSheetOpen(true),
      },
    ];
    const finds: Array<BoardCommand> = [
      ...props.board.notes
        .filter((note) => note.kind !== "comment")
        .map((note): BoardCommand => ({
          id: `card:${note.id}`,
          title: boardCardLabel(note),
          keywords: [note.text, ...(note.url === undefined ? [] : [note.url])],
          description: `${boardCardKindName(note)} on this board`,
          icon: icon(SearchIcon),
          run: () => {
            props.onView?.("board");
            showCard(boardEditKey({ kind: "note", id: note.id }));
          },
        })),
      ...props.followable.map((person): BoardCommand => ({
        id: `follow:${person.id}`,
        title: `Follow ${person.name}`,
        keywords: [person.name, "cursor", "jump to"],
        description: "Go where they are looking, and follow as they move",
        icon: icon(UsersIcon),
        run: () => {
          props.onView?.("board");
          props.onFollow(person.id);
        },
      })),
    ];
    return {
      commands,
      finds,
      typed: (query) => {
        if (looks) return [];
        const url = boardUrlIn(query);
        const addLink = props.onAddLink;
        if (url !== null) {
          return addLink === undefined || !onBoard
            ? []
            : [
                {
                  id: "add-link-url",
                  title: `Add link: ${url}`,
                  keywords: [query],
                  icon: icon(LinkIcon),
                  run: () => addLink(url),
                },
              ];
        }
        const asked = boardAskQuery(query);
        return asked === ""
          ? []
          : [
              {
                id: "ask-agent-typed",
                title: `Ask my agent: ${asked}`,
                keywords: [query],
                description: "Puts it in your agent box to send",
                secondary: true,
                icon: icon(SparklesIcon),
                run: () => askMyAgent(asked),
              },
            ];
      },
    };
  });

  // Space held, or the hand tool, moves around the board with a drag from anywhere on it.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const panning = hand || spaceHeld;
  const panBy = useStableCallback(props.onPanBy);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a drag while panning is taken before any card or the board hears it, which only a window listener in the capture phase can do
  useEffect(() => {
    const surface = surfaceRef.current;
    if (!panning || surface === null) return;
    surface.style.cursor = "grab";
    let last: { x: number; y: number } | null = null;
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !(event.target instanceof Node) || !surface.contains(event.target))
        return;
      if (boardPressKind(event.target) === "text") return;
      event.stopPropagation();
      event.preventDefault();
      last = { x: event.clientX, y: event.clientY };
      surface.style.cursor = "grabbing";
    };
    const move = (event: PointerEvent) => {
      if (last === null) return;
      panBy(event.clientX - last.x, event.clientY - last.y);
      last = { x: event.clientX, y: event.clientY };
    };
    const up = () => {
      last = null;
      surface.style.cursor = "grab";
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      surface.style.removeProperty("cursor");
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [panning, surfaceRef, panBy]);

  const onKey = useStableCallback((event: KeyboardEvent) => {
    const surface = surfaceRef.current;
    if (event.defaultPrevented || surface === null) return;
    if (surface.getClientRects().length === 0) return;
    const target = event.target;
    // In the Plan and the List only "?" is the board's: they take their own keys.
    if (!props.onBoard) {
      const typing = target instanceof Element && target.closest(OWN_KEYS) !== null;
      if (boardKeyAction(event) !== "shortcuts" || typing) return;
      event.preventDefault();
      setSheetOpen(true);
      return;
    }
    const onSurface = target === surface;
    const inside = target instanceof Node && surface.contains(target);
    const root = surface.parentElement;
    // The board's keys act from the board, its own chrome, or nowhere in particular; never while
    // typing, in a menu or dialog, or once a key has put the caret in a card.
    const fromBoard =
      onSurface ||
      target === document.body ||
      (target instanceof Element &&
        (inside || root?.contains(target) === true) &&
        isBoardKey(target) &&
        boardPressKind(target) !== "text" &&
        target.closest(OWN_KEYS) === null &&
        (target.closest('[role="application"]') ?? surface) === surface);
    if (!fromBoard || !isBoardKey(document.activeElement)) return;
    if (event.key === " " && !event.repeat && (onSurface || target === document.body)) {
      event.preventDefault();
      setSpaceHeld(true);
      return;
    }
    if (event.key === "Escape" && hand) {
      setHand(false);
      return;
    }
    const action = boardKeyAction(event);
    if (action === null) return;
    // Held down, a letter would add a card for each repeat.
    if (event.repeat && !action.startsWith("zoom")) return;
    const run = (go: ((atPointer?: boolean) => void) | undefined) => {
      if (go === undefined) return;
      event.preventDefault();
      go(true);
    };
    switch (action) {
      case "note":
        return run(props.onAddNote);
      case "task":
        return run(props.onAddTask);
      case "section":
        return run(props.onAddSection);
      case "line":
        return run(props.onLineTool);
      case "select":
        return run(() => {
          setHand(false);
          props.onSelectTool();
        });
      case "hand":
        return run(() => setHand((on) => !on));
      case "fit":
        return run(props.onFit);
      case "zoom-100":
        return run(() => props.onZoomBy(1 / props.zoom));
      case "zoom-in":
        return run(() => props.onZoomBy(1.2));
      case "zoom-out":
        return run(() => props.onZoomBy(1 / 1.2));
      case "group":
        return run(props.selection.size > 0 ? props.onGroup : undefined);
      case "shortcuts":
        return run(() => setSheetOpen(true));
      case "next-card":
      case "previous-card": {
        // Tab steps through cards only from the board with a card selected; else it moves focus.
        if (!onSurface || props.selection.size === 0) return;
        const next = boardNextCard(cardOrder(), props.selection, action === "next-card" ? 1 : -1);
        return run(next === null ? undefined : () => showCard(next));
      }
    }
  });
  const onKeyUp = useStableCallback((event: KeyboardEvent) => {
    if (event.key === " ") setSpaceHeld(false);
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the board's keys also act while focus rests on its chrome or the page, which only the window hears
  useEffect(() => {
    const blur = () => setSpaceHeld(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", blur);
    };
  }, [onKey, onKeyUp]);

  const menu = (
    <Menu>
      <MenuTrigger render={<Button size="icon-sm" variant="ghost" aria-label="Board menu" />}>
        <ChevronDownIcon />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuGroup>
          <MenuGroupLabel>Export</MenuGroupLabel>
          <MenuItem onClick={exports.copyBoard}>
            <ClipboardCopyIcon />
            Copy board as Markdown
          </MenuItem>
          <MenuItem onClick={exports.downloadBoard}>
            <DownloadIcon />
            Download board as Markdown
          </MenuItem>
          <MenuItem onClick={exports.copyPlan}>
            <ClipboardCopyIcon />
            Copy Plan as Markdown
          </MenuItem>
          <MenuItem onClick={exports.downloadPlan}>
            <DownloadIcon />
            Download Plan as Markdown
          </MenuItem>
          <MenuItem onClick={exports.downloadPng}>
            <ImageDownIcon />
            Download board as PNG
          </MenuItem>
        </MenuGroup>
        <MenuSeparator />
        {props.onShowGuide === undefined ? null : (
          <MenuItem onClick={props.onShowGuide}>
            <ListChecksIcon />
            Getting started
          </MenuItem>
        )}
        <MenuItem onClick={() => openCommandPalette()}>
          <CommandIcon />
          Command menu
          <MenuShortcut>{label({ key: "K", mod: true })}</MenuShortcut>
        </MenuItem>
        <MenuItem onClick={() => setSheetOpen(true)}>
          <KeyboardIcon />
          Keyboard shortcuts
          <MenuShortcut>?</MenuShortcut>
        </MenuItem>
      </MenuPopup>
    </Menu>
  );

  const overlay = (
    <>
      {hand ? (
        <div className="pointer-events-none absolute top-16 left-1/2 z-30 -translate-x-1/2">
          <BoardFloat className="gap-2 px-3 py-1.5 text-xs text-muted-foreground" role="status">
            <HandIcon className="size-3.5" aria-hidden />
            Hand tool: drag to move around. V or Esc to stop.
          </BoardFloat>
        </div>
      ) : null}
      <BoardShortcutsSheet open={sheetOpen} onOpenChange={setSheetOpen} />
    </>
  );
  return { menu, overlay };
}

/** Every key the board takes, grouped, with a search. */
function BoardShortcutsSheet({
  open,
  onOpenChange,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  const [query, setQuery] = useState("");
  const groups = boardShortcutsMatching(BOARD_SHORTCUTS, query, mac());
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setQuery("");
        onOpenChange(next);
      }}
    >
      <DialogPopup className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Keys work whenever you are not typing.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Input
            size="sm"
            autoFocus
            aria-label="Search shortcuts"
            placeholder="Search shortcuts"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No shortcut matches that.</p>
          ) : (
            groups.map((group) => (
              <section key={group.title} aria-label={group.title}>
                <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">{group.title}</h3>
                <ul className="flex flex-col gap-1">
                  {group.shortcuts.map((shortcut) => (
                    <li
                      key={shortcut.label}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span>{shortcut.label}</span>
                      <KbdGroup>
                        {shortcut.keys.map((key) => (
                          <Kbd key={label(key)}>{label(key)}</Kbd>
                        ))}
                      </KbdGroup>
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
