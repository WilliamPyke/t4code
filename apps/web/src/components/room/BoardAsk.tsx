import type { RoomBoardAgentTurn } from "@t3tools/contracts";
import { ArrowUpIcon } from "lucide-react";
import { type RefObject, useEffect, useState } from "react";

import { isMacPlatform } from "~/lib/utils";

import { Button } from "../ui/button";
import { Popover, PopoverPopup } from "../ui/popover";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  BOARD_AGENT_WORK_MS,
  type BoardAskSuggestion,
  type BoardAskTarget,
  boardAgentWorkFresh,
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

/**
 * Asking an agent about the selected cards: what to ask, a few asks that fit them, and which of
 * this person's thread boxes takes it. It stays open while it sends, and on a failure keeps what
 * was typed.
 */
export function BoardAskPopover({
  anchor,
  count,
  left,
  suggestions,
  targets,
  initialTarget,
  finalFocus,
  onSend,
  onClose,
}: {
  /** Where the selected cards are drawn now. */
  readonly anchor: { readonly getBoundingClientRect: () => DOMRect };
  /** How many cards go. */
  readonly count: number;
  /** How many more were selected than one prompt takes. */
  readonly left: number;
  readonly suggestions: ReadonlyArray<BoardAskSuggestion>;
  readonly targets: ReadonlyArray<BoardAskTarget>;
  readonly initialTarget: string;
  readonly finalFocus: RefObject<HTMLElement | null>;
  /** Sends it to a target and says whether it went. */
  readonly onSend: (target: string, text: string) => Promise<boolean>;
  readonly onClose: () => void;
}) {
  const [text, setText] = useState("");
  const [target, setTarget] = useState(initialTarget);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const send = async (message: string) => {
    if (message.trim() === "" || sending) return;
    setSending(true);
    setFailed(false);
    const sent = await onSend(target, message.trim()).catch(() => false);
    setSending(false);
    if (sent) onClose();
    else setFailed(true);
  };
  const targetLabel = targets.find((one) => one.id === target)?.label ?? "";
  return (
    <Popover
      open
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
    >
      <PopoverPopup
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={8}
        width="md"
        padding="compact"
        touchBackdrop
        finalFocus={finalFocus}
        aria-label="Ask an agent"
      >
        <div className="flex flex-col gap-2">
          <p className="text-2xs text-muted-foreground">
            {count === 1 ? "Ask about 1 card" : `Ask about ${count} cards`}
            {left === 0 ? "" : ` · ${left} more left out, one ask takes ${count}`}
          </p>
          <Textarea
            size="sm"
            rows={2}
            autoFocus
            aria-label="What to ask"
            placeholder="Ask an agent about these cards"
            value={text}
            readOnly={sending}
            aria-busy={sending}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              // As in the app composer: Enter sends, Shift+Enter adds a line.
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void send(text);
              }
            }}
          />
          <div className="flex flex-wrap gap-1">
            {suggestions.map((suggestion) => (
              <Button
                key={suggestion.label}
                size="micro"
                variant="outline"
                disabled={sending}
                onClick={() => void send(suggestion.prompt)}
              >
                {suggestion.label}
              </Button>
            ))}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <div className="min-w-0 flex-1">
              <Select
                value={target}
                disabled={sending}
                onValueChange={(value) => {
                  if (value !== null) setTarget(value);
                }}
              >
                <SelectTrigger size="xs" aria-label="Send to">
                  <SelectValue>{targetLabel}</SelectValue>
                </SelectTrigger>
                <SelectPopup align="start" alignItemWithTrigger={false}>
                  {targets.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <Button
              size="icon-xs"
              aria-label={sending ? "Sending..." : "Send"}
              disabled={sending || text.trim() === ""}
              onClick={() => void send(text)}
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
