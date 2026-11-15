import type { RoomBoxProgress } from "@t3tools/contracts";

import { formatBoardElapsed } from "./roomBoard.logic";

/** What the Agents panel needs of a box's run in flight. Never its streaming text. */
export type BoardAgentRun = Pick<
  RoomBoxProgress,
  "phase" | "startedAt" | "guestId" | "askedBy" | "model"
>;

/** Where a box is, as the Agents panel says it. */
export type BoardAgentStatus =
  | { readonly kind: "needs-you"; readonly need: "request" | "approval" }
  | { readonly kind: "working" | "queued" | "waiting" | "failed" | "done" | "idle" };

/**
 * A box's state for this viewer. Something only they can answer comes first: their own agent's
 * approval, or, for the owner, a guest's prompt waiting to be sent. Then the run in flight, then
 * how its last run ended, as far as anyone can tell.
 */
export function boardAgentStatus(input: {
  readonly run: BoardAgentRun | undefined;
  /** Guests' prompts on the box waiting for the owner. */
  readonly requests: number;
  /** The viewer is the one who sends or dismisses those. */
  readonly canResolve: boolean;
  /** Its last run ended without a reply while this board was open. */
  readonly failed: boolean;
  /** It has answered at least once. */
  readonly answered: boolean;
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
  if (input.failed) return { kind: "failed" };
  return { kind: input.answered ? "done" : "idle" };
}

/** A state in a few words: "Needs you", "Working · 1m 12s", "Failed". */
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
    case "done":
      return "Done";
    case "idle":
      return "Idle";
  }
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

/** How a run ended: a new reply or new board work came after it began, or nothing did. */
export const boardAgentRunOutcome = (
  watched: Pick<BoardAgentWatched, "turnKey">,
  turnKey: string,
): "finished" | "failed" => (turnKey !== watched.turnKey ? "finished" : "failed");

/** Alt+G on the board (Option+G on a Mac, by the key's place) opens the Agents panel. */
export const isBoardAgentsKey = (event: {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
}) => event.code === "KeyG" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
