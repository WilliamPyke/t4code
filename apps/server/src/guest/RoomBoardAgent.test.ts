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
import {
  ROOM_BOARD_AGENT_VIEW_MAX_CARDS,
  ROOM_BOARD_AGENT_VIEW_MAX_LINES,
  roomBoardNoteSize,
} from "@t3tools/shared/roomBoardAgent";
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
    arrangeBoard: (_threadId, request) => {
      asked.push(request);
      return answer({ moved: [], renamed: [], refused: [] });
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

const layerWith = (
  threads: Record<string, OrchestrationV2AppThread>,
  links = elsewhere().layer,
  dispatched: Array<OrchestrationV2ServerCommand> = [],
) =>
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
        dispatch: (sent: OrchestrationV2ServerCommand) =>
          Effect.gen(function* () {
            dispatched.push(sent);
            const command = sent as GuestShareCommand;
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

    // Tasks are taller than notes; in a section it makes, they still clear each other and fit.
    const tasks = yield* agent.add(boxThreadId, {
      section: "Tasks",
      cards: ["Buy the domain", "Draft the post", "Review pricing", "Ship it"].map((text) => ({
        text,
        task: true,
      })),
    });
    assert.lengthOf(tasks.done, 4);
    const board = boardOf(threads);
    const sectionNote = board.find((note) => note.id === tasks.sections?.[0]?.id);
    assert.isDefined(sectionNote);
    const placed = board.filter((note) => tasks.done.includes(note.id));
    for (const note of placed) {
      for (const other of board) {
        if (other !== note && other !== sectionNote) {
          assert.isFalse(overlap(note, other), `${note.text} on ${other.text}`);
        }
      }
      const [inner, outer] = [rect(note), rect(sectionNote)];
      assert.isTrue(inner.y + inner.h <= outer.y + outer.h, `${note.text} below its section`);
    }
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
    const tidy = { ops: [{ do: "tidy" as const, section: "Ideas" }] };
    assert.deepEqual(yield* agent.arrange(mineThreadId, tidy), {
      moved: [],
      renamed: [],
      refused: [],
    });
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
      { turnId: "run:1", model: "GPT-5.1 Codex", change: { arrange: tidy } },
    ]);
    // A host from before arranging refuses the request: the agent is told why, not that it broke.
    links.fail("invalid_response");
    const outdated = yield* Effect.flip(agent.arrange(mineThreadId, tidy));
    assert.strictEqual(outdated.reason, "host_outdated");
    assert.include(outdated.message, "needs updating");
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

/** The room's board with these lines on it. */
const withEdges = (
  threads: Record<string, OrchestrationV2AppThread>,
  edges: ReadonlyArray<{ readonly id: string; readonly from: string; readonly to: string }>,
) => {
  const room = threads[roomThreadId]!;
  const share = room.guestShare!;
  threads[roomThreadId] = {
    ...room,
    guestShare: { ...share, board: { ...share.board!, edges } },
  } as OrchestrationV2AppThread;
};

const planOf = (threads: Record<string, OrchestrationV2AppThread>, id: string) => {
  const note = boardOf(threads).find((candidate) => candidate.id === id);
  return note && [note.status, note.priority, note.due, note.assignee];
};

it.effect("plans a batch of tasks as one group beside the board's tasks, starting no turn", () => {
  const threads = makeThreads([{ id: "task:old", text: "Old task", x: 1_400, y: 0, kind: "task" }]);
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    assert.deepEqual((yield* agent.read(boxThreadId)).people, [
      { name: "the owner", me: true },
      { name: "Sam" },
      { name: "Ana" },
    ]);
    const added = yield* agent.add(boxThreadId, {
      cards: [
        { text: "Write the brief", priority: "urgent", due: "2026-12-01", assignee: "me" },
        { text: "Design the page", status: "doing", assignee: "Sam" },
        { text: "Review the copy", assignee: "ana" },
        // Nobody by that name: refused, never made up.
        { text: "Ask Bob", assignee: "Bob" },
        ...["Pick a date", "Book the room", "Send invites", "Print badges", "Order food"].map(
          (text) => ({ text, task: true }),
        ),
      ],
    });
    assert.lengthOf(added.done, 8);
    assert.deepEqual(
      added.refused.map((refusal) => refusal.card),
      ["Ask Bob"],
    );
    assert.include(added.refused[0]?.reason, 'Nobody called "Bob" is on this board');
    assert.include(added.refused[0]?.reason, "the owner, Sam, Ana");
    const notes = boardOf(threads);
    const tasks = added.done.map((id) => notes.find((note) => note.id === id)!);
    assert.deepEqual(
      tasks.slice(0, 3).map((task) => [task.kind, ...planOf(threads, task.id)!, task.agent]),
      [
        ["task", undefined, "urgent", "2026-12-01", {}, agentMark],
        ["task", "doing", undefined, undefined, { guestId: sam }, agentMark],
        ["task", undefined, undefined, undefined, { guestId: ana }, agentMark],
      ],
    );
    // One grid of four by two, beside the old task, clear of every card.
    assert.lengthOf(new Set(tasks.map((task) => task.x)), 4);
    assert.lengthOf(new Set(tasks.map((task) => task.y)), 2);
    assert.strictEqual(Math.min(...tasks.map((task) => task.y)), 0);
    assert.isTrue(tasks.every((task) => task.x > 1_400 && task.x < 2_600));
    for (const task of tasks) {
      for (const other of notes) {
        if (other !== task) assert.isFalse(overlap(task, other), `${task.text} on ${other.id}`);
      }
    }

    const changed = yield* agent.update(boxThreadId, {
      changes: [{ id: "task:old", assignee: "Sam", status: "done", priority: "high" }],
    });
    assert.deepEqual(changed.refused, []);
    const old = boardOf(threads).find((note) => note.id === "task:old");
    assert.deepEqual([old?.done, old?.assignee, old?.priority], [true, { guestId: sam }, "high"]);
    const shown = (yield* agent.read(boxThreadId)).cards.find((card) => card.id === tasks[1]?.id);
    assert.deepEqual([shown?.status, shown?.assignee], ["doing", "Sam"]);

    // Giving Sam work only labelled it: every call was a board change, and none runs a task.
    assert.isTrue(dispatched.every((command) => command.type === "thread.guest-board.change"));
    assert.deepEqual(
      [
        ...new Set(
          dispatched.map(
            (command) => (command as Extract<GuestShareCommand, { change: unknown }>).change.type,
          ),
        ),
      ],
      ["note.put"],
    );
    assert.isTrue(boardOf(threads).every((note) => note.run === undefined));
  }).pipe(Effect.provide(layerWith(threads, undefined, dispatched)));
});

it.effect("arranges cards in one turn that undo puts back, places and sizes", () => {
  const threads = makeThreads([
    { id: "sec", text: "Ideas", x: 2_000, y: 0, section: true },
    { id: "note:2", text: "FAQ", x: 1_300, y: 500 },
  ]);
  const dispatched: Array<OrchestrationV2ServerCommand> = [];
  const placeOf = (id: string) => {
    const note = boardOf(threads).find((candidate) => candidate.id === id);
    return note && [note.x, note.y, note.size];
  };
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    const shown = (yield* agent.read(boxThreadId)).cards.find((card) => card.id === "note:2");
    assert.deepEqual([shown?.x, shown?.y, shown?.w, shown?.h], [1_300, 500, 192, 144]);
    const result = yield* agent.arrange(boxThreadId, {
      ops: [
        { do: "layout", cards: ["note:sam", "note:2"], as: "column", in: "Ideas" },
        { do: "resize", card: "note:2", w: 400, h: 300 },
        // Sam's own box: only people move it.
        { do: "move", card: "box:sam", x: 0, y: 0 },
      ],
    });
    assert.deepEqual(result.moved, [
      { id: "note:sam", x: 2_032, y: 72, w: 192, h: 144 },
      { id: "note:2", x: 2_032, y: 240, w: 400, h: 300 },
    ]);
    assert.deepEqual(
      result.refused.map((refusal) => refusal.op),
      [2],
    );
    // Sam's card is still Sam's, and every change was a board change that starts nothing.
    assert.strictEqual(boardOf(threads).find((note) => note.id === "note:sam")?.guestId, sam);
    assert.isTrue(dispatched.every((command) => command.type === "thread.guest-board.change"));
    const turns = threads[roomThreadId]?.guestShare?.board?.agentTurns ?? [];
    assert.deepEqual(
      turns.map((turn) => [turn.id, turn.cards.map((card) => card.id)]),
      [["run:1", ["note:sam", "note:2"]]],
    );
    const undo = (undone: boolean) =>
      decide(threads, null, { type: "agent-turn.undo", turnId: "run:1", undone });
    threads[roomThreadId] = Result.getOrThrow(undo(true));
    assert.deepEqual(
      [placeOf("note:sam"), placeOf("note:2")],
      [
        [900, 0, undefined],
        [1_300, 500, undefined],
      ],
    );
    threads[roomThreadId] = Result.getOrThrow(undo(false));
    assert.deepEqual(placeOf("note:2"), [2_032, 240, { w: 400, h: 300 }]);

    // A guest's own box's agent arranges as that guest: never the owner's box.
    const asSam = yield* agent.arrange(
      { roomThreadId, shareId, guestId: sam, boxId: "box:sam", turnId: "run:sam" },
      {
        ops: [
          { do: "move", card: "box:b", x: 0, y: 0 },
          { do: "move", card: "note:2", x: 1_300, y: 900 },
        ],
      },
    );
    assert.deepEqual(
      [asSam.refused.map((refusal) => refusal.op), asSam.moved.map((card) => card.id)],
      [[0], ["note:2"]],
    );
  }).pipe(Effect.provide(layerWith(threads, undefined, dispatched)));
});

it.effect("undoes a turn that planned tasks, plans and all, and redoes it", () => {
  const threads = makeThreads([
    { id: "task:1", text: "Ship it", x: 1_400, y: 0, kind: "task", priority: "low" },
  ]);
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    yield* agent.update(boxThreadId, {
      changes: [
        { id: "task:1", status: "doing", priority: "high", due: "2026-12-24", assignee: "Ana" },
      ],
    });
    const added = yield* agent.add(boxThreadId, {
      cards: [{ text: "Write the post", priority: "medium", assignee: "me" }],
    });
    const newId = added.done[0]!;
    assert.deepEqual(planOf(threads, "task:1"), ["doing", "high", "2026-12-24", { guestId: ana }]);
    const undo = (undone: boolean) =>
      decide(threads, null, { type: "agent-turn.undo", turnId: "run:1", undone });
    threads[roomThreadId] = Result.getOrThrow(undo(true));
    assert.deepEqual(planOf(threads, "task:1"), [undefined, "low", undefined, undefined]);
    // The task it added goes too, though it was given a priority and a person.
    assert.isUndefined(planOf(threads, newId));
    threads[roomThreadId] = Result.getOrThrow(undo(false));
    assert.deepEqual(planOf(threads, "task:1"), ["doing", "high", "2026-12-24", { guestId: ana }]);
    assert.deepEqual(planOf(threads, newId), [undefined, "medium", undefined, {}]);
  }).pipe(Effect.provide(layerWith(threads)));
});

it.effect("never attaches a card to someone else's agent, nor edits one that goes to it", () => {
  const threads = makeThreads([
    { id: "brief", text: "Brief for Sam's agent", x: 1_400, y: 0 },
    { id: "spec", text: "Spec", x: 1_400, y: 400, kind: "artifact" },
    { id: "idea", text: "An idea", x: 1_400, y: 900 },
    { id: "tray", text: "Sam's tray", x: 3_000, y: 0, section: true, size: { w: 640, h: 420 } },
    { id: "inTray", text: "In the tray", x: 3_020, y: 60 },
  ]);
  // Sam attached the brief, and every card in the tray, to their box, whose agent rewrites the spec.
  withEdges(threads, [
    { id: "e1", from: "note:brief", to: "note:box:sam" },
    { id: "e2", from: "note:box:sam", to: "note:spec" },
    { id: "e3", from: "note:tray", to: "note:box:sam" },
  ]);
  const samsBox = { roomThreadId, shareId, guestId: sam, boxId: "box:sam", turnId: "run:sam" };
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    const owners = yield* agent.update(boxThreadId, {
      changes: [
        { id: "brief", text: "Rewritten" },
        { id: "idea", lineTo: "box:sam" },
        { id: "idea", lineTo: "spec" },
        { id: "idea", lineTo: "brief" },
        { id: "idea", lineTo: "box:b" },
      ],
    });
    assert.deepEqual(owners.done, ["idea"]);
    assert.lengthOf(owners.refused, 4);
    for (const refusal of owners.refused) assert.include(refusal.reason, "Sam's agent");
    assert.strictEqual(
      boardOf(threads).find((note) => note.id === "brief")?.text,
      "Brief for Sam's agent",
    );
    assert.lengthOf(threads[roomThreadId]?.guestShare?.board?.edges ?? [], 4);
    // Nor through Sam's section: no edit of a card in it, no card moved, added or lined into it.
    const tray = yield* agent.update(boxThreadId, {
      changes: [
        { id: "inTray", text: "Rewritten" },
        { id: "idea", section: "tray" },
        { id: "idea", lineTo: "tray" },
      ],
    });
    assert.deepEqual(tray.done, []);
    assert.lengthOf(tray.refused, 3);
    for (const refusal of tray.refused) assert.include(refusal.reason, "Sam's agent");
    const slipped = yield* agent.add(boxThreadId, { section: "tray", cards: [{ text: "Slip" }] });
    assert.include(slipped.refused[0]?.reason, "Sam's agent");
    const placed = boardOf(threads).find((note) => note.id === slipped.done[0]);
    assert.isBelow(placed?.x ?? 0, 3_000);
    assert.strictEqual(boardOf(threads).find((note) => note.id === "idea")?.x, 1_400);

    // Sam's own agent may, for Sam's own box, and "me" is Sam; the owner's box is not Sam's.
    const sams = yield* agent.update(samsBox, {
      changes: [
        { id: "brief", text: "Sam's brief" },
        { id: "inTray", text: "Sam's tray note" },
        { id: "idea", lineTo: "box:sam" },
        { id: "idea", lineTo: "box:b" },
      ],
    });
    assert.deepEqual(sams.done, ["brief", "inTray", "idea"]);
    assert.deepEqual(
      sams.refused.map((refusal) => refusal.reason),
      [
        "This line would send the card to the owner's agent. Only the owner attaches cards to their agent: tell your user instead.",
      ],
    );
    const mine = yield* agent.add(samsBox, { cards: [{ text: "Sam's task", assignee: "me" }] });
    assert.deepEqual(planOf(threads, mine.done[0]!)?.[3], { guestId: sam });
    assert.isTrue((yield* agent.read(samsBox)).people?.some((p) => p.name === "Sam" && p.me));
  }).pipe(Effect.provide(layerWith(threads)));
});

it.effect("reads a big board in a short answer, keeping what this box works on", () => {
  const threads = makeThreads(
    Array.from({ length: 300 }, (_, index): RoomBoardNote => ({
      id: `n${index}`,
      text: `Note ${index} `.padEnd(200, "x"),
      x: (index % 20) * 260,
      y: 3_000 + Math.floor(index / 20) * 200,
      ...(index % 10 === 0
        ? { kind: "task" as const, priority: "high" as const, assignee: { guestId: sam } }
        : {}),
    })),
  );
  withEdges(threads, [
    { id: "mine", from: "note:n299", to: "note:box:b" },
    ...Array.from({ length: 299 }, (_, index) => ({
      id: `e${index}`,
      from: `note:n${index}`,
      to: `note:n${index + 1}`,
    })),
  ]);
  return Effect.gen(function* () {
    const agent = yield* RoomBoardAgent.RoomBoardAgent;
    const view = yield* agent.read(boxThreadId);
    assert.lengthOf(view.cards, ROOM_BOARD_AGENT_VIEW_MAX_CARDS);
    assert.isAtMost(view.lines.length, ROOM_BOARD_AGENT_VIEW_MAX_LINES);
    // 303 cards and the room's own: what is left out is counted.
    assert.strictEqual(view.omitted?.cards, 303 - (ROOM_BOARD_AGENT_VIEW_MAX_CARDS - 1));
    assert.deepEqual(view.attachedToYou, ["n299"]);
    const ids = new Set(view.cards.map((card) => card.id));
    for (const id of ["box:b", "n299", ...Array.from({ length: 30 }, (_, i) => `n${i * 10}`)]) {
      assert.isTrue(ids.has(id), id);
    }
    assert.deepEqual(
      (({ status, priority, assignee }) => ({ status, priority, assignee }))(
        view.cards.find((card) => card.id === "n10")!,
      ),
      { status: "todo", priority: "high", assignee: "Sam" },
    );
    assert.isBelow(JSON.stringify(view).length, 50_000);
  }).pipe(Effect.provide(layerWith(threads)));
});
