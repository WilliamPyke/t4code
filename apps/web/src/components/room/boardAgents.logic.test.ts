import { GuestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type BoardAgentRun,
  type BoardAgentStatus,
  boardAgentRunOutcome,
  boardAgentRunStep,
  boardAgentStatus,
  boardAgentStatusLabel,
  sortBoardAgents,
} from "./boardAgents.logic";

const run = (fields: Partial<BoardAgentRun> = {}): BoardAgentRun => ({
  phase: "thinking",
  startedAt: "2026-11-15T10:00:00.000Z",
  ...fields,
});

const sam = GuestId.make("sam");
const idle = { requests: 0, canResolve: false, failed: false, answered: false };

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
      "a run that ended without a reply",
      { ...idle, run: undefined, failed: true, answered: true, viewer: null },
      { kind: "failed" },
    ],
    [
      "a box that answered",
      { ...idle, run: undefined, answered: true, viewer: null },
      { kind: "done" },
    ],
    ["a box never prompted", { ...idle, run: undefined, viewer: null }, { kind: "idle" }],
  ])("%s", (_, input, expected) => {
    expect(boardAgentStatus(input)).toEqual(expected);
  });

  it("says how long a run has worked", () => {
    expect(
      boardAgentStatusLabel({ kind: "working" }, run(), Date.parse("2026-11-15T10:01:12.000Z")),
    ).toBe("Working · 1m 12s");
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

  it("tells a finished run from one that ended without a reply", () => {
    expect(boardAgentRunOutcome({ turnKey: "a" }, "b")).toBe("finished");
    expect(boardAgentRunOutcome({ turnKey: "a" }, "a")).toBe("failed");
  });
});
