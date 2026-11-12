import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import {
  GuestId,
  GuestShareId,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2TurnItem,
  type RoomBoxProgress,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RoomBoxes from "./RoomBoxes.ts";

const shareId = GuestShareId.make("share:1");
const roomThreadId = ThreadId.make("thread:room");
const boxThreadId = ThreadId.make("thread:box");
const strayThreadId = ThreadId.make("thread:stray");
const sam = GuestId.make("guest:sam");

const record = (kind: string, fields: object) => ({
  version: 1,
  contextId: `${kind}_1`,
  kind,
  label: kind,
  ...fields,
});
const asked = (records: ReadonlyArray<object>) =>
  [
    { type: "user_message", ordinal: 1, text: "Go", context: { version: 1, records } },
  ] as unknown as ReadonlyArray<OrchestrationV2TurnItem>;
const boxRecord = record("room-box", { payload: { shareId, boxId: "box:b" } });
const itemsByRun: Record<string, ReadonlyArray<OrchestrationV2TurnItem>> = {
  "run:room": asked([record("room-artifact", { shareId, noteId: "art:a", title: "A" })]),
  "run:box": asked([boxRecord]),
  // Says it is the box's, from a thread the share never recorded for it.
  "run:stray": asked([boxRecord]),
};
const threads: Record<string, object> = {
  [roomThreadId]: {
    id: roomThreadId,
    guestShare: {
      id: shareId,
      board: {
        positions: {},
        notes: [
          { id: "box:b", text: "B", x: 0, y: 0, kind: "thread" },
          { id: "art:a", text: "A", x: 0, y: 0, kind: "artifact" },
        ],
      },
      // Sam's request, which the owner sent in the box's thread as `message:asked`.
      messages: [
        {
          id: "guest-message:1",
          text: "Make it dark",
          status: "sent",
          submittedAt: "1970-01-01T00:00:00.000Z",
          guestId: sam,
          boxId: "box:b",
          sentAs: "message:asked",
        },
      ],
      boardThreads: { "box:b": boxThreadId },
    },
  },
  [boxThreadId]: { id: boxThreadId, guestShare: null },
  [strayThreadId]: { id: strayThreadId, guestShare: null },
};

const run = (id: string, threadId: ThreadId, status: string, type = "run.updated") =>
  ({
    type,
    threadId,
    payload: {
      id,
      status,
      userMessageId: id === "run:box" ? "message:asked" : `message:${id}`,
      requestedAt: DateTime.makeUnsafe(0),
      startedAt: null,
      modelSelection: { instanceId: "codex", model: "gpt-5.1-codex" },
    },
  }) as unknown as OrchestrationV2DomainEvent;
const turnItem = (runId: string, fields: object) =>
  ({
    type: "turn-item.updated",
    threadId: roomThreadId,
    payload: { runId, ordinal: 2, status: "running", ...fields },
  }) as unknown as OrchestrationV2DomainEvent;

const request = (id: string, threadId: ThreadId, status: string) =>
  ({
    type: "runtime-request.updated",
    threadId,
    payload: { id, kind: "file_change", status },
  }) as unknown as OrchestrationV2DomainEvent;

const layerWith = (events: Queue.Queue<OrchestrationV2DomainEvent>) =>
  RoomBoxes.layer.pipe(
    Layer.provide(
      Layer.mock(Orchestrator.OrchestratorV2)({
        streamDomainEvents: Stream.fromQueue(events),
        findGuestShareThreadId: (id) => Effect.succeed(id === shareId ? roomThreadId : null),
        getThreadRecords: (threadId, _fields, filter) =>
          Effect.succeed({
            thread: threads[threadId],
            turnItems: itemsByRun[filter?.turnItemRunIds?.[0] ?? ""] ?? [],
          } as never),
      }),
    ),
    Layer.provide(Layer.mock(ThreadLaunch.ThreadLaunchService)({})),
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

it.effect("shows each box's agent at work about once a second, and nothing once the run ends", () =>
  Effect.gen(function* () {
    const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
    yield* Effect.gen(function* () {
      const boxes = yield* RoomBoxes.RoomBoxes;
      // Waits for the share's progress to reach a state, which the events lead to in order.
      const until = (
        done: (views: RoomBoxes.RoomBoxProgressViews) => boolean,
        share: GuestShareId = shareId,
      ) =>
        boxes
          .progress(share)
          .pipe(Stream.filter(done), Stream.runHead, Effect.map(Option.getOrThrow));
      const of = (views: ReadonlyArray<RoomBoxProgress>, boxId: string) =>
        views.find((entry) => entry.boxId === boxId);

      yield* Queue.offerAll(events, [
        run("run:room", roomThreadId, "queued", "run.created"),
        run("run:room", roomThreadId, "running"),
        // The reply streams on its message; its turn item carries no text of its own.
        {
          type: "message.updated",
          threadId: roomThreadId,
          payload: {
            id: "message:reply",
            runId: "run:room",
            role: "assistant",
            text: "# Plan\nDark mode",
            streaming: true,
          },
        } as unknown as OrchestrationV2DomainEvent,
        turnItem("run:room", { type: "assistant_message", text: "", textOmitted: true }),
        run("run:stray", strayThreadId, "running", "run.created"),
        run("run:box", boxThreadId, "running", "run.created"),
      ]);
      // The box's run shows at once; the room's change waits out its second.
      const first = yield* until((views) => of(views.owner, "box:b") !== undefined);
      assert.deepEqual(first.owner, [
        {
          boxId: "box:b",
          phase: "thinking",
          startedAt: "1970-01-01T00:00:00.000Z",
          model: "GPT-5.1 Codex",
          // The guest's own words, whose request the owner sent.
          prompt: "Make it dark",
          askedBy: sam,
        },
        {
          boxId: "thread",
          artifactId: "art:a",
          phase: "queued",
          startedAt: "1970-01-01T00:00:00.000Z",
          model: "GPT-5.1 Codex",
          prompt: "Go",
        },
      ]);
      yield* TestClock.adjust("1 second");
      const writing = yield* until((views) => of(views.owner, "thread")?.phase === "writing");
      assert.deepInclude(of(writing.owner, "thread"), {
        preview: "# Plan Dark mode",
        draft: "# Plan\nDark mode",
      });
      assert.lengthOf(writing.owner, 2);

      yield* Queue.offerAll(events, [
        turnItem("run:box", { type: "command_execution", input: "cat ~/.ssh/id_rsa" }),
        turnItem("run:room", { type: "dynamic_tool", toolName: "mcp__vault__read", input: {} }),
      ]);
      const tools = yield* until((views) => of(views.owner, "box:b")?.phase === "tool");
      assert.equal(of(tools.owner, "box:b")?.detail, "Running a command");
      // Guests see no word of the work in a box's own thread, which they cannot open.
      assert.notProperty(of(tools.guests, "box:b"), "detail");
      yield* TestClock.adjust("1 second");
      const roomTool = yield* until((views) => of(views.owner, "thread")?.phase === "tool");
      assert.equal(of(roomTool.owner, "thread")?.detail, "mcp__vault__read");
      assert.equal(of(roomTool.guests, "thread")?.detail, "Using a tool");
      // Waiting on the owner shows at once, over the tool, and goes once it is answered.
      yield* Queue.offerAll(events, [
        request("request:1", boxThreadId, "pending"),
        turnItem("run:box", { type: "file_change", fileName: "a.ts" }),
      ]);
      const waiting = yield* until((views) => of(views.owner, "box:b")?.phase === "approval");
      assert.notProperty(of(waiting.owner, "box:b"), "detail");
      yield* Queue.offer(events, request("request:1", boxThreadId, "resolved"));
      const answered = yield* until((views) => of(views.owner, "box:b")?.phase === "tool");
      assert.equal(of(answered.owner, "box:b")?.detail, "Editing files");
      // Another share's room hears nothing of this one.
      assert.deepEqual(yield* until(() => true, GuestShareId.make("share:other")), {
        owner: [],
        guests: [],
      });

      yield* Queue.offerAll(events, [
        run("run:room", roomThreadId, "completed"),
        run("run:box", boxThreadId, "interrupted"),
      ]);
      yield* until((views) => views.owner.length === 0 && views.guests.length === 0);
    }).pipe(Effect.provide(layerWith(events)));
  }),
);
