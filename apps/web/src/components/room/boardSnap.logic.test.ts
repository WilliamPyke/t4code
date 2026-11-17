import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_SNAP_SCREEN_PX,
  boardRectsBounds,
  boardSnapMove,
  boardSnapResize,
  type BoardSnapTargets,
  boardSnapTargets,
} from "./boardSnap.logic";
import type { BoardRect } from "./roomBoard.logic";

const rect = (x: number, y: number, width = 100, height = 100): BoardRect => ({
  x,
  y,
  width,
  height,
});
const targets = (...rects: ReadonlyArray<BoardRect>): BoardSnapTargets => ({ rects, sections: [] });
const threshold = (zoom: number) => BOARD_SNAP_SCREEN_PX / zoom;

describe("boardSnapMove", () => {
  it("snaps an edge on x and a middle on y, and draws a guide through each", () => {
    // Left edges 3 apart; the box's middle (52) 2 below the target's (50).
    const snap = boardSnapMove(rect(103, 32, 50, 40), targets(rect(100, 0, 200, 100)), 6);
    expect({ dx: snap.dx, dy: snap.dy }).toEqual({ dx: -3, dy: -2 });
    expect(snap.guides).toEqual(
      expect.arrayContaining([
        { axis: "x", at: 100, from: 0, to: 100 },
        { axis: "y", at: 50, from: 100, to: 300 },
      ]),
    );
  });

  it("snaps right edges and bottoms too", () => {
    const snap = boardSnapMove(rect(204, 1004), targets(rect(310, 900, 40, 200)), 6);
    // Right edge 304 to the target's left, 310; bottom 1104 to the target's, 1100.
    expect({ dx: snap.dx, dy: snap.dy }).toEqual({ dx: 6, dy: -4 });
  });

  it("keeps the threshold in screen pixels at any zoom", () => {
    const target = targets(rect(100, 500));
    const tenOff = rect(110, 0);
    expect(boardSnapMove(tenOff, target, threshold(1)).dx).toBe(0);
    expect(boardSnapMove(tenOff, target, threshold(0.5)).dx).toBe(-10);
    const fiveOff = rect(105, 0);
    expect(boardSnapMove(fiveOff, target, threshold(1)).dx).toBe(-5);
    expect(boardSnapMove(fiveOff, target, threshold(2)).dx).toBe(0);
  });

  it("snaps to the nearest line when several are in reach", () => {
    const snap = boardSnapMove(
      rect(103, 0, 50, 50),
      targets(rect(100, 300, 50), rect(104, 1000, 50)),
      6,
    );
    expect(snap.dx).toBe(1);
    expect(snap.guides.filter((guide) => guide.axis === "x").map((guide) => guide.at)).toEqual([
      104, 129, 154,
    ]);
  });

  it("spaces a card evenly between two in a row, and marks both gaps", () => {
    const snap = boardSnapMove(rect(172, 0, 50), targets(rect(0, 0), rect(300, 0)), 6);
    expect(snap.dx).toBe(3);
    expect(snap.marks).toEqual([
      { axis: "x", from: 100, to: 175, at: 50 },
      { axis: "x", from: 225, to: 300, at: 50 },
    ]);
  });

  it("spaces a card beside two in a column at the gap between them", () => {
    // A column 50 apart; the card comes 47 below the second.
    const snap = boardSnapMove(rect(0, 297), targets(rect(0, 0), rect(0, 150)), 6);
    expect(snap.dy).toBe(3);
    expect(snap.marks).toEqual([
      { axis: "y", from: 100, to: 150, at: 50 },
      { axis: "y", from: 250, to: 300, at: 50 },
    ]);
  });

  it("does not space against cards out of its row", () => {
    const snap = boardSnapMove(rect(172, 400, 50), targets(rect(0, 0), rect(300, 0)), 6);
    expect(snap.dx).toBe(0);
    expect(snap.marks).toEqual([]);
  });

  it("snaps a selection by its bounding box", () => {
    const box = boardRectsBounds([rect(103, 0, 50, 50), rect(180, 120, 50, 50)]);
    expect(box).toEqual({ x: 103, y: 0, width: 127, height: 170 });
    // Its right edge (230) meets the target's left (232); nothing else is in reach.
    const snap = boardSnapMove(box!, targets(rect(232, 600, 10, 10)), 6);
    expect(snap.dx).toBe(2);
  });

  it("snaps a card in a section to the section's padding", () => {
    const section = rect(0, 0, 500, 300);
    const snap = boardSnapMove(rect(27, 58), { rects: [section], sections: [section] }, 6);
    expect({ dx: snap.dx, dy: snap.dy }).toEqual({ dx: -3, dy: -2 });
    expect(snap.guides.map((guide) => [guide.axis, guide.at])).toEqual([
      ["x", 24],
      ["y", 56],
    ]);
    // Outside the section, its padding is no line.
    expect(boardSnapMove(rect(27, 358), { rects: [section], sections: [section] }, 6).dx).toBe(0);
  });

  it("leaves the card where it is with nothing to snap to", () => {
    expect(boardSnapMove(rect(13, 17), targets(), 6)).toEqual({
      dx: 0,
      dy: 0,
      guides: [],
      marks: [],
    });
  });
});

describe("boardSnapResize", () => {
  it("snaps the moving edge to another card's edge", () => {
    const right = boardSnapResize(
      rect(0, 0, 197, 80),
      { x: "end" },
      targets(rect(200, 300, 40)),
      6,
    );
    expect(right.rect).toEqual(rect(0, 0, 200, 80));
    expect(right.guides).toEqual([{ axis: "x", at: 200, from: 0, to: 400 }]);
    const left = boardSnapResize(
      rect(103, 0, 97, 80),
      { x: "start" },
      targets(rect(100, 300, 40)),
      6,
    );
    expect(left.rect).toEqual(rect(100, 0, 100, 80));
  });

  it("snaps to the same width as a card near it, and marks both", () => {
    const sized = boardSnapResize(
      rect(0, 0, 147, 80),
      { x: "end", y: "end" },
      targets(rect(1000, 500, 150, 300)),
      6,
    );
    expect(sized.rect).toEqual(rect(0, 0, 150, 80));
    expect(sized.marks).toEqual([
      { axis: "x", from: 0, to: 150, at: 86 },
      { axis: "x", from: 1000, to: 1150, at: 806 },
    ]);
  });

  it("leaves the size alone with nothing to snap to", () => {
    expect(boardSnapResize(rect(0, 0, 147, 80), { x: "end", y: "end" }, targets(), 6)).toEqual({
      rect: rect(0, 0, 147, 80),
      guides: [],
      marks: [],
    });
  });
});

describe("boardSnapTargets", () => {
  it("takes the cards in sight, nearest first, up to the cap", () => {
    const item = (x: number, section = false) => ({ rect: rect(x, 0), section });
    const found = boardSnapTargets(
      [item(900), item(200, true), item(5000), item(400)],
      rect(0, 0),
      rect(0, 0, 1000, 1000),
      2,
    );
    expect(found.rects.map((target) => target.x)).toEqual([200, 400]);
    expect(found.sections.map((target) => target.x)).toEqual([200]);
  });
});
