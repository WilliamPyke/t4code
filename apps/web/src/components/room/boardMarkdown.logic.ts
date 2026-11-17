import type { RoomBoard, RoomBoardNote } from "@t3tools/contracts";
import { roomTaskStatus } from "@t3tools/shared/roomBoard";

import { BOARD_PLAN_COLUMNS, BOARD_PLAN_PRIORITIES, boardPlanColumns } from "./boardPlan.logic";
import { boardLinkTitle, boardSnapshotLink } from "./boardSnapshot.logic";
import {
  BOARD_SECTION_SIZE,
  type BoardPeople,
  type BoardRect,
  boardNewNoteSize,
  boardPersonName,
} from "./roomBoard.logic";
import { boardReadingOrder } from "./boardCommands.logic";

const STATUS_NAMES = Object.fromEntries(
  BOARD_PLAN_COLUMNS.map(({ status, title }) => [status, title]),
);
const PRIORITY_NAMES = Object.fromEntries(
  BOARD_PLAN_PRIORITIES.map(({ priority, title }) => [priority, title]),
);

const rectOf = (note: RoomBoardNote): BoardRect => {
  const size =
    note.size ??
    (note.section === true ? BOARD_SECTION_SIZE : boardNewNoteSize(note.kind, note.url));
  return { x: note.x, y: note.y, width: size.w, height: size.h };
};

const holds = (outer: BoardRect, inner: BoardRect) => {
  const x = inner.x + inner.width / 2;
  const y = inner.y + inner.height / 2;
  return x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
};

/** Text as one list item: lines after the first indented under it, blank lines kept as breaks. */
const listItem = (marker: string, text: string) =>
  `${marker} ${text
    .trim()
    .split("\n")
    .map((line, index) => (index === 0 ? line : line.trim() === "" ? "" : `  ${line}`))
    .join("\n")}`;

const linkText = (text: string) => text.replace(/[[\]]/g, (bracket) => `\\${bracket}`);

// An export is read by others: everyone goes by their name, the one exporting too, never "You".
const byName = (people: BoardPeople): BoardPeople => ({ ...people, viewer: "" });

/** A task's checklist line: its box, its text, and what the Plan shows of it. */
function boardTaskMarkdown(task: RoomBoardNote, people: BoardPeople): string {
  const status = roomTaskStatus(task);
  const marks = [
    STATUS_NAMES[status],
    ...(task.priority === undefined ? [] : [PRIORITY_NAMES[task.priority]]),
    ...(task.due === undefined ? [] : [`due ${task.due}`]),
    ...(task.assignee === undefined
      ? []
      : [`for ${boardPersonName(people, task.assignee.guestId)}`]),
  ];
  const text = task.text.trim() || "Untitled task";
  return listItem(`- [${status === "done" ? "x" : " "}]`, `${text} (${marks.join(", ")})`);
}

/** One card as Markdown, or null for what has no words to export (a thread box, a code window). */
function cardMarkdown(board: RoomBoard, note: RoomBoardNote, people: BoardPeople): string | null {
  switch (note.kind) {
    case undefined:
      return note.text.trim() === "" ? null : listItem("-", note.text);
    case "task":
      return boardTaskMarkdown(note, people);
    case "link":
    case "pull-request":
      return note.url === undefined ? null : `- [${linkText(boardLinkTitle(note))}](${note.url})`;
    case "artifact": {
      const from = boardSnapshotLink(board, note.id);
      const title =
        from === undefined ? note.text.trim() || "Artifact" : `Snapshot of ${boardLinkTitle(from)}`;
      const body = note.artifact?.body.trim() ?? "";
      return `### ${title}\n\n${body === "" ? "_Empty_" : body}`;
    }
    default:
      return null;
  }
}

/** Cards in reading order as a block: list items run together, anything else stands apart. */
function cardsMarkdown(
  board: RoomBoard,
  notes: ReadonlyArray<RoomBoardNote>,
  people: BoardPeople,
): string {
  const parts = boardReadingOrder(notes.map((note) => ({ note, rect: rectOf(note) }))).flatMap(
    ({ note }) => {
      const part = cardMarkdown(board, note, people);
      return part === null ? [] : [part];
    },
  );
  return parts
    .map((part, index) => {
      const previous = parts[index - 1];
      if (previous === undefined) return part;
      return previous.startsWith("- ") && part.startsWith("- ") ? `\n${part}` : `\n\n${part}`;
    })
    .join("");
}

/**
 * The board as Markdown: its title, the cards on no section, then each section as a heading over
 * the cards on it, top to bottom. Notes are bullets, tasks a checklist with what the Plan shows,
 * links links, and artifacts and snapshots their text. Comments and agent boxes are left out.
 */
export function boardMarkdown(board: RoomBoard, title: string, viewing: BoardPeople): string {
  const people = byName(viewing);
  const sections = boardReadingOrder(
    board.notes
      .filter((note) => note.section === true)
      .map((note) => ({ note, rect: rectOf(note) })),
  );
  // A card on two sections, one inside the other, goes under the smaller.
  const sectionOf = (note: RoomBoardNote) =>
    sections
      .filter(({ rect }) => holds(rect, rectOf(note)))
      .toSorted(
        (left, right) => left.rect.width * left.rect.height - right.rect.width * right.rect.height,
      )[0]?.note.id;
  const cards = board.notes.filter((note) => note.section !== true && note.kind !== "comment");
  const loose = cards.filter((note) => sectionOf(note) === undefined);
  const blocks = [
    `# ${title.trim() || "Board"}`,
    cardsMarkdown(board, loose, people),
    ...sections.map(({ note: section }) => {
      const inside = cardsMarkdown(
        board,
        cards.filter((note) => sectionOf(note) === section.id),
        people,
      );
      return `## ${section.text.trim() || "Untitled section"}${inside === "" ? "" : `\n\n${inside}`}`;
    }),
  ];
  return `${blocks.filter((block) => block !== "").join("\n\n")}\n`;
}

/** The board's tasks as its Plan shows them: a heading for each column over its checklist. */
export function boardPlanMarkdown(board: RoomBoard, title: string, viewing: BoardPeople): string {
  const people = byName(viewing);
  const columns = boardPlanColumns(board.notes);
  const blocks = [
    `# ${title.trim() || "Board"}: Plan`,
    ...BOARD_PLAN_COLUMNS.map(({ status, title: heading }) => {
      const tasks = columns[status];
      return `## ${heading}\n\n${
        tasks.length === 0
          ? "_No tasks_"
          : tasks.map((task) => boardTaskMarkdown(task, people)).join("\n")
      }`;
    }),
  ];
  return `${blocks.join("\n\n")}\n`;
}

/** A file name for an export: the board's title in plain letters, and what it is. */
export function boardExportFileName(title: string, what: string, extension: string): string {
  const base =
    title
      .normalize("NFKD")
      .replace(/[^\w\s-]/g, "")
      .trim()
      .replace(/\s+/g, "-")
      .toLowerCase()
      .slice(0, 60) || "board";
  return `${base}${what === "" ? "" : `-${what}`}.${extension}`;
}
