import { GuestId, type RoomBoard, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardExportFileName,
  boardHtmlText,
  boardMarkdown,
  boardPlanMarkdown,
} from "./boardMarkdown.logic";
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
        "# Launch\n\n- [x] Ship it (Done, no priority, no due date, unassigned)\n- [ ] Write docs (In progress, High priority, due 2026-11-20, for Maya)\n- [ ] Untitled task (To do, no priority, no due date, for Sam)\n",
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
        // A live view of the plan: the plan is exported once.
        { id: "v", text: "Phone", x: 0, y: 1500, kind: "artifact", viewOf: "a" },
        { id: "box", text: "Agent", x: 900, y: 0, kind: "thread" },
        { id: "c", text: "A comment", x: 900, y: 600, kind: "comment" },
      ],
      edges: [{ id: "e", from: "note:l", to: "note:s" }],
      markdown:
        "# Launch\n\n## Snapshot of Spec [v2]\n\nThe spec says hi.\n\n## Plan\n\n### Steps\n\n1. Go\n\n## Loose notes\n\n- [Spec \\[v2\\]](https://x.dev/spec)\n",
    },
    {
      name: "an HTML artifact as the text it shows, never its markup",
      notes: [
        {
          id: "w",
          text: "Welcome screen",
          x: 0,
          y: 0,
          kind: "artifact",
          artifact: {
            body: "<!doctype html><html><body><h1>Hi</h1><button>Go</button></body></html>",
            turnId: "t",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
        },
      ],
      markdown:
        "# Launch\n\n## Welcome screen\n\nHTML page: 71 characters, exported as text\n\nHi\n\nGo\n",
    },
    {
      name: "each section over the cards on it, then loose cards under a heading of their own",
      notes: [
        { id: "s2", text: "Later", x: 0, y: 1000, section: true, size: { w: 600, h: 400 } },
        { id: "s1", text: "", x: 0, y: 400, section: true, size: { w: 600, h: 400 } },
        { id: "in1", text: "Inside first", x: 40, y: 450 },
        { id: "in2", text: "Inside later", x: 40, y: 1050 },
        { id: "out", text: "Loose", x: 900, y: 0 },
      ],
      markdown:
        "# Launch\n\n## Untitled section\n\n- Inside first\n\n## Later\n\n- Inside later\n\n## Loose notes\n\n- Loose\n",
    },
    {
      name: "a planned board: Now, Next and Later with their tasks, a snapshot, and loose notes",
      notes: [
        { id: "now", text: "Now", x: 0, y: 0, section: true, size: { w: 700, h: 400 } },
        { id: "next", text: "Next", x: 800, y: 0, section: true, size: { w: 700, h: 400 } },
        { id: "later", text: "Later", x: 1600, y: 0, section: true, size: { w: 700, h: 400 } },
        {
          id: "t1",
          text: "Fix login",
          x: 40,
          y: 60,
          kind: "task",
          status: "doing",
          priority: "urgent",
          due: "2026-11-18",
          assignee: { guestId: maya },
          agent: { boxId: "box", turnId: "turn" },
        },
        { id: "t2", text: "Pricing page", x: 300, y: 60, kind: "task", assignee: {} },
        { id: "t3", text: "Onboarding emails", x: 840, y: 60, kind: "task", priority: "low" },
        { id: "t4", text: "Dark mode", x: 1640, y: 60, kind: "task", done: true },
        {
          id: "link",
          text: "ENG-142",
          x: 0,
          y: 600,
          kind: "link",
          url: "https://linear.app/x/ENG-142",
        },
        {
          id: "snap",
          text: "",
          x: 0,
          y: 760,
          kind: "artifact",
          artifact: {
            body: "# ENG-142\n\nStatus: In progress",
            turnId: "t",
            updatedAt: "2026-11-01T00:00:00.000Z",
          },
        },
        // Below the snapshot, on no section: never under its heading.
        { id: "idea", text: "Ask support what users say", x: 0, y: 1300 },
        { id: "box", text: "Planner", x: 2400, y: 0, kind: "thread" },
      ],
      edges: [{ id: "e", from: "note:link", to: "note:snap" }],
      markdown: [
        "# Launch",
        "## Now",
        "- [ ] Fix login (In progress, Urgent priority, due 2026-11-18, for Maya)\n- [ ] Pricing page (To do, no priority, no due date, for Sam)",
        "## Next",
        "- [ ] Onboarding emails (To do, Low priority, no due date, unassigned)",
        "## Later",
        "- [x] Dark mode (Done, no priority, no due date, unassigned)",
        "## Snapshot of ENG-142",
        "### ENG-142",
        "Status: In progress",
        "## Loose notes",
        "- [ENG-142](https://linear.app/x/ENG-142)\n- Ask support what users say\n",
      ].join("\n\n"),
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
      "# Launch: Plan\n\n## To do\n\n- [ ] First (To do, Urgent priority, no due date, unassigned)\n- [ ] Second (To do, no priority, no due date, unassigned)\n\n## In progress\n\n_No tasks_\n\n## Done\n\n- [x] Done one (Done, no priority, no due date, unassigned)\n",
    );
  });
});

describe("boardHtmlText", () => {
  const welcome = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Welcome to Tinkjam</title>
  <style>body { font-family: Inter; } .cta { color: #DB2D55; }</style>
  <script>window.addEventListener("load", () => console.log("hi"));</script>
</head>
<body>
  <!-- first-run copy -->
  <header><nav><a href="/">Home</a></nav></header>
  <main>
    <h1>Your board,   your team</h1>
    <p>Bring notes, tasks &amp; agents
       into one place.</p>
    <ul>
      <li>Sticky notes</li>
      <li>Agents that <strong>work</strong> beside you</li>
    </ul>
    <button class="cta">Get started &rarr;</button>
    <script type="module">import "./app.js";</script>
  </main>
</body>
</html>`;

  it.each<{
    readonly name: string;
    readonly html: string;
    readonly max?: number;
    readonly text: string;
  }>([
    {
      name: "a first-run page as its title, headings, paragraphs, list items and buttons",
      html: welcome,
      text: "Welcome to Tinkjam\n\nHome\n\nYour board, your team\n\nBring notes, tasks & agents into one place.\n\n- Sticky notes\n- Agents that work beside you\n\nGet started →",
    },
    {
      name: "text past the cap, cut and marked",
      html: "<!doctype html><p>One two three four</p>",
      max: 7,
      text: "One two…(cut)",
    },
    {
      name: "a page's text that would read as Markdown, kept as text",
      html: "<!doctype html><p># not a heading</p><p>&#62; nor a quote &#x2014; ok</p>",
      text: "\\# not a heading\n\n\\> nor a quote — ok",
    },
  ])("exports $name", ({ html, max, text }) => {
    expect(boardHtmlText(html, max)).toBe(text);
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
