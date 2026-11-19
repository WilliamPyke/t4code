import {
  CommandId,
  type GuestId,
  type GuestShareId,
  ROOM_BOARD_ROOM_BOX,
  type RoomBoardAgentAddInput,
  type RoomBoardAgentArrangeInput,
  type RoomBoardAgentArrangeResult,
  type RoomBoardAgentMark,
  type RoomBoardAgentResult,
  type RoomBoardAgentUpdateInput,
  type RoomBoardAgentView,
  type RoomBoardChange,
  type SharedThreadJoinError,
  type ThreadId,
} from "@t3tools/contracts";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import { roomBoxOn } from "@t3tools/shared/guestRoom";
import { EMPTY_ROOM_BOARD, applyRoomBoardChange } from "@t3tools/shared/roomBoard";
import {
  roomBoardAgentAdd,
  roomBoardAgentArrange,
  roomBoardAgentUpdate,
  roomBoardAgentView,
  type RoomBoardAgentOps,
  type RoomBoardAgentTarget,
} from "@t3tools/shared/roomBoardAgent";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  roomPersonName,
  roomScope,
  threadRoomOf,
  type ThreadRoom,
} from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as RoomBoxes from "./RoomBoxes.ts";
import * as SharedRoomLink from "./SharedRoomLink.ts";

const AGENT_ERROR_MESSAGES = {
  not_on_board:
    "This thread is not on a board. Only a board's own thread or one of its thread boxes can use it.",
  board_gone: "This thread's board is no longer there.",
  unreachable: "This box can't reach the room's board from here.",
  too_fast: "The room's board is taking too many changes from this machine. Try again in a minute.",
  host_outdated:
    "This board's host needs updating before it takes this from an agent. Tell your user; the board's other tools still work.",
} as const;

export class RoomBoardAgentError extends Schema.TaggedError<RoomBoardAgentError>()(
  "RoomBoardAgentError",
  {
    reason: Schema.Literals([
      "not_on_board",
      "board_gone",
      "unreachable",
      "too_fast",
      "host_outdated",
    ]),
  },
) {
  override get message(): string {
    return AGENT_ERROR_MESSAGES[this.reason];
  }
}

/**
 * A guest's own box on a room this server shares, whose agent runs on the guest's machine and asks
 * for the board through the room's token. Its changes are that guest's, marked as that box's agent.
 */
export interface RoomGuestBox {
  readonly roomThreadId: ThreadId;
  readonly shareId: GuestShareId;
  readonly guestId: GuestId;
  readonly boxId: string;
  readonly turnId?: string;
  readonly model?: string;
}

/** Who asks: a thread here, by id, or a guest's own box from their machine. */
type Caller = ThreadId | RoomGuestBox;

/** The board a thread's agent works on, kept up to date with what it changed in this call. */
interface Target extends RoomBoardAgentTarget {
  readonly roomThreadId: ThreadId;
  readonly room: ThreadRoom;
  /** Whose changes they are: null for the owner, or the guest whose machine runs the agent. */
  readonly author: GuestId | null;
  readonly agent: RoomBoardAgentMark;
}

/**
 * The board a thread's agent works on: the one its own thread or thread box is on. It reads it, and
 * adds and changes cards there as the room's owner would, marked as its own, through the same rules
 * as any change. It never removes a card. A thread here whose box is on a room another server shares
 * asks that server, which does the same for that box, as its guest's.
 */
export class RoomBoardAgent extends Context.Service<
  RoomBoardAgent,
  {
    readonly read: (by: Caller) => Effect.Effect<RoomBoardAgentView, RoomBoardAgentError>;
    readonly add: (
      by: Caller,
      input: RoomBoardAgentAddInput,
    ) => Effect.Effect<RoomBoardAgentResult, RoomBoardAgentError>;
    readonly update: (
      by: Caller,
      input: RoomBoardAgentUpdateInput,
    ) => Effect.Effect<RoomBoardAgentResult, RoomBoardAgentError>;
    /** Moves, sizes and renames cards. A room another server shares must know how. */
    readonly arrange: (
      by: Caller,
      input: RoomBoardAgentArrangeInput,
    ) => Effect.Effect<RoomBoardAgentArrangeResult, RoomBoardAgentError>;
  }
>()("t3/guest/RoomBoardAgent") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const boxes = yield* RoomBoxes.RoomBoxes;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const random = yield* SecureRandom.SecureRandom;
  const links = yield* SharedRoomLink.SharedRoomLink;

  const fail = (reason: RoomBoardAgentError["reason"]) => new RoomBoardAgentError({ reason });
  const uuid = random.uuidV4().pipe(Effect.orDie);

  const ownerName = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.guestOwnerName),
    Effect.orElseSucceed(() => ""),
  );

  /** Who a task on the room's board can be for: its owner and its guests. */
  const peopleOf = Effect.fn("RoomBoardAgent.peopleOf")(function* (room: ThreadRoom) {
    const owner = roomPersonName(room, yield* ownerName)(undefined) ?? "the owner";
    return [
      { guestId: null, name: owner },
      ...(room.guests ?? []).map((guest) => ({ guestId: guest.id, name: guest.name })),
    ];
  });

  const threadOf = (threadId: ThreadId, reason: RoomBoardAgentError["reason"]) =>
    orchestrator.getThreadRecords(threadId, []).pipe(
      Effect.map(({ thread }) => thread),
      Effect.mapError(() => fail(reason)),
    );

  /** The run a thread's agent is in now, and that run's first message. */
  const runOf = Effect.fn("RoomBoardAgent.runOf")(function* (threadId: ThreadId) {
    const runId = (yield* orchestrator.getThreadShell(threadId))?.latestRunId ?? null;
    if (runId === null) return null;
    const { runs, turnItems } = yield* orchestrator.getThreadRecords(
      threadId,
      ["runs", "turnItems"],
      { runIds: [runId], turnItemRunIds: [runId] },
    );
    return { runId, run: runs.find((run) => run.id === runId), turnItems };
  });

  const threadTargetOf = Effect.fn("RoomBoardAgent.threadTargetOf")(function* (threadId: ThreadId) {
    const thread = yield* threadOf(threadId, "not_on_board");
    if (thread.deletedAt !== null || thread.archivedAt !== null) return yield* fail("board_gone");
    const providers = yield* providerRegistry.getProviders;
    const model = RoomBoxes.roomBoxModelName(thread.modelSelection, providers);
    const current = yield* runOf(threadId).pipe(Effect.orElseSucceed(() => null));
    // The guest whose message the owner sent into this run, as RoomBoxes finds it.
    const agent = (boxId: string, room: ThreadRoom): RoomBoardAgentMark => {
      const guestMessageId = current?.turnItems.find((item) => item.type === "user_message")
        ?.context?.guest?.guestMessageId;
      const asked = room.messages.find(
        (message) =>
          message.id === guestMessageId ||
          (current?.run !== undefined && message.sentAs === current.run.userMessageId),
      );
      return {
        boxId,
        ...(model === "" ? {} : { model }),
        ...(current === null ? {} : { turnId: current.runId }),
        ...(asked === undefined ? {} : { askedBy: asked.guestId }),
      };
    };
    if (thread.guestShare != null || thread.roomBoard != null) {
      const room = threadRoomOf(thread);
      return {
        roomThreadId: thread.id,
        roomTitle: thread.title,
        room,
        boxId: ROOM_BOARD_ROOM_BOX,
        author: null,
        me: null,
        people: yield* peopleOf(room),
        agent: agent(ROOM_BOARD_ROOM_BOX, room),
        hasRoomCard: true,
        board: room.board ?? EMPTY_ROOM_BOARD,
      } satisfies Target;
    }
    // Also from the run's first message when the share is new here.
    const boxFrom = (items: Parameters<typeof boxes.boxOfThread>[1]) =>
      boxes.boxOfThread(threadId, items).pipe(Effect.mapError(() => fail("not_on_board")));
    const known = yield* boxFrom([]);
    const box = known ?? (current === null ? null : yield* boxFrom(current.turnItems));
    if (box === null) return yield* fail("not_on_board");
    const roomThread = yield* threadOf(box.roomThreadId, "board_gone");
    if (roomThread.deletedAt !== null || roomThread.archivedAt !== null) {
      return yield* fail("board_gone");
    }
    // The room as it is now, which the box was found on.
    const room = threadRoomOf(roomThread);
    if (room.id !== box.share.id) return yield* fail("board_gone");
    return {
      roomThreadId: roomThread.id,
      roomTitle: roomThread.title,
      room,
      boxId: box.boxId,
      author: null,
      me: null,
      people: yield* peopleOf(room),
      agent: agent(box.boxId, room),
      hasRoomCard: true,
      board: room.board ?? EMPTY_ROOM_BOARD,
    } satisfies Target;
  });

  /** A guest's own box here, checked to be theirs on the board the room has now. */
  const guestTargetOf = Effect.fn("RoomBoardAgent.guestTargetOf")(function* (box: RoomGuestBox) {
    const thread = yield* threadOf(box.roomThreadId, "board_gone");
    if (thread.deletedAt !== null || thread.archivedAt !== null) return yield* fail("board_gone");
    const room = threadRoomOf(thread);
    if (room.id !== box.shareId) return yield* fail("board_gone");
    if (roomBoxOn(room, box.boxId)?.guestId !== box.guestId) return yield* fail("not_on_board");
    const model = sanitizeLinkedPrompt(box.model ?? "")
      .text.replace(/\s+/g, " ")
      .trim();
    return {
      roomThreadId: thread.id,
      roomTitle: thread.title,
      room,
      boxId: box.boxId,
      author: box.guestId,
      me: box.guestId,
      people: yield* peopleOf(room),
      agent: {
        boxId: box.boxId,
        ...(model === "" ? {} : { model }),
        ...(box.turnId === undefined ? {} : { turnId: box.turnId }),
        askedBy: box.guestId,
      },
      hasRoomCard: true,
      board: room.board ?? EMPTY_ROOM_BOARD,
    } satisfies Target;
  });

  const targetOf = (by: Caller) =>
    typeof by === "string" ? threadTargetOf(by) : guestTargetOf(by);

  const fromLink = (error: SharedThreadJoinError) =>
    fail(
      error.reason === "room_ended" || error.reason === "not_in_room"
        ? "board_gone"
        : error.reason === "thread_unavailable"
          ? "not_on_board"
          : error.reason === "too_fast"
            ? "too_fast"
            : error.reason === "invalid_response"
              ? "host_outdated"
              : "unreachable",
    );

  /**
   * The run and model of a thread here whose own box is on a room another server shares, or null
   * when the thread's board, if any, is this server's.
   */
  const elsewhere = Effect.fn("RoomBoardAgent.elsewhere")(function* (by: Caller) {
    if (typeof by !== "string") return null;
    const thread = yield* threadOf(by, "not_on_board");
    if (
      thread.roomLink?.boxId === undefined ||
      thread.guestShare != null ||
      thread.roomBoard != null
    ) {
      return null;
    }
    if (thread.deletedAt !== null || thread.archivedAt !== null) return yield* fail("board_gone");
    const model = RoomBoxes.roomBoxModelName(
      thread.modelSelection,
      yield* providerRegistry.getProviders,
    );
    const runId = yield* orchestrator.getThreadShell(by).pipe(
      Effect.map((shell) => shell?.latestRunId ?? null),
      Effect.orElseSucceed(() => null),
    );
    return {
      threadId: by,
      request: {
        ...(runId === null ? {} : { turnId: runId }),
        ...(model === "" ? {} : { model }),
      },
    };
  });

  const changeElsewhere = (threadId: ThreadId, change: SharedRoomLink.BoardEdit) =>
    Effect.flatMap(elsewhere(threadId), (away) =>
      away === null
        ? Effect.succeed(null)
        : links
            .changeBoard(away.threadId, { ...away.request, change })
            .pipe(Effect.mapError(fromLink)),
    );

  /**
   * One change, checked against the board as this call left it so a refusal says why, then made
   * as the owner's, marked as this agent's. Returns why the board did not take it, if it did not.
   */
  const apply = Effect.fn("RoomBoardAgent.apply")(function* (
    target: Target,
    change: RoomBoardChange,
  ) {
    const at = DateTime.formatIso(yield* DateTime.now);
    const checked = applyRoomBoardChange(
      target.board,
      roomScope(target.room),
      target.author,
      change,
      at,
    );
    if (Result.isFailure(checked)) return checked.failure;
    const commandId = CommandId.make(`server:room-board-agent:${yield* uuid}`);
    const refused = yield* orchestrator
      .dispatch({
        type: "thread.guest-board.change",
        commandId,
        threadId: target.roomThreadId,
        shareId: target.room.id,
        author: target.author,
        change,
        agent: target.agent,
      })
      .pipe(
        Effect.as(undefined),
        Effect.catch((error) =>
          Effect.succeed(
            "cause" in error && typeof error.cause === "string"
              ? error.cause
              : "The board did not take this change.",
          ),
        ),
      );
    if (refused === undefined) target.board = checked.success;
    return refused;
  });

  const opsOf = (target: Target): RoomBoardAgentOps<never, never> => ({
    apply: (change) => apply(target, change),
    uuid,
  });

  const read = Effect.fn("RoomBoardAgent.read")(function* (caller: Caller) {
    const away = yield* elsewhere(caller);
    if (away !== null) return yield* links.readBoard(away.threadId).pipe(Effect.mapError(fromLink));
    const target = yield* targetOf(caller);
    return roomBoardAgentView(target, roomPersonName(target.room, yield* ownerName));
  });

  const add = Effect.fn("RoomBoardAgent.add")(function* (
    by: Caller,
    input: RoomBoardAgentAddInput,
  ) {
    const away = typeof by === "string" ? yield* changeElsewhere(by, { add: input }) : null;
    if (away !== null) return away;
    const target = yield* targetOf(by);
    return yield* roomBoardAgentAdd(target, opsOf(target), input);
  });

  const update = Effect.fn("RoomBoardAgent.update")(function* (
    by: Caller,
    input: RoomBoardAgentUpdateInput,
  ) {
    const away = typeof by === "string" ? yield* changeElsewhere(by, { update: input }) : null;
    if (away !== null) return away;
    const target = yield* targetOf(by);
    return yield* roomBoardAgentUpdate(target, opsOf(target), input);
  });

  const arrange = Effect.fn("RoomBoardAgent.arrange")(function* (
    by: Caller,
    input: RoomBoardAgentArrangeInput,
  ) {
    const away = yield* elsewhere(by);
    if (away !== null) {
      return yield* links
        .arrangeBoard(away.threadId, { ...away.request, change: { arrange: input } })
        .pipe(Effect.mapError(fromLink));
    }
    const target = yield* targetOf(by);
    return yield* roomBoardAgentArrange(target, opsOf(target), input);
  });

  return RoomBoardAgent.of({ read, add, update, arrange });
});

export const layer = Layer.effect(RoomBoardAgent, make);
