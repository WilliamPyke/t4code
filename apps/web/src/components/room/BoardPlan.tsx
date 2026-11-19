import {
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoardAssignee,
  type RoomBoardMention,
  type RoomBoardNote,
  type RoomTaskPriority,
  type RoomTaskStatus,
  type ThreadGuest,
} from "@t3tools/contracts";
import { roomMentionsIn, roomTaskStatus } from "@t3tools/shared/roomBoard";
import {
  AppWindowIcon,
  ArrowDownIcon,
  ArrowDownWideNarrowIcon,
  ArrowUpIcon,
  BotIcon,
  EllipsisIcon,
  LinkIcon,
  ListIcon,
  LocateFixedIcon,
  PlayIcon,
  PlusIcon,
  ShapesIcon,
  SquareKanbanIcon,
  StickyNoteIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import {
  type FormEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import {
  Menu,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Toggle } from "../ui/toggle";
import { Toggle as GroupToggle, ToggleGroup } from "../ui/toggle-group";
import { BoardChip, PersonDot } from "./BoardChrome";
import { useMentionPicker } from "./BoardMentions";
import {
  BOARD_PLAN_COLUMNS,
  BOARD_PLAN_PRIORITIES,
  BOARD_VIEW_PARAM,
  type BoardPlanAttached,
  type BoardPlanColumns,
  type BoardPlanFilter,
  type BoardPlanSort,
  type BoardViewMode,
  NO_PLAN_FILTER,
  boardPlanAttachedLine,
  boardPlanIndexAmong,
  boardPlanPick,
  boardPlanShows,
  boardPlanSorted,
  boardPlanToday,
  boardViewModeOf,
  isPlanFiltered,
} from "./boardPlan.logic";
import { TaskAssigneeDot, TaskDueChip, TaskPriorityIcon, TaskPriorityMark } from "./BoardTaskMarks";
import { BoardProgressLine } from "./RoomBoardArtifact";
import { WhyNot } from "./RoomBoardWhy";
import {
  type BoardPeople,
  boardAgentName,
  boardCursorColor,
  boardPersonName,
} from "./roomBoard.logic";
import { useBoxProgress } from "./roomBoardLive";

/**
 * Which view a board shows, kept in the URL: as the host keeps it when it hands one down, else in
 * this page's own address.
 */
export function useBoardViewMode(
  view: BoardViewMode | undefined,
  onView: ((view: BoardViewMode) => void) | undefined,
): readonly [BoardViewMode, (view: BoardViewMode) => void] {
  const [own, setOwn] = useState<BoardViewMode>(() =>
    boardViewModeOf(new URLSearchParams(window.location.search).get(BOARD_VIEW_PARAM)),
  );
  const pick = useStableCallback((next: BoardViewMode) => {
    if (onView !== undefined) return onView(next);
    setOwn(next);
    const url = new URL(window.location.href);
    if (next === "board") url.searchParams.delete(BOARD_VIEW_PARAM);
    else url.searchParams.set(BOARD_VIEW_PARAM, next);
    window.history.replaceState(window.history.state, "", url);
  });
  return [view ?? own, pick];
}

const VIEWS: ReadonlyArray<{
  readonly view: BoardViewMode;
  readonly title: string;
  readonly icon: ReactNode;
}> = [
  { view: "board", title: "Board", icon: <ShapesIcon /> },
  { view: "plan", title: "Plan", icon: <SquareKanbanIcon /> },
  { view: "list", title: "List", icon: <ListIcon /> },
];

/** Board | Plan | List, in the board's header; only icons where the board is narrow. */
export function BoardViewSwitch({
  view,
  onView,
}: {
  readonly view: BoardViewMode;
  readonly onView: (view: BoardViewMode) => void;
}) {
  return (
    <ToggleGroup
      aria-label="View"
      value={[view]}
      onValueChange={(next) => {
        const picked = next[0];
        if (picked === "board" || picked === "plan" || picked === "list") onView(picked);
      }}
    >
      {VIEWS.map((one) => (
        <GroupToggle key={one.view} value={one.view} aria-label={one.title}>
          {one.icon}
          <span className="sr-only @3xl/board:not-sr-only">{one.title}</span>
        </GroupToggle>
      ))}
    </ToggleGroup>
  );
}

/** A thread box a task runs in, or has a line to, as its Plan card names it. */
export interface BoardPlanBox {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

interface PlanTaskActions {
  readonly onShow: () => void;
  readonly onRun: (() => void) | undefined;
  readonly onTake: (() => void) | undefined;
  readonly onDelete: (() => void) | undefined;
}

const SLOP = 5;
const TOUCH_HOLD_MS = 300;
const EDGE_SCROLL = 48;
const MANUAL_SORTS: Readonly<Record<RoomTaskStatus, BoardPlanSort>> = {
  todo: "manual",
  doing: "manual",
  done: "manual",
};
const NO_PICKS: ReadonlySet<string> = new Set();
const SORTS: ReadonlyArray<{ readonly sort: BoardPlanSort; readonly title: string }> = [
  { sort: "manual", title: "As ordered" },
  { sort: "priority", title: "Priority" },
  { sort: "due", title: "Due date" },
];

const isPicking = (event: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }) =>
  event.shiftKey || event.ctrlKey || event.metaKey;

/** Whether a key went to something that takes typing, or a dialog or menu that has its own keys. */
const typingIn = (target: EventTarget | null) =>
  target instanceof Element &&
  target.closest(
    'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"], [role="listbox"], [role="textbox"]',
  ) !== null;

/**
 * The board's tasks as columns (To do, In progress and Done) or as one list. Each card is the task
 * on the board, so a move here is a change to it there, seen by everyone as it happens.
 */
export function BoardPlan({
  layout,
  columns,
  attachments,
  people,
  guests,
  viewer,
  ownerAssignable,
  canEdit,
  cannotAdd,
  boxOf,
  workerOf,
  history,
  onAdd,
  onChange,
  onMove,
  onMoveAll,
  onDeleteAll,
  actionsOf,
  openTask = null,
  addStamp = 0,
}: {
  /** Each new stamp opens a new task to write in To do, as the command menu asks. */
  readonly addStamp?: number;
  /** A task to open, as an inbox item asks; each new `stamp` opens it again. */
  readonly openTask?: { readonly id: string; readonly stamp: number } | null;
  readonly layout: "columns" | "list";
  readonly columns: BoardPlanColumns;
  readonly attachments: ReadonlyMap<string, BoardPlanAttached>;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  /** Who is looking: a guest, or null for the owner. */
  readonly viewer: string | null;
  readonly ownerAssignable: boolean;
  readonly canEdit: boolean;
  /** Why no task can be added now, or null. */
  readonly cannotAdd: string | null;
  readonly boxOf: (task: RoomBoardNote) => BoardPlanBox | undefined;
  /** Whose agent works on the task now, on their own machine. */
  readonly workerOf: (task: RoomBoardNote) => string | undefined;
  /** The board's undo and redo, which take back moves here too. */
  readonly history: ReactNode;
  readonly onAdd: (status: RoomTaskStatus, text: string) => void;
  readonly onChange: (task: RoomBoardNote, update: (task: RoomBoardNote) => RoomBoardNote) => void;
  readonly onMove: (taskId: string, to: RoomTaskStatus, index: number) => void;
  /** Moves several tasks to the bottom of a column, together. */
  readonly onMoveAll: (taskIds: ReadonlySet<string>, to: RoomTaskStatus) => void;
  /** Deletes several tasks at once, as one step to undo. */
  readonly onDeleteAll: (taskIds: ReadonlyArray<string>) => void;
  readonly actionsOf: (task: RoomBoardNote) => PlanTaskActions;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [openedStamp, setOpenedStamp] = useState<number | null>(null);
  if (openTask !== null && openTask.stamp !== openedStamp) {
    setOpenedStamp(openTask.stamp);
    setEditing(openTask.id);
  }
  const [adding, setAdding] = useState<RoomTaskStatus | null>(null);
  const [addedStamp, setAddedStamp] = useState(addStamp);
  if (addStamp !== addedStamp) {
    setAddedStamp(addStamp);
    if (canEdit && cannotAdd === null) setAdding("todo");
  }
  const [filter, setFilter] = useState<BoardPlanFilter>(NO_PLAN_FILTER);
  const [sorts, setSorts] = useState(MANUAL_SORTS);
  const [listSort, setListSort] = useState<BoardPlanSort>("manual");
  const [pickedIds, setPicked] = useState<ReadonlySet<string>>(NO_PICKS);
  // A selection belongs to the view it was made in: the Plan's is let go of in the List.
  const [pickedIn, setPickedIn] = useState(layout);
  if (pickedIn !== layout) {
    setPickedIn(layout);
    setPicked(NO_PICKS);
  }
  // The task last clicked without Shift, where a Shift-click's range starts.
  const anchor = useRef<string | null>(null);
  const [lifted, setLifted] = useState<{ readonly id: string; readonly width: number } | null>(
    null,
  );
  const [drop, setDrop] = useState<{
    readonly status: RoomTaskStatus;
    readonly index: number;
  } | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const ghostAt = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const endDrag = useRef<(() => void) | null>(null);
  const clickBlocked = useRef(false);
  // The day the Plan opened on: a Plan left open past midnight reads due days a day behind.
  const [today] = useState(() => boardPlanToday(new Date()));
  const all = BOARD_PLAN_COLUMNS.flatMap(({ status }) => columns[status]);
  // Tasks someone else took off, or a filter hides, leave the picked ones.
  const picked: ReadonlySet<string> =
    pickedIds.size === 0
      ? NO_PICKS
      : new Set(
          all.flatMap((task) =>
            pickedIds.has(task.id) && boardPlanShows(task, filter) ? [task.id] : [],
          ),
        );
  const shownColumns: BoardPlanColumns = {
    todo: boardPlanSorted(
      columns.todo.filter((task) => boardPlanShows(task, filter)),
      sorts.todo,
    ),
    doing: boardPlanSorted(
      columns.doing.filter((task) => boardPlanShows(task, filter)),
      sorts.doing,
    ),
    done: boardPlanSorted(
      columns.done.filter((task) => boardPlanShows(task, filter)),
      sorts.done,
    ),
  };
  const editingTask = editing === null ? undefined : all.find((task) => task.id === editing);
  const liftedTask = lifted === null ? undefined : all.find((task) => task.id === lifted.id);
  const pickedTasks = all.filter((task) => picked.has(task.id));
  const changePicked = (update: (task: RoomBoardNote) => RoomBoardNote) => {
    for (const task of pickedTasks) onChange(task, update);
  };
  // Only this person's own tasks go, or any for the owner; the rest stay selected.
  const deletePicked = () => {
    const removable = pickedTasks.filter((task) => actionsOf(task).onDelete !== undefined);
    if (removable.length === 0) return;
    onDeleteAll(removable.map((task) => task.id));
    setPicked(
      new Set(pickedTasks.filter((task) => !removable.includes(task)).map((task) => task.id)),
    );
  };
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a drag's window listeners outlive the Plan unless it ends them as it closes
  useEffect(() => () => endDrag.current?.(), []);
  const quickAdd = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "Escape" && pickedIds.size > 0 && !typingIn(event.target)) {
      setPicked(NO_PICKS);
      return;
    }
    if (
      (event.key === "Delete" || event.key === "Backspace") &&
      pickedIds.size > 0 &&
      editing === null &&
      !typingIn(event.target)
    ) {
      event.preventDefault();
      deletePicked();
      return;
    }
    const key = event.key.toLowerCase();
    if ((key !== "c" && key !== "n") || typingIn(event.target)) return;
    if (!canEdit || cannotAdd !== null || editing !== null) return;
    event.preventDefault();
    setAdding("todo");
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- C or N starts a task wherever focus rests on the page, which only the window hears
  useEffect(() => {
    window.addEventListener("keydown", quickAdd);
    return () => window.removeEventListener("keydown", quickAdd);
  }, [quickAdd]);

  const placeGhost = (element: HTMLDivElement | null) => {
    if (element === null) return;
    const { x, y } = ghostAt.current;
    element.style.transform = `translate(${x}px, ${y}px) rotate(1.5deg)`;
  };

  const press = (event: ReactPointerEvent<HTMLElement>, task: RoomBoardNote) => {
    if (!canEdit || event.button !== 0 || endDrag.current !== null || isPicking(event)) return;
    // A press in the card's menu, drawn elsewhere on the page, still bubbles here through React.
    if (
      !(event.target instanceof Element) ||
      !event.currentTarget.contains(event.target) ||
      event.target.closest("[data-plan-no-drag]") !== null
    ) {
      return;
    }
    const pointerId = event.pointerId;
    const rect = event.currentTarget.getBoundingClientRect();
    const start = { x: event.clientX, y: event.clientY };
    const grip = { x: start.x - rect.left, y: start.y - rect.top };
    let held = event.pointerType !== "touch";
    let started = false;
    let target: { status: RoomTaskStatus; index: number } | null = null;
    const aim = (x: number, y: number) => {
      ghostAt.current = { x: x - grip.x, y: y - grip.y };
      placeGhost(ghostRef.current);
      const scroller = scrollerRef.current;
      if (scroller !== null) {
        const box = scroller.getBoundingClientRect();
        if (x < box.left + EDGE_SCROLL) scroller.scrollBy({ left: -24 });
        else if (x > box.right - EDGE_SCROLL) scroller.scrollBy({ left: 24 });
      }
      const column = document
        .elementsFromPoint(x, y)
        .find(
          (element): element is HTMLElement =>
            element instanceof HTMLElement && element.dataset.planColumn !== undefined,
        );
      const list = column?.querySelector<HTMLElement>("[data-plan-list]");
      if (list !== null && list !== undefined) {
        const box = list.getBoundingClientRect();
        if (y < box.top + EDGE_SCROLL) list.scrollBy({ top: -16 });
        else if (y > box.bottom - EDGE_SCROLL) list.scrollBy({ top: 16 });
      }
      const status = column?.dataset.planColumn;
      const next =
        status === "todo" || status === "doing" || status === "done"
          ? {
              status,
              index: [...(column?.querySelectorAll<HTMLElement>("[data-plan-card]") ?? [])].filter(
                (card) => {
                  if (card.dataset.planCard === task.id) return false;
                  const drawn = card.getBoundingClientRect();
                  return drawn.top + drawn.height / 2 < y;
                },
              ).length,
            }
          : null;
      if (next?.status !== target?.status || next?.index !== target?.index) {
        target = next;
        setDrop(next);
      }
    };
    const lift = (x: number, y: number) => {
      started = true;
      ghostAt.current = { x: x - grip.x, y: y - grip.y };
      setLifted({ id: task.id, width: rect.width });
      aim(x, y);
    };
    const timer = held
      ? null
      : setTimeout(() => {
          held = true;
          lift(start.x, start.y);
        }, TOUCH_HOLD_MS);
    const move = (moved: PointerEvent) => {
      if (moved.pointerId !== pointerId) return;
      if (!started) {
        if (Math.hypot(moved.clientX - start.x, moved.clientY - start.y) <= SLOP) return;
        // A finger that moves before it is held scrolls the Plan instead.
        if (!held) return end();
        lift(moved.clientX, moved.clientY);
        return;
      }
      aim(moved.clientX, moved.clientY);
    };
    const hold = (touch: TouchEvent) => {
      if (started) touch.preventDefault();
    };
    const up = (released: PointerEvent) => {
      if (released.pointerId !== pointerId) return;
      if (started) {
        // The click that ends a drag opens nothing; the browser sends it before this clears.
        clickBlocked.current = true;
        setTimeout(() => {
          clickBlocked.current = false;
        }, 0);
        if (target !== null) {
          // A sorted column keeps its own order: a task dropped there goes to the bottom.
          const index =
            sorts[target.status] === "manual"
              ? boardPlanIndexAmong(
                  columns[target.status],
                  shownColumns[target.status],
                  task.id,
                  target.index,
                )
              : columns[target.status].filter((other) => other.id !== task.id).length;
          onMove(task.id, target.status, index);
        }
      }
      end();
    };
    const key = (pressed: KeyboardEvent) => {
      if (pressed.key !== "Escape" || !started) return;
      pressed.preventDefault();
      target = null;
      end();
    };
    const end = () => {
      if (timer !== null) clearTimeout(timer);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("touchmove", hold);
      endDrag.current = null;
      setLifted(null);
      setDrop(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", key, true);
    window.addEventListener("touchmove", hold, { passive: false });
    endDrag.current = end;
  };

  const listRows = boardPlanSorted(
    BOARD_PLAN_COLUMNS.flatMap(({ status }) =>
      columns[status].filter((task) => boardPlanShows(task, filter)),
    ),
    listSort,
  );
  // The order Shift-click selects along: down each column in turn, or down the list.
  const shownOrder = (
    layout === "list" ? listRows : BOARD_PLAN_COLUMNS.flatMap(({ status }) => shownColumns[status])
  ).map((task) => task.id);
  // Ctrl or Cmd+A selects every task shown, as on the board.
  const pickAll = useStableCallback((event: KeyboardEvent) => {
    if (
      !(event.ctrlKey || event.metaKey) ||
      event.altKey ||
      event.shiftKey ||
      event.key.toLowerCase() !== "a" ||
      !canEdit ||
      event.defaultPrevented ||
      typingIn(event.target)
    ) {
      return;
    }
    event.preventDefault();
    setPicked(new Set(shownOrder));
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Ctrl+A selects the tasks wherever focus rests on the page, which only the window hears
  useEffect(() => {
    window.addEventListener("keydown", pickAll);
    return () => window.removeEventListener("keydown", pickAll);
  }, [pickAll]);
  // A click selects a task, Ctrl, Cmd or Shift adds to the selection, and a click on the task
  // selected alone, or a double-click, opens it.
  const open = (event: ReactMouseEvent, task: RoomBoardNote) => {
    if (clickBlocked.current) return;
    if (!canEdit) return setEditing(task.id);
    const next = boardPlanPick(picked, anchor.current, task.id, event, shownOrder);
    if (!event.shiftKey) anchor.current = task.id;
    setPicked(next.picked);
    if (next.open) setEditing(task.id);
  };
  const moveTo = (task: RoomBoardNote, to: RoomTaskStatus) => {
    if (picked.has(task.id) && picked.size > 1) return onMoveAll(picked, to);
    onMove(task.id, to, columns[to].filter((other) => other.id !== task.id).length);
  };
  const cardOf = (task: RoomBoardNote) => ({
    task,
    attached: attachments.get(task.id),
    box: boxOf(task),
    worker: workerOf(task),
    people,
    guests,
    today,
  });

  const total = all.length;
  const toolbar = (
    <PlanToolbar
      history={history}
      total={total}
      shown={BOARD_PLAN_COLUMNS.reduce((sum, { status }) => sum + shownColumns[status].length, 0)}
      filter={filter}
      onFilter={setFilter}
      people={people}
      guests={guests}
      viewer={viewer}
      ownerAssignable={ownerAssignable}
      picked={picked}
      onMoveAll={(to) => onMoveAll(picked, to)}
      onPriority={(priority) =>
        changePicked(({ priority: _priority, ...rest }) =>
          priority === undefined ? rest : { ...rest, priority },
        )
      }
      onAssign={(assignee) =>
        changePicked(({ assignee: _assignee, ...rest }) =>
          assignee === undefined ? rest : { ...rest, assignee },
        )
      }
      onDelete={
        pickedTasks.some((task) => actionsOf(task).onDelete !== undefined)
          ? deletePicked
          : undefined
      }
      onClearPicked={() => setPicked(NO_PICKS)}
    />
  );
  if (total === 0 && adding === null) {
    return (
      <PlanFrame toolbar={toolbar}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Plan the work</EmptyTitle>
            <EmptyDescription>
              {canEdit ? (
                <>
                  The Plan shows this board&apos;s tasks to move through, and every task you add
                  here is a card on the board too.{" "}
                  <span className="pointer-coarse:hidden">Press C to add one.</span>
                  <span className="hidden pointer-coarse:inline">Tap + to add one.</span>
                </>
              ) : (
                "The Plan shows this board's tasks to move through. This board has none yet."
              )}
            </EmptyDescription>
          </EmptyHeader>
          {canEdit ? (
            <>
              <Button disabled={cannotAdd !== null} onClick={() => setAdding("todo")}>
                <PlusIcon />
                Add a task
              </Button>
              {cannotAdd === null ? null : (
                <p className="text-xs text-muted-foreground">{cannotAdd}</p>
              )}
            </>
          ) : null}
        </Empty>
      </PlanFrame>
    );
  }

  const dialog =
    editingTask === undefined ? null : (
      <PlanTaskDialog
        key={editingTask.id}
        task={editingTask}
        attached={attachments.get(editingTask.id)}
        people={people}
        guests={guests}
        ownerAssignable={ownerAssignable}
        canEdit={canEdit}
        actions={actionsOf(editingTask)}
        onChange={onChange}
        onStatus={(status) =>
          onMove(
            editingTask.id,
            status,
            columns[status].filter((task) => task.id !== editingTask.id).length,
          )
        }
        onClose={() => setEditing(null)}
      />
    );

  if (layout === "list") {
    const rows = listRows;
    return (
      <PlanFrame toolbar={toolbar}>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 pb-3 scrollbar-gutter-both">
          <div className="mx-auto flex w-full max-w-4xl flex-col rounded-board border border-board-hairline bg-card">
            <div className="flex items-center gap-2 border-b border-board-hairline px-3 py-1.5 text-2xs font-medium text-muted-foreground">
              <span className="min-w-0 flex-1">Task</span>
              <span className="hidden w-28 sm:block">For</span>
              <span className="w-20">Priority</span>
              <span className="hidden w-28 sm:block">Due</span>
              <SortMenu sort={listSort} onSort={setListSort} label="Sort the list" />
            </div>
            <ol aria-label="Tasks">
              {rows.map((task) => (
                <PlanListRow
                  key={task.id}
                  {...cardOf(task)}
                  picked={picked.has(task.id)}
                  canEdit={canEdit}
                  actions={actionsOf(task)}
                  pickedCount={picked.has(task.id) ? picked.size : 1}
                  onMoveTo={(to) => moveTo(task, to)}
                  onOpen={(event) => open(event, task)}
                />
              ))}
            </ol>
            {rows.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No task matches. Clear the filters to see every task.
              </p>
            ) : null}
            {canEdit ? (
              <div className="border-t border-board-hairline">
                <PlanAdd
                  status="todo"
                  open={adding !== null}
                  cannotAdd={cannotAdd}
                  onOpen={() => setAdding("todo")}
                  onClose={() => setAdding(null)}
                  onAdd={(text) => onAdd("todo", text)}
                />
              </div>
            ) : null}
          </div>
        </div>
        {dialog}
      </PlanFrame>
    );
  }

  return (
    <PlanFrame toolbar={toolbar}>
      <div
        ref={scrollerRef}
        className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-3 sm:snap-none"
      >
        {BOARD_PLAN_COLUMNS.map(({ status, title }) => {
          const tasks = shownColumns[status];
          const column = columns[status];
          const manual = sorts[status] === "manual";
          const dropHere = drop?.status === status ? drop.index : null;
          const lineAt = manual ? dropHere : null;
          let shownAt = 0;
          return (
            <section
              key={status}
              aria-label={title}
              data-plan-column={status}
              className={cn(
                "flex max-h-full w-[min(20rem,calc(100vw-3rem))] shrink-0 snap-center flex-col rounded-board border border-board-hairline bg-card/60",
                dropHere !== null && "border-primary/50",
              )}
            >
              <header className="flex items-center gap-2 px-3 pt-2 pb-1">
                <PlanStatusMark status={status} />
                <h2 className="text-sm font-semibold">{title}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {tasks.length === column.length
                    ? column.length
                    : `${tasks.length} of ${column.length}`}
                </span>
                <span className="ms-auto">
                  <SortMenu
                    sort={sorts[status]}
                    onSort={(sort) => setSorts((current) => ({ ...current, [status]: sort }))}
                    label={`Sort ${title}`}
                  />
                </span>
              </header>
              <ol data-plan-list className="flex min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-1">
                {tasks.map((task) => {
                  const placeholder = lifted?.id === task.id;
                  const before = !placeholder && lineAt === shownAt;
                  if (!placeholder) shownAt += 1;
                  const index = column.findIndex((other) => other.id === task.id);
                  return (
                    <li key={task.id} className="flex flex-col gap-2">
                      {before ? <DropLine /> : null}
                      <PlanCard
                        {...cardOf(task)}
                        canEdit={canEdit}
                        placeholder={placeholder}
                        picked={picked.has(task.id)}
                        pickedCount={picked.has(task.id) ? picked.size : 1}
                        status={status}
                        canMoveUp={manual && index > 0}
                        canMoveDown={manual && index >= 0 && index < column.length - 1}
                        actions={actionsOf(task)}
                        onMoveTo={(to) => moveTo(task, to)}
                        onMoveBy={(by) => onMove(task.id, status, index + by)}
                        onOpen={(event) => open(event, task)}
                        onPress={(event) => press(event, task)}
                      />
                    </li>
                  );
                })}
                {lineAt !== null && lineAt >= shownAt ? (
                  <li>
                    <DropLine />
                  </li>
                ) : null}
              </ol>
              {canEdit ? (
                <PlanAdd
                  status={status}
                  open={adding === status}
                  cannotAdd={cannotAdd}
                  onOpen={() => setAdding(status)}
                  onClose={() => setAdding((current) => (current === status ? null : current))}
                  onAdd={(text) => onAdd(status, text)}
                />
              ) : null}
            </section>
          );
        })}
      </div>
      {liftedTask === undefined || lifted === null
        ? null
        : createPortal(
            <div
              ref={(element) => {
                ghostRef.current = element;
                placeGhost(element);
              }}
              aria-hidden
              className="pointer-events-none fixed top-0 left-0 z-[140]"
              style={{ width: lifted.width }}
            >
              <PlanCardBody {...cardOf(liftedTask)} lifted />
            </div>,
            document.body,
          )}
      {dialog}
    </PlanFrame>
  );
}

function PlanFrame({
  toolbar,
  children,
}: {
  readonly toolbar: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      {toolbar}
      {children}
    </div>
  );
}

const EVERYONE = "everyone";
const NOBODY = "nobody";
const OWNER = "owner";

/** Whose tasks and done ones, after the search or, with tasks picked, what to do with them. */
function PlanToolbar({
  history,
  total,
  shown,
  filter,
  onFilter,
  people,
  guests,
  viewer,
  ownerAssignable,
  picked,
  onMoveAll,
  onPriority,
  onAssign,
  onDelete,
  onClearPicked,
}: {
  readonly history: ReactNode;
  readonly total: number;
  readonly shown: number;
  readonly filter: BoardPlanFilter;
  readonly onFilter: (filter: BoardPlanFilter) => void;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string | null;
  readonly ownerAssignable: boolean;
  readonly picked: ReadonlySet<string>;
  readonly onMoveAll: (to: RoomTaskStatus) => void;
  /** Undefined clears it. */
  readonly onPriority: (priority: RoomTaskPriority | undefined) => void;
  readonly onAssign: (assignee: RoomBoardAssignee | undefined) => void;
  /** Absent when none of the selected tasks is this person's to delete. */
  readonly onDelete: (() => void) | undefined;
  readonly onClearPicked: () => void;
}) {
  const person = filter.person;
  const personValue =
    person === null ? EVERYONE : person === "nobody" ? NOBODY : (person.guestId ?? OWNER);
  const mine = person !== null && person !== "nobody" && person.guestId === viewer;
  const choices = [
    ...(ownerAssignable ? [OWNER] : []),
    ...guests.map((guest) => guest.id as string),
  ];
  const nameOf = (value: string) =>
    value === EVERYONE
      ? "Everyone"
      : value === NOBODY
        ? "No one"
        : boardPersonName(people, value === OWNER ? undefined : value);
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 pt-1 pb-2">
      {picked.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span role="status" className="text-xs font-medium">
            {picked.size} selected
          </span>
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>Move to</MenuTrigger>
            <MenuPopup align="start">
              {BOARD_PLAN_COLUMNS.map((column) => (
                <MenuItem key={column.status} onClick={() => onMoveAll(column.status)}>
                  <PlanStatusMark status={column.status} />
                  {column.title}
                </MenuItem>
              ))}
            </MenuPopup>
          </Menu>
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>Priority</MenuTrigger>
            <MenuPopup align="start">
              {BOARD_PLAN_PRIORITIES.map((one) => (
                <MenuItem key={one.priority} onClick={() => onPriority(one.priority)}>
                  <TaskPriorityIcon priority={one.priority} />
                  {one.title}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onClick={() => onPriority(undefined)}>No priority</MenuItem>
            </MenuPopup>
          </Menu>
          <Menu>
            <MenuTrigger render={<Button size="xs" variant="outline" />}>Assign</MenuTrigger>
            <MenuPopup align="start">
              {ownerAssignable ? (
                <MenuItem onClick={() => onAssign({})}>{nameOf(OWNER)}</MenuItem>
              ) : null}
              {guests.map((guest) => (
                <MenuItem key={guest.id} onClick={() => onAssign({ guestId: guest.id })}>
                  {nameOf(guest.id)}
                </MenuItem>
              ))}
              <MenuSeparator />
              <MenuItem onClick={() => onAssign(undefined)}>No one</MenuItem>
            </MenuPopup>
          </Menu>
          {onDelete === undefined ? null : (
            <Button size="xs" variant="ghost-destructive" onClick={onDelete}>
              <Trash2Icon />
              Delete
            </Button>
          )}
          <Button size="xs" variant="ghost" onClick={onClearPicked}>
            Clear
          </Button>
        </div>
      ) : (
        <div className="w-full sm:w-56">
          <Input
            size="sm"
            type="search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={filter.text}
            onChange={(event) => onFilter({ ...filter, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Escape" && filter.text !== "") {
                event.preventDefault();
                onFilter({ ...filter, text: "" });
              }
            }}
          />
        </div>
      )}
      <div className="w-36">
        <Select
          value={personValue}
          onValueChange={(next) => {
            if (typeof next !== "string") return;
            onFilter({
              ...filter,
              person:
                next === EVERYONE
                  ? null
                  : next === NOBODY
                    ? "nobody"
                    : { guestId: next === OWNER ? null : next },
            });
          }}
        >
          <SelectTrigger size="sm" aria-label="Whose tasks">
            <SelectValue>{nameOf(personValue)}</SelectValue>
          </SelectTrigger>
          <SelectPopup>
            <SelectItem value={EVERYONE}>Everyone</SelectItem>
            <SelectItem value={NOBODY}>No one</SelectItem>
            {choices.map((choice) => (
              <SelectItem key={choice} value={choice}>
                {nameOf(choice)}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
      <Toggle
        size="sm"
        variant="outline"
        pressed={mine}
        onPressedChange={(pressed) =>
          onFilter({ ...filter, person: pressed ? { guestId: viewer } : null })
        }
      >
        Only mine
      </Toggle>
      <Toggle
        size="sm"
        variant="outline"
        pressed={filter.hideDone}
        onPressedChange={(hideDone) => onFilter({ ...filter, hideDone })}
      >
        Hide done
      </Toggle>
      {isPlanFiltered(filter) ? (
        <Button size="xs" variant="ghost-muted" onClick={() => onFilter(NO_PLAN_FILTER)}>
          <XIcon />
          {shown} of {total}
        </Button>
      ) : picked.size > 0 ? null : (
        <p className="hidden text-xs text-muted-foreground sm:block">
          {total === 1 ? "1 task" : `${total} tasks`}
        </p>
      )}
      <div className="ms-auto flex items-center gap-0.5">{history}</div>
    </div>
  );
}

function SortMenu({
  sort,
  onSort,
  label,
}: {
  readonly sort: BoardPlanSort;
  readonly onSort: (sort: BoardPlanSort) => void;
  readonly label: string;
}) {
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size="icon-xs"
            variant={sort === "manual" ? "ghost-muted" : "ghost"}
            aria-label={label}
            title={label}
          />
        }
      >
        <ArrowDownWideNarrowIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuGroup>
          <MenuGroupLabel>Sort by</MenuGroupLabel>
          <MenuRadioGroup
            value={sort}
            onValueChange={(next) => {
              if (next === "manual" || next === "priority" || next === "due") onSort(next);
            }}
          >
            {SORTS.map((one) => (
              <MenuRadioItem key={one.sort} value={one.sort}>
                {one.title}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
        </MenuGroup>
      </MenuPopup>
    </Menu>
  );
}

const DropLine = () => <div aria-hidden className="mx-1 h-0.5 shrink-0 rounded-full bg-primary" />;

const STATUS_TONE: Readonly<Record<RoomTaskStatus, string>> = {
  todo: "border-muted-foreground/60",
  doing: "border-primary border-e-transparent",
  done: "border-success bg-success",
};

function PlanStatusMark({ status }: { readonly status: RoomTaskStatus }) {
  return (
    <span
      aria-hidden
      className={cn("size-3 shrink-0 rounded-full border-2", STATUS_TONE[status])}
    />
  );
}

function PlanAdd({
  status,
  open,
  cannotAdd,
  onOpen,
  onClose,
  onAdd,
}: {
  readonly status: RoomTaskStatus;
  readonly open: boolean;
  readonly cannotAdd: string | null;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  readonly onAdd: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");
  if (!open) {
    return (
      <div className="flex px-2 pt-1 pb-2">
        <WhyNot reason={cannotAdd}>
          <Button
            size="sm"
            variant="ghost-muted"
            disabled={cannotAdd !== null}
            onClick={onOpen}
            title={status === "todo" ? "Add a task (C)" : undefined}
          >
            <PlusIcon />
            Add a task
          </Button>
        </WhyNot>
      </div>
    );
  }
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (text === "" || cannotAdd !== null) return;
    onAdd(text);
    setDraft("");
  };
  return (
    <form className="flex flex-col gap-1 px-2 pt-1 pb-2" onSubmit={submit}>
      <Input
        size="sm"
        autoFocus
        aria-label={`New task in ${BOARD_PLAN_COLUMNS.find((column) => column.status === status)?.title ?? "this column"}`}
        placeholder="Write a task, then press Enter"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            setDraft("");
            onClose();
          }
        }}
        onBlur={() => {
          if (draft.trim() === "") onClose();
        }}
      />
      {cannotAdd === null ? null : (
        <p className="px-1 text-2xs text-muted-foreground">{cannotAdd}</p>
      )}
    </form>
  );
}

interface PlanCardShows {
  readonly task: RoomBoardNote;
  readonly attached: BoardPlanAttached | undefined;
  readonly box: BoardPlanBox | undefined;
  readonly worker: string | undefined;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly today: string;
}

/** The task's menu: where to move it, or the picked tasks with it, and what else it does. */
function PlanCardMenu({
  label,
  status,
  canEdit,
  pickedCount,
  canMoveUp,
  canMoveDown,
  actions,
  onMoveTo,
  onMoveBy,
  open,
  onOpenChange,
}: {
  readonly label: string;
  readonly status: RoomTaskStatus;
  readonly canEdit: boolean;
  readonly pickedCount: number;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly actions: PlanTaskActions;
  readonly onMoveTo: (to: RoomTaskStatus) => void;
  readonly onMoveBy: ((by: number) => void) | undefined;
  /** Held by the card, so a right-click on it opens this menu too. */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) {
  return (
    <Menu open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
        render={<Button size="icon-xs" variant="ghost" aria-label={`Actions for ${label}`} />}
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        {canEdit ? (
          <>
            <MenuGroup>
              <MenuGroupLabel>
                {pickedCount > 1 ? `Move ${pickedCount} picked tasks to` : "Move to"}
              </MenuGroupLabel>
              {BOARD_PLAN_COLUMNS.map((target) => (
                <MenuItem
                  key={target.status}
                  disabled={pickedCount <= 1 && target.status === status}
                  onClick={() => onMoveTo(target.status)}
                >
                  <PlanStatusMark status={target.status} />
                  {target.title}
                </MenuItem>
              ))}
            </MenuGroup>
            {onMoveBy === undefined ? null : (
              <>
                <MenuItem disabled={!canMoveUp} onClick={() => onMoveBy(-1)}>
                  <ArrowUpIcon />
                  Move up
                </MenuItem>
                <MenuItem disabled={!canMoveDown} onClick={() => onMoveBy(1)}>
                  <ArrowDownIcon />
                  Move down
                </MenuItem>
              </>
            )}
            <MenuSeparator />
          </>
        ) : null}
        <PlanTaskMenuActions actions={actions} />
      </MenuPopup>
    </Menu>
  );
}

function PlanCard({
  canEdit,
  placeholder,
  picked,
  pickedCount,
  status,
  canMoveUp,
  canMoveDown,
  actions,
  onMoveTo,
  onMoveBy,
  onOpen,
  onPress,
  ...shows
}: PlanCardShows & {
  readonly canEdit: boolean;
  readonly placeholder: boolean;
  readonly picked: boolean;
  readonly pickedCount: number;
  readonly status: RoomTaskStatus;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
  readonly actions: PlanTaskActions;
  readonly onMoveTo: (to: RoomTaskStatus) => void;
  readonly onMoveBy: (by: number) => void;
  readonly onOpen: (event: ReactMouseEvent) => void;
  readonly onPress: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const label = shows.task.text.trim() || "Untitled task";
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <div
      data-plan-card={shows.task.id}
      className={cn(
        "group/plan relative select-none [-webkit-touch-callout:none]",
        placeholder && "opacity-40",
      )}
      onPointerDown={onPress}
      onContextMenu={(event) => {
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <PlanCardBody {...shows} picked={picked} />
      <button
        type="button"
        aria-label={`Task: ${label}`}
        aria-pressed={picked}
        className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
      />
      <div
        data-plan-no-drag
        className="absolute top-1.5 right-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 group-hover/plan:opacity-100 group-focus-within/plan:opacity-100 has-[[data-popup-open]]:opacity-100"
      >
        <PlanCardMenu
          label={label}
          status={status}
          canEdit={canEdit}
          pickedCount={pickedCount}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          actions={actions}
          onMoveTo={onMoveTo}
          onMoveBy={onMoveBy}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      </div>
    </div>
  );
}

/** One task as a row of the List: status, title, who it is for, priority and due day. */
function PlanListRow({
  canEdit,
  picked,
  pickedCount,
  actions,
  onMoveTo,
  onOpen,
  ...shows
}: PlanCardShows & {
  readonly canEdit: boolean;
  readonly picked: boolean;
  readonly pickedCount: number;
  readonly actions: PlanTaskActions;
  readonly onMoveTo: (to: RoomTaskStatus) => void;
  readonly onOpen: (event: ReactMouseEvent) => void;
}) {
  const { task, people, guests, today } = shows;
  const status = roomTaskStatus(task);
  const done = task.done === true;
  const label = task.text.trim() || "Untitled task";
  const assignee = task.assignee;
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li
      className={cn(
        "group/plan relative flex min-h-10 items-center gap-2 border-b border-board-hairline px-3 py-1.5 last:border-b-0 hover:bg-accent/40",
        picked && "bg-primary/8",
      )}
      onContextMenu={(event) => {
        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;
        event.preventDefault();
        setMenuOpen(true);
      }}
    >
      <PlanStatusMark status={status} />
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          done && "text-muted-foreground line-through",
          task.text.trim() === "" && "text-muted-foreground italic",
        )}
      >
        {label}
      </span>
      <span className="hidden w-28 min-w-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
        {assignee === undefined ? null : (
          <>
            <PersonDot
              color={boardCursorColor(guests, assignee.guestId)}
              className="size-4 text-4xs font-semibold"
            >
              {boardPersonName(people, assignee.guestId).charAt(0).toUpperCase()}
            </PersonDot>
            <span className="truncate">{boardPersonName(people, assignee.guestId)}</span>
          </>
        )}
      </span>
      <span className="flex w-20">
        {task.priority === undefined ? null : <TaskPriorityMark priority={task.priority} />}
      </span>
      <span className="hidden w-28 sm:flex">
        {task.due === undefined ? null : <TaskDueChip due={task.due} today={today} done={done} />}
      </span>
      <button
        type="button"
        aria-label={`Task: ${label}`}
        aria-pressed={picked}
        className="absolute inset-0 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
      />
      <span className="relative">
        <PlanCardMenu
          label={label}
          status={status}
          canEdit={canEdit}
          pickedCount={pickedCount}
          canMoveUp={false}
          canMoveDown={false}
          actions={actions}
          onMoveTo={onMoveTo}
          onMoveBy={undefined}
          open={menuOpen}
          onOpenChange={setMenuOpen}
        />
      </span>
    </li>
  );
}

function PlanTaskMenuActions({ actions }: { readonly actions: PlanTaskActions }) {
  return (
    <>
      {actions.onRun === undefined ? null : (
        <MenuItem onClick={actions.onRun}>
          <PlayIcon />
          Run with an agent
        </MenuItem>
      )}
      {actions.onTake === undefined ? null : (
        <MenuItem onClick={actions.onTake}>
          <BotIcon />
          Take it to my agent
        </MenuItem>
      )}
      <MenuItem onClick={actions.onShow}>
        <LocateFixedIcon />
        Show on board
      </MenuItem>
      {actions.onDelete === undefined ? null : (
        <>
          <MenuSeparator />
          <MenuItem variant="destructive" onClick={actions.onDelete}>
            <Trash2Icon />
            Delete
          </MenuItem>
        </>
      )}
    </>
  );
}

/** What a Plan card shows of its task, also on the copy that follows a drag. */
function PlanCardBody({
  task,
  attached,
  box,
  worker,
  people,
  guests,
  today,
  lifted = false,
  picked = false,
}: PlanCardShows & { readonly lifted?: boolean; readonly picked?: boolean }) {
  const done = task.done === true;
  const line = boardPlanAttachedLine(attached);
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-board-hairline bg-card p-3 text-card-foreground shadow-xs",
        lifted && "shadow-board ring-2 ring-primary/40",
        picked && "ring-2 ring-primary",
      )}
    >
      <p
        className={cn(
          "line-clamp-3 pe-6 text-sm leading-snug [overflow-wrap:anywhere]",
          done && "text-muted-foreground",
          task.text.trim() === "" && "text-muted-foreground italic",
        )}
      >
        {task.text.trim() || "Untitled task"}
      </p>
      {worker === undefined ? null : (
        <p role="status" className="text-2xs text-muted-foreground first-letter:uppercase">
          {worker} is working on this
        </p>
      )}
      {box === undefined ? null : <PlanBoxLine box={box} running={task.run !== undefined} />}
      {task.answer === undefined || done ? null : (
        <p className="truncate text-2xs text-muted-foreground">
          <span className="font-medium">Answered:</span> {task.answer.excerpt}
        </p>
      )}
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-muted-foreground">
        {task.priority === undefined ? null : <TaskPriorityMark priority={task.priority} />}
        {task.due === undefined ? null : <TaskDueChip due={task.due} today={today} done={done} />}
        {line === "" ? null : (
          <span className="flex items-center gap-1">
            {attached !== undefined && attached.notes > 0 ? (
              <StickyNoteIcon aria-hidden className="size-3" />
            ) : attached !== undefined && attached.links > 0 ? (
              <LinkIcon aria-hidden className="size-3" />
            ) : (
              <AppWindowIcon aria-hidden className="size-3" />
            )}
            {line}
          </span>
        )}
        {task.assignee === undefined ? null : (
          <span className="ms-auto">
            <TaskAssigneeDot
              assignee={task.assignee}
              name={boardPersonName(people, task.assignee.guestId)}
              color={boardCursorColor(guests, task.assignee.guestId)}
            />
          </span>
        )}
      </div>
    </div>
  );
}

/** The box a task runs in, with its agent's live progress while it works. */
function PlanBoxLine({ box, running }: { readonly box: BoardPlanBox; readonly running: boolean }) {
  const progress = useBoxProgress(box.id);
  if (progress === undefined && !running) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-2xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1">
        <PersonDot color={box.color} className="size-1.5" />
        <span className="max-w-32 truncate">{box.name}</span>
      </span>
      {progress === undefined ? null : (
        <BoardChip tone={progress.phase === "approval" ? "warning" : "primary"}>
          <BoardProgressLine progress={progress} />
        </BoardChip>
      )}
    </div>
  );
}

const NO_ONE = "none";
const NO_PRIORITY = "none";

function PlanTaskDialog({
  task,
  attached,
  people,
  guests,
  ownerAssignable,
  canEdit,
  actions,
  onChange,
  onStatus,
  onClose,
}: {
  readonly task: RoomBoardNote;
  readonly attached: BoardPlanAttached | undefined;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly ownerAssignable: boolean;
  readonly canEdit: boolean;
  readonly actions: PlanTaskActions;
  readonly onChange: (task: RoomBoardNote, update: (task: RoomBoardNote) => RoomBoardNote) => void;
  readonly onStatus: (status: RoomTaskStatus) => void;
  readonly onClose: () => void;
}) {
  // Null until this person types, so an edit someone else makes meanwhile shows and stays.
  const [draft, setDraft] = useState<string | null>(null);
  // People picked with `@` since the last save.
  const [picked, setPicked] = useState<ReadonlyArray<RoomBoardMention>>([]);
  const mention = useMentionPicker((pick) => {
    setDraft(pick.text.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH));
    setPicked((current) => [...current, pick.mention]);
  });
  const saveText = () => {
    if (!canEdit || draft === null) return;
    setDraft(null);
    setPicked([]);
    if (draft === task.text && picked.length === 0) return;
    onChange(task, (current) => {
      const mentions = roomMentionsIn([...(current.mentions ?? []), ...picked], draft);
      return current.mentions === undefined && mentions.length === 0
        ? { ...current, text: draft }
        : { ...current, text: draft, mentions };
    });
  };
  const close = () => {
    saveText();
    onClose();
  };
  const then = (action: () => void) => () => {
    close();
    action();
  };
  const status = roomTaskStatus(task);
  const assignee = task.assignee === undefined ? NO_ONE : (task.assignee.guestId ?? OWNER);
  const choices: ReadonlyArray<RoomBoardAssignee> = [
    ...(ownerAssignable ? [{}] : []),
    ...guests.map((guest) => ({ guestId: guest.id })),
  ];
  const assign = (value: string) => {
    const choice = choices.find((one) => (one.guestId ?? OWNER) === value);
    onChange(task, ({ assignee: _assignee, ...rest }) =>
      choice === undefined ? rest : { ...rest, assignee: choice },
    );
  };
  const setDue = (due: string) =>
    onChange(task, ({ due: _due, ...rest }) => (due === "" ? rest : { ...rest, due }));
  const setPriority = (value: string) => {
    const picked = BOARD_PLAN_PRIORITIES.find((one) => one.priority === value)?.priority;
    onChange(task, ({ priority: _priority, ...rest }) =>
      picked === undefined ? rest : { ...rest, priority: picked },
    );
  };
  const line = boardPlanAttachedLine(attached);
  const nameOf = (value: string) =>
    value === NO_ONE ? "No one" : boardPersonName(people, value === OWNER ? undefined : value);
  const priorityName = (value: RoomTaskPriority | undefined) =>
    BOARD_PLAN_PRIORITIES.find((one) => one.priority === value)?.title ?? "No priority";
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Task</DialogTitle>
          <DialogDescription>
            Added by{" "}
            {task.agent === undefined
              ? boardPersonName(people, task.guestId)
              : boardAgentName(people, task.guestId)}
            {line === "" ? "" : ` · joined to ${line}`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <Textarea
            aria-label="Task"
            rows={3}
            value={draft ?? task.text}
            readOnly={!canEdit}
            placeholder="Write a task"
            onChange={(event) => {
              setDraft(event.target.value);
              mention.track(event.currentTarget);
            }}
            onKeyDown={(event) => {
              mention.keyDown(event);
            }}
            onBlur={() => {
              mention.close();
              saveText();
            }}
          />
          {mention.popup}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">Status</span>
            <ToggleGroup
              aria-label="Status"
              disabled={!canEdit}
              value={[status]}
              onValueChange={(next) => {
                const picked = next[0];
                if (picked === "todo" || picked === "doing" || picked === "done") onStatus(picked);
              }}
            >
              {BOARD_PLAN_COLUMNS.map((column) => (
                <GroupToggle key={column.status} value={column.status}>
                  {column.title}
                </GroupToggle>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">For</span>
              <Select
                value={assignee}
                disabled={!canEdit}
                onValueChange={(next) => {
                  if (typeof next === "string") assign(next);
                }}
              >
                <SelectTrigger aria-label="Assignee">
                  <SelectValue>{nameOf(assignee)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={NO_ONE}>No one</SelectItem>
                  {choices.map((choice) => (
                    <SelectItem key={choice.guestId ?? OWNER} value={choice.guestId ?? OWNER}>
                      {boardPersonName(people, choice.guestId)}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Priority</span>
              <Select
                value={task.priority ?? NO_PRIORITY}
                disabled={!canEdit}
                onValueChange={(next) => {
                  if (typeof next === "string") setPriority(next);
                }}
              >
                <SelectTrigger aria-label="Priority">
                  <SelectValue>{priorityName(task.priority)}</SelectValue>
                </SelectTrigger>
                <SelectPopup>
                  <SelectItem value={NO_PRIORITY}>No priority</SelectItem>
                  {BOARD_PLAN_PRIORITIES.map((one) => (
                    <SelectItem key={one.priority} value={one.priority}>
                      <TaskPriorityIcon priority={one.priority} />
                      {one.title}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            </div>
            <div className="flex min-w-0 flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Due</span>
              <span className="flex items-center gap-1">
                <Input
                  nativeInput
                  type="date"
                  aria-label="Due"
                  disabled={!canEdit}
                  value={task.due ?? ""}
                  onChange={(event) => setDue(event.target.value)}
                />
                {task.due === undefined || !canEdit ? null : (
                  <Button size="sm" variant="ghost" onClick={() => setDue("")}>
                    Clear
                  </Button>
                )}
              </span>
            </div>
          </div>
        </DialogPanel>
        <DialogFooter>
          {/* One wrapping row, so four actions never run out of the dialog on a narrow screen. */}
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
            {actions.onDelete === undefined ? null : (
              <span className="me-auto">
                <Button variant="destructive-outline" onClick={then(actions.onDelete)}>
                  <Trash2Icon />
                  Delete
                </Button>
              </span>
            )}
            <Button variant="outline" onClick={then(actions.onShow)}>
              <LocateFixedIcon />
              Show on board
            </Button>
            {actions.onTake === undefined ? null : (
              <Button variant="outline" onClick={then(actions.onTake)}>
                <BotIcon />
                Take it to my agent
              </Button>
            )}
            {actions.onRun === undefined ? null : (
              <Button onClick={then(actions.onRun)}>
                <PlayIcon />
                Run with an agent
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
