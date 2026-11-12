import { assert, it } from "@effect/vitest";
import {
  CommandId,
  GUEST_PENDING_MESSAGE_LIMIT,
  GUEST_SHARE_MAX_GUESTS,
  GUEST_TURN_LIMIT,
  GuestId,
  GuestMessageId,
  GuestShareId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationV2AppThread,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  RoomBoardChange,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";

import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "./Adapters/CodexAdapterV2.ts";
import * as EffectOutbox from "./EffectOutbox.ts";
import { decideGuestShareCommand } from "./GuestShareDecider.ts";
import * as Orchestrator from "./Orchestrator.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderAdapterRegistry from "./ProviderAdapterRegistry.ts";
import * as ProviderReplayHarness from "./testkit/ProviderReplayHarness.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for guest shares"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerTest = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "guest-share" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

const threadId = ThreadId.make("thread:guest-share");
const shareId = GuestShareId.make("share:one");
const guestMessageId = GuestMessageId.make("guest-message:one");
type NotePut = Extract<RoomBoardChange, { type: "note.put" }>;
const decodeChange = Schema.decodeUnknownOption(RoomBoardChange);
const sam = GuestId.make("guest:sam");
const alex = GuestId.make("guest:alex");

const setup = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make("create-guest-share"),
    threadId,
    projectId: ProjectId.make("project:guest-share"),
    title: "Review me",
    modelSelection: { instanceId, model: "gpt-5.1-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    createdBy: "user",
    creationSource: "web",
  });
  yield* orchestrator.dispatch({
    type: "thread.guest-share.open",
    commandId: CommandId.make("open-guest-share"),
    threadId,
    shareId,
    host: "env.t3.test",
    expiresAt: DateTime.formatIso(DateTime.add(yield* DateTime.now, { hours: 24 })),
  });
  return orchestrator;
});

const sendGuestMessage = (
  orchestrator: Orchestrator.OrchestratorV2["Service"],
  id: string,
  sent: GuestMessageId = guestMessageId,
) =>
  orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make(id),
    threadId,
    messageId: MessageId.make(id),
    guestMessageId: sent,
    text: "ignored: the server sends the guest's own text",
    attachments: [],
    dispatchMode: { type: "defer_start" },
    createdBy: "user",
    creationSource: "web",
  });

it.effect("lets several guests join a link and sends each message once, under its author", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const redeem = (guestId: GuestId, guestName: string) =>
      orchestrator.dispatch({
        type: "thread.guest-share.redeem",
        commandId: CommandId.make(`redeem:${guestId}`),
        threadId,
        shareId,
        guestId,
        guestName,
      });
    const submit = (guestId: GuestId, id: string, text: string) =>
      orchestrator.dispatch({
        type: "thread.guest-message.submit",
        commandId: CommandId.make(`submit:${id}`),
        threadId,
        shareId,
        guestId,
        guestMessageId: GuestMessageId.make(id),
        text,
      });
    const refused = (command: ReturnType<typeof redeem>) =>
      Effect.map(Effect.exit(command), Exit.isFailure);
    const outsider = GuestId.make("guest:outsider");
    yield* redeem(sam, "Sam");
    yield* redeem(alex, "Alex");
    // The agent and the owner tell guests apart by name alone.
    assert.isTrue(yield* refused(redeem(outsider, "sam")));
    assert.isTrue(yield* refused(submit(outsider, "guest-message:outsider", "Let me in")));

    yield* submit(sam, guestMessageId, "Why not keep the old cache?");
    yield* submit(alex, "guest-message:alex", "What about expiry?");
    assert.equal((yield* projections.getThreadShell(threadId))?.pendingGuestMessageCount, 2);

    yield* sendGuestMessage(orchestrator, "send-1");
    const projection = yield* projections.getThreadProjection(threadId);
    assert.deepEqual(
      projection.thread.guestShare?.messages.map((message) => message.status),
      ["sent", "pending"],
    );
    const sent = projection.messages.find((message) => message.id === MessageId.make("send-1"));
    assert.equal(
      sent?.text,
      "Message from guest Sam, sent by the owner:\n\nWhy not keep the old cache?",
    );
    assert.deepEqual(sent?.context?.guest, {
      guestMessageId,
      name: "Sam",
      text: "Why not keep the old cache?",
      shareId,
    });
    assert.lengthOf(projection.runs, 1);
    assert.equal((yield* projections.getThreadShell(threadId))?.pendingGuestMessageCount, 1);

    // A second owner device clicking Send must not start another turn.
    assert.isTrue(Exit.isFailure(yield* Effect.exit(sendGuestMessage(orchestrator, "send-2"))));
    assert.lengthOf((yield* projections.getThreadProjection(threadId)).runs, 1);

    yield* sendGuestMessage(orchestrator, "send-alex", GuestMessageId.make("guest-message:alex"));
    assert.equal(
      (yield* projections.getThreadProjection(threadId)).messages.find(
        (message) => message.id === MessageId.make("send-alex"),
      )?.text,
      "Message from guest Alex, sent by the owner:\n\nWhat about expiry?",
    );

    // One guest's waiting messages do not use up another's.
    for (let index = 0; index < GUEST_PENDING_MESSAGE_LIMIT; index++) {
      yield* submit(sam, `guest-message:sam-${index}`, "And another thing");
    }
    assert.isTrue(yield* refused(submit(sam, "guest-message:sam-over", "One too many")));
    yield* submit(alex, "guest-message:alex-2", "Still room for me");

    for (let index = 2; index < GUEST_SHARE_MAX_GUESTS; index++) {
      yield* redeem(GuestId.make(`guest:${index}`), `Guest ${index}`);
    }
    assert.isTrue(yield* refused(redeem(outsider, "One too many")));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("removes one guest with their waiting messages and lets no one new in", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const ids = { threadId, shareId };
    const join = (guestId: GuestId, guestName: string) =>
      orchestrator.dispatch({
        ...ids,
        type: "thread.guest-share.redeem",
        commandId: CommandId.make(`redeem:${guestId}`),
        guestId,
        guestName,
      });
    const ask = (guestId: GuestId, id: GuestMessageId) =>
      orchestrator.dispatch({
        ...ids,
        type: "thread.guest-message.submit",
        commandId: CommandId.make(`submit:${id}`),
        guestId,
        guestMessageId: id,
        text: "Why?",
      });
    const alexMessageId = GuestMessageId.make("guest-message:alex");
    yield* join(sam, "Sam");
    yield* join(alex, "Alex");
    yield* ask(sam, guestMessageId);
    yield* ask(sam, GuestMessageId.make("guest-message:sam-waiting"));
    yield* ask(alex, alexMessageId);
    yield* sendGuestMessage(orchestrator, "send-sam");

    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-sam"),
      threadId,
      guestId: sam,
    });
    const share = (yield* projections.getThread(threadId)).guestShare;
    assert.deepEqual(
      share?.guests?.map((guest) => guest.name),
      ["Alex"],
    );
    // What the owner already sent stays; what still waited goes with its author.
    assert.deepEqual(
      share?.messages.map((message) => [message.id, message.status]),
      [
        [guestMessageId, "sent"],
        [alexMessageId, "pending"],
      ],
    );
    const refused = (command: ReturnType<typeof join>) =>
      Effect.map(Effect.exit(command), Exit.isFailure);
    assert.isTrue(yield* refused(ask(sam, GuestMessageId.make("guest-message:sam-again"))));
    // Sam still has the link, so it lets no one new in, under any name.
    assert.isTrue(yield* refused(join(GuestId.make("guest:sam-again"), "Not Sam")));
    yield* ask(alex, GuestMessageId.make("guest-message:alex-2"));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("shows a guest's own turns on the share and starts nothing with them", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    yield* orchestrator.dispatch({
      type: "thread.guest-share.redeem",
      commandId: CommandId.make("redeem:sam"),
      threadId,
      shareId,
      guestId: sam,
      guestName: "Sam",
    });
    const post = (guestId: GuestId, id: string, commandId = `turn:${guestId}:${id}`) =>
      orchestrator.dispatch({
        type: "thread.guest-turn.post",
        commandId: CommandId.make(commandId),
        threadId,
        shareId,
        guestId,
        turn: { id, prompt: "Why?", reply: `Because ${id}.` },
      });
    for (let index = 0; index < GUEST_TURN_LIMIT + 2; index += 1) yield* post(sam, `run:${index}`);
    // The same turn posted again changes nothing and is not an error.
    yield* post(sam, `run:${GUEST_TURN_LIMIT + 1}`, "turn:again");
    const records = yield* orchestrator.getThreadRecords(threadId, ["runs", "messages"]);
    const turns = records.thread.guestShare?.turns ?? [];
    assert.lengthOf(turns, GUEST_TURN_LIMIT);
    assert.deepEqual(
      [turns[0]?.id, turns.at(-1)?.id, turns.at(-1)?.guestId],
      ["run:2", `run:${GUEST_TURN_LIMIT + 1}`, sam],
    );
    // Shown only: no message for the owner's agent, and no run.
    assert.lengthOf(records.runs, 0);
    assert.lengthOf(records.messages, 0);
    // Only someone on the link can post, and their turns leave with them.
    assert.isTrue(Exit.isFailure(yield* Effect.exit(post(alex, "run:alex"))));
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-sam"),
      threadId,
      guestId: sam,
    });
    const after = yield* orchestrator.getThreadRecords(threadId, []);
    assert.deepEqual(after.thread.guestShare?.turns, []);
    assert.isTrue(Exit.isFailure(yield* Effect.exit(post(sam, "run:late"))));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps one board for the room, changed a card or a note at a time", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const join = (guestId: GuestId, guestName: string) =>
      orchestrator.dispatch({
        type: "thread.guest-share.redeem",
        commandId: CommandId.make(`redeem:${guestId}`),
        threadId,
        shareId,
        guestId,
        guestName,
      });
    yield* join(sam, "Sam");
    yield* join(alex, "Alex");
    let changes = 0;
    const change = (author: GuestId | null, change: RoomBoardChange) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: CommandId.make(`board:${changes++}`),
        threadId,
        shareId,
        author,
        change,
      });
    const refused = (command: ReturnType<typeof change>) =>
      Effect.map(Effect.exit(command), Exit.isFailure);
    const read = Effect.map(
      orchestrator.getThreadRecords(threadId, ["runs", "messages"]),
      (records) => ({ ...records, board: records.thread.guestShare?.board }),
    );
    const before = (yield* read).thread.updatedAt;

    // The last move of a card wins, whoever made it.
    yield* change(null, { type: "card.move", cardId: "thread", x: 10, y: 20 });
    yield* change(sam, { type: "card.move", cardId: "thread", x: 300, y: -40 });
    yield* change(alex, { type: "card.move", cardId: `agent:${sam}`, x: 5, y: 5 });
    yield* change(sam, { type: "note.put", noteId: "note:sam", text: "Ship it", x: 1, y: 2 });
    yield* change(null, { type: "note.put", noteId: "note:owner", text: "Not yet", x: 3, y: 4 });
    // Anyone in the room can edit a note; it stays its author's.
    const edited: RoomBoardChange = {
      type: "note.put",
      noteId: "note:sam",
      text: "Ship it Friday",
      x: 9,
      y: 9,
    };
    yield* change(alex, edited);
    // Repeating a change, or removing a note that is gone, is not an error.
    yield* change(alex, edited);
    yield* change(null, { type: "note.remove", noteId: "note:never" });
    const arranged = yield* read;
    assert.deepEqual(arranged.board, {
      positions: { thread: { x: 300, y: -40 }, [`agent:${sam}`]: { x: 5, y: 5 } },
      notes: [
        { id: "note:sam", text: "Ship it Friday", x: 9, y: 9, guestId: sam },
        { id: "note:owner", text: "Not yet", x: 3, y: 4 },
      ],
    });
    // Shown only: nothing for the agent, no run, and the thread keeps its place in the list.
    assert.lengthOf(arranged.runs, 0);
    assert.lengthOf(arranged.messages, 0);
    assert.deepEqual(arranged.thread.updatedAt, before);

    const outsider = GuestId.make("guest:outsider");
    assert.isTrue(yield* refused(change(outsider, { type: "note.remove", noteId: "note:sam" })));
    assert.isTrue(
      yield* refused(change(sam, { type: "card.move", cardId: "guest:nobody", x: 0, y: 0 })),
    );
    const blank = (noteId: string): RoomBoardChange => ({
      type: "note.put",
      noteId,
      text: "",
      x: 0,
      y: 0,
    });
    for (let index = 2; index < ROOM_BOARD_MAX_NOTES; index += 1) {
      yield* change(alex, blank(`note:${index}`));
    }
    assert.isTrue(yield* refused(change(alex, blank("note:over"))));
    // A full board still takes edits to the notes it has.
    yield* change(alex, { type: "note.put", noteId: "note:owner", text: "Now", x: 3, y: 4 });

    // A guest whose link ran out cannot write; the owner still can.
    const { thread } = yield* read;
    const later = DateTime.add(yield* DateTime.now, { hours: 25 });
    const decideLater = (author: GuestId | null) =>
      decideGuestShareCommand({
        thread,
        now: later,
        command: {
          type: "thread.guest-board.change",
          commandId: CommandId.make("board:late"),
          threadId,
          shareId,
          author,
          change: { type: "note.remove", noteId: "note:owner" },
        },
      });
    assert.isTrue(Result.isFailure(decideLater(sam)));
    assert.isTrue(Result.isSuccess(decideLater(null)));

    // A removed guest's notes and cards go with them, and they cannot write again.
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-sam"),
      threadId,
      guestId: sam,
    });
    const after = (yield* read).board;
    assert.deepEqual(Object.keys(after?.positions ?? {}), ["thread"]);
    assert.isFalse(after?.notes.some((note) => note.guestId === sam));
    assert.isTrue(yield* refused(change(sam, { type: "note.remove", noteId: "note:owner" })));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps tasks, links, comments and arrows on the board, checked by the room", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    for (const [guestId, guestName] of [
      [sam, "Sam"],
      [alex, "Alex"],
    ] as const) {
      yield* orchestrator.dispatch({
        type: "thread.guest-share.redeem",
        commandId: CommandId.make(`redeem:${guestId}`),
        threadId,
        shareId,
        guestId,
        guestName,
      });
    }
    let changes = 0;
    const change = (author: GuestId | null, change: RoomBoardChange) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: CommandId.make(`board:${changes++}`),
        threadId,
        shareId,
        author,
        change,
      });
    const refused = (command: ReturnType<typeof change>) =>
      Effect.map(Effect.exit(command), Exit.isFailure);
    const board = Effect.map(
      orchestrator.getThreadRecords(threadId, ["runs", "messages"]),
      (records) => ({ ...records, board: records.thread.guestShare?.board }),
    );
    const put = (noteId: string, fields: Partial<NotePut> = {}): NotePut => ({
      type: "note.put",
      noteId,
      text: "",
      x: 0,
      y: 0,
      ...fields,
    });

    // A link holds an http or https address, and only a link holds one.
    assert.isTrue(
      yield* refused(change(sam, put("link:bad", { kind: "link", url: "javascript:alert(1)" }))),
    );
    assert.isTrue(
      Option.isNone(decodeChange(put("link:bad", { kind: "link", url: "file:///etc" }))),
    );
    assert.isTrue(yield* refused(change(sam, put("link:none", { kind: "link" }))));
    assert.isTrue(yield* refused(change(sam, put("note:url", { url: "https://example.com" }))));
    yield* change(sam, put("link", { kind: "link", url: "https://github.com/acme/app/pull/1" }));

    // A task is assigned to someone in the room, and only a task is done or assigned.
    const outsider = GuestId.make("guest:outsider");
    assert.isTrue(
      yield* refused(change(sam, put("task", { kind: "task", assignee: { guestId: outsider } }))),
    );
    assert.isTrue(yield* refused(change(sam, put("note", { done: true }))));
    yield* change(
      sam,
      put("task", { kind: "task", text: "Fix login", assignee: { guestId: alex } }),
    );
    yield* change(alex, put("task", { text: "Fix login", done: true }));
    // An older client's edit says nothing of the task's state, which stays.
    yield* change(null, put("task", { text: "Fix login now" }));
    yield* change(alex, put("comment", { text: "Why 15 minutes?", pinnedTo: "message:1" }));
    yield* change(null, put("owner-task", { kind: "task", assignee: {} }));

    // Arrows join two cards that are on the board, once each.
    const arrow = (edgeId: string, from: string, to: string): RoomBoardChange => ({
      type: "edge.put",
      edgeId,
      from,
      to,
    });
    yield* change(sam, arrow("a1", "note:task", "card:thread"));
    yield* change(sam, arrow("a1-again", "note:task", "card:thread"));
    yield* change(alex, arrow("a2", "note:comment", `card:guest:${sam}`));
    yield* change(alex, arrow("a3", "note:link", "note:owner-task"));
    yield* change(null, arrow("a4", `card:agent:${alex}`, "note:link"));
    assert.isTrue(yield* refused(change(sam, arrow("a5", "note:task", "note:task"))));
    assert.isTrue(yield* refused(change(sam, arrow("a5", "note:gone", "card:thread"))));
    assert.isTrue(yield* refused(change(sam, arrow("a5", "card:guest:nobody", "card:thread"))));

    const arranged = yield* board;
    assert.deepEqual(arranged.board?.notes, [
      {
        id: "link",
        text: "",
        x: 0,
        y: 0,
        guestId: sam,
        kind: "link",
        url: "https://github.com/acme/app/pull/1",
      },
      {
        id: "task",
        text: "Fix login now",
        x: 0,
        y: 0,
        guestId: sam,
        kind: "task",
        done: true,
        assignee: { guestId: alex },
      },
      { id: "comment", text: "Why 15 minutes?", x: 0, y: 0, guestId: alex, pinnedTo: "message:1" },
      { id: "owner-task", text: "", x: 0, y: 0, kind: "task", assignee: {} },
    ]);
    assert.deepEqual(
      arranged.board?.edges?.map((edge) => edge.id),
      ["a1", "a2", "a3", "a4"],
    );
    // Shown only: nothing on the board reaches the agent or starts a run.
    assert.lengthOf(arranged.runs, 0);
    assert.lengthOf(arranged.messages, 0);

    // Taking a card off takes its arrows; clearing an assignee leaves the task.
    yield* change(null, { type: "note.remove", noteId: "link" });
    yield* change(null, put("owner-task", { assignee: null }));
    yield* change(sam, { type: "edge.remove", edgeId: "a1" });
    const trimmed = (yield* board).board;
    assert.deepEqual(
      trimmed?.edges?.map((edge) => edge.id),
      ["a2"],
    );
    assert.isUndefined(trimmed?.notes.find((note) => note.id === "owner-task")?.assignee);

    // A removed guest's cards, comments and arrows go; tasks they had are left with no one.
    yield* change(sam, arrow("a6", "note:task", `card:guest:${alex}`));
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-alex"),
      threadId,
      guestId: alex,
    });
    const after = (yield* board).board;
    assert.deepEqual(
      after?.notes.map((note) => note.id),
      ["task", "owner-task"],
    );
    assert.isUndefined(after?.notes[0]?.assignee);
    assert.deepEqual(after?.edges, []);
  }).pipe(Effect.provide(layerTest)),
);

it("caps the arrows on a board", () => {
  const notes = Array.from({ length: ROOM_BOARD_MAX_EDGES + 1 }, (_, index) => ({
    id: `n${index}`,
    text: "",
    x: 0,
    y: 0,
  }));
  const edges = notes.slice(1).map((note, index) => ({
    id: `e${index}`,
    from: "note:n0",
    to: `note:${note.id}`,
  }));
  const thread = {
    guestShare: {
      id: shareId,
      expiresAt: "2999-01-01T00:00:00.000Z",
      guestName: null,
      guests: [],
      messages: [],
      board: { positions: {}, notes, edges },
    },
  } as unknown as OrchestrationV2AppThread;
  const decide = (to: string) =>
    decideGuestShareCommand({
      thread,
      now: DateTime.makeUnsafe("2026-11-12T00:00:00.000Z"),
      command: {
        type: "thread.guest-board.change",
        commandId: CommandId.make("board:cap"),
        threadId,
        shareId,
        author: null,
        change: { type: "edge.put", edgeId: "over", from: "card:thread", to },
      },
    });
  assert.isTrue(Result.isFailure(decide("note:n1")));
});

it.effect("starts a thread with a conversation from elsewhere and hands it to the first turn", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const joined = ThreadId.make("thread:joined");
    yield* orchestrator.dispatch({
      type: "thread.create",
      commandId: CommandId.make("create-joined"),
      threadId: joined,
      projectId: ProjectId.make("project:guest-share"),
      title: "Review me",
      modelSelection: { instanceId, model: "gpt-5.1-codex" },
      runtimeMode: "approval-required",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      importedHistory: {
        messages: [
          { role: "user", text: "Why is the cache stale?", createdAt: "2026-11-09T10:00:00.000Z" },
          {
            role: "assistant",
            text: "Its key omits the locale.",
            createdAt: "2026-11-09T10:00:05.000Z",
          },
        ],
        notice: "Copied from a shared thread.",
      },
      createdBy: "user",
      creationSource: "web",
    });
    const imported = yield* projections.getThreadProjection(joined);
    assert.equal(imported.thread.historyOrigin, "v1_import");
    // History, not work this machine did: no run, so nothing here can be re-run or reverted.
    assert.lengthOf(imported.runs, 0);
    assert.deepEqual(
      imported.visibleTurnItems.map(({ item }) => [item.type, item.runId]),
      [
        ["system_notice", null],
        ["user_message", null],
        ["assistant_message", null],
      ],
    );

    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("first-turn"),
      threadId: joined,
      messageId: MessageId.make("first-turn"),
      text: "Fix it",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const [handoff] = (yield* projections.getThreadProjection(joined)).contextHandoffs;
    assert.deepEqual(
      handoff?.history?.messages.map((message) => message.text),
      ["Why is the cache stale?", "Its key omits the locale."],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a link made before several guests could join to its one guest", () =>
  Effect.gen(function* () {
    yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const current = yield* projections.getThread(threadId);
    const { guests: _guests, ...share } = current.guestShare!;
    const thread = { ...current, guestShare: { ...share, guestName: "Sam" } };
    const now = yield* DateTime.now;
    const decide = (command: Parameters<typeof decideGuestShareCommand>[0]["command"]) =>
      decideGuestShareCommand({ thread, command, now });
    const ids = { commandId: CommandId.make("legacy"), threadId, shareId };

    const second = decide({
      ...ids,
      type: "thread.guest-share.redeem",
      guestId: alex,
      guestName: "Alex",
    });
    assert.isTrue(Result.isFailure(second));
    // Its guest's session and messages carry no guest id.
    const message = decide({
      ...ids,
      type: "thread.guest-message.submit",
      guestMessageId,
      text: "Hi",
    });
    assert.isTrue(Result.isSuccess(message));
    const impostor = decide({
      ...ids,
      type: "thread.guest-message.submit",
      guestId: alex,
      guestMessageId,
      text: "Hi",
    });
    assert.isTrue(Result.isFailure(impostor));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("rejects guest messages until the link is redeemed and after archive", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    const submit = orchestrator.dispatch({
      type: "thread.guest-message.submit",
      commandId: CommandId.make("submit-early"),
      threadId,
      shareId,
      guestId: sam,
      guestMessageId,
      text: "Hello",
    });
    assert.isTrue(Exit.isFailure(yield* Effect.exit(submit)));

    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make("archive-guest-share"),
      threadId,
    });
    assert.isNull((yield* projections.getThread(threadId)).guestShare ?? null);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("drops guest attribution that a client sends on its own message", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-message"),
      threadId,
      messageId: MessageId.make("owner-message"),
      text: "Mine",
      context: { version: 1, records: [], guest: { guestMessageId, name: "Sam", text: "Mine" } },
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const projection = yield* projections.getThreadProjection(threadId);
    const sent = projection.messages.find(
      (message) => message.id === MessageId.make("owner-message"),
    );
    assert.isUndefined(sent?.context?.guest);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a queued guest message unchanged when the owner tries to edit it", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-first"),
      threadId,
      messageId: MessageId.make("owner-first"),
      text: "Start",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-share.redeem",
      commandId: CommandId.make("redeem"),
      threadId,
      shareId,
      guestId: sam,
      guestName: "Sam",
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-message.submit",
      commandId: CommandId.make("submit"),
      threadId,
      shareId,
      guestId: sam,
      guestMessageId,
      text: "Why?",
    });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("send-queued"),
      threadId,
      messageId: MessageId.make("send-queued"),
      guestMessageId,
      text: "",
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });
    const queued = (yield* projections.getThreadProjection(threadId)).runs.find(
      (run) => run.status === "queued",
    );
    assert.isDefined(queued);

    const edit = orchestrator.dispatch({
      type: "queued-run.edit",
      commandId: CommandId.make("edit"),
      threadId,
      runId: queued.id,
      text: "My own words",
    });
    assert.isTrue(Exit.isFailure(yield* Effect.exit(edit)));
    const message = (yield* projections.getThreadProjection(threadId)).messages.find(
      (candidate) => candidate.id === MessageId.make("send-queued"),
    );
    assert.equal(message?.context?.guest?.text, "Why?");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("shows a guest message as dismissed when the owner cancels its queued send", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-first"),
      threadId,
      messageId: MessageId.make("owner-first"),
      text: "Start",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-share.redeem",
      commandId: CommandId.make("redeem"),
      threadId,
      shareId,
      guestId: sam,
      guestName: "Sam",
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-message.submit",
      commandId: CommandId.make("submit"),
      threadId,
      shareId,
      guestId: sam,
      guestMessageId,
      text: "Why?",
    });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("send-queued"),
      threadId,
      messageId: MessageId.make("send-queued"),
      guestMessageId,
      text: "",
      attachments: [],
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });
    const queued = (yield* projections.getThreadProjection(threadId)).runs.find(
      (run) => run.status === "queued",
    );
    assert.isDefined(queued);
    yield* orchestrator.dispatch({
      type: "queued-run.cancel",
      commandId: CommandId.make("cancel"),
      threadId,
      runId: queued.id,
    });
    const { thread } = yield* projections.getThreadProjection(threadId);
    assert.equal(
      thread.guestShare?.messages.find((message) => message.id === guestMessageId)?.status,
      "dismissed",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("brings a settled thread back when its guest sends a request", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    const projections = yield* ProjectionStore.ProjectionStoreV2;
    yield* orchestrator.dispatch({
      type: "thread.guest-share.redeem",
      commandId: CommandId.make("redeem"),
      threadId,
      shareId,
      guestId: sam,
      guestName: "Sam",
    });
    yield* orchestrator.dispatch({
      type: "thread.settle",
      commandId: CommandId.make("settle"),
      threadId,
    });
    assert.equal(
      (yield* projections.getThreadProjection(threadId)).thread.settledOverride,
      "settled",
    );
    yield* orchestrator.dispatch({
      type: "thread.guest-message.submit",
      commandId: CommandId.make("submit"),
      threadId,
      shareId,
      guestId: sam,
      guestMessageId,
      text: "Why?",
    });
    const { thread } = yield* projections.getThreadProjection(threadId);
    assert.isNull(thread.settledOverride);
    assert.isNull(thread.settledAt);
  }).pipe(Effect.provide(layerTest)),
);
