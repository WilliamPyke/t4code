import type { RoomTaskRun } from "@t3tools/contracts";
import { PlayIcon, SquareIcon, XIcon } from "lucide-react";
import { type PointerEvent, type ReactNode, type RefObject, useEffect, useState } from "react";

import { randomUUID } from "~/lib/utils";

import { Button } from "../ui/button";
import { Popover, PopoverPopup } from "../ui/popover";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import {
  BOARD_POPOVER_OFFSET,
  BoardAskTargetSelect,
  boardPopoverFit,
  useBoardAskBounds,
} from "./BoardAsk";
import type { BoardAgentEnd } from "./boardAgents.logic";
import { BOARD_ASK_NEW_BOX, type BoardAskTarget } from "./boardAsk.logic";
import {
  BOARD_RUN_STARTING_MS,
  BOARD_TASK_RUN_LABEL,
  type BoardRunMode,
  boardRunRefusal,
  boardTaskRunState,
  boardTaskRunStoppable,
} from "./boardRun.logic";
import { useBoxProgress } from "./roomBoardLive";

// Its buttons sit on a card the board would otherwise start dragging.
const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** Tasks being handed to agents: which, the id a first new box takes, and a failed run's words. */
export interface BoardRunning {
  readonly refs: ReadonlySet<string>;
  /** The id a new box made for it takes, so a model picked for it stays with it. */
  readonly newBoxId: string;
  readonly mode: BoardRunMode;
  readonly target: string | null;
  readonly failed: string | null;
}

export const newBoardRunning = (refs: Iterable<string>): BoardRunning => ({
  refs: new Set(refs),
  newBoxId: randomUUID(),
  mode: "one",
  target: null,
  failed: null,
});

/**
 * Running the selected tasks with an agent: in one of this person's idle thread boxes, as one
 * prompt that lists them, or each in a new box beside it, on the model shown. Running closes it
 * at once; a run that fails opens it again, saying so.
 */
export function BoardRunPopover({
  anchor,
  count,
  left,
  targets,
  initialTarget,
  initialMode,
  newBoxId,
  boxesLeft,
  maxBoxes,
  failed,
  renderModel,
  finalFocus,
  board,
  onRun,
  onClose,
}: {
  readonly anchor: { readonly getBoundingClientRect: () => DOMRect };
  /** How many tasks go. */
  readonly count: number;
  /** How many more were picked than one run takes. */
  readonly left: number;
  readonly targets: ReadonlyArray<BoardAskTarget>;
  readonly initialTarget: string;
  readonly initialMode: BoardRunMode;
  readonly newBoxId: string;
  /** How many more thread boxes the board takes. */
  readonly boxesLeft: number;
  readonly maxBoxes: number;
  /** Why the last run did not go, when it did not. */
  readonly failed: string | null;
  readonly renderModel: ((boxId: string) => ReactNode) | undefined;
  readonly finalFocus: RefObject<HTMLElement | null>;
  readonly board: RefObject<HTMLElement | null>;
  readonly onRun: (mode: BoardRunMode, target: string) => void;
  readonly onClose: () => void;
}) {
  const bounds = useBoardAskBounds(board);
  const [mode, setMode] = useState<BoardRunMode>(count === 1 ? "one" : initialMode);
  const [target, setTarget] = useState(initialTarget);
  const refusal = boardRunRefusal(mode, count, { boxesLeft, maxBoxes });
  const tasks = count === 1 ? "1 task" : `${count} tasks`;
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
        aria-label="Run with an agent"
      >
        <div className="flex flex-col gap-2">
          <p className="truncate text-2xs text-muted-foreground">
            Run {tasks}
            {left === 0 ? "" : ` · ${left} more left out, one run takes ${count}`}
          </p>
          {count === 1 ? null : (
            <ToggleGroup
              aria-label="How to run them"
              value={[mode]}
              onValueChange={(next) => {
                if (next[0] === "one" || next[0] === "each") setMode(next[0]);
              }}
            >
              <Toggle value="one">One box for all</Toggle>
              <Toggle value="each">A box per task</Toggle>
            </ToggleGroup>
          )}
          <p className="text-xs text-muted-foreground">
            {mode === "one"
              ? count === 1
                ? "The box's agent does it and answers on the task. It stays in progress until someone ticks it off."
                : "One box's agent does them in order and answers on each. They stay in progress until someone ticks them off."
              : "Each task gets a new thread box beside it, whose agent answers on it. Each stays in progress until someone ticks it off."}
          </p>
          <div className="flex min-w-0 items-center gap-1.5">
            <div className="min-w-0 flex-1">
              {mode === "one" ? (
                <BoardAskTargetSelect targets={targets} value={target} onChange={setTarget} />
              ) : (
                <p className="truncate text-xs">
                  {count === 1 ? "1 new thread box" : `${count} new thread boxes`}
                </p>
              )}
            </div>
            {/* The model the run uses; new boxes all take the pick made under the first's id. */}
            <div className="flex max-w-36 min-w-0 shrink-0 items-center">
              {renderModel?.(mode === "each" || target === BOARD_ASK_NEW_BOX ? newBoxId : target)}
            </div>
            <Button size="xs" disabled={refusal !== null} onClick={() => onRun(mode, target)}>
              <PlayIcon />
              Run
            </Button>
          </div>
          {refusal === null ? null : <p className="text-2xs text-muted-foreground">{refusal}</p>}
          {failed === null ? null : (
            <p role="alert" className="text-2xs text-error-foreground">
              {failed}
            </p>
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/**
 * The time to read a run by: now, again once a run that has not started stops being new. Only
 * `timed` runs need it: the rest go by the record of the machine that runs their box.
 */
function useRunClock(at: string, timed: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a run that has not started reads as starting only for a while: one timer says when that ends
  useEffect(() => {
    const wait = Date.parse(at) + BOARD_RUN_STARTING_MS - Date.now();
    if (!timed || wait <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), wait + 50);
    return () => clearTimeout(timer);
  }, [at, timed]);
  return Math.max(now, Date.parse(at));
}

/**
 * Which box runs a task and how that goes, quiet on the task for everyone: the box's colour and
 * name, which pans to it; Stop while its agent runs, for whoever may stop it; and Clear once it
 * did not finish. A finished turn ticks the task off, which takes this away.
 */
export function TaskRunChip({
  run,
  done,
  boxName,
  color,
  waiting,
  end,
  onShowBox,
  onStop,
  onClear,
}: {
  readonly run: RoomTaskRun;
  readonly done: boolean;
  readonly boxName: string;
  readonly color: string;
  /** A guest's request for the box waits on the owner. */
  readonly waiting: boolean;
  /** How the box's last run ended on the machine that runs it; undefined where this client cannot read it. */
  readonly end: BoardAgentEnd | null | undefined;
  readonly onShowBox: () => void;
  /** Absent where this person may not stop the box's agent. */
  readonly onStop: (() => void) | undefined;
  /** Absent where this person may not change the board. */
  readonly onClear: (() => void) | undefined;
}) {
  const progress = useBoxProgress(run.boxId);
  const now = useRunClock(run.at, end === undefined);
  const state = boardTaskRunState({ run, done }, progress, waiting, end, now);
  if (state === null) return null;
  return (
    // The state sits beside the box's name, and wraps under it rather than past a narrow card.
    <div className="flex min-w-0 flex-wrap items-center gap-1 px-2 pb-1" role="status">
      <Button
        size="micro"
        variant="outline"
        aria-label={`${BOARD_TASK_RUN_LABEL[state]} in ${boxName}. Show the box`}
        onPointerDown={stopPointer}
        onClick={onShowBox}
      >
        <span
          aria-hidden
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="max-w-28 truncate">{boxName}</span>
      </Button>
      <span aria-hidden className="px-0.5 text-2xs text-paint-ink-muted">
        {BOARD_TASK_RUN_LABEL[state]}
      </span>
      {boardTaskRunStoppable(state) && onStop !== undefined ? (
        <Button size="micro" variant="ghost-muted" onPointerDown={stopPointer} onClick={onStop}>
          <SquareIcon />
          Stop
        </Button>
      ) : null}
      {state === "stopped" && onClear !== undefined ? (
        <Button
          size="micro"
          variant="ghost-muted"
          aria-label="Clear the run"
          onPointerDown={stopPointer}
          onClick={onClear}
        >
          <XIcon />
          Clear
        </Button>
      ) : null}
    </div>
  );
}
