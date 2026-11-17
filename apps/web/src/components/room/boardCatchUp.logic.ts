import type { RoomBoardNote } from "@t3tools/contracts";

/**
 * What this device keeps of a visit to a board: the newest change the board showed, as its
 * server stamped it, so no device clock is compared. "" is a visit before any stamped change.
 */
export type BoardVisit = string;

/**
 * The newest change on the board, replies and artifacts' versions included, or "" when nothing on
 * it is stamped yet.
 */
export const boardNewestChange = (notes: ReadonlyArray<RoomBoardNote>): BoardVisit =>
  notes.reduce((newest, note) => {
    // An agent rewriting an artifact stamps only the artifact.
    const times = [
      note.changed?.at,
      note.artifact?.updatedAt,
      ...(note.replies ?? []).map((reply) => reply.at),
    ];
    return times.reduce<string>(
      (later, at) => (at !== undefined && at > later ? at : later),
      newest,
    );
  }, "");

/**
 * One step of the catch-up: a card or comment thread, whether someone else added or changed the
 * card itself, and how many replies others wrote in it since.
 */
export interface BoardCatchUpStep {
  readonly note: RoomBoardNote;
  readonly changed: boolean;
  readonly replies: number;
}

/**
 * The cards and comment threads someone else added, changed or replied in after this person's
 * last visit, oldest change first; a thread with several new replies is one step. None on a first
 * visit, and none changed after `until` (when this visit began). Sections are only frames.
 */
export function boardCatchUp(
  notes: ReadonlyArray<RoomBoardNote>,
  since: BoardVisit | undefined,
  viewer: string | null,
  until?: string,
): ReadonlyArray<BoardCatchUpStep> {
  if (since === undefined) return [];
  const counts = (at: string, by: string | undefined) =>
    at > since && (until === undefined || at <= until) && (by ?? null) !== viewer;
  return notes
    .flatMap((note) => {
      if (note.section === true) return [];
      const changed =
        note.changed !== undefined && counts(note.changed.at, note.changed.guestId)
          ? [note.changed.at]
          : [];
      const replies = (note.replies ?? []).flatMap((reply) =>
        counts(reply.at, reply.guestId) ? [reply.at] : [],
      );
      const times = [...changed, ...replies];
      if (times.length === 0) return [];
      const step = { note, changed: changed.length > 0, replies: replies.length };
      return [{ step, at: times.toSorted().at(-1) ?? "" }];
    })
    .toSorted((left, right) => (left.at < right.at ? -1 : 1))
    .map(({ step }) => step);
}

const replyCount = (count: number) => `${count} ${count === 1 ? "reply" : "replies"}`;
const newReplies = (count: number) => `${count} new ${count === 1 ? "reply" : "replies"}`;

const CARD_NOUNS: Readonly<Record<NonNullable<RoomBoardNote["kind"]>, string>> = {
  task: "task",
  link: "link",
  comment: "comment",
  thread: "thread box",
  artifact: "artifact",
  code: "code window",
  "pull-request": "pull request window",
};

/** What is new in one step: "New comment and 1 reply", "2 new replies", "New or changed task". */
export function boardCatchUpStepLabel({ note, changed, replies }: BoardCatchUpStep): string {
  if (!changed) return newReplies(replies);
  const card =
    note.kind === "comment"
      ? note.editedAt !== undefined && note.editedAt === note.changed?.at
        ? "Edited comment"
        : "New comment"
      : `New or changed ${note.kind === undefined ? "note" : CARD_NOUNS[note.kind]}`;
  return replies === 0 ? card : `${card} and ${replyCount(replies)}`;
}

/** The catch-up as one line: "2 changes, 1 new reply since you were here". */
export function boardCatchUpLine(steps: ReadonlyArray<BoardCatchUpStep>): string {
  const replies = steps.reduce((sum, step) => sum + step.replies, 0);
  const changes = `${steps.length} ${steps.length === 1 ? "change" : "changes"}`;
  return `${changes}${replies === 0 ? "" : `, ${newReplies(replies)}`} since you were here`;
}

/**
 * Where this device keeps a person's last visit to a board: the board and who is looking, so two
 * people on one browser, or one person on two boards, never share one.
 */
export const boardVisitKey = (board: string, viewer: string | null): string =>
  `${board}|${viewer ?? "owner"}`;

/** The visits this device keeps, with this board's moved to the end; the oldest go past `kept`. */
export function boardVisitsWith(
  visits: Readonly<Record<string, BoardVisit>>,
  key: string,
  visit: BoardVisit,
  kept: number,
): Record<string, BoardVisit> {
  const { [key]: _previous, ...others } = visits;
  return { ...Object.fromEntries(Object.entries(others).slice(-(kept - 1))), [key]: visit };
}
