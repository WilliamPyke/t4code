import { CLOUD_BOARD_PREVIEW_MAX_CHARS, RoomBoard } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_PREVIEW_MAX_SHAPES,
  decodeBoardPreview,
  encodeBoardPreview,
} from "./boardPreview.ts";

const board = Schema.decodeUnknownSync(RoomBoard);

describe("board previews", () => {
  it("keeps where each card is, its kind and paint, and none of its text", () => {
    const preview = encodeBoardPreview(
      board({
        positions: { "guest:ada": { x: 0, y: 0 } },
        sizes: { "guest:ada": { w: 200, h: 160 } },
        notes: [
          {
            id: "n1",
            text: "Secret plan",
            x: 600,
            y: 240,
            color: "pink",
            size: { w: 200, h: 160 },
          },
          { id: "s1", text: "Ideas", x: 0, y: 0, section: true, size: { w: 800, h: 400 } },
          { id: "c1", text: "On a reply", x: 5, y: 5, kind: "comment", pinnedTo: "message-1" },
        ],
      }),
    );
    expect(preview).not.toContain("Secret");
    // The section first, behind the person's card, then the note; the pinned comment is not drawn.
    expect(decodeBoardPreview(preview)).toEqual([
      { x: 0, y: 0, w: 99, h: 50, kind: "section" },
      { x: 0, y: 0, w: 25, h: 20, kind: "card" },
      { x: 74, y: 30, w: 25, h: 20, kind: "note", color: "pink" },
    ]);
  });

  it("stays under its cap however big the board is", () => {
    const notes = Array.from({ length: 400 }, (_, index) => ({
      id: `note-${index}`,
      text: "x".repeat(200),
      x: index * 37,
      y: (index % 13) * 91,
      kind: "task",
    }));
    const preview = encodeBoardPreview(board({ positions: {}, notes }));
    expect(preview.length).toBeLessThanOrEqual(CLOUD_BOARD_PREVIEW_MAX_CHARS);
    expect(decodeBoardPreview(preview)).toHaveLength(BOARD_PREVIEW_MAX_SHAPES);
  });

  it("is empty for an empty board, and reads nothing from what it does not know", () => {
    expect(encodeBoardPreview(board({ positions: {}, notes: [] }))).toBe("");
    expect(encodeBoardPreview(undefined)).toBe("");
    expect(decodeBoardPreview("")).toEqual([]);
    expect(decodeBoardPreview("2:n00000101y")).toEqual([]);
    expect(decodeBoardPreview("1:z00000101yn00000101-")).toEqual([
      { x: 0, y: 0, w: 1, h: 1, kind: "note" },
    ]);
  });
});
