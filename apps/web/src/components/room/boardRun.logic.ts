import { ROOM_BOARD_ROOM_BOX, type RoomBoardNote, type RoomBoxProgress } from "@t3tools/contracts";

import type { BoardAgentEnd } from "./boardAgents.logic";
import type { BoardAskTarget } from "./boardAsk.logic";
import { BOARD_PROMPT_MAX_CARDS } from "./roomBoard.logic";

/** How many new thread boxes "A box per task" makes at once. */
export const BOARD_RUN_MAX_BOXES = 4;

/**
 * How long a run whose box has not started yet reads as starting, not as unfinished, where this
 * client cannot read the record of the machine that runs the box.
 */
export const BOARD_RUN_STARTING_MS = 30_000;

/** Whether a task can be run by `viewer` (null for the owner): open, written, no one's or theirs. */
export const canRunBoardTask = (
  note: Pick<RoomBoardNote, "kind" | "done" | "text" | "assignee">,
  viewer: string | null,
): boolean =>
  note.kind === "task" &&
  note.done !== true &&
  note.text.trim() !== "" &&
  (note.assignee === undefined || (note.assignee.guestId ?? null) === viewer);

/**
 * The tasks a run takes from some cards, top to bottom and then left to right, leaving out any a
 * box is still on; at most as many as one prompt carries, and how many more there were.
 */
export function boardRunTasks(
  notes: ReadonlyArray<RoomBoardNote>,
  viewer: string | null,
  busy: (task: RoomBoardNote) => boolean,
): { readonly tasks: ReadonlyArray<RoomBoardNote>; readonly left: number } {
  const runnable = notes
    .filter((note) => canRunBoardTask(note, viewer) && !busy(note))
    .toSorted((a, b) => a.y - b.y || a.x - b.x);
  return {
    tasks: runnable.slice(0, BOARD_PROMPT_MAX_CARDS),
    left: Math.max(0, runnable.length - BOARD_PROMPT_MAX_CARDS),
  };
}

/**
 * Where a run can go: the person's own thread boxes that are not running now, so the box's next
 * turn is the run's, then a new box. The room thread's box ticks tasks off its own way.
 */
export const boardRunTargets = (
  targets: ReadonlyArray<BoardAskTarget>,
  running: (boxId: string) => boolean,
): ReadonlyArray<BoardAskTarget> =>
  targets.filter((target) => target.id !== ROOM_BOARD_ROOM_BOX && !running(target.id));

/** "One box for all" sends the tasks to one box in one prompt; "A box per task" makes a box each. */
export type BoardRunMode = "one" | "each";

/** Why a run cannot go as chosen, said plainly, or null when it can. */
export function boardRunRefusal(
  mode: BoardRunMode,
  count: number,
  room: { readonly boxesLeft: number; readonly maxBoxes: number },
): string | null {
  if (mode === "one") return null;
  if (count > room.maxBoxes) {
    return `A box per task runs up to ${room.maxBoxes} at once. Select fewer, or use One box for all.`;
  }
  if (count > room.boxesLeft) {
    return room.boxesLeft === 0
      ? "The board has no room for another thread box."
      : `The board has room for ${room.boxesLeft} more thread ${room.boxesLeft === 1 ? "box" : "boxes"}.`;
  }
  return null;
}

/** What a run asks of a box. The tasks go with it as cards, in the order they are listed. */
export const boardRunPrompt = (count: number): string =>
  count === 1
    ? "Do this task from the board. When it is done, say briefly what you did."
    : `Do these ${count} tasks from the board, in the order they are listed. When they are done, say briefly what you did for each.`;

/** Where a task someone ran stands, as everyone sees it on the task. */
export type BoardTaskRunState =
  | "starting"
  | "queued"
  | "working"
  | "approval"
  | "waiting"
  | "stopped";

/**
 * Where a run task stands: its box's live run, else a guest's request waiting on the owner, else
 * whether the box's machine records a run ended since (`end`, null for none). Where this client
 * cannot read that machine (undefined) it is starting for a while, then not finished.
 */
export function boardTaskRunState(
  task: Pick<RoomBoardNote, "run" | "done">,
  progress: Pick<RoomBoxProgress, "phase"> | undefined,
  waiting: boolean,
  end: Pick<BoardAgentEnd, "at"> | null | undefined,
  now: number,
): BoardTaskRunState | null {
  if (task.run === undefined || task.done === true) return null;
  if (progress !== undefined) {
    return progress.phase === "queued" || progress.phase === "approval"
      ? progress.phase
      : "working";
  }
  if (waiting) return "waiting";
  const at = Date.parse(task.run.at);
  if (end !== undefined) return end !== null && Date.parse(end.at) >= at ? "stopped" : "starting";
  return now - at < BOARD_RUN_STARTING_MS ? "starting" : "stopped";
}

export const BOARD_TASK_RUN_LABEL: Readonly<Record<BoardTaskRunState, string>> = {
  starting: "Starting",
  queued: "Queued",
  working: "Working",
  approval: "Needs approval",
  waiting: "Waiting for the owner",
  stopped: "Didn't finish",
};

/** Whether a run in this state has an agent run that Stop can end. */
export const boardTaskRunStoppable = (state: BoardTaskRunState): boolean =>
  state === "queued" || state === "working" || state === "approval";
