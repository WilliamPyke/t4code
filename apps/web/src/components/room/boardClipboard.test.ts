import { GuestId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardCopyOf, boardPastedCopies, rememberBoardCopy } from "./boardClipboard";
import { boardBounds, boardPointedSpot } from "./roomBoard.logic";

const maya = GuestId.make("maya");
const sam = GuestId.make("sam");
const copies = [
  {
    note: { id: "a", text: "First", x: 100, y: 100, guestId: maya, color: "pink" as const },
    rect: { x: 100, y: 100, width: 200, height: 150 },
  },
  {
    note: { id: "b", text: "Second", x: 400, y: 100, kind: "task" as const },
    rect: { x: 400, y: 100, width: 192, height: 184 },
  },
];

describe("pasting copied cards", () => {
  it("makes them new cards of whoever pastes them, as they were copied", () => {
    let next = 0;
    const newId = () => `new-${(next += 1)}`;
    expect(boardPastedCopies(copies, sam, newId).map(({ note }) => note)).toEqual([
      { id: "new-1", text: "First", x: 100, y: 100, guestId: sam, color: "pink" },
      { id: "new-2", text: "Second", x: 400, y: 100, kind: "task", guestId: sam },
    ]);
    // The owner's own cards carry no guest.
    expect(boardPastedCopies(copies, null, newId)[0]?.note).not.toHaveProperty("guestId");
  });

  it("lands them at the pointer when it is in view, else in the middle of the view", () => {
    const bounds = boardBounds(copies.map(({ rect }) => rect));
    if (bounds === null) throw new Error("No bounds");
    const size = { w: bounds.width, h: bounds.height };
    const view = { x: 0, y: 0, width: 2000, height: 1200 };
    expect(boardPointedSpot(size, { x: 1200, y: 700 }, view, [])).toEqual({
      x: 1200 - bounds.width / 2,
      y: 700 - bounds.height / 2,
    });
    const middle = boardPointedSpot(size, { x: 5000, y: 5000 }, view, []);
    expect(middle).toEqual({ x: 1000 - bounds.width / 2, y: 600 - bounds.height / 2 });
  });

  it("knows its own copy by the text it put on the clipboard, whatever the line endings", () => {
    rememberBoardCopy("First\n\nSecond", copies);
    expect(boardCopyOf("First\r\n\r\nSecond")).toEqual(copies);
    expect(boardCopyOf("Something else")).toBeNull();
  });
});
