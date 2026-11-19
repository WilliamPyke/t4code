import { RelayProtectedError } from "@t3tools/contracts/relay";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { isHttpClientError } from "effect/http/HttpClientError";

/** Only unavailable is retryable. Descriptions expose relay explanations and trace IDs, never request details. */
export class RelayRequestError extends Schema.TaggedError<RelayRequestError>()(
  "RelayRequestError",
  {
    rejection: Schema.Literals(["unauthorized", "forbidden", "rejected", "unavailable"]),
    description: Schema.String,
    /** How long the relay asked callers to wait (`Retry-After`) before retrying. */
    retryAfterMillis: Schema.optionalKey(Schema.Number),
    /** The relay's own name for the refusal, when it sent one. */
    code: Schema.optionalKey(Schema.String),
    /** The relay's clock minus this machine's, from the response's `Date`. */
    clockSkewMillis: Schema.optionalKey(Schema.Number),
  },
) {
  override get message(): string {
    return this.description;
  }
}

const isRelayRequestError = Schema.is(RelayRequestError);

export function relayRequestError(cause: unknown): RelayRequestError {
  return isRelayRequestError(cause)
    ? cause
    : new RelayRequestError({
        rejection: "unavailable",
        description: `Could not complete the T3 Connect relay request. ${isHttpClientError(cause) ? `The relay request failed (${cause.reason._tag}).` : "The relay returned an unexpected response."} Check this machine's network connection and relay availability, then retry.`,
      });
}

export const shouldRetryRelayRequest = (error: unknown): boolean =>
  !isRelayRequestError(error) || error.rejection === "unavailable";

/** The relay answered and asked to be retried later; nothing local is wrong. */
export const isRelayUnavailable = (error: unknown): boolean =>
  isRelayRequestError(error) && error.rejection === "unavailable";

// Retry-After is either delay-seconds or an HTTP date (RFC 9110 §10.2.3).
const MAX_RELAY_RETRY_AFTER_MILLIS = 15 * 60 * 1000;
function parseRetryAfterMillis(value: string | undefined, nowMillis: number): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  const millis = /^\d+$/.test(trimmed) ? Number(trimmed) * 1000 : Date.parse(trimmed) - nowMillis;
  if (!Number.isFinite(millis) || millis <= 0) return undefined;
  return Math.min(millis, MAX_RELAY_RETRY_AFTER_MILLIS);
}

/** The relay's requested wait, found anywhere in a failure's cause chain. */
export function relayRetryAfterMillis(error: unknown): number | undefined {
  for (let current = error, depth = 0; depth < 8; depth++) {
    if (isRelayRequestError(current)) return current.retryAfterMillis;
    if (typeof current !== "object" || current === null || !("cause" in current)) return undefined;
    current = current.cause;
  }
  return undefined;
}

function recoveryHint(error: RelayProtectedError): string {
  switch (error._tag) {
    case "RelayEnvironmentLinkLimitExceededError":
      return "Unlink an unused environment in T3 Connect, then restart T3 Code on this machine.";
    case "RelayAuthInvalidError":
      return "Run `t3 connect login` to check this machine's authorization. If the stored credential was revoked, sign out with `t3 connect logout`, then run `t3 connect` again. Restart T3 Code after signing in.";
    case "RelayEnvironmentLinkProofExpiredError":
    case "RelayEnvironmentLinkProofInvalidError":
      return "Check this machine's date and time, update T3 Code, then restart it.";
    default:
      return "Retry when the relay is available. If this continues, include the trace ID when reporting it.";
  }
}

// Signed requests live a minute or two; a clock further out than this makes the relay refuse them.
const CLOCK_SKEW_LIMIT_MILLIS = 90_000;

/** What stops this computer from connecting, in words for the person using it. */
export interface LinkFailure {
  readonly kind: "removed" | "limit" | "clock" | "account" | "refused";
  readonly reason: string;
  readonly fix: string;
}

const hasTag = (error: unknown, tag: string) =>
  typeof error === "object" && error !== null && "_tag" in error && error._tag === tag;

/**
 * The failures retrying cannot fix by itself, each with what the person can do. `null` for
 * the rest (the relay or the network being down), which Sync keeps retrying.
 */
export function linkFailureFor(error: unknown): LinkFailure | null {
  if (hasTag(error, "CloudLinkAccountMismatchError")) {
    return {
      kind: "account",
      reason:
        "This computer is connected to a different Tinkjam account than the one that approved it.",
      fix: "Disconnect this computer, then connect it again with the account you want.",
    };
  }
  if (!isRelayRequestError(error)) return null;
  if (
    error.code === "RelayEnvironmentLinkProofExpiredError" ||
    (error.rejection === "unauthorized" &&
      Math.abs(error.clockSkewMillis ?? 0) > CLOCK_SKEW_LIMIT_MILLIS)
  ) {
    return {
      kind: "clock",
      reason: "This computer's date and time are wrong, so Tinkjam cannot accept its requests.",
      fix: "Turn on automatic date and time on this computer. It connects by itself once the clock is right.",
    };
  }
  if (error.code === "RelayEnvironmentLinkRemovedError") {
    return {
      kind: "removed",
      reason: "This computer was removed from your Tinkjam account.",
      fix: "Connect it again to use it.",
    };
  }
  if (error.code === "RelayEnvironmentLinkLimitExceededError") {
    return {
      kind: "limit",
      reason: "Your Tinkjam account already has its maximum number of connected computers.",
      fix: "Open Tinkjam, go to Settings and remove a computer you no longer use. Then start Tinkjam Sync again.",
    };
  }
  if (error.rejection === "unavailable") return null;
  return {
    kind: "refused",
    reason: `Tinkjam did not accept this computer's request to connect. ${error.description}`,
    fix: "Update Tinkjam Sync and start it again. If it stays like this, send this message to Tinkjam support.",
  };
}

export const LINK_REMOVED_FAILURE = linkFailureFor(
  new RelayRequestError({
    rejection: "forbidden",
    description: "",
    code: "RelayEnvironmentLinkRemovedError",
  }),
);

export const filterRelayResponse = Effect.fn("cloud.filter_relay_response")(function* (
  response: HttpClientResponse.HttpClientResponse,
) {
  if (response.status >= 200 && response.status < 300) return response;
  const decoded = yield* HttpClientResponse.schemaBodyJson(RelayProtectedError)(response).pipe(
    Effect.option,
  );
  const ray = response.headers["cf-ray"];
  const requestId = ray && /^[a-zA-Z0-9-]{1,128}$/.test(ray) ? ` Cloudflare Ray ID: ${ray}.` : "";
  const description = Option.isSome(decoded)
    ? `T3 Connect: ${decoded.value.message}. ${recoveryHint(decoded.value)} Trace ID: ${decoded.value.traceId}.`
    : `T3 Connect relay returned HTTP ${response.status} without a recognized error response. Check relay access and any proxy or firewall restrictions, then restart T3 Code.${requestId}`;

  const now = yield* Clock.currentTimeMillis;
  const relayTime = Date.parse(response.headers["date"] ?? "");
  const details = {
    description,
    ...(Option.isSome(decoded) ? { code: decoded.value._tag } : {}),
    ...(Number.isFinite(relayTime) ? { clockSkewMillis: relayTime - now } : {}),
  };

  // Only a schema-decoded expired-proof 401 is retryable for clock skew; every other 401 is permanent.
  if (
    response.status === 401 &&
    Option.isSome(decoded) &&
    decoded.value._tag === "RelayEnvironmentLinkProofExpiredError"
  ) {
    return yield* new RelayRequestError({ rejection: "unavailable", ...details });
  }
  if (response.status === 401) {
    return yield* new RelayRequestError({ rejection: "unauthorized", ...details });
  }
  if (response.status === 403) {
    return yield* new RelayRequestError({ rejection: "forbidden", ...details });
  }
  if (
    response.status >= 400 &&
    response.status < 500 &&
    response.status !== 408 &&
    response.status !== 429
  ) {
    return yield* new RelayRequestError({ rejection: "rejected", ...details });
  }
  const retryAfterMillis = parseRetryAfterMillis(response.headers["retry-after"], now);
  return yield* new RelayRequestError({
    rejection: "unavailable",
    ...details,
    ...(retryAfterMillis === undefined ? {} : { retryAfterMillis }),
  });
});
