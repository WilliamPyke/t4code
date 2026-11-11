import {
  AuthOrchestrationOperateScope,
  authScopeRequiredResponse,
  DEFAULT_SERVER_SETTINGS,
  EnvironmentAuthorizationError,
  GUEST_COMMAND_OUTPUT_ROUTE,
  GUEST_HISTORY_ROUTE,
  GUEST_ITEM_ROUTE,
  GUEST_ROUTE_PREFIX,
  GUEST_SHARE_PARAM,
  type GuestId,
  type GuestShareView,
  GuestStreamEvent,
  ORCHESTRATION_V2_WS_METHODS,
  OrchestrationV2CommandOutputFrame,
  OrchestrationV2GetTurnItemResult,
  type OrchestrationV2ShellStreamItem,
  OrchestrationV2ThreadHistoryPage,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ThreadStreamItem,
  ProjectId,
  ProviderInstanceId,
  type ServerConfig,
  type ServerConfigStreamEvent,
  WS_METHODS,
  WsRpcGroup,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as RpcClientError from "effect/rpc/RpcClientError";
import * as RpcSchema from "effect/rpc/RpcSchema";
import * as Socket from "effect/socket/Socket";

import {
  ConnectionBlockedError,
  type ConnectionAttemptError,
  ConnectionTransientError,
  type GuestConnectionTarget,
  type PreparedConnection,
} from "../connection/model.ts";
import type { WsRpcProtocolClient } from "./protocol.ts";
import type { RpcSession } from "./session.ts";

/** A share this client joined, as the platform remembers it. */
interface JoinedGuestShare {
  /** Null on the owner's own host, where the share's cookie signs each request. */
  readonly token: string | null;
  readonly title: string;
}

/**
 * The platform's side of a guest session: it keeps the joined shares and their tokens, and
 * shows what a share's stream says about the room. The default knows no share.
 */
export class GuestShareAccess extends Context.Reference<{
  readonly share: (shareId: string) => Effect.Effect<Option.Option<JoinedGuestShare>>;
  readonly viewed: (shareId: string, view: GuestShareView) => Effect.Effect<void>;
  readonly presence: (shareId: string, online: ReadonlyArray<GuestId>) => Effect.Effect<void>;
  /** The share ended, or this guest was removed. The platform forgets it. */
  readonly ended: (shareId: string) => Effect.Effect<void>;
}>("@t3tools/client-runtime/rpc/guestSession/GuestShareAccess", {
  defaultValue: () => ({
    share: () => Effect.succeedNone,
    viewed: () => Effect.void,
    presence: () => Effect.void,
    ended: () => Effect.void,
  }),
}) {}

/**
 * The `fetch` guest requests go through. Tests replace it. It is the platform's own: the page
 * posts the same routes with form data and reads their bodies as blobs, outside any Effect.
 */
export class GuestShareFetch extends Context.Reference<typeof globalThis.fetch>(
  "@t3tools/client-runtime/rpc/guestSession/GuestShareFetch",
  {
    // @effect-diagnostics-next-line globalFetch:off -- see above
    defaultValue: () => (input, init) => globalThis.fetch(input, init),
  },
) {}

export interface GuestShareEndpoint {
  readonly httpBaseUrl: string;
  readonly shareId: string;
  readonly token: string | null;
}

export function guestShareEndpoint(prepared: PreparedConnection): GuestShareEndpoint | null {
  if (prepared.target._tag !== "GuestConnectionTarget") return null;
  return {
    httpBaseUrl: prepared.target.httpBaseUrl,
    shareId: prepared.target.shareId,
    token: prepared.httpAuthorization?._tag === "Bearer" ? prepared.httpAuthorization.token : null,
  };
}

export function guestShareUrl(
  endpoint: Pick<GuestShareEndpoint, "httpBaseUrl" | "shareId">,
  route: string,
  params: Readonly<Record<string, string>> = {},
): string {
  const url = new URL(route, endpoint.httpBaseUrl);
  url.searchParams.set(GUEST_SHARE_PARAM, endpoint.shareId);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  return url.toString();
}

/**
 * A request to one of a share's guest routes. With a token it is a bearer request that sends no
 * cookie, so it works from any origin; without one it is same-origin and the cookie signs it.
 */
export function guestShareRequest(
  endpoint: GuestShareEndpoint,
  route: string,
  options: {
    readonly params?: Readonly<Record<string, string>>;
    readonly init?: RequestInit;
    readonly fetch?: typeof globalThis.fetch;
  } = {},
): Promise<Response> {
  const headers = new Headers(options.init?.headers);
  if (endpoint.token !== null) headers.set("authorization", `Bearer ${endpoint.token}`);
  return (options.fetch ?? globalThis.fetch)(guestShareUrl(endpoint, route, options.params), {
    ...options.init,
    headers,
    credentials: endpoint.token === null ? "same-origin" : "omit",
  });
}

/**
 * Why a guest stream stopped: the server refused it (`status`), or the connection dropped.
 * @public Required to name the error in consumers' inferred stream types.
 */
export class GuestStreamStopped extends Schema.TaggedError<GuestStreamStopped>()(
  "GuestStreamStopped",
  {
    status: Schema.NullOr(Schema.Number),
  },
) {}

/**
 * The lines of a server-sent event response. `EventSource` cannot send a bearer, so the body is
 * read from `fetch`. Ends when the server closes the response.
 */
function eventStreamLines(
  open: (signal: AbortSignal) => Promise<Response>,
): Stream.Stream<string, GuestStreamStopped> {
  return Stream.callback<string, GuestStreamStopped>((queue) =>
    Effect.acquireRelease(
      Effect.sync(() => {
        const controller = new AbortController();
        const stop = (status: number | null) =>
          Queue.failCauseUnsafe(queue, Cause.fail(new GuestStreamStopped({ status })));
        void (async () => {
          const response = await open(controller.signal);
          if (!response.ok || response.body === null) return stop(response.status);
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffered = "";
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffered += value;
            const lines = buffered.split("\n");
            buffered = lines.pop() ?? "";
            for (const line of lines) Queue.offerUnsafe(queue, line);
          }
          Queue.endUnsafe(queue);
        })().catch(() => {
          if (!controller.signal.aborted) stop(null);
        });
        return controller;
      }),
      (controller) => Effect.sync(() => controller.abort()),
    ).pipe(Effect.asVoid),
  );
}

const DATA_PREFIX = "data: ";

/**
 * The `data:` payloads of one of a share's server-sent event routes, until the server closes
 * the response. It fails when the server refuses the request or the connection drops.
 */
export function guestShareEvents(
  endpoint: GuestShareEndpoint,
  route: string,
  params: Readonly<Record<string, string>> = {},
  fetch?: typeof globalThis.fetch,
): Stream.Stream<string, GuestStreamStopped> {
  return eventStreamLines((signal) =>
    guestShareRequest(endpoint, route, {
      params,
      init: { signal },
      ...(fetch === undefined ? {} : { fetch }),
    }),
  ).pipe(
    Stream.filter((line) => line.startsWith(DATA_PREFIX)),
    Stream.map((line) => line.slice(DATA_PREFIX.length)),
  );
}

const decodeStreamEvent = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.toCodecJson(GuestStreamEvent)),
);
const decodeOutputFrame = Schema.decodeUnknownOption(
  Schema.fromJsonString(OrchestrationV2CommandOutputFrame),
);
const decodeItem = Schema.decodeUnknownEffect(Schema.toCodecJson(OrchestrationV2GetTurnItemResult));
const decodeHistoryPage = Schema.decodeUnknownEffect(
  Schema.toCodecJson(OrchestrationV2ThreadHistoryPage),
);

/** Null for anything the server would never send, so a bad frame is skipped, not fatal. */
const parseGuestStreamEvent = (data: string): GuestStreamEvent | null =>
  Option.getOrNull(decodeStreamEvent(data));

const transportError = (message: string, cause?: unknown) =>
  new RpcClientError.RpcClientError({
    reason: new Socket.SocketReadError({ cause: cause ?? message }),
  });

const guestDenied = () =>
  new EnvironmentAuthorizationError({
    ...authScopeRequiredResponse(AuthOrchestrationOperateScope),
    message: "A guest of a shared thread cannot do this.",
  });

type GuestRpcHandler = (input: never) => unknown;

/**
 * An RPC client that has only the methods a guest's read-mostly thread needs. Every other
 * method of the environment's RPC surface fails with the authorization error a session without
 * the scope gets, without sending anything. `onDenied` hears each refusal.
 */
function makeGuestRpcClient(
  handlers: Readonly<Record<string, GuestRpcHandler>>,
  onDenied: (method: string) => void = () => {},
): WsRpcProtocolClient {
  return new Proxy(
    {},
    {
      get: (_target, method) => {
        if (typeof method !== "string") return undefined;
        const handler = handlers[method];
        if (handler !== undefined) return handler;
        const rpc = WsRpcGroup.requests.get(method);
        const streams = rpc !== undefined && RpcSchema.isStreamSchema(rpc.successSchema);
        return () => {
          onDenied(method);
          return streams ? Stream.fail(guestDenied()) : Effect.fail(guestDenied());
        };
      },
    },
  ) as WsRpcProtocolClient;
}

const SHARED_PROJECT_ID = ProjectId.make("shared");
const SHARED_PROVIDER_INSTANCE_ID = ProviderInstanceId.make("shared");

/** A server config built here: the owner's is none of a guest's business, and nothing is on. */
function guestServerConfig(target: GuestConnectionTarget): ServerConfig {
  return {
    environment: {
      environmentId: target.environmentId,
      label: target.label,
      platform: { os: "unknown", arch: "other" },
      serverVersion: "guest",
      capabilities: { repositoryIdentity: false },
    },
    auth: {
      policy: "remote-reachable",
      bootstrapMethods: [],
      sessionMethods: [],
      sessionCookieName: "t3_session",
    },
    cwd: "shared",
    keybindingsConfigPath: "shared",
    keybindings: [],
    issues: [],
    providers: [],
    availableEditors: [],
    observability: {
      logsDirectoryPath: "shared",
      localTracingEnabled: false,
      otlpTracesEnabled: false,
      otlpMetricsEnabled: false,
      otlpLogsEnabled: false,
    },
    settings: DEFAULT_SERVER_SETTINGS,
    // The thread arrives over the stream, bounded; there is no HTTP snapshot to ask for.
    threadSnapshotPagination: true,
  };
}

function guestThreadShell(
  target: GuestConnectionTarget,
  title: string,
  at: DateTime.Utc,
): OrchestrationV2ThreadShell {
  return {
    id: target.threadId,
    projectId: SHARED_PROJECT_ID,
    title,
    createdBy: "user",
    creationSource: "web",
    providerInstanceId: SHARED_PROVIDER_INSTANCE_ID,
    modelSelection: { instanceId: SHARED_PROVIDER_INSTANCE_ID, model: "shared" },
    runtimeMode: "approval-required",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: target.threadId },
    forkedFrom: null,
    activeProviderThreadId: null,
    latestRunId: null,
    activeRunId: null,
    status: "idle",
    pendingRuntimeRequest: null,
    latestVisibleMessage: null,
    latestUserMessageAt: null,
    hasActionableProposedPlan: false,
    pendingBackgroundTasks: [],
    providerInstanceHistory: [],
    itemCount: 0,
    visibleItemCount: 0,
    createdAt: at,
    updatedAt: at,
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    deletedAt: null,
  };
}

/**
 * What a guest is told when a page of older turns does not load.
 * @public Required to name the error in consumers' inferred results.
 */
export class GuestHistoryLoadError extends Schema.TaggedError<GuestHistoryLoadError>()(
  "GuestHistoryLoadError",
  { message: Schema.String },
) {}

/** Older turns of a shared thread, from the cursor its snapshot or an earlier page gave. */
export const fetchGuestHistoryPage = Effect.fn("GuestSession.fetchHistoryPage")(function* (
  endpoint: GuestShareEndpoint,
  cursor: string,
) {
  const fetch = yield* GuestShareFetch;
  const failed = new GuestHistoryLoadError({ message: "Could not load earlier turns. Try again." });
  const response = yield* Effect.tryPromise({
    try: (signal) =>
      guestShareRequest(endpoint, GUEST_HISTORY_ROUTE, {
        params: { cursor },
        init: { signal },
        fetch,
      }),
    catch: () => new GuestHistoryLoadError({ message: "Could not reach the server." }),
  });
  if (!response.ok) return yield* failed;
  return yield* Effect.tryPromise({ try: () => response.json(), catch: () => failed }).pipe(
    Effect.flatMap(decodeHistoryPage),
    Effect.mapError(() => failed),
  );
});

/**
 * A session for one shared thread, over its owner's guest routes. The server config, the shell
 * and the thread are the only things it answers; see `makeGuestRpcClient` for everything else.
 * The thread's stream opens when the thread is subscribed to, so a guest counts as present in a
 * room only while they have it open.
 */
export const connectGuestSession = Effect.fn("GuestSession.connect")(function* (
  prepared: PreparedConnection,
  target: GuestConnectionTarget,
) {
  const access = yield* GuestShareAccess;
  const fetch = yield* GuestShareFetch;
  const endpoint: GuestShareEndpoint = guestShareEndpoint(prepared) ?? {
    httpBaseUrl: target.httpBaseUrl,
    shareId: target.shareId,
    token: null,
  };
  const joined = yield* access.share(target.shareId);
  const title = yield* SubscriptionRef.make(
    Option.match(joined, { onNone: () => "Shared thread", onSome: (share) => share.title }),
  );
  const connectedAt = yield* DateTime.now;
  const disconnected = yield* Deferred.make<never, ConnectionAttemptError>();
  let inboundFrames = 0;

  const endedError = new ConnectionBlockedError({
    reason: "authentication",
    detail: "This shared thread has ended, or you are no longer in it.",
    hop: "server",
    via: "direct",
  });
  const lostError = new ConnectionTransientError({
    reason: "transport",
    detail: `${target.label} disconnected.`,
    hop: "server",
    via: "direct",
  });
  /** The owner's server no longer lets this guest in. Nothing else answers 403 or 410 here. */
  const refused = (status: number | null) => status === 403 || status === 410;
  const ended = access
    .ended(target.shareId)
    .pipe(Effect.andThen(Deferred.fail(disconnected, endedError)), Effect.asVoid);
  const lost = Deferred.fail(disconnected, lostError).pipe(Effect.asVoid);
  const stopped = (status: number | null) => (refused(status) ? ended : lost);

  const request = (
    route: string,
    options: { params?: Record<string, string>; init?: RequestInit },
  ) =>
    Effect.tryPromise({
      try: (signal) =>
        guestShareRequest(endpoint, route, {
          ...options,
          init: { ...options.init, signal },
          fetch,
        }),
      catch: (cause) => transportError("The owner's host did not answer.", cause),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          inboundFrames += 1;
        }),
      ),
    );
  const events = (route: string, params: Record<string, string> = {}) =>
    guestShareEvents(endpoint, route, params, fetch).pipe(
      Stream.tap(() =>
        Effect.sync(() => {
          inboundFrames += 1;
        }),
      ),
    );

  const check: Effect.Effect<void, ConnectionAttemptError> = request(
    `${GUEST_ROUTE_PREFIX}/session`,
    {},
  ).pipe(
    Effect.mapError((): ConnectionAttemptError => lostError),
    Effect.flatMap((response): Effect.Effect<void, ConnectionAttemptError> =>
      response.ok
        ? Effect.void
        : refused(response.status)
          ? Effect.andThen(access.ended(target.shareId), Effect.fail(endedError))
          : Effect.fail(lostError),
    ),
  );
  // Checked once per session, and shared by everything that waits for it.
  const checked = yield* Effect.cached(check);

  const config = guestServerConfig(target);
  const configEvents: Stream.Stream<ServerConfigStreamEvent> = Stream.concat(
    Stream.succeed({ version: 1 as const, type: "snapshot" as const, config }),
    Stream.never,
  );

  const shell: Stream.Stream<OrchestrationV2ShellStreamItem> = SubscriptionRef.changes(title).pipe(
    Stream.changes,
    Stream.mapAccum(
      () => 0,
      (sequence, current): readonly [number, ReadonlyArray<OrchestrationV2ShellStreamItem>] => {
        const thread = guestThreadShell(target, current, connectedAt);
        return [
          sequence + 1,
          sequence === 0
            ? [
                {
                  kind: "snapshot",
                  snapshot: {
                    schemaVersion: 1,
                    snapshotSequence: 0,
                    threads: [thread],
                    archivedThreads: [],
                    projects: [],
                  },
                },
                { kind: "synchronized" },
              ]
            : [{ kind: "thread.updated", sequence, location: "active", thread }],
        ];
      },
    ),
  );

  const thread = (): Stream.Stream<
    OrchestrationV2ThreadStreamItem,
    RpcClientError.RpcClientError
  > =>
    events(`${GUEST_ROUTE_PREFIX}/stream`).pipe(
      Stream.map(parseGuestStreamEvent),
      Stream.filter((event) => event !== null),
      Stream.takeUntil((event) => event.type === "ended"),
      Stream.mapAccum(
        () => false,
        (synchronized, event) => {
          switch (event.type) {
            case "view":
              return [
                synchronized,
                [
                  access
                    .viewed(target.shareId, event.view)
                    .pipe(
                      Effect.andThen(SubscriptionRef.set(title, event.view.title)),
                      Effect.as<ReadonlyArray<OrchestrationV2ThreadStreamItem>>([]),
                    ),
                ],
              ] as const;
            case "presence":
              return [
                synchronized,
                [
                  access
                    .presence(target.shareId, event.online)
                    .pipe(Effect.as<ReadonlyArray<OrchestrationV2ThreadStreamItem>>([])),
                ],
              ] as const;
            case "ended":
              return [
                synchronized,
                [ended.pipe(Effect.as<ReadonlyArray<OrchestrationV2ThreadStreamItem>>([]))],
              ] as const;
            case "thread":
              // The thread state waits for this marker before it calls the thread live.
              return [
                true,
                [
                  Effect.succeed<ReadonlyArray<OrchestrationV2ThreadStreamItem>>(
                    synchronized ? [event.item] : [event.item, { kind: "synchronized" }],
                  ),
                ],
              ] as const;
          }
        },
      ),
      Stream.mapEffect((items) => items),
      Stream.flattenIterable,
      // The server closes the response without `ended` when its tunnel goes away; the next
      // session's check says whether the share is still there.
      Stream.concat(Stream.fromEffect(lost).pipe(Stream.drain)),
      Stream.catch((error) =>
        Stream.fromEffect(stopped(error.status)).pipe(
          Stream.drain,
          Stream.concat(Stream.fail(transportError("The shared thread's stream stopped."))),
        ),
      ),
    );

  const commandOutput = (input: { readonly itemId: string }) =>
    events(GUEST_COMMAND_OUTPUT_ROUTE, { item: input.itemId }).pipe(
      Stream.map((data) => Option.getOrNull(decodeOutputFrame(data))),
      Stream.filter((frame) => frame !== null),
      // The last frame of a settled command ends the read, as the owner's subscription does.
      Stream.takeUntil((frame) => !frame.running),
      Stream.mapError((error) =>
        refused(error.status) ? guestDenied() : transportError("The command's output stopped."),
      ),
    );

  const turnItem = (input: { readonly itemId: string }) =>
    request(GUEST_ITEM_ROUTE, { params: { item: input.itemId } }).pipe(
      Effect.flatMap((response) =>
        response.status === 403
          ? Effect.succeed({ item: null })
          : !response.ok
            ? Effect.fail(transportError(`The item request failed with ${response.status}.`))
            : Effect.tryPromise({
                try: () => response.json(),
                catch: (cause) => transportError("The item could not be read.", cause),
              }).pipe(
                Effect.flatMap(decodeItem),
                Effect.mapError((cause) => transportError("The item could not be read.", cause)),
              ),
      ),
    );

  /**
   * The one command a guest has: a message. The owner's server decides whether it waits for the
   * owner or goes to the agent; nothing here can choose. Files go through the page's own form.
   */
  const dispatch = (command: { readonly type: string; readonly text?: string }) =>
    request(`${GUEST_ROUTE_PREFIX}/messages`, {
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shareId: target.shareId, text: command.text ?? "" }),
      },
    }).pipe(
      Effect.flatMap((response) =>
        response.ok
          ? Effect.succeed({ sequence: 0 })
          : Effect.fail(transportError(`The message was refused with ${response.status}.`)),
      ),
    );

  const denied: Array<string> = [];
  const client = makeGuestRpcClient(
    {
      [WS_METHODS.subscribeServerConfig]: () => configEvents,
      [WS_METHODS.serverGetConfig]: () => Effect.succeed(config),
      [WS_METHODS.serverProbe]: () => Effect.mapError(check, guestDenied),
      [ORCHESTRATION_V2_WS_METHODS.subscribeShell]: () => shell,
      [ORCHESTRATION_V2_WS_METHODS.subscribeThread]: thread,
      [ORCHESTRATION_V2_WS_METHODS.getTurnItem]: turnItem,
      [ORCHESTRATION_V2_WS_METHODS.subscribeCommandOutput]: commandOutput,
      [ORCHESTRATION_V2_WS_METHODS.dispatchCommand]: (command: {
        readonly type: string;
        readonly text?: string;
        readonly attachments?: ReadonlyArray<unknown>;
      }) =>
        command.type === "message.dispatch" && (command.attachments ?? []).length === 0
          ? dispatch(command)
          : Effect.sync(() => denied.push(command.type)).pipe(
              Effect.andThen(Effect.fail(guestDenied())),
            ),
    } as unknown as Readonly<Record<string, GuestRpcHandler>>,
    (method) => denied.push(method),
  );

  return {
    session: {
      client,
      initialConfig: Effect.as(checked, config),
      subscribeServerConfig: () => configEvents,
      ready: checked,
      probe: check,
      inboundFrames: Effect.sync(() => inboundFrames),
      closed: Deferred.await(disconnected),
    } satisfies RpcSession,
    /** The RPC methods this session refused, in order. */
    denied: denied as ReadonlyArray<string>,
  };
});
