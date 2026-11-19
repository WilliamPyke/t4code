import type { BoardLinks } from "~/guest/boardLinks.logic";

export const viewingLabel = (viewing: number) => `${viewing} viewing`;

/** What Share offers one person, each only where the board host would take it from them. */
interface BoardShareControls {
  /** Copy the edit link, to bring a teammate onto the board. */
  readonly copyEditLink: boolean;
  readonly copyViewLink: boolean;
  /** Turn a link on or off, or make it anew, which ends the old one. */
  readonly changeLinks: boolean;
  readonly allowCopies: boolean;
  /** Say who can edit, and remove people. */
  readonly changePeople: boolean;
  readonly deleteBoard: boolean;
  readonly leaveBoard: boolean;
}

/**
 * The host lets anyone who can edit hand on the links it gave them, and leave. Only whoever
 * manages the board (its maker, or an owner of its workspace) changes links, copies and people,
 * and only its maker deletes it: the host answers anyone else `not_maker`.
 */
export function boardShareControls(input: {
  readonly manage: boolean;
  readonly isMaker: boolean;
  readonly links: BoardLinks;
}): BoardShareControls {
  return {
    copyEditLink: typeof input.links.edit === "string",
    copyViewLink: input.links.view !== null,
    changeLinks: input.manage,
    allowCopies: input.manage,
    changePeople: input.manage,
    deleteBoard: input.isMaker,
    leaveBoard: !input.isMaker,
  };
}

/**
 * The line above Share's list of people. The list is everyone who joined, so it counts them all
 * first, then says how many are here now; `here` counts this person too.
 */
export function boardPeopleSummary(input: {
  readonly joined: number;
  readonly here: number;
  readonly viewing: number;
}): string {
  const now = input.here <= 1 ? "only you here now" : `${input.here} here now`;
  const people = input.joined <= 1 ? "Just you so far" : `${input.joined} people · ${now}`;
  return input.viewing > 0 ? `${people} · ${viewingLabel(input.viewing)}` : people;
}
