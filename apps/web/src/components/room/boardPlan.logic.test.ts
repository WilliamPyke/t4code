import {
  ROOM_BOARD_MAX_SECTION_SIZE,
  type RoomBoard,
  type RoomBoardNote,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardPlanAppendOrder,
  boardPlanAttachments,
  boardPlanColumns,
  boardPlanDue,
  boardPlanIndexAmong,
  boardPlanMove,
  boardPlanMoveAll,
  boardPlanPick,
  boardPlanShows,
  boardPlanSorted,
  boardPlanTaskPlace,
  boardPlanUntick,
  NO_PLAN_FILTER,
} from "./boardPlan.logic";

const task = (id: string, fields: Partial<RoomBoardNote> = {}): RoomBoardNote => ({
  id,
  text: id,
  x: 0,
  y: 0,
  kind: "task",
  ...fields,
});

const ids = (notes: ReadonlyArray<RoomBoardNote>) => notes.map((note) => note.id);

describe("boardPlanColumns", () => {
  it("puts each task in its column, ordered ones first, the rest as they sit on the board", () => {
    const columns = boardPlanColumns([
      task("low", { y: 300 }),
      task("high", { y: 10, x: 50 }),
      task("left", { y: 10, x: 0 }),
      task("second", { order: 2, y: 900 }),
      task("first", { order: -1 }),
      task("started", { status: "doing" }),
      task("ticked", { done: true }),
      task("ticked-while-started", { done: true, status: "doing" }),
      { id: "note", text: "Not a task", x: 0, y: 0 },
    ]);
    expect(ids(columns.todo)).toEqual(["first", "second", "left", "high", "low"]);
    expect(ids(columns.doing)).toEqual(["started"]);
    expect(ids(columns.done)).toEqual(["ticked", "ticked-while-started"]);
  });
});

describe("boardPlanMove", () => {
  const ordered = boardPlanColumns([
    task("a", { order: 1 }),
    task("b", { order: 2 }),
    task("c", { order: 3 }),
    task("d", { status: "doing" }),
  ]);

  it("gives a moved task an order between its new neighbours, and its new column", () => {
    expect(boardPlanMove(ordered, "c", "todo", 0)).toEqual([{ id: "c", status: "todo", order: 0 }]);
    expect(boardPlanMove(ordered, "a", "todo", 1)).toEqual([
      { id: "a", status: "todo", order: 2.5 },
    ]);
    expect(boardPlanMove(ordered, "a", "todo", 2)).toEqual([{ id: "a", status: "todo", order: 4 }]);
    expect(boardPlanMove(ordered, "b", "done", 0)).toEqual([{ id: "b", status: "done", order: 0 }]);
  });

  it("changes nothing for a task dropped where it is, or one that is gone", () => {
    expect(boardPlanMove(ordered, "b", "todo", 1)).toEqual([]);
    expect(boardPlanMove(ordered, "d", "doing", 5)).toEqual([]);
    expect(boardPlanMove(ordered, "gone", "todo", 0)).toEqual([]);
  });

  it("numbers a column again where a neighbour has no order, or none fits between them", () => {
    const loose = boardPlanColumns([
      task("a", { order: 0 }),
      task("b", { y: 10 }),
      task("c", { y: 20 }),
      task("d", { status: "doing" }),
    ]);
    // Into the unordered tail: every task there takes the order it shows.
    expect(boardPlanMove(loose, "d", "todo", 1)).toEqual([
      { id: "d", status: "todo", order: 1 },
      { id: "b", status: "todo", order: 2 },
      { id: "c", status: "todo", order: 3 },
    ]);
    const tight = boardPlanColumns([task("a", { order: 1 }), task("b", { order: 1 }), task("c")]);
    expect(boardPlanMove(tight, "c", "todo", 1)).toEqual([
      { id: "a", status: "todo", order: 0 },
      { id: "c", status: "todo", order: 1 },
      { id: "b", status: "todo", order: 2 },
    ]);
    // A task added at the bottom lands below the unordered ones, which take their orders first.
    expect(boardPlanAppendOrder(loose.todo)).toEqual({
      order: 3,
      placements: [
        { id: "b", status: "todo", order: 1 },
        { id: "c", status: "todo", order: 2 },
      ],
    });
    expect(boardPlanAppendOrder(ordered.todo)).toEqual({ order: 4, placements: [] });
    expect(boardPlanAppendOrder([])).toEqual({ order: 0, placements: [] });
  });
});

describe("boardPlanMoveAll", () => {
  it("moves picked tasks together to the bottom of a column, in the order they show", () => {
    const columns = boardPlanColumns([
      task("a", { order: 1 }),
      task("b", { order: 2 }),
      task("w", { order: 0, status: "doing" }),
      task("d", { order: 5, done: true }),
    ]);
    expect(boardPlanMoveAll(columns, new Set(["w", "a"]), "done")).toEqual([
      { id: "a", status: "done", order: 6 },
      { id: "w", status: "done", order: 7 },
    ]);
    expect(boardPlanMoveAll(columns, new Set(), "done")).toEqual([]);
  });
});

describe("boardPlanAttachments", () => {
  it("counts the notes, links, artifacts and boxes joined to each task by a line", () => {
    const board: RoomBoard = {
      positions: {},
      notes: [
        task("t"),
        { id: "n", text: "Idea", x: 0, y: 0 },
        { id: "l", text: "", x: 0, y: 0, kind: "link", url: "https://example.com" },
        { id: "a", text: "Spec", x: 0, y: 0, kind: "artifact" },
        { id: "b", text: "Box", x: 0, y: 0, kind: "thread" },
        { id: "b2", text: "Other box", x: 900, y: 0, kind: "thread" },
        { id: "s", text: "Frame", x: 0, y: 0, section: true },
      ],
      edges: [
        { id: "1", from: "note:n", to: "note:t" },
        { id: "2", from: "note:t", to: "note:l" },
        { id: "3", from: "note:a", to: "note:t" },
        { id: "4", from: "note:t", to: "note:b" },
        { id: "5", from: "note:t", to: "card:thread" },
        { id: "6", from: "note:n", to: "note:a" },
        // The task is in the section: its line to a box attaches it; one to a note does not.
        { id: "7", from: "note:s", to: "note:b2" },
        { id: "8", from: "note:s", to: "note:n" },
      ],
    };
    expect(boardPlanAttachments(board).get("t")).toEqual({
      notes: 1,
      links: 1,
      artifacts: 1,
      boxIds: ["b", "thread", "b2"],
    });
    expect(boardPlanAttachments(board).has("n")).toBe(false);
  });
});

describe("boardPlanTaskPlace", () => {
  const spot = ({ x, y }: { x: number; y: number }) => ({ x, y });

  it("puts tasks from the Plan in rows beside the newest, wrapping, never over a card", () => {
    const notes = [task("old", { x: 0, y: 0 }), task("new", { x: 400, y: 0 })];
    const placed: Array<{ x: number; y: number }> = [];
    for (let added = 0; added < 4; added += 1) {
      const at = boardPlanTaskPlace({ positions: {}, notes }, []);
      expect(at.grow).toBeUndefined();
      placed.push(spot(at));
      notes.push(task(`t${added}`, spot(at)));
    }
    // The row fills to four, then wraps under its left end.
    expect(placed).toEqual([
      { x: 648, y: 0 },
      { x: 0, y: 208 },
      { x: 216, y: 208 },
      { x: 432, y: 208 },
    ]);
  });

  it("wraps within the section the newest task is in, and grows it to hold them", () => {
    const tasksSection = { id: "s", text: "Tasks", x: 440, y: 328, section: true as const };
    let board: RoomBoard = {
      positions: {},
      notes: [
        { ...tasksSection, size: { w: 1000, h: 248 } },
        task("a", { x: 464, y: 384 }),
        task("b", { x: 680, y: 384 }),
        task("c", { x: 896, y: 384 }),
        { id: "below", text: "Below", x: 440, y: 1000 },
      ],
    };
    const fourth = boardPlanTaskPlace(board, []);
    expect(fourth).toEqual({ x: 1112, y: 384 });
    board = { ...board, notes: [...board.notes, task("d", spot(fourth))] };
    // The fifth starts a second row inside the section, which grows down to hold it.
    const fifth = boardPlanTaskPlace(board, []);
    expect(fifth).toEqual({ x: 464, y: 592, grow: { id: "s", size: { w: 1000, h: 472 } } });
  });

  it("gives a task the size of the newest one, so a pile an agent or a template made stays even", () => {
    const size = { w: 192, h: 184 };
    const sized = boardPlanTaskPlace({ positions: {}, notes: [task("a", { size })] }, []);
    expect(sized).toEqual({ x: 216, y: 0, size });
    const plain = boardPlanTaskPlace({ positions: {}, notes: [task("a")] }, []);
    expect(plain.size).toBeUndefined();
  });

  it("goes under a section that can grow no more, lined up with its tasks", () => {
    const full = { w: 240, h: ROOM_BOARD_MAX_SECTION_SIZE };
    const board: RoomBoard = {
      positions: {},
      notes: [
        { id: "s", text: "Tasks", x: 0, y: 0, section: true, size: full },
        ...Array.from({ length: 96 }, (_, index) =>
          task(`t${index}`, { x: 24, y: 56 + index * 208 }),
        ),
      ],
    };
    expect(boardPlanTaskPlace(board, [])).toEqual({ x: 24, y: ROOM_BOARD_MAX_SECTION_SIZE + 24 });
  });

  it("goes beside the middle of the board's notes on a board with no task, over none", () => {
    const notes = [
      { id: "a", text: "", x: 0, y: 0 },
      { id: "b", text: "", x: 1000, y: 0 },
      { id: "c", text: "", x: 0, y: 800 },
      { id: "d", text: "", x: 1000, y: 800 },
    ];
    const at = boardPlanTaskPlace({ positions: {}, notes }, []);
    // Near the middle, at (596, 476) for a 192 by 184 task, not right of everything.
    expect(Math.abs(at.x + 96 - 596)).toBeLessThan(200);
    expect(Math.abs(at.y + 92 - 476)).toBeLessThan(200);
  });

  it("goes next to the newest task when the rows beside it are taken, never far off", () => {
    // A wall of notes under and beside the newest task fills every row a pile would use.
    const wall = Array.from({ length: 40 }, (_, index) => ({
      id: `w${index}`,
      text: "",
      x: (index % 8) * 216,
      y: 208 + Math.floor(index / 8) * 208,
    }));
    const row = [216, 432, 648].map((x) => ({ id: `r${x}`, text: "", x, y: 0 }));
    const notes = [task("t", { x: 0, y: 0 }), ...wall, ...row];
    const at = boardPlanTaskPlace({ positions: {}, notes }, []);
    expect(Math.hypot(at.x, at.y)).toBeLessThan(1200);
    const rects = notes.map((note) => ({ x: note.x, y: note.y, w: 192, h: 184 }));
    expect(
      rects.some(
        (rect) =>
          at.x < rect.x + rect.w &&
          at.x + 192 > rect.x &&
          at.y < rect.y + rect.h &&
          at.y + 184 > rect.y,
      ),
    ).toBe(false);
  });
});

describe("Plan filters and sorts", () => {
  const ada = "guest:ada";
  const tasks = [
    task("Write the spec", { priority: "low", due: "2026-12-05" }),
    task("Fix login", { priority: "urgent", assignee: { guestId: ada as never } }),
    task("Ship it", { due: "2026-11-20", assignee: {}, done: true }),
    task("Tidy up"),
  ];

  it("sorts by priority or due day, none last, ties as ordered", () => {
    expect(ids(boardPlanSorted(tasks, "manual"))).toEqual(ids(tasks));
    expect(ids(boardPlanSorted(tasks, "priority"))).toEqual([
      "Fix login",
      "Write the spec",
      "Ship it",
      "Tidy up",
    ]);
    expect(ids(boardPlanSorted(tasks, "due"))).toEqual([
      "Ship it",
      "Write the spec",
      "Fix login",
      "Tidy up",
    ]);
  });

  it("keeps the tasks whose text has every word, for whom it is, and hides done ones", () => {
    const shown = (filter: Partial<typeof NO_PLAN_FILTER>) =>
      ids(tasks.filter((one) => boardPlanShows(one, { ...NO_PLAN_FILTER, ...filter })));
    expect(shown({})).toEqual(ids(tasks));
    expect(shown({ text: " LOGIN fix " })).toEqual(["Fix login"]);
    expect(shown({ person: { guestId: ada } })).toEqual(["Fix login"]);
    expect(shown({ person: { guestId: null } })).toEqual(["Ship it"]);
    expect(shown({ person: "nobody" })).toEqual(["Write the spec", "Tidy up"]);
    expect(shown({ hideDone: true })).toEqual(["Write the spec", "Fix login", "Tidy up"]);
  });

  it("places a drop among the shown tasks before the one it lands above in the whole column", () => {
    const column = ["a", "b", "c", "d"].map((id) => task(id));
    const shown = [column[0]!, column[2]!];
    expect(boardPlanIndexAmong(column, shown, "x", 1)).toBe(2);
    expect(boardPlanIndexAmong(column, shown, "x", 2)).toBe(3);
    expect(boardPlanIndexAmong(column, shown, "a", 0)).toBe(1);
    expect(boardPlanIndexAmong(column, [], "x", 0)).toBe(4);
  });
});

describe("boardPlanPick", () => {
  const plain = { shiftKey: false, ctrlKey: false, metaKey: false };
  const order = ["a", "b", "c", "d"];
  const set = (...items: ReadonlyArray<string>) => new Set(items);

  it("selects with a click, adds with Ctrl, Cmd or Shift, and opens the one selected alone", () => {
    expect(boardPlanPick(set("a", "b"), "a", "c", plain, order)).toEqual({
      picked: set("c"),
      open: false,
    });
    expect(boardPlanPick(set("c"), "c", "c", plain, order)).toEqual({
      picked: set("c"),
      open: true,
    });
    expect(boardPlanPick(set("a"), "a", "c", { ...plain, ctrlKey: true }, order).picked).toEqual(
      set("a", "c"),
    );
    expect(
      boardPlanPick(set("a", "c"), "a", "c", { ...plain, metaKey: true }, order).picked,
    ).toEqual(set("a"));
    // Shift takes every task shown between the last one clicked and this one, either way.
    expect(boardPlanPick(set("d"), "d", "b", { ...plain, shiftKey: true }, order).picked).toEqual(
      set("b", "c", "d"),
    );
    expect(boardPlanPick(set(), null, "b", { ...plain, shiftKey: true }, order).picked).toEqual(
      set("b"),
    );
  });
});

describe("boardPlanUntick", () => {
  const columns = boardPlanColumns([
    task("a", { order: 1 }),
    task("b", { order: 2 }),
    task("c", { order: 3 }),
    task("w", { order: 0, status: "doing" }),
    task("t", { order: 0, done: true }),
  ]);

  it("returns an unticked task to where it was before it was done", () => {
    expect(boardPlanUntick(columns, "t", { status: "todo", order: 2.5 })).toEqual([
      { id: "t", status: "todo", order: 2.5 },
    ]);
    expect(boardPlanUntick(columns, "t", { status: "doing", order: 1 })).toEqual([
      { id: "t", status: "doing", order: 1 },
    ]);
  });

  it("sends it to the bottom of To do when where it was is not known", () => {
    expect(boardPlanUntick(columns, "t", undefined)).toEqual([
      { id: "t", status: "todo", order: 4 },
    ]);
  });
});

describe("boardPlanDue", () => {
  it("says when a task is due, and whether that has passed", () => {
    expect(boardPlanDue("2026-11-17", "2026-11-17")).toEqual({
      label: "Due today",
      overdue: false,
    });
    expect(boardPlanDue("2026-11-18", "2026-11-17").label).toBe("Due tomorrow");
    expect(boardPlanDue("2026-11-10", "2026-11-17").overdue).toBe(true);
    expect(boardPlanDue("2027-01-02", "2026-11-17").label).toContain("2027");
  });
});
