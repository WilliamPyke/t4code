import {
  CommandId,
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoard,
  type RoomBoardAgentMark,
  type RoomBoardChange,
  type RoomBoardNote,
  type RoomBoardSize,
  type ThreadId,
  TrimmedNonEmptyString,
  roomBoardCardRef,
  roomBoardNoteRef,
} from "@t3tools/contracts";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import { EMPTY_ROOM_BOARD, applyRoomBoardChange } from "@t3tools/shared/roomBoard";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  roomBoxOn,
  roomPersonName,
  roomScope,
  threadRoomOf,
  type ThreadRoom,
} from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import { ROOM_THREAD_ORIGIN, roomBoardNoteSize, roomThreadCardSize } from "./RoomBoardSummary.ts";
import * as RoomBoxes from "./RoomBoxes.ts";

/** Changes one call makes at most. */
const ROOM_BOARD_AGENT_MAX_CHANGES = 20;

const CardText = TrimmedNonEmptyString.check(Schema.isMaxLength(ROOM_BOARD_NOTE_MAX_LENGTH));
/** A card as an agent names it: its id, or `thread` for the room thread's own card. */
const CardId = TrimmedNonEmptyString.check(Schema.isMaxLength(170));
/** A section's id or title. A title no section has makes a new one. */
const SectionName = CardText;

export const RoomBoardAgentAddInput = Schema.Struct({
  cards: Schema.Array(
    Schema.Struct({ text: CardText, task: Schema.optional(Schema.Boolean) }),
  ).check(Schema.isMaxLength(ROOM_BOARD_AGENT_MAX_CHANGES)),
  section: Schema.optional(SectionName),
});
export type RoomBoardAgentAddInput = typeof RoomBoardAgentAddInput.Type;

export const RoomBoardAgentUpdateInput = Schema.Struct({
  changes: Schema.Array(
    Schema.Struct({
      id: CardId,
      text: Schema.optional(CardText),
      done: Schema.optional(Schema.Boolean),
      section: Schema.optional(SectionName),
      lineTo: Schema.optional(CardId),
    }),
  ).check(Schema.isMinLength(1), Schema.isMaxLength(ROOM_BOARD_AGENT_MAX_CHANGES)),
});
export type RoomBoardAgentUpdateInput = typeof RoomBoardAgentUpdateInput.Type;

export const RoomBoardAgentView = Schema.Struct({
  /** The id of this thread's own box. */
  you: Schema.String,
  cards: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      kind: Schema.String,
      text: Schema.String,
      by: Schema.String,
      done: Schema.optional(Schema.Boolean),
      section: Schema.optional(Schema.String),
    }),
  ),
  lines: Schema.Array(Schema.Struct({ from: Schema.String, to: Schema.String })),
});
export type RoomBoardAgentView = typeof RoomBoardAgentView.Type;

const Refusal = Schema.Struct({ card: Schema.String, reason: Schema.String });
const NewSection = Schema.Struct({ id: Schema.String, title: Schema.String });

export const RoomBoardAgentResult = Schema.Struct({
  /** Cards added, or changed, by id. */
  done: Schema.Array(Schema.String),
  /** Sections this call made. */
  sections: Schema.optional(Schema.Array(NewSection)),
  /** What the board did not take, and why. */
  refused: Schema.Array(Refusal),
});
export type RoomBoardAgentResult = typeof RoomBoardAgentResult.Type;

export class RoomBoardAgentError extends Schema.TaggedError<RoomBoardAgentError>()(
  "RoomBoardAgentError",
  { reason: Schema.Literals(["not_on_board", "board_gone"]) },
) {
  override get message(): string {
    return this.reason === "not_on_board"
      ? "This thread is not on a board. Only a board's own thread or one of its thread boxes can use it."
      : "This thread's board is no longer there.";
  }
}

/** The board a thread's agent works on, kept up to date with what it changed in this call. */
interface Target {
  readonly roomThreadId: ThreadId;
  readonly roomTitle: string;
  readonly room: ThreadRoom;
  readonly boxId: string;
  readonly agent: RoomBoardAgentMark;
  board: RoomBoard;
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

const GAP = 24;
// Room for a section's title bar above the cards in it.
const SECTION_HEADER = 56;
const NOTE: RoomBoardSize = { w: 192, h: 144 };
const SECTION: RoomBoardSize = { w: 640, h: 420 };
const CARD: RoomBoardSize = { w: 320, h: 240 };
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
function obstacles(board: RoomBoard, withSections: boolean): Array<Rect> {
  const people = Object.entries(board.positions).flatMap(([cardId, at]) =>
    cardId === ROOM_BOARD_THREAD_CARD ? [] : [{ ...at, ...(board.sizes?.[cardId] ?? CARD) }],
  );
  return [
    roomCardRect(board),
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
const boxRect = (target: Target): Rect => {
  const box = roomBoxOn({ board: target.board }, target.boxId);
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
    .toSorted((left, right) => {
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

/**
 * The board a thread's agent works on: the one its own thread or thread box is on. It reads it, and
 * adds and changes cards there as the room's owner would, marked as its own, through the same rules
 * as any change. It never removes a card.
 */
export class RoomBoardAgent extends Context.Service<
  RoomBoardAgent,
  {
    readonly read: (threadId: ThreadId) => Effect.Effect<RoomBoardAgentView, RoomBoardAgentError>;
    readonly add: (
      threadId: ThreadId,
      input: RoomBoardAgentAddInput,
    ) => Effect.Effect<RoomBoardAgentResult, RoomBoardAgentError>;
    readonly update: (
      threadId: ThreadId,
      input: RoomBoardAgentUpdateInput,
    ) => Effect.Effect<RoomBoardAgentResult, RoomBoardAgentError>;
  }
>()("t3/guest/RoomBoardAgent") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const boxes = yield* RoomBoxes.RoomBoxes;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;

  const fail = (reason: RoomBoardAgentError["reason"]) => new RoomBoardAgentError({ reason });
  const uuid = random.uuidV4().pipe(Effect.orDie);

  const threadOf = (threadId: ThreadId, reason: RoomBoardAgentError["reason"]) =>
    orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.map(({ thread }) => thread),
      Effect.mapError(() => fail(reason)),
    );

  /** The run a thread's agent is in now, and that run's first message. */
  const runOf = Effect.fn("RoomBoardAgent.runOf")(function* (threadId: ThreadId) {
    const runId = (yield* orchestrator.getThreadShell(threadId))?.latestRunId ?? null;
    if (runId === null) return null;
    const { runs, turnItems } = yield* orchestrator.getThreadRecords(
      threadId,
      ["runs", "turnItems"],
      { runIds: [runId], turnItemRunIds: [runId] },
    );
    return { runId, run: runs.find((run) => run.id === runId), turnItems };
  });

  const targetOf = Effect.fn("RoomBoardAgent.targetOf")(function* (threadId: ThreadId) {
    const thread = yield* threadOf(threadId, "not_on_board");
    if (thread.deletedAt !== null || thread.archivedAt !== null) return yield* fail("board_gone");
    const providers = yield* providerRegistry.getProviders;
    const model = RoomBoxes.roomBoxModelName(thread.modelSelection, providers);
    const current = yield* runOf(threadId).pipe(Effect.orElseSucceed(() => null));
    // The guest whose message the owner sent into this run, as RoomBoxes finds it.
    const agent = (boxId: string, room: ThreadRoom): RoomBoardAgentMark => {
      const guestMessageId = current?.turnItems.find((item) => item.type === "user_message")
        ?.context?.guest?.guestMessageId;
      const asked = room.messages.find(
        (message) =>
          message.id === guestMessageId ||
          (current?.run !== undefined && message.sentAs === current.run.userMessageId),
      );
      return {
        boxId,
        ...(model === "" ? {} : { model }),
        ...(current === null ? {} : { turnId: current.runId }),
        ...(asked === undefined ? {} : { askedBy: asked.guestId }),
      };
    };
    if (thread.guestShare != null || thread.roomBoard != null) {
      const room = threadRoomOf(thread);
      return {
        roomThreadId: thread.id,
        roomTitle: thread.title,
        room,
        boxId: ROOM_BOARD_ROOM_BOX,
        agent: agent(ROOM_BOARD_ROOM_BOX, room),
        board: room.board ?? EMPTY_ROOM_BOARD,
      } satisfies Target;
    }
    // Also from the run's first message when the share is new here.
    const boxFrom = (items: Parameters<typeof boxes.boxOfThread>[1]) =>
      boxes.boxOfThread(threadId, items).pipe(Effect.mapError(() => fail("not_on_board")));
    const known = yield* boxFrom([]);
    const box = known ?? (current === null ? null : yield* boxFrom(current.turnItems));
    if (box === null) return yield* fail("not_on_board");
    const roomThread = yield* threadOf(box.roomThreadId, "board_gone");
    if (roomThread.deletedAt !== null || roomThread.archivedAt !== null) {
      return yield* fail("board_gone");
    }
    // The room as it is now, which the box was found on.
    const room = threadRoomOf(roomThread);
    if (room.id !== box.share.id) return yield* fail("board_gone");
    return {
      roomThreadId: roomThread.id,
      roomTitle: roomThread.title,
      room,
      boxId: box.boxId,
      agent: agent(box.boxId, room),
      board: room.board ?? EMPTY_ROOM_BOARD,
    } satisfies Target;
  });

  /**
   * One change, checked against the board as this call left it so a refusal says why, then made
   * as the owner's, marked as this agent's. Returns why the board did not take it, if it did not.
   */
  const apply = Effect.fn("RoomBoardAgent.apply")(function* (
    target: Target,
    change: RoomBoardChange,
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    const checked = applyRoomBoardChange(target.board, roomScope(target.room), null, change, at);
    if (Result.isFailure(checked)) return checked.failure;
    const commandId = CommandId.make(`server:room-board-agent:${yield* uuid}`);
    const refused = yield* orchestrator
      .dispatch({
        type: "thread.guest-board.change",
        commandId,
        threadId: target.roomThreadId,
        shareId: target.room.id,
        author: null,
        change,
        agent: target.agent,
      })
      .pipe(
        Effect.as(undefined),
        Effect.catch((error) =>
          Effect.succeed(
            "cause" in error && typeof error.cause === "string"
              ? error.cause
              : "The board did not take this change.",
          ),
        ),
      );
    if (refused === undefined) target.board = checked.success;
    return refused;
  });

  /** A free place for a new card next to the agent's box. */
  const spotNearBox = (target: Target, size: RoomBoardSize) => {
    const box = boxRect(target);
    return freeSpot(
      size,
      { x: box.x + box.w + GAP * 2, y: box.y },
      4,
      obstacles(target.board, true),
    );
  };

  /** A free place in a section, which grows to take it when it is full. */
  const spotInSection = Effect.fn("RoomBoardAgent.spotInSection")(function* (
    target: Target,
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
      obstacles(target.board, false),
    );
    const bottom = spot === undefined ? Infinity : spot.y + spot.h + GAP - area.y;
    if (spot === undefined || bottom > ROOM_BOARD_MAX_CARD_SIZE) {
      return Result.fail(`Section "${section.text}" is full. Put the rest in a new section.`);
    }
    if (bottom > area.h) {
      const refused = yield* apply(target, {
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
  const sectionFor = Effect.fn("RoomBoardAgent.sectionFor")(function* (
    target: Target,
    name: string,
    made: Array<{ readonly id: string; readonly title: string }>,
  ) {
    const found = findSection(target.board, name);
    if (found !== undefined) return Result.succeed(found.id);
    const title = cleanText(name);
    if (title === "") return Result.fail("A section needs a title.");
    const spot = spotNearBox(target, SECTION);
    if (spot === undefined) return Result.fail("There is no free space near this thread's box.");
    const id = yield* uuid;
    const refused = yield* apply(target, {
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

  const read = Effect.fn("RoomBoardAgent.read")(function* (threadId: ThreadId) {
    const target = yield* targetOf(threadId);
    const ownerName = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.guestOwnerName),
      Effect.orElseSucceed(() => ""),
    );
    const nameOf = roomPersonName(target.room, ownerName);
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
      roomBoardCardRef(ROOM_BOARD_THREAD_CARD),
      ...cards.map((note) => roomBoardNoteRef(note.id)),
    ]);
    const view: RoomBoardAgentView = {
      you: target.boxId,
      cards: [
        {
          id: ROOM_BOARD_ROOM_BOX,
          kind: "thread",
          text: target.roomTitle.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH),
          by: person(undefined),
        },
        ...cards.map((note) => {
          const section = sectionOf(board, note);
          return {
            id: note.id,
            kind: note.section === true ? "section" : (note.kind ?? "note"),
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
    return view;
  });

  const add = Effect.fn("RoomBoardAgent.add")(function* (
    threadId: ThreadId,
    input: RoomBoardAgentAddInput,
  ) {
    const target = yield* targetOf(threadId);
    const done: Array<string> = [];
    const refused: Array<{ readonly card: string; readonly reason: string }> = [];
    const made: Array<{ readonly id: string; readonly title: string }> = [];
    const section =
      input.section === undefined ? undefined : yield* sectionFor(target, input.section, made);
    if (section !== undefined && Result.isFailure(section)) {
      refused.push({ card: input.section ?? "", reason: section.failure });
    }
    for (const card of input.cards) {
      const text = cleanText(card.text);
      if (text === "") {
        refused.push({ card: card.text, reason: "A card needs some text." });
        continue;
      }
      // The cards go next to the box when their section could not be made.
      const spot =
        section === undefined || Result.isFailure(section)
          ? Result.fromNullishOr(
              spotNearBox(target, NOTE),
              () => "There is no free space near this thread's box.",
            )
          : yield* spotInSection(target, section.success, NOTE);
      if (Result.isFailure(spot)) {
        refused.push({ card: text, reason: spot.failure });
        continue;
      }
      const id = yield* uuid;
      const reason = yield* apply(target, {
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
    return { done, ...(made.length === 0 ? {} : { sections: made }), refused };
  });

  const update = Effect.fn("RoomBoardAgent.update")(function* (
    threadId: ThreadId,
    input: RoomBoardAgentUpdateInput,
  ) {
    const target = yield* targetOf(threadId);
    const done: Array<string> = [];
    const refused: Array<{ readonly card: string; readonly reason: string }> = [];
    const made: Array<{ readonly id: string; readonly title: string }> = [];
    for (const change of input.changes) {
      const refuse = (reason: string) => refused.push({ card: change.id, reason });
      const note = target.board.notes.find((candidate) => candidate.id === change.id);
      const room = change.id === ROOM_BOARD_ROOM_BOX;
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
          const section = yield* sectionFor(target, change.section, made);
          if (Result.isFailure(section)) {
            refuse(section.failure);
            continue;
          }
          if (sectionOf(target.board, note)?.id !== section.success) {
            const spot = yield* spotInSection(target, section.success, roomBoardNoteSize(note));
            if (Result.isFailure(spot)) {
              refuse(spot.failure);
              continue;
            }
            at = { x: spot.success.x, y: spot.success.y };
          }
        }
        const reason = yield* apply(target, {
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
        const reason = yield* apply(target, {
          type: "edge.put",
          edgeId: yield* uuid,
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
    return { done, ...(made.length === 0 ? {} : { sections: made }), refused };
  });

  return RoomBoardAgent.of({ read, add, update });
});

export const layer = Layer.effect(RoomBoardAgent, make);
