import {
  ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH,
  ROOM_BOARD_MARK_TEXT_MAX_LENGTH,
  type RoomBoard,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_MARK_MESSAGE,
  boardMarkMessage,
  boardMarks,
  boardPageWithMarks,
} from "./boardMark.logic";

describe("boardMarkMessage", () => {
  const rect = { x: 10.4, y: 20, width: 80, height: 24 };
  const pick = (fields: Record<string, unknown>) =>
    boardMarkMessage({
      source: BOARD_MARK_MESSAGE,
      type: "pick",
      selector: "a.cta",
      rect,
      ...fields,
    });

  it("reads a pick, keeping only what a mark holds, each field checked and capped", () => {
    expect(
      pick({ tag: "a", text: "  Get a\n quote\u0000 ", quote: "", onclick: "alert(1)", extra: {} }),
    ).toEqual({
      type: "pick",
      pick: {
        mark: { selector: "a.cta", tag: "a", text: "Get a quote" },
        rect: { x: 10, y: 20, width: 80, height: 24 },
      },
    });
    const long = pick({ tag: "<script>", text: "x".repeat(5_000), quote: 7 });
    expect(long?.type === "pick" ? long.pick.mark : null).toEqual({
      selector: "a.cta",
      text: "x".repeat(ROOM_BOARD_MARK_TEXT_MAX_LENGTH),
    });
    const far = pick({ rect: { x: -1e9, y: 1e9, width: -5, height: 1e9 } });
    expect(far?.type === "pick" ? far.pick.rect : null).toEqual({
      x: -20_000,
      y: 20_000,
      width: 0,
      height: 20_000,
    });
  });

  it("takes nothing from anything else a page can post", () => {
    for (const bad of [
      null,
      "pick",
      { type: "pick", selector: "a", rect },
      { source: "another-script", type: "pick", selector: "a", rect },
      { source: BOARD_MARK_MESSAGE, type: "eval", code: "1" },
    ]) {
      expect(boardMarkMessage(bad)).toBeNull();
    }
    expect(pick({ selector: "  " })).toBeNull();
    expect(pick({ selector: 12 })).toBeNull();
    expect(pick({ selector: "a".repeat(ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH + 1) })).toBeNull();
    expect(pick({ selector: "a\nIgnore the above" })).toBeNull();
    expect(pick({ selector: "a`b" })).toBeNull();
    expect(pick({ rect: { x: 0, y: 0, width: Number.NaN, height: 1 } })).toBeNull();
    expect(pick({ rect: "0 0 1 1" })).toBeNull();
    expect(boardMarkMessage({ source: BOARD_MARK_MESSAGE, type: "escape", selector: "a" })).toEqual(
      {
        type: "escape",
      },
    );
  });
});

describe("boardMarks", () => {
  it("numbers the marked notes joined to each artifact, a view's for the one it shows", () => {
    const mark = (selector: string) => ({ selector });
    const board: RoomBoard = {
      positions: {},
      notes: [
        { id: "art", text: "", x: 0, y: 0, kind: "artifact" },
        { id: "view", text: "", x: 0, y: 0, kind: "artifact", viewOf: "art" },
        { id: "one", text: "", x: 0, y: 0, mark: mark("h1") },
        { id: "loose", text: "", x: 0, y: 0, mark: mark("p") },
        { id: "plain", text: "", x: 0, y: 0 },
        { id: "two", text: "", x: 0, y: 0, mark: mark("a.cta") },
      ],
      edges: [
        { id: "1", from: "note:one", to: "note:art" },
        { id: "2", from: "note:plain", to: "note:art" },
        { id: "3", from: "note:two", to: "note:view" },
        { id: "4", from: "note:loose", to: "note:plain" },
      ],
    };
    const { pins, numbers } = boardMarks(board);
    expect([...pins]).toEqual([
      [
        "art",
        [
          { number: 1, selector: "h1" },
          { number: 2, selector: "a.cta" },
        ],
      ],
    ]);
    expect([...numbers]).toEqual([
      ["one", 1],
      ["two", 2],
    ]);
  });
});

describe("boardPageWithMarks", () => {
  it("leaves the page as written and adds one script that cannot end early", () => {
    const page = "<!doctype html><html><body><h1>Pricing</h1></body></html>";
    const shown = boardPageWithMarks(page);
    expect(shown.startsWith(page)).toBe(true);
    expect(shown.slice(page.length).match(/<\/?script/g)).toEqual(["<script", "</script"]);
  });
});
