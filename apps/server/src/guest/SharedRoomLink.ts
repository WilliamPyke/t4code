import {
  CommandId,
  type ComposerContextRecord,
  GUEST_AGENT_PROMPT_MAX_LENGTH,
  GUEST_ROOM_ACTIVITY_ROUTE,
  GUEST_ROOM_ARTIFACT_ROUTE,
  GUEST_ROOM_EXPIRES_HEADER,
  GUEST_ROOM_TURN_ROUTE,
  GUEST_ROOM_UPDATES_ROUTE,
  GUEST_TURN_PROMPT_MAX_LENGTH,
  GUEST_TURN_REPLY_MAX_LENGTH,
  type GuestAgentActivityRequest,
  type GuestShareId,
  type GuestTurnRequest,
  MessageId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  RoomArtifactRead,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH,
  type RoomBoxProgress,
  ROOM_BOX_PROMPT_MAX_LENGTH,
  ROOM_BOX_REPLY_MAX_LENGTH,
  ROOM_TASK_CONTEXT_KIND,
  ROOM_UPDATES_MAX_CHARS,
  RoomTaskContextPayload,
  type RoomUpdate,
  RoomUpdates,
  roomCodeStateOf,
  type RunId,
  type SharedThreadCatchUpResult,
  type SharedThreadFindRoomResult,
  type SharedThreadLinkBoxInput,
  type SharedThreadPromptBoxInput,
  type SharedThreadPromptBoxResult,
  type SharedThreadRoom,
  type SharedThreadTakeArtifactResult,
  type ThreadGuestMessage,
  SharedThreadJoinError,
  ThreadId,
  type ThreadRoomLink,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  roomArtifactContextRecord,
  roomCardsContextRecord,
  roomCommentContextRecord,
} from "@t3tools/shared/composerContextReferences";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import {
  roomArtifactBody,
  roomArtifactRequestOf,
  roomBoxExcerpt,
  roomCardLabelsOf,
  roomCommentAnswer,
  roomCommentRequestOf,
  roomRunPromptText,
  roomRunReplyText,
} from "@t3tools/shared/roomBoard";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { base64UrlEncode } from "../auth/utils.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as RoomBoxes from "./RoomBoxes.ts";
import { clip } from "./roomUpdates.ts";

const REQUEST_TIMEOUT = Duration.seconds(20);
// A turn still running is told again this often, well inside the room's 10 minute expiry.
const ACTIVITY_REFRESH_MS = 3 * 60_000;
// A box's run tells its room what its agent is doing at most this often, however fast it streams.
const BOX_PROGRESS_INTERVAL_MS = 2_000;
const BOX_TITLE_MAX_LENGTH = 80;

interface BoxMessage {
  readonly text: string;
  readonly records: ReadonlyArray<ComposerContextRecord>;
  readonly modelSelection: ModelSelection | undefined;
}

/** What the agent of a box's run does now, as its room is told. */
interface BoxRun {
  work: Exclude<RoomBoxProgress["phase"], "approval">;
  detail: string | undefined;
  /** The reply so far. */
  text: string;
  /** The run's requests waiting on this machine's user. */
  readonly waitingOn: Set<string>;
  toldAt: number;
  /** A post is queued or on its way, so another is not queued behind it. */
  telling: boolean;
  /** What the room was told the run is, which stays the same while it runs. */
  readonly told: GuestAgentActivityRequest;
}
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

/** A finished run as the room shows it: the prompt and the last thing the agent said. */
export function guestTurnOf(
  runId: RunId,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): GuestTurnRequest | null {
  const prompt =
    items
      .toSorted((left, right) => left.ordinal - right.ordinal)
      .flatMap((item) => (item.type === "user_message" ? [item.text.trim()] : []))[0] ?? "";
  const reply = roomRunReplyText(items);
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
  const reply = noteId === undefined ? "" : roomRunReplyText(items);
  if (noteId === undefined || reply === "") return undefined;
  const { body, truncated } = roomArtifactBody(reply);
  return { noteId, body, ...(truncated ? { truncated } : {}) };
}

/** What a finished run posts in the comment thread it was asked to answer: its reply's markdown. */
function commentOfRun(
  noteId: string | undefined,
  items: ReadonlyArray<OrchestrationV2TurnItem>,
): NonNullable<GuestTurnRequest["comment"]> | undefined {
  const text = noteId === undefined ? "" : roomCommentAnswer(roomRunReplyText(items));
  return noteId === undefined || text === "" ? undefined : { noteId, text };
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
    /**
     * Runs a prompt to one of the user's own thread boxes of a room here: in the box's thread,
     * made beside the thread joined from that room the first time. Its turns show on the box.
     */
    readonly promptBox: (
      input: SharedThreadPromptBoxInput,
    ) => Effect.Effect<SharedThreadPromptBoxResult, SharedThreadJoinError>;
    /**
     * Makes one of the user's threads here the thread behind their own new box on a room's board,
     * beside the thread joined from that room. Its turns show on the box from then on, starting
     * with its last finished one.
     */
    readonly linkBox: (
      input: SharedThreadLinkBoxInput,
    ) => Effect.Effect<void, SharedThreadJoinError>;
    /** The thread joined from a room here, and the threads behind the user's boxes there. */
    readonly findRoom: (
      host: string,
      shareId: GuestShareId,
    ) => Effect.Effect<SharedThreadFindRoomResult>;
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
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const roomBoxes = yield* RoomBoxes.RoomBoxes;
  // One box gets one thread, however many prompts reach it at once.
  const boxThreads = yield* Semaphore.make(1);
  // The last run posted per thread: a finished run is updated again when its checkpoint lands.
  const posted = new Map<ThreadId, RunId>();
  // The run each connected thread told its room is running, and when it last said so.
  const running = new Map<ThreadId, { readonly runId: RunId; at: number }>();
  // What the agent of each box thread's run does now, for its box in the room.
  const boxRuns = new Map<RunId, BoxRun>();

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
      const told = running.get(threadId);
      if (told !== undefined) boxRuns.delete(told.runId);
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

  /**
   * Moves the thread's room end on to when the owner's server says the room ends now, which an
   * extended link makes later. Returns the end the thread has after, in epoch milliseconds.
   */
  const learnRoomEnd = Effect.fn("SharedRoomLink.learnRoomEnd")(function* (
    threadId: ThreadId,
    known: ThreadRoomLink,
    header: string | undefined,
  ) {
    const told = header === undefined ? Option.none() : DateTime.make(header);
    const knownEnd = Date.parse(known.expiresAt);
    if (Option.isNone(told) || DateTime.toEpochMillis(told.value) <= knownEnd) return knownEnd;
    const end = told.value;
    // Read again: a catch-up may have moved the link's cursor since `known` was read.
    return yield* orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.flatMap(({ thread }) =>
        thread.roomLink == null
          ? Effect.succeed(knownEnd)
          : setLink(threadId, { ...thread.roomLink, expiresAt: DateTime.formatIso(end) }).pipe(
              Effect.as(DateTime.toEpochMillis(end)),
            ),
      ),
      Effect.catch((cause) =>
        Effect.logWarning("Could not move a room's end", { cause }).pipe(Effect.as(knownEnd)),
      ),
    );
  });

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

  /** An artifact card as the room has it now, or null once the room no longer has it. */
  const readArtifact = Effect.fn("SharedRoomLink.readArtifact")(function* (
    threadId: ThreadId,
    link: ThreadRoomLink,
    artifactId: string,
  ) {
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
    if (response.status === 404) return null;
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
    return artifact;
  }, Effect.scoped);

  const findJoined = (host: string, shareId: GuestShareId) =>
    joinedThread(host, shareId).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Could not find a joined thread", { cause }).pipe(Effect.as(null)),
      ),
    );

  const takeArtifact = Effect.fn("SharedRoomLink.takeArtifact")(function* (
    host: string,
    shareId: GuestShareId,
    artifactId: string,
  ) {
    const joined = yield* findJoined(host, shareId);
    if (joined === null) return { threadId: null, artifact: null };
    const artifact = yield* readArtifact(joined.threadId, joined.link, artifactId);
    return { threadId: joined.threadId, artifact };
  });

  const findRoom = Effect.fn("SharedRoomLink.findRoom")(function* (
    host: string,
    shareId: GuestShareId,
  ) {
    const joined = yield* findJoined(host, shareId);
    return joined === null
      ? { threadId: null, boxes: {} }
      : { threadId: joined.threadId, boxes: joined.link.boxes ?? {} };
  });

  const boxMessage = (threadId: ThreadId, commandId: CommandId, message: BoxMessage) =>
    orchestrator.dispatch({
      type: "message.dispatch",
      commandId,
      threadId,
      messageId: MessageId.make(commandId),
      text: message.text,
      ...(message.records.length === 0
        ? {}
        : { context: { version: 1, records: [...message.records] } }),
      attachments: [],
      ...(message.modelSelection === undefined ? {} : { modelSelection: message.modelSelection }),
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
      creationSource: "web",
    });

  const promptBox = Effect.fn("SharedRoomLink.promptBox")(function* (
    input: SharedThreadPromptBoxInput,
  ) {
    const joined = yield* findJoined(input.host, input.shareId);
    if (joined === null) return { threadId: null };
    const asked = sanitizeLinkedPrompt(input.text).text.trim();
    const artifact =
      input.artifactId === undefined
        ? null
        : yield* readArtifact(joined.threadId, joined.link, input.artifactId);
    const batch = yield* random.uuidV4().pipe(Effect.orDie);
    const cards = (input.cards ?? []).flatMap((card) => {
      const text = sanitizeLinkedPrompt(card.text).text;
      return text.trim() === "" ? [] : [{ ...card, text }];
    });
    const records: ReadonlyArray<ComposerContextRecord> = [
      ...(cards.length === 0 ? [] : [roomCardsContextRecord({ batch, cards })]),
      ...(artifact === null || input.artifactId === undefined
        ? []
        : [
            roomArtifactContextRecord({
              batch,
              shareId: input.shareId,
              noteId: input.artifactId,
              title: artifact.title,
              current: artifact.body,
              boxId: input.boxId,
            }),
          ]),
      // The room checks it is a comment thread there when it takes the turn.
      ...(input.commentId === undefined
        ? []
        : [
            roomCommentContextRecord({
              batch,
              shareId: input.shareId,
              noteId: input.commentId,
              boxId: input.boxId,
            }),
          ]),
    ];
    const chips = records.map(formatComposerContextReference).join(" ");
    const text = [asked, chips].filter((part) => part !== "").join("\n\n");
    if (text === "") return yield* fail("launch_failed");
    const commandId = CommandId.make(`server:room-box:${batch}`);
    const message: BoxMessage = { text, records, modelSelection: input.modelSelection };
    // Null: the thread left the room since it was found.
    const delivered = yield* boxThreads
      .withPermits(1)(
        Effect.gen(function* () {
          const { thread: room } = yield* orchestrator.getThreadRecords(joined.threadId, []);
          const link = room.roomLink ?? null;
          const token = yield* secrets.get(tokenSecretName(joined.threadId));
          if (link === null || Option.isNone(token)) return null;
          const mapped = link.boxes?.[input.boxId];
          const usable =
            mapped !== undefined &&
            (yield* orchestrator.getThreadRecords(mapped, []).pipe(
              Effect.map(
                ({ thread }) =>
                  thread.deletedAt === null &&
                  thread.archivedAt === null &&
                  thread.roomLink?.boxId === input.boxId,
              ),
              Effect.orElseSucceed(() => false),
            ));
          if (mapped !== undefined && usable) {
            yield* boxMessage(mapped, commandId, message);
            return { threadId: mapped };
          }
          const branch = room.branch ?? undefined;
          const launched = yield* launches.launch({
            commandId: CommandId.make(`server:room-box:launch:${batch}`),
            projectId: room.projectId,
            title:
              input.title.trim() ||
              clip(asked.replace(/\s+/g, " "), BOX_TITLE_MAX_LENGTH) ||
              "Board thread",
            modelSelection: input.modelSelection ?? room.modelSelection,
            runtimeMode: room.runtimeMode,
            interactionMode: room.interactionMode,
            workspaceStrategy:
              room.worktreePath === null
                ? { type: "root", ...(branch === undefined ? {} : { branch }) }
                : {
                    type: "existing_worktree",
                    worktreePath: room.worktreePath,
                    ...(branch === undefined ? {} : { branch }),
                  },
            createdBy: "user",
            creationSource: "web",
          });
          // Linked before its first message, so the room hears of that turn from its start.
          yield* secrets.set(tokenSecretName(launched.threadId), token.value);
          yield* setLink(launched.threadId, {
            host: link.host,
            expiresAt: link.expiresAt,
            ...(link.shareId === undefined ? {} : { shareId: link.shareId }),
            boxId: input.boxId,
          });
          yield* setLink(joined.threadId, {
            ...link,
            boxes: { ...link.boxes, [input.boxId]: launched.threadId },
          });
          yield* boxMessage(launched.threadId, commandId, message);
          return { threadId: launched.threadId };
        }),
      )
      .pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Could not run a box's prompt here", { cause }),
        ),
        Effect.mapError(() => fail("launch_failed")),
      );
    if (delivered === null) return yield* fail("room_ended");
    return delivered;
  });

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
    const commentId =
      link.shareId === undefined ? undefined : roomCommentRequestOf(turnItems, link.shareId);
    const run = runs.find((candidate) => candidate.id === runId);
    const cards = roomCardLabelsOf(turnItems);
    const model =
      link.boxId === undefined || run === undefined
        ? ""
        : RoomBoxes.roomBoxModelName(run.modelSelection, yield* providerRegistry.getProviders);
    return {
      turnItems,
      artifactId,
      about: {
        ...(taskId === undefined ? {} : { taskId }),
        ...(code === null ? {} : { code }),
      },
      // A box thread's run shows on its box: what was asked without its chips, and with what.
      box:
        link.boxId === undefined
          ? undefined
          : {
              boxId: link.boxId,
              prompt: roomRunPromptText(turnItems).trim(),
              ...(cards.length === 0 ? {} : { cards: [...cards] }),
              ...(model === "" ? {} : { model }),
              commentId,
            },
    };
  });

  /** What a box's run tells its room now: its phase, and what its agent wrote so far. */
  const boxProgressOf = (live: BoxRun, artifactId: string | undefined) => {
    const phase: RoomBoxProgress["phase"] = live.waitingOn.size > 0 ? "approval" : live.work;
    const preview = live.text
      .replace(/\s+/g, " ")
      .trim()
      .slice(-ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH)
      .replace(/^[\uDC00-\uDFFF]/, "");
    return {
      phase,
      ...(phase === "tool" && live.detail !== undefined ? { detail: live.detail } : {}),
      ...(phase === "writing" && preview !== "" ? { preview } : {}),
      ...(artifactId === undefined || live.text.trim() === ""
        ? {}
        : { draft: roomArtifactBody(live.text).body }),
    };
  };

  const publishRun = Effect.fn("SharedRoomLink.publishRun")(
    function* (threadId: ThreadId, runId: RunId) {
      if (posted.get(threadId) === runId) return;
      const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
      const link = thread.roomLink ?? null;
      if (link === null) return;
      const url = sharedThreadRouteUrl(link.host, GUEST_ROOM_TURN_ROUTE);
      const token = yield* secrets.get(tokenSecretName(threadId));
      const now = DateTime.toEpochMillis(yield* DateTime.now);
      // Past its end the room is asked once anyway, since the owner may have extended the link.
      const pastEnd = now >= Date.parse(link.expiresAt);
      if (url === null || Option.isNone(token)) return yield* disconnect(threadId);
      const { turnItems, about, artifactId, box } = yield* runFacts(threadId, thread, link, runId);
      const turn = guestTurnOf(runId, turnItems);
      if (turn === null) return;
      const artifact = artifactOfRun(artifactId, turnItems);
      const { prompt: asked, commentId, ...shown } = box ?? { prompt: turn.prompt };
      const comment = commentOfRun(commentId, turnItems);
      const request: GuestTurnRequest = {
        ...turn,
        prompt: clip(asked, GUEST_TURN_PROMPT_MAX_LENGTH),
        ...about,
        ...(artifact === undefined ? {} : { artifact }),
        ...shown,
        ...(comment === undefined ? {} : { comment }),
      };
      const response = yield* http
        .execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.bearerToken(new TextDecoder().decode(token.value)),
            HttpClientRequest.bodyJsonUnsafe(request),
          ),
        )
        .pipe(
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.tapError(() => (pastEnd ? disconnect(threadId) : Effect.void)),
        );
      const delivered = response.status >= 200 && response.status < 300;
      // The room ended or the owner removed this guest. Anything else may pass, so the link stays,
      // unless the room was due to end and did not answer that it was extended.
      if (response.status === 410 || (pastEnd && !delivered)) return yield* disconnect(threadId);
      if (delivered) {
        const end = yield* learnRoomEnd(
          threadId,
          link,
          response.headers[GUEST_ROOM_EXPIRES_HEADER],
        );
        posted.set(threadId, runId);
        if (about.taskId !== undefined) yield* finishTask(threadId, about.taskId);
        // The room stops showing the run as running once it has the turn.
        if (running.get(threadId)?.runId === runId) running.delete(threadId);
        boxRuns.delete(runId);
        if (end <= now) yield* disconnect(threadId);
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
      const pastEnd = now >= Date.parse(link.expiresAt);
      if (url === null || Option.isNone(token)) return yield* disconnect(threadId);
      const live = boxRuns.get(runId);
      const request: GuestAgentActivityRequest =
        state === "idle"
          ? { id: runId, state }
          : // A box's run says again every few seconds; what it was asked does not change.
            (live?.told ??
            (yield* Effect.map(
              runFacts(threadId, thread, link, runId),
              ({ turnItems, about, artifactId, box }): GuestAgentActivityRequest => ({
                id: runId,
                state,
                prompt:
                  box === undefined
                    ? runPromptOf(turnItems)
                    : clip(box.prompt.replace(/\s+/g, " "), GUEST_AGENT_PROMPT_MAX_LENGTH),
                ...about,
                ...(artifactId === undefined ? {} : { artifactId }),
                ...(box === undefined
                  ? {}
                  : {
                      boxId: box.boxId,
                      ...(box.model === undefined ? {} : { model: box.model }),
                      ...(box.commentId === undefined ? {} : { commentId: box.commentId }),
                    }),
              }),
            )));
      const tracked =
        request.boxId === undefined
          ? undefined
          : (live ??
            ({
              work: "thinking",
              detail: undefined,
              text: "",
              waitingOn: new Set(),
              toldAt: now,
              telling: false,
              told: request,
            } satisfies BoxRun));
      if (tracked !== undefined) {
        boxRuns.set(runId, tracked);
        tracked.toldAt = now;
      }
      const body: GuestAgentActivityRequest =
        tracked === undefined
          ? request
          : { ...request, ...boxProgressOf(tracked, request.artifactId) };
      const response = yield* http
        .execute(
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.bearerToken(new TextDecoder().decode(token.value)),
            HttpClientRequest.bodyJsonUnsafe(body),
          ),
        )
        .pipe(
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.ensuring(
            Effect.sync(() => {
              if (tracked !== undefined) tracked.telling = false;
            }),
          ),
          Effect.tapError(() => (pastEnd ? disconnect(threadId) : Effect.void)),
        );
      const delivered = response.status >= 200 && response.status < 300;
      if (response.status === 410 || (pastEnd && !delivered)) return yield* disconnect(threadId);
      if (!delivered) {
        return yield* Effect.logWarning("The room refused a turn's activity", {
          status: response.status,
        });
      }
      if (
        (yield* learnRoomEnd(threadId, link, response.headers[GUEST_ROOM_EXPIRES_HEADER])) <= now
      ) {
        return yield* disconnect(threadId);
      }
      if (state === "idle") {
        running.delete(threadId);
        boxRuns.delete(runId);
      } else running.set(threadId, { runId, at: now });
    },
    Effect.scoped,
    Effect.catch((cause) =>
      Effect.logWarning("Could not tell a room a turn started or stopped", { cause }),
    ),
  );

  /**
   * What a finished run shows on the board: the start of what was asked and the cards that went
   * with it (a guest's own words and cards when it was their request), and the model that ran it.
   */
  const aboutRun = Effect.fn("SharedRoomLink.aboutRun")(function* (
    items: ReadonlyArray<OrchestrationV2TurnItem>,
    run: OrchestrationV2Run | undefined,
    asked: ThreadGuestMessage | undefined,
  ) {
    const cards = asked === undefined ? roomCardLabelsOf(items) : (asked.cards ?? []);
    const model =
      run === undefined
        ? undefined
        : RoomBoxes.roomBoxModelName(run.modelSelection, yield* providerRegistry.getProviders);
    return {
      prompt: roomBoxExcerpt(asked?.text ?? roomRunPromptText(items), ROOM_BOX_PROMPT_MAX_LENGTH),
      ...(cards.length === 0 ? {} : { cards: [...cards] }),
      ...(model === undefined || model === "" ? {} : { model }),
    };
  });

  /**
   * Shows a finished run of the owner's on the board of their room: it answers the task card it
   * was sent for, and fills the artifact card it was asked to. A run in a thread box's own thread
   * shows on the box, and only when the share recorded that thread for that box.
   */
  const answerOnOwnBoard = Effect.fn("SharedRoomLink.answerOnOwnBoard")(
    function* (threadId: ThreadId, runId: RunId) {
      const { thread, turnItems, runs } = yield* orchestrator.getThreadRecords(
        threadId,
        ["turnItems", "runs"],
        { turnItemRunIds: [runId], runIds: [runId] },
      );
      const run = runs.find((candidate) => candidate.id === runId);
      const share = thread.guestShare ?? null;
      if (share === null) return yield* answerOnBox(threadId, runId, turnItems, run);
      if (share.board === undefined) return;
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
      yield* answerComment(threadId, share.id, runId, ROOM_BOARD_ROOM_BOX, turnItems, run);
      const request = roomArtifactRequestOf(turnItems, share.id);
      const artifact = artifactOfRun(request?.noteId, turnItems);
      if (request === undefined || artifact === undefined) return;
      const asked =
        request.guestMessageId === undefined
          ? undefined
          : share.messages.find((message) => message.id === request.guestMessageId);
      yield* orchestrator.dispatch({
        type: "thread.room-artifact.fill",
        commandId: CommandId.make(`server:room-artifact:${runId}`),
        threadId,
        shareId: share.id,
        turnId: runId,
        ...artifact,
        ...(asked?.guestId === undefined ? {} : { askedBy: asked.guestId }),
        ...(yield* aboutRun(turnItems, run, asked)),
        boxId: ROOM_BOARD_ROOM_BOX,
      });
    },
    Effect.catch((cause) => Effect.logWarning("Could not show a turn on the board", { cause })),
  );

  /** Posts a run of the owner's agent in the comment thread it was asked from, if it was. */
  const answerComment = Effect.fn("SharedRoomLink.answerComment")(function* (
    roomThreadId: ThreadId,
    shareId: GuestShareId,
    runId: RunId,
    boxId: string,
    turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
    run: OrchestrationV2Run | undefined,
  ) {
    const comment = commentOfRun(roomCommentRequestOf(turnItems, shareId), turnItems);
    if (comment === undefined) return;
    const model =
      run === undefined
        ? ""
        : RoomBoxes.roomBoxModelName(run.modelSelection, yield* providerRegistry.getProviders);
    yield* orchestrator.dispatch({
      type: "thread.room-comment.answer",
      commandId: CommandId.make(`server:room-comment:${runId}`),
      threadId: roomThreadId,
      shareId,
      noteId: comment.noteId,
      turnId: runId,
      text: comment.text,
      boxId,
      ...(model === "" ? {} : { model }),
    });
  });

  const answerOnBox = Effect.fn("SharedRoomLink.answerOnBox")(function* (
    threadId: ThreadId,
    runId: RunId,
    turnItems: ReadonlyArray<OrchestrationV2TurnItem>,
    run: OrchestrationV2Run | undefined,
  ) {
    const box = yield* roomBoxes.boxOfThread(threadId, turnItems);
    if (box === null) return;
    const { roomThreadId, share } = box;
    const reply = roomRunReplyText(turnItems);
    if (reply === "") return;
    // The guest's request the owner sent, found by the message this server sent it as.
    const asked =
      run === undefined
        ? undefined
        : share.messages.find((message) => message.sentAs === run.userMessageId);
    const askedBy = asked?.guestId === undefined ? {} : { askedBy: asked.guestId };
    const about = yield* aboutRun(turnItems, run, asked);
    yield* orchestrator.dispatch({
      type: "thread.room-box.turn",
      commandId: CommandId.make(`server:room-box:${runId}`),
      threadId: roomThreadId,
      shareId: share.id,
      boxId: box.boxId,
      turn: {
        id: runId,
        ...about,
        reply: roomBoxExcerpt(reply, ROOM_BOX_REPLY_MAX_LENGTH),
        at: DateTime.formatIso(yield* DateTime.now),
        ...askedBy,
      },
    });
    yield* answerComment(roomThreadId, share.id, runId, box.boxId, turnItems, run);
    const artifact = artifactOfRun(roomArtifactRequestOf(turnItems, share.id)?.noteId, turnItems);
    if (artifact === undefined) return;
    yield* orchestrator.dispatch({
      type: "thread.room-artifact.fill",
      commandId: CommandId.make(`server:room-artifact:${runId}`),
      threadId: roomThreadId,
      shareId: share.id,
      turnId: runId,
      ...artifact,
      ...askedBy,
      ...about,
      boxId: box.boxId,
    });
  });

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
  const linkBox = Effect.fn("SharedRoomLink.linkBox")(function* (input: SharedThreadLinkBoxInput) {
    const joined = yield* findJoined(input.host, input.shareId);
    if (joined === null) return yield* fail("room_ended");
    const outcome = yield* boxThreads
      .withPermits(1)(
        Effect.gen(function* () {
          const { thread: room } = yield* orchestrator.getThreadRecords(joined.threadId, []);
          const link = room.roomLink ?? null;
          const token = yield* secrets.get(tokenSecretName(joined.threadId));
          if (link === null || Option.isNone(token)) return "room_ended" as const;
          const thread = yield* orchestrator.getThreadRecords(input.threadId, []).pipe(
            Effect.map((records) => records.thread),
            Effect.orElseSucceed(() => null),
          );
          // A thread in a room already, the joined one or a box's among them, shows it its turns.
          if (
            thread === null ||
            thread.deletedAt !== null ||
            thread.archivedAt !== null ||
            thread.roomLink != null ||
            thread.id === joined.threadId ||
            Object.values(link.boxes ?? {}).includes(thread.id)
          ) {
            return "unavailable" as const;
          }
          yield* secrets.set(tokenSecretName(thread.id), token.value);
          yield* setLink(thread.id, {
            host: link.host,
            expiresAt: link.expiresAt,
            ...(link.shareId === undefined ? {} : { shareId: link.shareId }),
            boxId: input.boxId,
          });
          yield* setLink(joined.threadId, {
            ...link,
            boxes: { ...link.boxes, [input.boxId]: thread.id },
          });
          return "linked" as const;
        }),
      )
      .pipe(
        Effect.tapError((cause) =>
          Effect.logWarning("Could not link a box's thread here", { cause }),
        ),
        Effect.mapError(() => fail("launch_failed")),
      );
    if (outcome === "room_ended") return yield* fail("room_ended");
    if (outcome === "unavailable") return yield* fail("thread_unavailable");
    // So the box does not start empty: its thread's last turn, once that run has finished.
    const latest = yield* orchestrator.getThreadShell(input.threadId).pipe(
      Effect.map((shell) => shell?.latestRunId ?? null),
      Effect.orElseSucceed(() => null),
    );
    if (latest === null) return;
    const { runs } = yield* orchestrator
      .getThreadRecords(input.threadId, ["runs"], { runIds: [latest] })
      .pipe(Effect.orElseSucceed(() => ({ runs: [] })));
    if (runs.find((run) => run.id === latest)?.status === "completed") {
      yield* worker.enqueue({ kind: "turn", threadId: input.threadId, runId: latest });
    }
  });

  /** Notes what a box thread's event says its agent does. Returns whether that changed. */
  const noteBoxProgress = (live: BoxRun, event: OrchestrationV2DomainEvent): boolean => {
    const write = (text: string) => {
      // A turn item whose text is its message's carries none of its own.
      if (text.trim() === "" || (live.work === "writing" && live.text === text)) return false;
      live.work = "writing";
      live.text = text;
      return true;
    };
    if (event.type === "runtime-request.updated") {
      const request = event.payload;
      if (request.kind === "dynamic_tool_call" || request.kind === "auth_refresh") return false;
      const waiting = live.waitingOn.size > 0;
      if (request.status === "pending") live.waitingOn.add(request.id);
      else live.waitingOn.delete(request.id);
      return waiting !== live.waitingOn.size > 0;
    }
    if (event.type === "message.updated") {
      return event.payload.role === "assistant" && write(event.payload.text);
    }
    if (event.type !== "turn-item.updated") return false;
    const item = event.payload;
    if (item.type === "assistant_message") return write(item.text);
    if (item.type === "reasoning") {
      if (live.work === "thinking") return false;
      live.work = "thinking";
      return true;
    }
    const tool = RoomBoxes.toolActivity(item);
    if (tool === null || (live.work === "tool" && live.detail === tool.shared)) return false;
    live.work = "tool";
    live.detail = tool.shared;
    return true;
  };

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
    const live = boxRuns.get(told.runId);
    if (live !== undefined && noteBoxProgress(live, event)) {
      if (live.telling || now - live.toldAt < BOX_PROGRESS_INTERVAL_MS) return;
      live.telling = true;
      told.at = now;
      return yield* worker.enqueue({ kind: "running", threadId, runId: told.runId });
    }
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
    findRoom,
    promptBox,
    linkBox,
    publishRun,
    publishActivity,
    drain: worker.drain,
  });
});

export const layer = Layer.effect(SharedRoomLink, make);
