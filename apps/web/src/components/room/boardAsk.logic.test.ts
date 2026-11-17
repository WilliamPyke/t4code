import type { RoomBoardAgentTurn, RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_ASK_NEW_BOX,
  boardAgentWorkFresh,
  boardAskCards,
  boardAskDefaultTarget,
  boardDraftBox,
  boardAskLines,
  boardAskSuggestions,
  boardAskTargets,
  boardPopoverAnchor,
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

  it("takes the first artifact out as the one it edits, even an empty one", () => {
    const plan = note("plan", { kind: "artifact", text: "" });
    const asked = boardAskCards([note("idea"), plan, note("other", { kind: "artifact" })], card);
    expect(asked.artifact).toBe(plan);
    expect(asked.cards.map((one) => one.ref)).toEqual(["note:idea", "note:other"]);
    expect(boardAskCards([note("idea")], card).artifact).toBeNull();
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
    [
      [{}, { kind: "link" }],
      ["Summarise", "Turn into tasks", "Find what's missing"],
    ],
  ] as const)("fits what is selected: %j", (kinds, labels) => {
    expect(boardAskSuggestions(kinds).map((one) => one.label)).toEqual(labels);
  });

  const content = (body: string) => ({ artifact: { body } });
  it.each([
    ["an empty artifact", [], {}, ["Write a first draft", "Make a web page"]],
    [
      "an empty artifact with cards",
      [{}],
      {},
      ["Write a first draft", "Write it from the cards", "Make a web page"],
    ],
    [
      "a document",
      [],
      content("# Plan"),
      ["Rewrite this", "Make it shorter", "Turn into a web page"],
    ],
    [
      "a page with cards",
      [{ kind: "task" }],
      content("<!doctype html><html></html>"),
      ["Rewrite this", "Make it shorter", "Turn into a document", "Work in the cards"],
    ],
  ] as const)("edits the artifact asked about: %s", (_, kinds, artifact, labels) => {
    expect(boardAskSuggestions(kinds, artifact).map((one) => one.label)).toEqual(labels);
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
    expect(
      boardAskTargets(boxes, null, false, (id) => (id === "thread" ? "Haiku" : undefined)),
    ).toEqual([{ id: "thread", label: "Room", model: "Haiku" }]);
  });

  it.each([
    ["a selected box first", ["eves", "mine"], "thread", "thread", "mine"],
    ["then the box that writes the artifact", [], "thread", "deleted", "thread"],
    ["then the one last asked", [], null, "thread", "thread"],
    ["a gone last box falls back to the first box", [], "gone", "deleted", "mine"],
    ["the first box when none was asked yet", [], null, null, "mine"],
  ] as const)("starts on %s", (_, selectedBoxes, artifactBox, lastUsed, expected) => {
    const targets = [
      { id: "mine", label: "Mine" },
      { id: "thread", label: "Room" },
      { id: BOARD_ASK_NEW_BOX, label: "New thread box" },
    ];
    expect(boardAskDefaultTarget(targets, { selectedBoxes, artifactBox, lastUsed })).toBe(expected);
  });

  it("starts on a new box when there is none, and on nothing when nothing is offered", () => {
    const onlyNew = [{ id: BOARD_ASK_NEW_BOX, label: "New thread box" }];
    expect(boardAskDefaultTarget(onlyNew, { selectedBoxes: [], lastUsed: null })).toBe(
      BOARD_ASK_NEW_BOX,
    );
    expect(boardAskDefaultTarget([], { selectedBoxes: [], lastUsed: "mine" })).toBeNull();
  });
});

describe("boardDraftBox", () => {
  const own = [
    { id: "thread", ranAt: "2026-11-17T09:00:00.000Z" },
    { id: "qa", ranAt: "2026-11-17T10:00:00.000Z" },
    { id: "spare" },
  ];
  const none = { selected: [], lastUsed: null };

  it.each([
    ["the one selected", { ...none, selected: ["spare"] }, { boxId: "spare" }],
    [
      "not two selected",
      { ...none, selected: ["spare", "thread"], lastUsed: "thread" },
      { boxId: "thread" },
    ],
    ["never someone else's selected", { ...none, selected: ["eves"] }, { boxId: "qa" }],
    [
      "the box that wrote it",
      { ...none, preferred: "spare", lastUsed: "thread" },
      { boxId: "spare" },
    ],
    ["the one used last here", { ...none, lastUsed: "thread" }, { boxId: "thread" }],
    ["else the one that ran last, not the board's main box", none, { boxId: "qa" }],
  ] as const)("goes to %s", (_, hints, expected) => {
    expect(boardDraftBox(own, hints)).toEqual(expected);
  });

  it("asks which when nothing says, and takes an only box", () => {
    expect(boardDraftBox([{ id: "thread" }, { id: "spare" }], none)).toEqual({
      pick: ["thread", "spare"],
    });
    expect(boardDraftBox([{ id: "spare" }], none)).toEqual({ boxId: "spare" });
    expect(boardDraftBox([], { ...none, lastUsed: "eves" })).toBeNull();
  });
});

describe("boardAskLines", () => {
  it("draws a line only from cards with none straight into the box, while there is room", () => {
    const edges = [
      { from: "note:a", to: "note:box" },
      { from: "note:b", to: "note:other" },
    ];
    const into = (from: string) => ({ from, to: "note:box" });
    expect(boardAskLines(edges, ["note:a", "note:b", "note:c"], "note:box", 10)).toEqual({
      add: [into("note:b"), into("note:c")],
      going: ["note:a", "note:b", "note:c"],
    });
    expect(boardAskLines(edges, ["note:a", "note:b", "note:c"], "note:box", 3)).toEqual({
      add: [into("note:b")],
      going: ["note:a", "note:b"],
    });
  });

  it("draws the box's line to the artifact it edits first, unless it has one", () => {
    const edges = [{ from: "note:a", to: "note:box" }];
    const toArtifact = { from: "note:box", to: "note:art" };
    expect(boardAskLines(edges, ["note:b"], "note:box", 2, "note:art")).toEqual({
      add: [toArtifact],
      going: [],
    });
    expect(boardAskLines([...edges, toArtifact], ["note:b"], "note:box", 3, "note:art")).toEqual({
      add: [{ from: "note:b", to: "note:box" }],
      going: ["note:b"],
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

describe("boardPopoverAnchor", () => {
  const bounds = { x: 0, y: 60, width: 1000, height: 780 };
  const room = { width: 320, height: 240 };
  it("anchors at the selection while the popover fits below or above it", () => {
    const high = { x: 10, y: 100, width: 200, height: 100 };
    expect(boardPopoverAnchor(high, bounds, room)).toBe(high);
    const low = { x: 10, y: 700, width: 200, height: 100 };
    expect(boardPopoverAnchor(low, bounds, room)).toBe(low);
    expect(boardPopoverAnchor(high, undefined, room)).toBe(high);
  });
  it("puts the popover beside a tall selection, right then left, and over it only as a last resort", () => {
    // Tall, from near the header to near the toolbar: a flat line right of it, `offset` above
    // the selection's top, so the popover's top lines up with the selection's.
    expect(boardPopoverAnchor({ x: 10, y: 120, width: 200, height: 600 }, bounds, room, 8)).toEqual(
      { x: 222, y: 112, width: 320, height: 0 },
    );
    // No room on the right: on the left.
    expect(
      boardPopoverAnchor({ x: 600, y: 120, width: 300, height: 600 }, bounds, room, 8),
    ).toEqual({ x: 268, y: 112, width: 320, height: 0 });
    // Starting above the visible area: the popover's top stays inside the bounds.
    expect(boardPopoverAnchor({ x: 10, y: -200, width: 200, height: 1000 }, bounds, room)).toEqual({
      x: 222,
      y: 60,
      width: 320,
      height: 0,
    });
    // Neither side has room: over the selection's lower part, the popover's room above the toolbar.
    expect(boardPopoverAnchor({ x: 200, y: 120, width: 600, height: 600 }, bounds, room)).toEqual({
      x: 200,
      y: 120,
      width: 600,
      height: 480,
    });
  });
  it("clears the selection's bar too, wherever the bar sits", () => {
    const selection = { x: 100, y: 100, width: 400, height: 300 };
    // Bar below the selection, wider than it: the popover goes below the bar, at the selection's left.
    expect(
      boardPopoverAnchor(selection, bounds, room, 8, { x: 50, y: 408, width: 500, height: 32 }),
    ).toEqual({ x: 100, y: 100, width: 400, height: 340 });
    // Bar beside a tall selection: the popover goes right of the bar.
    expect(
      boardPopoverAnchor({ x: 10, y: 120, width: 200, height: 600 }, bounds, room, 8, {
        x: 218,
        y: 120,
        width: 300,
        height: 32,
      }),
    ).toEqual({ x: 530, y: 112, width: 320, height: 0 });
  });
});
