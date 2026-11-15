import { GuestId, ROOM_BOARD_ROOM_BOX, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { BOARD_ASK_NEW_BOX } from "./boardAsk.logic";
import {
  BOARD_RUN_MAX_BOXES,
  BOARD_RUN_STARTING_MS,
  boardRunRefusal,
  boardRunTargets,
  boardRunTasks,
  boardTaskRunState,
  canRunBoardTask,
} from "./boardRun.logic";
import { BOARD_PROMPT_MAX_CARDS } from "./roomBoard.logic";

const sam = GuestId.make("guest:sam");
const task = (id: string, extra: Partial<RoomBoardNote> = {}): RoomBoardNote => ({
  id,
  text: id,
  x: 0,
  y: 0,
  kind: "task",
  ...extra,
});

describe("which tasks a person can run", () => {
  it.each([
    ["an open task of no one's", task("t"), sam, true],
    ["their own task", task("t", { assignee: { guestId: sam } }), sam, true],
    ["the owner's own task, for the owner", task("t", { assignee: {} }), null, true],
    ["the owner's task, for a guest", task("t", { assignee: {} }), sam, false],
    [
      "someone else's task",
      task("t", { assignee: { guestId: GuestId.make("g:ana") } }),
      sam,
      false,
    ],
    ["a done task", task("t", { done: true }), sam, false],
    ["an empty task", task("t", { text: "  " }), sam, false],
    ["a note", task("t", { kind: undefined }), sam, false],
  ])("%s", (_, note, viewer, expected) => {
    expect(canRunBoardTask(note, viewer)).toBe(expected);
  });

  it("takes them top to bottom, left to right, without busy ones, as many as one prompt takes", () => {
    const notes = [
      task("low", { y: 200 }),
      task("right", { x: 300 }),
      task("left"),
      task("busy", { y: 50 }),
      task("done", { done: true }),
    ];
    expect(
      boardRunTasks(notes, null, (note) => note.id === "busy").tasks.map((one) => one.id),
    ).toEqual(["left", "right", "low"]);
    const many = Array.from({ length: BOARD_PROMPT_MAX_CARDS + 2 }, (_, index) =>
      task(`t${index}`, { y: index }),
    );
    const run = boardRunTasks(many, null, () => false);
    expect(run.tasks).toHaveLength(BOARD_PROMPT_MAX_CARDS);
    expect(run.left).toBe(2);
  });
});

describe("where a run goes and when it cannot", () => {
  it("offers the person's idle thread boxes and a new one, not the room thread", () => {
    const targets = [
      { id: ROOM_BOARD_ROOM_BOX, label: "Room" },
      { id: "busy", label: "Busy" },
      { id: "idle", label: "Idle" },
      { id: BOARD_ASK_NEW_BOX, label: "New thread box" },
    ];
    expect(boardRunTargets(targets, (id) => id === "busy").map((one) => one.id)).toEqual([
      "idle",
      BOARD_ASK_NEW_BOX,
    ]);
  });

  it.each([
    ["one box takes any number", "one", 8, 0, null],
    ["a box each, within the cap and the room", "each", 3, 5, null],
    [
      "a box each, over the cap",
      "each",
      BOARD_RUN_MAX_BOXES + 1,
      12,
      `A box per task runs up to ${BOARD_RUN_MAX_BOXES} at once. Select fewer, or use One box for all.`,
    ],
    ["a box each, on a full board", "each", 2, 0, "The board has no room for another thread box."],
    ["a box each, with room for one", "each", 2, 1, "The board has room for 1 more thread box."],
  ] as const)("%s", (_, mode, count, boxesLeft, expected) => {
    expect(boardRunRefusal(mode, count, { boxesLeft, maxBoxes: BOARD_RUN_MAX_BOXES })).toBe(
      expected,
    );
  });
});

describe("what a run task shows", () => {
  const at = "2026-11-15T10:00:00.000Z";
  const ran = task("t", { run: { boxId: "box", at } });
  const now = Date.parse(at);
  const later = now + BOARD_RUN_STARTING_MS;
  const before = { at: "2026-11-15T09:00:00.000Z" };
  const after = { at: "2026-11-15T10:00:05.000Z" };
  it.each([
    ["no run", task("t"), undefined, false, undefined, now, null],
    ["a done task", { ...ran, done: true }, { phase: "thinking" }, false, undefined, now, null],
    ["its box thinking", ran, { phase: "thinking" }, false, undefined, now, "working"],
    ["its box writing", ran, { phase: "writing" }, false, undefined, now, "working"],
    ["its box queued", ran, { phase: "queued" }, false, undefined, now, "queued"],
    ["its box waiting on approval", ran, { phase: "approval" }, false, undefined, now, "approval"],
    ["a guest's request waiting on the owner", ran, undefined, true, undefined, later, "waiting"],
    ["just run, its box not started", ran, undefined, false, undefined, now + 1_000, "starting"],
    ["run a while ago, its box not running", ran, undefined, false, undefined, later, "stopped"],
    ["slow to start, its box never ran", ran, undefined, false, null, later, "starting"],
    ["slow to start, its box's last run older", ran, undefined, false, before, later, "starting"],
    ["its box's run ended since it was run", ran, undefined, false, after, now, "stopped"],
  ] as const)("%s", (_, note, progress, waiting, end, at, expected) => {
    expect(boardTaskRunState(note, progress, waiting, end, at)).toBe(expected);
  });
});
