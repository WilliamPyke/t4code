import {
  GUEST_EXPORT_ROUTE,
  SHARED_THREAD_MAX_CHARS,
  SHARED_THREAD_MAX_MESSAGES,
  SharedThreadExport,
  SharedThreadJoinError,
  type SharedThreadJoinInput,
  type SharedThreadJoinResult,
  type SharedThreadPreview,
  type SharedThreadSource,
} from "@t3tools/contracts";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import { HttpClient, HttpClientRequest } from "effect/http";

import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as SharedRoomLink from "./SharedRoomLink.ts";

const REQUEST_TIMEOUT = Duration.seconds(20);
// Well over the largest export an honest host sends, so a declared size past it is refused unread.
const MAX_EXPORT_BYTES = 4 * 1024 * 1024;

const decodeExport = Schema.decodeUnknownEffect(Schema.toCodecJson(SharedThreadExport));

/** Where a link's host serves its export, or null for a host this server must not call. */
export const sharedThreadExportUrl = (host: string): string | null =>
  SharedRoomLink.sharedThreadRouteUrl(host, GUEST_EXPORT_ROUTE);

/**
 * Brings a thread someone shared to this machine as a new thread of the user's own. Every turn
 * in the new thread runs here, under this machine's provider login. When the owner's server
 * offers a room, the thread stays connected to it and shows its turns there.
 */
export class SharedThreadJoin extends Context.Service<
  SharedThreadJoin,
  {
    readonly preview: (
      source: SharedThreadSource,
    ) => Effect.Effect<SharedThreadPreview, SharedThreadJoinError>;
    readonly join: (
      input: SharedThreadJoinInput,
    ) => Effect.Effect<SharedThreadJoinResult, SharedThreadJoinError>;
  }
>()("t3/guest/SharedThreadJoin") {}

const make = Effect.gen(function* () {
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const rooms = yield* SharedRoomLink.SharedRoomLink;
  const http = SharedRoomLink.withoutRedirects(yield* HttpClient.HttpClient);
  const fail = (reason: SharedThreadJoinError["reason"]) => new SharedThreadJoinError({ reason });

  const fetchExport = Effect.fn("SharedThreadJoin.fetchExport")(function* (
    source: SharedThreadSource,
  ) {
    const url = sharedThreadExportUrl(source.host);
    if (url === null) return yield* fail("invalid_host");
    const response = yield* http
      .execute(HttpClientRequest.get(url).pipe(HttpClientRequest.bearerToken(source.token)))
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError(() => fail("unreachable")),
      );
    // The owner's server answers 4xx for a token it no longer honors.
    if (response.status >= 400 && response.status < 500) return yield* fail("expired");
    if (response.status !== 200) return yield* fail("unreachable");
    if (Number(response.headers["content-length"] ?? "0") > MAX_EXPORT_BYTES) {
      return yield* fail("invalid_response");
    }
    const shared = yield* response.json.pipe(
      Effect.flatMap(decodeExport),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(() => fail("invalid_response")),
    );
    // The other machine is not trusted to keep its own limits.
    const chars = shared.messages.reduce((total, message) => total + message.text.length, 0);
    if (shared.messages.length > SHARED_THREAD_MAX_MESSAGES || chars > SHARED_THREAD_MAX_CHARS) {
      return yield* fail("invalid_response");
    }
    return shared;
  }, Effect.scoped);

  const preview = Effect.fn("SharedThreadJoin.preview")(function* (source: SharedThreadSource) {
    const shared = yield* fetchExport(source);
    return {
      title: shared.title,
      messageCount: shared.messages.length,
      truncated: shared.truncated,
      checkout: shared.checkout,
      ...(shared.room === undefined ? {} : { live: true }),
    };
  });

  const join = Effect.fn("SharedThreadJoin.join")(function* (input: SharedThreadJoinInput) {
    const shared = yield* fetchExport(input.source);
    const title = shared.title.trim() === "" ? "Shared thread" : shared.title.trim();
    const checkout = input.checkout ? shared.checkout : null;
    const launched = yield* launches
      .launch({
        commandId: input.commandId,
        projectId: input.projectId,
        title,
        modelSelection: input.modelSelection,
        runtimeMode: input.runtimeMode,
        interactionMode: input.interactionMode,
        // A new branch of the user's own, started from the shared one as its remote has it.
        workspaceStrategy:
          checkout === null
            ? { type: "root" }
            : { type: "worktree", baseRef: checkout.branch, startFromOrigin: true },
        ...(shared.messages.length === 0
          ? {}
          : {
              importedHistory: {
                // Characters nobody can see can hide instructions for the agent.
                messages: shared.messages.map((message) => ({
                  ...message,
                  text: sanitizeLinkedPrompt(message.text).text,
                })),
                notice: `Copied from "${title}", a thread shared from another machine.${
                  shared.truncated ? " Its earlier messages were left out." : ""
                } Turns here run on this machine.${
                  shared.room === undefined
                    ? " They are not sent back."
                    : " While this thread's header says your turns show in the room, each prompt and your agent's final reply are shown to the room it came from."
                }`,
              },
            }),
        createdBy: "user",
        creationSource: "web",
      })
      .pipe(
        Effect.tapError((cause) => Effect.logWarning("Could not join a shared thread", { cause })),
        Effect.mapError(() => fail("launch_failed")),
      );
    if (shared.room !== undefined) {
      yield* rooms.connect(
        launched.threadId,
        input.source.host,
        shared.room,
        shared.messages.at(-1)?.createdAt,
      );
    }
    const { room } = shared;
    return {
      threadId: launched.threadId,
      ...(room?.session === undefined || room.threadId === undefined || room.shareId === undefined
        ? {}
        : {
            shared: {
              shareId: room.shareId,
              threadId: room.threadId,
              token: room.session,
              title,
            },
          }),
    };
  });

  return SharedThreadJoin.of({ preview, join });
});

export const layer = Layer.effect(SharedThreadJoin, make);
