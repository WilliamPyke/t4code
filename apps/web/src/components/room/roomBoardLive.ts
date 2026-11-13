import type { RoomAgentActivity, RoomBoardDrag, RoomBoxProgress } from "@t3tools/contracts";
import { type CSSProperties, createContext, use, useSyncExternalStore } from "react";

const TICK_MS = 1_000;
const NO_RUNNING: ReadonlyArray<RoomAgentActivity> = [];

/** How long a card someone let go is held where it landed while the stored board catches up. */
export const BOARD_DRAG_LANDING_MS = 3_000;

/** A card or note someone else drags, where and how big it is now, in their colour. */
export interface BoardLiveDrag {
  readonly x?: number | undefined;
  readonly y?: number | undefined;
  readonly w?: number | undefined;
  readonly h?: number | undefined;
  readonly color: string;
  /** Let go: held where it landed until `until`, or until the stored board has it there. */
  readonly landed: boolean;
  readonly until?: number;
}

/** Someone on the board and what they drag now, if anything. */
export interface BoardDragger {
  readonly color: string;
  readonly drag: RoomBoardDrag | undefined;
}

/**
 * The cards others drag now, by board ref, from everyone's latest pointers. A drag that ends
 * without landing goes at once; one that landed is held there until its time is up. An entry that
 * did not change keeps its identity, so only the cards that moved render again.
 */
export function mergeBoardDrags(
  previous: ReadonlyMap<string, BoardLiveDrag>,
  draggers: ReadonlyArray<BoardDragger>,
  now: number,
): Map<string, BoardLiveDrag> {
  const next = new Map<string, BoardLiveDrag>();
  const entryOf = (
    color: string,
    { ref: _ref, ...fields }: RoomBoardDrag["items"][number],
    landed: boolean,
  ): BoardLiveDrag => ({ ...fields, color, landed });
  for (const { color, drag } of draggers) {
    if (drag === undefined || drag.done === true) continue;
    for (const item of drag.items) {
      if (!next.has(item.ref)) next.set(item.ref, entryOf(color, item, false));
    }
  }
  for (const { color, drag } of draggers) {
    if (drag?.done !== true) continue;
    for (const item of drag.items) {
      if (next.has(item.ref)) continue;
      const entry = entryOf(color, item, true);
      const before = previous.get(item.ref);
      const until =
        before?.landed === true && sameJson({ ...before, until: undefined }, entry)
          ? (before.until ?? now)
          : now + BOARD_DRAG_LANDING_MS;
      if (until > now) next.set(item.ref, { ...entry, until });
    }
  }
  for (const [ref, entry] of previous) {
    if (!next.has(ref) && entry.landed && (entry.until ?? now) > now) next.set(ref, entry);
  }
  for (const [ref, entry] of next) {
    const before = previous.get(ref);
    if (before !== undefined && sameJson(before, entry)) next.set(ref, before);
  }
  return next;
}

interface StoredRect {
  readonly x: number;
  readonly y: number;
  readonly w?: number | undefined;
  readonly h?: number | undefined;
}

/**
 * Where a card shows while someone else drags it, or null to show it as stored: once nobody drags
 * it, or once it landed where the stored board now has it.
 */
export function boardLiveRect(
  stored: StoredRect,
  live: BoardLiveDrag | undefined,
): (StoredRect & { readonly color: string }) | null {
  if (live === undefined) return null;
  const rect = {
    x: live.x ?? stored.x,
    y: live.y ?? stored.y,
    w: live.w ?? stored.w,
    h: live.h ?? stored.h,
  };
  const arrived =
    rect.x === stored.x && rect.y === stored.y && rect.w === stored.w && rect.h === stored.h;
  return live.landed && arrived ? null : { ...rect, color: live.color };
}

/**
 * How a card someone else drags is drawn: moved from where it is stored by a short transform
 * that smooths the steps between their posts, and outlined in their colour.
 */
export const boardLiveStyle = (
  stored: { readonly x: number; readonly y: number },
  live: ReturnType<typeof boardLiveRect>,
  scale?: number,
): CSSProperties | undefined =>
  live === null
    ? undefined
    : {
        transform: `translate(${live.x - stored.x}px, ${live.y - stored.y}px)${scale === undefined || scale === 1 ? "" : ` scale(${scale})`}`,
        transition: "transform 100ms linear",
        outline: `2px solid ${live.color}`,
        outlineOffset: 2,
      };

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
  /** Everyone else's latest pointers' drags, as they arrive. */
  readonly setDraggers: (draggers: ReadonlyArray<BoardDragger>) => void;
  readonly subscribeDrags: (listener: () => void) => () => void;
  readonly drag: (ref: string) => BoardLiveDrag | undefined;
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
  const dragListeners = new Set<() => void>();
  let draggers: ReadonlyArray<BoardDragger> = [];
  let drags: ReadonlyMap<string, BoardLiveDrag> = new Map();
  let landingTimer: ReturnType<typeof setTimeout> | null = null;
  const mergeDrags = () => {
    const at = Date.now();
    const next = mergeBoardDrags(drags, draggers, at);
    const changed = next.size !== drags.size || [...next].some(([ref, e]) => drags.get(ref) !== e);
    drags = next;
    if (landingTimer !== null) clearTimeout(landingTimer);
    landingTimer = null;
    const landings = [...next.values()].flatMap((entry) =>
      entry.until === undefined ? [] : [entry.until],
    );
    if (landings.length > 0) landingTimer = setTimeout(mergeDrags, Math.min(...landings) - at);
    if (changed) for (const listener of dragListeners) listener();
  };
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
    setDraggers: (next) => {
      draggers = next;
      mergeDrags();
    },
    subscribeDrags: (listener) => {
      dragListeners.add(listener);
      return () => dragListeners.delete(listener);
    },
    drag: (ref) => drags.get(ref),
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

/** Where someone else drags this card or note now, if anyone does. */
export function useBoardLiveDrag(ref: string): BoardLiveDrag | undefined {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribeDrags, () => store.drag(ref));
}

/** The board's clock, which ticks once a second only while a run is in flight. */
export function useBoardNow(): number {
  const store = use(RoomLiveContext);
  return useSyncExternalStore(store.subscribeClock, store.now);
}
