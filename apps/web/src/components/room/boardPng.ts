import type { RoomBoard, RoomBoardNote } from "@t3tools/contracts";
import { roomArtifactSource, roomTaskStatus } from "@t3tools/shared/roomBoard";

import { boardCardKindName, boardCardLabel } from "./boardCommands.logic";
import { boardLinkTitle } from "./boardSnapshot.logic";
import {
  BOARD_SECTION_SIZE,
  type BoardPoint,
  type BoardRect,
  boardBounds,
  boardNewNoteSize,
  boardEditKey,
} from "./roomBoard.logic";

// The paints of the light theme, fixed so an image looks the same whoever made it.
const PAINTS: Readonly<Record<string, string>> = {
  yellow: "#FFE9A8",
  green: "#D4F0D2",
  blue: "#D3E5FB",
  pink: "#FAD4E0",
  purple: "#E5D9F8",
  grey: "#E7E5E4",
};
const INK = "#1D1A22";
const MUTED = "#6B6570";
const CANVAS = "#FFF7EC";
const HAIRLINE = "#D9D2C8";
const CARD = "#FFFFFF";
const MARGIN = 48;
// The longest side an image gets, so a large board stays a file a browser can make.
const MAX_SIDE = 6_000;
const FONT = "Inter, ui-sans-serif, system-ui, sans-serif";

const rectOf = (note: RoomBoardNote, drawn: ReadonlyMap<string, BoardRect>): BoardRect => {
  const at = drawn.get(boardEditKey({ kind: "note", id: note.id }));
  if (at !== undefined) return at;
  const size =
    note.size ??
    (note.section === true ? BOARD_SECTION_SIZE : boardNewNoteSize(note.kind, note.url));
  return { x: note.x, y: note.y, width: size.w, height: size.h };
};

/** Lines of `text` that fit `width`, at most `max`, the last cut with an ellipsis. */
function wrap(context: CanvasRenderingContext2D, text: string, width: number, max: number) {
  const lines: Array<string> = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const next = line === "" ? word : `${line} ${word}`;
      if (context.measureText(next).width <= width || line === "") line = next;
      else {
        lines.push(line);
        line = word;
      }
    }
    lines.push(line);
    if (lines.length >= max) break;
  }
  if (lines.length > max) lines.length = max;
  const last = lines.at(-1);
  if (last !== undefined && lines.length === max) {
    let cut = last;
    while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
    lines[lines.length - 1] = cut === last ? last : `${cut}…`;
  }
  return lines;
}

function roundRect(context: CanvasRenderingContext2D, rect: BoardRect, radius: number) {
  context.beginPath();
  context.roundRect(rect.x, rect.y, rect.width, rect.height, radius);
}

/**
 * The board drawn as an image: sections as titled frames, notes and tasks as paper with their
 * text, every other card (links, embeds, artifacts, agent boxes) as a titled box, and the lines
 * between them. `drawn` holds where the page drew each card, by its ref, so sizes match.
 */
export async function boardPng(
  board: RoomBoard,
  drawn: ReadonlyMap<string, BoardRect>,
): Promise<Blob | null> {
  const notes = board.notes.filter((note) => note.kind !== "comment");
  const rects = new Map(notes.map((note) => [note.id, rectOf(note, drawn)]));
  const bounds = boardBounds([...rects.values()]);
  if (bounds === null) return null;
  const scale = Math.min(2, MAX_SIDE / (Math.max(bounds.width, bounds.height) + MARGIN * 2));
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil((bounds.width + MARGIN * 2) * scale);
  canvas.height = Math.ceil((bounds.height + MARGIN * 2) * scale);
  const context = canvas.getContext("2d");
  if (context === null) return null;
  context.scale(scale, scale);
  context.translate(MARGIN - bounds.x, MARGIN - bounds.y);
  context.fillStyle = CANVAS;
  context.fillRect(
    bounds.x - MARGIN,
    bounds.y - MARGIN,
    bounds.width + MARGIN * 2,
    bounds.height + MARGIN * 2,
  );
  context.textBaseline = "top";

  for (const note of notes.filter((one) => one.section === true)) {
    const rect = rects.get(note.id);
    if (rect === undefined) continue;
    roundRect(context, rect, 12);
    // Its background is a soft tint of its paint, as on the board; grey is a section with none.
    const paint =
      note.color === undefined || note.color === "grey" ? undefined : PAINTS[note.color];
    context.fillStyle = paint ?? "rgba(255,255,255,0.5)";
    context.globalAlpha = paint === undefined ? 1 : 0.55;
    context.fill();
    context.globalAlpha = 1;
    context.strokeStyle = HAIRLINE;
    context.lineWidth = 1.5;
    context.stroke();
    context.fillStyle = INK;
    context.font = `700 18px ${FONT}`;
    context.fillText(note.text.trim() || "Untitled section", rect.x + 4, rect.y - 27);
  }

  const centre = (ref: string) => {
    const id = ref.startsWith("note:") ? ref.slice("note:".length) : null;
    const rect = id === null ? undefined : rects.get(id);
    return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };
  const sections = new Set(
    notes.filter((one) => one.section === true).map((one) => `note:${one.id}`),
  );
  // A section's line meets its frame, not its middle under the cards.
  const end = (ref: string, at: BoardPoint, toward: BoardPoint): BoardPoint => {
    const rect = sections.has(ref) ? rects.get(ref.slice("note:".length)) : undefined;
    if (rect === undefined) return at;
    const dx = toward.x - at.x;
    const dy = toward.y - at.y;
    const t = Math.min(
      dx === 0 ? Infinity : rect.width / 2 / Math.abs(dx),
      dy === 0 ? Infinity : rect.height / 2 / Math.abs(dy),
    );
    return t >= 1 ? at : { x: at.x + dx * t, y: at.y + dy * t };
  };
  context.strokeStyle = MUTED;
  context.lineWidth = 2;
  for (const edge of board.edges ?? []) {
    const from = centre(edge.from);
    const to = centre(edge.to);
    if (from === null || to === null) continue;
    const start = end(edge.from, from, to);
    const finish = end(edge.to, to, from);
    context.beginPath();
    context.moveTo(start.x, start.y);
    context.lineTo(finish.x, finish.y);
    context.stroke();
  }

  for (const note of notes.filter((one) => one.section !== true)) {
    const rect = rects.get(note.id);
    if (rect === undefined) continue;
    const paper = note.kind === undefined || note.kind === "task";
    roundRect(context, rect, paper ? 4 : 12);
    context.fillStyle = paper
      ? (PAINTS[note.color ?? (note.kind === "task" ? "green" : "yellow")] ?? CARD)
      : CARD;
    context.fill();
    if (!paper) {
      context.strokeStyle = HAIRLINE;
      context.lineWidth = 1;
      context.stroke();
    }
    const inner = rect.width - 24;
    context.fillStyle = INK;
    let y = rect.y + 12;
    if (note.kind === "task") {
      const done = roomTaskStatus(note) === "done";
      context.strokeStyle = INK;
      context.lineWidth = 1.5;
      context.strokeRect(rect.x + 12, y + 1, 14, 14);
      if (done) {
        context.beginPath();
        context.moveTo(rect.x + 15, y + 8);
        context.lineTo(rect.x + 18, y + 12);
        context.lineTo(rect.x + 24, y + 4);
        context.stroke();
      }
    }
    if (!paper) {
      context.font = `600 13px ${FONT}`;
      context.fillStyle = MUTED;
      context.fillText(boardCardKindName(note), rect.x + 12, y);
      y += 20;
      context.fillStyle = INK;
    }
    const title =
      note.kind === "link" || note.kind === "pull-request"
        ? boardLinkTitle(note)
        : boardCardLabel(note);
    const body =
      note.kind === "artifact"
        ? `${title}\n${(roomArtifactSource(board, note.id) ?? note).artifact?.body ?? ""}`
        : note.kind === undefined || note.kind === "task"
          ? note.text
          : note.url === undefined
            ? title
            : `${title}\n${note.url}`;
    context.font = `${paper ? 400 : 500} 14px ${FONT}`;
    const indent = note.kind === "task" ? 22 : 0;
    const lineHeight = 19;
    const room = Math.max(1, Math.floor((rect.y + rect.height - 12 - y) / lineHeight));
    for (const line of wrap(context, body, inner - indent, room)) {
      context.fillText(line, rect.x + 12 + indent, y);
      y += lineHeight;
    }
  }

  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/** Hands the browser a file to save. */
export function saveBoardFile(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
