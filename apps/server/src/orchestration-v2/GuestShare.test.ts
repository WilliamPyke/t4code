import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ComposerContextId,
  GUEST_PENDING_MESSAGE_LIMIT,
  GUEST_SHARE_MAX_GUESTS,
  GUEST_TURN_LIMIT,
  GuestId,
  GuestTurnRequest,
  GuestMessageId,
  GuestShareId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type OrchestrationV2AppThread,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_REPLIES,
  ROOM_TASK_ANSWER_MAX_LENGTH,
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
const decodeTurn = Schema.decodeUnknownOption(GuestTurnRequest);
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
    // Nor does the agent get any records a client adds, such as a board's cards or artifact.
    context: {
      version: 1,
      records: [
        {
          version: 1,
          contextId: ComposerContextId.make("room-artifact_1"),
          kind: "room-artifact",
          label: 'Artifact "Plan"',
          shareId,
          noteId: "artifact",
          title: "Plan",
        },
        {
          version: 1,
          contextId: ComposerContextId.make("room-cards_1"),
          kind: "room-cards",
          label: "Board · 1 card",
          cards: [{ label: "Note", author: "owner", text: "Do it" }],
        },
      ],
    },
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
    assert.deepEqual(sent?.context?.records, []);
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

it.effect("answers a task with the turn of the guest it is for, and no other card", () =>
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
    let commands = 0;
    const put = (noteId: string, fields: Partial<NotePut> = {}) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: CommandId.make(`board:${commands++}`),
        threadId,
        shareId,
        author: null,
        change: { type: "note.put", noteId, text: "Fix login", x: 0, y: 0, ...fields },
      });
    const post = (guestId: GuestId, id: string, taskId: string, reply = `Done in ${id}.`) =>
      orchestrator.dispatch({
        type: "thread.guest-turn.post",
        commandId: CommandId.make(`turn:${commands++}`),
        threadId,
        shareId,
        guestId,
        turn: { id, prompt: "Fix login", reply, taskId },
      });
    const notes = Effect.map(
      orchestrator.getThreadRecords(threadId, ["runs", "messages"]),
      (records) => ({
        ...records,
        notes: new Map(records.thread.guestShare?.board?.notes.map((note) => [note.id, note])),
      }),
    );
    const answer = (taskId: string, id: string, share = shareId) =>
      orchestrator.dispatch({
        type: "thread.room-task.answer",
        commandId: CommandId.make(`answer:${commands++}`),
        threadId,
        shareId: share,
        taskId,
        turn: { id, reply: `Owner did ${id}.` },
      });
    yield* put("task", { kind: "task", assignee: { guestId: sam } });
    yield* put("open", { kind: "task" });
    yield* put("note");
    yield* put("mine", { kind: "task", assignee: {} });

    // Alex cannot answer Sam's task, and an id that is no task answers nothing; the turns show.
    yield* post(alex, "run:alex", "task");
    yield* post(alex, "run:note", "note");
    yield* post(alex, "run:gone", "gone");
    yield* post(sam, "run:sam", "task", `${"a".repeat(ROOM_TASK_ANSWER_MAX_LENGTH)} the rest`);
    // A task no one has becomes the answering guest's.
    yield* post(alex, "run:open", "open");
    // The owner's own turn answers only a task that is theirs or no one's, on this share.
    yield* answer("task", "run:owner-sam");
    yield* answer("note", "run:owner-note");
    yield* answer("mine", "run:owner-old", GuestShareId.make("share:old"));
    yield* answer("mine", "run:owner");
    yield* answer("mine", "run:owner");
    const after = yield* notes;
    assert.deepEqual(after.notes.get("mine"), {
      id: "mine",
      text: "Fix login",
      x: 0,
      y: 0,
      kind: "task",
      done: true,
      assignee: {},
      answer: { excerpt: "Owner did run:owner.", turnId: "run:owner" },
    });
    assert.lengthOf(after.thread.guestShare?.turns ?? [], 5);
    assert.isUndefined(after.notes.get("note")?.answer);
    const task = after.notes.get("task");
    assert.deepEqual(
      [task?.done, task?.assignee, task?.answer?.guestId],
      [true, { guestId: sam }, sam],
    );
    assert.equal(task?.answer?.excerpt.length, ROOM_TASK_ANSWER_MAX_LENGTH);
    assert.isTrue(task?.answer?.excerpt.endsWith("…"));
    assert.deepEqual(after.notes.get("open")?.answer, {
      guestId: alex,
      excerpt: "Done in run:open.",
      turnId: "run:open",
    });
    assert.deepEqual(after.notes.get("open")?.assignee, { guestId: alex });
    // The turn keeps no task id, and nothing reached the owner's agent.
    assert.notInclude(JSON.stringify(after.thread.guestShare?.turns), "taskId");
    assert.lengthOf(after.runs, 0);
    assert.lengthOf(after.messages, 0);

    // People can untick an answered task, and edit it, and it stays answered.
    yield* put("task", { text: "Fix login, again", done: false });
    const reopened = (yield* notes).notes.get("task");
    assert.deepEqual([reopened?.done, reopened?.answer?.turnId], [undefined, "run:sam"]);

    // A guest's machine names its branch only as git would take it, so the room shows it safely.
    const withBranch = (branch: string) =>
      decodeTurn({ id: "run:x", prompt: "", reply: "Done.", code: { branch, synced: true } });
    assert.isTrue(Option.isSome(withBranch("feature/login-fix")));
    const unsafe = ["-rf", "a b", "a..b", "x.lock", "$(id)~1", "x".repeat(201)];
    for (const branch of [...unsafe, `a${String.fromCharCode(0x202e)}b`]) {
      assert.isTrue(Option.isNone(withBranch(branch)), branch);
    }

    // A removed guest's answers go with them.
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-alex"),
      threadId,
      guestId: alex,
    });
    const removed = (yield* notes).notes.get("open");
    assert.deepEqual([removed?.answer, removed?.assignee], [undefined, undefined]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("fills an artifact card with the owner's turn, and nothing else on the board", () =>
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
    let commands = 0;
    const put = (author: GuestId | null, noteId: string, fields: Partial<NotePut> = {}) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: CommandId.make(`board:${commands++}`),
        threadId,
        shareId,
        author,
        change: { type: "note.put", noteId, text: "Plan", x: 0, y: 0, ...fields },
      });
    const fill = (noteId: string, turnId: string, share = shareId, askedBy?: GuestId) =>
      orchestrator.dispatch({
        type: "thread.room-artifact.fill",
        commandId: CommandId.make(`fill:${commands++}`),
        threadId,
        shareId: share,
        noteId,
        turnId,
        body: `# Plan from ${turnId}`,
        ...(askedBy === undefined ? {} : { askedBy }),
      });
    const read = Effect.map(
      orchestrator.getThreadRecords(threadId, ["runs", "messages"]),
      (records) => ({
        ...records,
        notes: new Map(records.thread.guestShare?.board?.notes.map((note) => [note.id, note])),
      }),
    );
    // A guest can add an artifact card; only the owner's server fills one.
    yield* put(sam, "artifact", { kind: "artifact" });
    yield* put(null, "note");
    yield* fill("note", "run:note");
    yield* fill("gone", "run:gone");
    yield* fill("artifact", "run:old", GuestShareId.make("share:old"));
    yield* fill("artifact", "run:1");
    const first = yield* read;
    const artifact = first.notes.get("artifact")?.artifact;
    assert.deepEqual(
      [artifact?.body, artifact?.turnId, artifact?.truncated],
      ["# Plan from run:1", "run:1", undefined],
    );
    assert.isUndefined(first.notes.get("note")?.artifact);
    // The same turn again changes nothing; a later one replaces it.
    yield* fill("artifact", "run:1");
    assert.deepEqual((yield* read).notes.get("artifact")?.artifact, artifact);
    // Anyone may rename or resize the card; its content stays.
    yield* put(sam, "artifact", { text: "The plan", size: { w: 480, h: 360 } });
    const renamed = (yield* read).notes.get("artifact");
    assert.deepEqual(
      [renamed?.text, renamed?.size, renamed?.artifact],
      ["The plan", { w: 480, h: 360 }, artifact],
    );
    yield* orchestrator.dispatch({
      type: "thread.room-artifact.fill",
      commandId: CommandId.make(`fill:${commands++}`),
      threadId,
      shareId,
      noteId: "artifact",
      turnId: "run:2",
      body: "# Plan from run:2",
      askedBy: alex,
      prompt: "Make it dark",
      cards: ["Note from Sam"],
      boxId: "box:1",
      model: "GPT-5.1 Codex",
    });
    const second = (yield* read).notes.get("artifact")?.artifact;
    // It says what made it: the prompt, the cards with it, the box it came from, and the model.
    assert.deepInclude(second, {
      prompt: "Make it dark",
      cards: ["Note from Sam"],
      boxId: "box:1",
      model: "GPT-5.1 Codex",
    });
    // The version it replaced is kept, without its own earlier one, and says who asked for it.
    assert.deepEqual(
      [second?.body, second?.askedBy, second?.previous],
      ["# Plan from run:2", alex, artifact],
    );
    // A guest's own agent fills it from their machine; a card not on this board takes nothing.
    const post = (id: string, noteId: string) =>
      orchestrator.dispatch({
        type: "thread.guest-turn.post",
        commandId: CommandId.make(`turn:${commands++}`),
        threadId,
        shareId,
        guestId: sam,
        turn: { id, prompt: "Redo it", reply: "Short.", artifact: { noteId, body: `# ${id}` } },
      });
    yield* post("run:sam", "artifact");
    yield* post("run:elsewhere", "note:of-another-share");
    yield* post("run:note", "note");
    const bySam = (yield* read).notes.get("artifact")?.artifact;
    assert.deepEqual(
      [bySam?.body, bySam?.guestId, bySam?.turnId, bySam?.previous?.body],
      ["# run:sam", sam, "run:sam", "# Plan from run:2"],
    );
    assert.isUndefined((yield* read).notes.get("note")?.artifact);
    // Anyone may go back to the version it replaced, and forward again.
    const restore = (author: GuestId | null) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: CommandId.make(`board:${commands++}`),
        threadId,
        shareId,
        author,
        change: { type: "artifact.restore", noteId: "artifact" },
      });
    yield* restore(sam);
    const restored = (yield* read).notes.get("artifact")?.artifact;
    assert.deepEqual(
      [restored?.body, restored?.guestId, restored?.previous?.body],
      ["# Plan from run:2", undefined, "# run:sam"],
    );
    yield* restore(null);
    assert.deepEqual((yield* read).notes.get("artifact")?.artifact, bySam);
    // A turn whose version is the one kept, answered again, does not write it back.
    yield* fill("artifact", "run:2", shareId, alex);
    assert.deepEqual((yield* read).notes.get("artifact")?.artifact, bySam);
    // The room keeps the guest's turn at its own length, without the artifact.
    const turns = (yield* read).thread.guestShare?.turns ?? [];
    assert.notInclude(JSON.stringify(turns), "noteId");
    // Shown only: nothing for the agent, and no run.
    const after = yield* read;
    assert.lengthOf(after.runs, 0);
    assert.lengthOf(after.messages, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("posts an agent's answer in its comment thread once per run, as whose agent it was", () =>
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
    let commands = 0;
    const change = (author: GuestId | null, change: RoomBoardChange) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: CommandId.make(`board:${commands++}`),
        threadId,
        shareId,
        author,
        change,
      });
    const answer = (noteId: string, turnId: string, share = shareId) =>
      orchestrator.dispatch({
        type: "thread.room-comment.answer",
        commandId: CommandId.make(`answer:${commands++}`),
        threadId,
        shareId: share,
        noteId,
        turnId,
        text: `Answer from ${turnId}`,
        boxId: "thread",
        model: "GPT-5.1 Codex",
      });
    const repliesOf = (noteId: string) =>
      Effect.map(
        orchestrator.getThreadRecords(threadId, []),
        ({ thread }) =>
          thread.guestShare?.board?.notes.find((note) => note.id === noteId)?.replies ?? [],
      );
    yield* change(sam, {
      type: "note.put",
      noteId: "c",
      text: "Is it fixed?",
      x: 0,
      y: 0,
      kind: "comment",
    });
    yield* change(null, { type: "note.put", noteId: "note", text: "Plain", x: 0, y: 0 });
    yield* change(sam, {
      type: "note.put",
      noteId: "box",
      text: "Sam's",
      x: 0,
      y: 0,
      kind: "thread",
    });
    yield* answer("c", "run:1");
    yield* answer("c", "run:1");
    // Not a comment thread, no such card, or another share's: nothing is posted.
    yield* answer("note", "run:2");
    yield* answer("gone", "run:3");
    yield* answer("c", "run:4", GuestShareId.make("share:old"));
    const once = yield* repliesOf("c");
    assert.lengthOf(once, 1);
    assert.deepInclude(once[0], {
      text: "Answer from run:1",
      agent: { turnId: "run:1", boxId: "thread", model: "GPT-5.1 Codex" },
    });
    assert.isUndefined(once[0]?.guestId);
    assert.lengthOf(yield* repliesOf("note"), 0);
    // A resolved thread still takes an answer.
    yield* change(null, { type: "comment.resolve", noteId: "c", resolved: true });
    yield* answer("c", "run:5");
    assert.lengthOf(yield* repliesOf("c"), 2);
    // A guest's machine answers only from their own box, as their agent.
    const post = (id: string, boxId: string | undefined) =>
      orchestrator.dispatch({
        type: "thread.guest-turn.post",
        commandId: CommandId.make(`turn:${commands++}`),
        threadId,
        shareId,
        guestId: sam,
        turn: {
          id,
          prompt: "Is it?",
          reply: "Yes.",
          ...(boxId === undefined ? {} : { boxId, model: "Haiku" }),
          comment: { noteId: "c", text: "Yes, it is fixed." },
        },
      });
    yield* post("run:sam", "box");
    yield* post("run:sam", "box");
    yield* post("run:loose", undefined);
    yield* post("run:owners", "thread");
    const bySam = (yield* repliesOf("c")).slice(2);
    assert.lengthOf(bySam, 1);
    assert.deepInclude(bySam[0], {
      text: "Yes, it is fixed.",
      guestId: sam,
      agent: { turnId: "run:sam", boxId: "box", model: "Haiku" },
    });
    // A full thread takes no more.
    for (let index = (yield* repliesOf("c")).length; index < ROOM_BOARD_MAX_REPLIES; index++) {
      yield* change(null, { type: "comment.reply", noteId: "c", replyId: `r${index}`, text: "Hi" });
    }
    yield* answer("c", "run:late");
    const full = yield* repliesOf("c");
    assert.lengthOf(full, ROOM_BOARD_MAX_REPLIES);
    assert.notInclude(JSON.stringify(full), "run:late");
    // Deleted meanwhile: nothing, silently.
    yield* change(sam, { type: "note.remove", noteId: "c" });
    yield* answer("c", "run:after");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("shows a thread box's last turns, and keeps the owner's box threads apart", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    let commands = 0;
    const next = (label: string) => CommandId.make(`${label}:${commands++}`);
    const change = (change: RoomBoardChange) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: next("board"),
        threadId,
        shareId,
        author: null,
        change,
      });
    const link = (boxId: string, boxThreadId: string | null) =>
      orchestrator.dispatch({
        type: "thread.room-box.link",
        commandId: next("link"),
        threadId,
        shareId,
        boxId,
        boxThreadId: boxThreadId === null ? null : ThreadId.make(boxThreadId),
      });
    const turn = (boxId: string, id: string) =>
      orchestrator.dispatch({
        type: "thread.room-box.turn",
        commandId: next("turn"),
        threadId,
        shareId,
        boxId,
        turn: { id, prompt: "Go", reply: `Reply ${id}`, at: "2026-11-12T00:00:00.000Z" },
      });
    const share = Effect.map(
      orchestrator.getThreadRecords(threadId, []),
      ({ thread }) => thread.guestShare!,
    );
    const turnsOf = (boxId: string) =>
      Effect.map(share, (current) =>
        current.board?.notes.find((note) => note.id === boxId)?.thread?.turns.map((t) => t.id),
      );
    yield* change({ type: "note.put", noteId: "box", text: "Box", x: 0, y: 0, kind: "thread" });
    yield* change({ type: "note.put", noteId: "note", text: "Note", x: 0, y: 0 });
    // Only a box on the board gets a thread.
    assert.isTrue(Exit.isFailure(yield* Effect.exit(link("gone", "thread:gone"))));
    yield* link("box", "thread:box");
    yield* link("box", "thread:box");
    assert.deepEqual((yield* share).boardThreads, { box: ThreadId.make("thread:box") });

    for (const id of ["run:1", "run:2", "run:2", "run:3", "run:4"]) yield* turn("box", id);
    // A box keeps its last few turns, each once; a note that is no box shows none.
    assert.deepEqual(yield* turnsOf("box"), ["run:2", "run:3", "run:4"]);
    yield* turn("note", "run:5");
    assert.isUndefined(yield* turnsOf("note"));
    // Renaming the box keeps its turns and its thread.
    yield* change({ type: "note.put", noteId: "box", text: "Renamed", x: 9, y: 9 });
    assert.deepEqual(yield* turnsOf("box"), ["run:2", "run:3", "run:4"]);
    assert.deepEqual((yield* share).boardThreads, { box: ThreadId.make("thread:box") });
    // Removing the box forgets its thread; unlinking one with none changes nothing.
    yield* change({ type: "note.remove", noteId: "box" });
    assert.isUndefined((yield* share).boardThreads);
    yield* link("box", null);

    // An existing thread lands as a new box and its link at once, showing its last turn.
    const add = (boxId: string, boxThreadId: string) =>
      orchestrator.dispatch({
        type: "thread.room-box.link",
        commandId: next("add"),
        threadId,
        shareId,
        boxId,
        boxThreadId: ThreadId.make(boxThreadId),
        box: {
          text: "Existing",
          x: 1,
          y: 2,
          turn: { id: "run:old", prompt: "Old", reply: "Done", at: "2026-11-12T00:00:00.000Z" },
        },
      });
    yield* add("existing", "thread:existing");
    assert.deepInclude(
      (yield* share).board?.notes.find((note) => note.id === "existing"),
      {
        kind: "thread",
        text: "Existing",
        x: 1,
        y: 2,
      },
    );
    assert.deepEqual(yield* turnsOf("existing"), ["run:old"]);
    assert.deepEqual((yield* share).boardThreads, {
      existing: ThreadId.make("thread:existing"),
    });
    // Not the same thread on a second box, and not over a card already there.
    assert.isTrue(Exit.isFailure(yield* Effect.exit(add("again", "thread:existing"))));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(add("note", "thread:other"))));
    yield* change({ type: "note.remove", noteId: "existing" });
    assert.isUndefined((yield* share).boardThreads);

    // A guest's request for their box is marked sent as the message it went as, and put back
    // to waiting only if that send failed.
    yield* orchestrator.dispatch({
      type: "thread.guest-share.redeem",
      commandId: next("redeem"),
      threadId,
      shareId,
      guestId: sam,
      guestName: "Sam",
    });
    yield* change({ type: "note.put", noteId: "sam-box", text: "Sam", x: 0, y: 0, kind: "thread" });
    const submit = (boxId: string, author: GuestId) =>
      orchestrator.dispatch({
        type: "thread.guest-message.submit",
        commandId: next("submit"),
        threadId,
        shareId,
        guestId: author,
        guestMessageId,
        text: "Dark mode",
        boxId,
      });
    // The owner's box is not Sam's to send to.
    yield* orchestrator.dispatch({
      type: "thread.guest-board.change",
      commandId: next("board"),
      threadId,
      shareId,
      author: sam,
      change: { type: "note.put", noteId: "his", text: "His", x: 0, y: 0, kind: "thread" },
    });
    assert.isTrue(Exit.isFailure(yield* Effect.exit(submit("sam-box", sam))));
    yield* submit("his", sam);
    const route = (sentAs: string | null) =>
      orchestrator.dispatch({
        type: "thread.guest-message.route",
        commandId: next("route"),
        threadId,
        guestMessageId,
        sentAs: sentAs === null ? null : MessageId.make(sentAs),
      });
    const message = Effect.map(share, (current) => current.messages[0]);
    yield* route("message:box");
    assert.deepInclude(yield* message, {
      status: "sent",
      sentAs: MessageId.make("message:box"),
      boxId: "his",
    });
    assert.isTrue(Exit.isFailure(yield* Effect.exit(route("message:again"))));
    yield* route(null);
    const back = yield* message;
    assert.equal(back?.status, "pending");
    assert.isUndefined(back?.sentAs);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("sends a guest's message for an artifact with the card as this board has it", () =>
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
    let commands = 0;
    const board = (change: RoomBoardChange) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: CommandId.make(`board:${commands++}`),
        threadId,
        shareId,
        author: null,
        change,
      });
    const put = (noteId: string, fields: Partial<NotePut> = {}) =>
      board({ type: "note.put", noteId, text: "Plan", x: 0, y: 0, ...fields });
    const submit = (id: GuestMessageId, artifactId: string) =>
      orchestrator.dispatch({
        type: "thread.guest-message.submit",
        commandId: CommandId.make(`submit:${commands++}`),
        threadId,
        shareId,
        guestId: sam,
        guestMessageId: id,
        text: "Make it blue",
        artifactId,
      });
    yield* put("plan", { kind: "artifact" });
    yield* put("later", { kind: "artifact", text: "Later" });
    yield* put("note");
    yield* orchestrator.dispatch({
      type: "thread.room-artifact.fill",
      commandId: CommandId.make("fill:plan"),
      threadId,
      shareId,
      noteId: "plan",
      turnId: "run:0",
      body: "# The plan",
    });
    // Only a card that is an artifact on this board can be named.
    for (const artifactId of ["note", "gone"]) {
      const refused = yield* Effect.exit(
        submit(GuestMessageId.make(`m:${artifactId}`), artifactId),
      );
      assert.isTrue(Exit.isFailure(refused));
    }
    yield* submit(guestMessageId, "plan");
    const waiting = (yield* orchestrator.getThreadRecords(threadId, [])).thread.guestShare
      ?.messages[0];
    assert.equal(waiting?.artifactId, "plan");

    // The client's records are dropped; the card comes from the board when the owner sends.
    yield* sendGuestMessage(orchestrator, "send-plan");
    const sentOf = (id: string) =>
      Effect.map(orchestrator.getThreadRecords(threadId, ["messages"]), ({ messages }) =>
        messages.find((message) => message.id === MessageId.make(id)),
      );
    const sent = yield* sentOf("send-plan");
    const records = sent?.context?.records ?? [];
    assert.lengthOf(records, 1);
    assert.deepInclude(records[0], {
      kind: "room-artifact",
      shareId,
      noteId: "plan",
      title: "Plan",
      current: "# The plan",
    });
    assert.isTrue(
      sent?.text.startsWith(
        'Message from guest Sam, sent by the owner:\n\nMake it blue\n\n[Artifact "Plan"](t3-context://v1/room-artifact/',
      ),
    );
    assert.equal(sent?.context?.guest?.text, "Make it blue");

    // A card removed before the owner sends leaves a plain message.
    const later = GuestMessageId.make("guest-message:later");
    yield* submit(later, "later");
    yield* board({ type: "note.remove", noteId: "later" });
    yield* sendGuestMessage(orchestrator, "send-later", later);
    const plain = yield* sentOf("send-later");
    assert.deepEqual(plain?.context?.records, []);
    assert.equal(plain?.text, "Message from guest Sam, sent by the owner:\n\nMake it blue");
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
    yield* change(alex, { type: "card.resize", cardId: `agent:${sam}`, w: 300, h: 200 });
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
      sizes: { [`agent:${sam}`]: { w: 300, h: 200 } },
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
    assert.deepEqual(after?.sizes, {});
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

    // Anyone in the room replies on a comment thread. The server signs and times each reply,
    // whatever the client sent.
    yield* change(sam, put("talk", { kind: "comment", text: "Ship it?" }));
    const forged = decodeChange({
      type: "comment.reply",
      noteId: "talk",
      replyId: "reply:alex",
      text: "Not yet",
      guestId: sam,
      at: "2000-01-01T00:00:00.000Z",
    });
    yield* change(alex, Option.getOrThrow(forged));
    yield* change(sam, {
      type: "comment.reply",
      noteId: "talk",
      replyId: "reply:sam",
      text: "Why?",
    });
    const now = DateTime.formatIso(yield* DateTime.now);
    const repliesOf = Effect.map(
      board,
      ({ board }) => board?.notes.find((note) => note.id === "talk")?.replies,
    );
    assert.deepEqual(yield* repliesOf, [
      { id: "reply:alex", text: "Not yet", guestId: alex, at: now },
      { id: "reply:sam", text: "Why?", guestId: sam, at: now },
    ]);

    // A reaction is its sender's: one naming someone else is still Alex's own.
    const forgedReaction = decodeChange({
      type: "note.react",
      noteId: "task",
      emoji: "👍",
      guestId: sam,
    });
    yield* change(alex, Option.getOrThrow(forgedReaction));
    yield* change(sam, { type: "note.react", noteId: "task", emoji: "👍" });
    yield* change(null, { type: "note.react", noteId: "task", emoji: "🎉" });
    const reactionsOf = Effect.map(
      board,
      ({ board }) => board?.notes.find((note) => note.id === "task")?.reactions,
    );
    assert.deepEqual(yield* reactionsOf, [
      { emoji: "👍", guestId: alex },
      { emoji: "👍", guestId: sam },
      { emoji: "🎉" },
    ]);
    assert.isTrue(yield* refused(change(sam, { type: "note.react", noteId: "talk", emoji: "👀" })));

    // A removed guest's cards, comments, replies, reactions and arrows go; tasks they had are left
    // with no one.
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
      ["task", "owner-task", "talk"],
    );
    assert.deepEqual(yield* repliesOf, [{ id: "reply:sam", text: "Why?", guestId: sam, at: now }]);
    assert.deepEqual(yield* reactionsOf, [{ emoji: "👍", guestId: sam }, { emoji: "🎉" }]);
    assert.isUndefined(after?.notes[0]?.assignee);
    assert.deepEqual(after?.edges, []);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps the board across links, with what departed guests added named and nobody's", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    let commands = 0;
    const next = (label: string) => CommandId.make(`${label}:${commands++}`);
    const join = (share: GuestShareId, guestId: GuestId, guestName: string) =>
      orchestrator.dispatch({
        type: "thread.guest-share.redeem",
        commandId: next("redeem"),
        threadId,
        shareId: share,
        guestId,
        guestName,
      });
    const change = (share: GuestShareId, author: GuestId | null, change: RoomBoardChange) =>
      orchestrator.dispatch({
        type: "thread.guest-board.change",
        commandId: next("board"),
        threadId,
        shareId: share,
        author,
        change,
      });
    const open = (share: GuestShareId) =>
      Effect.flatMap(DateTime.now, (now) =>
        orchestrator.dispatch({
          type: "thread.guest-share.open",
          commandId: next("open"),
          threadId,
          shareId: share,
          host: "env.t3.test",
          expiresAt: DateTime.formatIso(DateTime.add(now, { hours: 24 })),
        }),
      );
    const thread = Effect.map(orchestrator.getThreadRecords(threadId, []), (r) => r.thread);
    const refused = (command: ReturnType<typeof change>) =>
      Effect.map(Effect.exit(command), Exit.isFailure);

    yield* join(shareId, sam, "Sam");
    yield* join(shareId, alex, "Alex");
    yield* change(shareId, sam, { type: "note.put", noteId: "sam", text: "Ship", x: 1, y: 2 });
    yield* change(shareId, null, { type: "note.put", noteId: "owner", text: "Wait", x: 3, y: 4 });
    yield* change(shareId, sam, { type: "note.react", noteId: "owner", emoji: "👍" });
    yield* change(shareId, alex, {
      type: "note.put",
      noteId: "talk",
      text: "Why?",
      x: 5,
      y: 6,
      kind: "comment",
    });
    yield* change(shareId, sam, {
      type: "comment.reply",
      noteId: "talk",
      replyId: "r1",
      text: "Because",
    });
    yield* change(shareId, sam, { type: "card.move", cardId: `guest:${sam}`, x: 7, y: 8 });
    yield* change(shareId, null, {
      type: "edge.put",
      edgeId: "e1",
      from: `card:guest:${sam}`,
      to: "note:owner",
    });
    yield* change(shareId, alex, {
      type: "note.put",
      noteId: "alex-box",
      text: "Alex's box",
      x: 0,
      y: 0,
      kind: "thread",
    });
    yield* orchestrator.dispatch({
      type: "thread.room-box.link",
      commandId: next("link"),
      threadId,
      shareId,
      boxId: "owner-box",
      boxThreadId: ThreadId.make("thread:owner-box"),
      box: { text: "Mine", x: 0, y: 0 },
    });
    yield* orchestrator.dispatch({
      type: "thread.room-box.link",
      commandId: next("link"),
      threadId,
      shareId,
      boxId: "alex-box",
      boxThreadId: ThreadId.make("thread:alex-box"),
    });

    // Replacing the link: the new share has the board, and the old guests are gone from it.
    const second = GuestShareId.make("share:two");
    yield* open(second);
    const replaced = (yield* thread).guestShare!;
    assert.deepEqual(
      replaced.board?.notes.map((note) => note.id),
      ["sam", "owner", "talk", "alex-box", "owner-box"],
    );
    assert.deepEqual(replaced.board?.people, [
      { guestId: sam, name: "Sam" },
      { guestId: alex, name: "Alex" },
    ]);
    assert.isUndefined(replaced.board?.positions[`guest:${sam}`]);
    assert.deepEqual(replaced.board?.edges, []);
    // Only the owner's box keeps its thread: a departed guest's box takes no more prompts.
    assert.deepEqual(replaced.boardThreads, { "owner-box": ThreadId.make("thread:owner-box") });

    // Someone new, even under the same name, owns nothing that Sam added.
    const newSam = GuestId.make("guest:new-sam");
    yield* join(second, newSam, "Sam");
    assert.isTrue(yield* refused(change(second, newSam, { type: "note.remove", noteId: "sam" })));
    assert.isTrue(
      yield* refused(
        change(second, newSam, { type: "comment.reply.remove", noteId: "talk", replyId: "r1" }),
      ),
    );
    assert.isTrue(
      yield* refused(
        change(second, newSam, {
          type: "note.put",
          noteId: "talk",
          text: "Mine now",
          x: 5,
          y: 6,
        }),
      ),
    );
    // A departed guest is not in the room: a task cannot go to them.
    assert.isTrue(
      yield* refused(
        change(second, null, {
          type: "note.put",
          noteId: "task",
          text: "Do it",
          x: 0,
          y: 0,
          kind: "task",
          assignee: { guestId: sam },
        }),
      ),
    );
    yield* change(second, null, { type: "note.remove", noteId: "sam" });

    // Stopping sharing keeps the board on the thread, and sharing again brings it back.
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: next("close"),
      threadId,
    });
    const stopped = yield* thread;
    assert.isNull(stopped.guestShare ?? null);
    assert.deepEqual(
      stopped.roomBoard?.board.notes.map((note) => note.id),
      ["owner", "talk", "alex-box", "owner-box"],
    );
    // The second link's Sam left nothing, so only the first link's people are named.
    assert.deepEqual(
      stopped.roomBoard?.board.people?.map((person) => person.guestId),
      [sam, alex],
    );
    const third = GuestShareId.make("share:three");
    yield* open(third);
    const reopened = yield* thread;
    assert.isNull(reopened.roomBoard ?? null);
    assert.deepEqual(
      reopened.guestShare?.board?.notes.map((note) => note.id),
      ["owner", "talk", "alex-box", "owner-box"],
    );
    assert.deepEqual(reopened.guestShare?.boardThreads, {
      "owner-box": ThreadId.make("thread:owner-box"),
    });

    // Clearing empties the board, and clearing an empty one is no error.
    yield* orchestrator.dispatch({
      type: "thread.room-board.clear",
      commandId: next("clear"),
      threadId,
    });
    yield* orchestrator.dispatch({
      type: "thread.room-board.clear",
      commandId: next("clear"),
      threadId,
    });
    const cleared = (yield* thread).guestShare;
    assert.isUndefined(cleared?.board);
    assert.isUndefined(cleared?.boardThreads);
    assert.strictEqual(cleared?.id, third);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("keeps a board through archiving, and clears one kept while not shared", () =>
  Effect.gen(function* () {
    const orchestrator = yield* setup;
    yield* orchestrator.dispatch({
      type: "thread.guest-board.change",
      commandId: CommandId.make("board:archive"),
      threadId,
      shareId,
      author: null,
      change: { type: "note.put", noteId: "kept", text: "Kept", x: 0, y: 0 },
    });
    yield* orchestrator.dispatch({
      type: "thread.archive",
      commandId: CommandId.make("archive:board"),
      threadId,
    });
    const archived = (yield* orchestrator.getThreadRecords(threadId, [])).thread;
    assert.deepEqual(
      archived.roomBoard?.board.notes.map((note) => note.id),
      ["kept"],
    );
    yield* orchestrator.dispatch({
      type: "thread.room-board.clear",
      commandId: CommandId.make("clear:kept"),
      threadId,
    });
    assert.isNull((yield* orchestrator.getThreadRecords(threadId, [])).thread.roomBoard ?? null);
  }).pipe(Effect.provide(layerTest)),
);

it("extends a guest link that is still open, only to a later end", () => {
  const now = DateTime.makeUnsafe("2026-11-12T00:00:00.000Z");
  const share = {
    id: shareId,
    host: "env.t3.test",
    createdAt: "2026-11-11T12:00:00.000Z",
    expiresAt: "2026-11-12T12:00:00.000Z",
    guestName: null,
    guests: [{ id: sam, name: "Sam", joinedAt: "2026-11-11T12:00:00.000Z" }],
    messages: [],
  };
  const extend = (guestShare: object, expiresAt: string, at = now) =>
    decideGuestShareCommand({
      thread: { guestShare } as unknown as OrchestrationV2AppThread,
      now: at,
      command: {
        type: "thread.guest-share.extend",
        commandId: CommandId.make("extend"),
        threadId,
        shareId,
        expiresAt,
      },
    });
  const later = "2026-11-19T00:00:00.000Z";
  const extended = extend(share, later);
  assert.isTrue(Result.isSuccess(extended));
  if (Result.isSuccess(extended)) {
    assert.strictEqual(extended.success.guestShare?.expiresAt, later);
    assert.isTrue(extended.success.guestShare?.extended);
    // Everyone on it stays.
    assert.deepEqual(extended.success.guestShare?.guests, share.guests);
  }
  assert.isTrue(Result.isFailure(extend(share, "2026-11-12T06:00:00.000Z")));
  assert.isTrue(
    Result.isFailure(extend(share, later, DateTime.makeUnsafe("2026-11-12T12:00:00.000Z"))),
  );
  assert.isTrue(Result.isFailure(extend({ ...share, joinsClosed: true }, later)));
  assert.isTrue(Result.isFailure(extend({ ...share, team: { id: "t", name: "Team" } }, later)));
  assert.isTrue(Result.isFailure(extend({ ...share, id: "share:other" }, later)));
});

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
