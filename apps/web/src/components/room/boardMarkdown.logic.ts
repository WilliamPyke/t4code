import type { RoomBoard, RoomBoardNote } from "@t3tools/contracts";
import { roomArtifactSource, roomTaskStatus } from "@t3tools/shared/roomBoard";

import { BOARD_PLAN_COLUMNS, BOARD_PLAN_PRIORITIES, boardPlanColumns } from "./boardPlan.logic";
import { boardLinkTitle, boardSnapshotLink } from "./boardSnapshot.logic";
import {
  BOARD_SECTION_SIZE,
  type BoardPeople,
  type BoardRect,
  boardNewNoteSize,
  boardPersonName,
  isBoardHtmlArtifact,
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

/** A task's checklist line: its box, its text, and all the Plan shows of it, set or not. */
function boardTaskMarkdown(task: RoomBoardNote, people: BoardPeople): string {
  const status = roomTaskStatus(task);
  const marks = [
    STATUS_NAMES[status],
    task.priority === undefined ? "no priority" : `${PRIORITY_NAMES[task.priority]} priority`,
    task.due === undefined ? "no due date" : `due ${task.due}`,
    task.assignee === undefined
      ? "unassigned"
      : `for ${boardPersonName(people, task.assignee.guestId)}`,
  ];
  const text = task.text.trim() || "Untitled task";
  return listItem(`- [${status === "done" ? "x" : " "}]`, `${text} (${marks.join(", ")})`);
}

/**
 * A body's own headings moved below `level`, so what an artifact says stays under its heading
 * and never reads as the board's next section. Code blocks are left as they are.
 */
function headingsBelow(body: string, level: number): string {
  let fenced = false;
  const lines = body.split("\n").map((line) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    const heading = fenced ? null : /^(#{1,6})(\s.*)$/.exec(line);
    return { line, depth: heading?.[1]?.length, rest: heading?.[2] ?? "" };
  });
  const top = Math.min(...lines.flatMap(({ depth }) => depth ?? []));
  const shift = Number.isFinite(top) ? Math.max(0, level + 1 - top) : 0;
  return lines
    .map(({ line, depth, rest }) =>
      depth === undefined ? line : `${"#".repeat(Math.min(6, depth + shift))}${rest}`,
    )
    .join("\n");
}

/** How much of an HTML page's text an export keeps. */
const BOARD_HTML_TEXT_MAX = 2_000;

const ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: String.fromCodePoint(0x2014),
  ndash: "–",
  hellip: "…",
  rarr: "→",
  larr: "←",
  middot: "·",
  bull: "•",
  copy: "©",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
};

const decodeEntities = (text: string) =>
  text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, name: string) => {
    const code = name.startsWith("#x")
      ? Number.parseInt(name.slice(2), 16)
      : name.startsWith("#")
        ? Number.parseInt(name.slice(1), 10)
        : undefined;
    if (code === undefined) return ENTITIES[name.toLowerCase()] ?? whole;
    return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : "";
  });

/**
 * What a person reads on an HTML page, as Markdown: its title, headings, paragraphs, list items
 * and button labels, one to a line, without its markup, scripts or styles, cut at `max`.
 */
export function boardHtmlText(html: string, max = BOARD_HTML_TEXT_MAX): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const body = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(head|script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, "")
    // The page's own line breaks are spaces; only its blocks start lines.
    .replace(/\s+/g, " ")
    .replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<(br|hr)\b[^>]*>/gi, "\n")
    .replace(
      /<\/?(p|div|h[1-6]|ul|ol|li|button|section|article|header|footer|main|nav|aside|form|label|blockquote|pre|table|tr|td|th|figcaption|dt|dd)\b[^>]*>/gi,
      "\n",
    )
    .replace(/<[^>]*>/g, "");
  const lines = [title, ...body.split("\n")]
    .map((line) => decodeEntities(line).replace(/\s+/g, " ").trim())
    .filter((line) => line !== "" && line !== "-")
    // A line of the page never starts a heading or a quote of the export's own.
    .map((line) => line.replace(/^([#>])/, "\\$1"));
  const text = lines
    .map((line, index) =>
      index > 0 && line.startsWith("- ") && lines[index - 1]?.startsWith("- ")
        ? `\n${line}`
        : `\n\n${line}`,
    )
    .join("")
    .trim();
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…(cut)`;
}

/** An artifact under a heading of its own at `level`, or null for any other card. */
function artifactMarkdown(board: RoomBoard, note: RoomBoardNote, level: number): string | null {
  if (note.kind !== "artifact") return null;
  // A live view's artifact is exported where that artifact is, once.
  if (note.viewOf !== undefined && roomArtifactSource(board, note.id) !== undefined) return null;
  const from = boardSnapshotLink(board, note.id);
  const title =
    from === undefined ? note.text.trim() || "Artifact" : `Snapshot of ${boardLinkTitle(from)}`;
  const body = note.artifact?.body.trim() ?? "";
  const heading = `${"#".repeat(level)} ${title}`;
  if (isBoardHtmlArtifact(body)) {
    const text = boardHtmlText(body);
    return [heading, `HTML page: ${body.length} characters, exported as text`, text]
      .filter((block) => block !== "")
      .join("\n\n");
  }
  return `${heading}\n\n${body === "" ? "_Empty_" : headingsBelow(body, level)}`;
}

/** One card as a list item, or null for what has no words to export (a thread box, a code window). */
function cardMarkdown(note: RoomBoardNote, people: BoardPeople): string | null {
  switch (note.kind) {
    case undefined:
      return note.text.trim() === "" ? null : listItem("-", note.text);
    case "task":
      return boardTaskMarkdown(note, people);
    case "link":
    case "pull-request":
      return note.url === undefined ? null : `- [${linkText(boardLinkTitle(note))}](${note.url})`;
    default:
      return null;
  }
}

const inReadingOrder = (notes: ReadonlyArray<RoomBoardNote>) =>
  boardReadingOrder(notes.map((note) => ({ note, rect: rectOf(note) }))).map(({ note }) => note);

/** Cards in reading order as one list, or "" for none. */
const cardsMarkdown = (notes: ReadonlyArray<RoomBoardNote>, people: BoardPeople): string =>
  inReadingOrder(notes)
    .flatMap((note) => cardMarkdown(note, people) ?? [])
    .join("\n");

/**
 * The board as Markdown: each section's cards under its heading, then each loose artifact under
 * its own, then the other loose cards under "Loose notes" (one plain list on a board with neither).
 * Comments and agent boxes are left out.
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
  const artifacts = (notes: ReadonlyArray<RoomBoardNote>, level: number) =>
    inReadingOrder(notes).flatMap((note) => artifactMarkdown(board, note, level) ?? []);
  const loose = cards.filter((note) => sectionOf(note) === undefined);
  const looseArtifacts = artifacts(loose, 2);
  const looseList = cardsMarkdown(loose, people);
  const blocks = [
    `# ${title.trim() || "Board"}`,
    ...sections.map(({ note: section }) => {
      const on = cards.filter((note) => sectionOf(note) === section.id);
      return [
        `## ${section.text.trim() || "Untitled section"}`,
        cardsMarkdown(on, people),
        ...artifacts(on, 3),
      ]
        .filter((block) => block !== "")
        .join("\n\n");
    }),
    ...looseArtifacts,
    sections.length === 0 && looseArtifacts.length === 0
      ? looseList
      : looseList === ""
        ? ""
        : `## Loose notes\n\n${looseList}`,
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
