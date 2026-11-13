import type { RoomBoxProgress } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BOARD_DRAG_LANDING_MS,
  type BoardLiveDrag,
  boardLiveRect,
  createRoomLiveStore,
  mergeBoardDrags,
} from "./roomBoardLive";

const run = (boxId: string, fields: Partial<RoomBoxProgress> = {}): RoomBoxProgress => ({
  boxId,
  phase: "thinking",
  startedAt: "2026-11-12T10:00:00.000Z",
  ...fields,
});

describe("createRoomLiveStore", () => {
  it("keeps an unchanged box's run as it was, so a tick renders only the box it changed", () => {
    const live = createRoomLiveStore();
    const notified = vi.fn();
    live.subscribe(notified);
    expect(live.hasProgress()).toBe(false);
    live.setBoxes([run("a"), run("b", { artifactId: "art" })]);
    const [a, b] = [live.box("a"), live.box("b")];
    expect(live.hasProgress()).toBe(true);
    expect(live.artifact("art")).toBe(b);
    // Fresh objects with the same content change nothing.
    live.setBoxes([run("a"), run("b", { artifactId: "art" })]);
    expect(notified).toHaveBeenCalledTimes(1);
    live.setBoxes([run("a"), run("b", { artifactId: "art", phase: "writing", draft: "# Hi" })]);
    expect(live.box("a")).toBe(a);
    expect(live.box("b")).not.toBe(b);
    // Of two boxes rewriting one artifact, the one whose draft has come shows there.
    live.setBoxes([
      run("c", { artifactId: "art" }),
      run("b", { artifactId: "art", draft: "# Hi" }),
    ]);
    expect(live.artifact("art")?.boxId).toBe("b");
    // A run answering a comment thread shows there, until it ends.
    live.setBoxes([run("a", { commentId: "talk" })]);
    expect(live.comment("talk")).toBe(live.box("a"));
    live.setBoxes([run("a")]);
    expect(live.comment("talk")).toBeUndefined();
    live.setBoxes(undefined);
    expect(live.hasProgress()).toBe(false);
  });

  it("ticks its clock once a second only while a run is in flight", () => {
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    vi.useFakeTimers();
    const live = createRoomLiveStore();
    const ticked = vi.fn();
    live.subscribeClock(ticked);
    live.setBoxes([]);
    vi.advanceTimersByTime(3_000);
    expect(ticked).not.toHaveBeenCalled();
    live.setBoxes([run("a")]);
    vi.advanceTimersByTime(3_000);
    expect(ticked).toHaveBeenCalledTimes(3);
    live.setBoxes([]);
    vi.advanceTimersByTime(3_000);
    expect(ticked).toHaveBeenCalledTimes(3);
  });
});

describe("mergeBoardDrags", () => {
  const now = 10_000;
  const item = { ref: "note:a", x: 10, y: 20 };
  const moving: BoardLiveDrag = { x: 10, y: 20, color: "red", landed: false };
  const landed: BoardLiveDrag = { ...moving, landed: true, until: now + BOARD_DRAG_LANDING_MS };
  it.each([
    {
      name: "shows a card someone drags, in their colour",
      previous: {},
      draggers: [{ color: "red", drag: { items: [item] } }],
      next: { "note:a": moving },
    },
    {
      name: "drops a drag that ends without landing: it expired, or the card went back",
      previous: { "note:a": moving },
      draggers: [{ color: "red", drag: undefined }],
      next: {},
    },
    {
      name: "holds a card that landed where it landed",
      previous: { "note:a": moving },
      draggers: [{ color: "red", drag: { items: [item], done: true as const } }],
      next: { "note:a": landed },
    },
    {
      name: "keeps holding it after the pointer post that ends the drag",
      previous: { "note:a": landed },
      draggers: [],
      next: { "note:a": landed },
    },
    {
      name: "lets it go once its time is up, though the post that landed it is still there",
      previous: { "note:a": { ...landed, until: now } },
      draggers: [{ color: "red", drag: { items: [item], done: true as const } }],
      next: {},
    },
    {
      name: "takes a new drag of a card that landed",
      previous: { "note:a": landed },
      draggers: [{ color: "blue", drag: { items: [{ ...item, x: 50 }] } }],
      next: { "note:a": { ...moving, x: 50, color: "blue" } },
    },
    {
      name: "keeps what a resize did not change absent",
      previous: {},
      draggers: [{ color: "red", drag: { items: [{ ref: "card:thread", w: 400 }] } }],
      next: { "card:thread": { w: 400, color: "red", landed: false } },
    },
  ])("$name", ({ previous, draggers, next }) => {
    expect(
      Object.fromEntries(mergeBoardDrags(new Map(Object.entries(previous)), draggers, now)),
    ).toEqual(next);
  });

  it("lets a card that landed go when its time is up, with no post to say so", () => {
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    vi.useFakeTimers();
    const live = createRoomLiveStore();
    const notified = vi.fn();
    live.subscribeDrags(notified);
    live.setDraggers([{ color: "red", drag: { items: [item], done: true } }]);
    live.setDraggers([{ color: "red", drag: undefined }]);
    expect(live.drag("note:a")?.landed).toBe(true);
    vi.advanceTimersByTime(BOARD_DRAG_LANDING_MS);
    expect(live.drag("note:a")).toBeUndefined();
    expect(notified).toHaveBeenCalledTimes(2);
  });

  it("keeps an entry that did not change as it was, so only the cards that move render", () => {
    const first = mergeBoardDrags(new Map(), [{ color: "red", drag: { items: [item] } }], now);
    const again = mergeBoardDrags(first, [{ color: "red", drag: { items: [{ ...item }] } }], now);
    expect(again.get("note:a")).toBe(first.get("note:a"));
  });
});

describe("boardLiveRect", () => {
  const stored = { x: 0, y: 0, w: 200, h: 150 };
  it.each([
    { name: "shows the stored card when nobody drags it", live: undefined, rect: null },
    {
      name: "shows a dragged card where it is now",
      live: { x: 30, y: 40, color: "red", landed: false },
      rect: { ...stored, x: 30, y: 40, color: "red" },
    },
    {
      name: "shows a resized card at its size now",
      live: { w: 320, color: "red", landed: false },
      rect: { ...stored, w: 320, color: "red" },
    },
    {
      name: "holds a card that landed until the stored board says so",
      live: { x: 30, y: 40, color: "red", landed: true, until: 1 },
      rect: { ...stored, x: 30, y: 40, color: "red" },
    },
    {
      name: "lets it go once the stored board has it there",
      live: { x: 0, y: 0, w: 200, color: "red", landed: true, until: 1 },
      rect: null,
    },
  ])("$name", ({ live, rect }) => {
    expect(boardLiveRect(stored, live)).toEqual(rect);
  });
});
