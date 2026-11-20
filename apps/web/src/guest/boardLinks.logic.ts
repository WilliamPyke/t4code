import type { GuestShareView } from "@t3tools/contracts";

/**
 * A cloud board's links as the Share popover shows them: each one's credential, null while it is
 * off, and the edit link undefined where this person may not hand it on.
 */
export interface BoardLinks {
  readonly edit: string | null | undefined;
  readonly view: string | null;
}

/**
 * The links `view` says this person may hand on. A host that does not know the edit link (a board
 * from before it kept it) leaves the one this browser joined with, which still opens the board.
 */
export function boardLinksOf(
  view: Pick<GuestShareView, "links" | "viewOnly">,
  joinedWith: string | undefined,
): BoardLinks {
  const links = view.links;
  return {
    edit:
      view.viewOnly === true
        ? undefined
        : links?.edit !== undefined
          ? links.edit
          : (joinedWith ?? undefined),
    view: links?.view ?? null,
  };
}
