import type { RoomAgentActivity, RoomBoxProgress } from "@t3tools/contracts";
import { createContext, use, useSyncExternalStore } from "react";

const TICK_MS = 1_000;
const NO_RUNNING: ReadonlyArray<RoomAgentActivity> = [];

/**
 * What runs on a board now: the guests' own machines (`running`) and each thread box's run
 * (`boxes`, undefined from an older server). Kept outside React so a progress tick or a streaming
 * draft renders only the cards it changes, and one clock ticks for the whole board while anything
 * is in flight.
 */
export interface RoomLiveStore {
  readonly setRunning: (running: ReadonlyArray<RoomAgentActivity>) => void;
  readonly setBoxes: (boxes: ReadonlyArray<RoomBoxProgress> | undefined) => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly subscribeClock: (listener: () => void) => () => void;
  readonly running: () => ReadonlyArray<RoomAgentActivity>;
  readonly hasProgress: () => boolean;
  readonly box: (boxId: string) => RoomBoxProgress | undefined;
  readonly artifact: (artifactId: string) => RoomBoxProgress | undefined;
  readonly comment: (commentId: string) => RoomBoxProgress | undefined;
  readonly now: () => number;
}

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function createRoomLiveStore(): RoomLiveStore {
  const listeners = new Set<() => void>();
  const clockListeners = new Set<() => void>();
  let running = NO_RUNNING;
  let boxes: ReadonlyArray<RoomBoxProgress> | undefined;
  let byBox = new Map<string, RoomBoxProgress>();
  let byArtifact = new Map<string, RoomBoxProgress>();
  let byComment = new Map<string, RoomBoxProgress>();
  let now = Date.now();
  let timer: ReturnType<typeof setInterval> | null = null;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const runClock = (on: boolean) => {
    if (on && timer === null) {
      now = Date.now();
      timer = setInterval(() => {
        now = Date.now();
        for (const listener of clockListeners) listener();
      }, TICK_MS);
    } else if (!on && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  return {
    setRunning: (next) => {
      if (sameJson(next, running)) return;
      running = next.length === 0 ? NO_RUNNING : next;
      notify();
    },
    setBoxes: (next) => {
      // An entry that did not change keeps its identity, so only its own card renders again.
      const nextByBox = new Map<string, RoomBoxProgress>();
      for (const entry of next ?? []) {
        const previous = byBox.get(entry.boxId);
        nextByBox.set(
          entry.boxId,
          previous !== undefined && sameJson(previous, entry) ? previous : entry,
        );
      }
      const nextByArtifact = new Map<string, RoomBoxProgress>();
      for (const entry of nextByBox.values()) {
        if (entry.artifactId === undefined) continue;
        const held = nextByArtifact.get(entry.artifactId);
        // Several boxes may rewrite one artifact; the one whose draft has come shows.
        if (held === undefined || ((held.draft ?? "") === "" && (entry.draft ?? "") !== "")) {
          nextByArtifact.set(entry.artifactId, entry);
        }
      }
      const nextByComment = new Map<string, RoomBoxProgress>();
      for (const entry of nextByBox.values()) {
        if (entry.commentId !== undefined && !nextByComment.has(entry.commentId)) {
          nextByComment.set(entry.commentId, entry);
        }
      }
      const changed =
        (boxes === undefined) !== (next === undefined) ||
        nextByBox.size !== byBox.size ||
        [...nextByBox].some(([id, entry]) => byBox.get(id) !== entry);
      boxes = next;
      byBox = nextByBox;
      byArtifact = nextByArtifact;
      byComment = nextByComment;
      runClock(nextByBox.size > 0);
      if (changed) notify();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeClock: (listener) => {
      clockListeners.add(listener);
      return () => clockListeners.delete(listener);
    },
    running: () => running,
    hasProgress: () => boxes !== undefined,
    box: (boxId) => byBox.get(boxId),
    artifact: (artifactId) => byArtifact.get(artifactId),
    comment: (commentId) => byComment.get(commentId),
    now: () => now,
  };
}

const IDLE_STORE = createRoomLiveStore();

/** The board's live store; an idle one where no wrapper gives one, as on a team's board. */
export const RoomLiveContext = createContext<RoomLiveStore>(IDLE_STORE);

export function useRoomRunning(): ReadonlyArray<RoomAgentActivity> {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribe, store.running);
}

/** Whether the server reports thread boxes' runs at all; an older one does not. */
export function useRoomHasProgress(): boolean {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribe, store.hasProgress);
}

export function useBoxProgress(boxId: string): RoomBoxProgress | undefined {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribe, () => store.box(boxId));
}

export function useArtifactProgress(artifactId: string): RoomBoxProgress | undefined {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribe, () => store.artifact(artifactId));
}

/** The run an agent answers a comment thread in, while it runs. */
export function useCommentProgress(commentId: string): RoomBoxProgress | undefined {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribe, () => store.comment(commentId));
}

/** The board's clock, which ticks once a second only while a run is in flight. */
export function useBoardNow(): number {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribeClock, store.now);
}
