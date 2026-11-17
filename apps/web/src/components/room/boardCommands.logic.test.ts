import { describe, expect, it } from "vite-plus/test";

import {
  type CommandPaletteActionItem,
  type CommandPaletteGroup,
  filterCommandPaletteGroups,
} from "../CommandPalette.logic";
import {
  boardAskQuery,
  boardCardLabel,
  boardCommandsByRecent,
  boardNextCard,
  boardReadingOrder,
  boardRecentWith,
} from "./boardCommands.logic";
import { boardKeyAction } from "./boardShortcuts";

const command = (
  title: string,
  keywords: ReadonlyArray<string> = [],
): CommandPaletteActionItem => ({
  kind: "action",
  value: `board:${title}`,
  searchTerms: [title, ...keywords],
  title,
  icon: null,
  run: async () => {},
});

const BOARD: CommandPaletteGroup = {
  value: "board",
  label: "This board",
  items: [
    command("Add note", ["sticky"]),
    command("Add task", ["todo"]),
    command("Add section", ["frame", "group"]),
    command("Zoom to fit", ["fit", "everything"]),
    command("Zoom to 100%", ["actual size", "reset zoom"]),
    command("Copy invite link", ["share", "invite"]),
    command("Show the Plan", ["view", "switch", "kanban"]),
    command("Download board as PNG", ["export", "image", "picture"]),
  ],
};
const CARDS = [command("Fix the login page"), command("Onboarding checklist")];

const titlesFor = (query: string) =>
  filterCommandPaletteGroups({
    activeGroups: [BOARD],
    query,
    isInSubmenu: false,
    projectSearchItems: [],
    threadSearchItems: [],
    boardSearchItems: CARDS,
    now: 0,
  }).flatMap((group) => group.items.map((item) => item.title));

describe("board commands in the command menu", () => {
  it.each([
    ["a word start", "note", "Add note"],
    ["the starts of two words", "ad ta", "Add task"],
    ["a keyword", "kanban", "Show the Plan"],
    ["a typo", "secton", "Add section"],
    ["a card's words", "login", "Fix the login page"],
    ["an export by what it makes", "png", "Download board as PNG"],
  ])("finds a command by %s", (_, query, first) => {
    expect(titlesFor(query)[0]).toBe(first);
  });

  it("lists every command, and no card, while nothing is typed", () => {
    expect(titlesFor("")).toEqual(BOARD.items.map((item) => item.title));
  });

  it("lists the commands used lately first, newest first, the rest as they were", () => {
    const commands = ["a", "b", "c", "d"].map((id) => ({ id }));
    const recent = boardRecentWith(boardRecentWith([], "c"), "a");
    expect(recent).toEqual(["a", "c"]);
    expect(boardCommandsByRecent(commands, recent).map(({ id }) => id)).toEqual([
      "a",
      "c",
      "b",
      "d",
    ]);
    // Using one again moves it to the front; the list keeps the newest few.
    expect(boardRecentWith(recent, "c")).toEqual(["c", "a"]);
    expect(boardRecentWith(["a", "b", "c"], "d", 3)).toEqual(["d", "a", "b"]);
  });
});

describe("boardCardLabel", () => {
  it.each([
    [{ text: "\n  First line \nsecond", kind: undefined }, "First line"],
    [{ text: "", kind: "link" as const, url: "https://x.dev" }, "https://x.dev"],
    [{ text: "", kind: "task" as const }, "Untitled task"],
    [{ text: "", section: true as const }, "Untitled section"],
    [{ text: "x".repeat(100) }, `${"x".repeat(79)}…`],
  ])("names %j", (note, label) => {
    expect(boardCardLabel(note)).toBe(label);
  });
});

describe("Tab through the cards", () => {
  const rect = (x: number, y: number) => ({ x, y, width: 100, height: 100 });
  const order = boardReadingOrder([
    { ref: "c", rect: rect(0, 300) },
    { ref: "b", rect: rect(400, 20) },
    { ref: "a", rect: rect(0, 0) },
  ]).map(({ ref }) => ref);

  it("reads the board in rows, top to bottom and left to right", () => {
    expect(order).toEqual(["a", "b", "c"]);
  });

  it.each([
    ["the first card with nothing selected", [], 1, "a"],
    ["the last card going back with nothing selected", [], -1, "c"],
    ["the card after the selection", ["a"], 1, "b"],
    ["round to the first after the last", ["c"], 1, "a"],
    ["the card before, going back", ["b"], -1, "a"],
    ["after the last of several selected", ["a", "b"], 1, "c"],
  ] as const)("goes to %s", (_, selected, direction, next) => {
    expect(boardNextCard(order, new Set(selected), direction)).toBe(next);
  });
});

describe("boardKeyAction", () => {
  const key = (fields: Partial<Parameters<typeof boardKeyAction>[0]>) =>
    boardKeyAction({
      key: "",
      code: "",
      ctrlKey: false,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      ...fields,
    });

  it.each([
    [{ key: "n" }, "note"],
    [{ key: "T" }, "task"],
    [{ key: "!", code: "Digit1", shiftKey: true }, "fit"],
    [{ key: ")", code: "Digit0", shiftKey: true }, "zoom-100"],
    [{ key: "=", ctrlKey: true }, "zoom-in"],
    [{ key: "-", metaKey: true }, "zoom-out"],
    [{ key: "g", code: "KeyG", ctrlKey: true }, "group"],
    [{ key: "Tab", shiftKey: true }, "previous-card"],
    [{ key: "?", code: "Slash", shiftKey: true }, "shortcuts"],
    [{ key: "N", shiftKey: true }, null],
    [{ key: "n", altKey: true }, null],
    [{ key: "d", ctrlKey: true }, null],
  ] as const)("reads %j as %s", (event, action) => {
    expect(key(event)).toBe(action);
  });
});

describe("boardAskQuery", () => {
  it("asks what was typed, without an Ask my agent typed before it", () => {
    expect(boardAskQuery("Ask my agent: hello")).toBe("hello");
    expect(boardAskQuery("ask agent, sum up the board")).toBe("sum up the board");
    expect(boardAskQuery("hello")).toBe("hello");
    expect(boardAskQuery("Ask my agent:")).toBe("");
    expect(boardAskQuery("asking for agents")).toBe("asking for agents");
  });
});
