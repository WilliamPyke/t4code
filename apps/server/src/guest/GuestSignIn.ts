import type { GuestAccount, GuestSignInPrompt } from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/http";

// The same public client ID the Source Control sign-in uses. The device flow needs no secret.
const CLIENT_ID_VARIABLE = "T3CODE_GITHUB_APP_CLIENT_ID";
const REQUEST_TIMEOUT = Duration.seconds(15);
// Anyone holding a guest session can start a sign-in, so the waiting ones are capped.
const PENDING_LIMIT = 256;

const DeviceCodeResponse = Schema.Struct({
  device_code: Schema.optional(Schema.String),
  user_code: Schema.optional(Schema.String),
  verification_uri: Schema.optional(Schema.String),
  expires_in: Schema.optional(Schema.Number),
  interval: Schema.optional(Schema.Number),
});

// GitHub answers the token grant with HTTP 200 and puts refusals in `error`.
const TokenResponse = Schema.Struct({
  access_token: Schema.optional(Schema.String),
  interval: Schema.optional(Schema.Number),
  error: Schema.optional(Schema.String),
});

const GitHubUser = Schema.Struct({ login: Schema.String, id: Schema.Number });

export class GuestSignInError extends Schema.TaggedError<GuestSignInError>()("GuestSignInError", {
  reason: Schema.Literals(["unavailable", "expired", "denied", "failed"]),
}) {}

interface PendingSignIn {
  readonly deviceCode: string;
  readonly expiresAt: number;
  readonly interval: number;
  readonly nextPollAt: number;
}

/**
 * Proves which GitHub account a guest holds, with GitHub's device flow: the guest types a code
 * on github.com and this server reads the account's login and id. The token is used for that
 * one read and never stored.
 */
export class GuestSignIn extends Context.Service<
  GuestSignIn,
  {
    /** Whether this server has the GitHub client ID the sign-in needs. */
    readonly enabled: boolean;
    /** Starts a sign-in for `key`, replacing one it already had waiting. */
    readonly start: (key: string) => Effect.Effect<GuestSignInPrompt, GuestSignInError>;
    /** The account once the guest finished on GitHub; none while they have not. */
    readonly poll: (key: string) => Effect.Effect<Option.Option<GuestAccount>, GuestSignInError>;
  }
>()("t3/guest/GuestSignIn") {}

const make = Effect.gen(function* () {
  const httpClient = yield* HttpClient.HttpClient;
  const clientId = (yield* HostProcess.Environment)[CLIENT_ID_VARIABLE]?.trim() ?? "";
  const enabled = clientId !== "";
  const pending = yield* Ref.make<ReadonlyMap<string, PendingSignIn>>(new Map());
  const failed = new GuestSignInError({ reason: "failed" });

  const postForm = <S extends Schema.Top>(path: string, body: Record<string, string>, schema: S) =>
    httpClient
      .execute(
        HttpClientRequest.post(`https://github.com${path}`).pipe(
          HttpClientRequest.setHeaders({ accept: "application/json", "user-agent": "t3code" }),
          HttpClientRequest.bodyUrlParams(body),
        ),
      )
      .pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(schema)),
        Effect.timeout(REQUEST_TIMEOUT),
      );

  const forget = (key: string) =>
    Ref.update(pending, (current) => {
      const next = new Map(current);
      next.delete(key);
      return next;
    });

  const start: GuestSignIn["Service"]["start"] = Effect.fn("GuestSignIn.start")(function* (key) {
    if (!enabled) return yield* new GuestSignInError({ reason: "unavailable" });
    const code = yield* postForm(
      "/login/device/code",
      { client_id: clientId },
      DeviceCodeResponse,
    ).pipe(Effect.mapError(() => failed));
    if (
      code.device_code === undefined ||
      code.user_code === undefined ||
      code.verification_uri === undefined ||
      code.expires_in === undefined
    ) {
      return yield* failed;
    }
    const now = yield* Clock.currentTimeMillis;
    const interval = code.interval ?? 5;
    const entry: PendingSignIn = {
      deviceCode: code.device_code,
      expiresAt: now + code.expires_in * 1_000,
      interval,
      nextPollAt: now + interval * 1_000,
    };
    yield* Ref.update(pending, (current) => {
      const next = new Map([...current].filter(([, waiting]) => waiting.expiresAt > now));
      next.delete(key);
      // Oldest first, so a flood of starts pushes out the stalest sign-ins.
      while (next.size >= PENDING_LIMIT) next.delete(next.keys().next().value!);
      return next.set(key, entry);
    });
    return {
      userCode: code.user_code,
      verificationUri: code.verification_uri,
      expiresAt: entry.expiresAt,
      interval,
    };
  });

  const poll: GuestSignIn["Service"]["poll"] = Effect.fn("GuestSignIn.poll")(function* (key) {
    const entry = (yield* Ref.get(pending)).get(key);
    if (entry === undefined) return yield* new GuestSignInError({ reason: "expired" });
    const now = yield* Clock.currentTimeMillis;
    if (now >= entry.expiresAt) {
      yield* forget(key);
      return yield* new GuestSignInError({ reason: "expired" });
    }
    // GitHub slows a client that asks more often than it said to; the page's timer is not trusted.
    if (now < entry.nextPollAt) return Option.none();
    const wait = (interval: number) =>
      Ref.update(pending, (current) =>
        current.get(key) === entry
          ? new Map(current).set(key, { ...entry, interval, nextPollAt: now + interval * 1_000 })
          : current,
      );
    const answer = yield* postForm(
      "/login/oauth/access_token",
      {
        client_id: clientId,
        device_code: entry.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      },
      TokenResponse,
    ).pipe(Effect.option);
    // A dropped request is asked again on the page's next tick.
    if (Option.isNone(answer)) {
      yield* wait(entry.interval);
      return Option.none();
    }
    const response = answer.value;
    if (response.access_token === undefined) {
      switch (response.error) {
        case "authorization_pending":
          yield* wait(entry.interval);
          return Option.none();
        case "slow_down":
          yield* wait(response.interval ?? entry.interval + 5);
          return Option.none();
        case "expired_token":
          yield* forget(key);
          return yield* new GuestSignInError({ reason: "expired" });
        case "access_denied":
          yield* forget(key);
          return yield* new GuestSignInError({ reason: "denied" });
        default:
          yield* forget(key);
          return yield* failed;
      }
    }
    yield* forget(key);
    const user = yield* httpClient
      .execute(
        HttpClientRequest.get("https://api.github.com/user").pipe(
          HttpClientRequest.setHeaders({
            accept: "application/vnd.github+json",
            authorization: `Bearer ${response.access_token}`,
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
    return Option.some({ login, id: user.id });
  });

  return GuestSignIn.of({ enabled, start, poll });
});

export const layer = Layer.effect(GuestSignIn, make);
