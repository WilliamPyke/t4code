// @effect-diagnostics globalDate:off globalTimers:off cryptoRandomUUID:off - The Worker and its objects are plain Cloudflare handlers, outside the Effect runtime.
import {
  CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
  CLOUD_BOARD_ROUTE,
  CLOUD_BOARD_TITLE_ROUTE,
  CloudBoardCreateRequest,
  CloudBoardRemovePersonRequest,
  CloudBoardTitleRequest,
  GUEST_BOARD_CURSOR_ROUTE,
  GUEST_BOARD_ROUTE,
  GUEST_EXPORT_ROUTE,
  GUEST_HANDOFF_ROUTE,
  GUEST_ROOM_ACTIVITY_ROUTE,
  GUEST_ROOM_ARTIFACT_ROUTE,
  GUEST_ROOM_BOARD_ROUTE,
  GUEST_ROOM_EXPIRES_HEADER,
  GUEST_ROOM_TURN_ROUTE,
  GUEST_ROOM_UPDATES_ROUTE,
  GUEST_ROUTE_PREFIX,
  GUEST_SHARE_PARAM,
  GuestAgentActivityRequest,
  GuestCursorRequest,
  GuestId,
  GuestRedeemRequest,
  GuestShareId,
  GuestTurnRequest,
  RoomBoardAgentChangeRequest,
  RoomBoardChange,
  ThreadId,
  type CloudBoardCreateResult,
  type GuestRedeemResult,
} from "@t3tools/contracts";
import { DurableObject } from "cloudflare:workers";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import {
  EMPTY_AGENTS,
  agentsEvent,
  agentsWithoutPerson,
  allowRequest,
  artifactFor,
  boardFor,
  changeBoardAsAgent,
  exportFor,
  machineGuestOf,
  postTurn,
  updatesFor,
  withActivity,
  withHandoff,
  withTurnPosted,
  type AgentsLive,
} from "./machines.ts";
import {
  EMPTY_LIVE,
  FAR_EXPIRY,
  ROOM_MAX_CHUNKS,
  boardAlarmAt,
  changeBoard,
  checkDelete,
  checkInvite,
  createRoom,
  cursorsEventFor,
  guestBySession,
  joinRoom,
  moveCursor,
  onlineOf,
  openingEvents,
  removePerson,
  renameRoom,
  roomChunks,
  roomFailure,
  roomOfChunks,
  sseFrame,
  viewFor,
  withoutPerson,
  type CloudGuest,
  type CloudRoom,
  type CloudStreamEvent,
  type RoomFailure,
  type RoomLive,
} from "./room.ts";
import { hashSecret, isShareId, makeSecret, shareOfSecret } from "./secrets.ts";

interface Env {
  readonly BOARDS: DurableObjectNamespace<BoardRoom>;
  readonly CREATE_LIMITS: DurableObjectNamespace<CreateLimit>;
  /** Pages that may call this host from a browser, separated by commas. */
  readonly ALLOWED_ORIGINS: string;
}

const INVITE_ROUTE = `${GUEST_ROUTE_PREFIX}/invite`;
const REDEEM_ROUTE = `${GUEST_ROUTE_PREFIX}/redeem`;
const SESSION_ROUTE = `${GUEST_ROUTE_PREFIX}/session`;
const STREAM_ROUTE = `${GUEST_ROUTE_PREFIX}/stream`;

const NO_STORE = { "cache-control": "no-store" };
// As on a machine's guest routes: a name, a title or one board change, and a pointer is a few bytes.
const JSON_MAX_BODY_BYTES = 64 * 1024;
const CURSOR_MAX_BODY_BYTES = 256;
// Cloudflare closes idle streams after about 100 seconds.
const HEARTBEAT_MS = 20_000;
const BOARD_CREATE_LIMIT = 30;
const HOUR_MS = 60 * 60_000;

const failureResponse = (failure: RoomFailure) =>
  Response.json(
    { reason: failure.reason, message: failure.message },
    { status: failure.status, headers: NO_STORE },
  );
const noContent = () => new Response(null, { status: 204, headers: NO_STORE });

const decodeCreate = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardCreateRequest));
const decodeTitle = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardTitleRequest));
const decodeRemove = Schema.decodeUnknownOption(
  Schema.fromJsonString(CloudBoardRemovePersonRequest),
);
const decodeInvite = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ credential: Schema.String })),
);
const decodeRedeem = Schema.decodeUnknownOption(Schema.fromJsonString(GuestRedeemRequest));
const decodeChange = Schema.decodeUnknownOption(Schema.fromJsonString(RoomBoardChange));
const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(GuestCursorRequest));
const decodeTurn = Schema.decodeUnknownOption(Schema.fromJsonString(GuestTurnRequest));
const decodeActivity = Schema.decodeUnknownOption(Schema.fromJsonString(GuestAgentActivityRequest));
const decodeAgentChange = Schema.decodeUnknownOption(
  Schema.fromJsonString(RoomBoardAgentChangeRequest),
);

const bearerOf = (request: Request) =>
  /^Bearer (.+)$/.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";

/** The body as text, or a failure once it is over `maxBytes`, declared or not. */
async function readBody(request: Request, maxBytes: number): Promise<string | RoomFailure> {
  if (Number(request.headers.get("content-length") ?? "0") > maxBytes) {
    return roomFailure("too_large");
  }
  if (request.body === null) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return roomFailure("too_large");
    }
    text += decoder.decode(value, { stream: true });
  }
}

const boardOf = (env: Env, shareId: string) => env.BOARDS.get(env.BOARDS.idFromName(shareId));

/** Sends the request on to the board's object, with the body already read under its cap. */
async function forward(env: Env, shareId: string, request: Request, url: URL, maxBytes: number) {
  if (request.method === "GET" || request.method === "DELETE") {
    return boardOf(env, shareId).fetch(request);
  }
  const body = await readBody(request, maxBytes);
  if (typeof body !== "string") return failureResponse(body);
  return boardOf(env, shareId).fetch(url.toString(), {
    method: "POST",
    headers: { authorization: request.headers.get("authorization") ?? "" },
    body,
  });
}

const SESSION_ROUTES: Readonly<Record<string, { method: string; maxBytes: number }>> = {
  [CLOUD_BOARD_ROUTE]: { method: "DELETE", maxBytes: 0 },
  [CLOUD_BOARD_PEOPLE_REMOVE_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [CLOUD_BOARD_TITLE_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [SESSION_ROUTE]: { method: "GET", maxBytes: 0 },
  [STREAM_ROUTE]: { method: "GET", maxBytes: 0 },
  [GUEST_BOARD_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [GUEST_BOARD_CURSOR_ROUTE]: { method: "POST", maxBytes: CURSOR_MAX_BODY_BYTES },
  [GUEST_HANDOFF_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
};

// Called by a person's own Tinkjam with a bearer handoff or room token, which names the board.
// The same caps as a machine's guest routes.
const MACHINE_ROUTES: Readonly<Record<string, number>> = {
  [`GET ${GUEST_EXPORT_ROUTE}`]: 0,
  [`POST ${GUEST_ROOM_TURN_ROUTE}`]: 256 * 1024,
  [`POST ${GUEST_ROOM_ACTIVITY_ROUTE}`]: JSON_MAX_BODY_BYTES,
  [`GET ${GUEST_ROOM_UPDATES_ROUTE}`]: 0,
  [`GET ${GUEST_ROOM_ARTIFACT_ROUTE}`]: 0,
  [`GET ${GUEST_ROOM_BOARD_ROUTE}`]: 0,
  [`POST ${GUEST_ROOM_BOARD_ROUTE}`]: 192 * 1024,
};

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === CLOUD_BOARD_ROUTE && request.method === "POST") {
    const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
    const limit = env.CREATE_LIMITS.get(env.CREATE_LIMITS.idFromName(ip));
    if (!(await limit.take(Date.now()))) return failureResponse(roomFailure("too_fast"));
    const shareId = crypto.randomUUID();
    const target = new URL(CLOUD_BOARD_ROUTE, url);
    target.searchParams.set(GUEST_SHARE_PARAM, shareId);
    return forward(env, shareId, request, target, JSON_MAX_BODY_BYTES);
  }
  if ((path === INVITE_ROUTE || path === REDEEM_ROUTE) && request.method === "POST") {
    const body = await readBody(request, JSON_MAX_BODY_BYTES);
    if (typeof body !== "string") return failureResponse(body);
    const credential = decodeInvite(body);
    if (Option.isNone(credential)) return failureResponse(roomFailure("bad_request"));
    const shareId = shareOfSecret(credential.value.credential);
    if (shareId === null) return failureResponse(roomFailure("invalid"));
    return boardOf(env, shareId).fetch(url.toString(), { method: "POST", body });
  }
  const machineRoute = MACHINE_ROUTES[`${request.method} ${path}`];
  if (machineRoute !== undefined) {
    const shareId = shareOfSecret(bearerOf(request));
    if (shareId === null) return failureResponse(roomFailure("invalid"));
    return forward(env, shareId, request, url, machineRoute);
  }
  const sessionRoute = SESSION_ROUTES[path];
  if (sessionRoute !== undefined && sessionRoute.method === request.method) {
    // A token signed for another board is refused, so `?share=` always names the board acted on.
    const shareId = url.searchParams.get(GUEST_SHARE_PARAM);
    if (!isShareId(shareId) || shareOfSecret(bearerOf(request)) !== shareId) {
      return failureResponse(roomFailure("invalid"));
    }
    return forward(env, shareId, request, url, sessionRoute.maxBytes);
  }
  return failureResponse(roomFailure("unavailable"));
}

const allowedOrigin = (request: Request, env: Env) => {
  const origin = request.headers.get("origin");
  if (origin === null) return null;
  return env.ALLOWED_ORIGINS.split(",").some((allowed) => allowed.trim() === origin)
    ? origin
    : null;
};

/** Pages on the allowed origins call with a bearer token and no cookies. */
function withCors(response: Response, origin: string | null): Response {
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.append("vary", "Origin");
  return new Response(response.body, { status: response.status, headers });
}

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === "OPTIONS") {
      return withCors(
        new Response(null, {
          status: 204,
          headers:
            origin === null
              ? {}
              : {
                  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
                  "access-control-allow-headers": "authorization, content-type",
                  "access-control-max-age": "600",
                },
        }),
        origin,
      );
    }
    return withCors(await route(request, env), origin);
  },
} satisfies ExportedHandler<Env>;

interface OpenStream {
  readonly guestId: GuestId;
  readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  /** Whether the reader took the last ping. One that did not by the next is gone. */
  pingTaken: boolean;
}

// The room as it was kept before it was kept in pieces.
const ROOM_KEY = "room";
const CHUNK_COUNT_KEY = "room:chunks";
const chunkKey = (index: number) => `room:${index}`;
// Per person, per minute, as a machine's room allows.
const TURN_RATE_LIMIT = 6;
const UPDATES_RATE_LIMIT = 20;
const BOARD_AGENT_RATE_LIMIT = 30;
const ACTIVITY_RATE_LIMIT = 90;
const BOARD_CHANGE_RATE_LIMIT = 120;
const roomPosted = () =>
  new Response(null, {
    status: 204,
    headers: { ...NO_STORE, [GUEST_ROOM_EXPIRES_HEADER]: FAR_EXPIRY },
  });
const encoder = new TextEncoder();
const nowIso = () => new Date().toISOString();

/** One board. Everything it decides is in `room.ts`; this keeps it, and its open streams. */
export class BoardRoom extends DurableObject<Env> {
  private room: CloudRoom | null = null;
  private live: RoomLive = EMPTY_LIVE;
  private agents: AgentsLive = EMPTY_AGENTS;
  private agentsShown = "";
  private readonly recent = new Map<string, ReadonlyArray<number>>();
  private readonly streams = new Set<OpenStream>();
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  /** When the board is set to be deleted, epoch ms. */
  private alarmAt: number | null = null;
  /** Deleted while this object lived: nothing may keep it again. */
  private deleted = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.alarmAt = await ctx.storage.getAlarm();
      const count = await ctx.storage.get<number>(CHUNK_COUNT_KEY);
      if (count === undefined) {
        this.room = (await ctx.storage.get<CloudRoom>(ROOM_KEY)) ?? null;
        return;
      }
      const keys = Array.from({ length: count }, (_, index) => chunkKey(index));
      const chunks = await ctx.storage.get<string>(keys);
      this.room = roomOfChunks(keys.map((key) => chunks.get(key) ?? ""));
    });
  }

  override async fetch(request: Request): Promise<Response> {
    const response = await this.handle(request);
    await this.keepAlarm();
    return response;
  }

  /** Moves the board's deletion on now it was used, at most once a day. */
  private async keepAlarm() {
    if (this.room === null) return;
    const at = boardAlarmAt(this.room, Date.now(), this.alarmAt);
    if (at === null) return;
    this.alarmAt = at;
    await this.ctx.storage.setAlarm(at);
  }

  override async alarm(): Promise<void> {
    this.alarmAt = null;
    await this.end();
  }

  /** Deletes the board: everyone with it open is told it ended, and nothing of it is kept. */
  private async end(): Promise<void> {
    this.deleted = true;
    this.room = null;
    for (const stream of this.streams) this.drop(stream, true);
    this.live = EMPTY_LIVE;
    this.agents = EMPTY_AGENTS;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  private async handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === CLOUD_BOARD_ROUTE && request.method === "POST") {
      return this.create(url.searchParams.get(GUEST_SHARE_PARAM) ?? "", await request.text());
    }
    switch (url.pathname) {
      case INVITE_ROUTE: {
        const body = decodeInvite(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const refused = checkInvite(this.room, await hashSecret(body.value.credential));
        return refused === null ? noContent() : failureResponse(refused);
      }
      case REDEEM_ROUTE:
        return this.redeem(await request.text());
    }
    if (MACHINE_ROUTES[`${request.method} ${url.pathname}`] !== undefined) {
      return this.machine(request, url);
    }
    const guest = guestBySession(this.room, await hashSecret(bearerOf(request)));
    const room = this.room;
    // The board was deleted, or this person was taken off it.
    if (guest === undefined || room === null) return failureResponse(roomFailure("ended"));
    switch (url.pathname) {
      case CLOUD_BOARD_ROUTE: {
        const refused = checkDelete(room, guest.id);
        if (refused !== null) return failureResponse(refused);
        await this.end();
        return noContent();
      }
      case CLOUD_BOARD_PEOPLE_REMOVE_ROUTE: {
        const body = decodeRemove(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const current = this.room ?? room;
        const next = removePerson(current, guest.id, body.value.guestId, nowIso());
        if (Result.isFailure(next)) return failureResponse(next.failure);
        if (next.success === current) return noContent();
        const removed = body.value.guestId;
        for (const stream of this.streams) {
          if (stream.guestId === removed) this.drop(stream, true);
        }
        this.setAgents(agentsWithoutPerson(this.agents, removed), Date.now());
        await this.save(next.success);
        return noContent();
      }
      case SESSION_ROUTE:
        return noContent();
      case STREAM_ROUTE:
        return this.openStream(room, guest, request.signal);
      case CLOUD_BOARD_TITLE_ROUTE: {
        const body = decodeTitle(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        await this.save(renameRoom(this.room ?? room, body.value.title, nowIso()));
        return noContent();
      }
      case GUEST_HANDOFF_ROUTE: {
        const token = makeSecret(room.shareId);
        const hash = await hashSecret(token);
        await this.save(withHandoff(this.room ?? room, guest.id, hash, Date.now()));
        return Response.json({ token }, { headers: NO_STORE });
      }
      case GUEST_BOARD_ROUTE: {
        const change = decodeChange(await request.text());
        if (Option.isNone(change)) return failureResponse(roomFailure("bad_request"));
        if (!allowRequest(this.recent, `board:${guest.id}`, BOARD_CHANGE_RATE_LIMIT, Date.now())) {
          return failureResponse(roomFailure("too_fast"));
        }
        const next = changeBoard(this.room ?? room, guest.id, change.value, nowIso());
        if (Result.isFailure(next)) return failureResponse(next.failure);
        await this.save(next.success);
        return noContent();
      }
      case GUEST_BOARD_CURSOR_ROUTE: {
        const body = decodeCursor(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        // As on a machine: only someone with the board open has a pointer on it.
        if (!this.isOnline(guest.id)) return failureResponse(roomFailure("inactive"));
        const now = Date.now();
        const next = moveCursor(this.live, guest.id, body.value, now);
        if (Result.isFailure(next)) return failureResponse(next.failure);
        this.live = next.success;
        for (const stream of this.streams) {
          if (stream.guestId !== guest.id) {
            this.send(stream, sseFrame(cursorsEventFor(this.live, stream.guestId, now)));
          }
        }
        return noContent();
      }
    }
    return failureResponse(roomFailure("unavailable"));
  }

  private async create(shareId: string, text: string): Promise<Response> {
    const body = decodeCreate(text);
    if (Option.isNone(body) || !isShareId(shareId)) {
      return failureResponse(roomFailure("bad_request"));
    }
    const credential = makeSecret(shareId);
    const token = makeSecret(shareId);
    const [inviteHash, sessionHash] = await Promise.all([
      hashSecret(credential),
      hashSecret(token),
    ]);
    if (this.room !== null) return failureResponse(roomFailure("exists"));
    const room = createRoom({
      shareId: GuestShareId.make(shareId),
      threadId: ThreadId.make(`board-${shareId}`),
      title: body.value.title,
      inviteHash,
      maker: { id: GuestId.make(crypto.randomUUID()), name: body.value.name, sessionHash },
      now: nowIso(),
    });
    await this.save(room);
    const result: CloudBoardCreateResult = {
      token,
      shareId: room.shareId,
      threadId: room.threadId,
      credential,
    };
    return Response.json(result, { headers: NO_STORE });
  }

  private async redeem(text: string): Promise<Response> {
    const body = decodeRedeem(text);
    if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
    const shareId = this.room?.shareId;
    if (shareId === undefined) return failureResponse(roomFailure("invalid"));
    const token = makeSecret(shareId);
    const [inviteHash, sessionHash] = await Promise.all([
      hashSecret(body.value.credential),
      hashSecret(token),
    ]);
    const joined = joinRoom(this.room, {
      id: GuestId.make(crypto.randomUUID()),
      name: body.value.name,
      sessionHash,
      inviteHash,
      now: nowIso(),
    });
    if (Result.isFailure(joined)) return failureResponse(joined.failure);
    await this.save(joined.success);
    // No cookie: every page that calls this host keeps the token and sends it as a bearer.
    const result: GuestRedeemResult = {
      token,
      shareId: joined.success.shareId,
      threadId: joined.success.threadId,
    };
    return Response.json(result, { headers: NO_STORE });
  }

  /** The routes a person's own Tinkjam calls, with the token the export or a handoff gave it. */
  private async machine(request: Request, url: URL): Promise<Response> {
    const now = Date.now();
    const hash = await hashSecret(bearerOf(request));
    const room = this.room;
    if (room === null) {
      return failureResponse(
        roomFailure(url.pathname === GUEST_EXPORT_ROUTE ? "invalid" : "ended"),
      );
    }
    if (url.pathname === GUEST_EXPORT_ROUTE) {
      const roomToken = makeSecret(room.shareId);
      const session = makeSecret(room.shareId);
      const [roomHash, sessionHash] = await Promise.all([
        hashSecret(roomToken),
        hashSecret(session),
      ]);
      const exported = exportFor(this.room ?? room, {
        handoffHash: hash,
        roomToken,
        roomHash,
        session,
        sessionHash,
        now,
      });
      if (Result.isFailure(exported)) return failureResponse(exported.failure);
      await this.save(exported.success.room);
      return Response.json(exported.success.export, { headers: NO_STORE });
    }
    const guest = machineGuestOf(room, hash, "room", now);
    // As a machine's room answers a removed guest's machine, so it stops posting for good.
    if (guest === undefined) return failureResponse(roomFailure("ended"));
    const allow = (kind: string, limit: number) =>
      allowRequest(this.recent, `${kind}:${guest.id}`, limit, now);
    const tooFast = () => failureResponse(roomFailure("too_fast"));
    const body = request.method === "POST" ? await request.text() : "";
    switch (`${request.method} ${url.pathname}`) {
      case `POST ${GUEST_ROOM_TURN_ROUTE}`: {
        const turn = decodeTurn(body);
        if (Option.isNone(turn)) return failureResponse(roomFailure("bad_request"));
        if (!allow("turn", TURN_RATE_LIMIT)) return tooFast();
        const next = postTurn(this.room ?? room, guest.id, turn.value, nowIso());
        if (Result.isFailure(next)) return failureResponse(next.failure);
        await this.save(next.success);
        this.setAgents(withTurnPosted(this.agents, guest.id, turn.value.id), now);
        return roomPosted();
      }
      case `POST ${GUEST_ROOM_ACTIVITY_ROUTE}`: {
        const activity = decodeActivity(body);
        if (Option.isNone(activity)) return failureResponse(roomFailure("bad_request"));
        if (!allow("activity", ACTIVITY_RATE_LIMIT)) return tooFast();
        this.setAgents(withActivity(this.agents, room, guest.id, activity.value, now), now);
        return roomPosted();
      }
      case `GET ${GUEST_ROOM_UPDATES_ROUTE}`: {
        const after = url.searchParams.get("after");
        if (after !== null && Number.isNaN(Date.parse(after))) {
          return failureResponse(roomFailure("bad_request"));
        }
        if (!allow("read", UPDATES_RATE_LIMIT)) return tooFast();
        const cursor = after === null ? null : new Date(after).toISOString();
        return Response.json(updatesFor(room, guest.id, cursor), { headers: NO_STORE });
      }
      case `GET ${GUEST_ROOM_ARTIFACT_ROUTE}`: {
        const noteId = url.searchParams.get("note");
        if (!noteId) return failureResponse(roomFailure("bad_request"));
        if (!allow("read", UPDATES_RATE_LIMIT)) return tooFast();
        const artifact = artifactFor(room, noteId);
        return Result.isFailure(artifact)
          ? failureResponse(artifact.failure)
          : Response.json(artifact.success, { headers: NO_STORE });
      }
      case `GET ${GUEST_ROOM_BOARD_ROUTE}`: {
        const boxId = url.searchParams.get("box");
        if (!boxId) return failureResponse(roomFailure("bad_request"));
        if (!allow("agent", BOARD_AGENT_RATE_LIMIT)) return tooFast();
        const view = boardFor(room, guest.id, boxId);
        return Result.isFailure(view)
          ? failureResponse(view.failure)
          : Response.json(view.success, { headers: NO_STORE });
      }
      case `POST ${GUEST_ROOM_BOARD_ROUTE}`: {
        const change = decodeAgentChange(body);
        if (Option.isNone(change)) return failureResponse(roomFailure("bad_request"));
        if (!allow("agent", BOARD_AGENT_RATE_LIMIT)) return tooFast();
        const changed = changeBoardAsAgent(
          this.room ?? room,
          guest.id,
          change.value,
          nowIso(),
          () => crypto.randomUUID(),
        );
        if (Result.isFailure(changed)) return failureResponse(changed.failure);
        await this.save(changed.success.room);
        return Response.json(changed.success.result, { headers: NO_STORE });
      }
    }
    return failureResponse(roomFailure("unavailable"));
  }

  /** Keeps what people's agents are doing, and shows everyone when that changed. */
  private setAgents(agents: AgentsLive, now: number) {
    this.agents = agents;
    const event = agentsEvent(agents, now);
    const shown = JSON.stringify(event);
    if (shown === this.agentsShown) return;
    this.agentsShown = shown;
    this.broadcast(event);
  }

  /** Keeps the room, then shows it to everyone with the board open. */
  private async save(room: CloudRoom): Promise<void> {
    // A request that read the board before it was deleted keeps nothing of it.
    if (room === this.room || this.deleted) return;
    const chunks = roomChunks(room);
    // Every limit of a room keeps it far below this; see the worst case in the tests.
    if (chunks.length > ROOM_MAX_CHUNKS) throw new Error("A board grew past what it can keep.");
    const before = (await this.ctx.storage.get<number>(CHUNK_COUNT_KEY)) ?? 0;
    this.room = room;
    await this.ctx.storage.put({
      [CHUNK_COUNT_KEY]: chunks.length,
      ...Object.fromEntries(chunks.map((chunk, index) => [chunkKey(index), chunk])),
    });
    const stale = Array.from({ length: Math.max(0, before - chunks.length) }, (_, index) =>
      chunkKey(chunks.length + index),
    );
    await this.ctx.storage.delete(before === 0 ? [...stale, ROOM_KEY] : stale);
    for (const stream of this.streams) {
      const guest = room.guests.find((candidate) => candidate.id === stream.guestId);
      if (guest !== undefined)
        this.send(stream, sseFrame({ type: "view", view: viewFor(room, guest) }));
    }
  }

  private isOnline(guestId: GuestId) {
    for (const stream of this.streams) if (stream.guestId === guestId) return true;
    return false;
  }

  private online() {
    return onlineOf([...this.streams].map((stream) => stream.guestId));
  }

  private send(stream: OpenStream, frame: string) {
    stream.writer.write(encoder.encode(frame)).catch(() => this.drop(stream));
  }

  private broadcast(event: CloudStreamEvent, except?: OpenStream) {
    const frame = sseFrame(event);
    for (const stream of this.streams) if (stream !== except) this.send(stream, frame);
  }

  private ping() {
    this.setAgents(this.agents, Date.now());
    for (const stream of this.streams) {
      // A page that went does not always cancel its stream; it only stops reading.
      if (!stream.pingTaken) {
        this.drop(stream);
        continue;
      }
      stream.pingTaken = false;
      stream.writer.write(encoder.encode(": ping\n\n")).then(
        () => {
          stream.pingTaken = true;
        },
        () => this.drop(stream),
      );
    }
  }

  private openStream(room: CloudRoom, guest: CloudGuest, signal: AbortSignal): Response {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const stream: OpenStream = { guestId: guest.id, writer: writable.getWriter(), pingTaken: true };
    const wasOnline = this.isOnline(guest.id);
    this.streams.add(stream);
    // Closed or cancelled by the reader, or the request aborted: the guest's page went.
    stream.writer.closed.then(
      () => this.drop(stream),
      () => this.drop(stream),
    );
    signal.addEventListener("abort", () => this.drop(stream));
    const online = this.online();
    for (const event of openingEvents(room, guest, online)) this.send(stream, sseFrame(event));
    const now = Date.now();
    const cursors = cursorsEventFor(this.live, guest.id, now);
    if (cursors.cursors.length > 0 || (cursors.views?.length ?? 0) > 0) {
      this.send(stream, sseFrame(cursors));
    }
    const agents = agentsEvent(this.agents, now);
    if (agents.running.length > 0 || (agents.boxes?.length ?? 0) > 0) {
      this.send(stream, sseFrame(agents));
    }
    if (!wasOnline) this.broadcast({ type: "presence", online }, stream);
    this.heartbeat ??= setInterval(() => this.ping(), HEARTBEAT_MS);
    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-store, no-transform",
        "x-accel-buffering": "no",
      },
    });
  }

  /** Forgets a stream; `ended` tells its page the board ended for them first. */
  private drop(stream: OpenStream, ended = false) {
    if (!this.streams.delete(stream)) return;
    if (ended) {
      stream.writer
        .write(encoder.encode(sseFrame({ type: "ended" })))
        .then(() => stream.writer.close())
        .catch(() => undefined);
    } else stream.writer.abort().catch(() => undefined);
    if (this.streams.size === 0 && this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
    if (this.isOnline(stream.guestId)) return;
    this.live = withoutPerson(this.live, stream.guestId);
    this.broadcast({ type: "presence", online: this.online() });
    const now = Date.now();
    for (const open of this.streams) {
      this.send(open, sseFrame(cursorsEventFor(this.live, open.guestId, now)));
    }
  }
}

/** Counts the boards one address made in the last hour. */
export class CreateLimit extends DurableObject<Env> {
  async take(now: number): Promise<boolean> {
    const stored = (await this.ctx.storage.get<ReadonlyArray<number>>("recent")) ?? [];
    const recent = stored.filter((at) => at > now - HOUR_MS);
    if (recent.length >= BOARD_CREATE_LIMIT) return false;
    await this.ctx.storage.put("recent", [...recent, now]);
    // Nothing is kept for an address that made no board for an hour.
    await this.ctx.storage.setAlarm(now + HOUR_MS);
    return true;
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
