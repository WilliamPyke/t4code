import { type RoomBoard, type RoomBoardNote, roomBoardNoteRef } from "@t3tools/contracts";
import { roomEmbedOf } from "@t3tools/shared/roomEmbed";
import { roomBoxRef } from "@t3tools/shared/roomBoard";

// A snapshot is an artifact with a line into it from a link card: the card it was read from. The
// line is all that marks it, so it works on every board host without a new field.

const noteOfRef = (board: RoomBoard, ref: string) =>
  board.notes.find((note) => roomBoardNoteRef(note.id) === ref);

/** The link card a snapshot artifact was read from: the first link card with a line into it. */
export function boardSnapshotLink(board: RoomBoard, artifactId: string): RoomBoardNote | undefined {
  const artifact = roomBoardNoteRef(artifactId);
  for (const edge of board.edges ?? []) {
    if (edge.to !== artifact) continue;
    const from = noteOfRef(board, edge.from);
    if (from?.kind === "link" && from.url !== undefined) return from;
  }
  return undefined;
}

/** A link card's snapshot: the first artifact its lines lead into. */
export function boardLinkSnapshot(board: RoomBoard, linkId: string): RoomBoardNote | undefined {
  const link = roomBoardNoteRef(linkId);
  for (const edge of board.edges ?? []) {
    if (edge.from !== link) continue;
    const to = noteOfRef(board, edge.to);
    if (to?.kind === "artifact") return to;
  }
  return undefined;
}

/** A link card's title: the one someone gave it, else the one read from its address. */
export const boardLinkTitle = (note: Pick<RoomBoardNote, "text" | "url">): string =>
  note.text.trim() ||
  (note.url === undefined ? "" : (roomEmbedOf(note.url)?.title ?? "")) ||
  "Link";

/**
 * The viewer's own thread box a link itself points to bringing it in: the one whose agent wrote
 * its snapshot last, else one the link card has a line into; null when neither is theirs. Only a
 * box of the viewer's own can be asked, so it runs on their agent and their connections.
 */
export function boardBringInBox(
  board: RoomBoard,
  boxes: ReadonlyArray<{ readonly id: string; readonly guestId?: string | undefined }>,
  viewer: string | null,
  linkId: string,
): string | null {
  const own = boxes.filter((box) => (box.guestId ?? null) === viewer).map((box) => box.id);
  const wrote = boardLinkSnapshot(board, linkId)?.artifact?.boxId;
  if (wrote !== undefined && own.includes(wrote)) return wrote;
  const link = roomBoardNoteRef(linkId);
  const linked = own.find((boxId) =>
    (board.edges ?? []).some((edge) => edge.from === link && edge.to === roomBoxRef(boxId)),
  );
  return linked ?? null;
}

/** Text cut to `max` for a prompt, saying so when it was cut, so the agent knows there is more. */
export function boardCutForPrompt(text: string, max: number): string {
  if (text.length <= max) return text;
  const marker = "\n\n[Cut here: the rest is on the board.]";
  const start = text
    .slice(0, Math.max(0, max - marker.length))
    .replace(/[\uD800-\uDBFF]$/, "")
    .trimEnd();
  return `${start}${marker}`;
}

const SNAPSHOT_CONTEXT_LENGTH = 4_000;

/**
 * A link card's text for a prompt, with its snapshot's content after the address, so a line from
 * the link gives a box what the document says, not only where it is. Left as it is when the link
 * has no snapshot yet, or the snapshot already goes with the prompt (`carried`).
 */
export function boardLinkTextWithSnapshot(
  board: RoomBoard,
  note: RoomBoardNote,
  text: string,
  carried: (ref: string) => boolean = () => false,
): string {
  if (note.kind !== "link") return text;
  const snapshot = boardLinkSnapshot(board, note.id);
  const body = snapshot?.artifact?.body.trim() ?? "";
  if (snapshot === undefined || body === "" || carried(roomBoardNoteRef(snapshot.id))) return text;
  const read = snapshot.artifact?.updatedAt.slice(0, 10);
  return `${text}\n\nSnapshot of it, read on ${read}:\n\n${boardCutForPrompt(body, SNAPSHOT_CONTEXT_LENGTH)}`;
}

/**
 * The link card as whether it changed reads it: a new snapshot of it counts as the card changing,
 * so a box it has a line into gets it again.
 */
export function boardLinkWithSnapshotChange(board: RoomBoard, note: RoomBoardNote): RoomBoardNote {
  if (note.kind !== "link") return note;
  const artifact = boardLinkSnapshot(board, note.id)?.artifact;
  return artifact === undefined ? note : { ...note, artifact };
}
