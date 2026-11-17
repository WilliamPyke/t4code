import type { RoomBoard, RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardPlanAppendOrder,
  boardPlanAttachments,
  boardPlanColumns,
  boardPlanDue,
  boardPlanMove,
  boardPlanTaskSpot,
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
        { id: "s", text: "Frame", x: 0, y: 0, section: true },
      ],
      edges: [
        { id: "1", from: "note:n", to: "note:t" },
        { id: "2", from: "note:t", to: "note:l" },
        { id: "3", from: "note:a", to: "note:t" },
        { id: "4", from: "note:t", to: "note:b" },
        { id: "5", from: "note:t", to: "card:thread" },
        { id: "6", from: "note:n", to: "note:a" },
      ],
    };
    expect(boardPlanAttachments(board).get("t")).toEqual({
      notes: 1,
      links: 1,
      artifacts: 1,
      boxIds: ["b", "thread"],
    });
    expect(boardPlanAttachments(board).has("n")).toBe(false);
  });
});

describe("boardPlanTaskSpot", () => {
  it("puts a task from the Plan beside the newest task, clear of everything", () => {
    const board: RoomBoard = {
      positions: {},
      notes: [task("old", { x: 0, y: 0 }), task("new", { x: 400, y: 0 })],
    };
    const spot = boardPlanTaskSpot(board, []);
    expect(spot.y).toBe(0);
    expect(spot.x).toBeGreaterThanOrEqual(400 + 192);
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
