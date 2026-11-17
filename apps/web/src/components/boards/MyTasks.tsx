import type { CloudMyTask } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { ListTodoIcon } from "lucide-react";
import { useState } from "react";

import { useBoardAccount } from "~/guest/boardAccount";
import { loadMyTasks, openInboxBoard } from "~/guest/inbox";
import { cn } from "~/lib/utils";

import { BOARD_PLAN_COLUMNS, BOARD_PLAN_PRIORITIES } from "../room/boardPlan.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
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

const statusTitle = (task: CloudMyTask) =>
  BOARD_PLAN_COLUMNS.find((column) => column.status === task.status)?.title ?? "";
const priorityTitle = (task: CloudMyTask) =>
  BOARD_PLAN_PRIORITIES.find((one) => one.priority === task.priority)?.title;

/** "My tasks": every task given to the signed-in person, across their boards and workspaces. */
export function MyTasks() {
  const account = useBoardAccount();
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<ReadonlyArray<CloudMyTask> | string | null>(null);
  const navigate = useNavigate();
  if (account.status !== "signed-in") return null;
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
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: target.environmentId, threadId: target.threadId },
    });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadMyTasks().then(setTasks);
      }}
    >
      <PopoverTrigger render={<Button variant="ghost-muted" data-my-tasks />}>
        <ListTodoIcon />
        My tasks
      </PopoverTrigger>
      <PopoverPopup width="lg" align="end" padding="compact">
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
            className="-mx-1 flex max-h-[28rem] flex-col gap-3 overflow-y-auto"
            data-my-tasks-list
          >
            {myTasksByBoard(tasks).map((board) => (
              <section key={board.shareId} className="flex flex-col">
                <h3 className="truncate px-2 pb-1 text-xs font-medium text-muted-foreground">
                  {board.title}
                </h3>
                <ul className="flex flex-col">
                  {board.tasks.map((task) => (
                    <li key={task.noteId}>
                      <button
                        type="button"
                        className="flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 text-start hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                        onClick={() => void openTask(task)}
                      >
                        <span
                          className={cn(
                            "line-clamp-2 text-sm",
                            task.status === "done" && "text-muted-foreground line-through",
                          )}
                        >
                          {task.text.trim() === "" ? "Untitled task" : task.text}
                        </span>
                        <span className="flex flex-wrap gap-x-2 text-2xs text-muted-foreground">
                          <span>{statusTitle(task)}</span>
                          {priorityTitle(task) === undefined ? null : (
                            <span>{priorityTitle(task)}</span>
                          )}
                          {task.due === undefined ? null : <span>Due {task.due}</span>}
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
}
