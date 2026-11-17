/**
 * The public sample board's view link, as `infra/boards/scripts/sample-board.mjs` prints it. Empty
 * hides "Look around a sample board". Keep it the same as SAMPLE_BOARD_URL in
 * apps/marketing/src/lib/site.ts.
 */
const SAMPLE_BOARD_URL =
  "https://app.trellium.org/guest?host=boards.trellium.org#c183a660-86b0-43c7-8cdb-8d1b6bd5e531.v.ZTzphbdwzg6agWSGaZeAxnpmkejNwSIY7s98JrXPYoI";

/**
 * Where the sample board opens in this app: the link's own page and its view credential, on this
 * origin, so the desktop app and a local server open it in place. Null when there is none.
 */
export function sampleBoardHref(url: string = SAMPLE_BOARD_URL): string | null {
  if (!URL.canParse(url)) return null;
  const { pathname, search, hash } = new URL(url);
  return hash === "" ? null : `${pathname}${search}${hash}`;
}
