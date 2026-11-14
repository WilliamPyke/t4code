import type { RoomBoardNote } from "@t3tools/contracts";

/**
 * What this device keeps of a visit to a board: the newest change the board showed, as its
 * server stamped it, so no device clock is compared. "" is a visit before any stamped change.
 */
export type BoardVisit = string;

/** The newest change on the board, or "" when nothing on it is stamped yet. */
export const boardNewestChange = (notes: ReadonlyArray<RoomBoardNote>): BoardVisit =>
  notes.reduce((newest, note) => {
    const at = note.changed?.at;
    return at !== undefined && at > newest ? at : newest;
  }, "");

/**
 * The cards someone else added or changed after this person's last visit, oldest change first.
 * None on a first visit, and none changed after `until` (when this visit began). Comment threads keep their own unread marks, and sections are only
 * frames.
 */
export function boardCatchUp(
  notes: ReadonlyArray<RoomBoardNote>,
  since: BoardVisit | undefined,
  viewer: string | null,
  until?: string,
): ReadonlyArray<RoomBoardNote> {
  if (since === undefined) return [];
  return notes
    .filter(
      (note) =>
        note.changed !== undefined &&
        note.changed.at > since &&
        (until === undefined || note.changed.at <= until) &&
        (note.changed.guestId ?? null) !== viewer &&
        note.kind !== "comment" &&
        note.section !== true,
    )
    .toSorted((left, right) => ((left.changed?.at ?? "") < (right.changed?.at ?? "") ? -1 : 1));
}

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
