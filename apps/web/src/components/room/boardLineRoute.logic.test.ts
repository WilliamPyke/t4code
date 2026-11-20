import { describe, expect, it } from "vite-plus/test";

import { boardLine, boardLineObstaclesNear } from "./boardLineRoute.logic";
import { type BoardBox, boardCardBox, boardNoteBox } from "./roomBoard.logic";

// A 320 by 240 card at the origin; notes are 192 by 144.
const card = boardCardBox({ x: 0, y: 0 });
const box = (x: number, y: number, width: number, height: number): BoardBox => ({
  x,
  y,
  width,
  height,
});

const boardElbow = (from: BoardBox, to: BoardBox, obstacles?: ReadonlyArray<BoardBox>) =>
  boardLine("elbow", from, to, undefined, obstacles);

/** Whether any run of the path passes through the box, or closer to it than `clear`. */
const passes = (path: string, { x, y, width, height }: BoardBox, clear: number) => {
  const numbers = (path.match(/-?[\d.]+/g) ?? []).map(Number);
  const points = numbers.flatMap((value, index) =>
    index % 2 === 0 ? [{ x: value, y: numbers[index + 1] ?? 0 }] : [],
  );
  return points.some((point, index) => {
    const before = points[index - 1];
    return (
      before !== undefined &&
      Math.max(before.x, point.x) > x - clear &&
      Math.min(before.x, point.x) < x + width + clear &&
      Math.max(before.y, point.y) > y - clear &&
      Math.min(before.y, point.y) < y + height + clear
    );
  });
};

describe("boardElbow", () => {
  it.each([
    ["straight across to a note level with it", { x: 520, y: 48 }, "M320 120 L516 120"],
    [
      "with two corners halfway to a note a little lower",
      { x: 520, y: 180 },
      "M320 120 L410 120 Q418 120 418 128 L418 244 Q418 252 426 252 L516 252",
    ],
    [
      "with one corner into the top of a note far below",
      { x: 520, y: 620 },
      "M320 120 L608 120 Q616 120 616 128 L616 616",
    ],
    // Too close for the usual run out of each side: it still leaves and arrives square.
    ["across a narrow gap", { x: 350, y: 60 }, "M320 120 L327 120 Q333 120 333 126"],
  ] as const)("runs %s", (_, at, path) => {
    expect(boardElbow(card, boardNoteBox(at)).path.startsWith(path)).toBe(true);
  });

  it("finds the point halfway along its runs", () => {
    expect(boardElbow(card, boardNoteBox({ x: 520, y: 180 })).middle).toEqual({ x: 418, y: 186 });
  });

  it("goes around a card in its way, and keeps the plain way when nothing is", () => {
    const note = boardNoteBox({ x: 900, y: 48 });
    const plain = boardElbow(card, note).path;
    expect(plain).toBe("M320 120 L896 120");
    const between = box(480, 0, 240, 240);
    const around = boardElbow(card, note, [between]).path;
    expect(passes(plain, between, 0)).toBe(true);
    expect(passes(around, between, 15)).toBe(false);
    // Still out of the card's right side and square into the note's left.
    expect(around.startsWith("M320 120 L")).toBe(true);
    expect(around.endsWith(" L896 120")).toBe(true);
    // A card off to the side changes nothing.
    expect(boardElbow(card, note, [box(480, 300, 240, 240)]).path).toBe(plain);
  });

  it("threads between several cards without touching one", () => {
    const note = boardNoteBox({ x: 1000, y: 400 });
    const others = [boardNoteBox({ x: 440, y: 60 }), boardNoteBox({ x: 700, y: 300 })];
    const { path } = boardElbow(card, note, others);
    for (const other of others) expect(passes(path, other, 15)).toBe(false);
    expect(passes(path, card, 0)).toBe(false);
    expect(passes(path, note, 0)).toBe(false);
  });

  it("keeps the plain way when its end is walled in", () => {
    const note = boardNoteBox({ x: 900, y: 48 });
    const walls = [
      box(800, -60, 400, 40),
      box(800, 260, 400, 40),
      box(800, -20, 40, 280),
      box(1160, -20, 40, 280),
    ];
    expect(boardElbow(card, note, walls).path).toBe(boardElbow(card, note).path);
  });

  it("minds only the cards near the line", () => {
    const note = boardNoteBox({ x: 900, y: 48 });
    const near = box(480, 300, 240, 240);
    const far = box(480, 400, 240, 240);
    expect(boardLineObstaclesNear(card, note, [far, near])).toEqual([near]);
  });
});
