import type { RoomBoardNote, RoomBoardReactionEmoji } from "@t3tools/contracts";

/** A vote is the 👍 reaction: one per person per card, which a second vote takes back. */
export const BOARD_VOTE: RoomBoardReactionEmoji = "👍";

/** Cards that take votes: anything a reaction goes on, but not a section or a comment pin. */
export const boardVotable = (note: RoomBoardNote) =>
  note.section !== true && note.kind !== "comment";

export const boardVoteCount = (note: RoomBoardNote) =>
  note.reactions?.filter((reaction) => reaction.emoji === BOARD_VOTE).length ?? 0;

export const boardVotedBy = (note: RoomBoardNote, viewer: string | null) =>
  note.reactions?.some(
    (reaction) => reaction.emoji === BOARD_VOTE && (reaction.guestId ?? null) === viewer,
  ) === true;

/**
 * The cards a vote on a selection toggles: those of it this person has not voted for yet, or,
 * when they voted for all of them already, all of them, which takes the votes back.
 */
export function boardVoteToggles(
  notes: ReadonlyArray<RoomBoardNote>,
  viewer: string | null,
): ReadonlyArray<RoomBoardNote> {
  const votable = notes.filter(boardVotable);
  const unvoted = votable.filter((note) => !boardVotedBy(note, viewer));
  return unvoted.length > 0 ? unvoted : votable;
}

/** Items most-voted first; ties keep the order they came in. */
export const boardByVotes = <T>(items: ReadonlyArray<T>, votesOf: (item: T) => number): Array<T> =>
  items
    .map((item, index) => ({ item, index, votes: votesOf(item) }))
    .toSorted((left, right) => right.votes - left.votes || left.index - right.index)
    .map(({ item }) => item);

/** Alt+V (Option+V on a Mac, by the key's place, since Option types a character there). */
export const isBoardVoteKey = (event: {
  readonly code: string;
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
}) => event.code === "KeyV" && event.altKey && !event.ctrlKey && !event.metaKey;
