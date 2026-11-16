import { GuestId, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type BoardAgentRun,
  type BoardAgentStatus,
  boardAgentEndOf,
  boardAgentModel,
  boardAgentRecentTurns,
  boardAgentRunOutcome,
  boardAgentRunTasks,
  boardAgentRunStep,
  boardAgentStatus,
  boardAgentStatusLabel,
  boardAltShortcutAllowed,
  sortBoardAgents,
} from "./boardAgents.logic";

const run = (fields: Partial<BoardAgentRun> = {}): BoardAgentRun => ({
  phase: "thinking",
  startedAt: "2026-11-15T10:00:00.000Z",
  ...fields,
});

const sam = GuestId.make("sam");
const idle = { requests: 0, canResolve: false, ended: undefined, answered: false };

describe("boardAgentStatus", () => {
  it.each<[string, Parameters<typeof boardAgentStatus>[0], BoardAgentStatus]>([
    [
      "the owner's own agent asks to approve",
      { ...idle, run: run({ phase: "approval" }), viewer: null },
      { kind: "needs-you", need: "approval" },
    ],
    [
      "a guest's agent asks, as the owner sees it",
      { ...idle, run: run({ phase: "approval", guestId: sam }), viewer: null },
      { kind: "waiting" },
    ],
    [
      "a guest's prompt waits for the owner",
      { ...idle, run: undefined, requests: 1, canResolve: true, viewer: null },
      { kind: "needs-you", need: "request" },
    ],
    [
      "a guest's prompt waits, as that guest sees it",
      { ...idle, run: undefined, requests: 1, viewer: "sam" },
      { kind: "waiting" },
    ],
    [
      "a prompt waits for the owner while the box runs",
      { ...idle, run: run(), requests: 1, canResolve: true, viewer: null },
      { kind: "needs-you", need: "request" },
    ],
    ["a run in flight", { ...idle, run: run(), viewer: "sam" }, { kind: "working" }],
    [
      "a run waiting its turn",
      { ...idle, run: run({ phase: "queued" }), viewer: null },
      { kind: "queued" },
    ],
    [
      "a run that failed",
      { ...idle, run: undefined, ended: "failed", answered: true, viewer: null },
      { kind: "failed" },
    ],
    [
      "a run someone stopped",
      { ...idle, run: undefined, ended: "stopped", answered: true, viewer: null },
      { kind: "stopped" },
    ],
    [
      "a run whose end this client cannot read",
      { ...idle, run: undefined, ended: "ended", viewer: "sam" },
      { kind: "ended" },
    ],
    [
      "a box that answered",
      { ...idle, run: undefined, answered: true, viewer: null },
      { kind: "done" },
    ],
    ["a box never prompted", { ...idle, run: undefined, viewer: null }, { kind: "idle" }],
    [
      "a box whose person's machine is away, after it ended",
      { ...idle, ended: "done", answered: true, offline: true, run: undefined, viewer: null },
      { kind: "offline" },
    ],
    [
      "a box whose machine is away still shows the run it reports",
      { ...idle, offline: true, run: run({ guestId: sam }), viewer: null },
      { kind: "working" },
    ],
  ])("%s", (_, input, expected) => {
    expect(boardAgentStatus(input)).toEqual(expected);
  });

  it("names the model a box last ran on or was last set to, whichever came later", () => {
    expect(
      boardAgentModel([
        { model: "GPT-5.4", at: "2026-11-15T10:00:00.000Z" },
        { model: "Mini", at: "2026-11-15T11:00:00.000Z" },
        undefined,
        { at: "2026-11-15T12:00:00.000Z" },
      ]),
    ).toBe("Mini");
    expect(boardAgentModel([undefined])).toBeUndefined();
  });

  it("says how long a run has worked", () => {
    expect(
      boardAgentStatusLabel({ kind: "working" }, run(), Date.parse("2026-11-15T10:01:12.000Z")),
    ).toBe("Working · 1m 12s");
  });
});

describe("boardAltShortcutAllowed", () => {
  it.each([
    { focus: "board", mac: false, allowed: true },
    { focus: "board", mac: true, allowed: true },
    { focus: "field", mac: false, allowed: true },
    // Option+G types © on a Mac.
    { focus: "field", mac: true, allowed: false },
    { focus: "dialog-field", mac: false, allowed: false },
  ] as const)("from $focus, Mac $mac: $allowed", ({ focus, mac, allowed }) => {
    expect(boardAltShortcutAllowed(focus, mac)).toBe(allowed);
  });
});

describe("boardAgentRunTasks", () => {
  it("lists the task run first first, before tasks lower down run later", () => {
    const note = (id: string, y: number, at: string) =>
      ({ id, text: id, x: 0, y, kind: "task", run: { boxId: "box", at } }) satisfies RoomBoardNote;
    const notes = [
      note("top, run later", 0, "2026-11-15T10:05:00.000Z"),
      note("below, run first", 300, "2026-11-15T10:00:00.000Z"),
    ];
    expect(boardAgentRunTasks(notes, "box").map((task) => task.id)).toEqual([
      "below, run first",
      "top, run later",
    ]);
  });
  it("lists a box's open run tasks top to bottom, then left to right", () => {
    const run = { boxId: "box", at: "2026-11-15T10:00:00.000Z" };
    const note = (id: string, x: number, y: number, extra: Partial<RoomBoardNote> = {}) =>
      ({ id, text: id, x, y, kind: "task", run, ...extra }) satisfies RoomBoardNote;
    const notes: ReadonlyArray<RoomBoardNote> = [
      note("low", 0, 200),
      note("right", 300, 0),
      note("left", 0, 0),
      note("done", 0, 100, { done: true }),
      note("other box", 0, 50, { run: { ...run, boxId: "other" } }),
      note("thread", 0, 60, { kind: "thread" }),
    ];
    expect(boardAgentRunTasks(notes, "box").map((task) => task.id)).toEqual([
      "left",
      "right",
      "low",
    ]);
  });
});

describe("sortBoardAgents", () => {
  it("puts what needs the viewer first, then what works, then the rest by latest activity", () => {
    const rows = [
      { id: "old-done", status: { kind: "done" } as const, activity: 1 },
      { id: "working", status: { kind: "working" } as const, activity: 2 },
      { id: "new-idle", status: { kind: "idle" } as const, activity: 5 },
      { id: "needs", status: { kind: "needs-you", need: "request" } as const, activity: 0 },
      { id: "queued", status: { kind: "queued" } as const, activity: 3 },
    ];
    expect(sortBoardAgents(rows).map((row) => row.id)).toEqual([
      "needs",
      "queued",
      "working",
      "new-idle",
      "old-done",
    ]);
  });
});

describe("boardAgentRunStep", () => {
  it("tells whoever asked once when the run ends, and nobody else", () => {
    const started = boardAgentRunStep(undefined, run(), null, "before");
    expect(started).toEqual({
      next: { startedAt: run().startedAt, askedByViewer: true, turnKey: "before", notified: false },
      notice: null,
    });
    // A tick later the reply has come; the key it started with is kept.
    expect(boardAgentRunStep(started.next, run(), null, "after").next?.turnKey).toBe("before");
    expect(boardAgentRunStep(started.next, undefined, null, "after").notice).toBe("ended");
    // The owner sent Sam's request: it is Sam's to hear about, not the owner's.
    const sams = boardAgentRunStep(undefined, run({ askedBy: sam }), null, "k");
    expect(sams.next?.askedByViewer).toBe(false);
    expect(boardAgentRunStep(sams.next, undefined, null, "k").notice).toBeNull();
    expect(
      boardAgentRunStep(
        boardAgentRunStep(undefined, run({ askedBy: sam }), "sam", "k").next,
        undefined,
        "sam",
        "k",
      ).notice,
    ).toBe("ended");
  });

  it("tells the viewer their own agent needs them, and then nothing more that turn", () => {
    const waiting = boardAgentRunStep(undefined, run({ phase: "approval" }), null, "k");
    expect(waiting.notice).toBe("needs-you");
    expect(
      boardAgentRunStep(waiting.next, run({ phase: "approval" }), null, "k").notice,
    ).toBeNull();
    expect(boardAgentRunStep(waiting.next, undefined, null, "k").notice).toBeNull();
    // Sam's agent, on Sam's machine, waits for Sam, not for the owner.
    expect(
      boardAgentRunStep(undefined, run({ phase: "approval", guestId: sam }), null, "k").notice,
    ).toBeNull();
  });

  it("watches a new run afresh", () => {
    const first = boardAgentRunStep(undefined, run({ phase: "approval" }), null, "a").next;
    const second = boardAgentRunStep(
      first,
      run({ startedAt: "2026-11-15T10:05:00.000Z" }),
      null,
      "b",
    );
    expect(second.next).toMatchObject({ turnKey: "b", notified: false });
  });

  it("takes how a run ended from the record of the machine that ran it, or else from its reply", () => {
    const watched = { turnKey: "a", startedAt: "2026-11-15T10:00:00.000Z" };
    const end = (outcome: "done" | "stopped" | "failed", at = "2026-11-15T10:02:00.000Z") => ({
      outcome,
      at,
    });
    const rows: ReadonlyArray<
      readonly [Parameters<typeof boardAgentRunOutcome>[1], string, boolean, string | null]
    > = [
      // This client reads the box's thread: its record decides, even when a reply came.
      [end("stopped"), "b", false, "stopped"],
      [end("failed"), "a", false, "failed"],
      [end("done"), "b", false, "done"],
      // The record is of an earlier run, or none yet: wait for it, then go by the reply.
      [end("done", "2026-11-15T09:00:00.000Z"), "b", false, null],
      [null, "a", false, null],
      [null, "b", true, "done"],
      [null, "a", true, "ended"],
      // No record to read, as for a guest's own machine: a reply is enough, silence is Ended.
      [undefined, "b", false, "done"],
      [undefined, "a", false, null],
      [undefined, "a", true, "ended"],
    ];
    for (const [known, turnKey, waited, expected] of rows) {
      expect(boardAgentRunOutcome(watched, known, turnKey, waited)).toBe(expected);
    }
  });

  it.each<[string, Parameters<typeof boardAgentEndOf>, ReturnType<typeof boardAgentEndOf>]>([
    ["completed", [{ status: "completed", completedAt: "t" }, false], { outcome: "done", at: "t" }],
    [
      "interrupted",
      [{ status: "interrupted", completedAt: "t" }, true],
      { outcome: "stopped", at: "t" },
    ],
    [
      "cancelled",
      [{ status: "cancelled", completedAt: "t" }, false],
      { outcome: "stopped", at: "t" },
    ],
    ["failed", [{ status: "failed", completedAt: "t" }, false], { outcome: "failed", at: "t" }],
    [
      "failed once stopped",
      [{ status: "failed", completedAt: "t" }, true],
      { outcome: "stopped", at: "t" },
    ],
    ["still running", [{ status: "running", completedAt: null }, false], undefined],
    ["rolled back", [{ status: "rolled_back", completedAt: "t" }, false], undefined],
    ["never ran", [null, false], undefined],
  ])("reads a %s run's end", (_, args, expected) => {
    expect(boardAgentEndOf(...args)).toEqual(expected);
  });

  it("lists recent agent turns newest first, leaving out ones that changed nothing", () => {
    const line = { id: "edge", from: "a", to: "b" };
    const turn = (id: string, at: string, edges: ReadonlyArray<typeof line>) => ({
      id,
      boxId: "box",
      at: `2026-11-15T10:0${at}:00.000Z`,
      cards: [],
      edges,
    });
    const recent = boardAgentRecentTurns([
      turn("first", "1", [line]),
      turn("redone", "5", [line, line]),
      turn("empty", "6", []),
      turn("same-time", "1", [line]),
    ]);
    expect(recent.map(({ turn, line }) => [turn.id, line])).toEqual([
      ["redone", "Drew 2 lines"],
      ["same-time", "Drew 1 line"],
      ["first", "Drew 1 line"],
    ]);
  });
});
