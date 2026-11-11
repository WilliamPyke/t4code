import { ORCHESTRATION_V2_WS_METHODS, ThreadId, WS_METHODS, WsRpcGroup } from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Stream from "effect/Stream";
import * as RpcSchema from "effect/rpc/RpcSchema";

import { GuestConnectionTarget, type PreparedConnection } from "../connection/model.ts";
import { guestEnvironmentId } from "../environment/guest.ts";
import { connectGuestSession, GuestShareAccess, GuestShareFetch } from "./guestSession.ts";

const TARGET = new GuestConnectionTarget({
  environmentId: guestEnvironmentId("share-1"),
  label: "sam.tunnel.test",
  httpBaseUrl: "https://sam.tunnel.test",
  shareId: "share-1",
  threadId: ThreadId.make("thread-1"),
});
const prepared = (token: string | null): PreparedConnection => ({
  environmentId: TARGET.environmentId,
  label: TARGET.label,
  httpBaseUrl: TARGET.httpBaseUrl,
  socketUrl: "",
  httpAuthorization: token === null ? null : { _tag: "Bearer", token },
  target: TARGET,
});

const MAPPED: ReadonlySet<string> = new Set([
  WS_METHODS.subscribeServerConfig,
  WS_METHODS.serverGetConfig,
  WS_METHODS.serverProbe,
  ORCHESTRATION_V2_WS_METHODS.subscribeShell,
  ORCHESTRATION_V2_WS_METHODS.subscribeThread,
  ORCHESTRATION_V2_WS_METHODS.getTurnItem,
  ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput,
  ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
]);

interface SentRequest {
  readonly url: string;
  readonly method: string;
  readonly authorization: string | null;
  readonly credentials: RequestCredentials | undefined;
  readonly body: string | null;
}

/** The owner's host as a guest session sees it: what it was asked, and what it answers. */
const host = (answer: (path: string) => Response = () => new Response(null, { status: 204 })) => {
  const sent: Array<SentRequest> = [];
  const ended: Array<string> = [];
  const titles: Array<string> = [];
  const online: Array<ReadonlyArray<string>> = [];
  const run = <A, E>(effect: Effect.Effect<A, E>) =>
    effect.pipe(
      Effect.provideService(GuestShareFetch, async (input, init) => {
        const url = new URL(String(input));
        sent.push({
          url: `${url.pathname}${url.search}`,
          method: init?.method ?? "GET",
          authorization: new Headers(init?.headers).get("authorization"),
          credentials: init?.credentials,
          body: typeof init?.body === "string" ? init.body : null,
        });
        return answer(url.pathname);
      }),
      Effect.provideService(GuestShareAccess, {
        share: () => Effect.succeedSome({ token: "guest-token", title: "Review me" }),
        viewed: (_shareId, view) => Effect.sync(() => void titles.push(view.title)),
        presence: (_shareId, guests) => Effect.sync(() => void online.push(guests)),
        ended: (shareId) => Effect.sync(() => void ended.push(shareId)),
      }),
    );
  return { sent, ended, titles, online, run };
};

/** Every failure of the guest client is a tagged error. */
interface Refusal {
  readonly _tag: string;
}

const call = (client: object, method: string, input: unknown) =>
  (client as Record<string, (input: unknown) => unknown>)[method]!(input);

it.effect("refuses every method that has no guest route, and asks the host for nothing", () => {
  const owner = host();
  return owner.run(
    Effect.gen(function* () {
      const { session, denied } = yield* connectGuestSession(prepared("guest-token"), TARGET);
      const unmapped = [...WsRpcGroup.requests.keys()].filter((method) => !MAPPED.has(method));
      expect(unmapped.length).toBeGreaterThan(150);
      for (const method of unmapped) {
        const streams = RpcSchema.isStreamSchema(WsRpcGroup.requests.get(method)!.successSchema);
        const result = call(session.client, method, {});
        // A method that answered would fail the flip, and the test with it.
        const error = yield* Effect.flip(
          streams
            ? Stream.runDrain(result as Stream.Stream<void, Refusal>)
            : (result as Effect.Effect<void, Refusal>),
        );
        expect(error._tag, method).toBe("EnvironmentAuthorizationError");
      }
      expect(denied).toEqual(unmapped);
      expect(owner.sent).toEqual([]);
    }),
  );
});

it.effect("turns a message into one post to the messages route, and no other command", () => {
  const owner = host();
  return owner.run(
    Effect.gen(function* () {
      const { session, denied } = yield* connectGuestSession(prepared("guest-token"), TARGET);
      const dispatch = (command: object) =>
        Effect.exit(
          call(
            session.client,
            ORCHESTRATION_V2_WS_METHODS.dispatchCommand,
            command,
          ) as Effect.Effect<unknown, Refusal>,
        );
      for (const command of [
        { type: "thread.archive", threadId: TARGET.threadId },
        { type: "thread.interrupt", threadId: TARGET.threadId },
        { type: "runtime-request.respond", threadId: TARGET.threadId },
        { type: "thread.metadata.update", threadId: TARGET.threadId, title: "Mine now" },
        // A guest's files go through the page's form, never a command.
        { type: "message.dispatch", text: "Hi", attachments: [{ id: "file-1" }] },
      ]) {
        expect(Exit.isFailure(yield* dispatch(command)), command.type).toBe(true);
      }
      expect(owner.sent).toEqual([]);
      expect(denied).toHaveLength(5);

      const sent = yield* dispatch({
        type: "message.dispatch",
        text: "Try the other branch",
        attachments: [],
        // Nothing but the text reaches the owner's server: it decides the rest.
        modelSelection: { instanceId: "codex", model: "gpt-5" },
        dispatchMode: { type: "start_now" },
      });
      expect(Exit.isSuccess(sent)).toBe(true);
      expect(owner.sent).toEqual([
        {
          url: "/api/guest/messages?share=share-1",
          method: "POST",
          authorization: "Bearer guest-token",
          credentials: "omit",
          body: JSON.stringify({ shareId: "share-1", text: "Try the other branch" }),
        },
      ]);
    }),
  );
});

const eventStream = (events: ReadonlyArray<object>) =>
  new Response(
    `: ping\n\n${events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")}`,
    {
      headers: { "content-type": "text/event-stream" },
    },
  );
const VIEW = {
  shareId: "share-1",
  title: "Renamed",
  guestName: "Sam",
  guests: [],
  direct: false,
  expiresAt: "2026-11-12T00:00:00.000Z",
  messages: [],
  model: { driver: null, name: "GPT" },
};

it.effect("reads the thread from the share's stream, and forgets the share when it ends", () => {
  const owner = host((path) =>
    path === "/api/guest/stream"
      ? eventStream([
          { type: "view", view: VIEW },
          { type: "presence", online: ["guest-1"] },
          { type: "thread", item: { kind: "synchronized" } },
          { type: "thread", item: { kind: "synchronized" } },
          { type: "from-a-newer-server" },
          { type: "ended" },
          { type: "thread", item: { kind: "synchronized" } },
        ])
      : new Response(null, { status: 204 }),
  );
  return owner.run(
    Effect.gen(function* () {
      const { session } = yield* connectGuestSession(prepared(null), TARGET);
      yield* session.ready;
      const items = yield* Stream.runCollect(
        call(session.client, ORCHESTRATION_V2_WS_METHODS.subscribeThread, {
          threadId: TARGET.threadId,
        }) as Stream.Stream<{ readonly kind: string }, Refusal>,
      );
      // The first thread item is followed by the marker the thread state waits for; nothing
      // after `ended` is read, and an event this client does not know is skipped.
      expect(items.map((item) => item.kind)).toEqual([
        "synchronized",
        "synchronized",
        "synchronized",
      ]);
      expect(owner.titles).toEqual(["Renamed"]);
      expect(owner.online).toEqual([["guest-1"]]);
      expect(owner.ended).toEqual(["share-1"]);
      const closed = yield* Effect.flip(session.closed);
      expect(closed._tag).toBe("ConnectionBlockedError");
      // On the owner's own host there is no token: the share's cookie signs each request.
      expect(owner.sent).toEqual([
        {
          url: "/api/guest/session?share=share-1",
          method: "GET",
          authorization: null,
          credentials: "same-origin",
          body: null,
        },
        {
          url: "/api/guest/stream?share=share-1",
          method: "GET",
          authorization: null,
          credentials: "same-origin",
          body: null,
        },
      ]);
    }),
  );
});

it.effect("forgets a share its owner's server no longer lets this guest into", () => {
  const owner = host(() => new Response(null, { status: 403 }));
  return owner.run(
    Effect.gen(function* () {
      const { session } = yield* connectGuestSession(prepared("guest-token"), TARGET);
      expect((yield* Effect.flip(session.ready))._tag).toBe("ConnectionBlockedError");
      expect(owner.ended).toEqual(["share-1"]);
    }),
  );
});

it.effect("keeps a share while its owner's host is only unreachable", () => {
  const owner = host(() => new Response(null, { status: 502 }));
  return owner.run(
    Effect.gen(function* () {
      const { session } = yield* connectGuestSession(prepared("guest-token"), TARGET);
      expect((yield* Effect.flip(session.ready))._tag).toBe("ConnectionTransientError");
      expect(owner.ended).toEqual([]);
    }),
  );
});
