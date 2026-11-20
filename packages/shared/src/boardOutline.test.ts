import { ROOM_BOARD_OUTLINE_MAX_PER_KIND, RoomBoard, RoomBoardOutline } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { boardOutline } from "./boardOutline.ts";

const board = Schema.decodeUnknownSync(RoomBoard);
const carried = Schema.decodeSync(RoomBoardOutline);
const at = { x: 0, y: 0 };

describe("board outlines", () => {
  it("names artifacts, then thread boxes, then sections, and nothing else on the board", () => {
    const outline = boardOutline(
      board({
        positions: { thread: at },
        notes: [
          { id: "n1", text: "Secret plan", ...at },
          { id: "s1", text: "Ideas", ...at, section: true },
          { id: "b1", text: "  Pricing   research \n", ...at, kind: "thread" },
          { id: "t1", text: "Ship it", ...at, kind: "task" },
          { id: "a1", text: "\n\nLanding page\nsecond line", ...at, kind: "artifact" },
          { id: "c1", text: "On a reply", ...at, kind: "comment", pinnedTo: "message-1" },
          { id: "a2", text: "", ...at, kind: "artifact", viewOf: "a1" },
        ],
      }),
      "Launch plan",
    );
    expect(outline.items).toEqual([
      { id: "a1", kind: "artifact", name: "Landing page" },
      // A live view has no title of its own: it is named after what it shows.
      { id: "a2", kind: "artifact", name: "Landing page" },
      { id: "thread", kind: "thread", name: "Launch plan" },
      { id: "b1", kind: "thread", name: "Pricing research" },
      { id: "s1", kind: "section", name: "Ideas" },
    ]);
  });

  it("gives an unnamed one a name, and a cloud board no room thread", () => {
    const outline = boardOutline(
      board({
        positions: {},
        notes: [
          { id: "a1", text: " ", ...at, kind: "artifact" },
          { id: "b1", text: "", ...at, kind: "thread" },
          { id: "s1", text: "", ...at, section: true },
        ],
      }),
      null,
    );
    expect(outline.items.map((item) => item.name)).toEqual([
      "Untitled artifact",
      "Untitled agent",
      "Untitled section",
    ]);
    expect(boardOutline(undefined, null).items).toEqual([]);
    expect(boardOutline(undefined, "").items).toEqual([
      { id: "thread", kind: "thread", name: "Untitled agent" },
    ]);
  });

  it("stays within what the contract carries however big the board is", () => {
    const notes = Array.from({ length: 90 }, (_, index) => ({
      id: `note-${index}`,
      text: `${"x".repeat(78)}😀 and more`,
      ...at,
      kind: index % 3 === 0 ? "artifact" : "thread",
    }));
    const outline = boardOutline(board({ positions: {}, notes }), "Room");
    expect(carried(outline)).toEqual(outline);
    expect(outline.items.filter((item) => item.kind === "thread")).toHaveLength(
      ROOM_BOARD_OUTLINE_MAX_PER_KIND,
    );
    // Cut before the emoji, never through it.
    expect(outline.items[0]?.name).toBe(`${"x".repeat(78)}…`);
  });
});
