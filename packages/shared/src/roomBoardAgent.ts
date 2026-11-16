import {
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  roomBoardCardRef,
  roomBoardNoteRef,
  type GuestId,
  type RoomBoard,
  type RoomBoardAgentAddInput,
  type RoomBoardAgentResult,
  type RoomBoardAgentUpdateInput,
  type RoomBoardAgentView,
  type RoomBoardChange,
  type RoomBoardNote,
  type RoomBoardSize,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { sanitizeLinkedPrompt } from "./promptLinks.ts";
import { ROOM_BOARD_NOTE_SIZE, ROOM_BOARD_TASK_SIZE } from "./roomBoard.ts";

// The sizes the board draws a card at until someone resizes it.
export const ROOM_BOARD_CARD_SIZE: RoomBoardSize = { w: 320, h: 240 };
export const ROOM_THREAD_CARD_SIZE: RoomBoardSize = { w: 320, h: 420 };
const PIN: RoomBoardSize = { w: 32, h: 32 };
const SECTION: RoomBoardSize = { w: 640, h: 420 };
const NOTE_SIZES: Partial<Record<NonNullable<RoomBoardNote["kind"]>, RoomBoardSize>> = {
  artifact: { w: 380, h: 400 },
  thread: { w: 340, h: 460 },
  code: { w: 560, h: 420 },
  "pull-request": { w: 360, h: 300 },
  comment: PIN,
  task: ROOM_BOARD_TASK_SIZE,
};
// Where the board puts its own thread's card before anyone moves it.
export const ROOM_THREAD_ORIGIN = { x: 80, y: 72 };

/** A card's size as the board draws it, or about, until someone resizes it. */
export const roomBoardNoteSize = (
  note: Pick<RoomBoardNote, "kind" | "size" | "section">,
): RoomBoardSize =>
  note.size ??
  (note.section === true
    ? SECTION
    : note.kind === undefined
      ? ROOM_BOARD_NOTE_SIZE
      : (NOTE_SIZES[note.kind] ?? ROOM_BOARD_NOTE_SIZE));

/** The room thread's own card's size, as the board draws it until someone resizes it. */
export const roomThreadCardSize = (board: RoomBoard | undefined): RoomBoardSize =>
  board?.sizes?.[ROOM_BOARD_THREAD_CARD] ?? ROOM_THREAD_CARD_SIZE;

/**
 * The board a box's agent works on, kept up to date with what it changed in this call. A board
 * with no room thread (a cloud board) has no card for it.
 */
export interface RoomBoardAgentTarget {
  readonly roomTitle: string;
  readonly boxId: string;
  readonly hasRoomCard: boolean;
  board: RoomBoard;
}

/**
 * How the agent's changes are made: `apply` checks one against the board and makes it, moving
 * `target.board` on, or says why the board did not take it.
 */
export interface RoomBoardAgentOps<E, R> {
  readonly apply: (change: RoomBoardChange) => Effect.Effect<string | undefined, E, R>;
  readonly uuid: Effect.Effect<string, E, R>;
}

// Untraced: the server's RoomBoardAgent traces each call that runs these.

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const GAP = 24;
// Room for a section's title bar above the cards in it.
const SECTION_HEADER = 56;
const MAX_ROWS = 40;

const overlaps = (a: Rect, b: Rect) =>
  a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;

const noteRect = (note: RoomBoardNote): Rect => ({
  x: note.x,
  y: note.y,
  ...roomBoardNoteSize(note),
});

const isCard = (note: RoomBoardNote) => note.pinnedTo === undefined;
const sectionsOf = (board: RoomBoard) => board.notes.filter((note) => note.section === true);

/** Where the room thread's own card is, as the board draws it. */
const roomCardRect = (board: RoomBoard): Rect => ({
  ...(board.positions[ROOM_BOARD_THREAD_CARD] ?? ROOM_THREAD_ORIGIN),
  ...roomThreadCardSize(board),
});

/** Everything a new card must not cover: cards, people's cards, and sections unless `inside`. */
function obstacles(target: RoomBoardAgentTarget, withSections: boolean): Array<Rect> {
  const board = target.board;
  const people = Object.entries(board.positions).flatMap(([cardId, at]) =>
    cardId === ROOM_BOARD_THREAD_CARD
      ? []
      : [{ ...at, ...(board.sizes?.[cardId] ?? ROOM_BOARD_CARD_SIZE) }],
  );
  return [
    ...(target.hasRoomCard ? [roomCardRect(board)] : []),
    ...people,
    ...board.notes
      .filter((note) => isCard(note) && (withSections || note.section !== true))
      .map(noteRect),
  ];
}

/** The first free place in a grid from `origin`, row by row. */
function freeSpot(
  size: RoomBoardSize,
  origin: { readonly x: number; readonly y: number },
  columns: number,
  taken: ReadonlyArray<Rect>,
): Rect | undefined {
  for (let row = 0; row < MAX_ROWS; row++) {
    for (let column = 0; column < columns; column++) {
      const spot = {
        x: Math.round(origin.x + column * (size.w + GAP)),
        y: Math.round(origin.y + row * (size.h + GAP)),
        ...size,
      };
      if (!taken.some((rect) => overlaps(spot, rect))) return spot;
    }
  }
  return undefined;
}

/** The box this agent runs in, as the board draws it. */
const boxRect = (target: RoomBoardAgentTarget): Rect => {
  const box = target.board.notes.find((note) => note.id === target.boxId && note.kind === "thread");
  return box === undefined ? roomCardRect(target.board) : noteRect(box);
};

/** The smallest section a card sits in, by its centre. */
function sectionOf(board: RoomBoard, note: RoomBoardNote): RoomBoardNote | undefined {
  if (note.section === true) return undefined;
  const rect = noteRect(note);
  const cx = rect.x + rect.w / 2;
  const cy = rect.y + rect.h / 2;
  return sectionsOf(board)
    .filter((section) => {
      const area = noteRect(section);
      return cx >= area.x && cx <= area.x + area.w && cy >= area.y && cy <= area.y + area.h;
    })
    .sort((left, right) => {
      const a = noteRect(left);
      const b = noteRect(right);
      return a.w * a.h - b.w * b.h;
    })[0];
}

const findSection = (board: RoomBoard, name: string) => {
  const title = name.trim().toLowerCase();
  const sections = sectionsOf(board);
  return (
    sections.find((section) => section.id === name.trim()) ??
    sections.find((section) => section.text.trim().toLowerCase() === title)
  );
};

/** A card's ref on lines, from what an agent calls it. */
const refOf = (id: string) =>
  id === ROOM_BOARD_ROOM_BOX
    ? roomBoardCardRef(ROOM_BOARD_THREAD_CARD)
    : id.startsWith("note:") || id.startsWith("card:")
      ? id
      : roomBoardNoteRef(id);

/** What an agent calls a card on a line. */
const idOfRef = (ref: string) =>
  ref === roomBoardCardRef(ROOM_BOARD_THREAD_CARD)
    ? ROOM_BOARD_ROOM_BOX
    : ref.startsWith("note:")
      ? ref.slice("note:".length)
      : ref;

const cleanText = (text: string) =>
  sanitizeLinkedPrompt(text).text.trim().slice(0, ROOM_BOARD_NOTE_MAX_LENGTH);

/** A free place for a new card next to the agent's box. */
const spotNearBox = (target: RoomBoardAgentTarget, size: RoomBoardSize) => {
  const box = boxRect(target);
  return freeSpot(size, { x: box.x + box.w + GAP * 2, y: box.y }, 4, obstacles(target, true));
};

/** A free place in a section, which grows to take it when it is full. */
const spotInSection = Effect.fnUntraced(function* <E, R>(
  target: RoomBoardAgentTarget,
  ops: RoomBoardAgentOps<E, R>,
  sectionId: string,
  size: RoomBoardSize,
) {
  const section = target.board.notes.find((note) => note.id === sectionId);
  if (section === undefined) return Result.fail("This section is no longer on the board.");
  const area = noteRect(section);
  const columns = Math.max(1, Math.floor((area.w - GAP) / (size.w + GAP)));
  const spot = freeSpot(
    size,
    { x: area.x + GAP, y: area.y + SECTION_HEADER },
    columns,
    obstacles(target, false),
  );
  const bottom = spot === undefined ? Infinity : spot.y + spot.h + GAP - area.y;
  if (spot === undefined || bottom > ROOM_BOARD_MAX_CARD_SIZE) {
    return Result.fail(`Section "${section.text}" is full. Put the rest in a new section.`);
  }
  if (bottom > area.h) {
    const refused = yield* ops.apply({
      type: "note.put",
      noteId: section.id,
      text: section.text,
      x: section.x,
      y: section.y,
      size: { w: area.w, h: Math.ceil(bottom) },
    });
    if (refused !== undefined) return Result.fail(refused);
  }
  return Result.succeed(spot);
});

/** The section a name gives, made next to the agent's box when no section has it. */
const sectionFor = Effect.fnUntraced(function* <E, R>(
  target: RoomBoardAgentTarget,
  ops: RoomBoardAgentOps<E, R>,
  name: string,
  made: Array<{ readonly id: string; readonly title: string }>,
) {
  const found = findSection(target.board, name);
  if (found !== undefined) return Result.succeed(found.id);
  const title = cleanText(name);
  if (title === "") return Result.fail("A section needs a title.");
  const spot = spotNearBox(target, SECTION);
  if (spot === undefined) return Result.fail("There is no free space near this thread's box.");
  const id = yield* ops.uuid;
  const refused = yield* ops.apply({
    type: "note.put",
    noteId: id,
    text: title,
    x: spot.x,
    y: spot.y,
    section: true,
  });
  if (refused !== undefined) return Result.fail(refused);
  made.push({ id, title });
  return Result.succeed(id);
});

/**
 * The board as a box's agent reads it: every card with who added it ("you" for this box's own
 * agent), the section it sits in, and the lines between them.
 */
export function roomBoardAgentView(
  target: RoomBoardAgentTarget,
  nameOf: (guestId: GuestId | undefined) => string | undefined,
): RoomBoardAgentView {
  const person = (guestId: RoomBoardNote["guestId"]) =>
    nameOf(guestId) ?? (guestId === undefined ? "the owner" : "a guest");
  const by = (note: RoomBoardNote) =>
    note.agent === undefined
      ? person(note.guestId)
      : note.agent.boxId === target.boxId
        ? "you"
        : `${person(note.guestId)}'s agent`;
  const board = target.board;
  const cards = board.notes.filter(isCard);
  const shown = new Set([
    ...(target.hasRoomCard ? [roomBoardCardRef(ROOM_BOARD_THREAD_CARD)] : []),
    ...cards.map((note) => roomBoardNoteRef(note.id)),
  ]);
  return {
    you: target.boxId,
    cards: [
      ...(target.hasRoomCard
        ? [
            {
              id: ROOM_BOARD_ROOM_BOX,
              kind: "thread" as const,
              text: target.roomTitle.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH),
              by: person(undefined),
            },
          ]
        : []),
      ...cards.map((note) => {
        const section = sectionOf(board, note);
        return {
          id: note.id,
          kind: note.section === true ? ("section" as const) : (note.kind ?? "note"),
          text: note.text,
          by: by(note),
          ...(note.kind === "task" ? { done: note.done === true } : {}),
          ...(section === undefined ? {} : { section: section.id }),
        };
      }),
    ],
    lines: (board.edges ?? [])
      .filter((edge) => shown.has(edge.from) && shown.has(edge.to))
      .map((edge) => ({ from: idOfRef(edge.from), to: idOfRef(edge.to) })),
  };
}

/** Adds cards near the agent's box, or in a section it names, which is made when missing. */
export const roomBoardAgentAdd = Effect.fnUntraced(function* <E, R>(
  target: RoomBoardAgentTarget,
  ops: RoomBoardAgentOps<E, R>,
  input: RoomBoardAgentAddInput,
) {
  const done: Array<string> = [];
  const refused: Array<{ readonly card: string; readonly reason: string }> = [];
  const made: Array<{ readonly id: string; readonly title: string }> = [];
  const section =
    input.section === undefined ? undefined : yield* sectionFor(target, ops, input.section, made);
  if (section !== undefined && Result.isFailure(section)) {
    refused.push({ card: input.section ?? "", reason: section.failure });
  }
  for (const card of input.cards) {
    const text = cleanText(card.text);
    if (text === "") {
      refused.push({ card: card.text, reason: "A card needs some text." });
      continue;
    }
    const size = roomBoardNoteSize(card.task === true ? { kind: "task" } : {});
    // The cards go next to the box when their section could not be made.
    const spot =
      section === undefined || Result.isFailure(section)
        ? Result.fromNullishOr(
            spotNearBox(target, size),
            () => "There is no free space near this thread's box.",
          )
        : yield* spotInSection(target, ops, section.success, size);
    if (Result.isFailure(spot)) {
      refused.push({ card: text, reason: spot.failure });
      continue;
    }
    const id = yield* ops.uuid;
    const reason = yield* ops.apply({
      type: "note.put",
      noteId: id,
      text,
      x: spot.success.x,
      y: spot.success.y,
      ...(card.task === true ? { kind: "task" as const } : {}),
    });
    if (reason === undefined) done.push(id);
    else refused.push({ card: text, reason });
  }
  const result: RoomBoardAgentResult = {
    done,
    ...(made.length === 0 ? {} : { sections: made }),
    refused,
  };
  return result;
});

/** Edits, ticks, moves into a section, and draws lines from, cards the agent names by id. */
export const roomBoardAgentUpdate = Effect.fnUntraced(function* <E, R>(
  target: RoomBoardAgentTarget,
  ops: RoomBoardAgentOps<E, R>,
  input: RoomBoardAgentUpdateInput,
) {
  const done: Array<string> = [];
  const refused: Array<{ readonly card: string; readonly reason: string }> = [];
  const made: Array<{ readonly id: string; readonly title: string }> = [];
  for (const change of input.changes) {
    const refuse = (reason: string) => refused.push({ card: change.id, reason });
    const note = target.board.notes.find((candidate) => candidate.id === change.id);
    const room = target.hasRoomCard && change.id === ROOM_BOARD_ROOM_BOX;
    if ((note === undefined || !isCard(note)) && !room) {
      refuse("No card with this id is on the board. Read the board for the ids.");
      continue;
    }
    const edits =
      change.text !== undefined || change.done !== undefined || change.section !== undefined;
    if (edits) {
      if (note === undefined) {
        refuse("The room thread's card can only have lines drawn from it.");
        continue;
      }
      const editable = note.section !== true && (note.kind === undefined || note.kind === "task");
      if (change.text !== undefined && !editable) {
        refuse("Only a note's or a task's text can be changed.");
        continue;
      }
      if (change.done !== undefined && note.kind !== "task") {
        refuse("Only a task can be ticked.");
        continue;
      }
      if (change.section !== undefined && (note.section === true || note.kind === "comment")) {
        refuse("Only a card can go in a section.");
        continue;
      }
      const text = change.text === undefined ? note.text : cleanText(change.text);
      if (text === "") {
        refuse("A card needs some text.");
        continue;
      }
      let at = { x: note.x, y: note.y };
      if (change.section !== undefined) {
        const section = yield* sectionFor(target, ops, change.section, made);
        if (Result.isFailure(section)) {
          refuse(section.failure);
          continue;
        }
        if (sectionOf(target.board, note)?.id !== section.success) {
          const spot = yield* spotInSection(target, ops, section.success, roomBoardNoteSize(note));
          if (Result.isFailure(spot)) {
            refuse(spot.failure);
            continue;
          }
          at = { x: spot.success.x, y: spot.success.y };
        }
      }
      const reason = yield* ops.apply({
        type: "note.put",
        noteId: note.id,
        text,
        ...at,
        ...(change.done === undefined ? {} : { done: change.done }),
      });
      if (reason !== undefined) {
        refuse(reason);
        continue;
      }
    }
    if (change.lineTo !== undefined) {
      const reason = yield* ops.apply({
        type: "edge.put",
        edgeId: yield* ops.uuid,
        from: refOf(change.id),
        to: refOf(change.lineTo),
      });
      if (reason !== undefined) {
        refuse(reason);
        continue;
      }
    }
    done.push(change.id);
  }
  const result: RoomBoardAgentResult = {
    done,
    ...(made.length === 0 ? {} : { sections: made }),
    refused,
  };
  return result;
});
