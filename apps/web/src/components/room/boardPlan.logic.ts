import {
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoard,
  type RoomBoardNote,
  type RoomTaskStatus,
  roomBoardCardRef,
  roomBoardNoteRef,
} from "@t3tools/contracts";
import { ROOM_BOARD_TASK_SIZE, roomTaskStatus } from "@t3tools/shared/roomBoard";

import {
  type BoardPoint,
  boardBounds,
  boardItemRects,
  boardNextNoteSpot,
  boardNoteRect,
  placeBoardItem,
} from "./roomBoard.logic";

/** What a board shows: its cards on the canvas, or its tasks as a Plan. */
export type BoardViewMode = "board" | "plan";

/** The URL search parameter that keeps which view a board shows. */
export const BOARD_VIEW_PARAM = "view";

export const boardViewModeOf = (value: unknown): BoardViewMode =>
  value === "plan" ? "plan" : "board";

export const BOARD_PLAN_COLUMNS: ReadonlyArray<{
  readonly status: RoomTaskStatus;
  readonly title: string;
}> = [
  { status: "todo", title: "To do" },
  { status: "doing", title: "In progress" },
  { status: "done", title: "Done" },
];

export type BoardPlanColumns = Readonly<Record<RoomTaskStatus, ReadonlyArray<RoomBoardNote>>>;

const byPlanOrder = (left: RoomBoardNote, right: RoomBoardNote) =>
  (left.order ?? Number.POSITIVE_INFINITY) - (right.order ?? Number.POSITIVE_INFINITY) ||
  left.y - right.y ||
  left.x - right.x ||
  (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

/**
 * The board's tasks in their Plan columns. A column runs in the order people gave its tasks,
 * then the rest as they sit on the board, top to bottom and left to right.
 */
export function boardPlanColumns(notes: ReadonlyArray<RoomBoardNote>): BoardPlanColumns {
  const columns: Record<RoomTaskStatus, Array<RoomBoardNote>> = { todo: [], doing: [], done: [] };
  for (const note of notes) {
    if (note.kind === "task") columns[roomTaskStatus(note)].push(note);
  }
  for (const column of Object.values(columns)) column.sort(byPlanOrder);
  return columns;
}

/** A task's column and order after a move in the Plan. */
export interface BoardPlanPlacement {
  readonly id: string;
  readonly status: RoomTaskStatus;
  readonly order: number;
}

/**
 * What moving a task to `index` among the other tasks of the `to` column changes: its status and
 * an order between its new neighbours. When a neighbour has no order, or none fits between them,
 * the column is numbered again, so it keeps the order it shows. Nothing for a move that leaves it.
 */
export function boardPlanMove(
  columns: BoardPlanColumns,
  taskId: string,
  to: RoomTaskStatus,
  index: number,
): ReadonlyArray<BoardPlanPlacement> {
  const task = Object.values(columns)
    .flat()
    .find((note) => note.id === taskId);
  if (task === undefined) return [];
  const others = columns[to].filter((note) => note.id !== taskId);
  const at = Math.max(0, Math.min(others.length, Math.round(index)));
  const from = roomTaskStatus(task);
  if (from === to && columns[to][at]?.id === taskId) return [];
  const low = at === 0 ? undefined : others[at - 1];
  const high = others[at];
  const lowOrder = low?.order;
  const highOrder = high?.order;
  if (
    (low === undefined || lowOrder !== undefined) &&
    (high === undefined || highOrder !== undefined)
  ) {
    const order =
      lowOrder === undefined
        ? highOrder === undefined
          ? 0
          : highOrder - 1
        : highOrder === undefined
          ? lowOrder + 1
          : (lowOrder + highOrder) / 2;
    // Halved too often, an order no longer fits between its neighbours.
    if (
      (lowOrder === undefined || order > lowOrder) &&
      (highOrder === undefined || order < highOrder)
    ) {
      return [{ id: taskId, status: to, order }];
    }
  }
  const placed = [...others.slice(0, at), task, ...others.slice(at)];
  return placed.flatMap((note, order) =>
    note.id === taskId || note.order !== order ? [{ id: note.id, status: to, order }] : [],
  );
}

/**
 * The order a task added at the bottom of a column takes, and the orders the column's tasks with
 * none take first, so it lands below them.
 */
export function boardPlanAppendOrder(column: ReadonlyArray<RoomBoardNote>): {
  readonly order: number;
  readonly placements: ReadonlyArray<BoardPlanPlacement>;
} {
  const last = column.at(-1);
  if (last === undefined) return { order: 0, placements: [] };
  if (last.order !== undefined) return { order: last.order + 1, placements: [] };
  return {
    order: column.length,
    placements: column.flatMap((note, order) =>
      note.order === order ? [] : [{ id: note.id, status: roomTaskStatus(note), order }],
    ),
  };
}

/** A task as it reads in another column; ticking or unticking it on the board agrees. */
export function boardPlanWithStatus(task: RoomBoardNote, status: RoomTaskStatus): RoomBoardNote {
  const { done: _done, status: _status, ...rest } = task;
  return {
    ...rest,
    ...(status === "done" ? { done: true } : {}),
    ...(status === "doing" ? { status } : {}),
  };
}

/** What is joined to a task by a line, as its Plan card counts it. */
export interface BoardPlanAttached {
  readonly notes: number;
  readonly links: number;
  readonly artifacts: number;
  /** Thread boxes with a line to or from it, by box id. */
  readonly boxIds: ReadonlyArray<string>;
}

/** What each task has joined to it by a line, by task id, in one pass over the lines. */
export function boardPlanAttachments(board: RoomBoard): ReadonlyMap<string, BoardPlanAttached> {
  const attached = new Map<
    string,
    { notes: number; links: number; artifacts: number; boxIds: Array<string> }
  >();
  const byRef = new Map(board.notes.map((note) => [roomBoardNoteRef(note.id), note]));
  const roomBox = roomBoardCardRef(ROOM_BOARD_THREAD_CARD);
  const add = (taskRef: string, otherRef: string) => {
    const task = byRef.get(taskRef);
    if (task?.kind !== "task") return;
    const counts = attached.get(task.id) ?? { notes: 0, links: 0, artifacts: 0, boxIds: [] };
    attached.set(task.id, counts);
    const other = byRef.get(otherRef);
    const boxId =
      otherRef === roomBox ? ROOM_BOARD_ROOM_BOX : other?.kind === "thread" ? other.id : undefined;
    if (boxId !== undefined) {
      if (!counts.boxIds.includes(boxId)) counts.boxIds.push(boxId);
      return;
    }
    if (other === undefined || other.section === true) return;
    if (other.kind === "link") counts.links += 1;
    else if (other.kind === "artifact") counts.artifacts += 1;
    else if (other.kind === undefined && other.pinnedTo === undefined) counts.notes += 1;
  };
  for (const edge of board.edges ?? []) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
  }
  return attached;
}

/**
 * Where a task added from the Plan goes on the board: beside the newest task, as the next sticky
 * goes, clear of every card; with no task yet, right of everything on the board.
 */
export function boardPlanTaskSpot(board: RoomBoard, cardIds: ReadonlyArray<string>): BoardPoint {
  const taken = boardItemRects(
    { ...board, notes: board.notes.filter((note) => note.section !== true) },
    cardIds,
  );
  const newest = board.notes.findLast((note) => note.kind === "task");
  if (newest !== undefined) {
    return boardNextNoteSpot(boardNoteRect(newest), ROOM_BOARD_TASK_SIZE, taken);
  }
  const bounds = boardBounds(taken);
  if (bounds === null) return { x: 80, y: 72 };
  return placeBoardItem(
    ROOM_BOARD_TASK_SIZE,
    {
      x: bounds.x + bounds.width + 48 + ROOM_BOARD_TASK_SIZE.w / 2,
      y: bounds.y + ROOM_BOARD_TASK_SIZE.h / 2,
    },
    taken,
  );
}

/** Today as a due day is written, in this device's time zone. */
export function boardPlanToday(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

/** A due day as a task card says it, and whether it has passed. */
export function boardPlanDue(
  due: string,
  today: string,
): { readonly label: string; readonly overdue: boolean } {
  const days = dayNumber(due) - dayNumber(today);
  if (Number.isNaN(days)) return { label: due, overdue: false };
  if (days === 0) return { label: "Due today", overdue: false };
  if (days === 1) return { label: "Due tomorrow", overdue: false };
  const date = new Date(`${due}T00:00:00Z`);
  const sameYear = due.slice(0, 4) === today.slice(0, 4);
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
  return days < 0 ? { label: `Overdue · ${day}`, overdue: true } : { label: day, overdue: false };
}

/** The line a task's Plan card names what is joined to it by, or "" for nothing. */
export function boardPlanAttachedLine(attached: BoardPlanAttached | undefined): string {
  if (attached === undefined) return "";
  const count = (n: number, one: string, many: string) =>
    n === 0 ? [] : [`${n} ${n === 1 ? one : many}`];
  return [
    ...count(attached.notes, "note", "notes"),
    ...count(attached.links, "link", "links"),
    ...count(attached.artifacts, "artifact", "artifacts"),
  ].join(" · ");
}
