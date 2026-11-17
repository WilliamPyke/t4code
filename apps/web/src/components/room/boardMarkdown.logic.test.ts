import { GuestId, type RoomBoard, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardExportFileName, boardMarkdown, boardPlanMarkdown } from "./boardMarkdown.logic";
import type { BoardPeople } from "./roomBoard.logic";

const maya = GuestId.make("maya");
const people: BoardPeople = {
  guests: [{ id: maya, name: "Maya" }],
  viewer: null,
  ownerName: "Sam",
};
const board = (notes: ReadonlyArray<RoomBoardNote>, edges: RoomBoard["edges"] = []): RoomBoard => ({
  positions: {},
  notes: [...notes],
  edges,
});

describe("boardMarkdown", () => {
  it.each<{
    readonly name: string;
    readonly notes: ReadonlyArray<RoomBoardNote>;
    readonly edges?: RoomBoard["edges"];
    readonly markdown: string;
  }>([
    {
      name: "an empty board as its title alone",
      notes: [],
      markdown: "# Launch\n",
    },
    {
      name: "notes as bullets in reading order, a second line indented under the first",
      notes: [
        { id: "b", text: "Second", x: 300, y: 10 },
        { id: "a", text: "First\nmore", x: 0, y: 0 },
        { id: "c", text: "Below", x: 0, y: 400 },
        { id: "blank", text: "  ", x: 0, y: 800 },
      ],
      markdown: "# Launch\n\n- First\n  more\n- Second\n- Below\n",
    },
    {
      name: "tasks as a checklist with status, priority, due day and who it is for",
      notes: [
        { id: "t1", text: "Ship it", x: 0, y: 0, kind: "task", done: true },
        {
          id: "t2",
          text: "Write docs",
          x: 300,
          y: 0,
          kind: "task",
          status: "doing",
          priority: "high",
          due: "2026-11-20",
          assignee: { guestId: maya },
        },
        { id: "t3", text: "", x: 600, y: 0, kind: "task", assignee: {} },
      ],
      markdown:
        "# Launch\n\n- [x] Ship it (Done)\n- [ ] Write docs (In progress, High, due 2026-11-20, for Maya)\n- [ ] Untitled task (To do, for Sam)\n",
    },
    {
      name: "links as links, and an artifact and a link's snapshot as their text",
      notes: [
        { id: "l", text: "Spec [v2]", x: 0, y: 0, kind: "link", url: "https://x.dev/spec" },
        {
          id: "s",
          text: "",
          x: 0,
          y: 300,
          kind: "artifact",
          artifact: {
            body: "The spec says hi.",
            turnId: "t",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
        },
        {
          id: "a",
          text: "Plan",
          x: 0,
          y: 900,
          kind: "artifact",
          artifact: {
            body: "## Steps\n\n1. Go",
            turnId: "t",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
        },
        { id: "box", text: "Agent", x: 900, y: 0, kind: "thread" },
        { id: "c", text: "A comment", x: 900, y: 600, kind: "comment" },
      ],
      edges: [{ id: "e", from: "note:l", to: "note:s" }],
      markdown:
        "# Launch\n\n- [Spec \\[v2\\]](https://x.dev/spec)\n\n### Snapshot of Spec [v2]\n\nThe spec says hi.\n\n### Plan\n\n## Steps\n\n1. Go\n",
    },
    {
      name: "loose cards first, then each section as a heading over the cards on it",
      notes: [
        { id: "s2", text: "Later", x: 0, y: 1000, section: true, size: { w: 600, h: 400 } },
        { id: "s1", text: "", x: 0, y: 400, section: true, size: { w: 600, h: 400 } },
        { id: "in1", text: "Inside first", x: 40, y: 450 },
        { id: "in2", text: "Inside later", x: 40, y: 1050 },
        { id: "out", text: "Loose", x: 900, y: 0 },
      ],
      markdown:
        "# Launch\n\n- Loose\n\n## Untitled section\n\n- Inside first\n\n## Later\n\n- Inside later\n",
    },
  ])("writes $name", ({ notes, edges, markdown }) => {
    expect(boardMarkdown(board(notes, edges), "Launch", people)).toBe(markdown);
  });

  it("puts a card on two sections under the smaller one", () => {
    const notes: ReadonlyArray<RoomBoardNote> = [
      { id: "big", text: "Big", x: 0, y: 0, section: true, size: { w: 1200, h: 1200 } },
      { id: "small", text: "Small", x: 100, y: 100, section: true, size: { w: 500, h: 400 } },
      { id: "n", text: "Here", x: 150, y: 160 },
    ];
    expect(boardMarkdown(board(notes), "Launch", people)).toBe(
      "# Launch\n\n## Big\n\n## Small\n\n- Here\n",
    );
  });
});

describe("boardPlanMarkdown", () => {
  it("lists each column's tasks in the Plan's order, and says when a column is empty", () => {
    const notes: ReadonlyArray<RoomBoardNote> = [
      { id: "b", text: "Second", x: 0, y: 100, kind: "task" },
      { id: "a", text: "First", x: 0, y: 0, kind: "task", priority: "urgent" },
      { id: "d", text: "Done one", x: 0, y: 0, kind: "task", done: true },
      { id: "n", text: "A note", x: 0, y: 0 },
    ];
    expect(boardPlanMarkdown(board(notes), "Launch", people)).toBe(
      "# Launch: Plan\n\n## To do\n\n- [ ] First (To do, Urgent)\n- [ ] Second (To do)\n\n## In progress\n\n_No tasks_\n\n## Done\n\n- [x] Done one (Done)\n",
    );
  });
});

describe("boardExportFileName", () => {
  it.each([
    ["Q4 Launch: plan!", "", "md", "q4-launch-plan.md"],
    ["Q4 Launch", "plan", "md", "q4-launch-plan.md"],
    ["Café board", "", "png", "cafe-board.png"],
    ["!!!", "", "md", "board.md"],
  ])("names %j as a file", (title, what, extension, name) => {
    expect(boardExportFileName(title, what, extension)).toBe(name);
  });
});
