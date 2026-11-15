import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  CommandId,
  GuestId,
  GuestShareId,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  ROOM_BOARD_MAX_NOTES,
  type RoomBoardAgentChangeRequest,
  type RoomBoardAgentMark,
  type RoomBoardChange,
  type RoomBoardNote,
  SharedThreadJoinError,
  ThreadId,
} from "@t3tools/contracts";
import { ROOM_BOARD_FULL } from "@t3tools/shared/roomBoard";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";

import {
  decideGuestShareCommand,
  type GuestShareCommand,
  threadRoomOf,
} from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RoomBoardAgent from "./RoomBoardAgent.ts";
import { roomBoardNoteSize } from "./RoomBoardSummary.ts";
import * as RoomBoxes from "./RoomBoxes.ts";
import * as SharedRoomLink from "./SharedRoomLink.ts";

const shareId = GuestShareId.make("share:1");
const roomThreadId = ThreadId.make("thread:room");
const boxThreadId = ThreadId.make("thread:box");
const loneThreadId = ThreadId.make("thread:lone");
// A thread on this machine behind the user's own box on a room someone else's server shares.
const mineThreadId = ThreadId.make("thread:mine");
const sam = GuestId.make("guest:sam");
const ana = GuestId.make("guest:ana");
// Sam asked for the run the box's agent is in, which the owner sent as `message:run`.
const agentMark = { boxId: "box:b", model: "GPT-5.1 Codex", turnId: "run:1", askedBy: sam };

const thread = (id: ThreadId, fields: object = {}) =>
  ({
    id,
    title: id === roomThreadId ? "Launch plan" : id,
    guestShare: null,
    roomBoard: null,
    deletedAt: null,
    archivedAt: null,
    modelSelection: { instanceId: "codex", model: "gpt-5.1-codex" },
    ...fields,
  }) as unknown as OrchestrationV2AppThread;

const samsNote: RoomBoardNote = {
  id: "note:sam",
  text: "Pricing page",
  x: 900,
  y: 0,
  guestId: sam,
};

/** A shared room whose board has Sam's note and the owner's box, and threads not on it. */
const makeThreads = (notes: ReadonlyArray<RoomBoardNote> = []) => ({
  [roomThreadId]: thread(roomThreadId, {
    guestShare: {
      id: shareId,
      board: {
        positions: {},
        notes: [
          { id: "box:b", text: "Research", x: 80, y: 600, kind: "thread" },
          samsNote,
          // Sam's own box, whose agent runs on Sam's machine.
          { id: "box:sam", text: "Sam's box", x: 80, y: 1_400, kind: "thread", guestId: sam },
          ...notes,
        ],
      },
      guests: [
        { id: sam, name: "Sam" },
        { id: ana, name: "Ana" },
      ],
      messages: [{ id: "guest-message:1", guestId: sam, sentAs: "message:run" }],
      boardThreads: { "box:b": boxThreadId },
    },
  }),
  [boxThreadId]: thread(boxThreadId),
  [loneThreadId]: thread(loneThreadId),
  [mineThreadId]: thread(mineThreadId, {
    roomLink: {
      host: "owner.t3.test",
      expiresAt: "2999-01-01T00:00:00.000Z",
      shareId: "share:theirs",
      boxId: "box:mine",
    },
  }),
});

/** What this machine asked the room's owner for its own box, and what the owner answers. */
const elsewhere = () => {
  const asked: Array<string | Omit<RoomBoardAgentChangeRequest, "boxId">> = [];
  let failure: SharedThreadJoinError["reason"] | null = null;
  const answer = <A>(value: A) =>
    failure === null
      ? Effect.succeed(value)
      : Effect.fail(new SharedThreadJoinError({ reason: failure }));
  const layer = Layer.mock(SharedRoomLink.SharedRoomLink)({
    readBoard: (threadId) => {
      asked.push(threadId);
      return answer({ you: "box:mine", cards: [], lines: [] });
    },
    changeBoard: (_threadId, request) => {
      asked.push(request);
      return answer({ done: ["note:new"], refused: [] });
    },
  });
  return {
    asked,
    layer,
    fail: (reason: SharedThreadJoinError["reason"]) => {
      failure = reason;
    },
  };
};

const layerWith = (threads: Record<string, OrchestrationV2AppThread>, links = elsewhere().layer) =>
  RoomBoardAgent.layer.pipe(
    Layer.provide(links),
    Layer.provide(
      Layer.mock(Orchestrator.OrchestratorV2)({
        getThreadShell: () => Effect.succeed({ latestRunId: "run:1" } as never),
        getThreadRecords: (threadId) =>
          threads[threadId] === undefined
            ? Effect.fail({ _tag: "OrchestratorProjectionError" } as never)
            : Effect.succeed({
                thread: threads[threadId],
                turnItems: [],
                runs: [{ id: "run:1", userMessageId: "message:run" }],
              } as never),
        // The decider's own rules, so what the board takes here is what it takes for real.
        dispatch: (dispatched: OrchestrationV2ServerCommand) =>
          Effect.gen(function* () {
            const command = dispatched as GuestShareCommand;
            const decided = decideGuestShareCommand({
              thread: threads[command.threadId]!,
              command,
              now: yield* DateTime.now,
            });
            if (Result.isFailure(decided)) {
              return yield* Effect.fail({ _tag: "Rejected", cause: decided.failure } as never);
            }
            threads[command.threadId] = decided.success;
            return {} as never;
          }),
      }),
    ),
    Layer.provide(
      Layer.mock(RoomBoxes.RoomBoxes)({
        boxOfThread: (threadId) =>
          Effect.succeed(
            threadId === boxThreadId
              ? {
                  roomThreadId,
                  share: threadRoomOf(threads[roomThreadId]!),
                  boxId: "box:b",
                }
              : null,
          ),
      }),
    ),
    Layer.provide(
      Layer.mock(ProviderRegistry.ProviderRegistry)({
        getProviders: Effect.succeed([
          {
            instanceId: "codex",
            driver: "codex",
            models: [{ slug: "gpt-5.1-codex", name: "GPT-5.1 Codex" }],
          } as never,
        ]),
      }),
    ),
    Layer.provide(ServerSettings.layerTest({})),
    Layer.provide(NodeCrypto.layer),
  );

const boardOf = (threads: Record<string, OrchestrationV2AppThread>) =>
  threads[roomThreadId]?.guestShare?.board?.notes ?? [];

const rect = (note: RoomBoardNote) => ({ ...note, ...roomBoardNoteSize(note) });
const overlap = (a: RoomBoardNote, b: RoomBoardNote) => {
  const [l, r] = [rect(a), rect(b)];
  return l.x < r.x + r.w && r.x < l.x + l.w && l.y < r.y + r.h && r.y < l.y + l.h;
};

it.effect("lets a box's agent read its board and add cards beside its box, as its own", () => {
  const threads = makeThreads();
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    const before = yield* agent.read(boxThreadId);
    assert.strictEqual(before.you, "box:b");
    assert.deepEqual(
      before.cards.map((card) => [card.id, card.kind, card.by]),
      [
        ["thread", "thread", "the owner"],
        ["box:b", "thread", "the owner"],
        ["note:sam", "note", "Sam"],
        ["box:sam", "thread", "Sam"],
      ],
    );

    const added = yield* agent.add(boxThreadId, {
      cards: [{ text: "Draft the FAQ" }, { text: "Email the beta list", task: true }],
    });
    assert.lengthOf(added.done, 2);
    assert.deepEqual(added.refused, []);
    const notes = boardOf(threads);
    const mine = notes.filter((note) => added.done.includes(note.id));
    assert.deepEqual(
      mine.map((note) => [note.text, note.kind, note.agent, note.guestId]),
      [
        ["Draft the FAQ", undefined, agentMark, undefined],
        ["Email the beta list", "task", agentMark, undefined],
      ],
    );
    // Next to its box, clear of every card already there and of each other.
    for (const note of mine) {
      for (const other of notes) {
        if (other !== note) assert.isFalse(overlap(note, other), `${note.text} on ${other.id}`);
      }
    }
    const after = yield* agent.read(boxThreadId);
    assert.deepEqual(
      after.cards.filter((card) => card.by === "you").map((card) => card.done),
      [undefined, false],
    );
    // The room thread's own agent works on the same board, as the room thread's card.
    assert.strictEqual((yield* agent.read(roomThreadId)).you, "thread");
  }).pipe(Effect.provide(layerWith(threads)));
});

it.effect("groups cards into a section it makes, ticks tasks and draws lines", () => {
  const threads = makeThreads([{ id: "task:1", text: "Ship it", x: 900, y: 400, kind: "task" }]);
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    const result = yield* agent.update(boxThreadId, {
      changes: [
        { id: "note:sam", section: "Ideas" },
        { id: "task:1", done: true, section: "ideas", lineTo: "box:b" },
      ],
    });
    assert.deepEqual(result.refused, []);
    assert.deepEqual(result.done, ["note:sam", "task:1"]);
    const section = result.sections?.[0];
    assert.strictEqual(section?.title, "Ideas");
    const view = yield* agent.read(boxThreadId);
    assert.deepEqual(
      view.cards.filter((card) => card.section === section?.id).map((card) => card.id),
      ["note:sam", "task:1"],
    );
    const sams = boardOf(threads).find((note) => note.id === "note:sam");
    // Moved, but still Sam's, and still what Sam wrote.
    assert.deepEqual([sams?.guestId, sams?.text, sams?.agent], [sam, "Pricing page", undefined]);
    assert.isTrue(boardOf(threads).find((note) => note.id === "task:1")?.done);
    assert.deepEqual(view.lines, [{ from: "task:1", to: "box:b" }]);
    // The section is the agent's own; adding into it again uses the one there.
    const more = yield* agent.add(boxThreadId, { cards: [{ text: "Ask Sam" }], section: "Ideas" });
    assert.isUndefined(more.sections);
    assert.strictEqual(
      (yield* agent.read(boxThreadId)).cards.find((card) => card.id === more.done[0])?.section,
      section?.id,
    );
    // Both calls are one turn of its run, for Sam or the owner to take back in one go.
    const turns = threads[roomThreadId]?.guestShare?.board?.agentTurns ?? [];
    assert.deepEqual(
      turns.map((turn) => [turn.id, turn.boxId, turn.askedBy, turn.edges?.length]),
      [["run:1", "box:b", sam, 1]],
    );
    assert.deepEqual(
      turns[0]?.cards.map((card) => [card.id, card.before?.x]),
      [
        [section?.id, undefined],
        ["note:sam", 900],
        ["task:1", 900],
        [more.done[0], undefined],
      ],
    );
  }).pipe(Effect.provide(layerWith(threads)));
});

it.effect("says why the board refuses a change, and works only on its own thread's board", () => {
  const filler = Array.from({ length: ROOM_BOARD_MAX_NOTES - 4 }, (_, index): RoomBoardNote => ({
    id: `n${index}`,
    text: "x",
    x: index * 300,
    y: 3_000,
  }));
  const threads = makeThreads(filler);
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    const lone = yield* Effect.exit(agent.read(loneThreadId));
    assert.isTrue(Exit.isFailure(lone));
    assert.include(String(Exit.isFailure(lone) && lone.cause), "not on a board");

    const added = yield* agent.add(boxThreadId, { cards: [{ text: "One" }, { text: "Two" }] });
    assert.lengthOf(added.done, 1);
    assert.deepEqual(added.refused, [{ card: "Two", reason: ROOM_BOARD_FULL }]);

    const changed = yield* agent.update(boxThreadId, {
      changes: [
        { id: "box:b", text: "Renamed" },
        { id: "note:sam", done: true },
        { id: "gone", text: "Hi" },
        { id: "note:sam", lineTo: "note:sam" },
      ],
    });
    assert.deepEqual(changed.done, []);
    assert.deepEqual(
      changed.refused.map((refusal) => refusal.reason),
      [
        "Only a note's or a task's text can be changed.",
        "Only a task can be ticked.",
        "No card with this id is on the board. Read the board for the ids.",
        "An arrow joins two different cards.",
      ],
    );
    assert.strictEqual(boardOf(threads).find((note) => note.id === "box:b")?.text, "Research");
  }).pipe(Effect.provide(layerWith(threads)));
});

/** One board change as the room's owner's server decides it, by `author` and as `agent`. */
const decide = (
  threads: Record<string, OrchestrationV2AppThread>,
  author: GuestId | null,
  change: RoomBoardChange,
  agent?: object,
) =>
  decideGuestShareCommand({
    thread: threads[roomThreadId]!,
    now: DateTime.makeUnsafe(0),
    command: {
      type: "thread.guest-board.change",
      commandId: CommandId.make("board:decided"),
      threadId: roomThreadId,
      shareId,
      author,
      change,
      ...(agent === undefined ? {} : { agent: agent as RoomBoardAgentMark }),
    },
  });

it.effect(
  "lets the agent of a guest's own box change the board as theirs, from no other box",
  () => {
    const threads = makeThreads();
    const samsBox = {
      roomThreadId,
      shareId,
      guestId: sam,
      boxId: "box:sam",
      turnId: "run:sam",
      model: "Claude​ Haiku",
    };
    const samsMark = { boxId: "box:sam", model: "Claude Haiku", turnId: "run:sam", askedBy: sam };
    return Effect.gen(function* () {
      const agent = yield* RoomBoardAgent.RoomBoardAgent;
      assert.strictEqual((yield* agent.read(samsBox)).you, "box:sam");
      const added = yield* agent.add(samsBox, { cards: [{ text: "Sam's agent was here" }] });
      assert.deepEqual(added.refused, []);
      const noteOf = () => boardOf(threads).find((candidate) => candidate.id === added.done[0]);
      // Sam's card, as Sam's box's agent's, in a turn Sam and the owner can take back.
      assert.deepEqual([noteOf()?.guestId, noteOf()?.agent], [sam, samsMark]);
      const turn = threads[roomThreadId]?.guestShare?.board?.agentTurns?.[0];
      assert.deepEqual(
        [turn?.id, turn?.boxId, turn?.askedBy, turn?.guestId],
        ["run:sam", "box:sam", sam, sam],
      );
      const view = yield* agent.read(samsBox);
      assert.strictEqual(view.cards.find((card) => card.id === added.done[0])?.by, "you");

      // Not the owner's box, nor Sam's box as Ana, nor a room the thread no longer shares.
      const reason = (box: typeof samsBox) =>
        Effect.map(
          Effect.flip(agent.add(box, { cards: [{ text: "Hi" }] })),
          (error) => error.reason,
        );
      assert.strictEqual(yield* reason({ ...samsBox, boxId: "box:b" }), "not_on_board");
      assert.strictEqual(yield* reason({ ...samsBox, guestId: ana }), "not_on_board");
      assert.strictEqual(
        yield* reason({ ...samsBox, shareId: GuestShareId.make("share:old") }),
        "board_gone",
      );

      // The owner's server holds the same line for a change that reaches it any other way.
      threads[roomThreadId] = Result.getOrThrow(
        decide(
          threads,
          null,
          { type: "note.put", noteId: "note:owner-agent", text: "Owner", x: 0, y: 5_000 },
          { boxId: "box:b", turnId: "run:owner" },
        ),
      );
      const put = {
        type: "note.put",
        noteId: "note:spoof",
        text: "Spoof",
        x: 0,
        y: 3_000,
      } as const;
      assert.isTrue(Result.isSuccess(decide(threads, sam, put, { ...samsMark, turnId: "run:2" })));
      for (const spoof of [
        { ...samsMark, boxId: "box:b" },
        { boxId: "box:sam", turnId: "run:2" },
        { ...samsMark, askedBy: ana },
        // The owner's turn, to be undone as Sam's.
        { ...samsMark, turnId: "run:owner" },
      ]) {
        assert.isTrue(Result.isFailure(decide(threads, sam, put, spoof)), JSON.stringify(spoof));
      }
      assert.isTrue(Result.isFailure(decide(threads, ana, put, samsMark)));

      // Ana cannot undo it; Sam can, and a redo puts the card back as Sam's.
      const undo = (author: GuestId | null, undone: boolean) =>
        decide(threads, author, { type: "agent-turn.undo", turnId: "run:sam", undone });
      assert.isTrue(Result.isFailure(undo(ana, true)));
      threads[roomThreadId] = Result.getOrThrow(undo(sam, true));
      assert.isUndefined(noteOf());
      threads[roomThreadId] = Result.getOrThrow(undo(null, false));
      assert.deepEqual([noteOf()?.guestId, noteOf()?.agent], [sam, samsMark]);
    }).pipe(Effect.provide(layerWith(threads)));
  },
);

it.effect("sends the board tools of the user's own box in someone else's room to that room", () => {
  const threads = makeThreads();
  const links = elsewhere();
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    assert.strictEqual((yield* agent.read(mineThreadId)).you, "box:mine");
    yield* agent.add(mineThreadId, { cards: [{ text: "Hi" }] });
    yield* agent.update(mineThreadId, { changes: [{ id: "note:1", done: true }] });
    // Its run and model mark the changes; the room's owner takes the box and the person from its
    // own record of this machine's room token.
    assert.deepEqual(links.asked, [
      mineThreadId,
      { turnId: "run:1", model: "GPT-5.1 Codex", change: { add: { cards: [{ text: "Hi" }] } } },
      {
        turnId: "run:1",
        model: "GPT-5.1 Codex",
        change: { update: { changes: [{ id: "note:1", done: true }] } },
      },
    ]);
    // A room it cannot reach is something the agent can tell its user.
    links.fail("unreachable");
    const unreachable = yield* Effect.flip(agent.read(mineThreadId));
    assert.strictEqual(unreachable.message, "This box can't reach the room's board from here.");
    links.fail("room_ended");
    const ended = yield* Effect.flip(agent.add(mineThreadId, { cards: [] }));
    assert.strictEqual(ended.reason, "board_gone");
    // This machine's own boards are untouched by all of it.
    assert.lengthOf(boardOf(threads), 3);
  }).pipe(Effect.provide(layerWith(threads, links.layer)));
});
