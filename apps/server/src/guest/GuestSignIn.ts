import { GUEST_SIGN_IN_TTL_MS, type GuestAccount } from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

import { base64UrlEncode } from "../auth/utils.ts";

// The same GitHub app the Source Control sign-in uses. The web flow also needs its secret.
const CLIENT_ID_VARIABLE = "T3CODE_GITHUB_APP_CLIENT_ID";
const CLIENT_SECRET_VARIABLE = "T3CODE_GITHUB_APP_CLIENT_SECRET";
const AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const REQUEST_TIMEOUT = Duration.seconds(15);
const STATE_BYTES = 32;
// Anyone holding a guest session can start a sign-in, so the waiting ones are capped.
const PENDING_LIMIT = 256;

// GitHub answers the token grant with HTTP 200 and puts refusals in `error`.
const TokenResponse = Schema.Struct({ access_token: Schema.optional(Schema.String) });

const GitHubUser = Schema.Struct({ login: Schema.String, id: Schema.Number });

export class GuestSignInError extends Schema.TaggedError<GuestSignInError>()("GuestSignInError", {
  reason: Schema.Literals(["unavailable", "expired", "denied", "failed"]),
}) {}

interface PendingSignIn {
  readonly session: string;
  readonly redirectUri: string;
  readonly expiresAt: number;
}

/**
 * Proves which GitHub account a guest holds, with GitHub's web flow: the guest's own browser
 * goes to github.com and comes back with a code, and this server reads the account's login and
 * id. The token is used for that one read and never stored.
 */
export class GuestSignIn extends Context.Service<
  GuestSignIn,
  {
    /** Whether this server has the GitHub client ID and secret the sign-in needs. */
    readonly enabled: boolean;
    /**
     * Starts a sign-in for a guest session, replacing one it already had waiting. `state` names
     * it once, for a few minutes; `url` is where the guest's browser goes on GitHub.
     */
    readonly start: (input: {
      readonly session: string;
      readonly redirectUri: string;
    }) => Effect.Effect<{ readonly state: string; readonly url: string }, GuestSignInError>;
    /**
     * Spends `state` and reads the account behind `code`, for the session that started it.
     * A null `code` is the guest refusing on GitHub.
     */
    readonly finish: (input: {
      readonly state: string;
      readonly code: string | null;
    }) => Effect.Effect<
      { readonly session: string; readonly account: GuestAccount },
      GuestSignInError
    >;
  }
>()("t3/guest/GuestSignIn") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const random = yield* SecureRandom.SecureRandom;
  const clientId = yield* Config.String(CLIENT_ID_VARIABLE).pipe(
    Config.option,
    Effect.map(Option.getOrElse(() => "")),
    Effect.orElseSucceed(() => ""),
    Effect.map((value) => value.trim()),
  );
  const clientSecret = yield* Config.Redacted(CLIENT_SECRET_VARIABLE).pipe(
    Config.option,
    Effect.map(Option.getOrElse(() => Redacted.make(""))),
    Effect.orElseSucceed(() => Redacted.make("")),
    Effect.map((value) => Redacted.make(Redacted.value(value).trim())),
  );
  const enabled = clientId !== "" && Redacted.value(clientSecret) !== "";
  const pending = yield* Ref.make<ReadonlyMap<string, PendingSignIn>>(new Map());
  const failed = new GuestSignInError({ reason: "failed" });

  const start: GuestSignIn["Service"]["start"] = Effect.fn("GuestSignIn.start")(function* ({
    session,
    redirectUri,
  }) {
    if (!enabled) return yield* new GuestSignInError({ reason: "unavailable" });
    const state = base64UrlEncode(yield* random.randomBytes(STATE_BYTES));
    const now = yield* Clock.currentTimeMillis;
    yield* Ref.update(pending, (current) => {
      const next = new Map(
        [...current].filter(
          ([, waiting]) => waiting.expiresAt > now && waiting.session !== session,
        ),
      );
      // Oldest first, so a flood of starts pushes out the stalest sign-ins.
      while (next.size >= PENDING_LIMIT) next.delete(next.keys().next().value!);
      return next.set(state, { session, redirectUri, expiresAt: now + GUEST_SIGN_IN_TTL_MS });
    });
    // No scope: only the public profile is read.
    const url = new URL(AUTHORIZE_URL);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("state", state);
    return { state, url: url.toString() };
  });

  const finish: GuestSignIn["Service"]["finish"] = Effect.fn("GuestSignIn.finish")(function* ({
    state,
    code,
  }) {
    // Taken out before anything else, so a state works once whatever GitHub answers.
    const entry = yield* Ref.modify(pending, (current) => {
      const found = current.get(state);
      if (found === undefined) return [undefined, current];
      const next = new Map(current);
      next.delete(state);
      return [found, next];
    });
    const now = yield* Clock.currentTimeMillis;
    if (entry === undefined || now >= entry.expiresAt) {
      return yield* new GuestSignInError({ reason: "expired" });
    }
    if (code === null) return yield* new GuestSignInError({ reason: "denied" });
    const token = yield* httpClient
      .execute(
        HttpClientRequest.post("https://github.com/login/oauth/access_token").pipe(
          HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "t3code" }),
          HttpClientRequest.bodyUrlParams({
            client_id: clientId,
            client_secret: Redacted.value(clientSecret),
            code,
            redirect_uri: entry.redirectUri,
          }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(TokenResponse)),
        Effect.timeout(REQUEST_TIMEOUT),
        // The cause can hold the request, and the request holds the secret.
        Effect.mapError(() => failed),
      );
    if (token.access_token === undefined) return yield* failed;
    const user = yield* httpClient
      .execute(
        HttpClientRequest.get("https://api.github.com/user").pipe(
          HttpClientRequest.setHeaders({
            accept: "application/vnd.github+json",
            authorization: `Bearer ${token.access_token}`,
            "user-agent": "t3code",
          }),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GitHubUser)),
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError(() => failed),
      );
    const login = user.login.trim();
    if (login === "") return yield* failed;
    return { session: entry.session, account: { login, id: user.id } };
  });

  return GuestSignIn.of({ enabled, start, finish });
});

export const layer = Layer.effect(GuestSignIn, make);
