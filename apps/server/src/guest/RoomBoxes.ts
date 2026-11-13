import {
  type ChatAttachment,
  CommandId,
  type ComposerContextRecord,
  type GuestMessageResolveInput,
  type GuestId,
  type GuestShareId,
  MessageId,
  type ModelSelection,
  type OrchestrationV2AppThread,
  type OrchestrationV2CreationSource,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_THREADS,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOX_PROGRESS_DETAIL_MAX_LENGTH,
  ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH,
  type RoomBoxAddThreadInput,
  RoomBoxError,
  type RoomBoxProgress,
  type RoomBoxPromptInput,
  type RoomBoxPromptResult,
  type RoomBoardContextCard,
  ROOM_BOX_PROMPT_MAX_LENGTH,
  ROOM_BOX_REPLY_MAX_LENGTH,
  type RoomBoxTurn,
  type RunId,
  type ServerProvider,
  ThreadId,
  type ThreadGuestMessage,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  roomArtifactContextRecord,
  roomCardsContextRecord,
  roomCommentContextRecord,
} from "@t3tools/shared/composerContextReferences";
import {
  roomArtifactBody,
  roomArtifactRequestOf,
  roomBoardCardIdentity,
  roomBoardNoteOfRef,
  roomBoxExcerpt,
  roomBoxRequestOf,
  roomCardLabelsOf,
  roomCommentRequestOf,
  roomRunPromptText,
  roomRunReplyText,
} from "@t3tools/shared/roomBoard";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import {
  guestMessageForAgent,
  roomBoxContextRecord,
  roomBoxOn,
  roomPersonName,
} from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ThreadLaunch from "../orchestration-v2/ThreadLaunchService.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";
import { guestThreadModel } from "./guestView.ts";
import { clip } from "./roomUpdates.ts";

const SETTLED_RUN = new Set(["completed", "interrupted", "failed", "cancelled", "rolled_back"]);
const WAITING_RUN = new Set(["preparing", "queued", "starting"]);
// A board shows a box's progress about this often, however fast its agent streams.
const PROGRESS_INTERVAL_MS = 1_000;
const BOX_TITLE_MAX_LENGTH = 80;
// Runs that are no box's, remembered so their events are not looked up again.
const IGNORED_RUNS_LIMIT = 1_000;
const MODEL_NAME_MAX_LENGTH = 120;

/** The model's name as the owner's composer labels it. */
export const roomBoxModelName = (
  selection: ModelSelection,
  providers: ReadonlyArray<Pick<ServerProvider, "instanceId" | "driver" | "models">>,
) => clip(guestThreadModel(selection, providers).name, MODEL_NAME_MAX_LENGTH);

/** What a tool use shows on a box: its name for the owner, and words that reveal no more. */
export function toolActivity(
  item: OrchestrationV2TurnItem,
): { readonly owner: string; readonly shared: string } | null {
  switch (item.type) {
    case "command_execution":
      return { owner: "Running a command", shared: "Running a command" };
    case "file_change":
      return { owner: "Editing files", shared: "Editing files" };
    case "file_search":
      return { owner: "Searching files", shared: "Searching files" };
    case "web_search":
      return { owner: "Searching the web", shared: "Searching the web" };
    case "subagent":
      return { owner: "Running a subagent", shared: "Running a subagent" };
    case "dynamic_tool":
      return {
        owner: clip(item.toolName ?? "Using a tool", ROOM_BOX_PROGRESS_DETAIL_MAX_LENGTH),
        shared: "Using a tool",
      };
    default:
      return null;
  }
}

/** A run of a box's agent that the board shows, as it stands now. */
interface TrackedRun {
  readonly runId: RunId;
  readonly threadId: ThreadId;
  readonly shareId: GuestShareId;
  readonly boxId: string;
  readonly artifactId: string | undefined;
  readonly commentId: string | undefined;
  readonly model: string | undefined;
  readonly prompt: string;
  readonly askedBy: GuestId | undefined;
  readonly startedAt: string;
  /** What the agent does; `approval` shows over it while a request waits on the owner. */
  work: Exclude<RoomBoxProgress["phase"], "approval">;
  /** The run's requests waiting on the owner: an approval, or an answer to a question. */
  readonly waitingOn: Set<string>;
  detail: string | undefined;
  sharedDetail: string | undefined;
  preview: string | undefined;
  draft: string | undefined;
  publishedAt: number;
  flushing: boolean;
}

const phaseOf = (run: TrackedRun): RoomBoxProgress["phase"] =>
  run.waitingOn.size > 0 ? "approval" : run.work;

const progressOf = (run: TrackedRun): RoomBoxProgress => {
  const phase = phaseOf(run);
  return {
    boxId: run.boxId,
    ...(run.artifactId === undefined ? {} : { artifactId: run.artifactId }),
    ...(run.commentId === undefined ? {} : { commentId: run.commentId }),
    phase,
    ...(phase === "tool" && run.detail !== undefined ? { detail: run.detail } : {}),
    ...(phase === "writing" && run.preview !== undefined ? { preview: run.preview } : {}),
    ...(run.draft === undefined ? {} : { draft: run.draft }),
    startedAt: run.startedAt,
    ...(run.model === undefined ? {} : { model: run.model }),
    ...(run.prompt === "" ? {} : { prompt: run.prompt }),
    ...(run.askedBy === undefined ? {} : { askedBy: run.askedBy }),
  };
};

/**
 * A box's progress as a guest gets it. A tool's name stays with the owner, and so does any word
 * of the work in a box's own thread, which guests never see; the room thread's they already do.
 */
const guestRoomBoxProgress = (
  progress: RoomBoxProgress,
  sharedDetail: string | undefined,
): RoomBoxProgress => {
  const { detail: _detail, ...rest } = progress;
  return progress.boxId === ROOM_BOARD_ROOM_BOX && sharedDetail !== undefined
    ? { ...rest, detail: sharedDetail }
    : rest;
};

/** A box's progress for the owner and for guests. */
export interface RoomBoxProgressViews {
  readonly owner: ReadonlyArray<RoomBoxProgress>;
  readonly guests: ReadonlyArray<RoomBoxProgress>;
}

const EMPTY_VIEWS: RoomBoxProgressViews = { owner: [], guests: [] };

/** A box's progress with the words a guest may see of its tool, kept apart until it is sent. */
type PublishedProgress = RoomBoxProgress & { readonly sharedDetail?: string };

/** A guest's waiting message the owner sends, and the model they picked for it. */
type GuestMessageSend = Pick<
  GuestMessageResolveInput,
  "threadId" | "guestMessageId" | "modelSelection"
>;

interface BoxMessage {
  readonly text: string;
  readonly records: ReadonlyArray<ComposerContextRecord>;
  readonly attachments: ReadonlyArray<ChatAttachment>;
  readonly modelSelection: ModelSelection | undefined;
  readonly messageId: MessageId;
  readonly commandId: CommandId;
  /** The new thread's title, when the box has none yet. */
  readonly title: string;
}

/** A box's thread as its room's share records it. */
interface RoomBoxOfThread {
  readonly roomThreadId: ThreadId;
  readonly share: ThreadGuestShare;
  readonly boxId: string;
}

/**
 * Thread boxes on the board of a thread the owner shares. Each box is a conversation of its own
 * on the owner's machine, made the first time it is prompted; the room thread's card is the room
 * thread. Their agents' progress is published to the room while they run, and never stored.
 */
export class RoomBoxes extends Context.Service<
  RoomBoxes,
  {
    /** The owner prompts one of their own boxes. Starts a turn, or queues it behind one. */
    readonly prompt: (
      input: RoomBoxPromptInput,
    ) => Effect.Effect<RoomBoxPromptResult, RoomBoxError>;
    /**
     * The owner puts one of their existing threads on the board as a new box, linked to it in the
     * same change, showing its last finished turn. Its runs show on the box from then on.
     */
    readonly addThread: (input: RoomBoxAddThreadInput) => Effect.Effect<void, RoomBoxError>;
    /**
     * The box a thread is behind, as its room's share records it, with that share and its room
     * thread; null when it is no box's. Only that thread's runs write to the box.
     */
    readonly boxOfThread: (
      threadId: ThreadId,
      items: ReadonlyArray<OrchestrationV2TurnItem>,
    ) => Effect.Effect<RoomBoxOfThread | null, Orchestrator.OrchestratorV2Error>;
    /**
     * The owner sends a guest's waiting message: in the guest's own box when it names one still
     * on the board, else in the room thread, with text this server builds.
     */
    readonly sendGuestMessage: (
      input: GuestMessageSend,
      creationSource: OrchestrationV2CreationSource,
    ) => Effect.Effect<void, RoomBoxError>;
    /** The owner's Send or Dismiss on a guest's waiting message. */
    readonly resolveGuestMessage: (
      input: GuestMessageResolveInput,
    ) => Effect.Effect<void, RoomBoxError>;
    /** What each box's agent of a share is doing now, as that changes. */
    readonly progress: (shareId: GuestShareId) => Stream.Stream<RoomBoxProgressViews>;
  }
>()("t3/guest/RoomBoxes") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const launches = yield* ThreadLaunch.ThreadLaunchService;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const random = yield* SecureRandom.SecureRandom;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const scope = yield* Effect.scope;
  // One box gets one thread, however many prompts reach it at once.
  const boxThreads = yield* Semaphore.make(1);

  const fail = (reason: RoomBoxError["reason"]) => new RoomBoxError({ reason });
  const uuid = random.uuidV4().pipe(Effect.orDie);
  const commandIdOf = (label: string) =>
    Effect.map(uuid, (id) => CommandId.make(`server:room-box:${label}:${id}`));

  const readRoom = Effect.fn("RoomBoxes.readRoom")(function* (threadId: ThreadId) {
    const { thread } = yield* orchestrator
      .getThreadRecords(threadId, [])
      .pipe(Effect.mapError(() => fail("inactive")));
    const share = thread.guestShare ?? null;
    if (share === null || thread.deletedAt !== null || thread.archivedAt !== null) {
      return yield* fail("inactive");
    }
    return { thread, share };
  });

  const isUsable = (threadId: ThreadId) =>
    orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.map(({ thread }) => thread.deletedAt === null && thread.archivedAt === null),
      Effect.orElseSucceed(() => false),
    );

  /**
   * The room thread whose share records each box's thread, read once here and kept from the
   * shares' changes, so a run finds its box without a scan. A hint only: `boxOfThread` checks the
   * share still records it, so an entry left behind finds nothing.
   */
  const boxRooms = new Map(
    (yield* orchestrator
      .listRoomBoxThreads()
      .pipe(
        Effect.catch((cause) =>
          Effect.logWarning("Could not read which threads are behind thread boxes", { cause }).pipe(
            Effect.as([]),
          ),
        ),
      )).map(({ roomThreadId, boxThreadId }) => [boxThreadId, roomThreadId] as const),
  );

  const boxOfThread = Effect.fn("RoomBoxes.boxOfThread")(function* (
    threadId: ThreadId,
    items: ReadonlyArray<OrchestrationV2TurnItem>,
  ) {
    // A message sent from the board names its room, for a link this server has not seen yet.
    const named = boxRooms.has(threadId) ? undefined : roomBoxRequestOf(items);
    const roomThreadId =
      boxRooms.get(threadId) ??
      (named === undefined ? null : yield* orchestrator.findGuestShareThreadId(named.shareId));
    if (roomThreadId === null) return null;
    const share =
      (yield* orchestrator.getThreadRecords(roomThreadId, [])).thread.guestShare ?? null;
    const boxId = share === null ? undefined : boxIdOfThread(share, threadId);
    return share === null || boxId === undefined ? null : { roomThreadId, share, boxId };
  });

  const dispatchMessage = (
    threadId: ThreadId,
    message: BoxMessage,
    creationSource: OrchestrationV2CreationSource,
  ) =>
    orchestrator.dispatch({
      type: "message.dispatch",
      commandId: message.commandId,
      threadId,
      messageId: message.messageId,
      text: message.text,
      ...(message.records.length === 0
        ? {}
        : { context: { version: 1, records: [...message.records] } }),
      attachments: [...message.attachments],
      ...(message.modelSelection === undefined ? {} : { modelSelection: message.modelSelection }),
      dispatchMode: { type: "queue_after_active" },
      createdBy: "user",
      creationSource,
    });

  /**
   * Sends a message in a box's thread: the room thread for the room's own card, else the box's
   * own thread, made in the room thread's project, worktree and branch when there is none or the
   * one it had was deleted or archived. Returns the thread it went to.
   */
  const deliver = Effect.fn("RoomBoxes.deliver")(function* (
    room: OrchestrationV2AppThread,
    boxId: string,
    message: BoxMessage,
    creationSource: OrchestrationV2CreationSource,
  ) {
    if (boxId === ROOM_BOARD_ROOM_BOX) {
      yield* dispatchMessage(room.id, message, creationSource).pipe(
        Effect.mapError(() => fail("failed")),
      );
      return room.id;
    }
    return yield* boxThreads.withPermits(1)(
      Effect.gen(function* () {
        const { thread: current, share } = yield* readRoom(room.id);
        if (roomBoxOn(share, boxId) === undefined) return yield* fail("box_gone");
        const mapped = share.boardThreads?.[boxId];
        if (mapped !== undefined && (yield* isUsable(mapped))) {
          yield* dispatchMessage(mapped, message, creationSource).pipe(
            Effect.mapError(() => fail("failed")),
          );
          return mapped;
        }
        // Recorded first: a launch that fails leaves a mapping the next prompt replaces.
        const threadId = ThreadId.make(yield* uuid);
        yield* orchestrator
          .dispatch({
            type: "thread.room-box.link",
            commandId: yield* commandIdOf("link"),
            threadId: current.id,
            shareId: share.id,
            boxId,
            boxThreadId: threadId,
          })
          .pipe(Effect.mapError(() => fail("box_gone")));
        const branch = current.branch ?? undefined;
        yield* launches
          .launch({
            commandId: message.commandId,
            threadId,
            projectId: current.projectId,
            title: message.title,
            modelSelection: message.modelSelection ?? current.modelSelection,
            runtimeMode: current.runtimeMode,
            interactionMode: current.interactionMode,
            workspaceStrategy:
              current.worktreePath === null
                ? { type: "root", ...(branch === undefined ? {} : { branch }) }
                : {
                    type: "existing_worktree",
                    worktreePath: current.worktreePath,
                    ...(branch === undefined ? {} : { branch }),
                  },
            initialMessage: {
              messageId: message.messageId,
              text: message.text,
              attachments: message.attachments,
              ...(message.records.length === 0
                ? {}
                : { context: { version: 1, records: [...message.records] } }),
            },
            createdBy: "user",
            creationSource,
          })
          .pipe(
            Effect.tapError((cause) =>
              Effect.logWarning("Could not start a box's thread", { cause }),
            ),
            Effect.mapError(() => fail("failed")),
          );
        return threadId;
      }),
    );
  });

  const boxTitle = (title: string, prompt: string) =>
    title.trim() ||
    clip(prompt.replace(/\s+/g, " ").trim(), BOX_TITLE_MAX_LENGTH) ||
    "Board thread";

  /**
   * The cards a prompt carries, each named and attributed from this board when it says which card
   * it is, so the label reads the same to everyone and no card passes for someone else's. One no
   * longer on the board is left out; one that names none is taken as sent.
   */
  const boardCards = Effect.fn("RoomBoxes.boardCards")(function* (
    share: ThreadGuestShare,
    cards: ReadonlyArray<RoomBoardContextCard>,
  ) {
    const ownerName = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.guestOwnerName),
      Effect.orElseSucceed(() => ""),
    );
    return cards.flatMap((card): ReadonlyArray<RoomBoardContextCard> => {
      if (card.ref === undefined) return [card];
      const note = roomBoardNoteOfRef(share.board, card.ref);
      if (note === undefined) return [];
      const { label: _label, author: _author, name: _name, ...rest } = card;
      return [{ ...rest, ...roomBoardCardIdentity(note, roomPersonName(share, ownerName)) }];
    });
  });

  const prompt = Effect.fn("RoomBoxes.prompt")(function* (input: RoomBoxPromptInput) {
    const { thread: room, share } = yield* readRoom(input.threadId);
    const box = roomBoxOn(share, input.boxId);
    if (input.boxId !== ROOM_BOARD_ROOM_BOX) {
      if (box === undefined) return yield* fail("box_gone");
      // A guest's box runs on their requests, which the owner sends; this is the owner's own.
      if (box.guestId !== undefined) return yield* fail("not_yours");
    }
    const commandId = yield* commandIdOf("prompt");
    const batch = yield* uuid;
    const artifact = share.board?.notes.find(
      (note) => note.id === input.artifactId && note.kind === "artifact",
    );
    const comment = share.board?.notes.find(
      (note) => note.id === input.commentId && note.kind === "comment",
    );
    const cards = yield* boardCards(share, input.cards ?? []);
    const shown: ReadonlyArray<ComposerContextRecord> = [
      ...(cards.length === 0 ? [] : [roomCardsContextRecord({ batch, cards })]),
      ...(artifact === undefined
        ? []
        : [
            roomArtifactContextRecord({
              batch,
              shareId: share.id,
              noteId: artifact.id,
              title: artifact.text,
              current: artifact.artifact?.body,
              threadId: room.id,
              boxId: input.boxId,
            }),
          ]),
      ...(comment === undefined
        ? []
        : [
            roomCommentContextRecord({
              batch,
              shareId: share.id,
              noteId: comment.id,
              threadId: room.id,
              boxId: input.boxId,
            }),
          ]),
    ];
    const chips = shown.map(formatComposerContextReference).join(" ");
    const text = [input.text.trim(), chips].filter((part) => part !== "").join("\n\n");
    if (text === "") return yield* fail("failed");
    const boxThreadId = yield* deliver(
      room,
      input.boxId,
      {
        text,
        records:
          input.boxId === ROOM_BOARD_ROOM_BOX
            ? shown
            : [...shown, roomBoxContextRecord(batch, share.id, input.boxId)],
        attachments: [],
        modelSelection: input.modelSelection,
        messageId: MessageId.make(commandId),
        commandId,
        title: boxTitle(box?.text ?? "", input.text),
      },
      "web",
    );
    return { boxThreadId };
  });

  /** A thread's last turn as its box shows it, when its last run finished and said something. */
  const lastTurnOf = Effect.fn("RoomBoxes.lastTurnOf")(
    function* (threadId: ThreadId) {
      const runId = (yield* orchestrator.getThreadShell(threadId))?.latestRunId ?? null;
      if (runId === null) return undefined;
      const { turnItems, runs } = yield* orchestrator.getThreadRecords(
        threadId,
        ["turnItems", "runs"],
        { turnItemRunIds: [runId], runIds: [runId] },
      );
      const run = runs.find((candidate) => candidate.id === runId);
      const reply = roomRunReplyText(turnItems);
      if (run?.status !== "completed" || reply === "") return undefined;
      const cards = roomCardLabelsOf(turnItems);
      const model = roomBoxModelName(run.modelSelection, yield* providerRegistry.getProviders);
      const turn: RoomBoxTurn = {
        id: run.id,
        prompt: roomBoxExcerpt(roomRunPromptText(turnItems), ROOM_BOX_PROMPT_MAX_LENGTH),
        ...(cards.length === 0 ? {} : { cards: [...cards] }),
        ...(model === "" ? {} : { model }),
        reply: roomBoxExcerpt(reply, ROOM_BOX_REPLY_MAX_LENGTH),
        at: DateTime.formatIso(run.completedAt ?? (yield* DateTime.now)),
      };
      return turn;
    },
    // The box starts empty instead.
    Effect.catch((cause) =>
      Effect.logWarning("Could not read a thread's last turn", { cause }).pipe(
        Effect.as(undefined),
      ),
    ),
  );

  const addThread = Effect.fn("RoomBoxes.addThread")(function* (input: RoomBoxAddThreadInput) {
    const { thread: room, share } = yield* readRoom(input.threadId);
    if (Object.values(share.boardThreads ?? {}).includes(input.boxThreadId)) {
      return yield* fail("already_on_board");
    }
    const notes = share.board?.notes ?? [];
    if (
      notes.length >= ROOM_BOARD_MAX_NOTES ||
      notes.filter((note) => note.kind === "thread").length >= ROOM_BOARD_MAX_THREADS
    ) {
      return yield* fail("board_full");
    }
    const { thread } = yield* orchestrator
      .getThreadRecords(input.boxThreadId, [])
      .pipe(Effect.mapError(() => fail("thread_unavailable")));
    const elsewhere = yield* boxOfThread(thread.id, []).pipe(Effect.mapError(() => fail("failed")));
    // A shared thread, one in someone's room, or another board's box shows its turns to a room.
    if (
      thread.id === room.id ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null ||
      thread.guestShare != null ||
      thread.roomLink != null ||
      elsewhere !== null
    ) {
      return yield* fail("thread_unavailable");
    }
    const turn = yield* lastTurnOf(thread.id);
    yield* orchestrator
      .dispatch({
        type: "thread.room-box.link",
        commandId: yield* commandIdOf("add"),
        threadId: room.id,
        shareId: share.id,
        boxId: input.boxId,
        boxThreadId: thread.id,
        box: {
          text: boxTitle(clip(thread.title.replace(/\s+/g, " ").trim(), BOX_TITLE_MAX_LENGTH), ""),
          x: input.x,
          y: input.y,
          ...(turn === undefined ? {} : { turn }),
        },
      })
      .pipe(Effect.mapError(() => fail("failed")));
  });

  /** The send a guest's message always had: the owner's Send on the room thread. */
  const sendInRoom = (
    roomThreadId: ThreadId,
    input: GuestMessageSend,
    attachments: ReadonlyArray<ChatAttachment>,
    creationSource: OrchestrationV2CreationSource,
  ) =>
    Effect.flatMap(commandIdOf("guest-send"), (commandId) =>
      orchestrator.dispatch({
        type: "message.dispatch",
        commandId,
        threadId: roomThreadId,
        messageId: MessageId.make(commandId),
        guestMessageId: input.guestMessageId,
        text: "",
        attachments: [...attachments],
        ...(input.modelSelection === undefined ? {} : { modelSelection: input.modelSelection }),
        dispatchMode: { type: "queue_after_active" },
        createdBy: "user",
        creationSource,
      }),
    ).pipe(Effect.mapError(() => fail("failed")));

  const sendGuestMessage = Effect.fn("RoomBoxes.sendGuestMessage")(function* (
    input: GuestMessageSend,
    creationSource: OrchestrationV2CreationSource,
  ) {
    const { thread: room, share } = yield* readRoom(input.threadId);
    const message = share.messages.find((candidate) => candidate.id === input.guestMessageId);
    if (message === undefined || message.status !== "pending") {
      return yield* fail("not_pending");
    }
    const attachments = message.attachments ?? [];
    // A box removed since goes to the room thread, as a guest's message always did.
    const box =
      message.boxId === undefined || message.boxId === ROOM_BOARD_ROOM_BOX
        ? undefined
        : roomBoxOn(share, message.boxId);
    if (box === undefined || box.guestId !== message.guestId) {
      return yield* sendInRoom(room.id, input, attachments, creationSource);
    }
    const built = guestMessageForAgent(share, room.id, message.id, message, box.id);
    const commandId = yield* commandIdOf("guest-box");
    const messageId = MessageId.make(commandId);
    const route = (sentAs: MessageId | null) =>
      Effect.flatMap(commandIdOf("route"), (routeId) =>
        orchestrator.dispatch({
          type: "thread.guest-message.route",
          commandId: routeId,
          threadId: room.id,
          guestMessageId: message.id,
          sentAs,
        }),
      );
    // Marked sent first, so a second Send finds it no longer waiting.
    yield* route(messageId).pipe(Effect.mapError(() => fail("not_pending")));
    yield* deliver(
      room,
      box.id,
      {
        text: built.text,
        records: built.records,
        attachments,
        modelSelection: input.modelSelection,
        messageId,
        commandId,
        title: boxTitle(box.text, message.text),
      },
      creationSource,
    ).pipe(Effect.tapError(() => route(null).pipe(Effect.ignore)));
  });

  // Live progress: in memory only, so a restart clears it with the runs it described.
  const tracked = new Map<RunId, TrackedRun>();
  const ignored = new Set<RunId>();
  const published = yield* SubscriptionRef.make<
    ReadonlyMap<GuestShareId, ReadonlyMap<RunId, PublishedProgress>>
  >(new Map());

  const publish = (run: TrackedRun, removed: boolean) =>
    SubscriptionRef.update(published, (current) => {
      const runs = new Map(current.get(run.shareId));
      if (removed) runs.delete(run.runId);
      else
        runs.set(run.runId, {
          ...progressOf(run),
          ...(phaseOf(run) === "tool" && run.sharedDetail !== undefined
            ? { sharedDetail: run.sharedDetail }
            : {}),
        });
      const next = new Map(current);
      if (runs.size === 0) next.delete(run.shareId);
      else next.set(run.shareId, runs);
      return next;
    });

  const nowMillis = Effect.map(DateTime.now, DateTime.toEpochMillis);

  /** Shows a run's new state now, or once a second has passed since it last showed. */
  const show = Effect.fnUntraced(function* (run: TrackedRun) {
    const now = yield* nowMillis;
    const wait = run.publishedAt + PROGRESS_INTERVAL_MS - now;
    if (wait <= 0) {
      run.publishedAt = now;
      return yield* publish(run, false);
    }
    if (run.flushing) return;
    run.flushing = true;
    yield* Effect.sleep(Duration.millis(wait)).pipe(
      Effect.andThen(
        Effect.suspend(() => {
          run.flushing = false;
          if (tracked.get(run.runId) !== run) return Effect.void;
          return Effect.flatMap(nowMillis, (at) => {
            run.publishedAt = at;
            return publish(run, false);
          });
        }),
      ),
      Effect.forkIn(scope),
    );
  });

  /**
   * The box a run belongs to, or null when it is no box's, checked against the share, with what
   * the run answers: the guest's own words when the owner sent a guest's request.
   */
  const boxOfRun = Effect.fn("RoomBoxes.boxOfRun")(function* (
    threadId: ThreadId,
    run: OrchestrationV2Run,
  ) {
    const { thread, turnItems } = yield* orchestrator.getThreadRecords(threadId, ["turnItems"], {
      turnItemRunIds: [run.id],
    });
    let share: ThreadGuestShare;
    let boxId: string;
    let asked: ThreadGuestMessage | undefined;
    if (thread.guestShare) {
      share = thread.guestShare;
      boxId = ROOM_BOARD_ROOM_BOX;
      const guestMessageId = turnItems.find((item) => item.type === "user_message")?.context?.guest
        ?.guestMessageId;
      asked = share.messages.find((message) => message.id === guestMessageId);
    } else {
      const box = yield* boxOfThread(threadId, turnItems);
      if (box === null) return null;
      share = box.share;
      boxId = box.boxId;
      // Found by the message this server sent the guest's request as.
      asked = share.messages.find((message) => message.sentAs === run.userMessageId);
    }
    const providers = yield* providerRegistry.getProviders;
    return {
      shareId: share.id,
      boxId,
      artifactId: roomArtifactRequestOf(turnItems, share.id)?.noteId,
      commentId: roomCommentRequestOf(turnItems, share.id),
      model: roomBoxModelName(run.modelSelection, providers),
      prompt: roomBoxExcerpt(
        asked?.text ?? roomRunPromptText(turnItems),
        ROOM_BOX_PROMPT_MAX_LENGTH,
      ),
      askedBy: asked?.guestId,
    };
  });

  const forgetIgnored = (runId: RunId) => {
    if (ignored.size >= IGNORED_RUNS_LIMIT) ignored.clear();
    ignored.add(runId);
  };

  /** What a run's agent does, from its status, keeping what it was doing while it runs on. */
  const workOf = (
    status: OrchestrationV2Run["status"],
    current: TrackedRun["work"] | undefined,
  ): TrackedRun["work"] =>
    WAITING_RUN.has(status)
      ? "queued"
      : current === undefined || current === "queued"
        ? "thinking"
        : current;

  /** The reply so far, from its message or its turn item, whichever carries the text. */
  const writing = (run: TrackedRun, text: string) => {
    // A turn item whose text is its message's carries none of its own.
    if (text.trim() === "") return false;
    run.work = "writing";
    run.preview = text
      .replace(/\s+/g, " ")
      .trim()
      .slice(-ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH)
      .replace(/^[\uDC00-\uDFFF]/, "");
    if (run.artifactId !== undefined) run.draft = roomArtifactBody(text).body;
    return true;
  };

  /** Keeps the index to a room's share as it changes. */
  const noteBoardThreads = (roomThreadId: ThreadId, share: ThreadGuestShare | null) => {
    let linked = false;
    for (const [boxThreadId, room] of boxRooms) {
      if (room === roomThreadId) boxRooms.delete(boxThreadId);
    }
    for (const boxThreadId of Object.values(share?.boardThreads ?? {})) {
      linked ||= !boxRooms.has(boxThreadId);
      boxRooms.set(boxThreadId, roomThreadId);
    }
    // A thread just put on the board may be running already, in a run passed over as no box's.
    if (linked) ignored.clear();
  };

  // Untraced: it sees every domain event of every thread, and most do nothing here.
  const onEvent = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (event.type === "thread.guest-share-updated") {
      return noteBoardThreads(event.threadId, event.payload.guestShare ?? null);
    }
    if (event.type === "run.created" || event.type === "run.updated") {
      const run = event.payload;
      const known = tracked.get(run.id);
      if (SETTLED_RUN.has(run.status)) {
        ignored.delete(run.id);
        if (known === undefined) return;
        tracked.delete(run.id);
        return yield* publish(known, true);
      }
      if (known === undefined) {
        if (ignored.has(run.id)) return;
        const box = yield* boxOfRun(event.threadId, run).pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Could not tell which box a run is for", { cause }).pipe(
              Effect.as(null),
            ),
          ),
        );
        if (box === null) return forgetIgnored(run.id);
        const entry: TrackedRun = {
          runId: run.id,
          threadId: event.threadId,
          ...box,
          startedAt: DateTime.formatIso(run.startedAt ?? run.requestedAt),
          work: workOf(run.status, undefined),
          waitingOn: new Set(),
          detail: undefined,
          sharedDetail: undefined,
          preview: undefined,
          draft: undefined,
          publishedAt: yield* nowMillis,
          flushing: false,
        };
        tracked.set(run.id, entry);
        return yield* publish(entry, false);
      }
      const work = workOf(run.status, known.work);
      if (work === known.work) return;
      known.work = work;
      return yield* show(known);
    }
    if (event.type === "runtime-request.updated") {
      const request = event.payload;
      if (request.kind === "dynamic_tool_call" || request.kind === "auth_refresh") return;
      // A request names its run when its event does; otherwise it is its thread's running one.
      const run =
        (event.runId === undefined ? undefined : tracked.get(event.runId)) ??
        [...tracked.values()].find(
          (candidate) => candidate.threadId === event.threadId && candidate.work !== "queued",
        );
      if (run === undefined) return;
      const waiting = run.waitingOn.size > 0;
      if (request.status === "pending") run.waitingOn.add(request.id);
      else run.waitingOn.delete(request.id);
      if (waiting === run.waitingOn.size > 0) return;
      // Waiting on the owner, and being answered, show at once.
      run.publishedAt = yield* nowMillis;
      return yield* publish(run, false);
    }
    if (event.type === "message.updated") {
      const message = event.payload;
      const run = message.runId === null ? undefined : tracked.get(message.runId);
      if (run === undefined || message.role !== "assistant" || !writing(run, message.text)) return;
      return yield* show(run);
    }
    if (event.type !== "turn-item.updated") return;
    const item = event.payload;
    const run = item.runId === null ? undefined : tracked.get(item.runId);
    if (run === undefined) return;
    if (item.type === "assistant_message") {
      if (!writing(run, item.text)) return;
      return yield* show(run);
    }
    if (item.type === "reasoning") {
      if (run.work === "thinking") return;
      run.work = "thinking";
      return yield* show(run);
    }
    const tool = toolActivity(item);
    if (tool === null) return;
    run.work = "tool";
    run.detail = tool.owner;
    run.sharedDetail = tool.shared;
    return yield* show(run);
  });
  yield* forkParked(
    Stream.runForEach(orchestrator.streamDomainEvents, (event) =>
      onEvent(event).pipe(
        Effect.catchCause((cause) => Effect.logWarning("Could not follow a box's run", { cause })),
      ),
    ),
  );

  const progress = (shareId: GuestShareId) =>
    SubscriptionRef.changes(published).pipe(
      Stream.map((current): RoomBoxProgressViews => {
        const runs = current.get(shareId);
        if (runs === undefined) return EMPTY_VIEWS;
        const entries = [...runs.values()].toSorted(
          (left, right) =>
            left.startedAt.localeCompare(right.startedAt) || left.boxId.localeCompare(right.boxId),
        );
        return {
          owner: entries.map(({ sharedDetail: _shared, ...entry }) => entry),
          guests: entries.map(({ sharedDetail, ...entry }) =>
            guestRoomBoxProgress(entry, sharedDetail),
          ),
        };
      }),
      Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
    );

  const resolveGuestMessage = Effect.fn("RoomBoxes.resolveGuestMessage")(function* (
    input: GuestMessageResolveInput,
  ) {
    if (input.decision === "send") {
      return yield* sendGuestMessage(input, input.creationSource ?? "web");
    }
    yield* orchestrator
      .dispatch({
        type: "thread.guest-message.dismiss",
        commandId: yield* commandIdOf("dismiss"),
        threadId: input.threadId,
        guestMessageId: input.guestMessageId,
      })
      .pipe(Effect.mapError(() => fail("not_pending")));
  });

  return RoomBoxes.of({
    prompt,
    addThread,
    boxOfThread,
    sendGuestMessage,
    resolveGuestMessage,
    progress,
  });
});

/** The box on the share's board whose recorded thread this is: only its runs write to the box. */
const boxIdOfThread = (share: ThreadGuestShare, threadId: ThreadId): string | undefined =>
  Object.entries(share.boardThreads ?? {}).find(
    ([boxId, boxThreadId]) => boxThreadId === threadId && roomBoxOn(share, boxId) !== undefined,
  )?.[0];

export const layer = Layer.effect(RoomBoxes, make);
