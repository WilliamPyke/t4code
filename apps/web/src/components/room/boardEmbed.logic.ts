import type { RoomBoardNote } from "@t3tools/contracts";

import { boardEmbedOf, boardNoteSize, type BoardRect } from "./roomBoard.logic";

/**
 * Where the browser of whoever adds a link card can read its video's real title: the source's
 * public oEmbed endpoint, which needs no key. Null for every other source. The server never
 * fetches it.
 */
export function boardEmbedTitleUrl(url: string): string | null {
  const address = encodeURIComponent(url);
  switch (boardEmbedOf(url)?.source) {
    case "youtube":
      return `https://www.youtube.com/oembed?format=json&url=${address}`;
    case "vimeo":
      return `https://vimeo.com/api/oembed.json?url=${address}`;
    case "loom":
      return `https://www.loom.com/v1/oembed?url=${address}`;
    default:
      return null;
  }
}

/** The title an oEmbed answer gives, trimmed, or null when it has none. */
export function boardEmbedTitleOf(answer: unknown): string | null {
  if (typeof answer !== "object" || answer === null || !("title" in answer)) return null;
  const title = typeof answer.title === "string" ? answer.title.trim() : "";
  return title === "" ? null : title.slice(0, 200);
}

/** Framed pages one board shows at once; every other embed waits for a click. */
export const BOARD_LIVE_EMBEDS_MAX = 4;
/** Below this zoom a framed page is too small to read, so none loads. */
const BOARD_EMBED_MIN_ZOOM = 0.4;

/** The page a link card frames, or undefined when its source refuses frames. */
const boardEmbedFrameOf = (note: Pick<RoomBoardNote, "kind" | "url">) =>
  note.kind === "link" && note.url !== undefined ? boardEmbedOf(note.url)?.embedUrl : undefined;

/**
 * The embeds whose pages load now: only those in view at a readable zoom, the ones someone
 * clicked (`opened`, newest last) first, then the nearest the middle of the view, up to
 * `BOARD_LIVE_EMBEDS_MAX`.
 */
export function boardLiveEmbeds(
  notes: ReadonlyArray<RoomBoardNote>,
  within: BoardRect | null,
  zoom: number,
  opened: ReadonlyArray<string>,
): ReadonlySet<string> {
  if (within === null || zoom < BOARD_EMBED_MIN_ZOOM) return new Set();
  const centre = { x: within.x + within.width / 2, y: within.y + within.height / 2 };
  const inView = notes.flatMap((note) => {
    if (boardEmbedFrameOf(note) === undefined) return [];
    const size = boardNoteSize(note);
    const w = size?.w ?? 0;
    const h = size?.h ?? 0;
    if (
      note.x + w <= within.x ||
      note.y + h <= within.y ||
      note.x >= within.x + within.width ||
      note.y >= within.y + within.height
    ) {
      return [];
    }
    const rank = opened.lastIndexOf(note.id);
    const distance = Math.hypot(note.x + w / 2 - centre.x, note.y + h / 2 - centre.y);
    return [{ id: note.id, rank, distance }];
  });
  inView.sort((left, right) => right.rank - left.rank || left.distance - right.distance);
  return new Set(inView.slice(0, BOARD_LIVE_EMBEDS_MAX).map(({ id }) => id));
}
