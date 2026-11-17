import type { RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { BOARD_LIVE_EMBEDS_MAX, boardLiveEmbeds } from "./boardEmbed.logic";

const figma = (id: string, x: number, y = 0): RoomBoardNote => ({
  id,
  text: "",
  x,
  y,
  kind: "link",
  url: `https://www.figma.com/design/Key${id}/File`,
});

describe("boardLiveEmbeds", () => {
  const view = { x: 0, y: 0, width: 4_000, height: 1_000 };
  const row = Array.from({ length: 6 }, (_, index) => figma(`f${index}`, index * 600));

  it("loads only framed pages in view, nearest the middle, up to the limit", () => {
    const notes = [
      ...row,
      figma("away", 9_000),
      { ...figma("linear", 0), url: "https://linear.app/acme/issue/ENG-1/x" },
    ];
    const live = boardLiveEmbeds(notes, view, 1, []);
    expect(live.size).toBe(BOARD_LIVE_EMBEDS_MAX);
    expect([...live].toSorted()).toEqual(["f1", "f2", "f3", "f4"]);
  });

  it("loads the one someone clicked first, and none when zoomed far out or out of view", () => {
    expect(boardLiveEmbeds(row, view, 1, ["f0"]).has("f0")).toBe(true);
    expect(boardLiveEmbeds(row, view, 0.2, ["f0"]).size).toBe(0);
    expect(boardLiveEmbeds(row, { ...view, y: 5_000 }, 1, ["f0"]).size).toBe(0);
  });
});
