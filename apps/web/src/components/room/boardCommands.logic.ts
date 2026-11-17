import type { RoomBoardNote } from "@t3tools/contracts";

import type { BoardRect } from "./roomBoard.logic";

/** How many board commands the command menu remembers as used lately. */
const BOARD_RECENT_COMMANDS = 6;

/** The commands used lately, newest first, with `id` moved to the front. */
export const boardRecentWith = (
  recent: ReadonlyArray<string>,
  id: string,
  kept = BOARD_RECENT_COMMANDS,
): ReadonlyArray<string> => [id, ...recent.filter((one) => one !== id)].slice(0, kept);

/** Commands in their own order, with the ones used lately first, newest first. */
export function boardCommandsByRecent<Command extends { readonly id: string }>(
  commands: ReadonlyArray<Command>,
  recent: ReadonlyArray<string>,
): ReadonlyArray<Command> {
  const rank = new Map(recent.map((id, index) => [id, index]));
  return commands
    .map((command, index) => ({ command, index, recent: rank.get(command.id) }))
    .toSorted(
      (left, right) =>
        (left.recent ?? Number.POSITIVE_INFINITY) - (right.recent ?? Number.POSITIVE_INFINITY) ||
        left.index - right.index,
    )
    .map(({ command }) => command);
}

const KIND_NAMES: Readonly<Record<NonNullable<RoomBoardNote["kind"]>, string>> = {
  task: "Task",
  link: "Link",
  artifact: "Artifact",
  thread: "Thread box",
  comment: "Comment",
  code: "Code window",
  "pull-request": "Pull request",
};

/** What kind of card a note is, as the command menu says it. */
export const boardCardKindName = (note: Pick<RoomBoardNote, "kind" | "section">): string =>
  note.section === true ? "Section" : note.kind === undefined ? "Note" : KIND_NAMES[note.kind];

const CARD_LABEL_LENGTH = 80;

/** A card as a list names it: its first line of text, else its address, else its kind. */
export function boardCardLabel(note: Pick<RoomBoardNote, "kind" | "section" | "text" | "url">) {
  const line =
    note.text
      .split("\n")
      .map((part) => part.trim())
      .find((part) => part !== "") ?? "";
  const label = line || note.url || `Untitled ${boardCardKindName(note).toLowerCase()}`;
  return label.length > CARD_LABEL_LENGTH ? `${label.slice(0, CARD_LABEL_LENGTH - 1)}…` : label;
}

// Cards whose tops are this close sit in one row, read left to right.
const ROW_SLOP = 40;

/** Items in reading order: rows top to bottom, each left to right. */
export function boardReadingOrder<Item extends { readonly rect: BoardRect }>(
  items: ReadonlyArray<Item>,
): ReadonlyArray<Item> {
  const byTop = items.toSorted((left, right) => left.rect.y - right.rect.y);
  const rows: Array<Array<Item>> = [];
  for (const item of byTop) {
    const row = rows.at(-1);
    const top = row?.[0]?.rect.y;
    if (row !== undefined && top !== undefined && item.rect.y - top <= ROW_SLOP) row.push(item);
    else rows.push([item]);
  }
  return rows.flatMap((row) => row.toSorted((left, right) => left.rect.x - right.rect.x));
}

/**
 * The card Tab goes to: after (or, going back, before) the last of the selection in reading
 * order, round the end; the first or last when nothing is selected. Null on an empty board.
 */
export function boardNextCard(
  ordered: ReadonlyArray<string>,
  selected: ReadonlySet<string>,
  direction: 1 | -1,
): string | null {
  if (ordered.length === 0) return null;
  const at = ordered.findLastIndex((ref) => selected.has(ref));
  if (at === -1) return (direction === 1 ? ordered[0] : ordered.at(-1)) ?? null;
  return ordered[(at + direction + ordered.length) % ordered.length] ?? null;
}

// "Ask my agent: …" typed in full, as the command menu's own entry reads.
const ASK_PREFIX = /^\s*ask\s+(?:my\s+)?agent\b\s*[:,-]?\s*/i;

/** What a question typed in the command menu asks, without an "Ask my agent:" typed before it. */
export const boardAskQuery = (query: string): string => query.replace(ASK_PREFIX, "").trim();
