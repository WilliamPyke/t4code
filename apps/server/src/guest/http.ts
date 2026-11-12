import {
  GUEST_ATTACHMENT_ROUTE,
  GUEST_BOARD_CURSOR_ROUTE,
  GUEST_BOARD_ROUTE,
  GUEST_COMMAND_OUTPUT_ROUTE,
  GUEST_EXPORT_ROUTE,
  GUEST_HANDOFF_ROUTE,
  GUEST_HISTORY_ROUTE,
  GUEST_ITEM_ROUTE,
  GUEST_MEDIA_ROUTE,
  GUEST_RENDER_ROUTE,
  GUEST_ROOM_ACTIVITY_ROUTE,
  GUEST_ROOM_TURN_ROUTE,
  GUEST_ROOM_UPDATES_ROUTE,
  GUEST_ROUTE_PREFIX,
  GUEST_SHARE_PARAM,
  GUEST_SIGN_IN_BEGIN_ROUTE,
  GUEST_SIGN_IN_CALLBACK_ROUTE,
  GUEST_SIGN_IN_COOKIE,
  GUEST_SIGN_IN_ROUTE,
  GUEST_SIGN_IN_TTL_MS,
  GUEST_MESSAGE_MAX_ATTACHMENT_BYTES,
  GUEST_MESSAGE_MAX_ATTACHMENTS,
  GUEST_SHARE_TTL_MS,
  GuestAgentActivityRequest,
  GuestCursorRequest,
  GuestHandoff,
  GuestRedeemRequest,
  GuestRedeemResult,
  GuestStreamEvent,
  GuestSubmitRequest,
  GuestTurnRequest,
  guestSessionCookieName,
  isProviderSendTurnSupportedImageMimeType,
  OrchestrationV2CommandOutputFrame,
  OrchestrationV2GetTurnItemResult,
  OrchestrationV2ThreadHistoryPage,
  RoomBoardChange,
  RoomUpdates,
  SharedThreadExport,
} from "@t3tools/contracts";
import * as ByteSize from "effect/ByteSize";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { HttpRouter, HttpServerRequest, HttpServerResponse, Multipart } from "effect/http";
import * as HttpIncomingMessage from "effect/http/HttpIncomingMessage";

import { htmlRenderFileName } from "@t3tools/shared/htmlRender";

import { assetFileResponse, downloadContentDisposition } from "../http.ts";
import type { GuestUpload } from "./guestAttachments.ts";
import type { GuestSafe } from "./guestRedaction.ts";
import { GuestShareAccessError, GuestShareService } from "./GuestShareService.ts";

// Cloudflare closes idle streams after about 100 seconds.
const HEARTBEAT_INTERVAL = Duration.seconds(20);
const NO_STORE = { "cache-control": "no-store" };
// A file never runs as a page on this origin, whatever its bytes.
const FILE_HEADERS = {
  ...NO_STORE,
  "x-content-type-options": "nosniff",
  "content-security-policy": "default-src 'none'; sandbox",
};

const decodeRedeem = Schema.decodeUnknownEffect(GuestRedeemRequest);
const encodeRedeemResult = Schema.encodeSync(GuestRedeemResult);
const decodeSubmit = Schema.decodeUnknownEffect(GuestSubmitRequest);
/** Encodes thread data for a guest. It takes only what the service's redactor returned. */
const encodeForGuest = <S extends Schema.Top>(schema: S) => {
  const encode = Schema.encodeEffect(schema);
  return (value: GuestSafe<S["Type"]>) => encode(value);
};
// The owner's thread types hold DateTime values; the JSON codec writes them as strings.
const encodeStreamEvent = encodeForGuest(
  Schema.fromJsonString(Schema.toCodecJson(GuestStreamEvent)),
);
const encodeOutputFrame = encodeForGuest(Schema.fromJsonString(OrchestrationV2CommandOutputFrame));
const encodeItem = encodeForGuest(Schema.toCodecJson(OrchestrationV2GetTurnItemResult));
const encodeHistoryPage = encodeForGuest(Schema.toCodecJson(OrchestrationV2ThreadHistoryPage));

const errorResponse = (error: GuestShareAccessError) =>
  HttpServerResponse.json(
    { reason: error.reason, message: error.message },
    {
      status:
        error.reason === "invalid" || error.reason === "inactive" || error.reason === "unavailable"
          ? 403
          : error.reason === "ended"
            ? 410
            : error.reason === "too_fast"
              ? 429
              : error.reason === "empty" ||
                  error.reason === "too_many_files" ||
                  error.reason === "too_large" ||
                  error.reason === "unsupported_file"
                ? 400
                : 409,
      headers: NO_STORE,
    },
  );

const badRequest = HttpServerResponse.json(
  { reason: "invalid", message: "The request was not valid." },
  { status: 400, headers: NO_STORE },
);

const bearerOf = (request: HttpServerRequest.HttpServerRequest) =>
  /^Bearer (.+)$/.exec(request.headers["authorization"] ?? "")?.[1] ?? "";

/**
 * The session for a share: the bearer a page on another origin sends, or this origin's cookie.
 * A bearer signed for another share is dropped, so `?share=` always names the share acted on.
 */
const sessionFor = Effect.fnUntraced(function* (
  request: HttpServerRequest.HttpServerRequest,
  shareId: string | null,
) {
  if (shareId === null) return "";
  const bearer = bearerOf(request);
  if (bearer === "") return request.cookies[guestSessionCookieName(shareId)] ?? "";
  const guestShares = yield* GuestShareService;
  return (yield* guestShares.sessionShareId(bearer)) === shareId ? bearer : "";
});

const requestedShareId = (request: HttpServerRequest.HttpServerRequest) =>
  new URLSearchParams(request.url.split("?", 2)[1] ?? "").get(GUEST_SHARE_PARAM);

/** The session for the share the request names in `?share=`. */
const sessionToken = Effect.flatMap(HttpServerRequest.HttpServerRequest, (request) =>
  sessionFor(request, requestedShareId(request)),
);

/** The `?item=` a per-item route names. */
const itemParam = Effect.map(HttpServerRequest.HttpServerRequest, (request) =>
  new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("item"),
);

/** Server-sent events with a heartbeat, never cached or buffered on the way. */
const eventStreamResponse = <A>(
  events: Stream.Stream<A>,
  encode: (event: A) => Effect.Effect<string, Schema.SchemaError>,
) => {
  const data = events.pipe(
    Stream.mapEffect((event) =>
      encode(event).pipe(
        Effect.map((json) => [`data: ${json}\n\n`]),
        // The guest misses one update instead of the whole stream.
        Effect.catch(() =>
          Effect.logWarning("Dropped a guest stream event that failed to encode.").pipe(
            Effect.as([]),
          ),
        ),
      ),
    ),
    Stream.flattenIterable,
  );
  const heartbeat = Stream.tick(HEARTBEAT_INTERVAL).pipe(Stream.map(() => ": ping\n\n"));
  return HttpServerResponse.stream(
    data.pipe(Stream.merge(heartbeat, { haltStrategy: "left" }), Stream.encodeText),
    {
      contentType: "text/event-stream",
      // no-transform keeps the compression middleware from buffering the stream.
      headers: { "cache-control": "no-store, no-transform", "x-accel-buffering": "no" },
    },
  );
};

// Guest JSON bodies are a name or one message; anyone who can reach the tunnel can post them.
const JSON_MAX_BODY_BYTES = 64 * 1024;
const readJsonWithin = Effect.fn("guest.readJsonWithin")(function* (maxBytes: number) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  // A declared length over the cap is refused before reading; chunked bodies hit the reader cap.
  if (Number(request.headers["content-length"] ?? "0") > maxBytes) {
    return yield* new GuestShareAccessError({ reason: "too_large" });
  }
  return yield* request.json.pipe(
    Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(maxBytes)),
  );
});
const readJson = readJsonWithin(JSON_MAX_BODY_BYTES);

const redeemRoute = HttpRouter.add(
  "POST",
  `${GUEST_ROUTE_PREFIX}/redeem`,
  Effect.gen(function* () {
    const body = yield* readJson.pipe(Effect.flatMap(decodeRedeem), Effect.option);
    if (body._tag === "None") return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.redeem(body.value).pipe(
      Effect.flatMap(({ token, shareId, threadId }) =>
        (body.value.returnToken === true
          ? HttpServerResponse.jsonUnsafe(encodeRedeemResult({ token, shareId, threadId }), {
              headers: NO_STORE,
            })
          : HttpServerResponse.empty({ status: 204, headers: NO_STORE })
        ).pipe(
          HttpServerResponse.setCookie(guestSessionCookieName(shareId), token, {
            httpOnly: true,
            secure: true,
            sameSite: "strict",
            path: GUEST_ROUTE_PREFIX,
            maxAge: Duration.millis(GUEST_SHARE_TTL_MS),
          }),
        ),
      ),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

const decodeInvite = Schema.decodeUnknownEffect(Schema.Struct({ credential: Schema.String }));

/** Lets a link's landing page say it has ended before asking for a name. */
const inviteRoute = HttpRouter.add(
  "POST",
  `${GUEST_ROUTE_PREFIX}/invite`,
  Effect.gen(function* () {
    const body = yield* readJson.pipe(Effect.flatMap(decodeInvite), Effect.option);
    if (body._tag === "None") return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .checkInvite(body.value.credential)
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

// The parser stops a request with too many parts or bytes before it reaches the disk; the
// service checks the exact limits and types.
const UPLOAD_LIMITS = Multipart.limitsServices({
  maxParts: GUEST_MESSAGE_MAX_ATTACHMENTS + 4,
  maxFileSize: GUEST_MESSAGE_MAX_ATTACHMENT_BYTES,
  maxTotalSize: GUEST_MESSAGE_MAX_ATTACHMENT_BYTES + 64 * 1024,
  // By default a JSON part is read as a field, which would drop a guest's `.json` file.
  fieldMimeTypes: [],
});

/** A message as JSON (text only), or as multipart form data with `file` parts. */
export const readSubmission = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  if (!request.headers["content-type"]?.startsWith("multipart/form-data")) {
    const body = yield* readJson.pipe(Effect.flatMap(decodeSubmit), Effect.option);
    return body._tag === "None" ? null : { fields: body.value, uploads: [] };
  }
  const parts = yield* request.multipart.pipe(
    Effect.provideContext(UPLOAD_LIMITS),
    Effect.mapError(
      (error) =>
        new GuestShareAccessError({
          reason:
            error.reason._tag === "TooManyParts"
              ? "too_many_files"
              : error.reason._tag === "Parse"
                ? "rejected"
                : "too_large",
        }),
    ),
  );
  const fields = yield* decodeSubmit({ shareId: parts.shareId, text: parts.text ?? "" }).pipe(
    Effect.option,
  );
  if (fields._tag === "None") return null;
  const files = parts.file;
  const uploads: ReadonlyArray<GuestUpload> = Array.isArray(files)
    ? files.filter(Multipart.isPersistedFile).map(({ name, contentType, path }) => ({
        name,
        contentType,
        path,
      }))
    : [];
  return { fields: fields.value, uploads };
});

const submitRoute = HttpRouter.add(
  "POST",
  `${GUEST_ROUTE_PREFIX}/messages`,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const guestShares = yield* GuestShareService;
    // The session is checked before the body is read, so only a guest can make the server parse
    // and store up to 10 MB.
    const shareId = requestedShareId(request);
    const session = yield* sessionFor(request, shareId);
    yield* guestShares.check(session);
    const submission = yield* readSubmission;
    if (submission === null || submission.fields.shareId !== shareId) return yield* badRequest;
    yield* guestShares.submit(session, submission.fields, submission.uploads);
    return HttpServerResponse.empty({ status: 204, headers: NO_STORE });
  }).pipe(
    Effect.catchTags({ GuestShareAccessError: errorResponse }),
    // The parser's temporary files are removed once the response is ready.
    Effect.scoped,
  ),
);

const streamRoute = HttpRouter.add(
  "GET",
  `${GUEST_ROUTE_PREFIX}/stream`,
  Effect.gen(function* () {
    const guestShares = yield* GuestShareService;
    return yield* guestShares.stream(yield* sessionToken).pipe(
      Effect.map((events) => eventStreamResponse(events, encodeStreamEvent)),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

const bearerToken = Effect.map(HttpServerRequest.HttpServerRequest, bearerOf);

const encodeHandoff = Schema.encodeEffect(Schema.toCodecJson(GuestHandoff));
const encodeExport = encodeForGuest(Schema.toCodecJson(SharedThreadExport));

// The guest's page asks for a handoff token, then sends the guest to their own T3 Code with it.
const handoffRoute = HttpRouter.add(
  "POST",
  GUEST_HANDOFF_ROUTE,
  Effect.gen(function* () {
    const guestShares = yield* GuestShareService;
    return yield* guestShares.handoff(yield* sessionToken).pipe(
      Effect.flatMap((result) =>
        encodeHandoff(result).pipe(
          Effect.mapError(() => new GuestShareAccessError({ reason: "unavailable" })),
        ),
      ),
      Effect.map((body) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE })),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

// Read by the guest's own T3 Code server, not a browser: the token is a bearer, not a cookie.
const exportRoute = HttpRouter.add(
  "GET",
  GUEST_EXPORT_ROUTE,
  Effect.gen(function* () {
    const guestShares = yield* GuestShareService;
    return yield* guestShares.exportThread(yield* bearerToken).pipe(
      Effect.flatMap((result) =>
        encodeExport(result).pipe(
          Effect.mapError(() => new GuestShareAccessError({ reason: "unavailable" })),
        ),
      ),
      Effect.map((body) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE })),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

// A turn's text at its limits, in the widest characters, JSON-escaped.
const TURN_MAX_BODY_BYTES = 128 * 1024;
const decodeTurn = Schema.decodeUnknownEffect(GuestTurnRequest);

// Posted by the guest's own T3 Code server, like the export: a bearer, not a cookie.
const roomTurnRoute = HttpRouter.add(
  "POST",
  GUEST_ROOM_TURN_ROUTE,
  Effect.gen(function* () {
    const token = yield* bearerToken;
    const body = yield* readJsonWithin(TURN_MAX_BODY_BYTES).pipe(
      Effect.flatMap(decodeTurn),
      Effect.option,
    );
    if (body._tag === "None") return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .postTurn(token, body.value)
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

const decodeActivity = Schema.decodeUnknownEffect(GuestAgentActivityRequest);

// Posted by the guest's own T3 Code server when a turn starts or stops there.
const roomActivityRoute = HttpRouter.add(
  "POST",
  GUEST_ROOM_ACTIVITY_ROUTE,
  Effect.gen(function* () {
    const token = yield* bearerToken;
    const body = yield* readJson.pipe(Effect.flatMap(decodeActivity), Effect.option);
    if (body._tag === "None") return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .postActivity(token, body.value)
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

const encodeUpdates = encodeForGuest(Schema.toCodecJson(RoomUpdates));

// Read by the guest's own T3 Code server when its user catches up.
const roomUpdatesRoute = HttpRouter.add(
  "GET",
  GUEST_ROOM_UPDATES_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const after = new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("after");
    const cursor = after === null ? Option.none() : DateTime.make(after);
    if (after !== null && Option.isNone(cursor)) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .roomUpdates(yield* bearerToken, Option.getOrNull(Option.map(cursor, DateTime.formatIso)))
      .pipe(
        Effect.flatMap((result) =>
          encodeUpdates(result).pipe(
            Effect.mapError(() => new GuestShareAccessError({ reason: "unavailable" })),
          ),
        ),
        Effect.map((body) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

const decodeBoardChange = Schema.decodeUnknownEffect(RoomBoardChange);

const boardRoute = HttpRouter.add(
  "POST",
  GUEST_BOARD_ROUTE,
  Effect.gen(function* () {
    const session = yield* sessionToken;
    const change = yield* readJson.pipe(Effect.flatMap(decodeBoardChange), Effect.option);
    if (change._tag === "None") return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .changeBoard({ session }, change.value)
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

// A pointer position is a few bytes; anything bigger is not one.
const CURSOR_MAX_BODY_BYTES = 256;
const decodeCursor = Schema.decodeUnknownEffect(GuestCursorRequest);

const boardCursorRoute = HttpRouter.add(
  "POST",
  GUEST_BOARD_CURSOR_ROUTE,
  Effect.gen(function* () {
    const session = yield* sessionToken;
    const body = yield* readJsonWithin(CURSOR_MAX_BODY_BYTES).pipe(
      Effect.flatMap(decodeCursor),
      Effect.option,
    );
    if (body._tag === "None") return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .moveCursor({ session }, body.value.at)
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

const signInRoute = HttpRouter.add(
  "POST",
  GUEST_SIGN_IN_ROUTE,
  Effect.gen(function* () {
    const guestShares = yield* GuestShareService;
    return yield* guestShares.signIn(yield* sessionToken).pipe(
      Effect.flatMap(({ url, cookie }) =>
        HttpServerResponse.jsonUnsafe({ url }, { headers: NO_STORE }).pipe(signInCookie(cookie)),
      ),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

const signInCookie = (cookie: string) =>
  // Lax, unlike the session: it has to come back on the navigation from GitHub.
  HttpServerResponse.setCookie(GUEST_SIGN_IN_COOKIE, cookie, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: Duration.millis(GUEST_SIGN_IN_TTL_MS),
  });

// The hosted app's guest page posts a form here: a fetch from another origin could not store the
// sign-in cookie, and the callback needs it. The service refuses every origin but that app's.
const signInBeginRoute = HttpRouter.add(
  "POST",
  GUEST_SIGN_IN_BEGIN_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (Number(request.headers["content-length"] ?? "0") > JSON_MAX_BODY_BYTES) {
      return yield* badRequest;
    }
    const form = yield* request.text.pipe(
      Effect.provideService(HttpIncomingMessage.MaxBodySize, ByteSize.bytes(JSON_MAX_BODY_BYTES)),
      Effect.map((text) => new URLSearchParams(text)),
      Effect.option,
    );
    if (form._tag === "None") return yield* badRequest;
    const session = form.value.get("token") ?? "";
    const guestShares = yield* GuestShareService;
    if ((yield* guestShares.sessionShareId(session)) !== form.value.get(GUEST_SHARE_PARAM)) {
      return yield* badRequest;
    }
    return yield* guestShares
      .signInFromHostedApp({ session, origin: request.headers["origin"] ?? null })
      .pipe(
        Effect.flatMap(({ url, cookie }) =>
          HttpServerResponse.redirect(url, {
            status: 303,
            headers: { ...NO_STORE, "referrer-policy": "no-referrer" },
          }).pipe(signInCookie(cookie)),
        ),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

// GitHub sends the guest's browser here. It answers with a redirect to the guest page either way.
const signInCallbackRoute = HttpRouter.add(
  "GET",
  GUEST_SIGN_IN_CALLBACK_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const query = new URLSearchParams(request.url.split("?", 2)[1] ?? "");
    const guestShares = yield* GuestShareService;
    const location = yield* guestShares.signInFinish({
      state: query.get("state"),
      code: query.get("code"),
      cookie: request.cookies[GUEST_SIGN_IN_COOKIE] ?? null,
    });
    // The address held the code; it is not passed on to the page that loads next.
    return HttpServerResponse.redirect(location, {
      headers: { ...NO_STORE, "referrer-policy": "no-referrer" },
    });
  }),
);

// Lets a returning guest skip the name form when this browser already joined the share.
const sessionRoute = HttpRouter.add(
  "GET",
  `${GUEST_ROUTE_PREFIX}/session`,
  Effect.gen(function* () {
    const guestShares = yield* GuestShareService;
    return yield* guestShares
      .check(yield* sessionToken)
      .pipe(
        Effect.as(HttpServerResponse.empty({ status: 204, headers: NO_STORE })),
        Effect.catchTags({ GuestShareAccessError: errorResponse }),
      );
  }),
);

// The response carries the asset route's sandbox CSP: the page gets an opaque origin, so its
// scripts cannot send the guest cookie or call these routes as the guest.
const renderRoute = HttpRouter.add(
  "GET",
  GUEST_RENDER_ROUTE,
  Effect.gen(function* () {
    const itemId = yield* itemParam;
    if (!itemId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.render(yield* sessionToken, itemId).pipe(
      Effect.flatMap(({ path, title }) =>
        assetFileResponse({ path, mimeType: "text/html", fileName: htmlRenderFileName(title) }),
      ),
      // Each load re-checks the share, so a closed, replaced, or expired link stops it at once.
      Effect.map((response) => HttpServerResponse.setHeaders(response, NO_STORE)),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

const itemRoute = HttpRouter.add(
  "GET",
  GUEST_ITEM_ROUTE,
  Effect.gen(function* () {
    const itemId = yield* itemParam;
    if (!itemId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.item(yield* sessionToken, itemId).pipe(
      Effect.flatMap((result) =>
        encodeItem(result).pipe(
          Effect.mapError(() => new GuestShareAccessError({ reason: "unavailable" })),
        ),
      ),
      Effect.map((body) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE })),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

const historyRoute = HttpRouter.add(
  "GET",
  GUEST_HISTORY_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const cursor = new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("cursor");
    if (!cursor) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.history(yield* sessionToken, cursor).pipe(
      Effect.flatMap((page) =>
        encodeHistoryPage(page).pipe(
          Effect.mapError(() => new GuestShareAccessError({ reason: "unavailable" })),
        ),
      ),
      Effect.map((body) => HttpServerResponse.jsonUnsafe(body, { headers: NO_STORE })),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

// Ends when the command settles; the page closes its EventSource on that last frame, so the
// browser does not reconnect.
const commandOutputRoute = HttpRouter.add(
  "GET",
  GUEST_COMMAND_OUTPUT_ROUTE,
  Effect.gen(function* () {
    const itemId = yield* itemParam;
    if (!itemId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.commandOutput(yield* sessionToken, itemId).pipe(
      Effect.map((frames) => eventStreamResponse(frames, encodeOutputFrame)),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
    );
  }),
);

// Images of the four checked types load inline; anything else downloads as bytes, so a guest's
// HTML or SVG never renders as a page on this origin.
const attachmentRoute = HttpRouter.add(
  "GET",
  GUEST_ATTACHMENT_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const attachmentId = new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("id");
    if (!attachmentId) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.attachment(yield* sessionToken, attachmentId).pipe(
      Effect.flatMap(({ path, attachment }) =>
        HttpServerResponse.file(path, {
          headers: {
            ...FILE_HEADERS,
            ...(attachment.type === "image" &&
            isProviderSendTurnSupportedImageMimeType(attachment.mimeType)
              ? { "content-type": attachment.mimeType }
              : {
                  "content-type": "application/octet-stream",
                  "content-disposition": downloadContentDisposition(attachment.name),
                }),
          },
        }),
      ),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 500, headers: NO_STORE })),
    );
  }),
);

// Only an image an agent reply shows loads; anything else on the host is refused.
const mediaRoute = HttpRouter.add(
  "GET",
  GUEST_MEDIA_ROUTE,
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const path = new URLSearchParams(request.url.split("?", 2)[1] ?? "").get("path");
    if (!path) return yield* badRequest;
    const guestShares = yield* GuestShareService;
    return yield* guestShares.media(yield* sessionToken, path).pipe(
      Effect.flatMap(({ path, mimeType }) =>
        HttpServerResponse.file(path, { headers: { ...FILE_HEADERS, "content-type": mimeType } }),
      ),
      Effect.catchTags({ GuestShareAccessError: errorResponse }),
      Effect.orElseSucceed(() => HttpServerResponse.empty({ status: 500, headers: NO_STORE })),
    );
  }),
);

export const layer = Layer.mergeAll(
  redeemRoute,
  inviteRoute,
  sessionRoute,
  submitRoute,
  streamRoute,
  handoffRoute,
  exportRoute,
  roomTurnRoute,
  roomActivityRoute,
  roomUpdatesRoute,
  boardRoute,
  boardCursorRoute,
  signInRoute,
  signInBeginRoute,
  signInCallbackRoute,
  renderRoute,
  itemRoute,
  historyRoute,
  commandOutputRoute,
  attachmentRoute,
  mediaRoute,
);
