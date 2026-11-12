import type { RoomBoard } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { roomBoardWithCards } from "./roomBoard.ts";

describe("roomBoardWithCards", () => {
  const board: RoomBoard = {
    positions: { kept: { x: 1, y: 2 }, gone: { x: 3, y: 4 } },
    notes: [{ id: "note-1", text: "", x: 0, y: 0 }],
    edges: [
      { id: "to-gone", from: "note:note-1", to: "card:gone" },
      { id: "to-kept", from: "card:kept", to: "note:note-1" },
    ],
  };

  it("drops the places and arrows of cards the board no longer has", () => {
    expect(roomBoardWithCards(board, (cardId) => cardId === "kept")).toEqual({
      positions: { kept: { x: 1, y: 2 } },
      notes: board.notes,
      edges: [{ id: "to-kept", from: "card:kept", to: "note:note-1" }],
    });
  });

  it("returns the same board when every card is still there", () => {
    expect(roomBoardWithCards(board, () => true)).toBe(board);
  });
});
