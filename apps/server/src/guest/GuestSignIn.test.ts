import { assert, it } from "@effect/vitest";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import * as GuestSignIn from "./GuestSignIn.ts";

/** GitHub as the sign-in sees it: the answers to give, and the requests it got. */
const github = Effect.fn(function* (clientId: string) {
  const requests = yield* Ref.make<ReadonlyArray<string>>([]);
  const tokenAnswers = yield* Ref.make<ReadonlyArray<object>>([]);
  const layer = GuestSignIn.layer.pipe(
    Layer.provide(
      Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make((request) =>
          Effect.gen(function* () {
            const path = new URL(request.url).pathname;
            yield* Ref.update(requests, (seen) => [
              ...seen,
              path === "/user" ? `/user ${request.headers["authorization"]}` : path,
            ]);
            const body =
              path === "/login/device/code"
                ? {
                    device_code: "device",
                    user_code: "ABCD-1234",
                    verification_uri: "https://github.com/login/device",
                    expires_in: 900,
                    interval: 5,
                  }
                : path === "/login/oauth/access_token"
                  ? yield* Ref.modify(tokenAnswers, ([next, ...rest]) => [next ?? {}, rest])
                  : { login: "sam-dev", id: 7 };
            return HttpClientResponse.fromWeb(
              request,
              new Response(JSON.stringify(body), {
                status: 200,
                headers: { "content-type": "application/json" },
              }),
            );
          }),
        ),
      ),
    ),
    Layer.provide(
      Layer.succeed(HostProcess.Environment, { T3CODE_GITHUB_APP_CLIENT_ID: clientId }),
    ),
  );
  return { requests, tokenAnswers, layer };
});

it.effect("reads the account once the guest finishes, asking GitHub no faster than it allows", () =>
  Effect.gen(function* () {
    const { requests, tokenAnswers, layer } = yield* github("client");
    yield* Ref.set(tokenAnswers, [
      { error: "authorization_pending" },
      { error: "slow_down", interval: 10 },
      { access_token: "guest-token" },
    ]);
    yield* Effect.gen(function* () {
      const signIn = yield* GuestSignIn.GuestSignIn;
      const prompt = yield* signIn.start("share:guest");
      assert.equal(prompt.userCode, "ABCD-1234");
      // A page that asks at once is answered without a request to GitHub.
      assert.isTrue(Option.isNone(yield* signIn.poll("share:guest")));
      yield* TestClock.adjust("5 seconds");
      assert.isTrue(Option.isNone(yield* signIn.poll("share:guest")));
      yield* TestClock.adjust("5 seconds");
      assert.isTrue(Option.isNone(yield* signIn.poll("share:guest")));
      // GitHub asked for ten seconds between requests from here on.
      yield* TestClock.adjust("5 seconds");
      assert.isTrue(Option.isNone(yield* signIn.poll("share:guest")));
      yield* TestClock.adjust("5 seconds");
      assert.deepEqual(yield* signIn.poll("share:guest"), Option.some({ login: "sam-dev", id: 7 }));
      // The finished sign-in is spent.
      assert.equal((yield* Effect.flip(signIn.poll("share:guest"))).reason, "expired");
    }).pipe(Effect.provide(layer));
    assert.deepEqual(yield* Ref.get(requests), [
      "/login/device/code",
      "/login/oauth/access_token",
      "/login/oauth/access_token",
      "/login/oauth/access_token",
      "/user Bearer guest-token",
    ]);
  }),
);

it.effect("refuses a sign-in the guest cancelled, and any on a server without a client ID", () =>
  Effect.gen(function* () {
    const { tokenAnswers, layer } = yield* github("client");
    yield* Ref.set(tokenAnswers, [{ error: "access_denied" }]);
    yield* Effect.gen(function* () {
      const signIn = yield* GuestSignIn.GuestSignIn;
      yield* signIn.start("share:guest");
      yield* TestClock.adjust("5 seconds");
      assert.equal((yield* Effect.flip(signIn.poll("share:guest"))).reason, "denied");
    }).pipe(Effect.provide(layer));

    const unconfigured = yield* github(" ");
    yield* Effect.gen(function* () {
      const signIn = yield* GuestSignIn.GuestSignIn;
      assert.isFalse(signIn.enabled);
      assert.equal((yield* Effect.flip(signIn.start("share:guest"))).reason, "unavailable");
    }).pipe(Effect.provide(unconfigured.layer));
    assert.deepEqual(yield* Ref.get(unconfigured.requests), []);
  }),
);
