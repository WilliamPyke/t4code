import type { CloudBoardLinkSharing, CloudBoardRole } from "@t3tools/contracts";

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
 * The line above Share's list of people. The list is everyone who joined, so it counts them all,
 * and says how many are here now once someone else is: the list itself marks who is away.
 * `here` counts this person too.
 */
export function boardPeopleSummary(input: {
  readonly joined: number;
  readonly here: number;
  readonly viewing: number;
}): string {
  const people =
    input.joined <= 1
      ? "Just you so far"
      : input.here <= 1
        ? `${input.joined} people on this board`
        : `${input.joined} people · ${input.here} here now`;
  return input.viewing > 0 ? `${people} · ${viewingLabel(input.viewing)}` : people;
}

/**
 * The board's link sharing: as the host says, or, from an older host, as the links it hands out
 * say. Someone who can only look is handed no edit link, so they read it from the view link alone.
 */
export function boardLinkSharing(
  sharing: CloudBoardLinkSharing | undefined,
  links: BoardLinks,
): CloudBoardLinkSharing {
  if (sharing !== undefined) return sharing;
  if (typeof links.edit === "string") return "edit";
  return links.view === null ? "off" : "view";
}

/**
 * What removing someone leaves open, said in the dialog, or null when link sharing lets nobody in.
 * Removing never changes the links: closing them is the remover's own choice.
 */
export function removalNote(name: string, sharing: CloudBoardLinkSharing): string | null {
  if (sharing === "off") return null;
  return sharing === "edit"
    ? `Link sharing is on: anyone with the link can still join and edit, ${name} too if they kept it.`
    : `Link sharing is on: anyone with the view link can still look at the board, ${name} too if they kept it.`;
}

/** What moving someone to view-only leaves open, or null when the link cannot let them edit. */
export const demotionNote = (name: string, sharing: CloudBoardLinkSharing): string | null =>
  sharing === "edit"
    ? `Link sharing lets anyone with the link edit, so ${name} could join again with it to edit.`
    : null;

/** A quiet note beside someone whose own access is lower than the link's, so the list never lies. */
export const linkAccessNote = (role: CloudBoardRole, sharing: CloudBoardLinkSharing) =>
  role === "view" && sharing === "edit" ? "the link lets them edit" : null;
