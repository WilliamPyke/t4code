import { assert, it } from "@effect/vitest";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  SHARED_THREAD_MAX_MESSAGES,
  type SharedThreadExport,
  type SharedThreadJoinInput,
  ThreadId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/http";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as SharedThreadJoin from "./SharedThreadJoin.ts";

const shared: SharedThreadExport = {
  title: "Fix login",
  messages: [
    { role: "user", text: "Why does login fail?", createdAt: "2026-11-09T10:00:00.000Z" },
    // A zero-width space and a hidden tag character, which a reader cannot see.
    {
      role: "assistant",
      text: "The token​ expires\u{E0041} early.",
      createdAt: "2026-11-09T10:00:05.000Z",
    },
  ],
  truncated: true,
  checkout: { repositoryKey: "github.com/acme/app", branch: "fix/login", synced: true },
};

const input: SharedThreadJoinInput = {
  commandId: CommandId.make("command:join"),
  source: { host: "sam.t3.test", token: "handoff-token" },
  projectId: ProjectId.make("project:mine"),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.5" },
  runtimeMode: "approval-required",
  interactionMode: "default",
  checkout: true,
};

/** The other machine's reply, the requests it got, and what this machine launched. */
const world = Effect.fn(function* (reply: { readonly status: number; readonly body: unknown }) {
  const requests = yield* Ref.make<
    ReadonlyArray<{ url: string; authorization: string | undefined }>
  >([]);
  const launches = yield* Ref.make<ReadonlyArray<ThreadLaunch.ThreadLaunchInput>>([]);
  const layer = SharedThreadJoin.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Ref.update(requests, (seen) => [
            ...seen,
            { url: request.url, authorization: request.headers["authorization"] },
          ]).pipe(
            Effect.as(
              HttpClientResponse.fromWeb(
                request,
                new Response(JSON.stringify(reply.body), {
                  status: reply.status,
                  headers: { "content-type": "application/json" },
                }),
              ),
            ),
          ),
        ),
      ),
    ),
    Layer.provide(
      Layer.mock(ThreadLaunch.ThreadLaunchService)({
        launch: (launch) =>
          Ref.update(launches, (seen) => [...seen, launch]).pipe(
            Effect.as({ threadId: ThreadId.make("thread:joined") } as never),
          ),
      }),
    ),
  );
  return { requests, launches, layer };
});

it("fetches a shared thread only from a public-looking https host", () => {
  assert.equal(
    SharedThreadJoin.sharedThreadExportUrl("Sam.T3.test"),
    "https://sam.t3.test/api/guest/export",
  );
  for (const host of [
    "localhost",
    "127.0.0.1",
    "10.0.0.5",
    "sam.t3.test:8080",
    "sam.t3.test/path",
    "user@sam.t3.test",
    "[::1]",
    "printer.local",
    "db.internal",
    "intranet",
    "",
  ]) {
    assert.isNull(SharedThreadJoin.sharedThreadExportUrl(host), host);
  }
});

it.effect("launches a thread of the user's own from the other machine's export", () =>
  Effect.gen(function* () {
    const { requests, launches, layer } = yield* world({ status: 200, body: shared });
    const joined = yield* Effect.gen(function* () {
      const sharedThreads = yield* SharedThreadJoin.SharedThreadJoin;
      assert.deepEqual(yield* sharedThreads.preview(input.source), {
        title: "Fix login",
        messageCount: 2,
        truncated: true,
        checkout: shared.checkout,
      });
      const withCode = yield* sharedThreads.join(input);
      yield* sharedThreads.join({ ...input, checkout: false });
      return withCode;
    }).pipe(Effect.provide(layer));

    assert.equal(joined.threadId, "thread:joined");
    // The token goes to the host the link names, and nowhere else.
    for (const request of yield* Ref.get(requests)) {
      assert.deepEqual(request, {
        url: "https://sam.t3.test/api/guest/export",
        authorization: "Bearer handoff-token",
      });
    }
    const [withCode, conversationOnly] = yield* Ref.get(launches);
    assert.deepEqual(withCode?.workspaceStrategy, {
      type: "worktree",
      baseRef: "fix/login",
      startFromOrigin: true,
    });
    assert.deepEqual(conversationOnly?.workspaceStrategy, { type: "root" });
    // The user's own model and permission mode, never the other machine's.
    assert.equal(withCode?.runtimeMode, "approval-required");
    assert.deepEqual(withCode?.modelSelection, input.modelSelection);
    assert.equal(withCode?.initialMessage, undefined);
    assert.deepEqual(
      withCode?.importedHistory?.messages.map((message) => message.text),
      ["Why does login fail?", "The token expires early."],
    );
    assert.include(withCode?.importedHistory?.notice, "earlier messages were left out");
  }),
);

it.effect("refuses an export it cannot trust and creates nothing", () =>
  Effect.gen(function* () {
    const failure = Effect.fn(function* (
      reply: { readonly status: number; readonly body: unknown },
      join: SharedThreadJoinInput = input,
    ) {
      const { launches, layer } = yield* world(reply);
      const error = yield* Effect.flip(
        Effect.flatMap(SharedThreadJoin.SharedThreadJoin, (sharedThreads) =>
          sharedThreads.join(join),
        ).pipe(Effect.provide(layer)),
      );
      assert.lengthOf(yield* Ref.get(launches), 0);
      return error.reason;
    });
    // The owner stopped sharing, removed the guest, or the token ran out.
    assert.equal(yield* failure({ status: 403, body: { reason: "inactive" } }), "expired");
    assert.equal(yield* failure({ status: 502, body: {} }), "unreachable");
    assert.equal(yield* failure({ status: 200, body: { title: 1 } }), "invalid_response");
    const tooMany = Array.from(
      { length: SHARED_THREAD_MAX_MESSAGES + 1 },
      () => shared.messages[0],
    );
    assert.equal(
      yield* failure({ status: 200, body: { ...shared, messages: tooMany } }),
      "invalid_response",
    );
    assert.equal(
      yield* failure(
        { status: 200, body: shared },
        { ...input, source: { host: "127.0.0.1", token: "handoff-token" } },
      ),
      "invalid_host",
    );
  }),
);
