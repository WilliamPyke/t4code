/**
 * The public sample board's view link, as `infra/boards/scripts/sample-board.mjs` prints it. Empty
 * hides "Look around a sample board". Keep it the same as SAMPLE_BOARD_URL in
 * apps/marketing/src/lib/site.ts.
 */
const SAMPLE_BOARD_URL =
  "https://app.tinkjam.com/guest?host=boards.tinkjam.com#1ecbf7b4-8fc3-46f8-8a5c-8a683e311029.v.usrcvSaVH6bFGp3ACk5tGWNPWwFWYCZ5eXYLRB7usFE";

/**
 * Where the sample board opens in this app: the link's own page and its view credential, on this
 * origin, so the desktop app and a local server open it in place. Null when there is none.
 */
export function sampleBoardHref(url: string = SAMPLE_BOARD_URL): string | null {
  if (!URL.canParse(url)) return null;
  const { pathname, search, hash } = new URL(url);
  return hash === "" ? null : `${pathname}${search}${hash}`;
}
