import * as NodeURL from "node:url";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import {
  ChatAttachmentId,
  CommandId,
  EventId,
  type GuestAccount,
  type GuestId,
  GuestShareId,
  type GuestShareView,
  type GuestStreamEvent,
  MessageId,
  type OrchestrationV2ThreadHistoryPage,
  type OrchestrationV2TurnItem,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  RunId,
  type ServerProvider,
  ThreadId,
  type VcsStatusResult,
  TurnItemId,
} from "@t3tools/contracts";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import type * as ProviderAdapter from "@t3tools/provider-core/server/ProviderAdapter";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import {
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
  sweepStalePendingAttachments,
} from "../attachmentStore.ts";
import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as GuestLinkNames from "./GuestLinkNames.ts";
import * as GuestTeamShares from "./GuestTeamShares.ts";
import * as GuestSignIn from "./GuestSignIn.ts";
import { CloudManagedEndpointRuntime } from "../cloud/ManagedEndpointRuntime.ts";
import * as ServerConfig from "../config.ts";
import * as SqlitePersistence from "../persistence/Sqlite.ts";
import { CodexProviderCapabilitiesV2 } from "../orchestration-v2/Adapters/CodexAdapterV2.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as CommandOutputHub from "../orchestration-v2/CommandOutputHub.ts";
import * as EffectOutbox from "../orchestration-v2/EffectOutbox.ts";
import * as EffectWorker from "../orchestration-v2/EffectWorker.ts";
import * as EventSink from "../orchestration-v2/EventSink.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectionStore from "../orchestration-v2/ProjectionStore.ts";
import * as ProviderAdapterRegistry from "../orchestration-v2/ProviderAdapterRegistry.ts";
import * as ResourceCleanupService from "../orchestration-v2/ResourceCleanupService.ts";
import * as ProviderReplayHarness from "../orchestration-v2/testkit/ProviderReplayHarness.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as GuestShareService from "./GuestShareService.ts";
import * as RoomBoxes from "./RoomBoxes.ts";

const instanceId = ProviderInstanceId.make("codex");
const adapter = {
  instanceId,
  driver: ProviderDriverKind.make("codex"),
  getCapabilities: () => Effect.succeed(CodexProviderCapabilitiesV2),
  planSelectionTransition: () => Effect.succeed({ type: "apply_on_next_turn" as const }),
  openSession: () => Effect.die("No provider process needed for guest shares"),
} as ProviderAdapter.ProviderAdapterV2["Service"];
const layerDatabase = SqlitePersistence.layerMemory;
const layerOrchestration = Layer.mergeAll(
  layerDatabase,
  ProjectionStore.layer.pipe(Layer.provide(layerDatabase)),
  EffectOutbox.layer.pipe(Layer.provide(layerDatabase)),
  ProviderReplayHarness.layerWithRegistry(
    { name: "guest-share-service" },
    ProviderAdapterRegistry.layerFromAdapters([adapter]),
    { databaseLayer: layerDatabase, runEffectWorker: false },
  ),
);

// The Connect hostname the fake tunnel reports. Tests set it to null to simulate an unlink.
const hostname = Ref.makeUnsafe<string | null>("env.t3.test");
const layerConnect = Layer.mock(CloudManagedEndpointRuntime)({
  inspectConnector: Effect.map(Ref.get(hostname), (value) => ({
    pid: 1,
    readyConnections: 1,
    hostname: value,
    protocol: "http2",
  })),
});
// The providers the fake registry reports. Tests set how the thread's provider is signed in.
// The GitHub account the next finished sign-in proves. Null means GitHub refuses the code.
const githubAccount = Ref.makeUnsafe<GuestAccount | null>(null);
// The fake state is the session it was started for, so finishing needs no table.
const layerLinkNames = Layer.mock(GuestLinkNames.GuestLinkNames)({
  register: () => Effect.succeed("tulip-otter-harbor"),
});
// The relay's side of team shares. A fake assertion is `member:<team>:<user>:<name>`; the real
// signature check is GuestTeamShares' own test.
const teamListings = Ref.makeUnsafe<ReadonlyMap<string, string>>(new Map());
// The accounts the relay says have left their team.
const formerMembers = Ref.makeUnsafe<ReadonlySet<string>>(new Set());
const layerTeamShares = Layer.mock(GuestTeamShares.GuestTeamShares)({
  isMember: (_teamId, userId) => Effect.map(Ref.get(formerMembers), (gone) => !gone.has(userId)),
  register: (input) =>
    Ref.update(teamListings, (listed) => new Map(listed).set(input.threadId, input.teamId)).pipe(
      Effect.as(input.teamId === "team-core" ? "Core" : null),
    ),
  unregister: (threadId) =>
    Ref.update(teamListings, (listed) => {
      const next = new Map(listed);
      next.delete(threadId);
      return next;
    }),
  verifyMember: (token) => {
    const [kind, teamId = "", userId = "", name = ""] = token.split(":");
    return Effect.succeed(
      kind === "member"
        ? Option.some({
            iss: "https://relay.test",
            aud: "t3-env:test",
            sub: userId,
            jti: token,
            iat: 0,
            exp: 300,
            teamId,
            userId,
            name,
            avatarUrl: `https://img.test/${userId}.png`,
          })
        : Option.none(),
    );
  },
});
const layerSignIn = Layer.mock(GuestSignIn.GuestSignIn)({
  enabled: true,
  start: ({ session, redirectUri }) =>
    Effect.succeed({ state: Buffer.from(session).toString("base64url"), url: redirectUri }),
  finish: ({ state }) =>
    Effect.flatMap(Ref.get(githubAccount), (account) =>
      account === null
        ? Effect.fail(new GuestSignIn.GuestSignInError({ reason: "failed" }))
        : Effect.succeed({ session: Buffer.from(state, "base64url").toString(), account }),
    ),
});
const providers = Ref.makeUnsafe<ReadonlyArray<ServerProvider>>([]);
const layerProviders = Layer.mock(ProviderRegistry.ProviderRegistry)({
  getProviders: Ref.get(providers),
});
// What git says about the shared thread's checkout. Null means it has no repository to share.
const checkout = Ref.makeUnsafe<{ readonly branch: string; readonly synced: boolean } | null>(null);
const layerCheckout = Layer.mergeAll(
  Layer.mock(ProjectService.ProjectService)({
    getById: () => Effect.succeedSome({ workspaceRoot: "/repo" } as never),
  }),
  Layer.mock(RepositoryIdentityResolver.RepositoryIdentityResolver)({
    resolve: () =>
      Effect.map(Ref.get(checkout), (facts) =>
        facts === null
          ? null
          : {
              canonicalKey: "github.com/acme/app",
              locator: {
                source: "git-remote" as const,
                remoteName: "origin",
                remoteUrl: "https://token@github.com/acme/app.git",
              },
            },
      ),
  }),
  Layer.mock(GitWorkflow.GitWorkflowService)({
    status: () =>
      Effect.map(
        Ref.get(checkout),
        (facts) =>
          ({
            isRepo: facts !== null,
            refName: facts?.branch ?? null,
            hasUpstream: facts?.synced === true,
            aheadCount: 0,
            behindCount: 0,
            hasWorkingTreeChanges: false,
            pr: null,
          }) as VcsStatusResult,
      ),
  }),
);
const layerConfig = ServerConfig.layerTest(process.cwd(), { prefix: "t3-guest-share-" });
// The real cleanup also closes terminals and previews; these tests only need the files gone.
const layerCleanup = Layer.effect(
  ResourceCleanupService.ResourceCleanupService,
  Effect.gen(function* () {
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    return {
      cleanupScheduledTasks: () => Effect.void,
      cleanupTerminals: () => Effect.void,
      cleanupPreviews: () => Effect.void,
      cleanupAttachments: (attachmentIds) =>
        Effect.forEach(
          attachmentIds,
          (attachmentId) => {
            const path = resolveAttachmentPathById({ attachmentsDir, attachmentId });
            return path === null ? Effect.void : fileSystem.remove(path).pipe(Effect.orDie);
          },
          { discard: true },
        ),
    };
  }),
).pipe(
  Layer.provide(layerConfig),
  Layer.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);
class RecordedAnalytics extends Context.Service<
  RecordedAnalytics,
  Ref.Ref<ReadonlyArray<Readonly<Record<string, unknown>>>>
>()("t3/guest/GuestShareService.test/RecordedAnalytics") {}
const layerAnalytics = Layer.effectContext(
  Effect.gen(function* () {
    const recorded = yield* Ref.make<ReadonlyArray<Readonly<Record<string, unknown>>>>([]);
    return Context.make(RecordedAnalytics, recorded).pipe(
      Context.add(
        AnalyticsService.AnalyticsService,
        AnalyticsService.AnalyticsService.of({
          record: (event, properties) =>
            Ref.update(recorded, (events) => [...events, { event, ...properties }]),
          flush: Effect.void,
          recordOwners: () => Effect.void,
        }),
      ),
    );
  }),
);
// Launching is ThreadLaunchService's own test; this makes a box's thread with the same commands.
const layerLaunches = Layer.effect(
  ThreadLaunch.ThreadLaunchService,
  Effect.gen(function* () {
    const orchestrator = yield* Orchestrator.OrchestratorV2;
    return ThreadLaunch.ThreadLaunchService.of({
      launch: (input) =>
        Effect.gen(function* () {
          const threadId = input.threadId ?? ThreadId.make(`thread:${input.commandId}`);
          const strategy = input.workspaceStrategy;
          yield* orchestrator.dispatch({
            type: "thread.create",
            commandId: input.commandId,
            threadId,
            projectId: input.projectId,
            title: input.title,
            modelSelection: input.modelSelection,
            runtimeMode: input.runtimeMode,
            interactionMode: input.interactionMode,
            branch: strategy.branch ?? null,
            worktreePath: strategy.type === "existing_worktree" ? strategy.worktreePath : null,
            createdBy: input.createdBy,
            creationSource: input.creationSource,
          });
          const message = input.initialMessage;
          if (message !== undefined) {
            yield* orchestrator.dispatch({
              type: "message.dispatch",
              commandId: CommandId.make(`${input.commandId}:initial-message`),
              threadId,
              messageId: message.messageId ?? MessageId.make(`${input.commandId}:message`),
              text: message.text,
              attachments: [...message.attachments],
              ...(message.context === undefined ? {} : { context: message.context }),
              modelSelection: input.modelSelection,
              dispatchMode: { type: "queue_after_active" },
              createdBy: input.createdBy,
              creationSource: input.creationSource,
            });
          }
          return {
            threadId,
            projection: yield* orchestrator.getThreadProjection(threadId),
            resumed: false,
          };
        }).pipe(Effect.orDie),
      checkWorktreeBase: () => Effect.void,
      retryPreparation: () => Effect.die("Not used by thread boxes"),
      prepareRun: () => Effect.void,
    });
  }),
);
const layerTest = GuestShareService.layer.pipe(
  Layer.provideMerge(RoomBoxes.layer.pipe(Layer.provide(layerLaunches))),
  Layer.provideMerge(
    CommandOutputHub.layer.pipe(
      Layer.provideMerge(layerOrchestration.pipe(Layer.provide(layerCleanup))),
    ),
  ),
  Layer.provide(layerProviders),
  Layer.provide(layerCheckout),
  Layer.provide(layerSignIn),
  Layer.provide(layerLinkNames),
  Layer.provide(layerTeamShares),
  Layer.provideMerge(ServerSettings.layerTest({ guestSharingEnabled: true })),
  Layer.provide(layerConnect),
  Layer.provideMerge(layerAnalytics),
  Layer.provide(ServerSecretStore.layer),
  Layer.provideMerge(layerConfig),
  Layer.provideMerge(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer)),
);

const threadId = ThreadId.make("thread:guest-share-service");

const shareThreadFor = Effect.fn(function* (
  threadId: ThreadId,
  worktreePath: string | null = null,
  linkStart = "https://env.t3.test/guest#",
) {
  yield* Ref.set(hostname, "env.t3.test");
  yield* Ref.set(providers, []);
  yield* Ref.set(checkout, null);
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "thread.create",
    commandId: CommandId.make(`create:${threadId}`),
    threadId,
    projectId: ProjectId.make("project:guest-share-service"),
    title: "Review me",
    modelSelection: { instanceId, model: "gpt-5.1-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath,
    createdBy: "user",
    creationSource: "web",
  });
  const guestShares = yield* GuestShareService.GuestShareService;
  const { url } = yield* guestShares.create({ threadId });
  assert.isTrue(url.startsWith(linkStart));
  const credential = url.slice(url.indexOf("#") + 1);
  return { orchestrator, guestShares, credential };
});
const shareThread = shareThreadFor(threadId);

it.effect("lets each browser join an invite as its own guest until the owner stops sharing", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const eve = yield* guestShares.redeem({ credential, name: "Eve" });
    assert.notEqual(eve.token, session);
    const taken = yield* Effect.flip(guestShares.redeem({ credential, name: "sam" }));
    assert.equal(taken.reason, "name_taken");
    // Each guest's page names them, lists everyone, and shows what the others asked.
    yield* guestShares.submit(session, { shareId: eve.shareId, text: "Sam's question" }, []);
    yield* (yield* ServerSettings.ServerSettingsService).updateSettings({
      guestOwnerName: "  Will  ",
    });
    const [eveView] = Array.from(
      yield* Stream.runCollect(Stream.take(yield* guestShares.stream(eve.token), 1)),
    );
    if (eveView?.type !== "view") return assert.fail("Expected the share view first.");
    assert.equal(eveView.view.guestName, "Eve");
    assert.equal(eveView.view.ownerName, "Will");
    assert.deepEqual(
      eveView.view.guests.map((guest) => guest.name),
      ["Sam", "Eve"],
    );
    const [asked] = eveView.view.messages;
    assert.equal(asked?.text, "Sam's question");
    assert.notEqual(asked?.guestId, eveView.view.guestId);
    // The browser that joined can come back without joining again.
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(session))));
    // An invite token is not a session token.
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.stream(credential))));

    const events = yield* guestShares.stream(session);
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-guest-share"),
      threadId,
    });
    const received = Array.from(yield* Stream.runCollect(events));
    assert.deepEqual(
      received
        .filter((event) => !["presence", "agents", "cursors"].includes(event.type))
        .map((event) => (event.type === "thread" ? event.item.kind : event.type)),
      ["view", "snapshot", "ended"],
    );
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.stream(session))));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.check(session))));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.check(eve.token))));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("says who has the page open, and ends the page of a guest the owner removes", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const eve = yield* guestShares.redeem({ credential, name: "Eve" });
    const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
    const [samId, eveId] = thread.guestShare!.guests!.map((guest) => guest.id) as [
      GuestId,
      GuestId,
    ];

    const online = yield* Queue.unbounded<ReadonlyArray<string>>();
    yield* Stream.runForEach(guestShares.presence(threadId), (presence) =>
      Queue.offer(online, presence.online.toSorted()),
    ).pipe(Effect.forkScoped);
    assert.deepEqual(yield* Queue.take(online), []);

    yield* Stream.runDrain(yield* guestShares.stream(sam.token)).pipe(Effect.forkScoped);
    assert.deepEqual(yield* Queue.take(online), [samId]);
    const evePage = yield* Stream.runCollect(yield* guestShares.stream(eve.token)).pipe(
      Effect.forkScoped,
    );
    assert.deepEqual(yield* Queue.take(online), [samId, eveId].toSorted());

    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-eve"),
      threadId,
      guestId: eveId,
    });
    assert.equal(Array.from(yield* Fiber.join(evePage)).at(-1)?.type, "ended");
    assert.deepEqual(yield* Queue.take(online), [samId]);
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.check(eve.token))));
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(sam.token))));
    const closed = yield* Effect.flip(guestShares.redeem({ credential, name: "Eve again" }));
    assert.equal(closed.reason, "closed");
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("lets the owner and each guest change the board everyone on the link sees", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const eve = yield* guestShares.redeem({ credential, name: "Eve" });
    const samId = (yield* orchestrator.getThreadRecords(threadId, [])).thread.guestShare!
      .guests![0]!.id;
    const boards = yield* Queue.unbounded<NonNullable<GuestShareView["board"]>>();
    yield* Stream.runForEach(yield* guestShares.stream(eve.token), (event) =>
      event.type === "view" && event.view.board !== undefined
        ? Queue.offer(boards, event.view.board)
        : Effect.void,
    ).pipe(Effect.forkScoped);

    yield* guestShares.changeBoard(
      { session: sam.token },
      { type: "note.put", noteId: "note:1", text: "Hid\u200Bden", x: 4, y: 8 },
    );
    // The other guest's open page gets the note, signed, without characters nobody can see.
    assert.deepEqual((yield* Queue.take(boards)).notes, [
      { id: "note:1", text: "Hidden", x: 4, y: 8, guestId: samId },
    ]);
    yield* guestShares.changeBoard(
      { threadId },
      { type: "card.move", cardId: "thread", x: 40, y: 80 },
    );
    assert.deepEqual((yield* Queue.take(boards)).positions, { thread: { x: 40, y: 80 } });
    // A reply on a comment thread is signed and cleaned the same way.
    yield* guestShares.changeBoard(
      { session: sam.token },
      { type: "note.put", noteId: "talk", text: "Ship it?", x: 0, y: 0, kind: "comment" },
    );
    yield* Queue.take(boards);
    yield* guestShares.changeBoard(
      { session: eve.token },
      { type: "comment.reply", noteId: "talk", replyId: "reply:1", text: "Not​ yet" },
    );
    const [reply] = (yield* Queue.take(boards)).notes.at(-1)?.replies ?? [];
    assert.deepInclude(reply, { id: "reply:1", text: "Not yet" });
    assert.notEqual(reply?.guestId, samId);

    // Only a guest's session writes: not the invite, and not the token their own machine holds.
    const remove = { type: "note.remove", noteId: "note:1" } as const;
    const room = (yield* guestShares.exportThread((yield* guestShares.handoff(sam.token)).token))
      .room!;
    for (const token of [credential, room.token]) {
      assert.equal(
        (yield* Effect.flip(guestShares.changeBoard({ session: token }, remove))).reason,
        "invalid",
      );
    }
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-sam-board"),
      threadId,
      guestId: samId,
    });
    assert.equal(
      (yield* Effect.flip(guestShares.changeBoard({ session: sam.token }, remove))).reason,
      "inactive",
    );
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-board"),
      threadId,
    });
    for (const by of [{ session: eve.token }, { threadId }]) {
      assert.equal((yield* Effect.flip(guestShares.changeBoard(by, remove))).reason, "inactive");
    }
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("sends a trusted guest's message itself only while the provider is on an API key", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const joined = yield* orchestrator.getThreadRecords(threadId, []);
    const samId = joined.thread.guestShare!.guests![0]!.id;
    const signedInWith = (type: string) =>
      Ref.set(providers, [
        { instanceId, driver: "codex", auth: { status: "authenticated", type }, models: [] },
      ] as unknown as ReadonlyArray<ServerProvider>);
    const trust = (trusted: boolean) =>
      orchestrator.dispatch({
        type: "thread.guest.trust",
        commandId: CommandId.make(`trust:${trusted}`),
        threadId,
        guestId: samId,
        trusted,
      });
    const ask = (text: string) => guestShares.submit(sam.token, { shareId: sam.shareId, text }, []);
    const state = orchestrator.getThreadRecords(threadId, ["messages"]).pipe(
      Effect.map(({ thread, messages }) => ({
        waiting: thread.guestShare!.messages.map((message) => message.status),
        sent: messages.map((message) => message.text),
      })),
    );

    // An API key alone is not enough: the owner has to trust the guest.
    yield* signedInWith("apiKey");
    yield* ask("First");
    // Nor is trust alone: a plan sign-in covers only the owner's own prompts.
    yield* trust(true);
    yield* signedInWith("chatgpt");
    yield* ask("Second");
    assert.deepEqual(yield* state, { waiting: ["pending", "pending"], sent: [] });

    yield* signedInWith("apiKey");
    yield* ask("Third");
    assert.deepEqual(yield* state, {
      waiting: ["pending", "pending", "sent"],
      sent: ["Message from guest Sam, sent without the owner reading it:\n\nThird"],
    });
    const [opened] = Array.from(
      yield* Stream.runCollect(Stream.take(yield* guestShares.stream(sam.token), 1)),
    );
    assert.isTrue(opened?.type === "view" && opened.view.direct);

    // A message for an artifact card goes the same way, with the card this board has.
    yield* guestShares.changeBoard(
      { threadId },
      { type: "note.put", noteId: "plan", text: "Plan", x: 0, y: 0, kind: "artifact" },
    );
    const forCard = (artifactId: string) =>
      guestShares.submit(sam.token, { shareId: sam.shareId, text: "Draw it", artifactId }, []);
    assert.equal((yield* Effect.flip(forCard("gone"))).reason, "artifact_gone");
    yield* forCard("plan");
    const drawn = (yield* orchestrator.getThreadRecords(threadId, ["messages"])).messages.at(-1);
    assert.deepInclude(drawn?.context?.records[0], { kind: "room-artifact", noteId: "plan" });

    yield* trust(false);
    yield* ask("Fourth");
    assert.equal((yield* state).waiting.at(-1), "pending");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("trusts a guest who signs in as a saved contributor, and no one else", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({ guestContributors: [{ login: "Sam-Dev" }] });
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const eve = yield* guestShares.redeem({ credential, name: "Eve" });
    const guests = orchestrator
      .getThreadRecords(threadId, [])
      .pipe(Effect.map(({ thread }) => thread.guestShare!.guests!));

    /** The guest starts, and GitHub sends the browser that holds `cookie` back. */
    const signIn = Effect.fn(function* (token: string, cookieOf = (cookie: string) => cookie) {
      const started = yield* guestShares.signIn(token);
      const cookie = cookieOf(started.cookie);
      const state = started.cookie.split(".")[1]!;
      return {
        ...started,
        location: yield* guestShares.signInFinish({ state, code: "code", cookie }),
      };
    });
    const page = `/guest?share=${sam.shareId}`;

    // GitHub refusing the code records no one.
    yield* Ref.set(githubAccount, null);
    const refused = yield* signIn(sam.token);
    // GitHub sends the guest back to the host the link is served from.
    assert.equal(refused.url, "https://env.t3.test/api/guest/sign-in/callback");
    assert.equal(refused.location, `${page}&sign_in=failed`);

    // Nor does a callback from a browser that did not start the sign-in: Eve cannot have
    // someone else approve on GitHub and be recorded as them.
    yield* Ref.set(githubAccount, { login: "sam-dev", id: 7 });
    const eveStarted = yield* guestShares.signIn(eve.token);
    assert.equal(
      (yield* signIn(sam.token, () => eveStarted.cookie)).location,
      `${page}&sign_in=failed`,
    );
    assert.equal((yield* signIn(sam.token, () => "")).location, "/guest?sign_in=failed");
    assert.equal(
      yield* guestShares.signInFinish({ state: null, code: "code", cookie: eveStarted.cookie }),
      `${page}&sign_in=failed`,
    );
    assert.deepEqual(
      (yield* guests).map(({ account }) => account),
      [undefined, undefined],
    );

    assert.equal((yield* signIn(sam.token)).location, page);
    // With no hosted app configured, no page on another origin can start a sign-in.
    assert.equal(
      (yield* Effect.flip(
        guestShares.signInFromHostedApp({ session: sam.token, origin: "https://app.t3.codes" }),
      )).reason,
      "invalid",
    );
    // Someone else's account is recorded, but their messages still wait for the owner.
    yield* Ref.set(githubAccount, { login: "eve", id: 8 });
    yield* signIn(eve.token);
    assert.deepEqual(
      (yield* guests).map(({ account, trusted }) => ({ account, trusted })),
      [
        { account: { login: "sam-dev", id: 7 }, trusted: true },
        { account: { login: "eve", id: 8 }, trusted: undefined },
      ],
    );
    // The saved login now names that one account, whoever holds the login later.
    assert.deepEqual((yield* settings.getSettings).guestContributors, [
      { login: "sam-dev", id: 7 },
    ]);
    const mallory = yield* guestShares.redeem({ credential, name: "Mallory" });
    yield* Ref.set(githubAccount, { login: "sam-dev", id: 99 });
    yield* signIn(mallory.token);
    assert.isUndefined((yield* guests)[2]?.trusted);
  }).pipe(Effect.provide(layerTest)),
);

const layerHostedApp = layerTest.pipe(
  Layer.provide(
    ConfigProvider.layer(
      ConfigProvider.fromEnv({ env: { T3CODE_HOSTED_APP_URL: "https://app.t3.test" } }),
    ),
  ),
);

it.effect("opens links on a configured hosted app, and returns a guest who signs in there", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThreadFor(
      ThreadId.make("thread:guest-share-hosted"),
      null,
      "https://app.t3.test/guest?host=env.t3.test#",
    );
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    // Any other page could walk someone else's browser through Sam's sign-in.
    for (const origin of ["https://evil.test", "https://env.t3.test", "null", null]) {
      assert.equal(
        (yield* Effect.flip(guestShares.signInFromHostedApp({ session: sam.token, origin })))
          .reason,
        "invalid",
      );
    }
    yield* Ref.set(githubAccount, { login: "sam-dev", id: 7 });
    const started = yield* guestShares.signInFromHostedApp({
      session: sam.token,
      origin: "https://app.t3.test",
    });
    const state = started.cookie.split(".")[1]!;
    const page = `https://app.t3.test/guest?host=env.t3.test&share=${sam.shareId}`;
    // The browser still has to hold the cookie for this state; the mark finishes nothing.
    assert.equal(
      yield* guestShares.signInFinish({
        state,
        code: "code",
        cookie: `${sam.shareId}.other.hosted`,
      }),
      `${page}&sign_in=failed`,
    );
    assert.equal(
      yield* guestShares.signInFinish({ state, code: "code", cookie: started.cookie }),
      page,
    );
    // A sign-in started on the owner's host still returns there.
    const local = yield* guestShares.signIn(sam.token);
    assert.equal(
      yield* guestShares.signInFinish({ state, code: "code", cookie: local.cookie }),
      `/guest?share=${sam.shareId}`,
    );
  }).pipe(Effect.provide(layerHostedApp)),
);

it.effect("hands a guest a short-lived token that only reads the thread's export", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-message"),
      threadId,
      messageId: MessageId.make("message:owner"),
      text: "Fix the login bug",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* Ref.set(checkout, { branch: "fix/login", synced: false });

    const { token } = yield* guestShares.handoff(sam.token);
    // A route takes a bearer only for the share it names, and only a session is one.
    assert.equal(yield* guestShares.sessionShareId(sam.token), sam.shareId);
    for (const other of [token, `${sam.token}x`, credential, ""]) {
      assert.isNull(yield* guestShares.sessionShareId(other));
    }
    const exported = yield* guestShares.exportThread(token);
    assert.equal(exported.title, "Review me");
    assert.deepEqual(
      exported.messages.map((message) => [message.role, message.text]),
      [["user", "Fix the login bug"]],
    );
    // The repository is named, but its remote URL can hold a credential and stays here.
    assert.deepEqual(exported.checkout, {
      repositoryKey: "github.com/acme/app",
      branch: "fix/login",
      synced: false,
    });
    assert.notInclude(JSON.stringify(exported), "token@");

    // Neither token stands in for the other.
    assert.equal((yield* Effect.flip(guestShares.check(token))).reason, "invalid");
    assert.equal((yield* Effect.flip(guestShares.exportThread(sam.token))).reason, "invalid");
    assert.equal((yield* Effect.flip(guestShares.handoff(token))).reason, "invalid");

    yield* TestClock.adjust("11 minutes");
    assert.equal((yield* Effect.flip(guestShares.exportThread(token))).reason, "inactive");
    // A fresh one works until the owner removes the guest.
    const fresh = yield* guestShares.handoff(sam.token);
    const joined = yield* orchestrator.getThreadRecords(threadId, []);
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-sam"),
      threadId,
      guestId: joined.thread.guestShare!.guests![0]!.id,
    });
    assert.equal((yield* Effect.flip(guestShares.exportThread(fresh.token))).reason, "inactive");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("lets a guest's own machine post its turns to the room, and nothing else", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const { token: handoff } = yield* guestShares.handoff(sam.token);
    const room = (yield* guestShares.exportThread(handoff)).room;
    assert.isDefined(room);
    const token = room!.token;
    // The guest's own app gets their session for the same thread, to read the room with.
    assert.equal(room!.threadId, threadId);
    yield* guestShares.check(room!.session!);
    const turn = (id: string) => ({ id, prompt: " Why? ", reply: "The token\u200B expires." });
    const share = Effect.map(
      orchestrator.getThreadRecords(threadId, ["runs", "messages"]),
      (records) => ({ ...records, turns: records.thread.guestShare?.turns ?? [] }),
    );

    yield* guestShares.postTurn(token, turn("run:1"));
    yield* guestShares.postTurn(token, turn("run:1"));
    const shown = yield* share;
    // Once, with the characters nobody can see removed.
    assert.deepEqual(
      shown.turns.map(({ id, prompt, reply }) => ({ id, prompt, reply })),
      [{ id: "run:1", prompt: "Why?", reply: "The token expires." }],
    );
    // The owner's thread got no message and ran nothing.
    assert.lengthOf(shown.runs, 0);
    assert.lengthOf(shown.messages, 0);

    // A room token is not a session or a handoff token, and neither of those posts a turn.
    assert.equal((yield* Effect.flip(guestShares.check(token))).reason, "invalid");
    assert.equal((yield* Effect.flip(guestShares.exportThread(token))).reason, "invalid");
    assert.equal((yield* Effect.flip(guestShares.handoff(token))).reason, "invalid");
    for (const other of [sam.token, handoff]) {
      assert.equal(
        (yield* Effect.flip(guestShares.postTurn(other, turn("run:2")))).reason,
        "invalid",
      );
    }
    assert.equal(
      (yield* Effect.flip(guestShares.postTurn(token, { ...turn("run:2"), reply: " " }))).reason,
      "empty",
    );

    // It also reads what the room said: never its own turns, and another guest's machine reads
    // them. A session or a handoff token reads nothing.
    assert.deepEqual((yield* guestShares.roomUpdates(token, null)).updates, []);
    for (const other of [sam.token, handoff]) {
      assert.equal((yield* Effect.flip(guestShares.roomUpdates(other, null))).reason, "invalid");
    }
    const alex = yield* guestShares.redeem({ credential, name: "Alex" });
    const alexRoom = (yield* guestShares.exportThread(
      (yield* guestShares.handoff(alex.token)).token,
    )).room!;
    const seen = yield* guestShares.roomUpdates(alexRoom.token, null);
    assert.deepEqual(
      seen.updates.map(({ author, name, text }) => ({ author, name, text })),
      [
        { author: "guest", name: "Sam", text: "Why?" },
        { author: "guest_agent", name: "Sam", text: "The token expires." },
      ],
    );
    assert.isFalse(seen.truncated);
    assert.deepEqual((yield* guestShares.roomUpdates(alexRoom.token, seen.cursor)).updates, []);
    // Reading changed nothing in the owner's thread.
    assert.lengthOf((yield* share).runs, 0);

    // Six posts a minute, counting the two above.
    for (const id of ["run:2", "run:3", "run:4", "run:5"]) {
      yield* guestShares.postTurn(token, turn(id));
    }
    assert.equal(
      (yield* Effect.flip(guestShares.postTurn(token, turn("run:6")))).reason,
      "too_fast",
    );
    yield* TestClock.adjust("61 seconds");
    yield* guestShares.postTurn(token, turn("run:6"));
    assert.lengthOf((yield* share).turns, 6);

    // It outlives the handoff token. A tunnel that is down may come back, so that is not the
    // end; the owner removing the guest is.
    yield* TestClock.adjust("11 minutes");
    yield* guestShares.postTurn(token, turn("run:7"));
    yield* Ref.set(hostname, "other.t3.test");
    assert.equal(
      (yield* Effect.flip(guestShares.postTurn(token, turn("run:8")))).reason,
      "inactive",
    );
    yield* Ref.set(hostname, "env.t3.test");
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-sam-room"),
      threadId,
      guestId: shown.turns[0]!.guestId,
    });
    assert.equal((yield* Effect.flip(guestShares.postTurn(token, turn("run:8")))).reason, "ended");
    assert.equal((yield* Effect.flip(guestShares.roomUpdates(token, null))).reason, "ended");
    // Twenty reads a minute for the guest who is still in.
    for (let read = 0; read < 20; read++) yield* guestShares.roomUpdates(alexRoom.token, null);
    assert.equal(
      (yield* Effect.flip(guestShares.roomUpdates(alexRoom.token, null))).reason,
      "too_fast",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("shows the room a guest's agent while its turn runs, and never stores it", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const eve = yield* guestShares.redeem({ credential, name: "Eve" });
    const token = (yield* guestShares.exportThread((yield* guestShares.handoff(sam.token)).token))
      .room!.token;
    const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
    const samId = thread.guestShare!.guests![0]!.id;
    const room = { threadId, shareId: thread.guestShare!.id };

    const owner = yield* Queue.unbounded<ReadonlyArray<unknown>>();
    yield* Stream.runForEach(guestShares.roomAgents(room), (event) =>
      Queue.offer(owner, event.running),
    ).pipe(Effect.forkScoped);
    const guest = yield* Queue.unbounded<ReadonlyArray<unknown>>();
    yield* Stream.runForEach(yield* guestShares.stream(eve.token), (event) =>
      event.type === "agents" ? Queue.offer(guest, event.running) : Effect.void,
    ).pipe(Effect.forkScoped);
    assert.deepEqual(yield* Queue.take(owner), []);
    assert.deepEqual(yield* Queue.take(guest), []);

    const running = (id: string) => ({
      id,
      state: "running" as const,
      prompt: "Fix\n the​ login",
    });
    yield* guestShares.postActivity(token, running("run:1"));
    const shown = [{ guestId: samId, prompt: "Fix the login" }];
    assert.deepEqual(yield* Queue.take(owner), shown);
    assert.deepEqual(yield* Queue.take(guest), shown);
    // The finished turn clears it.
    yield* guestShares.postTurn(token, { id: "run:1", prompt: "Fix the login", reply: "Done." });
    assert.deepEqual(yield* Queue.take(owner), []);

    // A turn that stops without one clears it too, but not a stop for an older turn.
    yield* guestShares.postActivity(token, running("run:2"));
    assert.deepEqual(yield* Queue.take(owner), shown);
    yield* guestShares.postActivity(token, { id: "run:1", state: "idle" });
    yield* guestShares.postActivity(token, { id: "run:2", state: "idle" });
    assert.deepEqual(yield* Queue.take(owner), []);

    // A machine that stops saying anything stops showing as running.
    yield* guestShares.postActivity(token, running("run:3"));
    assert.deepEqual(yield* Queue.take(owner), shown);
    yield* TestClock.adjust("11 minutes");
    assert.deepEqual(yield* Queue.take(owner), []);

    // The room sees where the guest's code is, and the task their agent is on only when the card
    // is a task that is theirs to take.
    const put = (noteId: string, fields: object) =>
      guestShares.changeBoard(
        { threadId },
        { type: "note.put", noteId, text: "Fix login", x: 0, y: 0, ...fields },
      );
    yield* put("task", { kind: "task", assignee: { guestId: samId } });
    yield* put("eves", { kind: "task", assignee: { guestId: thread.guestShare!.guests![1]!.id } });
    yield* put("note", {});
    const code = { branch: "fix/login", synced: false, ahead: 1, behind: 0 };
    yield* guestShares.postActivity(token, { ...running("run:5"), taskId: "task", code });
    assert.deepEqual(yield* Queue.take(owner), [{ ...shown[0], taskId: "task", code }]);
    for (const taskId of ["eves", "note", "gone"]) {
      yield* guestShares.postActivity(token, { ...running(`run:${taskId}`), taskId });
      assert.deepEqual(yield* Queue.take(owner), shown);
      yield* guestShares.postActivity(token, { ...running(`run:task-${taskId}`), taskId: "task" });
      assert.deepEqual(yield* Queue.take(owner), [{ ...shown[0], taskId: "task" }]);
    }
    // And the artifact card its reply will fill, when the card is one on this board.
    yield* put("plan", { kind: "artifact" });
    yield* guestShares.postActivity(token, { ...running("run:plan"), artifactId: "plan" });
    assert.deepEqual(yield* Queue.take(owner), [{ ...shown[0], artifactId: "plan" }]);
    yield* guestShares.postActivity(token, { ...running("run:not-plan"), artifactId: "note" });
    assert.deepEqual(yield* Queue.take(owner), shown);

    // A guest's board says where the owner's code is too, once git does.
    yield* Ref.set(checkout, { branch: "fix/login", synced: true });
    const ownerCode = yield* Queue.unbounded<unknown>();
    yield* Stream.runForEach(yield* guestShares.stream(eve.token), (event) =>
      event.type === "agents" && event.owner !== undefined
        ? Queue.offer(ownerCode, event.owner)
        : Effect.void,
    ).pipe(Effect.forkScoped);
    yield* TestClock.adjust("30 seconds");
    assert.deepEqual(yield* Queue.take(ownerCode), {
      branch: "fix/login",
      synced: true,
      ahead: 0,
      behind: 0,
    });
    // Nothing of it reached the thread record.
    const after = (yield* orchestrator.getThreadRecords(threadId, [])).thread;
    assert.deepEqual(
      after.guestShare?.turns?.map((turn) => turn.id),
      ["run:1"],
    );

    // A session is not a room token, and a removed guest's machine shows nothing.
    assert.equal(
      (yield* Effect.flip(guestShares.postActivity(sam.token, running("run:4")))).reason,
      "invalid",
    );
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-sam-activity"),
      threadId,
      guestId: samId,
    });
    assert.equal(
      (yield* Effect.flip(guestShares.postActivity(token, running("run:4")))).reason,
      "ended",
    );
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("lets a guest's own machine read an artifact card and fill it with its turn", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const token = (yield* guestShares.exportThread((yield* guestShares.handoff(sam.token)).token))
      .room!.token;
    const put = (noteId: string, fields: object = {}) =>
      guestShares.changeBoard(
        { threadId },
        { type: "note.put", noteId, text: "Plan", x: 0, y: 0, ...fields },
      );
    yield* put("plan", { kind: "artifact" });
    yield* put("note");
    const card = Effect.map(
      orchestrator.getThreadRecords(threadId, ["runs", "messages"]),
      (records) => ({
        ...records,
        plan: records.thread.guestShare?.board?.notes.find((note) => note.id === "plan"),
      }),
    );

    const read = Effect.map(guestShares.roomArtifact(token, "plan"), ({ title, body }) => ({
      title,
      body,
    }));
    assert.deepEqual(yield* read, { title: "Plan", body: undefined });
    // Only an artifact on this board, and only for the room token of someone in the room.
    for (const noteId of ["note", "gone"]) {
      assert.equal(
        (yield* Effect.flip(guestShares.roomArtifact(token, noteId))).reason,
        "artifact_gone",
      );
    }
    assert.equal(
      (yield* Effect.flip(guestShares.roomArtifact(sam.token, "plan"))).reason,
      "invalid",
    );

    const page = "<!doctype html><html><body>Hi</body></html>";
    yield* guestShares.postTurn(token, {
      id: "run:1",
      prompt: "Draw it",
      reply: "Here it is.",
      artifact: { noteId: "plan", body: `Here:\n\`\`\`html\n${page}\u200B\n\`\`\`` },
    });
    const filled = yield* card;
    const samId = filled.thread.guestShare!.guests![0]!.id;
    // The card holds the page alone, as from any reply, and says whose agent wrote it.
    assert.deepInclude(filled.plan?.artifact, { body: page, guestId: samId, turnId: "run:1" });
    assert.deepEqual(yield* read, { title: "Plan", body: page });
    // A card that is not an artifact here takes nothing; the turn still shows.
    yield* guestShares.postTurn(token, {
      id: "run:2",
      prompt: "Draw it",
      reply: "Done.",
      artifact: { noteId: "note", body: "# Other" },
    });
    const after = yield* card;
    assert.deepEqual(after.plan?.artifact, filled.plan?.artifact);
    assert.lengthOf(after.thread.guestShare?.turns ?? [], 2);
    // Nothing reached the owner's agent.
    assert.lengthOf(after.runs, 0);
    assert.lengthOf(after.messages, 0);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("shows a guest's own thread box running on their machine, and its turn on the box", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const token = (yield* guestShares.exportThread((yield* guestShares.handoff(sam.token)).token))
      .room!.token;
    const put = (by: { threadId: ThreadId } | { session: string }, noteId: string, kind: string) =>
      guestShares.changeBoard(by, {
        type: "note.put",
        noteId,
        text: "Card",
        x: 0,
        y: 0,
        kind: kind as "thread",
      });
    yield* put({ session: sam.token }, "sams", "thread");
    yield* put({ threadId }, "owners", "thread");
    yield* put({ threadId }, "plan", "artifact");
    const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
    const samId = thread.guestShare!.guests![0]!.id;
    const live = yield* Queue.unbounded<unknown>();
    yield* Stream.runForEach(
      guestShares.roomAgents({ threadId, shareId: thread.guestShare!.id }),
      (event) => Queue.offer(live, { running: event.running.length, boxes: event.boxes }),
    ).pipe(Effect.forkScoped);
    assert.deepEqual(yield* Queue.take(live), { running: 0, boxes: [] });

    const running = {
      id: "run:1",
      state: "running" as const,
      prompt: "Make it\n dark",
      artifactId: "plan",
      phase: "writing" as const,
      preview: "# Dark",
      draft: "# Dark",
      model: "GPT-5.1 Codex",
    };
    // The box shows the run, as the guest's agent's, and the guest's agent card does not.
    yield* guestShares.postActivity(token, { ...running, boxId: "sams" });
    const shown = yield* Queue.take(live);
    assert.deepEqual(shown, {
      running: 0,
      boxes: [
        {
          boxId: "sams",
          guestId: samId,
          artifactId: "plan",
          phase: "writing",
          preview: "# Dark",
          draft: "# Dark",
          startedAt: "1970-01-01T00:00:00.000Z",
          model: "GPT-5.1 Codex",
          prompt: "Make it dark",
        },
      ],
    });
    // Someone else's box shows nothing: the run is the guest's agent's own, as before.
    yield* guestShares.postActivity(token, { ...running, id: "run:2", boxId: "owners" });
    assert.deepInclude(yield* Queue.take(live), { running: 1 });
    yield* guestShares.postActivity(token, { id: "run:2", state: "idle" });
    yield* Queue.take(live);

    const turn = {
      prompt: "Make it dark",
      reply: "Done, it is dark now.",
      artifact: { noteId: "plan", body: "# Dark" },
      cards: ["Note from Eve"],
      model: "GPT-5.1 Codex",
    };
    yield* guestShares.postTurn(token, { ...turn, id: "run:1", boxId: "sams" });
    // The finished turn ends the run on the box.
    assert.deepEqual(yield* Queue.take(live), { running: 0, boxes: [] });
    const notes = Effect.map(orchestrator.getThreadRecords(threadId, []), ({ thread: after }) => ({
      share: after.guestShare!,
      note: (id: string) => after.guestShare!.board!.notes.find((note) => note.id === id),
    }));
    const after = yield* notes;
    assert.deepEqual(
      after.note("sams")?.thread?.turns.map(({ at: _at, ...shownTurn }) => shownTurn),
      [
        {
          id: "run:1",
          prompt: "Make it dark",
          cards: ["Note from Eve"],
          model: "GPT-5.1 Codex",
          reply: "Done, it is dark now.",
          guestId: samId,
        },
      ],
    );
    // The artifact says which box wrote it, from what, and whose agent.
    assert.deepInclude(after.note("plan")?.artifact, {
      body: "# Dark",
      guestId: samId,
      boxId: "sams",
      prompt: "Make it dark",
      cards: ["Note from Eve"],
      model: "GPT-5.1 Codex",
    });
    // A box's turn is the box's conversation, not one of the room's turns.
    assert.isUndefined(after.share.turns);
    // A turn for someone else's box is one of the room's turns, and shows on no box.
    yield* guestShares.postTurn(token, { ...turn, id: "run:3", boxId: "owners" });
    const other = yield* notes;
    assert.isUndefined(other.note("owners")?.thread);
    assert.deepEqual(
      other.share.turns?.map((posted) => posted.id),
      ["run:3"],
    );
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("shows each person's pointer on the board to everyone else while they have it open", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const eve = yield* guestShares.redeem({ credential, name: "Eve" });
    const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
    const [samId, eveId] = thread.guestShare!.guests!.map((guest) => guest.id) as [
      GuestId,
      GuestId,
    ];
    const room = { threadId, shareId: thread.guestShare!.id };
    const at = (x: number) => ({ x, y: 1 });

    // A guest's pointer counts only while their page is open, and the owner's only while they
    // read the room's pointers.
    assert.equal(
      (yield* Effect.flip(guestShares.moveCursor({ session: sam.token }, at(1)))).reason,
      "inactive",
    );
    assert.equal((yield* Effect.flip(guestShares.moveCursor(room, at(1)))).reason, "inactive");

    const seenBy = <E extends { readonly type: string }>(events: Stream.Stream<E>) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<ReadonlyArray<unknown>>();
        const fiber = yield* Stream.runForEach(events, (event) =>
          "cursors" in event && Array.isArray(event.cursors)
            ? Queue.offer(queue, event.cursors)
            : Effect.void,
        ).pipe(Effect.forkScoped);
        // The first event says the stream is open, and its page counted.
        assert.deepEqual(yield* Queue.take(queue), []);
        return { queue, fiber };
      });
    const { queue: owner } = yield* seenBy(guestShares.roomCursors(room));
    const { fiber: samPage } = yield* seenBy(yield* guestShares.stream(sam.token));
    const { queue: evePage, fiber: evePageOpen } = yield* seenBy(
      yield* guestShares.stream(eve.token),
    );
    const sam10 = { guestId: samId, ...at(10) };
    const sam12 = { guestId: samId, ...at(12) };
    const eve30 = { guestId: eveId, ...at(30) };
    const byGuest = (...cursors: ReadonlyArray<{ readonly guestId: string }>) =>
      cursors.toSorted((left, right) => left.guestId.localeCompare(right.guestId));

    yield* guestShares.moveCursor({ session: sam.token }, at(10));
    assert.deepEqual(yield* Queue.take(owner), [sam10]);
    assert.deepEqual(yield* Queue.take(evePage), [sam10]);
    // Nobody is sent their own pointer.
    yield* guestShares.moveCursor(room, at(20));
    yield* guestShares.moveCursor({ session: eve.token }, at(30));
    assert.deepEqual(yield* Queue.take(evePage), [at(20), sam10]);
    assert.deepEqual(yield* Queue.take(owner), byGuest(sam10, eve30));

    // Twenty moves a second from one guest; a pointer leaving is never refused.
    for (let move = 1; move < 20; move++) {
      yield* guestShares.moveCursor({ session: sam.token }, at(10));
    }
    assert.equal(
      (yield* Effect.flip(guestShares.moveCursor({ session: sam.token }, at(11)))).reason,
      "too_fast",
    );
    yield* guestShares.moveCursor({ session: sam.token }, null);
    assert.deepEqual(yield* Queue.take(evePage), [at(20)]);
    assert.deepEqual(yield* Queue.take(owner), [eve30]);

    // Closing the page takes its pointer off at once, and a pointer left still expires.
    yield* TestClock.adjust("2 seconds");
    yield* guestShares.moveCursor({ session: sam.token }, at(12));
    assert.deepEqual(yield* Queue.take(evePage), [at(20), sam12]);
    assert.deepEqual(yield* Queue.take(owner), byGuest(sam12, eve30));
    yield* Fiber.interrupt(samPage);
    assert.deepEqual(yield* Queue.take(evePage), [at(20)]);
    assert.deepEqual(yield* Queue.take(owner), [eve30]);
    yield* TestClock.adjust("61 seconds");
    assert.deepEqual(yield* Queue.take(owner), []);

    // A guest the owner removes, or a link that ended, moves nothing.
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-eve-cursor"),
      threadId,
      guestId: eveId,
    });
    yield* Fiber.join(evePageOpen);
    assert.equal(
      (yield* Effect.flip(guestShares.moveCursor({ session: eve.token }, at(1)))).reason,
      "inactive",
    );
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("shows each person's view of the board to the others until they close it", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const sam = yield* guestShares.redeem({ credential, name: "Sam" });
    const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
    const samId = thread.guestShare!.guests![0]!.id;
    const room = { threadId, shareId: thread.guestShare!.id };
    const viewsSeenBy = <E extends { readonly type: string }>(events: Stream.Stream<E>) =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<unknown>();
        yield* Stream.runForEach(events, (event) =>
          "views" in event ? Queue.offer(queue, event.views) : Effect.void,
        ).pipe(Effect.forkScoped);
        assert.deepEqual(yield* Queue.take(queue), []);
        return queue;
      });
    const owner = yield* viewsSeenBy(guestShares.roomCursors(room));
    const samPage = yield* viewsSeenBy(yield* guestShares.stream(sam.token));
    const view = { x: 400, y: -20, zoom: 1.25 };

    yield* guestShares.moveCursor({ session: sam.token }, { x: 1, y: 1 }, view);
    assert.deepEqual(yield* Queue.take(owner), [{ guestId: samId, ...view }]);
    // The pointer leaving the board leaves the view; closing the board takes it.
    yield* guestShares.moveCursor({ session: sam.token }, null);
    assert.deepEqual(yield* Queue.take(owner), [{ guestId: samId, ...view }]);
    yield* guestShares.moveCursor({ session: sam.token }, null, null);
    assert.deepEqual(yield* Queue.take(owner), []);

    yield* guestShares.moveCursor(room, null, view);
    assert.deepEqual(yield* Queue.take(samPage), [view]);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("counts a guest joining and sending, without their name or text", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session, shareId } = yield* guestShares.redeem({ credential, name: "Sam" });
    yield* guestShares.submit(session, { shareId, text: "Hello" }, []);
    assert.deepEqual(yield* Ref.get(yield* RecordedAnalytics), [
      { event: "feature.used", feature: "guest_share.join" },
      { event: "feature.used", feature: "guest_message.submit", variant: "text_only" },
    ]);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("streams the owner's thread events after the share and a snapshot", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const events = yield* guestShares.stream(session);
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-message"),
      threadId,
      messageId: MessageId.make("message:owner"),
      text: "Fix the login bug",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-after-message"),
      threadId,
    });
    const received = Array.from(yield* Stream.runCollect(events));
    assert.equal(received.at(-1)?.type, "ended");
    const turnItems = received.flatMap((event) =>
      event.type === "thread" &&
      event.item.kind === "event" &&
      event.item.event.type === "turn-item.updated"
        ? [event.item.event.payload]
        : [],
    );
    assert.deepEqual(
      turnItems.flatMap((item) => (item.type === "user_message" ? [item.text] : [])),
      ["Fix the login bug"],
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("hides the owner's paths, project and provider from a guest's snapshot and events", () =>
  Effect.gen(function* () {
    const worktree = String.raw`C:\Users\pykew\hackathon\matchbox`;
    const { orchestrator, guestShares, credential } = yield* shareThreadFor(threadId, worktree);
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const say = (id: string, text: string) =>
      orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(id),
        threadId,
        messageId: MessageId.make(`message:${id}`),
        text,
        attachments: [],
        dispatchMode: { type: "defer_start" },
        createdBy: "user",
        creationSource: "web",
      });
    const before = "Read C:/Users/pykew/hackathon/matchbox/src/x.ts and /repo/README.md";
    yield* say("before", before);
    const events = yield* guestShares.stream(session);
    yield* say("after", String.raw`Now c:\users\pykew\hackathon\matchbox2\y.ts`);
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-after-paths"),
      threadId,
    });
    const received = Array.from(yield* Stream.runCollect(events));
    const snapshot = received.flatMap((event) =>
      event.type === "thread" && event.item.kind === "snapshot" ? [event.item.projection] : [],
    )[0];
    if (snapshot === undefined) return assert.fail("Expected a snapshot.");
    assert.deepInclude(snapshot.thread, {
      title: "Review me",
      worktreePath: null,
      projectId: ProjectId.make("shared"),
      providerInstanceId: ProviderInstanceId.make("shared"),
      modelSelection: { instanceId: ProviderInstanceId.make("shared"), model: "gpt-5.1-codex" },
    });
    assert.doesNotHaveAnyKeys(snapshot.thread, ["pullRequests", "guestShare", "tags"]);
    const texts = (items: ReadonlyArray<OrchestrationV2TurnItem>) =>
      items.flatMap((item) => (item.type === "user_message" ? [item.text] : []));
    assert.deepEqual(texts(snapshot.visibleTurnItems.map((row) => row.item)), [
      "Read matchbox/src/x.ts and repo/README.md",
    ]);
    const later = received.flatMap((event) =>
      event.type === "thread" && event.item.kind === "event" ? [event.item.event] : [],
    );
    // A queued message has no row yet; it arrives as the message itself.
    assert.deepEqual(
      later.flatMap((event) => (event.type === "message.updated" ? [event.payload.text] : [])),
      [String.raw`Now ~\hackathon\matchbox2\y.ts`],
    );
    const sent = JSON.stringify(received).toLowerCase();
    for (const hidden of ["pykew", "/repo", "project:guest-share-service"]) {
      assert.notInclude(sent, hidden);
    }
    // The driver is also "codex", so the instance id is checked by its keys.
    assert.match(sent, /instanceid":"shared"/);
    assert.notMatch(sent, /instanceid":"(?!shared")/);
    // The owner's own reads are untouched.
    const own = yield* orchestrator.getThreadRecords(threadId, ["messages"]);
    assert.equal(own.thread.worktreePath, worktree);
    assert.include(
      own.messages.map((message) => message.text),
      before,
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("starts a stream with the runs and items already in the thread", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-message-before"),
      threadId,
      messageId: MessageId.make("message:before"),
      text: "Fix the login bug",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const [view, snapshot] = Array.from(
      yield* Stream.runCollect(Stream.take(yield* guestShares.stream(session), 2)),
    );
    assert.equal(view?.type, "view");
    if (snapshot?.type !== "thread" || snapshot.item.kind !== "snapshot") {
      return assert.fail("Expected the thread snapshot second.");
    }
    assert.equal(snapshot.item.projection.runs.length, 1);
    assert.include(
      snapshot.item.projection.visibleTurnItems.map((row) => row.item.type),
      "user_message",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("redeems only a short invite whose signature and share id are both current", () =>
  Effect.gen(function* () {
    const { guestShares, credential: replaced } = yield* shareThread;
    const again = yield* guestShares.create({ threadId });
    assert.equal(again.url.slice(again.url.indexOf("#") + 1), replaced);
    const { url } = yield* guestShares.create({ threadId, replace: true });
    const credential = url.slice(url.indexOf("#") + 1);
    assert.match(credential, /^[\w-]{22}\.[\w-]{22}$/);

    const [shareId, signature] = credential.split(".");
    const tampered = `${shareId}.${signature!.startsWith("A") ? "B" : "A"}${signature!.slice(1)}`;
    for (const rejected of [tampered, replaced]) {
      const error = yield* Effect.flip(guestShares.redeem({ credential: rejected, name: "Eve" }));
      assert.equal(error.reason, "invalid");
    }
    assert.isTrue(
      Exit.isSuccess(yield* Effect.exit(guestShares.redeem({ credential, name: "Sam" }))),
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses guest requests once T3 Connect no longer serves the link's host", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const { id: shareId } = (yield* Orchestrator.OrchestratorV2.use((orchestrator) =>
      orchestrator.getThreadRecords(threadId, []),
    )).thread.guestShare!;
    yield* Ref.set(hostname, null);
    const submitted = yield* Effect.exit(
      guestShares.submit(session, { shareId, text: "Hello" }, []),
    );
    assert.isTrue(Exit.isFailure(submitted));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("closes an open guest stream when T3 Connect stops serving the link's host", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const collecting = yield* Stream.runCollect(yield* guestShares.stream(session)).pipe(
      Effect.forkChild,
    );
    yield* Ref.set(hostname, null);
    yield* TestClock.adjust("30 seconds");
    // No `ended`: the browser reconnects, and the host check refuses it while Connect is gone.
    const received = Array.from(yield* Fiber.join(collecting));
    assert.deepEqual(
      received.map((event) => (event.type === "thread" ? event.item.kind : event.type)),
      ["view", "snapshot"],
    );
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.stream(session))));
    yield* Ref.set(hostname, "env.t3.test");
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.stream(session))));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses new links and every guest request while the beta is off", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const collecting = yield* Stream.runCollect(yield* guestShares.stream(session)).pipe(
      Effect.forkChild,
    );
    const settings = yield* ServerSettings.ServerSettingsService;
    yield* settings.updateSettings({ guestSharingEnabled: false });
    // An open stream closes at the next access check.
    yield* TestClock.adjust("30 seconds");
    yield* Fiber.join(collecting);
    assert.equal((yield* Effect.flip(guestShares.create({ threadId }))).reason, "disabled");
    assert.equal((yield* Effect.flip(guestShares.check(session))).reason, "inactive");
    // Turning it back on lets the same guest back in.
    yield* settings.updateSettings({ guestSharingEnabled: true });
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(session))));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("ends an open guest stream when the link expires", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const collecting = yield* Stream.runCollect(yield* guestShares.stream(session)).pipe(
      Effect.forkChild,
    );
    yield* TestClock.adjust("25 hours");
    const received = Array.from(yield* Fiber.join(collecting));
    assert.equal(received.at(-1)?.type, "ended");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("shows the guest the thread's new model", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const events = yield* guestShares.stream(session);
    yield* orchestrator.dispatch({
      type: "thread.model-selection.set",
      commandId: CommandId.make("switch-model"),
      threadId,
      modelSelection: { instanceId, model: "gpt-5.2-codex" },
    });
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-after-switch"),
      threadId,
    });
    const views = Array.from(yield* Stream.runCollect(events)).flatMap((event) =>
      event.type === "view" ? [event.view.model.name] : [],
    );
    assert.include(views, "gpt-5.2-codex");
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses a message a page sends for a share the cookie no longer opens", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const submitted = yield* Effect.exit(
      guestShares.submit(session, { shareId: GuestShareId.make("share:older"), text: "Hello" }, []),
    );
    assert.isTrue(Exit.isFailure(submitted));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("serves no render for an item outside the shared thread", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.render(session, "item:missing"))));
    // The invite itself is not a session.
    assert.isTrue(
      Exit.isFailure(yield* Effect.exit(guestShares.render(credential, "item:missing"))),
    );
  }).pipe(Effect.provide(layerTest)),
);

const ownerRun = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  yield* orchestrator.dispatch({
    type: "message.dispatch",
    commandId: CommandId.make("owner-message-for-command"),
    threadId,
    messageId: MessageId.make("message:command"),
    text: "Build it",
    attachments: [],
    dispatchMode: { type: "defer_start" },
    createdBy: "user",
    creationSource: "web",
  });
  const { runs } = (yield* orchestrator.getThreadSnapshotWindow(threadId, { rowLimit: 10 }))
    .projection;
  return runs[0]!.id;
});

const writeItem = (
  id: string,
  fields:
    | Pick<
        Extract<OrchestrationV2TurnItem, { type: "command_execution" }>,
        "type" | "status" | "input" | "output"
      >
    | Pick<
        Extract<OrchestrationV2TurnItem, { type: "file_change" }>,
        "type" | "status" | "fileName" | "diffStr" | "oldStr" | "newStr"
      >,
) =>
  Effect.gen(function* () {
    const runId = yield* ownerRun;
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    yield* eventSink.write({
      events: [
        {
          id: EventId.make(`event:${id}`),
          type: "turn-item.updated",
          threadId,
          driver: ProviderDriverKind.make("codex"),
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: {
            id: TurnItemId.make(id),
            threadId,
            runId,
            nodeId: null,
            providerThreadId: null,
            providerTurnId: null,
            nativeItemRef: null,
            parentItemId: null,
            ordinal: 1,
            title: null,
            startedAt: now,
            completedAt: fields.status === "running" ? null : now,
            updatedAt: now,
            ...fields,
          },
        },
      ],
    });
    return TurnItemId.make(id);
  });

it.effect("gives the guest a command's detail and output, but no file diffs", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const command = yield* writeItem("item:command", {
      type: "command_execution",
      status: "completed",
      input: "ls /work/src",
      output: "/work/src/auth.ts\n",
    });

    const detail = (yield* guestShares.item(session, command)).item;
    assert.deepInclude(detail, { input: "ls /work/src", output: "/work/src/auth.ts\n" });
    const edit = yield* writeItem("item:edit", {
      type: "file_change",
      status: "completed",
      fileName: "src/auth.ts",
      diffStr: "-const token = 1;\n+const token = 2;\n",
    });
    const write = yield* writeItem("item:write", {
      type: "file_change",
      status: "completed",
      fileName: "src/config.ts",
      oldStr: "",
      newStr: "export const key = 1;\n",
    });
    for (const [id, fileName] of [
      [edit, "src/auth.ts"],
      [write, "src/config.ts"],
    ] as const) {
      const change = (yield* guestShares.item(session, id)).item;
      assert.deepInclude(change, { type: "file_change", fileName });
      assert.doesNotHaveAnyKeys(change, ["diffStr", "oldStr", "newStr"]);
    }
    const frames: ReadonlyArray<unknown> = Array.from(
      yield* Stream.runCollect(yield* guestShares.commandOutput(session, command)),
    );
    assert.deepEqual(frames, [
      { kind: "replace", text: "/work/src/auth.ts\n", truncated: false, running: false },
    ]);
    // Only with a session, and only for an item of this thread.
    const refused: ReadonlyArray<Effect.Effect<unknown, GuestShareService.GuestShareAccessError>> =
      [
        guestShares.item(credential, command),
        guestShares.commandOutput(credential, command),
        guestShares.item(session, "item:elsewhere"),
      ];
    for (const request of refused) {
      assert.isTrue(Exit.isFailure(yield* Effect.exit(request)));
    }
  }).pipe(Effect.provide(layerTest)),
);

it.effect("pages the guest back through turns older than the stream's snapshot", () =>
  Effect.gen(function* () {
    const { guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const runId = yield* ownerRun;
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const shot = `${directory}/old.png`;
    yield* fileSystem.writeFile(shot, PNG);
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const base = { threadId, runId, nodeId: null, providerThreadId: null, providerTurnId: null };
    const turnItem = (id: string, ordinal: number, payload: object) => ({
      id: EventId.make(`event:${id}`),
      type: "turn-item.updated" as const,
      threadId,
      driver: ProviderDriverKind.make("codex"),
      providerInstanceId: instanceId,
      occurredAt: now,
      payload: {
        ...base,
        id: TurnItemId.make(id),
        nativeItemRef: null,
        parentItemId: null,
        ordinal,
        title: null,
        status: "completed" as const,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        messageId: MessageId.make(id),
        ...payload,
      } as OrchestrationV2TurnItem,
    });
    yield* eventSink.write({
      events: [
        turnItem("item:old-image", 1, {
          type: "assistant_message",
          text: `![Old](${shot})`,
          streaming: false,
        }),
        ...Array.from({ length: 30 }, (_, index) =>
          turnItem(`item:ask-${index}`, index + 2, {
            type: "user_message",
            text: `Ask ${index}`,
            createdBy: "user",
            creationSource: "web",
            inputIntent: "turn_start",
            attachments: [],
          }),
        ),
      ],
    });

    const [, opening] = Array.from(
      yield* Stream.runCollect(Stream.take(yield* guestShares.stream(session), 2)),
    );
    if (opening?.type !== "thread" || opening.item.kind !== "snapshot") {
      return assert.fail("Expected the thread snapshot second.");
    }
    const ids = (rows: ReadonlyArray<{ readonly sourceItemId: string }>) =>
      rows.map((row) => row.sourceItemId);
    assert.notInclude(ids(opening.item.projection.visibleTurnItems), "item:old-image");
    let cursor = opening.item.historyCursor ?? null;
    assert.isNotNull(cursor);
    // The page has not shown the old reply yet, so its image does not load.
    assert.equal((yield* Effect.flip(guestShares.media(session, shot))).reason, "unavailable");
    // Only a session pages.
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.history(credential, cursor!))));

    const older: Array<string> = [];
    while (cursor !== null) {
      const page: OrchestrationV2ThreadHistoryPage = yield* guestShares.history(session, cursor);
      older.push(...ids(page.items));
      cursor = page.hasMoreHistory ? page.nextCursor : null;
    }
    assert.include(older, "item:old-image");
    assert.deepStrictEqual(yield* guestShares.media(session, shot), {
      path: shot,
      mimeType: "image/png",
    });
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("ends a running command's output once the owner stops sharing", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, credential } = yield* shareThread;
    const { token: session } = yield* guestShares.redeem({ credential, name: "Sam" });
    const command = yield* writeItem("item:running", {
      type: "command_execution",
      status: "running",
      input: "ls /work/src",
    });
    const collecting = yield* Stream.runCollect(
      yield* guestShares.commandOutput(session, command),
    ).pipe(Effect.forkChild);
    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-during-command"),
      threadId,
    });
    yield* TestClock.adjust("30 seconds");
    const frames = Array.from(yield* Fiber.join(collecting));
    assert.isTrue(frames.every((frame) => frame.running));
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.commandOutput(session, command))));
  }).pipe(Effect.provide(layerTest)),
);

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13);
const MIB = 1024 * 1024;

/** Files as the multipart parser leaves them: on disk, with the browser's name and type. */
const uploadsOf = Effect.fn(function* (
  files: ReadonlyArray<{
    readonly name: string;
    readonly contentType: string;
    readonly bytes: Uint8Array;
  }>,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const directory = yield* fileSystem.makeTempDirectoryScoped();
  return yield* Effect.forEach(files, (file, index) => {
    const path = `${directory}/${index}`;
    return fileSystem
      .writeFile(path, file.bytes)
      .pipe(Effect.as({ name: file.name, contentType: file.contentType, path }));
  });
});
const png = (name: string, sizeBytes = PNG.length) => {
  const bytes = new Uint8Array(sizeBytes);
  bytes.set(PNG);
  return { name, contentType: "image/png", bytes };
};

/** Every stored attachment file. */
const storedFiles = Effect.gen(function* () {
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  return yield* fileSystem.readDirectory(attachmentsDir).pipe(Effect.orElseSucceed(() => []));
});

const joinedGuest = Effect.gen(function* () {
  const shared = yield* shareThread;
  const { token: session, shareId } = yield* shared.guestShares.redeem({
    credential: shared.credential,
    name: "Sam",
  });
  return { ...shared, session, shareId };
});

const waitingMessages = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
  return thread.guestShare?.messages ?? [];
});

it.effect("refuses too many files, too many bytes, and images that are not what they say", () =>
  Effect.gen(function* () {
    const { guestShares, session, shareId } = yield* joinedGuest;
    const before = yield* storedFiles;
    const refused = [
      ["too_many_files", [1, 2, 3, 4, 5].map((index) => png(`${index}.png`))],
      ["too_large", [png("big.png", 10 * MIB + 1)]],
      ["unsupported_file", [{ name: "logo.svg", contentType: "image/svg+xml", bytes: PNG }]],
      [
        "unsupported_file",
        [{ name: "page.png", contentType: "image/png", bytes: new TextEncoder().encode("<html>") }],
      ],
      [
        "unsupported_file",
        [{ name: "empty.txt", contentType: "text/plain", bytes: new Uint8Array() }],
      ],
    ] as const;
    for (const [reason, files] of refused) {
      const error = yield* Effect.flip(
        guestShares.submit(session, { shareId, text: "Look" }, yield* uploadsOf(files)),
      );
      assert.equal(error.reason, reason);
    }
    // Nothing is kept from a refused message, and no message waits.
    assert.deepEqual(yield* storedFiles, before);
    assert.deepEqual(yield* waitingMessages, []);

    yield* guestShares.submit(
      session,
      { shareId, text: "" },
      yield* uploadsOf([
        png("screen.png"),
        // A direction override would make this name read as a PDF.
        {
          name: "notes\u202Efdp.html",
          contentType: "text/html",
          bytes: new TextEncoder().encode("<b>"),
        },
      ]),
    );
    const [message] = yield* waitingMessages;
    assert.deepEqual(
      message?.attachments?.map(({ type, name, mimeType, sizeBytes }) => ({
        type,
        name,
        mimeType,
        sizeBytes,
      })),
      [
        { type: "image", name: "screen.png", mimeType: "image/png", sizeBytes: PNG.length },
        { type: "file", name: "notes_fdp.html", mimeType: "text/html", sizeBytes: 3 },
      ],
    );
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("caps the bytes of files waiting in one share", () =>
  Effect.gen(function* () {
    const { guestShares, session, shareId } = yield* joinedGuest;
    const submit = (sizeBytes: number) =>
      Effect.gen(function* () {
        return guestShares.submit(
          session,
          { shareId, text: "Look" },
          yield* uploadsOf([png("big.png", sizeBytes)]),
        );
      }).pipe(Effect.flatten);
    yield* submit(9 * MIB);
    yield* submit(9 * MIB);
    const error = yield* Effect.flip(submit(9 * MIB));
    assert.equal(error.reason, "files_busy");
    // Text alone still goes through.
    yield* guestShares.submit(session, { shareId, text: "One more thing" }, []);
    assert.equal((yield* waitingMessages).length, 3);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("deletes a waiting message's files when the owner dismisses it or stops sharing", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
    const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
    yield* guestShares.submit(
      session,
      { shareId, text: "First" },
      yield* uploadsOf([png("a.png")]),
    );
    yield* guestShares.submit(
      session,
      { shareId, text: "Second" },
      yield* uploadsOf([png("b.png")]),
    );
    const [first, second] = yield* waitingMessages;
    const fileOf = (message: typeof first) => message!.attachments![0]!.id;
    const stored = yield* storedFiles;
    assert.isTrue(stored.some((entry) => entry.startsWith(fileOf(first))));

    yield* orchestrator.dispatch({
      type: "thread.guest-message.dismiss",
      commandId: CommandId.make("dismiss-first"),
      threadId,
      guestMessageId: first!.id,
    });
    yield* worker.drain();
    const afterDismiss = yield* storedFiles;
    assert.isFalse(afterDismiss.some((entry) => entry.startsWith(fileOf(first))));
    assert.isTrue(afterDismiss.some((entry) => entry.startsWith(fileOf(second))));
    // A dismissed message's file is no longer the guest's to load.
    assert.isTrue(
      Exit.isFailure(yield* Effect.exit(guestShares.attachment(session, fileOf(first)))),
    );

    yield* orchestrator.dispatch({
      type: "thread.guest-share.close",
      commandId: CommandId.make("close-with-files"),
      threadId,
    });
    yield* worker.drain();
    assert.isFalse((yield* storedFiles).some((entry) => entry.startsWith(fileOf(second))));
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect.each(["thread.archive", "thread.delete"] as const)(
  "deletes a waiting message's files on %s",
  (type) =>
    Effect.gen(function* () {
      const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
      const worker = yield* EffectWorker.OrchestrationEffectWorkerV2;
      const before = yield* storedFiles;
      yield* guestShares.submit(
        session,
        { shareId, text: "Look" },
        yield* uploadsOf([png("a.png")]),
      );
      assert.equal((yield* storedFiles).length, before.length + 1);
      yield* orchestrator.dispatch({
        type,
        commandId: CommandId.make(`${type}-with-files`),
        threadId,
      });
      yield* worker.drain();
      assert.deepEqual(yield* storedFiles, before);
    }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("sends a guest's files as the guest's message and keeps them the guest's to load", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
    yield* guestShares.submit(
      session,
      { shareId, text: "See this" },
      yield* uploadsOf([png("a.png")]),
    );
    const [message] = yield* waitingMessages;
    const pending = message!.attachments!;
    // Served while it waits.
    const served = yield* guestShares.attachment(session, pending[0]!.id);
    assert.equal(served.attachment.mimeType, "image/png");

    // The day-old pending-upload sweep leaves a waiting guest's files alone.
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    // Any pending upload counts as stale at the end of time.
    sweepStalePendingAttachments({ attachmentsDir, nowMs: Number.MAX_SAFE_INTEGER });
    const copied = pending[0]!;
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("send-guest-files"),
      threadId,
      messageId: MessageId.make("message:guest-files"),
      guestMessageId: message!.id,
      text: "",
      attachments: [copied],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const items = (yield* orchestrator.getThreadSnapshotWindow(threadId, {
      rowLimit: 20,
    })).projection.visibleTurnItems.map((entry) => entry.item);
    const sent = items.find(
      (item) => item.type === "user_message" && item.context?.guest?.guestMessageId === message!.id,
    );
    assert.deepInclude(sent, { attachments: [copied] });
    if (sent?.type !== "user_message") return;
    assert.deepEqual(sent.context?.guest, {
      guestMessageId: message!.id,
      name: "Sam",
      text: "See this",
      shareId,
    });
    // The guest loads the thread's copy from their own row.
    const fromRow = yield* guestShares.attachment(session, copied.id);
    assert.equal(fromRow.attachment.id, copied.id);

    // Still theirs after their share's message list has trimmed it away.
    for (let index = 0; index < 21; index += 1) {
      yield* guestShares.submit(session, { shareId, text: `note ${index}` }, []);
      const [waiting] = (yield* waitingMessages).filter((next) => next.status === "pending");
      yield* orchestrator.dispatch({
        type: "thread.guest-message.dismiss",
        commandId: CommandId.make(`dismiss-note-${index}`),
        threadId,
        guestMessageId: waiting!.id,
      });
    }
    assert.isFalse((yield* waitingMessages).some((next) => next.id === message!.id));
    assert.equal((yield* guestShares.attachment(session, copied.id)).attachment.id, copied.id);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("serves the shared thread's files to its guest, never another thread's", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares, session, shareId } = yield* joinedGuest;
    // Another thread's guest attaches a file.
    const other = yield* shareThreadFor(ThreadId.make("thread:other-share"));
    const otherGuest = yield* guestShares.redeem({ credential: other.credential, name: "Eve" });
    yield* guestShares.submit(
      otherGuest.token,
      { shareId: otherGuest.shareId, text: "Mine" },
      yield* uploadsOf([png("eve.png")]),
    );
    const { thread: otherThread } = yield* orchestrator.getThreadRecords(
      ThreadId.make("thread:other-share"),
      [],
    );
    const othersFile = otherThread.guestShare!.messages[0]!.attachments![0]!.id;
    assert.isTrue(
      Exit.isSuccess(yield* Effect.exit(guestShares.attachment(otherGuest.token, othersFile))),
    );

    // The owner sends a message with an image of their own.
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const ownerImage = {
      type: "image" as const,
      id: ChatAttachmentId.make(createAttachmentId(threadId)!),
      name: "secret.png",
      mimeType: "image/png",
      sizeBytes: PNG.length,
    };
    yield* fileSystem.writeFile(
      resolveAttachmentPath({ attachmentsDir, attachment: ownerImage })!,
      PNG,
    );
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("owner-image"),
      threadId,
      messageId: MessageId.make("message:owner-image"),
      text: "My screen",
      attachments: [ownerImage],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });

    // The guest sees the thread as the owner does, files included.
    assert.equal(
      (yield* guestShares.attachment(session, ownerImage.id)).attachment.id,
      ownerImage.id,
    );
    for (const id of [othersFile, "pending-missing"]) {
      const error = yield* Effect.flip(guestShares.attachment(session, id));
      assert.equal(error.reason, "unavailable");
    }
    // Nor with the other share's id on this page.
    assert.equal(
      (yield* Effect.flip(
        guestShares.submit(session, { shareId: otherGuest.shareId, text: "x" }, []),
      )).reason,
      "stale_page",
    );
    assert.isDefined(shareId);
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("gives a fork's guest the files on messages the fork shows from its source", () =>
  Effect.gen(function* () {
    const { orchestrator } = yield* shareThread;
    const guestShares = yield* GuestShareService.GuestShareService;
    const { attachmentsDir } = yield* ServerConfig.ServerConfig;
    const fileSystem = yield* FileSystem.FileSystem;
    const ownerImage = Effect.fn(function* (name: string) {
      const image = {
        type: "image" as const,
        id: ChatAttachmentId.make(createAttachmentId(threadId)!),
        name,
        mimeType: "image/png",
        sizeBytes: PNG.length,
      };
      yield* fileSystem.writeFile(
        resolveAttachmentPath({ attachmentsDir, attachment: image })!,
        PNG,
      );
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`owner:${name}`),
        threadId,
        messageId: MessageId.make(`message:${name}`),
        text: name,
        attachments: [image],
        dispatchMode: { type: "defer_start" },
        createdBy: "user",
        creationSource: "web",
      });
      return image;
    });
    const inherited = yield* ownerImage("before.png");
    const run = (yield* orchestrator.getThreadRecords(threadId, ["runs"])).runs[0]!;
    const now = yield* DateTime.now;
    yield* (yield* EventSink.EventSinkV2).write({
      events: [
        {
          id: EventId.make("event:run-done"),
          type: "run.updated",
          threadId,
          runId: run.id,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: { ...run, status: "completed", completedAt: now },
        },
      ],
    });
    const forkId = ThreadId.make("thread:guest-share-fork");
    yield* orchestrator.dispatch({
      type: "thread.fork",
      commandId: CommandId.make("fork"),
      sourceThreadId: threadId,
      targetThreadId: forkId,
      sourcePoint: { type: "run", runId: run.id },
      createdBy: "user",
      creationSource: "web",
    });
    const later = yield* ownerImage("after.png");
    const { url } = yield* guestShares.create({ threadId: forkId });
    const { token: session } = yield* guestShares.redeem({
      credential: url.slice(url.indexOf("#") + 1),
      name: "Sam",
    });

    assert.equal(
      (yield* guestShares.attachment(session, inherited.id)).attachment.id,
      inherited.id,
    );
    // The source's messages after the fork point are not part of the fork.
    assert.equal(
      (yield* Effect.flip(guestShares.attachment(session, later.id))).reason,
      "unavailable",
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect("serves an image on the host only when an agent reply the guest sees shows it", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares } = yield* shareThread;
    const runId = yield* ownerRun;
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = (yield* fileSystem.makeTempDirectoryScoped()).replaceAll("\\", "/");
    const shot = `${directory}/my shot.png`;
    const fileUrl = `${directory}/file-url.png`;
    const page = `${directory}/page.png`;
    const fromUser = `${directory}/from-user.png`;
    const unnamed = `${directory}/unnamed.png`;
    const later = `${directory}/later.png`;
    for (const path of [shot, fileUrl, fromUser, unnamed, later]) {
      yield* fileSystem.writeFile(path, PNG);
    }
    yield* fileSystem.writeFileString(page, "<script>alert(1)</script>");
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    const run = (yield* orchestrator.getThreadRecords(threadId, ["runs"])).runs[0];
    const item = (
      id: string,
      ordinal: number,
      fields:
        | { readonly type: "assistant_message"; readonly text: string }
        | { readonly type: "user_message"; readonly text: string },
      target: { readonly threadId: ThreadId; readonly runId: RunId } = { threadId, runId },
    ) => ({
      id: EventId.make(`event:${id}`),
      type: "turn-item.updated" as const,
      threadId: target.threadId,
      driver: ProviderDriverKind.make("codex"),
      providerInstanceId: instanceId,
      occurredAt: now,
      payload: {
        id: TurnItemId.make(id),
        threadId: target.threadId,
        runId: target.runId,
        nodeId: null,
        providerThreadId: null,
        providerTurnId: null,
        nativeItemRef: null,
        parentItemId: null,
        ordinal,
        title: null,
        status: "completed" as const,
        startedAt: now,
        completedAt: now,
        updatedAt: now,
        messageId: MessageId.make(id),
        ...(fields.type === "assistant_message"
          ? { ...fields, streaming: false }
          : {
              ...fields,
              createdBy: "user" as const,
              creationSource: "web" as const,
              inputIntent: "turn_start" as const,
              attachments: [],
            }),
      },
    });
    yield* eventSink.write({
      events: [
        item("item:agent-images", 1, {
          type: "assistant_message",
          text: `Done: ![Shot](<${shot}>) ![Other](${NodeURL.pathToFileURL(fileUrl).href}) ![Page](${page})`,
        }),
        // A guest's sent message is a user message; it must not open files on the host.
        item("item:guest-image", 2, { type: "user_message", text: `![Mine](${fromUser})` }),
        {
          id: EventId.make("event:run-done"),
          type: "run.updated" as const,
          threadId,
          runId,
          providerInstanceId: instanceId,
          occurredAt: now,
          payload: { ...run!, status: "completed" as const, completedAt: now },
        },
      ],
    });
    // The guest watches a fork, which shows these replies as inherited history.
    const forkId = ThreadId.make("thread:guest-share-fork");
    yield* orchestrator.dispatch({
      type: "thread.fork",
      commandId: CommandId.make("fork"),
      sourceThreadId: threadId,
      targetThreadId: forkId,
      sourcePoint: { type: "run", runId },
      createdBy: "user",
      creationSource: "web",
    });
    const { url } = yield* guestShares.create({ threadId: forkId });
    const { token: session } = yield* guestShares.redeem({
      credential: url.slice(url.indexOf("#") + 1),
      name: "Sam",
    });

    // The guest's page opens, and its stream sends the replies the fork inherits.
    const sent = yield* Queue.unbounded<GuestStreamEvent>();
    yield* Stream.runForEach(yield* guestShares.stream(session), (event) =>
      Queue.offer(sent, event),
    ).pipe(Effect.forkScoped);
    const sentItem = Effect.fn(function* (id: string) {
      for (;;) {
        const event = yield* Queue.take(sent);
        if (
          event.type === "thread" &&
          event.item.kind === "event" &&
          event.item.event.type === "turn-item.updated" &&
          event.item.event.payload.id === id
        ) {
          return;
        }
      }
    });

    // The agent shows another screenshot live, then enough rows to push the first reply out of
    // the window, before the page asks for any image.
    yield* orchestrator.dispatch({
      type: "message.dispatch",
      commandId: CommandId.make("fork-message"),
      threadId: forkId,
      messageId: MessageId.make("message:fork"),
      text: "One more",
      attachments: [],
      dispatchMode: { type: "defer_start" },
      createdBy: "user",
      creationSource: "web",
    });
    const forkRun = (yield* orchestrator.getThreadRecords(forkId, ["runs"])).runs.at(-1)!;
    const inFork = { threadId: forkId, runId: forkRun.id };
    yield* eventSink.write({
      events: [
        item(
          "item:later-image",
          1,
          { type: "assistant_message", text: `![Later](${later})` },
          inFork,
        ),
        ...Array.from({ length: 600 }, (_, index) =>
          item(
            `item:filler-${index}`,
            index + 2,
            { type: "assistant_message", text: "Working." },
            inFork,
          ),
        ),
      ],
    });
    yield* sentItem("item:later-image");

    // The page still shows every reply it was sent, so each image loads.
    for (const path of [shot, fileUrl, later]) {
      assert.deepStrictEqual(yield* guestShares.media(session, path), {
        path,
        mimeType: "image/png",
      });
    }
    for (const path of [page, fromUser, unnamed, `${directory}/missing.png`]) {
      assert.equal((yield* Effect.flip(guestShares.media(session, path))).reason, "unavailable");
    }

    // A reply edited to drop its image stops allowing it.
    yield* eventSink.write({
      events: [
        {
          ...item("item:later-image", 1, { type: "assistant_message", text: "Gone." }, inFork),
          id: EventId.make("event:later-image-edited"),
        },
      ],
    });
    yield* sentItem("item:later-image");
    assert.equal((yield* Effect.flip(guestShares.media(session, later))).reason, "unavailable");
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("keeps a connected guest's images while other shares come and go", () =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem;
    const directory = yield* fileSystem.makeTempDirectoryScoped();
    const shot = `${directory}/shot.png`;
    yield* fileSystem.writeFile(shot, PNG);
    const eventSink = yield* EventSink.EventSinkV2;
    const now = yield* DateTime.now;
    /** A shared thread whose agent reply shows the screenshot, and its guest's session. */
    const sharedWithImage = Effect.fn(function* (id: ThreadId) {
      const { orchestrator, guestShares, credential } = yield* shareThreadFor(id);
      yield* orchestrator.dispatch({
        type: "message.dispatch",
        commandId: CommandId.make(`message:${id}`),
        threadId: id,
        messageId: MessageId.make(`message:${id}`),
        text: "Show me",
        attachments: [],
        dispatchMode: { type: "defer_start" },
        createdBy: "user",
        creationSource: "web",
      });
      const runId = (yield* orchestrator.getThreadRecords(id, ["runs"])).runs[0]!.id;
      yield* eventSink.write({
        events: [
          {
            id: EventId.make(`event:reply:${id}`),
            type: "turn-item.updated",
            threadId: id,
            driver: ProviderDriverKind.make("codex"),
            providerInstanceId: instanceId,
            occurredAt: now,
            payload: {
              id: TurnItemId.make(`item:reply:${id}`),
              threadId: id,
              runId,
              nodeId: null,
              providerThreadId: null,
              providerTurnId: null,
              nativeItemRef: null,
              parentItemId: null,
              ordinal: 1,
              title: null,
              status: "completed",
              startedAt: now,
              completedAt: now,
              updatedAt: now,
              type: "assistant_message",
              messageId: MessageId.make(`item:reply:${id}`),
              text: `![Shot](${shot})`,
              streaming: false,
            },
          },
        ],
      });
      const { token } = yield* guestShares.redeem({ credential, name: "Sam" });
      return { guestShares, token };
    });

    // This guest's page stays open while more guests than the record keeps open and close theirs.
    const { guestShares, token } = yield* sharedWithImage(threadId);
    const opened = yield* Deferred.make<void>();
    yield* Stream.runForEach(yield* guestShares.stream(token), () =>
      Deferred.succeed(opened, undefined),
    ).pipe(Effect.forkScoped);
    yield* Deferred.await(opened);
    const closedTokens: Array<string> = [];
    for (let index = 0; index < 65; index++) {
      const other = yield* sharedWithImage(ThreadId.make(`thread:other-${index}`));
      const events = yield* guestShares.stream(other.token);
      // The first is built but never read, as for a HEAD request; the rest open and close.
      if (index > 0) yield* Stream.runDrain(Stream.take(events, 2));
      closedTokens.push(other.token);
    }
    assert.equal((yield* guestShares.media(token, shot)).mimeType, "image/png");
    // Records of guests with no open page were dropped to make room.
    for (const closed of closedTokens.slice(0, 2)) {
      assert.equal((yield* Effect.flip(guestShares.media(closed, shot))).reason, "unavailable");
    }

    // A new link on the thread starts empty: its guest gets nothing the last guest was sent.
    const { url } = yield* guestShares.create({ threadId, replace: true });
    const next = yield* guestShares.redeem({
      credential: url.slice(url.indexOf("#") + 1),
      name: "Kim",
    });
    assert.equal((yield* Effect.flip(guestShares.media(next.token, shot))).reason, "unavailable");
    yield* Stream.runDrain(Stream.take(yield* guestShares.stream(next.token), 2));
    assert.equal((yield* guestShares.media(next.token, shot)).mimeType, "image/png");
  }).pipe(Effect.scoped, Effect.provide(layerTest)),
);

it.effect("joins a team share only with a member assertion, as one guest per member", () =>
  Effect.gen(function* () {
    const { orchestrator, guestShares } = yield* shareThread;
    const { url, share } = yield* guestShares.create({ threadId, teamId: "team-core" });
    assert.deepEqual(share.team, { id: "team-core", name: "Core" });
    assert.equal((yield* Ref.get(teamListings)).get(threadId), "team-core");
    assert.isAbove(Date.parse(share.expiresAt) - Date.parse(share.createdAt), 80 * 86_400_000);
    const credential = url.slice(url.indexOf("#") + 1);

    // The bare credential, a forged assertion, or one for another team lets no one in.
    for (const memberAssertion of [undefined, "forged", "member:team-other:u-ann:Ann"]) {
      const refused = yield* Effect.flip(
        guestShares.redeem({
          credential,
          name: "Ann",
          ...(memberAssertion === undefined ? {} : { memberAssertion }),
        }),
      );
      assert.equal(refused.reason, "team_member_required");
    }

    const ann = yield* guestShares.redeem({
      credential,
      name: "typed name is ignored",
      memberAssertion: "member:team-core:u-ann:Ann Lee",
    });
    // Another browser, another day: the same guest, not a second one.
    const again = yield* guestShares.redeem({
      credential,
      name: "Ann",
      memberAssertion: "member:team-core:u-ann:Ann Lee",
    });
    const namesake = yield* guestShares.redeem({
      credential,
      name: "Ann",
      memberAssertion: "member:team-core:u-other:Ann Lee",
    });
    const guests = (yield* orchestrator.getThreadRecords(threadId, [])).thread.guestShare!.guests!;
    assert.deepEqual(
      guests.map((guest) => [guest.name, guest.member]),
      [
        ["Ann Lee", { userId: "u-ann", avatarUrl: "https://img.test/u-ann.png" }],
        ["Ann Lee 2", { userId: "u-other", avatarUrl: "https://img.test/u-other.png" }],
      ],
    );
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(again.token))));
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(ann.token))));

    // Removing a member keeps that account out without closing the share to the rest.
    yield* orchestrator.dispatch({
      type: "thread.guest.remove",
      commandId: CommandId.make("remove-ann"),
      threadId,
      guestId: guests[0]!.id,
    });
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.check(ann.token))));
    const removed = yield* Effect.flip(
      guestShares.redeem({
        credential,
        name: "Ann",
        memberAssertion: "member:team-core:u-ann:Ann",
      }),
    );
    assert.equal(removed.reason, "removed");
    assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(namesake.token))));
    const newcomer = yield* guestShares.redeem({
      credential,
      name: "Bo",
      memberAssertion: "member:team-core:u-bo:Bo",
    });

    // A member's session ends after a day; their app joins again with a fresh assertion.
    yield* TestClock.adjust("25 hours");
    assert.isTrue(Exit.isFailure(yield* Effect.exit(guestShares.check(newcomer.token))));

    // A guest link replacing the team share stops its listing on the team.
    yield* guestShares.create({ threadId });
    assert.isFalse((yield* Ref.get(teamListings)).has(threadId));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("refuses a team share the relay would not list", () =>
  Effect.gen(function* () {
    const { guestShares } = yield* shareThread;
    const failed = yield* Effect.flip(guestShares.create({ threadId, teamId: "team-elsewhere" }));
    assert.equal(failed.reason, "team_unavailable");
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "removes a member who left the team at their next request, and lets them back later",
  () =>
    Effect.gen(function* () {
      yield* Ref.set(formerMembers, new Set());
      const { orchestrator, guestShares } = yield* shareThread;
      const { url } = yield* guestShares.create({ threadId, teamId: "team-core" });
      const credential = url.slice(url.indexOf("#") + 1);
      const join = (userId: string, name: string) =>
        guestShares.redeem({
          credential,
          name,
          memberAssertion: `member:team-core:${userId}:${name}`,
        });
      const share = orchestrator
        .getThreadRecords(threadId, [])
        .pipe(Effect.map(({ thread }) => thread.guestShare!));
      const ann = yield* join("u-ann", "Ann");
      const bo = yield* join("u-bo", "Bo");

      yield* Ref.set(formerMembers, new Set(["u-ann"]));
      assert.equal((yield* Effect.flip(guestShares.check(ann.token))).reason, "inactive");
      const after = yield* share;
      assert.deepEqual(
        after.guests?.map((guest) => guest.name),
        ["Bo"],
      );
      // Only the team keeps them out now, so rejoining needs no word from the owner.
      assert.isUndefined(after.removedMembers);
      assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(bo.token))));

      yield* Ref.set(formerMembers, new Set());
      const back = yield* join("u-ann", "Ann");
      assert.isTrue(Exit.isSuccess(yield* Effect.exit(guestShares.check(back.token))));
      assert.deepEqual(
        (yield* share).guests?.map((guest) => guest.name),
        ["Bo", "Ann"],
      );
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "runs the owner's thread box in a thread of its own, made once where the room works",
  () =>
    Effect.gen(function* () {
      const roomThreadId = ThreadId.make("thread:room-boxes");
      const { orchestrator, guestShares, credential } = yield* shareThreadFor(
        roomThreadId,
        "/work/tree",
      );
      const boxes = yield* RoomBoxes.RoomBoxes;
      const owner = { threadId: roomThreadId };
      const put = (noteId: string, kind: "thread" | "artifact", text: string) =>
        ({ type: "note.put", noteId, text, x: 0, y: 0, kind }) as const;
      yield* guestShares.changeBoard(owner, put("box:1", "thread", "Landing page"));
      yield* guestShares.changeBoard(owner, put("art:1", "artifact", "Hero"));
      const roomShare = orchestrator
        .getThreadRecords(roomThreadId, [])
        .pipe(Effect.map(({ thread }) => thread.guestShare!));

      const { boxThreadId } = yield* boxes.prompt({
        threadId: roomThreadId,
        boxId: "box:1",
        text: "Make the hero",
        cards: [{ label: "Note from Sam", author: "guest", name: "Sam", text: "Dark mode" }],
        artifactId: "art:1",
      });
      assert.notEqual(boxThreadId, roomThreadId);
      assert.deepEqual((yield* roomShare).boardThreads, { "box:1": boxThreadId });
      const made = yield* orchestrator.getThreadRecords(boxThreadId, ["messages"]);
      assert.deepInclude(made.thread, {
        title: "Landing page",
        worktreePath: "/work/tree",
        projectId: ProjectId.make("project:guest-share-service"),
      });
      const [asked] = made.messages;
      assert.isTrue(asked?.text.startsWith("Make the hero\n\n[Board · 1 card]("));
      assert.deepEqual(
        asked?.context?.records.map((record) => record.kind),
        ["room-cards", "room-artifact", "room-box"],
      );
      assert.deepInclude(asked?.context?.records[1], {
        noteId: "art:1",
        threadId: roomThreadId,
        boxId: "box:1",
      });
      // The room thread's own card runs in the room thread.
      const inRoom = yield* boxes.prompt({ threadId: roomThreadId, boxId: "thread", text: "Hi" });
      assert.equal(inRoom.boxThreadId, roomThreadId);
      // Prompted again, the box keeps its thread.
      // A card that says which it is gets its label and author from the board; one gone is not sent.
      const again = yield* boxes.prompt({
        threadId: roomThreadId,
        boxId: "box:1",
        text: "More",
        cards: [
          { ref: "note:art:1", label: "Artifact from You", author: "guest", text: "Hero" },
          { ref: "note:gone", label: "Note from You", author: "owner", text: "Gone" },
        ],
      });
      assert.equal(again.boxThreadId, boxThreadId);
      const both = (yield* orchestrator.getThreadRecords(boxThreadId, ["messages"])).messages;
      assert.lengthOf(both, 2);
      assert.deepInclude(both[1]?.context?.records[0], {
        kind: "room-cards",
        cards: [{ ref: "note:art:1", label: 'Artifact "Hero"', author: "owner", text: "Hero" }],
      });

      // A guest's box is run by their own requests, which the owner sends.
      const sam = yield* guestShares.redeem({ credential, name: "Sam" });
      yield* guestShares.changeBoard({ session: sam.token }, put("box:sam", "thread", "Sam's"));
      const theirs = yield* Effect.flip(
        boxes.prompt({ threadId: roomThreadId, boxId: "box:sam", text: "Mine now" }),
      );
      assert.equal(theirs.reason, "not_yours");

      // Removing the box forgets its thread and leaves it.
      yield* guestShares.changeBoard(owner, { type: "note.remove", noteId: "box:1" });
      assert.isUndefined((yield* roomShare).boardThreads);
      const kept = yield* orchestrator.getThreadRecords(boxThreadId, []);
      assert.isNull(kept.thread.deletedAt);
      const gone = yield* Effect.flip(
        boxes.prompt({ threadId: roomThreadId, boxId: "box:1", text: "Still there?" }),
      );
      assert.equal(gone.reason, "box_gone");
    }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "sends a guest's request for their own box in that box's thread, with only server-built text",
  () =>
    Effect.gen(function* () {
      const roomThreadId = ThreadId.make("thread:guest-boxes");
      const { orchestrator, guestShares, credential } = yield* shareThreadFor(roomThreadId);
      const boxes = yield* RoomBoxes.RoomBoxes;
      const sam = yield* guestShares.redeem({ credential, name: "Sam" });
      const eve = yield* guestShares.redeem({ credential, name: "Eve" });
      yield* guestShares.changeBoard(
        { session: sam.token },
        { type: "note.put", noteId: "box:sam", text: "Sam's page", x: 0, y: 0, kind: "thread" },
      );
      yield* guestShares.changeBoard(
        { threadId: roomThreadId },
        { type: "note.put", noteId: "art:1", text: "Page", x: 0, y: 0, kind: "artifact" },
      );
      const ask = (who: typeof sam, text: string, boxId: string) =>
        guestShares.submit(
          who.token,
          {
            shareId: who.shareId,
            text,
            boxId,
            artifactId: "art:1",
            cardRefs: ["note:art:1", "note:box:sam", "note:missing"],
          },
          [],
        );
      // Someone else's box, and one that is not on the board, take nothing.
      assert.equal((yield* Effect.flip(ask(eve, "Mine?", "box:sam"))).reason, "box_not_yours");
      assert.equal((yield* Effect.flip(ask(sam, "Where?", "box:none"))).reason, "box_gone");
      yield* ask(sam, "Make it dark", "box:sam");
      const room = orchestrator.getThreadRecords(roomThreadId, ["messages"]);
      const waiting = (yield* room).thread.guestShare!.messages[0]!;
      assert.deepInclude(waiting, { status: "pending", boxId: "box:sam", artifactId: "art:1" });
      // Labelled from the board, so they read the same to everyone.
      assert.deepEqual(waiting.cards, ['Artifact "Page"', `Thread box "Sam's page"`]);

      yield* boxes.sendGuestMessage({ threadId: roomThreadId, guestMessageId: waiting.id }, "web");
      const afterSend = yield* room;
      const sent = afterSend.thread.guestShare!.messages[0]!;
      const boxThreadId = afterSend.thread.guestShare!.boardThreads!["box:sam"]!;
      assert.equal(sent.status, "sent");
      // It ran in the box's thread, never the room thread.
      assert.lengthOf(afterSend.messages, 0);
      const [delivered] = (yield* orchestrator.getThreadRecords(boxThreadId, ["messages"]))
        .messages;
      assert.equal(sent.sentAs, delivered?.id);
      assert.isTrue(
        delivered?.text.startsWith("Message from guest Sam, sent by the owner:\n\nMake it dark"),
      );
      assert.isUndefined(delivered?.context?.guest);
      assert.deepEqual(
        delivered?.context?.records.map((record) => record.kind),
        ["room-artifact", "room-box"],
      );
      assert.deepInclude(delivered?.context?.records[0], {
        noteId: "art:1",
        threadId: roomThreadId,
        boxId: "box:sam",
      });
      // Sending again finds nothing waiting.
      const twice = yield* Effect.flip(
        boxes.sendGuestMessage({ threadId: roomThreadId, guestMessageId: waiting.id }, "web"),
      );
      assert.equal(twice.reason, "not_pending");
      // A guest never sees the owner's thread behind a box, or which message it was sent as.
      const [opened] = Array.from(
        yield* Stream.runCollect(Stream.take(yield* guestShares.stream(sam.token), 1)),
      );
      if (opened?.type !== "view") return assert.fail("Expected the share view first.");
      assert.notProperty(opened.view, "boardThreads");
      assert.notProperty(opened.view.messages[0], "sentAs");
      assert.equal(opened.view.messages[0]?.boxId, "box:sam");

      // Once the box is gone, a request for it goes to the room thread like any other.
      yield* ask(sam, "Still dark?", "box:sam");
      yield* guestShares.changeBoard(
        { threadId: roomThreadId },
        { type: "note.remove", noteId: "box:sam" },
      );
      const later = (yield* room).thread.guestShare!.messages.at(-1)!;
      yield* boxes.sendGuestMessage({ threadId: roomThreadId, guestMessageId: later.id }, "web");
      const [inRoom] = (yield* room).messages;
      assert.isTrue(inRoom?.text.startsWith("Message from guest Sam, sent by the owner:"));
      assert.equal(inRoom?.context?.guest?.guestMessageId, later.id);

      // The owner's Dismiss goes the same way as Send, and only once.
      yield* ask(sam, "Never mind", "thread");
      const unwanted = (yield* room).thread.guestShare!.messages.at(-1)!;
      const dismiss = boxes.resolveGuestMessage({
        threadId: roomThreadId,
        guestMessageId: unwanted.id,
        decision: "dismiss",
      });
      yield* dismiss;
      assert.equal((yield* room).thread.guestShare!.messages.at(-1)?.status, "dismissed");
      assert.equal((yield* Effect.flip(dismiss)).reason, "not_pending");
    }).pipe(Effect.provide(layerTest)),
);
