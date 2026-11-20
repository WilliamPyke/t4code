import type { RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_LIVE_EMBEDS_MAX,
  boardCanFramePage,
  boardEmbedTitleOf,
  boardEmbedTitleUrl,
  boardLiveEmbeds,
} from "./boardEmbed.logic";

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

  it("loads a page someone chose to show only for a viewer who asked for it", () => {
    const page: RoomBoardNote = { ...figma("page", 0), url: "https://example.com/a", framed: true };
    const unsafe: RoomBoardNote = { ...page, id: "unsafe", url: "https://192.168.0.1/" };
    const { framed: _framed, ...hidden } = { ...page, id: "hidden" };
    const notes = [page, unsafe, hidden];
    expect(boardLiveEmbeds(notes, view, 1, []).size).toBe(0);
    const asked = new Set(["page", "unsafe", "hidden"]);
    expect([...boardLiveEmbeds(notes, view, 1, [], asked)]).toEqual(["page"]);
  });
});

describe("boardCanFramePage", () => {
  it("offers a page for any other public site, never one of ours or a source's own frame", () => {
    const own = ["app.tinkjam.com"];
    expect(boardCanFramePage("https://example.com/a", own)).toBe(true);
    expect(boardCanFramePage("https://github.com/acme/app", own)).toBe(true);
    expect(boardCanFramePage("https://www.figma.com/design/Key/File", own)).toBe(false);
    expect(boardCanFramePage("https://boards.tinkjam.com/b/1", own)).toBe(false);
    // The other of our domains is ours too, though this page is not on it.
    expect(boardCanFramePage("https://app.trellium.org/b/1", own)).toBe(false);
    expect(boardCanFramePage("http://example.com/a", own)).toBe(false);
    expect(boardCanFramePage(undefined, own)).toBe(false);
  });
});

describe("boardEmbedTitleUrl", () => {
  it("reads a video's title from its source's keyless oEmbed, and nothing else", () => {
    const video = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
    expect(boardEmbedTitleUrl(video)).toBe(
      `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(video)}`,
    );
    expect(boardEmbedTitleUrl("https://www.figma.com/design/Key/File")).toBeNull();
    expect(boardEmbedTitleUrl("https://example.com/watch?v=1")).toBeNull();
    expect(boardEmbedTitleOf({ title: "  Never Gonna Give You Up " })).toBe(
      "Never Gonna Give You Up",
    );
    expect(boardEmbedTitleOf({ title: 4 })).toBeNull();
    expect(boardEmbedTitleOf(null)).toBeNull();
  });
});
