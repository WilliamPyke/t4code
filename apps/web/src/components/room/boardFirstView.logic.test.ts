import { describe, expect, it } from "vite-plus/test";

import { BOARD_FIRST_VIEW_MIN_ZOOM, firstBoardView } from "./boardFirstView.logic";
import { fitBoardOnSurface } from "./roomBoard.logic";

const area = { width: 1440, height: 900 };
const covered = { top: 60, bottom: 70 };
const goals = { x: 0, y: 0, width: 680, height: 460 };
// The sample board: wide, so fitting it all would open it at about 30%.
const sample = [
  goals,
  { x: 720, y: 0, width: 1180, height: 460 },
  { x: 1940, y: 0, width: 980, height: 460 },
  { x: 0, y: 500, width: 1440, height: 520 },
  { x: 3520, y: 0, width: 520, height: 320 },
];

describe("the first view of a board", () => {
  it("fits the whole board when it reads at 70% or more", () => {
    const small = [goals, { x: 720, y: 0, width: 400, height: 300 }];
    expect(firstBoardView({ rects: small, start: null, area, covered, margin: 72 })).toEqual({
      view: fitBoardOnSurface(small, area, covered, 72),
      whole: true,
    });
  });

  it("opens a board too big to read whole on its start, readable, from the board's top-left", () => {
    const { view, whole } = firstBoardView({
      rects: sample,
      start: goals,
      area,
      covered,
      margin: 72,
    });
    expect(whole).toBe(false);
    expect(view.zoom).toBeGreaterThanOrEqual(BOARD_FIRST_VIEW_MIN_ZOOM);
    // Goals, at the board's top-left, sits at the top-left of the screen, not in the middle, and
    // below the hint that offers the rest, which shows under the header (60 + 12 + 40).
    expect(view.x + goals.x * view.zoom).toBe(72);
    expect(view.y + goals.y * view.zoom).toBe(112);
  });

  it("centres a start in the middle of the board, and shows a start too big from its corner", () => {
    const middle = { x: 1940, y: 0, width: 980, height: 460 };
    const centred = firstBoardView({
      rects: sample,
      start: middle,
      area,
      covered,
      margin: 72,
    }).view;
    const left = centred.x + middle.x * centred.zoom;
    const right = area.width - (left + middle.width * centred.zoom);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);

    const huge = { x: 0, y: 500, width: 1440, height: 520 };
    const phone = { width: 390, height: 800 };
    const corner = firstBoardView({ rects: sample, start: huge, area: phone, covered, margin: 72 });
    expect(corner.view.zoom).toBe(BOARD_FIRST_VIEW_MIN_ZOOM);
    expect(corner.view.x + huge.x * corner.view.zoom).toBe(16);
  });

  it("starts at the first card when the board marks no start", () => {
    const rects = [{ x: 400, y: 900, width: 200, height: 100 }, ...sample.slice(1)];
    const { view } = firstBoardView({ rects, start: null, area, covered, margin: 72 });
    // The top-left card is the one at (720, 0): it shows on screen.
    expect(view.x + 720 * view.zoom).toBeGreaterThanOrEqual(0);
    expect(view.x + 720 * view.zoom).toBeLessThan(area.width);
  });
});
