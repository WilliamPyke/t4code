import {
  CommandId,
  GUEST_AGENT_PROMPT_MAX_LENGTH,
  GUEST_ROOM_ACTIVITY_ROUTE,
  GUEST_ROOM_ARTIFACT_ROUTE,
  GUEST_ROOM_TURN_ROUTE,
  GUEST_ROOM_UPDATES_ROUTE,
  GUEST_TURN_PROMPT_MAX_LENGTH,
  GUEST_TURN_REPLY_MAX_LENGTH,
  type GuestAgentActivityRequest,
  type GuestShareId,
  type GuestTurnRequest,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  RoomArtifactRead,
  ROOM_TASK_CONTEXT_KIND,
  ROOM_UPDATES_MAX_CHARS,
  RoomTaskContextPayload,
  type RoomUpdate,
  RoomUpdates,
  roomCodeStateOf,
  type RunId,
  type SharedThreadCatchUpResult,
  type SharedThreadRoom,
  type SharedThreadTakeArtifactResult,
  SharedThreadJoinError,
  ThreadId,
  type ThreadRoomLink,
} from "@t3tools/contracts";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import { roomArtifactBody, roomArtifactRequestOf } from "@t3tools/shared/roomBoard";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { base64UrlEncode } from "../auth/utils.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";
import { clip } from "./roomUpdates.ts";

const REQUEST_TIMEOUT = Duration.seconds(20);
// A turn still running is told again this often, well inside the room's 10 minute expiry.
const ACTIVITY_REFRESH_MS = 3 * 60_000;
const SETTLED_RUN = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);
// Well over the largest catch-up an honest room sends, so a declared size past it is refused unread.
const MAX_UPDATES_BYTES = 512 * 1024;
const decodeUpdates = Schema.decodeUnknownEffect(Schema.toCodecJson(RoomUpdates));
const decodeRoomTask = Schema.decodeUnknownOption(RoomTaskContextPayload);
const decodeArtifact = Schema.decodeUnknownEffect(RoomArtifactRead);

/** A room's update as this machine keeps it: no characters nobody can see, a one-line name. */
const sanitizeUpdate = (update: RoomUpdate): ReadonlyArray<RoomUpdate> => {
  const text = sanitizeLinkedPrompt(update.text).text;
  const name = sanitizeLinkedPrompt(update.name ?? "").text.replace(/\s+/g, " ");
  const { name: _name, ...rest } = update;
  return text === "" ? [] : [{ ...rest, text, ...(name === "" ? {} : { name }) }];
};

/**
 * Where a link's host serves a guest route, or null. The host comes from a link someone sent, so
 * only a public-looking name is called: no port, path, address, or local name, which would
 * point this server at its own network.
 */
export function sharedThreadRouteUrl(host: string, route: string): string | null {
  const name = host.toLowerCase();
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(name) || /^[0-9.]+$/.test(name)) return null;
  if (name.endsWith(".local") || name.endsWith(".localhost") || name.endsWith(".internal")) {
    return null;
  }
  return `https://${name}${route}`;
}

/** A token goes only to the host its link names: a redirect could forward it anywhere. */
export const withoutRedirects = (client: HttpClient.HttpClient) =>
  HttpClient.transform(client, (response) =>
    Effect.provideService(response, FetchHttpClient.RequestInit, { redirect: "manual" }),
  );

// Thread ids can hold characters a file name cannot.
const tokenSecretName = (threadId: ThreadId) => `shared-room-${base64UrlEncode(threadId)}`;
// Which thread here joined a room, so a link to the room finds it without reading every thread.
const roomIndexName = (host: string, shareId: GuestShareId) =>
  `shared-room-thread-${base64UrlEncode(`${host.toLowerCase()}
${shareId}`)}`;

/** The task a run answers: the one the user took before asking it. */
const taskOfRun = (
  link: ThreadRoomLink,
  run: Pick<OrchestrationV2Run, "requestedAt"> | undefined,
): string | undefined =>
  link.task !== undefined &&
  run !== undefined &&
  DateTime.toEpochMillis(run.requestedAt) >= Date.parse(link.task.takenAt)
    ? link.task.id
    : undefined;

/** The last thing the agent said in a run, whole, or "" when it said nothing. */
const replyOf = (items: ReadonlyArray<OrchestrationV2TurnItem>) =>
  items
    .toSorted((left, right) => left.ordinal - right.ordinal)
    .flatMap((item) =>
      item.type === "assistant_message" && !item.streaming ? [item.text.trim()] : [],
    )
    .findLast((text) => text !== "") ?? "";

/** A finished run as the room shows it: the prompt and the last thing the agent said. */
export function guestTurnOf(
  runId: RunId,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): GuestTurnRequest | null {
  const prompt =
    items
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .flatMap((item) => (item.type === "user_message" ? [item.text.trim()] : []))[0] ?? "";
  const reply = replyOf(items);
  if (reply === "") return null;
  const truncated =
    prompt.length > GUEST_TURN_PROMPT_MAX_LENGTH || reply.length > GUEST_TURN_REPLY_MAX_LENGTH;
  return {
    id: runId,
    prompt: clip(prompt, GUEST_TURN_PROMPT_MAX_LENGTH),
    reply: clip(reply, GUEST_TURN_REPLY_MAX_LENGTH),
    ...(truncated ? { truncated } : {}),
  };
}

/**
 * The task card of this share that the owner took to their agent with one of a run's messages.
 * Only the owner's own composer attaches one; a guest's message reaches the agent with none.
 */
function roomTaskOfRun(
  items: ReadonlyArray<OrchestrationV2TurnItem>,
  shareId: GuestShareId,
): string | undefined {
  for (const item of items) {
    if (item.type !== "user_message") continue;
    for (const record of item.context?.records ?? []) {
      if (record.kind !== ROOM_TASK_CONTEXT_KIND || !("payload" in record)) continue;
      const task = Option.getOrUndefined(decodeRoomTask(record.payload));
      if (task?.shareId === shareId) return task.taskId;
    }
  }
  return undefined;
}

/** What a finished run puts in the artifact card it was asked to fill, from its whole reply. */
function artifactOfRun(
  noteId: string | undefined,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): NonNullable<GuestTurnRequest["artifact"]> | undefined {
  const reply = noteId === undefined ? "" : replyOf(items);
  if (noteId === undefined || reply === "") return undefined;
  const { body, truncated } = roomArtifactBody(reply);
  return { noteId, body, ...(truncated ? { truncated } : {}) };
}

/** The start of a run's prompt, as the room shows it while the run goes on. */
function runPromptOf(items: ReadonlyArray<OrchestrationV2TurnItem>): string {
  const prompt =
    items
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .flatMap((item) => (item.type === "user_message" ? [item.text] : []))[0] ?? "";
  return clip(prompt.replace(/\s+/g, " ").trim(), GUEST_AGENT_PROMPT_MAX_LENGTH);
}

/**
 * Keeps a thread joined from someone's room connected to it: the room sees each turn start and
 * gets it as text once it finishes, and never runs it. What the room said comes back only as text
 * the user attaches to a message of their own. On the owner's side, a finished turn of a thread
 * they share answers the task card they sent it for, and fills the artifact card it was for.
 */
export class SharedRoomLink extends Context.Service<
  SharedRoomLink,
  {
    /** Stores the room's token and marks the thread. A failure leaves a plain copy. */
    readonly connect: (
      threadId: ThreadId,
      host: string,
      room: SharedThreadRoom,
      /** The newest message the thread was created with, so catching up starts after it. */
      cursor?: string,
    ) => Effect.Effect<void>;
    /** Stops posting and forgets the token. */
    readonly leave: (threadId: ThreadId) => Effect.Effect<void, SharedThreadJoinError>;
    /** Reads what the room said since the last catch-up and moves the cursor past it. */
    readonly catchUp: (
      threadId: ThreadId,
    ) => Effect.Effect<SharedThreadCatchUpResult, SharedThreadJoinError>;
    /**
     * Has the next turn asked in the thread joined from this room answer a task card there.
     * Returns that thread, or null when no thread here is in the room.
     */
    readonly takeTask: (
      host: string,
      shareId: GuestShareId,
      taskId: string,
    ) => Effect.Effect<ThreadId | null>;
    /**
     * Finds the thread joined from this room and reads an artifact card from the room, for the
     * user to send to their agent from that thread. Sends and changes nothing.
     */
    readonly takeArtifact: (
      host: string,
      shareId: GuestShareId,
      artifactId: string,
    ) => Effect.Effect<SharedThreadTakeArtifactResult, SharedThreadJoinError>;
    /** Posts one finished run if its thread is connected. Never fails: the turn is local first. */
    readonly publishRun: (threadId: ThreadId, runId: RunId) => Effect.Effect<void>;
    /**
     * Tells the room a run started or still runs (`running`), or stopped without a turn to post
     * (`idle`), if its thread is connected. Never fails.
     */
    readonly publishActivity: (
      threadId: ThreadId,
      runId: RunId,
      state: GuestAgentActivityRequest["state"],
    ) => Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/guest/SharedRoomLink") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const random = yield* SecureRandom.SecureRandom;
  const http = withoutRedirects(yield* HttpClient.HttpClient);
  const projects = yield* ProjectService.ProjectService;
  const git = yield* GitWorkflow.GitWorkflowService;
  // The last run posted per thread: a finished run is updated again when its checkpoint lands.
  const posted = new Map<ThreadId, RunId>();
  // The run each connected thread told its room is running, and when it last said so.
  const running = new Map<ThreadId, { readonly runId: RunId; at: number }>();

  const setLink = Effect.fn("SharedRoomLink.setLink")(function* (
    threadId: ThreadId,
    roomLink: ThreadRoomLink | null,
  ) {
    const uuid = yield* random.uuidV4().pipe(Effect.orDie);
    yield* orchestrator.dispatch({
      type: "thread.room-link.set",
      commandId: CommandId.make(`server:room-link:${uuid}`),
      threadId,
      roomLink,
    });
  });

  const forget = (threadId: ThreadId) =>
    Effect.sync(() => {
      posted.delete(threadId);
      running.delete(threadId);
    }).pipe(Effect.andThen(secrets.remove(tokenSecretName(threadId))), Effect.ignore);

  const connect = Effect.fn("SharedRoomLink.connect")(
    function* (threadId: ThreadId, host: string, room: SharedThreadRoom, cursor?: string) {
      if (sharedThreadRouteUrl(host, GUEST_ROOM_TURN_ROUTE) === null) return;
      yield* secrets.set(tokenSecretName(threadId), new TextEncoder().encode(room.token));
      if (room.shareId !== undefined) {
        yield* secrets.set(roomIndexName(host, room.shareId), new TextEncoder().encode(threadId));
      }
      yield* setLink(threadId, {
        host: host.toLowerCase(),
        expiresAt: room.expiresAt,
        ...(cursor === undefined ? {} : { cursor }),
        ...(room.shareId === undefined ? {} : { shareId: room.shareId }),
      });
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not connect a joined thread to its room", { cause }),
    ),
  );

  const leave = Effect.fn("SharedRoomLink.leave")(function* (threadId: ThreadId) {
    yield* forget(threadId);
    yield* setLink(threadId, null).pipe(
      Effect.mapError(() => new SharedThreadJoinError({ reason: "leave_failed" })),
    );
  });

  const disconnect = (threadId: ThreadId) => leave(threadId).pipe(Effect.ignore);

  const fail = (reason: SharedThreadJoinError["reason"]) => new SharedThreadJoinError({ reason });

  const catchUp = Effect.fn("SharedRoomLink.catchUp")(function* (threadId: ThreadId) {
    const { thread } = yield* orchestrator
      .getThreadRecords(threadId, [])
      .pipe(Effect.mapError(() => fail("not_in_room")));
    const link = thread.roomLink ?? null;
    if (link === null) return yield* fail("not_in_room");
    const url = sharedThreadRouteUrl(link.host, GUEST_ROOM_UPDATES_ROUTE);
    const token = yield* secrets
      .get(tokenSecretName(threadId))
      .pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (url === null || Option.isNone(token) || now >= Date.parse(link.expiresAt)) {
      yield* disconnect(threadId);
      return yield* fail("room_ended");
    }
    const response = yield* http
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.bearerToken(new TextDecoder().decode(token.value)),
          HttpClientRequest.setUrlParams(link.cursor === undefined ? {} : { after: link.cursor }),
        ),
      )
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError(() => fail("unreachable")),
      );
    // The room ended or the owner removed this guest, so the thread stops saying it is in one.
    if (response.status === 410) {
      yield* disconnect(threadId);
      return yield* fail("room_ended");
    }
    if (response.status === 429) return yield* fail("too_fast");
    if (response.status !== 200) return yield* fail("unreachable");
    if (Number(response.headers["content-length"] ?? "0") > MAX_UPDATES_BYTES) {
      return yield* fail("invalid_response");
    }
    const room = yield* response.json.pipe(
      Effect.flatMap(decodeUpdates),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(() => fail("invalid_response")),
    );
    // The other machine is not trusted to keep its own limits, or to send a real time.
    const chars = room.updates.reduce((total, update) => total + update.text.length, 0);
    const cursor = room.cursor === null ? Option.none() : DateTime.make(room.cursor);
    if (chars > ROOM_UPDATES_MAX_CHARS || (room.cursor !== null && Option.isNone(cursor))) {
      return yield* fail("invalid_response");
    }
    const next = Option.getOrNull(Option.map(cursor, DateTime.formatIso));
    if (next !== null && next !== link.cursor) {
      // A cursor that cannot be saved repeats these updates next time, which loses nothing.
      yield* setLink(threadId, { ...link, cursor: next }).pipe(
        Effect.catch((cause) => Effect.logWarning("Could not save a room cursor", { cause })),
      );
    }
    return {
      updates: room.updates.flatMap(sanitizeUpdate),
      truncated: room.truncated,
      cursor: next,
    };
  }, Effect.scoped);

  /** The thread here joined from a room, with its link, or null when none still is. */
  const joinedThread = Effect.fn("SharedRoomLink.joinedThread")(function* (
    host: string,
    shareId: GuestShareId,
  ) {
    const stored = yield* secrets.get(roomIndexName(host, shareId));
    if (Option.isNone(stored)) return null;
    const threadId = ThreadId.make(new TextDecoder().decode(stored.value));
    const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
    const link = thread.roomLink ?? null;
    const now = yield* DateTime.now;
    // The index outlives a thread that left, was deleted, or joined the room again elsewhere.
    if (
      link === null ||
      link.host !== host.toLowerCase() ||
      link.shareId !== shareId ||
      thread.deletedAt !== null ||
      DateTime.toEpochMillis(now) >= Date.parse(link.expiresAt)
    ) {
      return null;
    }
    return { threadId, link, now };
  });

  const takeTask = Effect.fn("SharedRoomLink.takeTask")(
    function* (host: string, shareId: GuestShareId, taskId: string) {
      const joined = yield* joinedThread(host, shareId);
      if (joined === null) return null;
      yield* setLink(joined.threadId, {
        ...joined.link,
        task: { id: taskId, takenAt: DateTime.formatIso(joined.now) },
      });
      return joined.threadId;
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not take a task to a joined thread", { cause }).pipe(
        Effect.as(null),
      ),
    ),
  );

  const takeArtifact = Effect.fn("SharedRoomLink.takeArtifact")(function* (
    host: string,
    shareId: GuestShareId,
    artifactId: string,
  ) {
    const joined = yield* joinedThread(host, shareId).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not find a joined thread", { cause }).pipe(Effect.as(null)),
      ),
    );
    if (joined === null) return { threadId: null, artifact: null };
    const { threadId, link } = joined;
    const url = sharedThreadRouteUrl(link.host, GUEST_ROOM_ARTIFACT_ROUTE);
    const token = yield* secrets
      .get(tokenSecretName(threadId))
      .pipe(Effect.orElseSucceed(() => Option.none<Uint8Array>()));
    if (url === null || Option.isNone(token)) {
      yield* disconnect(threadId);
      return yield* fail("room_ended");
    }
    const response = yield* http
      .execute(
        HttpClientRequest.get(url).pipe(
          HttpClientRequest.bearerToken(new TextDecoder().decode(token.value)),
          HttpClientRequest.setUrlParams({ note: artifactId }),
        ),
      )
      .pipe(
        Effect.timeout(REQUEST_TIMEOUT),
        Effect.mapError(() => fail("unreachable")),
      );
    if (response.status === 410) {
      yield* disconnect(threadId);
      return yield* fail("room_ended");
    }
    if (response.status === 404) return { threadId, artifact: null };
    if (response.status === 429) return yield* fail("too_fast");
    if (response.status !== 200) return yield* fail("unreachable");
    if (Number(response.headers["content-length"] ?? "0") > MAX_UPDATES_BYTES) {
      return yield* fail("invalid_response");
    }
    const read = yield* response.json.pipe(
      Effect.flatMap(decodeArtifact),
      Effect.timeout(REQUEST_TIMEOUT),
      Effect.mapError(() => fail("invalid_response")),
    );
    // It goes to this user's agent, so nothing they cannot see comes along.
    const body = read.body === undefined ? "" : sanitizeLinkedPrompt(read.body).text;
    const artifact: RoomArtifactRead = {
      title: sanitizeLinkedPrompt(read.title).text.replace(/\s+/g, " "),
      ...(body === "" ? {} : { body }),
    };
    return { threadId, artifact };
  }, Effect.scoped);

  /** Clears the task a posted turn answered, unless the user took another since. */
  const finishTask = (threadId: ThreadId, taskId: string) =>
    orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.flatMap(({ thread }) => {
        const link = thread.roomLink ?? null;
        if (link?.task?.id !== taskId) return Effect.void;
        const { task: _task, ...rest } = link;
        return setLink(threadId, rest);
      }),
      Effect.catch((cause) => Effect.logWarning("Could not clear an answered task", { cause })),
    );

  /** Where the thread's code is, for the room. Null when git cannot say or there is no branch. */
  const codeOf = (thread: OrchestrationV2AppThread) =>
    projects.getById(thread.projectId).pipe(
      Effect.flatMap((project) => {
        const cwd = thread.worktreePath ?? Option.getOrUndefined(project)?.workspaceRoot;
        return cwd === undefined
          ? Effect.succeed(null)
          : Effect.map(git.status({ cwd }), (status) => roomCodeStateOf(status, thread.branch));
      }),
      Effect.orElseSucceed(() => null),
    );

  /**
   * A run as the room hears of it: its items, the task it answers, where the code is, and the
   * room's artifact card the user asked it to fill.
   */
  const runFacts = Effect.fn("SharedRoomLink.runFacts")(function* (
    threadId: ThreadId,
    thread: OrchestrationV2AppThread,
    link: ThreadRoomLink,
    runId: RunId,
  ) {
    const { turnItems, runs } = yield* orchestrator.getThreadRecords(
      threadId,
      ["turnItems", "runs"],
      { turnItemRunIds: [runId], runIds: [runId] },
    );
    const taskId = taskOfRun(
      link,
      runs.find((run) => run.id === runId),
    );
    const code = yield* codeOf(thread);
    const artifactId =
      link.shareId === undefined
        ? undefined
        : roomArtifactRequestOf(turnItems, link.shareId)?.noteId;
    return {
      turnItems,
      artifactId,
      about: {
        ...(taskId === undefined ? {} : { taskId }),
        ...(code === null ? {} : { code }),
      },
    };
  });

  const publishRun = Effect.fn("SharedRoomLink.publishRun")(
    function* (threadId: ThreadId, runId: RunId) {
      if (posted.get(threadId) === runId) return;
      const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
      const link = thread.roomLink ?? null;
      if (link === null) return;
      const url = sharedThreadRouteUrl(link.host, GUEST_ROOM_TURN_ROUTE);
      const token = yield* secrets.get(tokenSecretName(threadId));
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      if (url === null || Option.isNone(token) || now >= Date.parse(link.expiresAt)) {
        return yield* disconnect(threadId);
      }
      const { turnItems, about, artifactId } = yield* runFacts(threadId, thread, link, runId);
      const turn = guestTurnOf(runId, turnItems);
      if (turn === null) return;
      const artifact = artifactOfRun(artifactId, turnItems);
      const request: GuestTurnRequest = {
        ...turn,
        ...about,
        ...(artifact === undefined ? {} : { artifact }),
      };
      const response = yield* http
        .execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.bearerToken(new TextDecoder().decode(token.value)),
            HttpClientRequest.bodyJsonUnsafe(request),
          ),
        )
        .pipe(Effect.timeout(REQUEST_TIMEOUT));
      // The room ended or the owner removed this guest. Anything else may pass, so the link stays.
      if (response.status === 410) return yield* disconnect(threadId);
      if (response.status >= 200 && response.status < 300) {
        posted.set(threadId, runId);
        if (about.taskId !== undefined) yield* finishTask(threadId, about.taskId);
        // The room stops showing the run as running once it has the turn.
        if (running.get(threadId)?.runId === runId) running.delete(threadId);
      } else yield* Effect.logWarning("The room refused a turn", { status: response.status });
    },
    Effect.scoped,
    Effect.catch((cause) => Effect.logWarning("Could not post a turn to its room", { cause })),
  );

  const publishActivity = Effect.fn("SharedRoomLink.publishActivity")(
    function* (threadId: ThreadId, runId: RunId, state: GuestAgentActivityRequest["state"]) {
      // Only a run the room was told about is cleared.
      if (state === "idle" && running.get(threadId)?.runId !== runId) return;
      const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
      const link = thread.roomLink ?? null;
      if (link === null) return;
      const url = sharedThreadRouteUrl(link.host, GUEST_ROOM_ACTIVITY_ROUTE);
      const token = yield* secrets.get(tokenSecretName(threadId));
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      if (url === null || Option.isNone(token) || now >= Date.parse(link.expiresAt)) {
        return yield* disconnect(threadId);
      }
      const request: GuestAgentActivityRequest =
        state === "idle"
          ? { id: runId, state }
          : yield* Effect.map(
              runFacts(threadId, thread, link, runId),
              ({ turnItems, about, artifactId }) => ({
                id: runId,
                state,
                prompt: runPromptOf(turnItems),
                ...about,
                ...(artifactId === undefined ? {} : { artifactId }),
              }),
            );
      const response = yield* http
        .execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.bearerToken(new TextDecoder().decode(token.value)),
            HttpClientRequest.bodyJsonUnsafe(request),
          ),
        )
        .pipe(Effect.timeout(REQUEST_TIMEOUT));
      if (response.status === 410) return yield* disconnect(threadId);
      if (response.status < 200 || response.status >= 300) {
        return yield* Effect.logWarning("The room refused a turn's activity", {
          status: response.status,
        });
      }
      if (state === "idle") running.delete(threadId);
      else running.set(threadId, { runId, at: now });
    },
    Effect.scoped,
    Effect.catch((cause) =>
      Effect.logWarning("Could not tell a room a turn started or stopped", { cause }),
    ),
  );

  /**
   * Shows a finished run of the owner's on the board of their room: it answers the task card it
   * was sent for, and fills the artifact card it was asked to.
   */
  const answerOnOwnBoard = Effect.fn("SharedRoomLink.answerOnOwnBoard")(
    function* (threadId: ThreadId, runId: RunId) {
      const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
      const share = thread.guestShare ?? null;
      if (share === null || share.board === undefined) return;
      const { turnItems } = yield* orchestrator.getThreadRecords(threadId, ["turnItems"], {
        turnItemRunIds: [runId],
      });
      const taskId = roomTaskOfRun(turnItems, share.id);
      const turn = taskId === undefined ? null : guestTurnOf(runId, turnItems);
      if (taskId !== undefined && turn !== null) {
        yield* orchestrator.dispatch({
          type: "thread.room-task.answer",
          commandId: CommandId.make(`server:room-task:${runId}`),
          threadId,
          shareId: share.id,
          taskId,
          turn: { id: turn.id, reply: turn.reply },
        });
      }
      const request = roomArtifactRequestOf(turnItems, share.id);
      const artifact = artifactOfRun(request?.noteId, turnItems);
      if (request === undefined || artifact === undefined) return;
      const askedBy =
        request.guestMessageId === undefined
          ? undefined
          : share.messages.find((message) => message.id === request.guestMessageId)?.guestId;
      yield* orchestrator.dispatch({
        type: "thread.room-artifact.fill",
        commandId: CommandId.make(`server:room-artifact:${runId}`),
        threadId,
        shareId: share.id,
        turnId: runId,
        ...artifact,
        ...(askedBy === undefined ? {} : { askedBy }),
      });
    },
    Effect.catch((cause) => Effect.logWarning("Could not show a turn on the board", { cause })),
  );

  type Job = {
    readonly kind: "turn" | "answer" | GuestAgentActivityRequest["state"];
    readonly threadId: ThreadId;
    readonly runId: RunId;
  };
  const worker = yield* makeDrainableWorker(({ kind, threadId, runId }: Job) =>
    kind === "turn"
      ? publishRun(threadId, runId)
      : kind === "answer"
        ? answerOnOwnBoard(threadId, runId)
        : publishActivity(threadId, runId, kind),
  );
  // Untraced: it sees every domain event of every thread, and most do nothing here.
  const onEvent = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    const { threadId } = event;
    if (event.type === "thread.deleted") return yield* forget(threadId);
    if (event.type === "run.updated") {
      const { id: runId, status } = event.payload;
      if (SETTLED_RUN.has(status)) {
        if (status === "completed") {
          yield* worker.enqueue({ kind: "turn", threadId, runId });
          yield* worker.enqueue({ kind: "answer", threadId, runId });
        }
        // After the turn, so a turn the room took has already cleared the run there.
        return yield* worker.enqueue({ kind: "idle", threadId, runId });
      }
      if (
        (status === "running" || status === "waiting") &&
        running.get(threadId)?.runId !== runId
      ) {
        return yield* worker.enqueue({ kind: "running", threadId, runId });
      }
    }
    const told = running.get(threadId);
    if (told === undefined) return;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    if (now - told.at < ACTIVITY_REFRESH_MS) return;
    // Marked now, so the events until the post lands do not each ask again.
    told.at = now;
    yield* worker.enqueue({ kind: "running", threadId, runId: told.runId });
  });
  yield* forkParked(Stream.runForEach(orchestrator.streamDomainEvents, onEvent));

  return SharedRoomLink.of({
    connect,
    leave,
    catchUp,
    takeTask,
    takeArtifact,
    publishRun,
    publishActivity,
    drain: worker.drain,
  });
});

export const layer = Layer.effect(SharedRoomLink, make);
