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
      readonly kind: "task" | "artifact";
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
  /** Where the board's own thread box goes. */
  readonly thread: { readonly x: number; readonly y: number };
  readonly items: ReadonlyArray<BoardTemplateItem>;
  readonly lines: ReadonlyArray<{ readonly from: BoardTemplateEnd; readonly to: BoardTemplateEnd }>;
}

const THREAD = Symbol("thread");

// The board draws these sizes for cards that carry none; the thumbnail draws them the same.
const NOTE_SIZE = { w: 192, h: 144 };
const ARTIFACT_SIZE = { w: 380, h: 400 };
const THREAD_SIZE = { w: 320, h: 420 };

export const BLANK_BOARD_TEMPLATE: BoardTemplate = {
  id: "blank",
  name: "Blank",
  description: "An empty board with its thread box.",
  thread: { x: 80, y: 72 },
  items: [],
  lines: [],
};

export const BOARD_TEMPLATES: ReadonlyArray<BoardTemplate> = [
  BLANK_BOARD_TEMPLATE,
  {
    id: "plan-feature",
    name: "Plan a feature",
    description: "Goal, ideas, tasks and open questions. The goal goes with every prompt.",
    thread: { x: 80, y: 40 },
    items: [
      {
        key: "goal",
        kind: "section",
        text: "Goal",
        x: 440,
        y: 40,
        w: 480,
        h: 248,
        color: "yellow",
      },
      {
        key: "ideas",
        kind: "section",
        text: "Ideas",
        x: 960,
        y: 40,
        w: 480,
        h: 248,
        color: "blue",
      },
      {
        key: "tasks",
        kind: "section",
        text: "Tasks",
        x: 440,
        y: 328,
        w: 480,
        h: 248,
        color: "green",
      },
      {
        key: "questions",
        kind: "section",
        text: "Questions",
        x: 960,
        y: 328,
        w: 480,
        h: 248,
        color: "pink",
      },
      {
        key: "goal-what",
        kind: "note",
        text: "What should it do, and for whom?",
        x: 464,
        y: 96,
        color: "yellow",
      },
      {
        key: "goal-done",
        kind: "note",
        text: "How will we know it works?",
        x: 680,
        y: 96,
        color: "yellow",
      },
      { key: "idea", kind: "note", text: "An approach worth trying", x: 984, y: 96, color: "blue" },
      { key: "task-first", kind: "task", text: "First step", x: 464, y: 384 },
      { key: "task-next", kind: "task", text: "Next step", x: 680, y: 384 },
      {
        key: "question",
        kind: "note",
        text: "What do we still need to find out?",
        x: 984,
        y: 384,
        color: "pink",
      },
    ],
    lines: [
      { from: "goal-what", to: THREAD },
      { from: "goal-done", to: THREAD },
    ],
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
      { key: "bug-next", kind: "note", text: "Another bug", x: 680, y: 96, color: "pink" },
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
    description: "An artifact the agent writes, with likes, changes and questions beside it.",
    thread: { x: 80, y: 40 },
    items: [
      { key: "design", kind: "artifact", text: "Design", x: 440, y: 40 },
      {
        key: "likes",
        kind: "section",
        text: "Likes",
        x: 860,
        y: 40,
        w: 440,
        h: 216,
        color: "green",
      },
      {
        key: "changes",
        kind: "section",
        text: "Changes",
        x: 860,
        y: 280,
        w: 440,
        h: 216,
        color: "yellow",
      },
      {
        key: "questions",
        kind: "section",
        text: "Questions",
        x: 860,
        y: 520,
        w: 440,
        h: 216,
        color: "pink",
      },
      { key: "like", kind: "note", text: "What works well", x: 884, y: 96, color: "green" },
      { key: "change", kind: "note", text: "What should change", x: 884, y: 336, color: "yellow" },
      { key: "question", kind: "note", text: "What is unclear", x: 884, y: 576, color: "pink" },
    ],
    lines: [
      { from: THREAD, to: "design" },
      { from: "change", to: "design" },
    ],
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

/** A template drawn as a board's thumbnail draws it. */
export function boardTemplateShapes(template: BoardTemplate): ReadonlyArray<RoomBoardSummaryShape> {
  return [
    { kind: "thread", ...template.thread, ...THREAD_SIZE },
    ...template.items.map((item): RoomBoardSummaryShape => {
      switch (item.kind) {
        case "section":
          return { kind: "section", x: item.x, y: item.y, w: item.w, h: item.h, color: item.color };
        case "note":
          return { kind: "note", x: item.x, y: item.y, ...NOTE_SIZE, color: item.color };
        case "task":
          return { kind: "task", x: item.x, y: item.y, ...NOTE_SIZE };
        case "artifact":
          return { kind: "artifact", x: item.x, y: item.y, ...ARTIFACT_SIZE };
      }
    }),
  ];
}
