import type { RoomBoxProgress } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import { createRoomLiveStore } from "./roomBoardLive";

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
