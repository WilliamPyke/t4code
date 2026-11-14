import { describe, expect, it } from "vite-plus/test";

import {
  boardToMinimap,
  boardViewCentredOn,
  minimapFrame,
  minimapItems,
  minimapRect,
  minimapToBoard,
} from "./boardMinimap.logic";
import { visibleBoardRect } from "./roomBoard.logic";

describe("minimapFrame", () => {
  it("fits the cards and the view, centred, and maps board points both ways", () => {
    const content = { x: 0, y: 0, width: 1000, height: 500 };
    const viewport = { x: 0, y: 0, width: 400, height: 300 };
    const frame = minimapFrame(content, viewport, { width: 200, height: 200 });
    // 1000 wide with 6% each side is 1120 board pixels across 200 minimap pixels.
    expect(frame.scale).toBeCloseTo(200 / 1120);
    const topLeft = boardToMinimap(frame, { x: 0, y: 0 });
    const bottomRight = boardToMinimap(frame, { x: 1000, y: 500 });
    // Centred top to bottom, with the same room left and right.
    expect(topLeft.x).toBeCloseTo(200 - bottomRight.x);
    expect(topLeft.y).toBeCloseTo(200 - bottomRight.y);
    const back = minimapToBoard(frame, boardToMinimap(frame, { x: 640, y: -20 }));
    expect(back.x).toBeCloseTo(640);
    expect(back.y).toBeCloseTo(-20);
  });

  it("takes in a view that has wandered off the cards", () => {
    const frame = minimapFrame(
      { x: 0, y: 0, width: 300, height: 200 },
      { x: 2000, y: 1000, width: 400, height: 300 },
      { width: 200, height: 120 },
    );
    const view = minimapRect(frame, { x: 2000, y: 1000, width: 400, height: 300 });
    expect(view.x).toBeGreaterThanOrEqual(0);
    expect(view.y).toBeGreaterThanOrEqual(0);
    expect(view.x + view.width).toBeLessThanOrEqual(200);
    expect(view.y + view.height).toBeLessThanOrEqual(120);
  });

  it("shows the view's rect where the board's view is, and a click there pans the view to it", () => {
    const view = { x: -150, y: 40, zoom: 0.5 };
    const area = { width: 800, height: 600 };
    const visible = visibleBoardRect(view, area);
    expect(visible).toEqual({ x: 300, y: -80, width: 1600, height: 1200 });
    const frame = minimapFrame({ x: 0, y: 0, width: 3000, height: 2000 }, visible, {
      width: 200,
      height: 140,
    });
    const clicked = minimapToBoard(frame, { x: 100, y: 70 });
    const panned = boardViewCentredOn(view, area, clicked);
    expect(panned.zoom).toBe(0.5);
    const middle = visibleBoardRect(panned, area);
    expect(middle.x + middle.width / 2).toBeCloseTo(clicked.x);
    expect(middle.y + middle.height / 2).toBeCloseTo(clicked.y);
  });
});

describe("minimapItems", () => {
  it("draws sections under cards, stickies in their paint and other cards as windows", () => {
    const items = minimapItems(
      {
        positions: { thread: { x: 0, y: 0 }, "guest:gone": { x: 900, y: 900 } },
        notes: [
          { id: "n1", text: "", x: 10, y: 20, color: "pink" as const },
          { id: "a1", text: "", x: 400, y: 0, kind: "artifact" as const },
          { id: "s1", text: "", x: -50, y: -50, section: true as const },
          { id: "c1", text: "", x: 5, y: 5, kind: "comment" as const },
        ],
      },
      ["thread"],
    );
    expect(items.map((item) => [item.tone, item.color, item.x])).toEqual([
      ["section", undefined, -50],
      ["window", undefined, 0],
      ["paint", "pink", 10],
      ["window", undefined, 400],
    ]);
  });
});
