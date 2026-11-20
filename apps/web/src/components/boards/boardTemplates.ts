import {
  ROOM_BOARD_THREAD_CARD,
  roomBoardCardRef,
  roomBoardNoteRef,
  type RoomBoardChange,
  type RoomBoardNoteColor,
  type RoomBoardSummaryShape,
} from "@t3tools/contracts";

/** Something a template puts on a new board, named by a key only the template uses. */
type BoardTemplateItem =
  | {
      readonly key: string;
      readonly kind: "section";
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly w: number;
      readonly h: number;
      readonly color: RoomBoardNoteColor;
    }
  | {
      readonly key: string;
      readonly kind: "note";
      readonly text: string;
      readonly x: number;
      readonly y: number;
      readonly color: RoomBoardNoteColor;
    }
  | {
      readonly key: string;
      /** A thread box is named by its text, and starts empty on the default model. */
      readonly kind: "task" | "artifact" | "thread";
      readonly text: string;
      readonly x: number;
      readonly y: number;
    };

/** Where a line starts or ends: an item's key, or the board's own thread box. */
type BoardTemplateEnd = string | typeof THREAD;

export interface BoardTemplate {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  /** What it says when made in the cloud, where the board has no thread box, when that differs. */
  readonly cloudDescription?: string;
  /** Where the board's own thread box goes. */
  readonly thread: { readonly x: number; readonly y: number };
  readonly items: ReadonlyArray<BoardTemplateItem>;
  readonly lines: ReadonlyArray<{ readonly from: BoardTemplateEnd; readonly to: BoardTemplateEnd }>;
}

const THREAD = Symbol("thread");

// The board draws these sizes for cards that carry none; the thumbnail draws them the same.
const NOTE_SIZE = { w: 192, h: 144 };
// A task card is taller than a note: it carries its assignee and run buttons.
const TASK_SIZE = { w: 192, h: 184 };
const ARTIFACT_SIZE = { w: 380, h: 400 };
const THREAD_SIZE = { w: 320, h: 420 };
const BOX_SIZE = { w: 340, h: 460 };

export const BLANK_BOARD_TEMPLATE: BoardTemplate = {
  id: "blank",
  name: "Blank",
  description: "An empty board with its thread box.",
  cloudDescription: "An empty board.",
  thread: { x: 80, y: 72 },
  items: [],
  lines: [],
};

export const BOARD_TEMPLATES: ReadonlyArray<BoardTemplate> = [
  BLANK_BOARD_TEMPLATE,
  {
    id: "project-kickoff",
    name: "Project kickoff",
    description: "Goals, open questions and first tasks, for the team to fill in together.",
    thread: { x: 80, y: 40 },
    items: [
      {
        key: "goals",
        kind: "section",
        text: "Goals",
        x: 440,
        y: 40,
        w: 480,
        h: 248,
        color: "yellow",
      },
      {
        key: "goal",
        kind: "note",
        text: "What are we trying to achieve?",
        x: 464,
        y: 96,
        color: "yellow",
      },
      {
        key: "done",
        kind: "note",
        text: "How will we know it worked?",
        x: 680,
        y: 96,
        color: "yellow",
      },
      {
        key: "questions",
        kind: "section",
        text: "Open questions",
        x: 960,
        y: 40,
        w: 480,
        h: 248,
        color: "pink",
      },
      {
        key: "unknown",
        kind: "note",
        text: "What do we still need to find out?",
        x: 984,
        y: 96,
        color: "pink",
      },
      { key: "who", kind: "note", text: "Who should we ask?", x: 1200, y: 96, color: "pink" },
      {
        key: "tasks",
        kind: "section",
        text: "Tasks",
        x: 440,
        y: 328,
        w: 1000,
        h: 248,
        color: "green",
      },
      { key: "task-first", kind: "task", text: "First step", x: 464, y: 384 },
      { key: "task-next", kind: "task", text: "Next step", x: 680, y: 384 },
      { key: "task-share", kind: "task", text: "Share the plan with the team", x: 896, y: 384 },
    ],
    lines: [],
  },
  {
    id: "plan-feature",
    name: "Plan a feature",
    description:
      "Goal, ideas, tasks and open questions, and a spec the agent writes. The goal goes with every prompt.",
    thread: { x: 500, y: 40 },
    // The spec sits left of the thread box and the goal in a column to its right, so each line is
    // short and crosses nothing else.
    items: [
      {
        key: "goal",
        kind: "section",
        text: "Goal",
        x: 860,
        y: 40,
        w: 240,
        h: 536,
        color: "yellow",
      },
      {
        key: "ideas",
        kind: "section",
        text: "Ideas",
        x: 1140,
        y: 40,
        w: 480,
        h: 248,
        color: "blue",
      },
      {
        key: "questions",
        kind: "section",
        text: "Questions",
        x: 1660,
        y: 40,
        w: 480,
        h: 248,
        color: "pink",
      },
      {
        key: "tasks",
        kind: "section",
        text: "Tasks",
        x: 1140,
        y: 328,
        w: 1000,
        h: 248,
        color: "green",
      },
      {
        key: "goal-what",
        kind: "note",
        text: "What should it do, and for whom?",
        x: 884,
        y: 96,
        color: "yellow",
      },
      {
        key: "goal-done",
        kind: "note",
        text: "How will we know it works?",
        x: 884,
        y: 272,
        color: "yellow",
      },
      {
        key: "idea",
        kind: "note",
        text: "An approach worth trying",
        x: 1164,
        y: 96,
        color: "blue",
      },
      {
        key: "question",
        kind: "note",
        text: "What do we still need to find out?",
        x: 1684,
        y: 96,
        color: "pink",
      },
      { key: "task-first", kind: "task", text: "First step", x: 1164, y: 384 },
      { key: "task-next", kind: "task", text: "Next step", x: 1380, y: 384 },
      // Level with the thread box and 40px from it, so its line runs straight across.
      { key: "spec", kind: "artifact", text: "Spec", x: 80, y: 40 },
    ],
    lines: [
      { from: "goal-what", to: THREAD },
      { from: "goal-done", to: THREAD },
      { from: THREAD, to: "spec" },
    ],
  },
  {
    id: "research-agents",
    name: "Research with agents",
    description: "Questions for a researcher agent, its findings, and a reviewer to check them.",
    thread: { x: 80, y: 40 },
    items: [
      {
        key: "questions",
        kind: "section",
        text: "Questions",
        x: 440,
        y: 40,
        w: 480,
        h: 248,
        color: "blue",
      },
      {
        key: "question",
        kind: "note",
        text: "What do we want to find out?",
        x: 464,
        y: 96,
        color: "blue",
      },
      {
        key: "question-next",
        kind: "note",
        text: "Another question",
        x: 680,
        y: 96,
        color: "blue",
      },
      {
        key: "how",
        kind: "note",
        text: "How to use this board: select the questions, choose Ask an agent, and pick Researcher.",
        x: 440,
        y: 328,
        color: "yellow",
      },
      { key: "researcher", kind: "thread", text: "Researcher", x: 960, y: 40 },
      { key: "findings", kind: "artifact", text: "Findings", x: 1340, y: 40 },
      { key: "reviewer", kind: "thread", text: "Reviewer", x: 1760, y: 40 },
    ],
    lines: [
      { from: "researcher", to: "findings" },
      { from: "findings", to: "reviewer" },
    ],
  },
  {
    id: "build-agents",
    name: "Build with agents",
    description: "A backlog of tasks and a builder agent to work through them.",
    thread: { x: 80, y: 40 },
    items: [
      {
        key: "backlog",
        kind: "section",
        text: "Backlog",
        x: 440,
        y: 40,
        w: 240,
        h: 680,
        color: "blue",
      },
      {
        key: "doing",
        kind: "section",
        text: "Doing",
        x: 720,
        y: 40,
        w: 240,
        h: 680,
        color: "yellow",
      },
      {
        key: "done",
        kind: "section",
        text: "Done",
        x: 1000,
        y: 40,
        w: 240,
        h: 680,
        color: "green",
      },
      { key: "task-first", kind: "task", text: "Write the first version", x: 464, y: 96 },
      { key: "task-tests", kind: "task", text: "Add tests for it", x: 464, y: 296 },
      { key: "task-docs", kind: "task", text: "Update the docs", x: 464, y: 496 },
      { key: "task-doing", kind: "task", text: "Set up the project", x: 744, y: 96 },
      { key: "task-done", kind: "task", text: "Agree on what to build", x: 1024, y: 96 },
      { key: "builder", kind: "thread", text: "Builder", x: 1280, y: 40 },
      {
        key: "how",
        kind: "note",
        text: "Select tasks, then Run with an agent and pick Builder.",
        x: 1660,
        y: 40,
        color: "yellow",
      },
    ],
    lines: [],
  },
  {
    id: "bug-bash",
    name: "Bug bash",
    description: "Bugs move from reported to fixed. Reported bugs go to the agent.",
    thread: { x: 80, y: 40 },
    items: [
      {
        key: "reported",
        kind: "section",
        text: "Reported",
        x: 440,
        y: 40,
        w: 480,
        h: 400,
        color: "pink",
      },
      {
        key: "reproducing",
        kind: "section",
        text: "Reproducing",
        x: 960,
        y: 40,
        w: 480,
        h: 400,
        color: "yellow",
      },
      {
        key: "fixed",
        kind: "section",
        text: "Fixed",
        x: 1480,
        y: 40,
        w: 480,
        h: 400,
        color: "green",
      },
      {
        key: "bug",
        kind: "note",
        text: "What broke? Steps, what you expected, what happened",
        x: 464,
        y: 96,
        color: "pink",
      },
      { key: "bug-next", kind: "note", text: "Another bug", x: 464, y: 272, color: "pink" },
      {
        key: "repro",
        kind: "note",
        text: "Who is looking, and what they found",
        x: 984,
        y: 96,
        color: "yellow",
      },
      { key: "fix", kind: "task", text: "Fixed, with a link to the change", x: 1504, y: 96 },
    ],
    lines: [
      { from: "bug", to: THREAD },
      { from: "bug-next", to: THREAD },
    ],
  },
  {
    id: "design-review",
    name: "Design review",
    description: "What to review, everyone's feedback, and the decisions it leads to.",
    thread: { x: 80, y: 40 },
    items: [
      {
        key: "review",
        kind: "section",
        text: "To review",
        x: 440,
        y: 40,
        w: 480,
        h: 248,
        color: "blue",
      },
      {
        key: "link",
        kind: "note",
        text: "Paste a link to the design here: Figma, a doc or a screenshot",
        x: 464,
        y: 96,
        color: "blue",
      },
      {
        key: "ask",
        kind: "note",
        text: "What feedback do we need?",
        x: 680,
        y: 96,
        color: "blue",
      },
      {
        key: "decisions",
        kind: "section",
        text: "Decisions",
        x: 440,
        y: 328,
        w: 480,
        h: 408,
        color: "green",
      },
      { key: "decision", kind: "task", text: "What we decided, and who does it", x: 464, y: 384 },
      {
        key: "likes",
        kind: "section",
        text: "Likes",
        x: 960,
        y: 40,
        w: 440,
        h: 216,
        color: "green",
      },
      {
        key: "changes",
        kind: "section",
        text: "Changes",
        x: 960,
        y: 280,
        w: 440,
        h: 216,
        color: "yellow",
      },
      {
        key: "questions",
        kind: "section",
        text: "Questions",
        x: 960,
        y: 520,
        w: 440,
        h: 216,
        color: "pink",
      },
      { key: "like", kind: "note", text: "What works well", x: 984, y: 96, color: "green" },
      { key: "change", kind: "note", text: "What should change", x: 984, y: 336, color: "yellow" },
      { key: "question", kind: "note", text: "What is unclear", x: 984, y: 576, color: "pink" },
    ],
    lines: [],
  },
  {
    id: "retro",
    name: "Retro",
    description: "What went well, what to improve, and the actions to take.",
    thread: { x: 1600, y: 40 },
    items: [
      {
        key: "well",
        kind: "section",
        text: "Went well",
        x: 40,
        y: 40,
        w: 480,
        h: 400,
        color: "green",
      },
      {
        key: "improve",
        kind: "section",
        text: "To improve",
        x: 560,
        y: 40,
        w: 480,
        h: 400,
        color: "pink",
      },
      {
        key: "actions",
        kind: "section",
        text: "Actions",
        x: 1080,
        y: 40,
        w: 480,
        h: 400,
        color: "blue",
      },
      { key: "helped", kind: "note", text: "Something that helped", x: 64, y: 96, color: "green" },
      {
        key: "slowed",
        kind: "note",
        text: "Something that slowed us down",
        x: 584,
        y: 96,
        color: "pink",
      },
      { key: "try", kind: "task", text: "One thing to try next time", x: 1104, y: 96 },
    ],
    lines: [],
  },
];

/** The few templates a first board is offered from: blank, and two that fill in. */
export const STARTER_BOARD_TEMPLATES: ReadonlyArray<BoardTemplate> = [
  "blank",
  "project-kickoff",
  "design-review",
].map((id) => BOARD_TEMPLATES.find((template) => template.id === id)!);

/**
 * The changes that lay a template out on a new board, in the order the board takes them: the
 * thread box first (which keeps the board), sections before the cards over them, lines last.
 * Every note and line gets a new id from `newId`.
 */
export function boardTemplateChanges(
  template: BoardTemplate,
  newId: () => string,
): ReadonlyArray<RoomBoardChange> {
  const ids = new Map(template.items.map((item) => [item.key, newId()]));
  const refOf = (end: BoardTemplateEnd) =>
    end === THREAD ? roomBoardCardRef(ROOM_BOARD_THREAD_CARD) : roomBoardNoteRef(ids.get(end)!);
  const ordered = [
    ...template.items.filter((item) => item.kind === "section"),
    ...template.items.filter((item) => item.kind !== "section"),
  ];
  return [
    { type: "card.move", cardId: ROOM_BOARD_THREAD_CARD, ...template.thread },
    ...ordered.map((item): RoomBoardChange => {
      const base = {
        type: "note.put",
        noteId: ids.get(item.key)!,
        text: item.text,
        x: item.x,
        y: item.y,
      } as const;
      switch (item.kind) {
        case "section":
          return { ...base, section: true, size: { w: item.w, h: item.h }, color: item.color };
        case "note":
          return { ...base, color: item.color };
        case "task":
        case "artifact":
        case "thread":
          return { ...base, kind: item.kind };
      }
    }),
    ...template.lines.map((line): RoomBoardChange => ({
      type: "edge.put",
      edgeId: newId(),
      from: refOf(line.from),
      to: refOf(line.to),
    })),
  ];
}

/** A template drawn as a board's thumbnail draws it; a cloud board has no thread box of its own. */
export function boardTemplateShapes(
  template: BoardTemplate,
  cloud = false,
): ReadonlyArray<RoomBoardSummaryShape> {
  return [
    ...(cloud ? [] : [{ kind: "thread" as const, ...template.thread, ...THREAD_SIZE }]),
    ...template.items.map((item): RoomBoardSummaryShape => {
      switch (item.kind) {
        case "section":
          return { kind: "section", x: item.x, y: item.y, w: item.w, h: item.h, color: item.color };
        case "note":
          return { kind: "note", x: item.x, y: item.y, ...NOTE_SIZE, color: item.color };
        case "task":
          return { kind: "task", x: item.x, y: item.y, ...TASK_SIZE };
        case "artifact":
          return { kind: "artifact", x: item.x, y: item.y, ...ARTIFACT_SIZE };
        case "thread":
          return { kind: "thread", x: item.x, y: item.y, ...BOX_SIZE };
      }
    }),
  ];
}

/**
 * The changes that lay a template out on a cloud board, or null when it needs the board's own
 * thread box, which a cloud board does not have. Its thread boxes are its maker's, run by the
 * agent they bring from their own machine.
 */
export function cloudBoardTemplateChanges(
  template: BoardTemplate,
  newId: () => string,
): ReadonlyArray<RoomBoardChange> | null {
  if (template.lines.some((line) => line.from === THREAD || line.to === THREAD)) return null;
  return boardTemplateChanges(template, newId).filter((change) => change.type !== "card.move");
}
