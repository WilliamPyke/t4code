import {
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoard,
  type RoomBoardNote,
  type RoomBoardSize,
  type RoomTaskPriority,
  type RoomTaskStatus,
  roomBoardCardRef,
  roomBoardNoteRef,
} from "@t3tools/contracts";
import { ROOM_BOARD_TASK_SIZE, roomSectionCards, roomTaskStatus } from "@t3tools/shared/roomBoard";

import {
  type BoardPoint,
  type BoardRect,
  boardBounds,
  boardItemRects,
  boardNoteRect,
  boardMaxSide,
  clampBoardSize,
  placeBoardItem,
} from "./roomBoard.logic";

/** What a board shows: its cards on the canvas, or its tasks as a Plan in columns or a list. */
export type BoardViewMode = "board" | "plan" | "list";

/** The URL search parameter that keeps which view a board shows. */
export const BOARD_VIEW_PARAM = "view";

export const boardViewModeOf = (value: unknown): BoardViewMode =>
  value === "plan" || value === "list" ? value : "board";

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

/**
 * What moving several tasks to the bottom of the `to` column changes, in the order they show in
 * the Plan. Tasks already there move too, so they stay together.
 */
export function boardPlanMoveAll(
  columns: BoardPlanColumns,
  taskIds: ReadonlySet<string>,
  to: RoomTaskStatus,
): ReadonlyArray<BoardPlanPlacement> {
  const moving = BOARD_PLAN_COLUMNS.flatMap(({ status }) =>
    columns[status].filter((task) => taskIds.has(task.id)),
  );
  if (moving.length === 0) return [];
  const { order, placements } = boardPlanAppendOrder(
    columns[to].filter((task) => !taskIds.has(task.id)),
  );
  return [
    ...placements,
    ...moving.map((task, index) => ({ id: task.id, status: to, order: order + index })),
  ];
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
  // A section's line to a box attaches every task in the section to it.
  const isBox = (ref: string) => ref === roomBox || byRef.get(ref)?.kind === "thread";
  const sectionTasks = (ref: string) => {
    const section = byRef.get(ref);
    return section?.section === true ? roomSectionCards(board, section) : [];
  };
  for (const edge of board.edges ?? []) {
    add(edge.from, edge.to);
    add(edge.to, edge.from);
    for (const [inside, other] of [
      [edge.from, edge.to],
      [edge.to, edge.from],
    ] as const) {
      if (!isBox(other)) continue;
      for (const task of sectionTasks(inside)) add(roomBoardNoteRef(task.id), other);
    }
  }
  return attached;
}

const TASK_GAP = 24;
const TASK_STEP_X = ROOM_BOARD_TASK_SIZE.w + TASK_GAP;
const TASK_STEP_Y = ROOM_BOARD_TASK_SIZE.h + TASK_GAP;
/** Where a section's first card sits from its corner, as the templates lay them out. */
export const SECTION_INSET = { x: 24, y: 56 };
// Rows a free-standing pile of tasks is laid out in, at the least.
const FREE_ROW_TASKS = 4;
const MAX_ROWS = 200;
const FREE_ROWS = 6;

const centreIn = (rect: BoardRect, inner: BoardRect) => {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
};

const clearOf = (taken: ReadonlyArray<BoardRect>, at: BoardPoint) =>
  !taken.some(
    (rect) =>
      at.x < rect.x + rect.width + TASK_GAP / 2 &&
      at.x + ROOM_BOARD_TASK_SIZE.w + TASK_GAP / 2 > rect.x &&
      at.y < rect.y + rect.height + TASK_GAP / 2 &&
      at.y + ROOM_BOARD_TASK_SIZE.h + TASK_GAP / 2 > rect.y,
  );

/** The first clear slot of a grid `columns` wide from `origin`, row by row, or null. */
function firstClearSlot(
  origin: BoardPoint,
  columns: number,
  taken: ReadonlyArray<BoardRect>,
  rows = MAX_ROWS,
): BoardPoint | null {
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = {
        x: Math.round(origin.x + column * TASK_STEP_X),
        y: Math.round(origin.y + row * TASK_STEP_Y),
      };
      if (clearOf(taken, at)) return at;
    }
  }
  return null;
}

/** Where a task added from the Plan goes, and the section it goes in grown to hold it. */
export interface BoardPlanTaskPlace extends BoardPoint {
  /** The section it goes in, at the size that holds it, when that has to grow. */
  readonly grow?: { readonly id: string; readonly size: RoomBoardSize };
  /**
   * The size of the newest task, which it takes so a pile stays even: an agent's tasks and a
   * template's have one, and a task without one is as tall as its text.
   */
  readonly size?: RoomBoardSize;
}

/**
 * Where a task added from the Plan goes on the board: in rows with the newest task, never over
 * another card. In a section it wraps to the section's width, and the section grows down to hold
 * it; outside one, rows keep clear of sections. With no task yet, right of everything.
 * `heightOf` gives a card's drawn height where the board measured it.
 */
export function boardPlanTaskPlace(
  board: RoomBoard,
  cardIds: ReadonlyArray<string>,
  heightOf: (note: RoomBoardNote) => number | undefined = () => undefined,
): BoardPlanTaskPlace {
  const place = boardPlanTaskSpot(board, cardIds, heightOf);
  const size = board.notes.findLast((note) => note.kind === "task" && note.section !== true)?.size;
  return size === undefined ? place : { ...place, size };
}

function boardPlanTaskSpot(
  board: RoomBoard,
  cardIds: ReadonlyArray<string>,
  heightOf: (note: RoomBoardNote) => number | undefined,
): BoardPlanTaskPlace {
  const rectOf = (note: RoomBoardNote): BoardRect => {
    const rect = boardNoteRect(note);
    return { ...rect, height: heightOf(note) ?? rect.height };
  };
  const sections = board.notes.filter((note) => note.section === true);
  const cards = boardItemRects({ ...board, notes: [] }, cardIds);
  const others = board.notes.filter((note) => note.section !== true).map(rectOf);
  const taken = [...cards, ...others];
  const tasks = board.notes.filter((note) => note.kind === "task" && note.section !== true);
  const newest = tasks.at(-1);
  if (newest === undefined) {
    // The nearest clear spot to the middle of what people put on the board, else of its cards.
    const bounds = boardBounds(board.notes.length > 0 ? board.notes.map(rectOf) : cards);
    if (bounds === null) return { x: 80, y: 72 };
    return placeBoardItem(
      ROOM_BOARD_TASK_SIZE,
      { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      [...taken, ...sections.map(boardNoteRect)],
    );
  }
  const newestRect = rectOf(newest);
  const section = sections.findLast((candidate) => centreIn(boardNoteRect(candidate), newestRect));
  if (section !== undefined) {
    const frame = boardNoteRect(section);
    const inside = tasks.map(rectOf).filter((rect) => centreIn(frame, rect));
    const origin = {
      x: Math.min(...inside.map((rect) => rect.x), frame.x + SECTION_INSET.x),
      y: Math.min(...inside.map((rect) => rect.y), frame.y + SECTION_INSET.y),
    };
    const right = frame.x + frame.width - SECTION_INSET.x;
    const columns = Math.max(
      1,
      Math.floor((right - origin.x - ROOM_BOARD_TASK_SIZE.w) / TASK_STEP_X) + 1,
    );
    const at = firstClearSlot(origin, columns, taken);
    if (at !== null) {
      // Grown only past an edge the task would cross, with the margin a template gives its cards.
      const slotRight = at.x + ROOM_BOARD_TASK_SIZE.w;
      const slotBottom = at.y + ROOM_BOARD_TASK_SIZE.h;
      const size = {
        w: slotRight > frame.x + frame.width ? slotRight + SECTION_INSET.x - frame.x : frame.width,
        h: slotBottom > frame.y + frame.height ? slotBottom + TASK_GAP - frame.y : frame.height,
      };
      const fits = clampBoardSize(size, boardMaxSide(section));
      if (fits.w === size.w && fits.h === size.h) {
        return size.w === frame.width && size.h === frame.height
          ? at
          : { ...at, grow: { id: section.id, size } };
      }
    }
  }
  const blocked = [...taken, ...sections.map(boardNoteRect)];
  // A section that can grow no more: its next row goes under it, lined up with its tasks.
  if (section !== undefined) {
    const frame = boardNoteRect(section);
    const below = firstClearSlot(
      { x: frame.x + SECTION_INSET.x, y: frame.y + frame.height + TASK_GAP },
      Math.max(1, Math.floor((frame.width - SECTION_INSET.x) / TASK_STEP_X)),
      blocked,
      FREE_ROWS,
    );
    if (below !== null) return below;
  }
  // Rows with the newest task, from the leftmost task of its row, kept clear of every section.
  const free = tasks
    .map(rectOf)
    .filter((rect) => !sections.some((candidate) => centreIn(boardNoteRect(candidate), rect)));
  const row = free.filter((rect) => Math.abs(rect.y - newestRect.y) < TASK_STEP_Y / 2);
  const left = Math.min(newestRect.x, ...row.map((rect) => rect.x));
  const columns = Math.max(FREE_ROW_TASKS, Math.round((newestRect.x - left) / TASK_STEP_X) + 1);
  // A few rows at most: past them, a crowded board would push the task far off. The nearest
  // clear spot right of the newest task is better then.
  return (
    firstClearSlot({ x: left, y: newestRect.y }, columns, blocked, FREE_ROWS) ??
    placeBoardItem(
      ROOM_BOARD_TASK_SIZE,
      {
        x: newestRect.x + newestRect.width + TASK_GAP + ROOM_BOARD_TASK_SIZE.w / 2,
        y: newestRect.y + ROOM_BOARD_TASK_SIZE.h / 2,
      },
      blocked,
    )
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

/** The priorities a task can have, most pressing first, as people read them. */
export const BOARD_PLAN_PRIORITIES: ReadonlyArray<{
  readonly priority: RoomTaskPriority;
  readonly title: string;
}> = [
  { priority: "urgent", title: "Urgent" },
  { priority: "high", title: "High" },
  { priority: "medium", title: "Medium" },
  { priority: "low", title: "Low" },
];

const PRIORITY_RANK: Readonly<Record<RoomTaskPriority, number>> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/** How a Plan column is sorted: as people ordered it, most pressing first, or soonest due. */
export type BoardPlanSort = "manual" | "priority" | "due";

/**
 * A column's tasks in `sort`'s order. Tasks with no priority or no due day go last; ties keep the
 * column's own order.
 */
export function boardPlanSorted(
  tasks: ReadonlyArray<RoomBoardNote>,
  sort: BoardPlanSort,
): ReadonlyArray<RoomBoardNote> {
  if (sort === "manual") return tasks;
  // A due day is `YYYY-MM-DD`, so it sorts as text; none sorts after every day.
  const key = (task: RoomBoardNote): string =>
    sort === "priority"
      ? String(task.priority === undefined ? 9 : PRIORITY_RANK[task.priority])
      : (task.due ?? "9999");
  const rank = new Map(tasks.map((task, index) => [task.id, index]));
  return tasks.toSorted((left, right) => {
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : rank.get(left.id)! - rank.get(right.id)!;
  });
}

/** Who a Plan filter keeps tasks for: one person (null for the owner), or tasks for no one. */
export type BoardPlanPerson = { readonly guestId: string | null } | "nobody";

/** What the Plan shows of its tasks. */
export interface BoardPlanFilter {
  readonly text: string;
  readonly person: BoardPlanPerson | null;
  readonly hideDone: boolean;
}

export const NO_PLAN_FILTER: BoardPlanFilter = { text: "", person: null, hideDone: false };

export const isPlanFiltered = (filter: BoardPlanFilter) =>
  filter.text.trim() !== "" || filter.person !== null || filter.hideDone;

/** Whether a task shows under a Plan filter: its text holds every word typed, and it is theirs. */
export function boardPlanShows(task: RoomBoardNote, filter: BoardPlanFilter): boolean {
  if (filter.hideDone && task.done === true) return false;
  const person = filter.person;
  if (person === "nobody" && task.assignee !== undefined) return false;
  if (
    person !== null &&
    person !== "nobody" &&
    (task.assignee === undefined || (task.assignee.guestId ?? null) !== person.guestId)
  ) {
    return false;
  }
  const text = task.text.toLowerCase();
  return filter.text
    .toLowerCase()
    .split(/\s+/)
    .every((word) => word === "" || text.includes(word));
}

/**
 * Where a task dropped at `index` among a column's shown tasks goes among all of the column's
 * other tasks: before the shown task it was dropped above, else after the last one shown.
 */
export function boardPlanIndexAmong(
  column: ReadonlyArray<RoomBoardNote>,
  shown: ReadonlyArray<RoomBoardNote>,
  taskId: string,
  index: number,
): number {
  const others = column.filter((task) => task.id !== taskId);
  const visible = shown.filter((task) => task.id !== taskId);
  const before = visible[index];
  if (before !== undefined) return others.findIndex((task) => task.id === before.id);
  const last = visible.at(-1);
  return last === undefined ? others.length : others.findIndex((task) => task.id === last.id) + 1;
}

/**
 * The tasks selected after a click on `id`: a plain click selects it alone, Ctrl or Cmd adds it
 * or takes it out, and Shift adds every task shown (`order`) from the last one clicked (`anchor`)
 * to it. A plain click on the task selected alone opens it: `open`.
 */
export function boardPlanPick(
  picked: ReadonlySet<string>,
  anchor: string | null,
  id: string,
  keys: { readonly shiftKey: boolean; readonly ctrlKey: boolean; readonly metaKey: boolean },
  order: ReadonlyArray<string>,
): { readonly picked: ReadonlySet<string>; readonly open: boolean } {
  if (keys.shiftKey) {
    const from = anchor === null ? -1 : order.indexOf(anchor);
    const to = order.indexOf(id);
    if (from === -1 || to === -1) return { picked: new Set([...picked, id]), open: false };
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    return { picked: new Set([...picked, ...range]), open: false };
  }
  if (keys.ctrlKey || keys.metaKey) {
    const next = new Set(picked);
    if (!next.delete(id)) next.add(id);
    return { picked: next, open: false };
  }
  const alone = picked.size === 1 && picked.has(id);
  return { picked: alone ? picked : new Set([id]), open: alone };
}

/** Where a task was in the Plan before it was done. */
export interface BoardPlanSpot {
  readonly status: RoomTaskStatus;
  readonly order: number | undefined;
}

/**
 * What unticking a done task changes: it goes back to the column and place it had before it was
 * done when that is known, among the tasks there now, else to the bottom of To do.
 */
export function boardPlanUntick(
  columns: BoardPlanColumns,
  taskId: string,
  before: BoardPlanSpot | undefined,
): ReadonlyArray<BoardPlanPlacement> {
  const to = before?.status === "doing" ? "doing" : "todo";
  const others = columns[to].filter((task) => task.id !== taskId);
  const order = before?.order;
  const index =
    order === undefined
      ? others.length
      : others.filter((task) => task.order !== undefined && task.order < order).length;
  const placements = boardPlanMove(columns, taskId, to, index);
  // Dropped where it already reads, it still has to leave Done.
  return placements.length > 0
    ? placements
    : [{ id: taskId, status: to, order: order ?? others.length }];
}
