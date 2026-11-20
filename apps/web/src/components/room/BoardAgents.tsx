import {
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoxProgress,
  type ThreadGuestMessage,
} from "@t3tools/contracts";
import { BotIcon } from "lucide-react";
import {
  type ComponentProps,
  type ReactNode,
  memo,
  use,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { cn, isMacPlatform } from "~/lib/utils";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardChip, type BoardChipTone, PersonDot } from "./BoardChrome";
import { BoxStopButton } from "./RoomBoardThreadBox";
import {
  type BoardAgentEnd,
  type BoardAgentOutcome,
  type BoardAgentRun,
  type BoardAgentStatus,
  type BoardAgentWatched,
  boardAgentRunOutcome,
  boardAgentRunStep,
  boardAgentStatus,
  boardAgentStatusLabel,
  sortBoardAgents,
} from "./boardAgents.logic";
import type { MinimapItem } from "./boardMinimap.logic";
import { RoomLiveContext, type RoomLiveStore, useBoardNow } from "./roomBoardLive";

/** How long a run that ended may wait for word of how it ended, checked this often. */
const END_GRACE_MS = 5_000;
const END_CHECK_MS = 1_000;

/** How the Agents shortcut reads on this device. */
const boardAgentsShortcut = () =>
  typeof navigator !== "undefined" && isMacPlatform(navigator.platform) ? "⌥G" : "Alt+G";

/** A thread box as the Agents panel lists it. The board builds these; runs come from the live store. */
export interface BoardAgentEntry {
  readonly id: string;
  readonly name: string;
  /** Whose box it is, as the board names them: "You", "Sam", the owner. */
  readonly whose: string;
  readonly color: string;
  /** The model it last ran on or was last set to. */
  readonly model: string | undefined;
  /**
   * How its last run ended, from the record of the machine that ran it: null when this client
   * reads that machine and no run of it ended yet, absent when this client cannot read it.
   */
  readonly end?: BoardAgentEnd | null | undefined;
  /** What its agent last did to the board, when that still stands. */
  readonly work: string | undefined;
  /** The open tasks it runs from "Run with an agent", in the order the run listed them. */
  readonly tasks: ReadonlyArray<{ readonly id: string; readonly text: string }>;
  /** Stops its agent; absent where the viewer may not. */
  readonly stop: (() => void) | undefined;
  readonly requests: ReadonlyArray<ThreadGuestMessage>;
  /** The viewer is the one who sends or dismisses the guests' prompts on it. */
  readonly canResolve: boolean;
  readonly answered: boolean;
  /** When it last replied or changed the board, in ms. */
  readonly activity: number;
  /** Its last reply and board work, which a finished run changes. */
  readonly turnKey: string;
  /** For a server that reports no box runs: what the room thread's agent is doing. */
  readonly fallback?: "working" | "approval" | undefined;
  /** No machine of its person's can run it now. */
  readonly offline?: boolean | undefined;
  /** Offline and the viewer's own: their computer dropped (`away`), or they never brought it. */
  readonly offlineOwn?: "away" | "absent" | undefined;
}

// What of a run the panel shows: never its streaming text, so a token renders nothing here.
const runKey = (progress: RoomBoxProgress | undefined) =>
  progress === undefined
    ? ""
    : `${progress.phase}|${progress.startedAt}|${progress.guestId ?? ""}|${progress.model ?? ""}`;

function entryRun(store: RoomLiveStore, entry: BoardAgentEntry): BoardAgentRun | undefined {
  const progress = store.box(entry.id);
  if (progress !== undefined || entry.fallback === undefined) return progress;
  return { phase: entry.fallback === "approval" ? "approval" : "thinking", startedAt: "" };
}

/** The runs of these boxes, read again only when one starts, ends or changes phase. */
function useAgentRuns(entries: ReadonlyArray<BoardAgentEntry>) {
  const store = use(RoomLiveContext);
  useSyncExternalStore(store.subscribe, () =>
    entries.map((entry) => runKey(store.box(entry.id))).join(";"),
  );
  return (entry: BoardAgentEntry) => entryRun(store, entry);
}

/** How many of these boxes need this person now: their approval, or a request to send. */
function useAgentsNeedingViewer(entries: ReadonlyArray<BoardAgentEntry>, viewer: string | null) {
  const runOf = useAgentRuns(entries);
  return entries.filter(
    (entry) =>
      boardAgentStatus({
        run: runOf(entry),
        requests: entry.requests.length,
        canResolve: entry.canResolve,
        ended: undefined,
        answered: false,
        viewer,
      }).kind === "needs-you",
  ).length;
}

/**
 * The More button of a narrow board, where the header's Agents button is hidden: it carries how
 * many agents need this person. Reads the live store itself, so a run's tick renders only this.
 */
export function BoardAgentsMoreButton({
  entries,
  viewer,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, "size" | "variant"> & {
  readonly entries: ReadonlyArray<BoardAgentEntry>;
  readonly viewer: string | null;
}) {
  const needs = useAgentsNeedingViewer(entries, viewer);
  return (
    <Button
      {...props}
      size={needs === 0 ? "icon" : "sm"}
      variant="ghost"
      aria-label={
        needs === 0 ? "More tools" : `More tools, ${needs} agent${needs === 1 ? "" : "s"} need you`
      }
    >
      {children}
      {needs === 0 ? null : (
        <Badge size="sm" variant="warning">
          {needs}
        </Badge>
      )}
    </Button>
  );
}

/** The More menu's count beside Agents. */
export function BoardAgentsNeedsBadge({
  entries,
  viewer,
}: {
  readonly entries: ReadonlyArray<BoardAgentEntry>;
  readonly viewer: string | null;
}) {
  const needs = useAgentsNeedingViewer(entries, viewer);
  return needs === 0 ? null : (
    <Badge size="sm" variant="warning" aria-label={`${needs} need you`}>
      {needs}
    </Badge>
  );
}

/**
 * How the runs of boxes whose machine this client cannot read ended while this board was open,
 * from what reached the board. The rest go by their machine's record.
 */
interface EndedRuns {
  readonly get: (boxId: string) => BoardAgentOutcome | undefined;
  readonly set: (boxId: string, outcome: BoardAgentOutcome | undefined) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly version: () => number;
}

function createEndedRuns(): EndedRuns {
  const ended = new Map<string, BoardAgentOutcome>();
  const listeners = new Set<() => void>();
  let version = 0;
  return {
    get: (boxId) => ended.get(boxId),
    set: (boxId, outcome) => {
      if (ended.get(boxId) === outcome) return;
      if (outcome === undefined) ended.delete(boxId);
      else ended.set(boxId, outcome);
      version += 1;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => version,
  };
}

const STATUS_TONES: Readonly<Record<BoardAgentStatus["kind"], BoardChipTone>> = {
  "needs-you": "warning",
  working: "primary",
  queued: "neutral",
  waiting: "neutral",
  failed: "error",
  stopped: "neutral",
  ended: "neutral",
  done: "neutral",
  idle: "neutral",
  offline: "neutral",
};

function StatusChip({
  status,
  run,
  offlineOwn,
}: {
  readonly status: BoardAgentStatus;
  readonly run: BoardAgentRun | undefined;
  readonly offlineOwn?: "away" | "absent" | undefined;
}) {
  const chip = (
    <BoardChip
      tone={STATUS_TONES[status.kind]}
      dashed={status.kind === "idle" || status.kind === "offline"}
    >
      {status.kind === "working" && run !== undefined && run.startedAt !== "" ? (
        <WorkingFor run={run} />
      ) : (
        boardAgentStatusLabel(status, undefined, 0)
      )}
    </BoardChip>
  );
  if (status.kind !== "ended" && status.kind !== "offline") return chip;
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{chip}</TooltipTrigger>
      <TooltipPopup side="top">
        {status.kind === "offline"
          ? offlineOwn === "away"
            ? "Your computer is not connected. Wake it, or open Tinkjam Sync on it. Your agent comes back by itself."
            : offlineOwn === "absent"
              ? "Your agent is not on this board. Press Bring my agent."
              : "Whoever this agent belongs to is not on the board now, so it cannot run."
          : "It ran on another machine and no reply came back, so this board cannot tell how it ended."}
      </TooltipPopup>
    </Tooltip>
  );
}

/** What this person hears, once a turn, about a box they asked while it is out of view. */
const AGENT_NOTICES: Readonly<
  Record<
    "needs-you" | BoardAgentOutcome,
    {
      readonly type: "info" | "warning" | "error";
      readonly title: string;
      readonly description?: string;
    }
  >
> = {
  "needs-you": {
    type: "warning",
    title: "needs you",
    description: "Its agent asks you to approve something.",
  },
  done: { type: "info", title: "finished" },
  stopped: {
    type: "info",
    title: "stopped",
    description: "Its run was stopped before it finished.",
  },
  failed: { type: "error", title: "failed", description: "Its run ended with an error." },
  ended: { type: "info", title: "ended", description: "No reply came back to the board." },
};

/** One agent turn as the Agents panel's recent changes list it. The board builds these. */
export interface BoardAgentRecent {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  /** "Added 4 tasks and 1 section", as the box shows it. */
  readonly line: string;
  readonly at: string;
  readonly undone: boolean;
  readonly onShow: () => void;
  /** Absent for whoever may not undo it. */
  readonly onUndo: ((undone: boolean) => void) | undefined;
}

/** What the board's agents last changed, newest first, each with Show and, where allowed, Undo. */
function RecentChanges({
  recent,
  onClose,
}: {
  readonly recent: ReadonlyArray<BoardAgentRecent>;
  readonly onClose: () => void;
}) {
  const now = useBoardNow();
  return (
    <section
      aria-label="Recent changes by agents"
      className="flex flex-col gap-0.5 border-t pt-1.5"
    >
      <h3 className="px-1.5 text-2xs font-medium text-muted-foreground">Recent changes</h3>
      <ol className="flex flex-col">
        {recent.map((item) => {
          const summary = item.undone
            ? `Undone: ${item.line.charAt(0).toLowerCase()}${item.line.slice(1)}`
            : item.line;
          return (
            <li
              key={item.id}
              className={cn(
                "flex min-w-0 items-center gap-2 px-1.5 py-0.5 text-2xs",
                item.undone ? "text-muted-foreground/70" : "text-muted-foreground",
              )}
            >
              <PersonDot color={item.color} className={cn("size-2", item.undone && "opacity-50")} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">
                  <span className={item.undone ? undefined : "font-medium text-foreground"}>
                    {item.name}
                  </span>
                  {formatRelativeTimeLabel(item.at, now) === ""
                    ? null
                    : ` · ${formatRelativeTimeLabel(item.at, now)}`}
                </span>
                <Tooltip>
                  <TooltipTrigger render={<span className="line-clamp-2 break-words" />}>
                    {summary}
                  </TooltipTrigger>
                  <TooltipPopup side="left" className="max-w-72">
                    {summary}
                  </TooltipPopup>
                </Tooltip>
              </span>
              {item.undone ? null : (
                <Button
                  size="micro-touch"
                  variant="ghost-muted"
                  onClick={() => {
                    onClose();
                    item.onShow();
                  }}
                >
                  Show
                </Button>
              )}
              {item.onUndo === undefined ? null : (
                <Button
                  size="micro-touch"
                  variant="ghost-muted"
                  onClick={() => item.onUndo?.(!item.undone)}
                >
                  {item.undone ? "Redo" : "Undo"}
                </Button>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** "Working · 1m 12s": only this ticks with the board's clock. */
function WorkingFor({ run }: { readonly run: BoardAgentRun }) {
  const now = useBoardNow();
  return <>{boardAgentStatusLabel({ kind: "working" }, run, now)}</>;
}

/**
 * Every agent on the board at a glance: a quiet button in the board's header, with how many need
 * this person and whether any is working, and its panel. Also tells this person, once a turn, when
 * a box they asked finishes, fails or needs them while it is out of view.
 */
export function BoardAgents({
  entries,
  viewer,
  open,
  onOpenChange,
  onShow,
  onShowTask,
  isOnScreen,
  renderNeeds,
  hasThreadBoxes,
  recent,
  cloud = false,
  viewing = false,
  bringAgent,
  takeAgentAway,
}: {
  readonly entries: ReadonlyArray<BoardAgentEntry>;
  readonly viewer: string | null;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Pans the board to a box and selects it. */
  readonly onShow: (boxId: string) => void;
  /** Pans the board to a task and selects it. */
  readonly onShowTask: (noteId: string) => void;
  readonly isOnScreen: (boxId: string) => boolean;
  /** What a box shows for what needs this person: its own Send and Dismiss, or its approval. */
  readonly renderNeeds: (entry: BoardAgentEntry, need: "request" | "approval") => ReactNode;
  /** Whether anyone added a thread box, besides the board's own thread. */
  readonly hasThreadBoxes: boolean;
  /** What the board's agents last changed, newest first. */
  readonly recent: ReadonlyArray<BoardAgentRecent>;
  /** The board is on a cloud host that no agent can join. */
  readonly cloud?: boolean;
  /** This person can only look at the board, so can bring no agent to it. */
  readonly viewing?: boolean;
  /** On a cloud board this person has brought no agent to yet: how they bring one. */
  readonly bringAgent?: (() => void) | undefined;
  /** This person's agent is on this cloud board: takes it off again. */
  readonly takeAgentAway?: (() => Promise<void>) | undefined;
}) {
  const store = use(RoomLiveContext);
  const [takingAway, setTakingAway] = useState(false);
  const runOf = useAgentRuns(entries);
  const [ended] = useState(createEndedRuns);
  useSyncExternalStore(ended.subscribe, ended.version);
  const rows = sortBoardAgents(
    entries.map((entry) => {
      const run = runOf(entry);
      return {
        entry,
        run,
        activity: Math.max(entry.activity, run === undefined ? 0 : Date.parse(run.startedAt) || 0),
        status: boardAgentStatus({
          run,
          requests: entry.requests.length,
          canResolve: entry.canResolve,
          ended: ended.get(entry.id) ?? entry.end?.outcome,
          answered: entry.answered,
          offline: entry.offline,
          viewer,
        }),
      };
    }),
  );
  const needs = rows.filter((row) => row.status.kind === "needs-you").length;
  const working = rows.some((row) => row.status.kind === "working");

  const entriesNow = useStableCallback(() => entries);
  const notify = useStableCallback((boxId: string, kind: "needs-you" | BoardAgentOutcome) => {
    const entry = entries.find((candidate) => candidate.id === boxId);
    if (entry === undefined || (document.visibilityState === "visible" && isOnScreen(boxId))) {
      return;
    }
    const notice = AGENT_NOTICES[kind];
    toastManager.add({
      type: notice.type,
      title: `${entry.name} ${notice.title}`,
      description: kind === "done" ? entry.work : notice.description,
      actionProps: { children: "Show", onClick: () => onShow(boxId) },
    });
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- watches the live store's runs, outside React, to tell when one this person asked ends or needs them
  useEffect(() => {
    const watched = new Map<string, BoardAgentWatched>();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    const settled = (boxId: string, run: BoardAgentWatched, tell: boolean) => {
      const settle = (waited: number) => {
        const entry = entriesNow().find((candidate) => candidate.id === boxId);
        const end = entry?.end;
        const outcome = boardAgentRunOutcome(
          run,
          end,
          entry?.turnKey ?? "",
          waited >= END_GRACE_MS,
        );
        if (outcome === null) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            settle(waited + END_CHECK_MS);
          }, END_CHECK_MS);
          timers.add(timer);
          return;
        }
        // A box whose machine this client reads shows that machine's record instead.
        ended.set(boxId, end === undefined ? outcome : undefined);
        if (tell) notify(boxId, outcome);
      };
      settle(0);
    };
    const step = () => {
      for (const entry of entriesNow()) {
        const progress = store.box(entry.id);
        const before = watched.get(entry.id);
        const { next, notice } = boardAgentRunStep(before, progress, viewer, entry.turnKey);
        if (next === undefined) watched.delete(entry.id);
        else watched.set(entry.id, next);
        if (progress !== undefined && before?.startedAt !== progress.startedAt) {
          ended.set(entry.id, undefined);
        }
        if (before !== undefined && next === undefined) {
          settled(entry.id, before, notice === "ended");
        }
        if (notice === "needs-you") notify(entry.id, "needs-you");
      }
    };
    step();
    const unsubscribe = store.subscribe(step);
    return () => {
      unsubscribe();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [store, viewer, ended, entriesNow, notify]);

  const trigger = useRef<HTMLButtonElement | null>(null);
  // From the More menu on a phone the header button is hidden: the panel opens above the toolbar.
  const anchor = {
    getBoundingClientRect: () => {
      const button = trigger.current;
      return button !== null && button.offsetWidth > 0
        ? button.getBoundingClientRect()
        : new DOMRect(window.innerWidth / 2, window.innerHeight - 64, 0, 0);
    },
  };
  const label = [
    "Agents",
    needs === 0 ? "" : `${needs} need${needs === 1 ? "s" : ""} you`,
    working ? "working" : "",
  ]
    .filter((part) => part !== "")
    .join(", ");

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <span className="flex shrink-0">
        <Tooltip>
          <TooltipTrigger
            render={
              <PopoverTrigger
                render={<Button ref={trigger} size="sm" variant="outline" aria-label={label} />}
              />
            }
          >
            <BotIcon />
            <span className="sr-only @3xl/board:not-sr-only">Agents</span>
            {working ? <span aria-hidden className="size-1.5 rounded-full bg-primary" /> : null}
            {needs === 0 ? null : (
              <Badge size="sm" variant="warning">
                {needs}
              </Badge>
            )}
          </TooltipTrigger>
          <TooltipPopup side="bottom">Agents · {boardAgentsShortcut()}</TooltipPopup>
        </Tooltip>
      </span>
      <PopoverPopup
        anchor={anchor}
        side="bottom"
        align="end"
        sideOffset={8}
        width="lg"
        padding="compact"
        touchBackdrop
        aria-label="Agents"
      >
        <div className="flex max-h-[min(32rem,70dvh)] flex-col gap-1.5">
          <div className="flex items-center justify-between px-1.5">
            <PopoverTitle>Agents</PopoverTitle>
            <span className="text-2xs text-muted-foreground">{boardAgentsShortcut()}</span>
          </div>
          <ol className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
            {rows.map(({ entry, run, status }) => (
              <li key={entry.id} className="flex flex-col gap-1">
                <div className="flex min-w-0 items-start gap-0.5">
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 flex-col gap-0.5 rounded-md px-1.5 py-1.5 text-start outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    onClick={() => {
                      onOpenChange(false);
                      onShow(entry.id);
                    }}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <PersonDot color={entry.color} className="size-2" />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">
                        {entry.name}
                      </span>
                      <StatusChip status={status} run={run} offlineOwn={entry.offlineOwn} />
                    </span>
                    <span className="truncate ps-4 text-2xs text-muted-foreground">
                      {[entry.whose, run?.model ?? entry.model]
                        .filter((part) => part !== undefined && part !== "")
                        .join(" · ")}
                    </span>
                    {entry.work === undefined ? null : (
                      <span className="truncate ps-4 text-2xs text-muted-foreground">
                        {entry.work}
                      </span>
                    )}
                  </button>
                  {run !== undefined && entry.stop !== undefined ? (
                    <span className="pt-1.5">
                      <BoxStopButton onStop={entry.stop} />
                    </span>
                  ) : null}
                </div>
                {run !== undefined && entry.tasks[0] !== undefined ? (
                  <p className="flex min-w-0 items-baseline gap-1 ps-5.5 pe-1.5 text-2xs text-muted-foreground">
                    <span className="shrink-0">Working on:</span>
                    <button
                      type="button"
                      className="min-w-0 truncate rounded-sm text-start text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      onClick={() => {
                        const first = entry.tasks[0];
                        if (first === undefined) return;
                        onOpenChange(false);
                        onShowTask(first.id);
                      }}
                    >
                      {entry.tasks[0].text}
                    </button>
                    {entry.tasks.length > 1 ? (
                      <span className="shrink-0">and {entry.tasks.length - 1} more</span>
                    ) : null}
                  </p>
                ) : null}
                {status.kind === "needs-you" ? (
                  <div className="ps-5.5 pe-1.5 pb-1">{renderNeeds(entry, status.need)}</div>
                ) : null}
              </li>
            ))}
          </ol>
          {takeAgentAway === undefined ? null : (
            <div className="flex items-center gap-2 px-1.5 pb-1">
              <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
                Your agent is on this board. Only you can send it work.
              </p>
              <Button
                size="xs"
                variant="outline"
                disabled={takingAway}
                onClick={async () => {
                  setTakingAway(true);
                  await takeAgentAway();
                  setTakingAway(false);
                }}
                data-take-agent-away
              >
                {takingAway ? "Taking it off…" : "Take my agent off"}
              </Button>
            </div>
          )}
          {hasThreadBoxes ? null : bringAgent !== undefined ? (
            <div className="flex items-center gap-2 px-1.5 pb-1">
              <p className="min-w-0 flex-1 text-2xs text-muted-foreground">
                Agents here come from people's own computers. Bring yours to add one.
              </p>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  bringAgent();
                }}
              >
                Bring my agent
              </Button>
            </div>
          ) : (
            <p className="px-1.5 pb-1 text-2xs text-muted-foreground">
              {viewing
                ? "You are viewing this board. Agents join when you can edit it."
                : cloud
                  ? "Agents cannot join this board."
                  : "Add an agent with Thread in the toolbar, or select cards and choose Ask an agent."}
            </p>
          )}
          {recent.length === 0 ? null : (
            <RecentChanges recent={recent} onClose={() => onOpenChange(false)} />
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
}

/** The box a minimap item draws, when it is one. */
const minimapBoxId = (itemId: string): string | null =>
  itemId === `card:${ROOM_BOARD_THREAD_CARD}`
    ? ROOM_BOARD_ROOM_BOX
    : itemId.startsWith("note:")
      ? itemId.slice("note:".length)
      : null;

/**
 * An outline on each box in the minimap whose agent is working, amber while it waits for an
 * approval. Reads the live store itself and only a run starting, ending or waiting renders it.
 */
export const MinimapAgentMarks = memo(
  function MinimapAgentMarks({
    items,
  }: {
    readonly items: ReadonlyArray<MinimapItem>;
    readonly drawn: string;
  }) {
    const store = use(RoomLiveContext);
    const marked = useSyncExternalStore(store.subscribe, () =>
      items
        .flatMap((item) => {
          const boxId = minimapBoxId(item.id);
          const progress = boxId === null ? undefined : store.box(boxId);
          return progress === undefined
            ? []
            : [`${item.id}=${progress.phase === "approval" ? "a" : "w"}`];
        })
        .join(";"),
    );
    if (marked === "") return null;
    const tones = new Map(marked.split(";").map((part) => part.split("=") as [string, string]));
    return items.map((item) =>
      tones.has(item.id) ? (
        <rect
          key={item.id}
          x={item.x}
          y={item.y}
          width={item.width}
          height={item.height}
          rx={8}
          fill="none"
          stroke={tones.get(item.id) === "a" ? "var(--color-warning)" : "var(--color-primary)"}
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ) : null,
    );
  },
  (before, after) => before.drawn === after.drawn,
);
