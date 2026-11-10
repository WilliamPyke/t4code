import { assert, it } from "@effect/vitest";
import {
  CommandId,
  GUEST_PENDING_MESSAGE_LIMIT,
  GUEST_SHARE_MAX_GUESTS,
  GuestId,
  GuestMessageId,
  GuestShareId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
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
