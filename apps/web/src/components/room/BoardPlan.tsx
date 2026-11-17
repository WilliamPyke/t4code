import type {
  RoomBoardAssignee,
  RoomBoardNote,
  RoomTaskStatus,
  ThreadGuest,
} from "@t3tools/contracts";
import { roomTaskStatus } from "@t3tools/shared/roomBoard";
import {
  AppWindowIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  BotIcon,
  CalendarIcon,
  EllipsisIcon,
  LinkIcon,
  LocateFixedIcon,
  PlayIcon,
  PlusIcon,
  ShapesIcon,
  SquareKanbanIcon,
  StickyNoteIcon,
  Trash2Icon,
} from "lucide-react";
import {
  type FormEvent,
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
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { BoardChip, PersonDot } from "./BoardChrome";
import {
  BOARD_PLAN_COLUMNS,
  BOARD_VIEW_PARAM,
  type BoardPlanAttached,
  type BoardPlanColumns,
  type BoardViewMode,
  boardPlanAttachedLine,
  boardPlanDue,
  boardPlanToday,
  boardViewModeOf,
} from "./boardPlan.logic";
import { BoardProgressLine } from "./RoomBoardArtifact";
import { WhyNot } from "./RoomBoardWhy";
import { type BoardPeople, boardCursorColor, boardPersonName } from "./roomBoard.logic";
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
    if (next === "plan") url.searchParams.set(BOARD_VIEW_PARAM, next);
    else url.searchParams.delete(BOARD_VIEW_PARAM);
    window.history.replaceState(window.history.state, "", url);
  });
  return [view ?? own, pick];
}

/** Board | Plan, in the board's header. */
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
        if (picked === "board" || picked === "plan") onView(picked);
      }}
    >
      <Toggle value="board">
        <ShapesIcon />
        Board
      </Toggle>
      <Toggle value="plan">
        <SquareKanbanIcon />
        Plan
      </Toggle>
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

/**
 * The board's tasks as columns: To do, In progress and Done. Each card is the task on the board,
 * so a move here is a change to it there, seen by everyone as it happens.
 */
export function BoardPlan({
  columns,
  attachments,
  people,
  guests,
  ownerAssignable,
  canEdit,
  cannotAdd,
  boxOf,
  workerOf,
  history,
  onAdd,
  onChange,
  onMove,
  actionsOf,
}: {
  readonly columns: BoardPlanColumns;
  readonly attachments: ReadonlyMap<string, BoardPlanAttached>;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
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
  readonly actionsOf: (task: RoomBoardNote) => PlanTaskActions;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState<RoomTaskStatus | null>(null);
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
  const editingTask = editing === null ? undefined : all.find((task) => task.id === editing);
  const liftedTask = lifted === null ? undefined : all.find((task) => task.id === lifted.id);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a drag's window listeners outlive the Plan unless it ends them as it closes
  useEffect(() => () => endDrag.current?.(), []);

  const placeGhost = (element: HTMLDivElement | null) => {
    if (element === null) return;
    const { x, y } = ghostAt.current;
    element.style.transform = `translate(${x}px, ${y}px) rotate(1.5deg)`;
  };

  const press = (event: ReactPointerEvent<HTMLElement>, task: RoomBoardNote) => {
    if (!canEdit || event.button !== 0 || endDrag.current !== null) return;
    if (event.target instanceof Element && event.target.closest("[data-plan-no-drag]") !== null) {
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
        if (target !== null) onMove(task.id, target.status, target.index);
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

  const open = (task: RoomBoardNote) => {
    if (!clickBlocked.current) setEditing(task.id);
  };

  const total = all.length;
  if (total === 0 && adding === null) {
    return (
      <PlanFrame history={history} total={0}>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Plan the work</EmptyTitle>
            <EmptyDescription>
              The Plan shows this board's tasks as columns to move through, and every task you add
              here is a card on the board too.
            </EmptyDescription>
          </EmptyHeader>
          <Button disabled={cannotAdd !== null} onClick={() => setAdding("todo")}>
            <PlusIcon />
            Add a task
          </Button>
          {cannotAdd === null ? null : <p className="text-xs text-muted-foreground">{cannotAdd}</p>}
        </Empty>
      </PlanFrame>
    );
  }

  return (
    <PlanFrame history={history} total={total}>
      <div
        ref={scrollerRef}
        className="flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto px-3 pb-3 sm:snap-none"
      >
        {BOARD_PLAN_COLUMNS.map(({ status, title }) => {
          const tasks = columns[status];
          const dropHere = drop?.status === status ? drop.index : null;
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
              <header className="flex items-center gap-2 px-3 pt-3 pb-2">
                <PlanStatusMark status={status} />
                <h2 className="text-sm font-semibold">{title}</h2>
                <span className="text-xs text-muted-foreground tabular-nums">{tasks.length}</span>
              </header>
              <ol data-plan-list className="flex min-h-0 flex-col gap-2 overflow-y-auto px-2 pb-1">
                {tasks.map((task) => {
                  const placeholder = lifted?.id === task.id;
                  const before = !placeholder && dropHere === shownAt;
                  if (!placeholder) shownAt += 1;
                  return (
                    <li key={task.id} className="flex flex-col gap-2">
                      {before ? <DropLine /> : null}
                      <PlanCard
                        task={task}
                        attached={attachments.get(task.id)}
                        box={boxOf(task)}
                        worker={workerOf(task)}
                        people={people}
                        guests={guests}
                        today={today}
                        canEdit={canEdit}
                        placeholder={placeholder}
                        columns={columns}
                        actions={actionsOf(task)}
                        onMove={onMove}
                        onOpen={() => open(task)}
                        onPress={(event) => press(event, task)}
                      />
                    </li>
                  );
                })}
                {dropHere !== null && dropHere >= shownAt ? (
                  <li>
                    <DropLine />
                  </li>
                ) : null}
              </ol>
              <PlanAdd
                status={status}
                open={adding === status}
                cannotAdd={cannotAdd}
                onOpen={() => setAdding(status)}
                onClose={() => setAdding((current) => (current === status ? null : current))}
                onAdd={(text) => onAdd(status, text)}
              />
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
              <PlanCardBody
                task={liftedTask}
                attached={attachments.get(liftedTask.id)}
                box={boxOf(liftedTask)}
                worker={workerOf(liftedTask)}
                people={people}
                guests={guests}
                today={today}
                lifted
              />
            </div>,
            document.body,
          )}
      {editingTask === undefined ? null : (
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
      )}
    </PlanFrame>
  );
}

function PlanFrame({
  history,
  total,
  children,
}: {
  readonly history: ReactNode;
  readonly total: number;
  readonly children: ReactNode;
}) {
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-4 pt-1 pb-2">
        <p className="text-xs text-muted-foreground">
          {total === 1 ? "1 task" : `${total} tasks`} · the same tasks as on the board
        </p>
        <div className="ms-auto flex items-center gap-0.5">{history}</div>
      </div>
      {children}
    </div>
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
          <Button size="sm" variant="ghost-muted" disabled={cannotAdd !== null} onClick={onOpen}>
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

function PlanCard({
  task,
  attached,
  box,
  worker,
  people,
  guests,
  today,
  canEdit,
  placeholder,
  columns,
  actions,
  onMove,
  onOpen,
  onPress,
}: {
  readonly task: RoomBoardNote;
  readonly attached: BoardPlanAttached | undefined;
  readonly box: BoardPlanBox | undefined;
  readonly worker: string | undefined;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly today: string;
  readonly canEdit: boolean;
  readonly placeholder: boolean;
  readonly columns: BoardPlanColumns;
  readonly actions: PlanTaskActions;
  readonly onMove: (taskId: string, to: RoomTaskStatus, index: number) => void;
  readonly onOpen: () => void;
  readonly onPress: (event: ReactPointerEvent<HTMLElement>) => void;
}) {
  const status = roomTaskStatus(task);
  const column = columns[status];
  const index = column.findIndex((other) => other.id === task.id);
  const label = task.text.trim() || "Untitled task";
  return (
    <div
      data-plan-card={task.id}
      className={cn(
        "group/plan relative select-none [-webkit-touch-callout:none]",
        placeholder && "opacity-40",
      )}
      onPointerDown={onPress}
    >
      <PlanCardBody
        task={task}
        attached={attached}
        box={box}
        worker={worker}
        people={people}
        guests={guests}
        today={today}
      />
      <button
        type="button"
        aria-label={`Open task: ${label}`}
        className="absolute inset-0 cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
      />
      <div
        data-plan-no-drag
        className="absolute top-1.5 right-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 group-hover/plan:opacity-100 group-focus-within/plan:opacity-100 has-[[data-popup-open]]:opacity-100"
      >
        <Menu>
          <MenuTrigger
            render={<Button size="icon-xs" variant="ghost" aria-label={`Actions for ${label}`} />}
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            {canEdit ? (
              <>
                <MenuGroup>
                  <MenuGroupLabel>Move to</MenuGroupLabel>
                  {BOARD_PLAN_COLUMNS.map((target) => (
                    <MenuItem
                      key={target.status}
                      disabled={target.status === status}
                      onClick={() =>
                        onMove(
                          task.id,
                          target.status,
                          columns[target.status].filter((other) => other.id !== task.id).length,
                        )
                      }
                    >
                      <PlanStatusMark status={target.status} />
                      {target.title}
                    </MenuItem>
                  ))}
                </MenuGroup>
                <MenuItem disabled={index <= 0} onClick={() => onMove(task.id, status, index - 1)}>
                  <ArrowUpIcon />
                  Move up
                </MenuItem>
                <MenuItem
                  disabled={index < 0 || index >= column.length - 1}
                  onClick={() => onMove(task.id, status, index + 1)}
                >
                  <ArrowDownIcon />
                  Move down
                </MenuItem>
                <MenuSeparator />
              </>
            ) : null}
            <PlanTaskMenuActions actions={actions} />
          </MenuPopup>
        </Menu>
      </div>
    </div>
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
}: {
  readonly task: RoomBoardNote;
  readonly attached: BoardPlanAttached | undefined;
  readonly box: BoardPlanBox | undefined;
  readonly worker: string | undefined;
  readonly people: BoardPeople;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly today: string;
  readonly lifted?: boolean;
}) {
  const done = task.done === true;
  const due = task.due === undefined ? null : boardPlanDue(task.due, today);
  const line = boardPlanAttachedLine(attached);
  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-board-hairline bg-card p-3 text-card-foreground shadow-xs",
        lifted && "shadow-board ring-2 ring-primary/40",
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
        {task.assignee === undefined ? null : (
          <span className="flex min-w-0 items-center gap-1">
            <PersonDot
              color={boardCursorColor(guests, task.assignee.guestId)}
              className="size-4 text-4xs font-semibold"
            >
              {boardPersonName(people, task.assignee.guestId).charAt(0).toUpperCase()}
            </PersonDot>
            <span className="truncate">{boardPersonName(people, task.assignee.guestId)}</span>
          </span>
        )}
        {due === null ? null : (
          <BoardChip tone={due.overdue && !done ? "error" : "neutral"}>
            <CalendarIcon className="size-3" />
            {due.label}
          </BoardChip>
        )}
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
const OWNER = "owner";

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
  const saveText = () => {
    if (!canEdit || draft === null) return;
    setDraft(null);
    if (draft !== task.text) onChange(task, (current) => ({ ...current, text: draft }));
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
  const line = boardPlanAttachedLine(attached);
  const nameOf = (value: string) =>
    value === NO_ONE ? "No one" : boardPersonName(people, value === OWNER ? undefined : value);
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
            Added by {boardPersonName(people, task.guestId)}
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
            onChange={(event) => setDraft(event.target.value)}
            onBlur={saveText}
          />
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
                <Toggle key={column.status} value={column.status}>
                  {column.title}
                </Toggle>
              ))}
            </ToggleGroup>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">Assignee</span>
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
            <div className="flex flex-col gap-1.5">
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
          {actions.onDelete === undefined ? null : (
            <Button variant="destructive-outline" onClick={then(actions.onDelete)}>
              <Trash2Icon />
              Delete
            </Button>
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
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
