import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  EMPTY_BOARD_LAYOUT,
  INITIAL_BOARD_VIEW,
  addBoardNote,
  boardMessages,
  moveBoardCard,
  parseBoardLayout,
  placeBoardCards,
  screenToBoard,
  serializeBoardLayout,
  zoomBoardAt,
} from "./roomBoard.logic";

describe("zoomBoardAt", () => {
  it("keeps the board point under the cursor where it is, within the zoom limits", () => {
    const anchor = { x: 400, y: 260 };
    const panned = { x: -120, y: 35, zoom: 1 };
    const held = screenToBoard(panned, anchor);
    const zoomed = zoomBoardAt(panned, anchor, 1.5);
    expect(zoomed.zoom).toBe(1.5);
    expect(screenToBoard(zoomed, anchor).x).toBeCloseTo(held.x);
    expect(screenToBoard(zoomed, anchor).y).toBeCloseTo(held.y);

    expect(zoomBoardAt(INITIAL_BOARD_VIEW, anchor, 100).zoom).toBe(BOARD_MAX_ZOOM);
    expect(zoomBoardAt(INITIAL_BOARD_VIEW, anchor, 0.001).zoom).toBe(BOARD_MIN_ZOOM);
  });
});

describe("placeBoardCards", () => {
  it("keeps saved positions and gives a new card a free slot, not one under a saved card", () => {
    const first = placeBoardCards(["thread", "guest:a"], {});
    expect(first.thread).not.toEqual(first["guest:a"]);

    // The owner left "guest:a" exactly where the grid would put the first card.
    const saved = { "guest:a": first.thread! };
    const placed = placeBoardCards(["thread", "guest:a", "guest:b"], saved);
    expect(placed["guest:a"]).toEqual(saved["guest:a"]);
    const spots = Object.values(placed).map((point) => `${point.x}:${point.y}`);
    expect(new Set(spots).size).toBe(3);
  });
});

describe("parseBoardLayout", () => {
  it("reads back what was saved and ignores anything else stored under the key", () => {
    const layout = addBoardNote(moveBoardCard(EMPTY_BOARD_LAYOUT, "thread", { x: 12, y: 34 }), {
      id: "note:1",
      text: "Ship Friday",
      x: 1,
      y: 2,
    });
    expect(parseBoardLayout(serializeBoardLayout(layout))).toEqual(layout);
    expect(parseBoardLayout(null)).toEqual(EMPTY_BOARD_LAYOUT);
    expect(parseBoardLayout("{")).toEqual(EMPTY_BOARD_LAYOUT);
    expect(parseBoardLayout(JSON.stringify({ positions: { thread: { x: "left" } } }))).toEqual(
      EMPTY_BOARD_LAYOUT,
    );
  });
});

describe("boardMessages", () => {
  it("shows the newest messages oldest first, naming the guest who wrote one", () => {
    const messages = boardMessages(
      [
        { id: "1", type: "user_message", text: "Old question" },
        { id: "2", type: "assistant_message", text: "Old answer" },
        { id: "3", type: "command_execution" },
        {
          id: "4",
          type: "user_message",
          text: "Message from guest Sam, sent by the owner:\n\nWhy 15 minutes?",
          context: { guest: { name: "Sam", text: "Why 15 minutes?" } },
        },
        { id: "5", type: "assistant_message", text: "  The token TTL is 900s.  " },
        { id: "6", type: "assistant_message", text: "" },
      ],
      3,
    );
    expect(messages).toEqual([
      { id: "2", author: null, text: "Old answer" },
      { id: "4", author: "Sam", text: "Why 15 minutes?" },
      { id: "5", author: null, text: "The token TTL is 900s." },
    ]);
  });
});
