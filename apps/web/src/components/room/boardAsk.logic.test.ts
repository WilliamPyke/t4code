import type { RoomBoardAgentTurn, RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_ASK_NEW_BOX,
  boardAgentWorkFresh,
  boardAskCards,
  boardAskDefaultTarget,
  boardAskLines,
  boardAskSuggestions,
  boardAskTargets,
} from "./boardAsk.logic";
import { BOARD_PROMPT_MAX_CARDS } from "./roomBoard.logic";

const note = (id: string, extra: Partial<RoomBoardNote> = {}): RoomBoardNote => ({
  id,
  text: id,
  x: 0,
  y: 0,
  ...extra,
});
const card = (target: RoomBoardNote) =>
  target.text.trim() === ""
    ? null
    : {
        ref: `note:${target.id}`,
        label: target.id,
        sharedLabel: target.id,
        text: target.text,
        excerpt: "",
      };

describe("boardAskCards", () => {
  it("takes the cards a prompt can carry, never thread boxes, sections or empty cards", () => {
    const notes = [
      note("idea"),
      note("box", { kind: "thread" }),
      note("frame", { section: true }),
      note("blank", { text: "  " }),
      note("todo", { kind: "task" }),
    ];
    expect(boardAskCards(notes, card).cards.map((one) => one.ref)).toEqual([
      "note:idea",
      "note:todo",
    ]);
    expect(boardAskCards([note("box", { kind: "thread" })], card).cards).toEqual([]);
  });

  it("stops at what one prompt takes and says how many it left", () => {
    const many = Array.from({ length: BOARD_PROMPT_MAX_CARDS + 3 }, (_, index) =>
      note(`n${index}`),
    );
    const asked = boardAskCards(many, card);
    expect(asked.cards).toHaveLength(BOARD_PROMPT_MAX_CARDS);
    expect(asked.left).toBe(3);
  });
});

describe("boardAskSuggestions", () => {
  it.each([
    [
      [{}, {}],
      ["Turn into tasks", "Group by theme", "Summarise"],
    ],
    [[{}], ["Turn into tasks", "Expand on this", "Summarise"]],
    [
      [{ kind: "task" }, { kind: "task" }],
      ["Order by priority", "Split into smaller steps", "Find what's missing"],
    ],
    [[{ kind: "task" }], ["Split into smaller steps", "Find what's missing"]],
    [
      [{}, { kind: "code" }],
      ["Review the changes", "Summarise"],
    ],
    [[{ kind: "artifact" }], ["Suggest improvements", "Summarise"]],
    [
      [{}, { kind: "link" }],
      ["Summarise", "Turn into tasks", "Find what's missing"],
    ],
  ] as const)("fits what is selected: %j", (kinds, labels) => {
    expect(boardAskSuggestions(kinds).map((one) => one.label)).toEqual(labels);
  });
});

describe("boardAskTargets and boardAskDefaultTarget", () => {
  const boxes = [
    { id: "thread", title: "Room" },
    { id: "mine", guestId: "sam", title: "" },
    { id: "eves", guestId: "eve", title: "Eve's" },
  ];

  it("offers only the boxes this person may prompt, and a new one when they may add it", () => {
    expect(boardAskTargets(boxes, "sam", true)).toEqual([
      { id: "mine", label: "Untitled thread" },
      { id: BOARD_ASK_NEW_BOX, label: "New thread box" },
    ]);
    expect(boardAskTargets(boxes, null, false)).toEqual([{ id: "thread", label: "Room" }]);
    expect(boardAskTargets(boxes, "ann", false)).toEqual([]);
  });

  it.each([
    ["a selected box first", ["eves", "mine"], "thread", "mine"],
    ["then the one last asked", [], "thread", "thread"],
    ["a gone last box falls back to the first box", [], "deleted", "mine"],
    ["the first box when none was asked yet", [], null, "mine"],
  ] as const)("starts on %s", (_, selectedBoxes, lastUsed, expected) => {
    const targets = [
      { id: "mine", label: "Mine" },
      { id: "thread", label: "Room" },
      { id: BOARD_ASK_NEW_BOX, label: "New thread box" },
    ];
    expect(boardAskDefaultTarget(targets, { selectedBoxes, lastUsed })).toBe(expected);
  });

  it("starts on a new box when there is none, and on nothing when nothing is offered", () => {
    const onlyNew = [{ id: BOARD_ASK_NEW_BOX, label: "New thread box" }];
    expect(boardAskDefaultTarget(onlyNew, { selectedBoxes: [], lastUsed: null })).toBe(
      BOARD_ASK_NEW_BOX,
    );
    expect(boardAskDefaultTarget([], { selectedBoxes: [], lastUsed: "mine" })).toBeNull();
  });
});

describe("boardAskLines", () => {
  it("draws a line only from cards with none straight into the box, while there is room", () => {
    const edges = [
      { from: "note:a", to: "note:box" },
      { from: "note:b", to: "note:other" },
    ];
    expect(boardAskLines(edges, ["note:a", "note:b", "note:c"], "note:box", 10)).toEqual({
      add: ["note:b", "note:c"],
      going: ["note:a", "note:b", "note:c"],
    });
    expect(boardAskLines(edges, ["note:a", "note:b", "note:c"], "note:box", 3)).toEqual({
      add: ["note:b"],
      going: ["note:a", "note:b"],
    });
  });
});

describe("boardAgentWorkFresh", () => {
  const state = (text: string, x = 0) => ({ text, x, y: 0 });
  const turn = (
    id: string,
    at: string,
    cards: RoomBoardAgentTurn["cards"],
    extra: Partial<RoomBoardAgentTurn> = {},
  ): RoomBoardAgentTurn => ({ id, boxId: "box", at, cards, ...extra });

  it("marks the cards a new turn added or changed", () => {
    const after = [turn("t1", "2026-11-15T10:00:00Z", [{ id: "a", after: state("A") }])];
    expect(boardAgentWorkFresh([], after)).toEqual([{ id: "a", boxId: "box" }]);
  });

  it("marks only what a running turn touched since the last board", () => {
    const before = [
      turn("t1", "2026-11-15T10:00:00Z", [
        { id: "a", after: state("A") },
        { id: "b", after: state("B") },
      ]),
    ];
    const after = [
      turn("t1", "2026-11-15T10:00:05Z", [
        { id: "a", after: state("A") },
        { id: "b", after: state("B", 40) },
        { id: "c", after: state("C") },
      ]),
    ];
    expect(boardAgentWorkFresh(before, after).map((one) => one.id)).toEqual(["b", "c"]);
    expect(boardAgentWorkFresh(after, after)).toEqual([]);
  });

  it("marks nothing for a turn someone took back or did again", () => {
    const cards = [{ id: "a", after: state("A") }];
    const done = turn("t1", "2026-11-15T10:00:00Z", cards);
    const undone = turn("t1", "2026-11-15T10:01:00Z", cards, { undone: true });
    const redone = turn("t1", "2026-11-15T10:02:00Z", cards);
    expect(boardAgentWorkFresh([done], [undone])).toEqual([]);
    expect(boardAgentWorkFresh([undone], [redone])).toEqual([]);
  });
});
