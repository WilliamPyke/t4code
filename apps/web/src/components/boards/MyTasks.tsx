import type { CloudMyTask } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ListTodoIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useBoardAccount } from "~/guest/boardAccount";
import { loadMyTasks, openInboxBoard } from "~/guest/inbox";
import { cn } from "~/lib/utils";

import {
  BOARD_PLAN_COLUMNS,
  BOARD_PLAN_PRIORITIES,
  boardPlanDue,
  boardPlanToday,
} from "../room/boardPlan.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";

/** Tasks grouped by board, open ones first in each, boards in the order their first task came. */
function myTasksByBoard(tasks: ReadonlyArray<CloudMyTask>): ReadonlyArray<{
  readonly shareId: string;
  readonly title: string;
  readonly tasks: ReadonlyArray<CloudMyTask>;
}> {
  const order = { doing: 0, todo: 1, done: 2 } as const;
  const boards = new Map<string, { shareId: string; title: string; tasks: Array<CloudMyTask> }>();
  for (const task of tasks) {
    const board = boards.get(task.shareId) ?? {
      shareId: task.shareId,
      title: task.title,
      tasks: [],
    };
    board.tasks.push(task);
    boards.set(task.shareId, board);
  }
  return [...boards.values()].map((board) => ({
    ...board,
    tasks: board.tasks.toSorted(
      (left, right) =>
        order[left.status] - order[right.status] ||
        (left.due ?? "9999").localeCompare(right.due ?? "9999"),
    ),
  }));
}

// The Plan's priority marks, as its task cards draw them.
const PRIORITY_SWATCH: Readonly<Record<NonNullable<CloudMyTask["priority"]>, string>> = {
  urgent: "bg-danger",
  high: "bg-claude",
  medium: "bg-sun",
  low: "bg-brand-sky",
};

const myOpenTaskCount = (tasks: ReadonlyArray<CloudMyTask>) =>
  tasks.filter((task) => task.status !== "done").length;

const statusTitle = (task: CloudMyTask) =>
  BOARD_PLAN_COLUMNS.find((column) => column.status === task.status)?.title ?? "";
const priorityTitle = (task: CloudMyTask) =>
  BOARD_PLAN_PRIORITIES.find((one) => one.priority === task.priority)?.title;

/**
 * "My tasks": every task given to the signed-in person, across their boards and workspaces. A
 * toolbar button, or a row of the sidebar's boards navigation.
 */
export function MyTasks({
  presentation = "button",
}: {
  readonly presentation?: "button" | "sidebar";
} = {}) {
  const account = useBoardAccount();
  const [open, setOpen] = useState(false);
  // The day the list was last opened on, which its due days are read against.
  const [today, setToday] = useState(() => boardPlanToday(new Date()));
  const [tasks, setTasks] = useState<ReadonlyArray<CloudMyTask> | string | null>(null);
  const navigate = useNavigate();
  const signedIn = account.status === "signed-in";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the button says how many tasks are open for this person, which only the board host knows
  useEffect(() => {
    if (!signedIn) return;
    let stopped = false;
    void loadMyTasks().then((read) => {
      if (!stopped) setTasks(read);
    });
    return () => {
      stopped = true;
    };
  }, [signedIn]);
  if (!signedIn) return null;
  // The button counts open tasks only; unread news is the bell's.
  const openCount = Array.isArray(tasks) ? myOpenTaskCount(tasks) : 0;
  const openTask = async (task: CloudMyTask) => {
    setOpen(false);
    const target = await openInboxBoard({
      shareId: task.shareId,
      workspaceId: task.workspaceId,
      noteId: task.noteId,
      task: true,
    });
    if (typeof target === "string") {
      toastManager.add({ type: "error", title: "Could not open the board", description: target });
      return;
    }
    void navigate(target);
  };
  const sidebar = presentation === "sidebar";
  const countLabel = openCount > 99 ? "99+" : String(openCount);
  const popover = (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) return;
        setToday(boardPlanToday(new Date()));
        void loadMyTasks().then(setTasks);
      }}
    >
      <PopoverTrigger
        render={
          sidebar ? (
            <SidebarMenuButton size="nav" variant="nav" data-my-tasks />
          ) : (
            <Button variant="ghost-muted" data-my-tasks />
          )
        }
        aria-label={openCount === 0 ? "My tasks" : `My tasks, ${openCount} open`}
      >
        <ListTodoIcon />
        {sidebar ? <span className="min-w-0 flex-1 truncate">My tasks</span> : "My tasks"}
        {openCount === 0 ? null : (
          <span
            aria-hidden
            className={cn(
              "tabular-nums",
              sidebar
                ? "ms-auto shrink-0 text-xs font-semibold text-sidebar-muted-foreground"
                : "text-muted-foreground",
            )}
          >
            {countLabel}
          </span>
        )}
      </PopoverTrigger>
      <PopoverPopup
        width="lg"
        side={sidebar ? "right" : "bottom"}
        align={sidebar ? "start" : "end"}
        padding="compact"
      >
        <PopoverTitle className="mb-2">My tasks</PopoverTitle>
        {tasks === null ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading...</p>
        ) : typeof tasks === "string" ? (
          <p className="py-6 text-center text-xs text-destructive">{tasks}</p>
        ) : tasks.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No tasks for you yet. Tasks someone gives you on any board show here.
          </p>
        ) : (
          <div
            className="-mx-1 flex max-h-[28rem] flex-col gap-3 overflow-y-auto px-1 pb-1"
            data-my-tasks-list
          >
            {myTasksByBoard(tasks).map((board) => (
              <section key={board.shareId} className="flex flex-col">
                <h3 className="truncate px-1 pb-1.5 text-2xs font-semibold tracking-caps text-quiet uppercase">
                  {board.title}
                </h3>
                <ul className="flex flex-col gap-2">
                  {board.tasks.map((task) => (
                    <li key={task.noteId}>
                      <button
                        type="button"
                        className="flex w-full flex-col gap-2 rounded-xl border border-rule bg-raised px-3.5 py-3 text-start shadow-rest outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                        onClick={() => void openTask(task)}
                        data-my-task
                      >
                        {priorityTitle(task) === undefined ? null : (
                          <span className="flex items-center gap-1.5 text-2xs font-semibold text-body">
                            <span
                              aria-hidden
                              className={cn(
                                "size-2 rounded-xs",
                                task.priority === undefined
                                  ? "bg-quiet"
                                  : PRIORITY_SWATCH[task.priority],
                              )}
                            />
                            {priorityTitle(task)}
                          </span>
                        )}
                        <span
                          className={cn(
                            "line-clamp-2 text-sm leading-snug font-medium text-foreground",
                            task.status === "done" && "text-quiet line-through decoration-rule",
                          )}
                        >
                          {task.text.trim() === "" ? "Untitled task" : task.text}
                        </span>
                        <span className="flex flex-wrap items-center gap-x-2 text-xs text-quiet">
                          <span className={cn(task.status === "done" && "text-success-foreground")}>
                            {statusTitle(task)}
                          </span>
                          {task.due === undefined ? null : (
                            <span
                              className={cn(
                                "ms-auto",
                                boardPlanDue(task.due, today).overdue && "text-danger",
                              )}
                            >
                              {boardPlanDue(task.due, today).label}
                            </span>
                          )}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </PopoverPopup>
    </Popover>
  );
  return sidebar ? <SidebarMenuItem>{popover}</SidebarMenuItem> : popover;
}
