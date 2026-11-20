import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as TestClock from "effect/testing/TestClock";

import * as GuestSignIn from "./GuestSignIn.ts";

const REDIRECT_URI = "https://env.t3.test/api/guest/sign-in/callback";
const CONFIGURED = {
  T3CODE_GITHUB_APP_CLIENT_ID: "client",
  T3CODE_GITHUB_APP_CLIENT_SECRET: "secret",
};

/** GitHub as the sign-in sees it: the answers to give, and the requests it got. */
const github = Effect.fn(function* (env: Record<string, string>) {
  const requests = yield* Ref.make<ReadonlyArray<string>>([]);
  const tokenAnswers = yield* Ref.make<ReadonlyArray<object>>([]);
  const layer = GuestSignIn.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        NodeCrypto.layer,
        ConfigProvider.layer(ConfigProvider.fromEnv({ env })),
        Layer.succeed(
          HttpClient.HttpClient,
          HttpClient.make((request) =>
            Effect.gen(function* () {
              const path = new URL(request.url).pathname;
              const sent =
                path === "/user"
                  ? request.headers["authorization"]
                  : request.body._tag === "Uint8Array"
                    ? new TextDecoder().decode(request.body.body)
                    : "";
              yield* Ref.update(requests, (seen) => [...seen, `${path} ${sent}`]);
              const body =
                path === "/login/oauth/access_token"
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
    ),
  );
  return { requests, tokenAnswers, layer };
});

it.effect("reads the account once per state, for the session that started it", () =>
  Effect.gen(function* () {
    const { requests, tokenAnswers, layer } = yield* github(CONFIGURED);
    yield* Ref.set(tokenAnswers, [{ access_token: "guest-token" }]);
    yield* Effect.gen(function* () {
      const signIn = yield* GuestSignIn.GuestSignIn;
      assert.isTrue(signIn.enabled);
      const sam = yield* signIn.start({ session: "sam", redirectUri: REDIRECT_URI });
      const eve = yield* signIn.start({ session: "eve", redirectUri: REDIRECT_URI });
      assert.notEqual(sam.state, eve.state);
      // The guest's browser carries only public values to GitHub, and asks for no scope.
      const url = new URL(eve.url);
      assert.equal(url.origin + url.pathname, "https://github.com/login/oauth/authorize");
      assert.deepEqual(Object.fromEntries(url.searchParams), {
        client_id: "client",
        redirect_uri: REDIRECT_URI,
        state: eve.state,
      });

      assert.deepEqual(yield* signIn.finish({ state: eve.state, code: "eve-code" }), {
        session: "eve",
        account: { login: "sam-dev", id: 7 },
      });
      const afterFirst = yield* Ref.get(requests);
      assert.deepEqual(afterFirst, [
        `/login/oauth/access_token ${new URLSearchParams({
          client_id: "client",
          client_secret: "secret",
          code: "eve-code",
          redirect_uri: REDIRECT_URI,
        })}`,
        "/user Bearer guest-token",
      ]);

      // A state works once, and one nobody was given never does.
      for (const state of [eve.state, "forged", ""]) {
        const refused = yield* Effect.flip(signIn.finish({ state, code: "eve-code" }));
        assert.equal(refused.reason, "expired");
      }
      assert.deepEqual(yield* Ref.get(requests), afterFirst);
    }).pipe(Effect.provide(layer));
  }),
);

it.effect("refuses a state that waited too long or that its session replaced", () =>
  Effect.gen(function* () {
    const { requests, layer } = yield* github(CONFIGURED);
    yield* Effect.gen(function* () {
      const signIn = yield* GuestSignIn.GuestSignIn;
      const first = yield* signIn.start({ session: "sam", redirectUri: REDIRECT_URI });
      const second = yield* signIn.start({ session: "sam", redirectUri: REDIRECT_URI });
      assert.equal(
        (yield* Effect.flip(signIn.finish({ state: first.state, code: "code" }))).reason,
        "expired",
      );
      yield* TestClock.adjust("10 minutes");
      assert.equal(
        (yield* Effect.flip(signIn.finish({ state: second.state, code: "code" }))).reason,
        "expired",
      );
    }).pipe(Effect.provide(layer));
    assert.deepEqual(yield* Ref.get(requests), []);
  }),
);

it.effect("names no account when GitHub refuses the code or the guest cancels", () =>
  Effect.gen(function* () {
    const { requests, tokenAnswers, layer } = yield* github(CONFIGURED);
    yield* Ref.set(tokenAnswers, [{ error: "bad_verification_code" }]);
    yield* Effect.gen(function* () {
      const signIn = yield* GuestSignIn.GuestSignIn;
      const refused = yield* signIn.start({ session: "sam", redirectUri: REDIRECT_URI });
      assert.equal(
        (yield* Effect.flip(signIn.finish({ state: refused.state, code: "bad" }))).reason,
        "failed",
      );
      // The refused state is spent too, so it cannot be tried with another code.
      assert.equal(
        (yield* Effect.flip(signIn.finish({ state: refused.state, code: "good" }))).reason,
        "expired",
      );
      const cancelled = yield* signIn.start({ session: "sam", redirectUri: REDIRECT_URI });
      assert.equal(
        (yield* Effect.flip(signIn.finish({ state: cancelled.state, code: null }))).reason,
        "denied",
      );
    }).pipe(Effect.provide(layer));
    // One token request, and no profile read.
    assert.equal((yield* Ref.get(requests)).length, 1);
  }),
);

it.effect("is off unless the server has both the client ID and the client secret", () =>
  Effect.gen(function* () {
    for (const env of [
      {},
      { T3CODE_GITHUB_APP_CLIENT_ID: "client" },
      { T3CODE_GITHUB_APP_CLIENT_SECRET: "secret" },
      { T3CODE_GITHUB_APP_CLIENT_ID: "client", T3CODE_GITHUB_APP_CLIENT_SECRET: " " },
    ]) {
      const { requests, layer } = yield* github(env);
      yield* Effect.gen(function* () {
        const signIn = yield* GuestSignIn.GuestSignIn;
        assert.isFalse(signIn.enabled);
        assert.equal(
          (yield* Effect.flip(signIn.start({ session: "sam", redirectUri: REDIRECT_URI }))).reason,
          "unavailable",
        );
      }).pipe(Effect.provide(layer));
      assert.deepEqual(yield* Ref.get(requests), []);
    }
  }),
);
