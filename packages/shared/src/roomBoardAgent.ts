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
  type RoomBoardAssignee,
  type RoomBoardChange,
  type RoomBoardNote,
  type RoomBoardSize,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import { sanitizeLinkedPrompt } from "./promptLinks.ts";
import {
  ROOM_BOARD_SECTION_SIZE,
  roomBoardNoteOfRef,
  roomBoardNoteSize,
  roomBoxIdOfRef,
  roomSectionCards,
  roomTaskStatus,
} from "./roomBoard.ts";

export { roomBoardNoteSize } from "./roomBoard.ts";

// The sizes the board draws a card at until someone resizes it.
export const ROOM_BOARD_CARD_SIZE: RoomBoardSize = { w: 320, h: 240 };
export const ROOM_THREAD_CARD_SIZE: RoomBoardSize = { w: 320, h: 420 };
// What one read of the board shows an agent at most, so a big board fits in its context.
export const ROOM_BOARD_AGENT_VIEW_MAX_CARDS = 100;
export const ROOM_BOARD_AGENT_VIEW_MAX_LINES = 150;
// Where the board puts its own thread's card before anyone moves it.
export const ROOM_THREAD_ORIGIN = { x: 80, y: 72 };

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
  /** Who a task can be for, by the name the board shows: null for the room's owner. */
  readonly people: ReadonlyArray<{ readonly guestId: GuestId | null; readonly name: string }>;
  /**
   * The person whose rights the agent has, whom "me" names: null for the room's owner, or the
   * guest whose own box it is.
   */
  readonly me: GuestId | null;
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

/** The first free place in a grid from `origin`, row by row, stepping a card of `step` at a time. */
function freeSpot(
  size: RoomBoardSize,
  origin: { readonly x: number; readonly y: number },
  columns: number,
  taken: ReadonlyArray<Rect>,
  step: RoomBoardSize = size,
): Rect | undefined {
  for (let row = 0; row < MAX_ROWS; row++) {
    for (let column = 0; column < columns; column++) {
      const spot = {
        x: Math.round(origin.x + column * (step.w + GAP)),
        y: Math.round(origin.y + row * (step.h + GAP)),
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

const GROUP_COLUMNS = 4;

/**
 * Free places for a call's cards as one tidy grid: next to the tasks already on the board that sit
 * in no section when it adds tasks, else next to the agent's box. Undefined when no room is left
 * for the whole grid there.
 */
function spotsForGroup(
  target: RoomBoardAgentTarget,
  sizes: ReadonlyArray<RoomBoardSize>,
  nearTasks: boolean,
): ReadonlyArray<Rect> | undefined {
  if (sizes.length === 0) return [];
  const cell = {
    w: Math.max(...sizes.map((size) => size.w)),
    h: Math.max(...sizes.map((size) => size.h)),
  };
  const columns = Math.min(GROUP_COLUMNS, sizes.length);
  const rows = Math.ceil(sizes.length / columns);
  const block = {
    w: columns * cell.w + (columns - 1) * GAP,
    h: rows * cell.h + (rows - 1) * GAP,
  };
  const tasks = nearTasks
    ? target.board.notes.filter(
        (note) =>
          note.kind === "task" && isCard(note) && sectionOf(target.board, note) === undefined,
      )
    : [];
  const box = boxRect(target);
  const origin =
    tasks.length === 0
      ? { x: box.x + box.w + GAP * 2, y: box.y }
      : {
          x: Math.min(...tasks.map((note) => note.x)),
          y: Math.min(...tasks.map((note) => note.y)),
        };
  const at = freeSpot(block, origin, GROUP_COLUMNS * 2, obstacles(target, true), cell);
  if (at === undefined) return undefined;
  return sizes.map((size, index) => ({
    x: at.x + (index % columns) * (cell.w + GAP),
    y: at.y + Math.floor(index / columns) * (cell.h + GAP),
    ...size,
  }));
}

/** Who a board tool names: "me" for the agent's own person, or someone by the name the board shows. */
function assigneeNamed(
  target: RoomBoardAgentTarget,
  name: string,
): Result.Result<RoomBoardAssignee, string> {
  const of = (guestId: GuestId | null): RoomBoardAssignee => (guestId === null ? {} : { guestId });
  const wanted = name.trim().toLowerCase();
  if (wanted === "me") return Result.succeed(of(target.me));
  const found = target.people.filter((person) => person.name.trim().toLowerCase() === wanted);
  if (found.length === 1 && found[0] !== undefined) return Result.succeed(of(found[0].guestId));
  return Result.fail(
    found.length === 0
      ? `Nobody called "${name}" is on this board. Its people: ${target.people.map((person) => person.name).join(", ")}. Leave the task unassigned, or ask your user who it is for.`
      : `More than one person on this board is called "${name}". Leave the task unassigned and say so.`,
  );
}

const personOfBox = (board: RoomBoard, boxId: string): GuestId | null =>
  boxId === ROOM_BOARD_ROOM_BOX
    ? null
    : (board.notes.find((note) => note.id === boxId)?.guestId ?? null);

/**
 * Every thread box a card at `ref` would go to with a prompt: the box itself, a box whose artifact
 * it is, and those its lines lead to, or the lines of a section it is in, as a prompt from a box
 * finds its cards.
 */
function boxesReachedFrom(board: RoomBoard, ref: string): ReadonlySet<string> {
  const edges = board.edges ?? [];
  const sections = sectionsOf(board);
  const boxes = new Set<string>();
  const seen = new Set([ref]);
  let frontier = [ref];
  while (frontier.length > 0) {
    const next: Array<string> = [];
    for (const at of frontier) {
      const box = roomBoxIdOfRef(board, at);
      if (box !== undefined) {
        boxes.add(box);
        continue;
      }
      const note = roomBoardNoteOfRef(board, at);
      for (const section of sections) {
        const holder = roomBoardNoteRef(section.id);
        if (note === undefined || seen.has(holder)) continue;
        if (!roomSectionCards(board, section).includes(note)) continue;
        seen.add(holder);
        next.push(holder);
      }
      const artifact = note?.kind === "artifact";
      for (const edge of edges) {
        const rewriter = artifact && edge.to === at ? roomBoxIdOfRef(board, edge.from) : undefined;
        if (rewriter !== undefined) boxes.add(rewriter);
        if (edge.from === at && !seen.has(edge.to)) {
          seen.add(edge.to);
          next.push(edge.to);
        }
      }
    }
    frontier = next;
  }
  return boxes;
}

/**
 * The name of someone else whose agent's box is among `boxIds`. An agent never writes into another
 * person's agent's context: only that person, pressing Send, puts anything there.
 */
function someoneElsesBox(
  target: RoomBoardAgentTarget,
  boxIds: Iterable<string | undefined>,
): string | undefined {
  for (const boxId of boxIds) {
    if (boxId === undefined || boxId === target.boxId) continue;
    const person = personOfBox(target.board, boxId);
    if (person === target.me) continue;
    return target.people.find((candidate) => candidate.guestId === person)?.name ?? "someone else";
  }
  return undefined;
}

/** A section the agent may put cards in: never one whose lines take them to another's agent. */
function sectionForCards(
  target: RoomBoardAgentTarget,
  sectionId: string,
): Result.Result<string, string> {
  const elsewhere = someoneElsesBox(
    target,
    boxesReachedFrom(target.board, roomBoardNoteRef(sectionId)),
  );
  return elsewhere === undefined
    ? Result.succeed(sectionId)
    : Result.fail(
        `Cards in this section go to ${elsewhere}'s agent with their next message. Only ${elsewhere} attaches cards to their agent: tell your user instead.`,
      );
}

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
  const spot = spotNearBox(target, ROOM_BOARD_SECTION_SIZE);
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
  const yours = refOf(target.boxId);
  // A section's line attaches every card in it.
  const attached = new Set(
    (board.edges ?? [])
      .flatMap((edge) => (edge.from === yours ? [edge.to] : edge.to === yours ? [edge.from] : []))
      .flatMap((ref) => {
        const section = roomBoardNoteOfRef(board, ref);
        return section?.section === true
          ? [ref, ...roomSectionCards(board, section).map((card) => roomBoardNoteRef(card.id))]
          : [ref];
      }),
  );
  // On a big board, what this box is most likely to work on stays: itself, what is attached to
  // it, sections and open tasks, then the rest, each in board order.
  const rank = (note: RoomBoardNote) => {
    const ref = roomBoardNoteRef(note.id);
    if (ref === yours || attached.has(ref)) return 0;
    if (note.section === true) return 1;
    if (note.kind === "task") return roomTaskStatus(note) === "done" ? 3 : 2;
    return 4;
  };
  const all = board.notes.filter(isCard);
  const kept = new Set(
    all
      .map((note, index) => ({ note, index }))
      .sort((left, right) => rank(left.note) - rank(right.note) || left.index - right.index)
      .slice(0, ROOM_BOARD_AGENT_VIEW_MAX_CARDS - (target.hasRoomCard ? 1 : 0))
      .map(({ note }) => note),
  );
  const cards = all.filter((note) => kept.has(note));
  const shown = new Set([
    ...(target.hasRoomCard ? [roomBoardCardRef(ROOM_BOARD_THREAD_CARD)] : []),
    ...cards.map((note) => roomBoardNoteRef(note.id)),
  ]);
  const lines = (board.edges ?? []).filter((edge) => shown.has(edge.from) && shown.has(edge.to));
  const assigneeName = (note: RoomBoardNote) =>
    note.assignee === undefined ? {} : { assignee: person(note.assignee.guestId) };
  const room = roomCardRect(board);
  const omitted = {
    cards: all.length - cards.length,
    lines: Math.max(0, lines.length - ROOM_BOARD_AGENT_VIEW_MAX_LINES),
  };
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
              x: Math.round(room.x),
              y: Math.round(room.y),
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
          ...(note.kind === "task"
            ? {
                done: note.done === true,
                status: roomTaskStatus(note),
                ...(note.priority === undefined ? {} : { priority: note.priority }),
                ...(note.due === undefined ? {} : { due: note.due }),
                ...assigneeName(note),
              }
            : {}),
          ...(section === undefined ? {} : { section: section.id }),
          x: Math.round(note.x),
          y: Math.round(note.y),
        };
      }),
    ],
    lines: lines
      .slice(0, ROOM_BOARD_AGENT_VIEW_MAX_LINES)
      .map((edge) => ({ from: idOfRef(edge.from), to: idOfRef(edge.to) })),
    attachedToYou: [...attached].filter((ref) => shown.has(ref)).map(idOfRef),
    people: target.people.map((candidate) => ({
      name: candidate.name,
      ...(candidate.guestId === target.me ? { me: true } : {}),
    })),
    ...(omitted.cards === 0 && omitted.lines === 0 ? {} : { omitted }),
  };
}

/**
 * Adds cards as one group next to the agent's box or the board's tasks, or in a section it names,
 * which is made when missing. Assigning a task only names who it is for: it starts nothing.
 */
export const roomBoardAgentAdd = Effect.fnUntraced(function* <E, R>(
  target: RoomBoardAgentTarget,
  ops: RoomBoardAgentOps<E, R>,
  input: RoomBoardAgentAddInput,
) {
  const done: Array<string> = [];
  const refused: Array<{ readonly card: string; readonly reason: string }> = [];
  const made: Array<{ readonly id: string; readonly title: string }> = [];
  const found =
    input.section === undefined ? undefined : yield* sectionFor(target, ops, input.section, made);
  const section =
    found === undefined || Result.isFailure(found) ? found : sectionForCards(target, found.success);
  if (section !== undefined && Result.isFailure(section)) {
    refused.push({ card: input.section ?? "", reason: section.failure });
  }
  // Checked before any is placed, so the ones the board takes sit together.
  const valid = input.cards.flatMap((card) => {
    const text = cleanText(card.text);
    if (text === "") {
      refused.push({ card: card.text, reason: "A card needs some text." });
      return [];
    }
    const assignee = card.assignee === undefined ? undefined : assigneeNamed(target, card.assignee);
    if (assignee !== undefined && Result.isFailure(assignee)) {
      refused.push({ card: text, reason: assignee.failure });
      return [];
    }
    const task =
      card.task === true ||
      card.status !== undefined ||
      card.priority !== undefined ||
      card.due !== undefined ||
      card.assignee !== undefined;
    const size = roomBoardNoteSize(task ? { kind: "task" } : {});
    return [{ card, text, task, size, assignee: assignee?.success }];
  });
  // The cards go next to the box, or the tasks there, when they have no section.
  const group =
    section === undefined || Result.isFailure(section)
      ? spotsForGroup(
          target,
          valid.map((card) => card.size),
          valid.some((card) => card.task),
        )
      : undefined;
  for (const [index, { card, text, task, size, assignee }] of valid.entries()) {
    const grouped = group?.[index];
    const spot =
      section !== undefined && Result.isSuccess(section)
        ? yield* spotInSection(target, ops, section.success, size)
        : Result.fromNullishOr(
            grouped ?? spotNearBox(target, size),
            () => "There is no free space near this thread's box.",
          );
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
      ...(task ? { kind: "task" as const } : {}),
      ...(card.status === undefined ? {} : { status: card.status }),
      ...(card.priority === undefined ? {} : { priority: card.priority }),
      ...(card.due === undefined ? {} : { due: card.due }),
      ...(assignee === undefined ? {} : { assignee }),
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

/**
 * Edits, plans, moves into a section, and draws lines from, cards the agent names by id. It never
 * changes what goes to another person's agent: no line toward their box, no edit of a card on one.
 */
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
    const plans =
      change.status !== undefined ||
      change.priority !== undefined ||
      change.due !== undefined ||
      change.assignee !== undefined;
    const edits =
      change.text !== undefined ||
      change.done !== undefined ||
      change.section !== undefined ||
      plans;
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
      if (plans && note.kind !== "task") {
        refuse("Only a task has a status, priority, due date or assignee.");
        continue;
      }
      const assignee =
        change.assignee === undefined || change.assignee === null
          ? Result.succeed(change.assignee)
          : assigneeNamed(target, change.assignee);
      if (Result.isFailure(assignee)) {
        refuse(assignee.failure);
        continue;
      }
      const elsewhere =
        change.text !== undefined && cleanText(change.text) !== note.text
          ? someoneElsesBox(target, boxesReachedFrom(target.board, roomBoardNoteRef(note.id)))
          : undefined;
      if (elsewhere !== undefined) {
        refuse(
          `This card goes to ${elsewhere}'s agent with their next message, so only a person changes what it says. Tell your user instead.`,
        );
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
          const open = sectionForCards(target, section.success);
          if (Result.isFailure(open)) {
            refuse(open.failure);
            continue;
          }
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
        ...(change.status === undefined ? {} : { status: change.status }),
        ...(change.priority === undefined ? {} : { priority: change.priority }),
        ...(change.due === undefined ? {} : { due: change.due }),
        ...(assignee.success === undefined ? {} : { assignee: assignee.success }),
      });
      if (reason !== undefined) {
        refuse(reason);
        continue;
      }
    }
    if (change.lineTo !== undefined) {
      const from = refOf(change.id);
      const to = refOf(change.lineTo);
      const elsewhere = someoneElsesBox(target, [
        roomBoxIdOfRef(target.board, from),
        roomBoxIdOfRef(target.board, to),
        ...boxesReachedFrom(target.board, to),
      ]);
      if (elsewhere !== undefined) {
        refuse(
          `This line would send the card to ${elsewhere}'s agent. Only ${elsewhere} attaches cards to their agent: tell your user instead.`,
        );
        continue;
      }
      const reason = yield* ops.apply({
        type: "edge.put",
        edgeId: yield* ops.uuid,
        from,
        to,
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
