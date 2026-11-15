import type { RoomBoardNote } from "@t3tools/contracts";

/**
 * What this device keeps of a visit to a board: the newest change the board showed, as its
 * server stamped it, so no device clock is compared. "" is a visit before any stamped change.
 */
export type BoardVisit = string;

/**
 * The newest change on the board, replies included as `boardCatchUp` counts them, or "" when
 * nothing on it is stamped yet.
 */
export const boardNewestChange = (notes: ReadonlyArray<RoomBoardNote>): BoardVisit =>
  notes.reduce((newest, note) => {
    const times = [note.changed?.at, ...(note.replies ?? []).map((reply) => reply.at)];
    return times.reduce<string>(
      (later, at) => (at !== undefined && at > later ? at : later),
      newest,
    );
  }, "");

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
): ReadonlyArray<RoomBoardNote> {
  if (since === undefined) return [];
  const counts = (at: string, by: string | undefined) =>
    at > since && (until === undefined || at <= until) && (by ?? null) !== viewer;
  return notes
    .flatMap((note) => {
      if (note.section === true) return [];
      const times = [
        ...(note.changed !== undefined && counts(note.changed.at, note.changed.guestId)
          ? [note.changed.at]
          : []),
        ...(note.replies ?? []).flatMap((reply) =>
          counts(reply.at, reply.guestId) ? [reply.at] : [],
        ),
      ];
      return times.length === 0 ? [] : [{ note, at: times.toSorted().at(-1) ?? "" }];
    })
    .toSorted((left, right) => (left.at < right.at ? -1 : 1))
    .map(({ note }) => note);
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
