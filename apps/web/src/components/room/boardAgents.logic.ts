import type {
  OrchestrationV2RunStatus,
  RoomBoardAgentTurn,
  RoomBoardNote,
  RoomBoxProgress,
} from "@t3tools/contracts";

import { boardAgentTurnLine, formatBoardElapsed } from "./roomBoard.logic";

/** What the Agents panel needs of a box's run in flight. Never its streaming text. */
export type BoardAgentRun = Pick<
  RoomBoxProgress,
  "phase" | "startedAt" | "guestId" | "askedBy" | "model"
>;

/**
 * How a box's last run ended: finished, stopped by someone, failed with an error, or `ended` when
 * this client cannot read how, as for a run on a guest's own machine that brought no reply.
 */
export type BoardAgentOutcome = "done" | "stopped" | "failed" | "ended";

/** How a box's last run ended as the machine that ran it recorded it, and when. */
export interface BoardAgentEnd {
  readonly outcome: Exclude<BoardAgentOutcome, "ended">;
  readonly at: string;
}

/**
 * The end a thread's last run came to, from its record on the machine that ran it: undefined
 * while it runs or when it never ran. A rolled-back run is undone work, not an outcome.
 */
export function boardAgentEndOf(
  run: {
    readonly status: OrchestrationV2RunStatus;
    readonly completedAt: string | null;
  } | null,
  stopRequested: boolean,
): BoardAgentEnd | undefined {
  if (run === null || run.completedAt === null) return undefined;
  const at = run.completedAt;
  switch (run.status) {
    case "completed":
      return { outcome: "done", at };
    case "interrupted":
    case "cancelled":
      return { outcome: "stopped", at };
    case "failed":
      return { outcome: stopRequested ? "stopped" : "failed", at };
    default:
      return undefined;
  }
}

/** Where a box is, as the Agents panel says it. */
export type BoardAgentStatus =
  | { readonly kind: "needs-you"; readonly need: "request" | "approval" }
  | {
      readonly kind: "working" | "queued" | "waiting" | "idle" | "offline" | BoardAgentOutcome;
    };

/**
 * A box's state for this viewer. Something only they can answer comes first: their own agent's
 * approval, or, for the owner, a guest's prompt waiting to be sent. Then the run in flight, then
 * how its last run ended, as far as this client can tell.
 */
export function boardAgentStatus(input: {
  readonly run: BoardAgentRun | undefined;
  /** Guests' prompts on the box waiting for the owner. */
  readonly requests: number;
  /** The viewer is the one who sends or dismisses those. */
  readonly canResolve: boolean;
  /** How its last run ended, when that is known. */
  readonly ended: BoardAgentOutcome | undefined;
  /** It has answered at least once. */
  readonly answered: boolean;
  /** No machine of its person's can run it now. */
  readonly offline?: boolean | undefined;
  readonly viewer: string | null;
}): BoardAgentStatus {
  const { run, viewer } = input;
  if (run?.phase === "approval" && (run.guestId ?? null) === viewer) {
    return { kind: "needs-you", need: "approval" };
  }
  if (input.requests > 0 && input.canResolve) return { kind: "needs-you", need: "request" };
  if (run?.phase === "approval") return { kind: "waiting" };
  if (run !== undefined) return { kind: run.phase === "queued" ? "queued" : "working" };
  if (input.requests > 0) return { kind: "waiting" };
  if (input.offline === true) return { kind: "offline" };
  if (input.ended !== undefined) return { kind: input.ended };
  return { kind: input.answered ? "done" : "idle" };
}

/** A state in a few words: "Needs you", "Working · 1m 12s", "Stopped". */
export function boardAgentStatusLabel(
  status: BoardAgentStatus,
  run: Pick<BoardAgentRun, "startedAt"> | undefined,
  now: number,
): string {
  switch (status.kind) {
    case "needs-you":
      return "Needs you";
    case "working":
      return run === undefined
        ? "Working"
        : `Working · ${formatBoardElapsed(now - Date.parse(run.startedAt))}`;
    case "queued":
      return "Queued";
    case "waiting":
      return "Waiting for approval";
    case "failed":
      return "Failed";
    case "stopped":
      return "Stopped";
    case "ended":
      return "Ended";
    case "done":
      return "Done";
    case "idle":
      return "Idle";
    case "offline":
      return "Offline";
  }
}

/** The model a box last ran on or was last set to, whichever came later. */
export function boardAgentModel(
  candidates: ReadonlyArray<
    { readonly model?: string | undefined; readonly at: string } | undefined
  >,
): string | undefined {
  let latest: { readonly model: string; readonly at: number } | undefined;
  for (const candidate of candidates) {
    if (candidate?.model === undefined || candidate.model === "") continue;
    const at = Date.parse(candidate.at) || 0;
    if (latest === undefined || at > latest.at) latest = { model: candidate.model, at };
  }
  return latest?.model;
}

const statusRank = (status: BoardAgentStatus) =>
  status.kind === "needs-you" ? 0 : status.kind === "working" || status.kind === "queued" ? 1 : 2;

/** The panel's order: what needs the viewer, what is working, then the rest, latest first. */
export function sortBoardAgents<
  Row extends { readonly status: BoardAgentStatus; readonly activity: number },
>(rows: ReadonlyArray<Row>): ReadonlyArray<Row> {
  return rows.toSorted(
    (a, b) => statusRank(a.status) - statusRank(b.status) || b.activity - a.activity,
  );
}

/**
 * The board's agent turns for the Agents panel's recent changes, newest first, each with the line
 * its box shows. Turns that left nothing to describe are left out.
 */
export function boardAgentRecentTurns(
  turns: ReadonlyArray<RoomBoardAgentTurn>,
): ReadonlyArray<{ readonly turn: RoomBoardAgentTurn; readonly line: string }> {
  return turns
    .toReversed()
    .toSorted((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0))
    .map((turn) => ({ turn, line: boardAgentTurnLine(turn) }))
    .filter((recent) => recent.line !== "");
}

/** The open tasks a box runs from "Run with an agent": the one run first first, then by place. */
export const boardAgentRunTasks = <
  Note extends Pick<RoomBoardNote, "kind" | "done" | "run" | "x" | "y">,
>(
  notes: ReadonlyArray<Note>,
  boxId: string,
): ReadonlyArray<Note> => {
  const ranAt = (note: Note) => Date.parse(note.run?.at ?? "") || 0;
  return notes
    .filter((note) => note.kind === "task" && note.done !== true && note.run?.boxId === boxId)
    .toSorted((a, b) => ranAt(a) - ranAt(b) || a.y - b.y || a.x - b.x);
};

/** When a box last did something: its run's start, its last reply or its last change to the board. */
export const boardAgentActivity = (times: ReadonlyArray<string | undefined>): number =>
  Math.max(0, ...times.map((at) => (at === undefined ? 0 : Date.parse(at) || 0)));

/** A run as the notices remember it, from when this board first saw it. */
export interface BoardAgentWatched {
  readonly startedAt: string;
  /** The viewer asked for it: their own prompt, or their request the owner sent. */
  readonly askedByViewer: boolean;
  /** The box's last reply and board work when the run was first seen, to tell a reply came. */
  readonly turnKey: string;
  /** It told the viewer something already: a turn gets one notice at most. */
  readonly notified: boolean;
}

/**
 * One step of watching a box's run: what to remember of it now, and whether it just started
 * needing the viewer or just ended. Only runs the viewer asked for, on their own agent for an
 * approval, ever call for a notice, and each turn at most once.
 */
export function boardAgentRunStep(
  watched: BoardAgentWatched | undefined,
  run: BoardAgentRun | undefined,
  viewer: string | null,
  turnKey: string,
): {
  readonly next: BoardAgentWatched | undefined;
  readonly notice: "needs-you" | "ended" | null;
} {
  if (run === undefined) {
    return {
      next: undefined,
      notice: watched === undefined || !watched.askedByViewer || watched.notified ? null : "ended",
    };
  }
  const current =
    watched !== undefined && watched.startedAt === run.startedAt
      ? watched
      : {
          startedAt: run.startedAt,
          askedByViewer: (run.askedBy ?? run.guestId ?? null) === viewer,
          turnKey,
          notified: false,
        };
  const needsViewer =
    run.phase === "approval" &&
    (run.guestId ?? null) === viewer &&
    current.askedByViewer &&
    !current.notified;
  return needsViewer
    ? { next: { ...current, notified: true }, notice: "needs-you" }
    : { next: current, notice: null };
}

/**
 * How a run this board watched ended, or null to wait a little longer for word of it. The record
 * of the machine that ran it decides, when this client can read one (`end` not undefined) and it
 * is of this run; otherwise a new reply or board work means it finished, and nothing means
 * `ended`, once the wait is over.
 */
export function boardAgentRunOutcome(
  watched: Pick<BoardAgentWatched, "turnKey" | "startedAt">,
  end: BoardAgentEnd | null | undefined,
  turnKey: string,
  waited: boolean,
): BoardAgentOutcome | null {
  if (end != null && Date.parse(end.at) >= Date.parse(watched.startedAt)) return end.outcome;
  // A reply can reach the board before the record says the run stopped, so a record is awaited.
  if (end !== undefined && !waited) return null;
  if (turnKey !== watched.turnKey) return "done";
  return waited ? "ended" : null;
}

/**
 * Whether a board Alt shortcut (Alt+G, Alt+A) may act from where the focus is: on the board, or
 * in a board text field off a Mac, where Alt with a letter types nothing. On a Mac Option types a
 * character (©, å), and a field in a dialog or popover keeps its keys.
 */
export const boardAltShortcutAllowed = (
  focus: "board" | "field" | "dialog-field",
  mac: boolean,
): boolean => focus === "board" || (focus === "field" && !mac);

/** Alt+G on the board (Option+G on a Mac, by the key's place) opens the Agents panel. */
export const isBoardAgentsKey = (event: {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}) => event.code === "KeyG" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
