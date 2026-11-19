// @effect-diagnostics globalDate:off - Plain Cloudflare handlers, outside the Effect runtime.
import {
  GUEST_HANDOFF_TTL_MS,
  type GuestAgentActivityRequest,
  type GuestId,
  type GuestTurnRequest,
  type RoomAgentActivity,
  type RoomAgentsEvent,
  type RoomArtifactRead,
  type RoomBoardAgentArrangeResult,
  type RoomBoardAgentChangeRequest,
  type RoomBoardAgentResult,
  type RoomBoardAgentView,
  type RoomBoxProgress,
  type RoomUpdates,
  type SharedThreadExport,
} from "@t3tools/contracts";
import {
  guestActivityFromRequest,
  guestTurnFromRequest,
  roomAfterGuestTurn,
  roomBoardAfterChange,
  roomBoxOn,
} from "@t3tools/shared/guestRoom";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import { EMPTY_ROOM_BOARD, roomArtifactSource } from "@t3tools/shared/roomBoard";
import {
  roomBoardAgentAdd,
  roomBoardAgentArrange,
  roomBoardAgentUpdate,
  roomBoardAgentView,
  type RoomBoardAgentTarget,
} from "@t3tools/shared/roomBoardAgent";
import { roomUpdatesOf } from "@t3tools/shared/roomUpdates";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";

import {
  DEFAULT_BOARD_TITLE,
  FAR_EXPIRY,
  roomFailure,
  roomScope,
  type CloudGuest,
  type CloudRoom,
  type RoomFailure,
} from "./room.ts";

/**
 * A person's own Tinkjam joined to a cloud board, exactly as it joins a room an owner's machine
 * serves: a short-lived handoff token opens the export once or twice, and the export hands out a
 * room token that opens the room routes for that person only. Only hashes are kept.
 */
export interface CloudMachineToken {
  readonly guestId: GuestId;
  readonly hash: string;
  readonly kind: "handoff" | "room";
  /** Epoch milliseconds. Room tokens last as long as the board. */
  readonly expiresAt?: number;
}

// A preview and a join each read the export, and each read hands out a room token; a person
// joins from a few machines at most.
const TOKENS_PER_GUEST = 8;

const pruned = (tokens: ReadonlyArray<CloudMachineToken>, now: number) =>
  tokens.filter((token) => token.expiresAt === undefined || token.expiresAt > now);

/** Keeps the newest few of one kind per person. */
function withToken(
  tokens: ReadonlyArray<CloudMachineToken>,
  token: CloudMachineToken,
): ReadonlyArray<CloudMachineToken> {
  const same = (other: CloudMachineToken) =>
    other.guestId === token.guestId && other.kind === token.kind;
  const kept = tokens.filter(same).slice(-(TOKENS_PER_GUEST - 1));
  return [...tokens.filter((other) => !same(other)), ...kept, token];
}

/** The room with a handoff token for a person's page, which opens the export for ten minutes. */
export function withHandoff(
  room: CloudRoom,
  guestId: GuestId,
  hash: string,
  now: number,
): CloudRoom {
  return {
    ...room,
    machines: withToken(pruned(room.machines ?? [], now), {
      guestId,
      hash,
      kind: "handoff",
      expiresAt: now + GUEST_HANDOFF_TTL_MS,
    }),
  };
}

/** The person a token of this kind is for, while it opens anything. */
export function machineGuestOf(
  room: CloudRoom | null,
  hash: string,
  kind: CloudMachineToken["kind"],
  now: number,
): CloudGuest | undefined {
  const token = pruned(room?.machines ?? [], now).find(
    (candidate) => candidate.hash === hash && candidate.kind === kind,
  );
  return token === undefined ? undefined : room?.guests.find((guest) => guest.id === token.guestId);
}

/**
 * The board as a joining machine imports it: no conversation (a cloud board has no thread), and
 * a room token for its turns plus a session for the same person, so the app they joined from on
 * that machine shows the board too.
 */
export function exportFor(
  room: CloudRoom,
  input: {
    readonly handoffHash: string;
    readonly roomToken: string;
    readonly roomHash: string;
    readonly session: string;
    readonly sessionHash: string;
    readonly now: number;
  },
): Result.Result<{ readonly room: CloudRoom; readonly export: SharedThreadExport }, RoomFailure> {
  const guest = machineGuestOf(room, input.handoffHash, "handoff", input.now);
  if (guest === undefined) return Result.fail(roomFailure("invalid"));
  const machines = withToken(pruned(room.machines ?? [], input.now), {
    guestId: guest.id,
    hash: input.roomHash,
    kind: "room",
  });
  const guests = room.guests.map((candidate) =>
    candidate === guest
      ? {
          ...candidate,
          machineSessions: [
            ...(candidate.machineSessions ?? []).slice(-(TOKENS_PER_GUEST - 1)),
            input.sessionHash,
          ],
        }
      : candidate,
  );
  return Result.succeed({
    room: { ...room, guests, machines },
    export: {
      title: room.title.trim() === "" ? DEFAULT_BOARD_TITLE : room.title,
      messages: [],
      truncated: false,
      checkout: null,
      room: {
        token: input.roomToken,
        expiresAt: FAR_EXPIRY,
        shareId: room.shareId,
        session: input.session,
        threadId: room.threadId,
      },
      board: true,
    },
  });
}

/** A turn a person's machine ran, shown on their own box or among the board's turns. */
export function postTurn(
  room: CloudRoom,
  guestId: GuestId,
  request: GuestTurnRequest,
  now: string,
): Result.Result<CloudRoom, RoomFailure> {
  const turn = guestTurnFromRequest(room, guestId, request);
  if (turn === null) return Result.fail(roomFailure("empty"));
  const next = roomAfterGuestTurn(room, guestId, turn, now);
  return Result.succeed(next === room ? room : { ...next, updatedAt: now });
}

/** What the board said since `after` that this person's machine has not seen: others' turns. */
export const updatesFor = (room: CloudRoom, guestId: GuestId, after: string | null): RoomUpdates =>
  roomUpdatesOf({
    items: [],
    runs: [],
    hasMoreHistory: false,
    share: { guests: room.guests, guestName: null, ...(room.turns ? { turns: room.turns } : {}) },
    guestId,
    after,
  });

export function artifactFor(
  room: CloudRoom,
  noteId: string,
): Result.Result<RoomArtifactRead, RoomFailure> {
  const note = roomArtifactSource(room.board, noteId);
  if (note === undefined) return Result.fail(roomFailure("artifact_gone"));
  return Result.succeed({
    title: note.text,
    ...(note.artifact === undefined ? {} : { body: note.artifact.body }),
  });
}

/** The person's own box, as its agent works on the board; another's box is not found. */
function agentTarget(
  room: CloudRoom,
  guestId: GuestId,
  boxId: string,
): Result.Result<RoomBoardAgentTarget, RoomFailure> {
  if (roomBoxOn(room, boxId)?.guestId !== guestId) return Result.fail(roomFailure("not_on_board"));
  return Result.succeed({
    roomTitle: room.title,
    boxId,
    hasRoomCard: false,
    // A cloud board has no owner: everyone on it is a person who joined.
    people: room.guests.map((guest) => ({ guestId: guest.id, name: guest.name })),
    me: guestId,
    board: room.board ?? EMPTY_ROOM_BOARD,
  });
}

const nameOf = (room: CloudRoom) => (guestId: GuestId | undefined) =>
  guestId === undefined ? undefined : room.guests.find((guest) => guest.id === guestId)?.name;

export const boardFor = (
  room: CloudRoom,
  guestId: GuestId,
  boxId: string,
): Result.Result<RoomBoardAgentView, RoomFailure> =>
  Result.map(agentTarget(room, guestId, boxId), (target) =>
    roomBoardAgentView(target, nameOf(room)),
  );

/**
 * One board tool call of the agent of a person's own box: its cards are that person's, marked as
 * the box's agent's, by the same rules as on a room an owner's machine serves.
 */
export function changeBoardAsAgent(
  room: CloudRoom,
  guestId: GuestId,
  request: RoomBoardAgentChangeRequest,
  now: string,
  uuid: () => string,
): Result.Result<
  {
    readonly room: CloudRoom;
    readonly result: RoomBoardAgentResult | RoomBoardAgentArrangeResult;
  },
  RoomFailure
> {
  const target = agentTarget(room, guestId, request.boxId);
  if (Result.isFailure(target)) return Result.fail(target.failure);
  const model = sanitizeLinkedPrompt(request.model ?? "")
    .text.replace(/\s+/g, " ")
    .trim();
  const agent = {
    boxId: request.boxId,
    ...(model === "" ? {} : { model }),
    ...(request.turnId === undefined ? {} : { turnId: request.turnId }),
    askedBy: guestId,
  };
  let current = room;
  const ops = {
    apply: (change: Parameters<typeof roomBoardAfterChange>[3]) =>
      Effect.sync(() => {
        const applied = roomBoardAfterChange(
          current,
          roomScope(current),
          guestId,
          change,
          agent,
          now,
        );
        if (Result.isFailure(applied)) return applied.failure;
        current = { ...current, board: applied.success, updatedAt: now };
        target.success.board = applied.success;
        return undefined;
      }),
    uuid: Effect.sync(uuid),
  };
  const result = Effect.runSync<RoomBoardAgentResult | RoomBoardAgentArrangeResult, never>(
    "arrange" in request.change
      ? roomBoardAgentArrange(target.success, ops, request.change.arrange)
      : "add" in request.change
        ? roomBoardAgentAdd(target.success, ops, request.change.add)
        : roomBoardAgentUpdate(target.success, ops, request.change.update),
  );
  return Result.succeed({ room: current, result });
}

/** Which people's agents are running, and what each box's agent is doing. Live only. */
export interface AgentsLive {
  readonly agents: ReadonlyMap<
    GuestId,
    { readonly id: string; readonly activity: RoomAgentActivity; readonly until: number }
  >;
  readonly boxes: ReadonlyMap<
    string,
    { readonly progress: RoomBoxProgress; readonly until: number }
  >;
}
export const EMPTY_AGENTS: AgentsLive = { agents: new Map(), boxes: new Map() };

// As on a machine's room: a run not heard of for this long ended with its machine.
const ACTIVITY_TTL_MS = 10 * 60_000;
const boxRunKey = (guestId: GuestId, runId: string) => `${guestId}\n${runId}`;

const withoutRun = (live: AgentsLive, guestId: GuestId, runId: string): AgentsLive => {
  const key = boxRunKey(guestId, runId);
  if (live.boxes.has(key)) {
    const boxes = new Map(live.boxes);
    boxes.delete(key);
    return { ...live, boxes };
  }
  if (live.agents.get(guestId)?.id !== runId) return live;
  const agents = new Map(live.agents);
  agents.delete(guestId);
  return { ...live, agents };
};

/** The live room once a machine said its agent started, still runs, or stopped. */
export function withActivity(
  live: AgentsLive,
  room: CloudRoom,
  guestId: GuestId,
  request: GuestAgentActivityRequest,
  now: number,
): AgentsLive {
  const activity = guestActivityFromRequest(room, guestId, request);
  if (activity.type === "idle") return withoutRun(live, guestId, request.id);
  if (activity.type === "box") {
    const key = boxRunKey(guestId, request.id);
    const startedAt = live.boxes.get(key)?.progress.startedAt ?? new Date(now).toISOString();
    return {
      ...live,
      boxes: new Map(live.boxes).set(key, {
        progress: { ...activity.progress, startedAt },
        until: now + ACTIVITY_TTL_MS,
      }),
    };
  }
  return {
    ...live,
    agents: new Map(live.agents).set(guestId, {
      id: request.id,
      activity: activity.activity,
      until: now + ACTIVITY_TTL_MS,
    }),
  };
}

/** The live room once someone is off the board: their agent's runs go. */
export const agentsWithoutPerson = (live: AgentsLive, guestId: GuestId): AgentsLive => ({
  agents: new Map([...live.agents].filter(([id]) => id !== guestId)),
  boxes: new Map([...live.boxes].filter(([, box]) => box.progress.guestId !== guestId)),
});

/** A posted turn ends the run it was. */
export const withTurnPosted = (live: AgentsLive, guestId: GuestId, runId: string) =>
  withoutRun(live, guestId, runId);

export function agentsEvent(live: AgentsLive, now: number): RoomAgentsEvent {
  return {
    type: "agents",
    running: [...live.agents.values()]
      .filter((agent) => agent.until > now)
      .map((agent) => agent.activity)
      .toSorted((left, right) => left.guestId.localeCompare(right.guestId)),
    boxes: [...live.boxes.values()]
      .filter((box) => box.until > now)
      .map((box) => box.progress)
      .toSorted(
        (left, right) =>
          left.startedAt.localeCompare(right.startedAt) || left.boxId.localeCompare(right.boxId),
      ),
  };
}

/** Whether `key` may make another request now, counting it when it may. */
export function allowRequest(
  recent: Map<string, ReadonlyArray<number>>,
  key: string,
  limit: number,
  now: number,
  windowMs = 60_000,
): boolean {
  const kept = (recent.get(key) ?? []).filter((at) => at > now - windowMs);
  if (kept.length >= limit) return false;
  recent.set(key, [...kept, now]);
  return true;
}
