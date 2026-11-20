import type { RoomBoardAgentTurn } from "@t3tools/contracts";
import { ArrowUpIcon } from "lucide-react";
import { type ReactNode, type RefObject, useEffect, useLayoutEffect, useState } from "react";

import { isMacPlatform, randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Popover, PopoverPopup } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { boardChromeAt } from "./BoardChrome";
import {
  BOARD_AGENT_WORK_MS,
  BOARD_ASK_NEW_BOX,
  type BoardAskSuggestion,
  type BoardAskTarget,
  type BoardScreenRect,
  boardAgentWorkFresh,
  boardPopoverAnchor,
} from "./boardAsk.logic";

/** How the ask shortcut reads on this device. */
export const boardAskShortcut = () =>
  typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌥A" : "Alt+A";

/** Alt+A on the board, by the key's place, so a Mac's Option letter still counts. */
export const isBoardAskKey = (event: {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}) => event.code === "KeyA" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

// The box each board was last asked from, for as long as the page is open.
const lastTargets = new Map<string, string>();
export const lastBoardAskTarget = (board: string) => lastTargets.get(board) ?? null;
export const rememberBoardAskTarget = (board: string, target: string) =>
  lastTargets.set(board, target);

/** An ask being written: the cards it is anchored to, and what a failed send left in it. */
export interface BoardAsking {
  readonly refs: ReadonlySet<string>;
  /** The id a new thread box made for it takes, so a model picked for that box stays with it. */
  readonly newBoxId: string;
  readonly text: string;
  /** The box it went to, after a failed send. */
  readonly target: string | null;
  readonly failed: boolean;
}

export const newBoardAsking = (refs: Iterable<string>): BoardAsking => ({
  refs: new Set(refs),
  newBoxId: randomUUID(),
  text: "",
  target: null,
  failed: false,
});

/**
 * Asking an agent about the selected cards, or to edit the artifact among them: what to ask, a
 * few asks that fit, which of this person's thread boxes takes it and on which model. Sending
 * closes it at once; a send that fails opens it again with what was typed.
 */
export function BoardAskPopover({
  anchor,
  count,
  left,
  artifactTitle,
  suggestions,
  targets,
  initialTarget,
  initialText,
  failed,
  newBoxId,
  renderModel,
  finalFocus,
  board,
  onSend,
  onClose,
}: {
  /** Where the selected cards are drawn now. */
  readonly anchor: { readonly getBoundingClientRect: () => DOMRect };
  /** How many cards go. */
  readonly count: number;
  /** How many more were selected than one prompt takes. */
  readonly left: number;
  /** The title of the artifact the reply rewrites, "" for an untitled one; null for none. */
  readonly artifactTitle: string | null;
  readonly suggestions: ReadonlyArray<BoardAskSuggestion>;
  readonly targets: ReadonlyArray<BoardAskTarget>;
  readonly initialTarget: string;
  readonly initialText: string;
  /** The last send failed, and nothing it added stayed on the board. */
  readonly failed: boolean;
  readonly newBoxId: string;
  /** The model picker a box's own prompt has; absent where the board has none. */
  readonly renderModel: ((boxId: string) => ReactNode) | undefined;
  readonly finalFocus: RefObject<HTMLElement | null>;
  /** The board surface, whose header and toolbar it stays between. */
  readonly board: RefObject<HTMLElement | null>;
  readonly onSend: (target: string, text: string) => void;
  readonly onClose: () => void;
}) {
  const bounds = useBoardAskBounds(board);
  const [text, setText] = useState(initialText);
  const [target, setTarget] = useState(initialTarget);
  const send = (message: string) => {
    if (message.trim() !== "") onSend(target, message.trim());
  };
  const cardsPart = count === 0 ? "" : count === 1 ? "1 card" : `${count} cards`;
  const heading =
    artifactTitle === null
      ? `Ask about ${cardsPart}`
      : [artifactTitle === "" ? "Edit this artifact" : `Edit "${artifactTitle}"`, cardsPart]
          .filter((part) => part !== "")
          .join(" · with ");
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <PopoverPopup
        anchor={boardPopoverFit(anchor, bounds)}
        side="bottom"
        align="start"
        sideOffset={BOARD_POPOVER_OFFSET}
        width="md"
        padding="compact"
        collisionBoundary={bounds}
        touchBackdrop
        finalFocus={finalFocus}
        aria-label="Ask an agent"
      >
        <div className="flex flex-col gap-2">
          <p className="truncate text-2xs text-muted-foreground">
            {heading}
            {left === 0 ? "" : ` · ${left} more left out, one ask takes ${count}`}
          </p>
          <Textarea
            size="sm"
            rows={2}
            autoFocus
            aria-label="What to ask"
            placeholder={
              artifactTitle === null
                ? "Ask an agent about these cards"
                : "How should the agent change it?"
            }
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // As in the app composer: Enter sends, Shift+Enter adds a line.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send(text);
              }
            }}
          />
          <div className="flex flex-wrap gap-1">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion.label}
                size="micro"
                variant="outline"
                onClick={() => send(suggestion.prompt)}
              >
                {suggestion.label}
              </Button>
            ))}
          </div>
          {/* Wraps for someone with several computers, whose name stands beside the model. */}
          <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            <div className="min-w-24 flex-1">
              <BoardAskTargetSelect targets={targets} value={target} onChange={setTarget} />
            </div>
            {/* The model the prompt runs on; a new box's pick is kept under the id it will take. */}
            <div className="flex max-w-60 min-w-0 shrink-0 items-center">
              {renderModel?.(target === BOARD_ASK_NEW_BOX ? newBoxId : target)}
            </div>
            <Button
              size="icon-xs"
              aria-label="Send"
              disabled={text.trim() === ""}
              onClick={() => send(text)}
            >
              <ArrowUpIcon />
            </Button>
          </div>
          {failed ? (
            <p role="alert" className="text-2xs text-error-foreground">
              Could not send it. Nothing was added to the board.
            </p>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** Which of this person's thread boxes a prompt goes to, as Ask and Run both choose it. */
export function BoardAskTargetSelect({
  targets,
  value,
  onChange,
}: {
  readonly targets: ReadonlyArray<BoardAskTarget>;
  readonly value: string;
  readonly onChange: (target: string) => void;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        if (next !== null) onChange(next);
      }}
    >
      <SelectTrigger size="xs" aria-label="Send to">
        <SelectValue>{targets.find((one) => one.id === value)?.label ?? ""}</SelectValue>
      </SelectTrigger>
      <SelectPopup align="start" alignItemWithTrigger={false}>
        {targets.map((option) => (
          <SelectItem key={option.id} value={option.id}>
            {option.label}
            {option.model === undefined ? null : (
              <span className="text-muted-foreground"> · {option.model}</span>
            )}
          </SelectItem>
        ))}
      </SelectPopup>
    </Select>
  );
}

// About the ask or run popover drawn whole: its `md` width and its height.
const BOARD_POPOVER_ROOM = { width: 320, height: 240 };
export const BOARD_POPOVER_OFFSET = 8;

/** A popover's anchor under the selection, moved beside it, or over it, when below lacks room. */
export const boardPopoverFit = (
  anchor: { readonly getBoundingClientRect: () => DOMRect },
  bounds: BoardScreenRect | undefined,
) => ({
  getBoundingClientRect: () => {
    const rect = boardPopoverAnchor(
      anchor.getBoundingClientRect(),
      bounds,
      BOARD_POPOVER_ROOM,
      BOARD_POPOVER_OFFSET,
      floatingSelectionBar(),
    );
    return new DOMRect(rect.x, rect.y, rect.width, rect.height);
  },
});

/** The selection's bar where it floats by the selection, not docked or hidden. */
function floatingSelectionBar(): BoardScreenRect | undefined {
  for (const bar of document.querySelectorAll(
    "[data-selection-bar]:not([data-selection-docked])",
  )) {
    const rect = bar.getBoundingClientRect();
    if (rect.height > 0 && getComputedStyle(bar).visibility !== "hidden") return rect;
  }
  return undefined;
}

/**
 * Where on screen the ask may sit: inside the board, below its header, above its toolbar and zoom
 * controls and above an on-screen keyboard, measured again as the keyboard opens or the window
 * resizes. On a phone the popover is about as tall as that gap, so a looser fit would cover them.
 */
export function useBoardAskBounds(
  board: RefObject<HTMLElement | null>,
): BoardScreenRect | undefined {
  const [bounds, setBounds] = useState<BoardScreenRect | undefined>(undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the board's chrome where the browser drew it and the visual viewport, which a keyboard shrinks without a render
  useLayoutEffect(() => {
    const viewport = window.visualViewport;
    const measure = () => {
      const surface = board.current;
      const root = surface?.parentElement;
      if (surface === null || root === null || root === undefined) return;
      const area = surface.getBoundingClientRect();
      const chrome = (edge: "top" | "bottom") =>
        boardChromeAt(root, edge)
          .map((element) => element.getBoundingClientRect())
          .filter((rect) => rect.height > 0);
      const top = Math.max(area.top, ...chrome("top").map((rect) => rect.bottom));
      const bottom = Math.min(
        area.bottom,
        viewport === null ? area.bottom : viewport.offsetTop + viewport.height,
        ...chrome("bottom").map((rect) => rect.top),
      );
      setBounds({ x: area.left, y: top, width: area.width, height: Math.max(0, bottom - top) });
    };
    measure();
    viewport?.addEventListener("resize", measure);
    window.addEventListener("resize", measure);
    return () => {
      viewport?.removeEventListener("resize", measure);
      window.removeEventListener("resize", measure);
    };
  }, [board]);
  return bounds;
}

/** A card an agent just added or changed: whose box did it, and which mark shows it. */
export interface BoardAgentWork {
  readonly boxId: string;
  /** Changes when the agent changes the card again, so its mark shows again. */
  readonly stamp: number;
}

const NO_WORK: ReadonlyMap<string, BoardAgentWork> = new Map();

/**
 * The cards an agent turn added or changed while this board was open, each for a few seconds.
 * `turns` is null until the board has come, so the turns it opens with mark nothing.
 */
export function useBoardAgentWork(
  turns: ReadonlyArray<RoomBoardAgentTurn> | null,
): ReadonlyMap<string, BoardAgentWork> {
  const [seen, setSeen] = useState(turns);
  const [work, setWork] = useState({ marks: NO_WORK, count: 0 });
  if (turns !== seen) {
    setSeen(turns);
    const fresh = seen === null || turns === null ? [] : boardAgentWorkFresh(seen, turns);
    if (fresh.length > 0) {
      setWork((current) => {
        const marks = new Map(current.marks);
        for (const { id, boxId } of fresh) marks.set(id, { boxId, stamp: current.count + 1 });
        return { marks, count: current.count + 1 };
      });
    }
  }
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- an agent's mark on a card is brief: a timer takes it away
  useEffect(() => {
    if (work.marks.size === 0) return;
    const timer = setTimeout(
      () => setWork((current) => ({ ...current, marks: NO_WORK })),
      BOARD_AGENT_WORK_MS,
    );
    return () => clearTimeout(timer);
  }, [work.marks]);
  return work.marks;
}

/** A thin outline in the box's colour and its name, which shows once and fades. */
export function AgentWorkMark({ name, color }: { readonly name: string; readonly color: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute -inset-1 z-10 animate-board-agent-work rounded-[inherit] border-2 motion-reduce:animate-none"
      style={{ borderColor: color }}
    >
      <span className="absolute -top-6 left-0 flex max-w-48 items-center gap-1 rounded-sm border border-board-hairline bg-card px-1.5 py-0.5 text-2xs font-medium text-card-foreground shadow-board">
        <span className="size-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <span className="truncate">{name}</span>
      </span>
    </span>
  );
}

/** Which of the viewer's own boxes a draft goes to, when nothing on the board says which. */
export function BoardBoxPicker({
  boxes,
  onPick,
  onClose,
}: {
  readonly boxes: ReadonlyArray<{
    readonly id: string;
    readonly title: string;
    readonly model?: string;
  }>;
  readonly onPick: (boxId: string) => void;
  readonly onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Which of your agent boxes?</DialogTitle>
          <DialogDescription>
            The draft goes in its prompt. Nothing runs until you press Send.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col gap-2">
            {boxes.map((box) => (
              <Button key={box.id} variant="outline" onClick={() => onPick(box.id)}>
                <span className="min-w-0 flex-1 truncate text-left">{box.title}</span>
                {box.model === undefined ? null : (
                  <span className="shrink-0 text-xs text-muted-foreground">{box.model}</span>
                )}
              </Button>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
