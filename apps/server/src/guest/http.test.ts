import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { GuestShareId, guestSessionCookieName, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest } from "effect/http";
import * as Etag from "effect/http/Etag";
import * as HttpPlatform from "effect/http/HttpPlatform";

import { GuestShareAccessError, GuestShareService } from "./GuestShareService.ts";
import * as GuestHttp from "./http.ts";
import { readSubmission } from "./http.ts";

const SHARE_A = GuestShareId.make("share-a");
const SHARE_B = GuestShareId.make("share-b");
const refused = new GuestShareAccessError({ reason: "invalid" });
/** Lets the session for share A in, and nothing else. `started` records the sign-ins it began. */
const started: Array<{ readonly session: string; readonly origin: string | null }> = [];
const admit = <A>(session: string, value: A) =>
  session === "session-a" ? Effect.succeed(value) : Effect.fail(refused);
const layerGuestShares = Layer.mock(GuestShareService)({
  sessionShareId: (token) => Effect.succeed(token === "session-a" ? SHARE_A : null),
  redeem: () =>
    Effect.succeed({ token: "session-a", shareId: SHARE_A, threadId: ThreadId.make("thread-a") }),
  check: (session) => admit(session, undefined),
  item: (session) => admit(session, { item: null } as never),
  history: (session) => admit(session, { items: [] } as never),
  commandOutput: (session) => admit(session, Stream.empty),
  attachment: (session) => Effect.flatMap(admit(session, undefined), () => Effect.fail(refused)),
  signInFromHostedApp: (input) =>
    Effect.sync(() => {
      started.push(input);
      return { url: "https://github.test/authorize", cookie: "share-a.state.hosted" };
    }),
});
const layerPlatform = HttpPlatform.layer.pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(Etag.layerWeak),
);

// Route handlers read their services from the request's context.
const guestApi = (use: (send: (request: Request) => Promise<Response>) => Promise<void>) =>
  Effect.gen(function* () {
    const context = yield* Layer.build(Layer.merge(layerGuestShares, layerPlatform));
    const web = yield* Effect.acquireRelease(
      Effect.sync(() => HttpRouter.toWebHandler(GuestHttp.layer, { disableLogger: true })),
      (handler) => Effect.promise(() => handler.dispose()),
    );
    yield* Effect.promise(() => use((request) => web.handler(request, context)));
  }).pipe(Effect.scoped);
const get = (path: string, headers: Record<string, string>) =>
  new Request(`http://localhost/api/guest/${path}`, { headers });
const bearerA = { authorization: "Bearer session-a" };

it.effect("takes a bearer session only for the share it was signed for", () =>
  guestApi(async (send) => {
    assert.equal((await send(get("session?share=share-a", bearerA))).status, 204);
    // The cookie a page on the owner's own host holds still works.
    const cookie = { cookie: `${guestSessionCookieName(SHARE_A)}=session-a` };
    assert.equal((await send(get("session?share=share-a", cookie))).status, 204);
    for (const path of [
      "session?share=share-b",
      "item?share=share-b&item=item-1",
      "history?share=share-b&cursor=cursor-1",
      "command-output?share=share-b&item=item-1",
      "attachment?share=share-b&id=file-1",
      "session",
    ]) {
      assert.equal((await send(get(path, bearerA))).status, 403, path);
    }
    // A bearer for another share is dropped, not passed over for that share's cookie.
    const mixed = { ...bearerA, cookie: `${guestSessionCookieName(SHARE_B)}=session-a` };
    assert.equal((await send(get("session?share=share-b", mixed))).status, 403);
    assert.equal(
      (await send(get("session?share=share-a", { authorization: "Bearer other" }))).status,
      403,
    );
  }),
);

it.effect("returns the session token in the body only to a redeem that asks for it", () =>
  guestApi(async (send) => {
    const redeem = (body: object) =>
      send(
        new Request("http://localhost/api/guest/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ credential: "share-a.signature", name: "Sam", ...body }),
        }),
      );
    const asked = await redeem({ returnToken: true });
    assert.deepEqual(await asked.json(), {
      token: "session-a",
      shareId: "share-a",
      threadId: "thread-a",
    });
    const cookieOnly = await redeem({});
    assert.equal(cookieOnly.status, 204);
    assert.equal(await cookieOnly.text(), "");
    assert.include(cookieOnly.headers.get("set-cookie") ?? "", "session-a");
  }),
);

it.effect("starts a hosted sign-in from a form for the share its token is for", () =>
  guestApi(async (send) => {
    const begin = (share: string) =>
      send(
        new Request("http://localhost/api/guest/sign-in/begin", {
          method: "POST",
          headers: { origin: "https://app.t3.test" },
          body: new URLSearchParams({ token: "session-a", share }),
        }),
      );
    assert.equal((await begin("share-b")).status, 400);
    assert.deepEqual(started, []);
    const response = await begin("share-a");
    assert.equal(response.status, 303);
    assert.equal(response.headers.get("location"), "https://github.test/authorize");
    assert.include(response.headers.get("set-cookie") ?? "", "share-a.state.hosted");
    assert.deepEqual(started, [{ session: "session-a", origin: "https://app.t3.test" }]);
  }),
);

it.effect("keeps a JSON file a guest attaches as a file, not a form field", () =>
  Effect.gen(function* () {
    const form = new FormData();
    form.append("shareId", "share-1");
    form.append("text", "");
    form.append("artifactId", "note:plan");
    form.append("file", new File(['{"a":1}'], "data.json", { type: "application/json" }));
    const request = HttpServerRequest.fromWeb(
      new Request("http://localhost/api/guest/messages?share=share-1", {
        method: "POST",
        body: form,
      }),
    );
    const submission = yield* readSubmission.pipe(
      Effect.provideService(HttpServerRequest.HttpServerRequest, request),
    );
    assert.deepEqual(
      submission?.uploads.map((upload) => [upload.name, upload.contentType]),
      [["data.json", "application/json"]],
    );
    // The artifact card a message is for comes along as a field.
    assert.equal(submission?.fields.artifactId, "note:plan");
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
