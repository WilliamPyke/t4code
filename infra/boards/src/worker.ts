// @effect-diagnostics globalDate:off globalTimers:off cryptoRandomUUID:off - The Worker and its objects are plain Cloudflare handlers, outside the Effect runtime.
import {
  CLOUD_BOARD_ACCOUNT_CLAIM_ROUTE,
  CLOUD_BOARD_ACCOUNT_OPEN_ROUTE,
  CLOUD_BOARD_ACCOUNT_OUTLINE_ROUTE,
  CLOUD_BOARD_OUTLINE_ROUTE,
  CLOUD_BOARD_ACCOUNT_ROUTE,
  CLOUD_BOARD_COPIES_ROUTE,
  CLOUD_BOARD_COPY_ROUTE,
  CLOUD_BOARD_FRAME_CHECK_ROUTE,
  CloudBoardCopiesRequest,
  CloudBoardCopyRequest,
  type RoomBoard,
  type RoomBoardOutline,
  CLOUD_WORKSPACES_ROUTE,
  CLOUD_BOARD_LINK_ROUTE,
  CLOUD_BOARD_SHARING_ROUTE,
  CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
  CLOUD_BOARD_PEOPLE_ROLE_ROUTE,
  CLOUD_BOARD_ROUTE,
  CLOUD_BOARD_VIEW_ROUTE,
  CloudBoardLinkRequest,
  CloudBoardSharingRequest,
  CloudBoardRoleRequest,
  type CloudBoardLinkResult,
  CloudBoardAccountClaimRequest,
  CloudBoardCreateResult,
  GuestRedeemResult,
  type CloudBoardAccountBoard,
  type CloudBoardAccountOpenResult,
  type CloudBoardAccessRequest,
  type CloudInbox,
  type CloudInboxCount,
  type CloudInboxItem,
  type CloudMyTask,
  type CloudWorkspaceBoard,
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
} from "@t3tools/contracts";
import { boardOutline } from "@t3tools/shared/boardOutline";
import { encodeBoardPreview } from "@t3tools/shared/boardPreview";
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
  INVITE_ROUTE,
  JSON_MAX_BODY_BYTES,
  REDEEM_ROUTE,
  SESSION_ROUTE,
  SESSION_ROUTES,
  STREAM_ROUTE,
  checkAccess,
} from "./access.ts";
import { frameCheck } from "./frameCheck.ts";
import {
  EMPTY_LIVE,
  FAR_EXPIRY,
  ROOM_MAX_CHUNKS,
  boardAlarmAt,
  canChange,
  changeBoard,
  checkDelete,
  checkInvite,
  invitePreviewOf,
  checkViewerRoom,
  streamsPastCap,
  createRoom,
  cursorsEventFor,
  guestBySession,
  isViewLink,
  joinRoom,
  managesBoard,
  mentionedMembers,
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
  withCopies,
  withLink,
  withSharing,
  withRole,
  withoutPerson,
  type CloudGuest,
  type CloudRoom,
  type CloudStreamEvent,
  type RoomFailure,
  type RoomLive,
} from "./room.ts";
import {
  accountBoardOf,
  accountGuestOf,
  accountLockedOut,
  accountOfGuest,
  accountsOn,
  linkAccount,
  outlineFor,
  retitledAccountBoard,
  withAccountBoard,
  withAccountSession,
  withoutAccountBoard,
  type OutlineReader,
} from "./account.ts";
import {
  accessAnswerItem,
  accessRequestItem,
  answerAccess,
  askAccess,
  openRequestOf,
} from "./accessRequests.ts";
import {
  BOARD_MAKING_LIMIT,
  BOARD_MAKING_WINDOW_MS,
  copiedBoard,
  copyRefusal,
  copyTitle,
  FRAME_CHECKS_PER_ADDRESS,
  JOINS_PER_ADDRESS,
  takeBoardMaking,
} from "./copy.ts";
import { clerkKeys, verifyClerkSession, type ClerkKeyLookup } from "./clerk.ts";
import {
  inboxAfter,
  inboxCountOf,
  inboxDeliveries,
  inboxRead,
  taskIndexChanges,
  withInboxAt,
  withNotified,
  type InboxDelivery,
} from "./inbox.ts";
import { inboxRoute } from "./inboxRoutes.ts";
import { hashSecret, isShareId, makeSecret, makeViewSecret, shareOfSecret } from "./secrets.ts";
import {
  lockOutAccount,
  placeBoard,
  seatMember,
  workspaceBoardOf,
  type BoardPlacement,
} from "./workspace.ts";
import { BoardWorkspace } from "./workspaceObject.ts";
import { workspaceOf, workspaceRoute, type Answer } from "./workspaceRoutes.ts";

export { BoardWorkspace };

interface Env {
  readonly BOARDS: DurableObjectNamespace<BoardRoom>;
  readonly CREATE_LIMITS: DurableObjectNamespace<CreateLimit>;
  readonly ACCOUNTS: DurableObjectNamespace<BoardAccount>;
  readonly WORKSPACES: DurableObjectNamespace<BoardWorkspace>;
  /** Pages that may call this host from a browser, separated by commas. */
  readonly ALLOWED_ORIGINS: string;
  /**
   * The Clerk instance's Frontend API origin, whose published keys verify a person's session.
   * Empty turns accounts off: everything works as for someone signed out.
   */
  readonly CLERK_ISSUER?: string;
}

const NO_STORE = { "cache-control": "no-store" };
// Cloudflare closes idle streams after about 100 seconds.
const HEARTBEAT_MS = 20_000;

const failureResponse = (failure: RoomFailure) =>
  Response.json(
    { reason: failure.reason, message: failure.message },
    { status: failure.status, headers: NO_STORE },
  );
const noContent = () => new Response(null, { status: 204, headers: NO_STORE });

const decodeCreate = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardCreateRequest));
const decodeCreated = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardCreateResult));
const decodeRedeemed = Schema.decodeUnknownOption(Schema.fromJsonString(GuestRedeemResult));
const decodeClaim = Schema.decodeUnknownOption(
  Schema.fromJsonString(CloudBoardAccountClaimRequest),
);
const decodeTitle = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardTitleRequest));
const decodeRemove = Schema.decodeUnknownOption(
  Schema.fromJsonString(CloudBoardRemovePersonRequest),
);
const decodeLink = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardLinkRequest));
const decodeSharing = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardSharingRequest));
const decodeRole = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardRoleRequest));
const decodeCopies = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardCopiesRequest));
const decodeCopy = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardCopyRequest));
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

const allowedOrigins = (env: Env) =>
  env.ALLOWED_ORIGINS.split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");

// Per isolate: the instance's keys, fetched once an hour at most.
const keyLookups = new Map<string, ClerkKeyLookup>();

/**
 * The account a request is signed by, verified here from its Clerk session token. Never a user id
 * the page sent. Without the issuer configured, no request is signed in.
 */
async function accountOf(request: Request, env: Env): Promise<string | RoomFailure> {
  const issuer = env.CLERK_ISSUER?.trim() ?? "";
  if (issuer === "") return roomFailure("unavailable");
  let keyFor = keyLookups.get(issuer);
  if (keyFor === undefined) {
    keyFor = clerkKeys(issuer);
    keyLookups.set(issuer, keyFor);
  }
  const account = await verifyClerkSession(bearerOf(request), {
    issuer,
    allowedOrigins: allowedOrigins(env),
    now: Math.floor(Date.now() / 1000),
    keyFor,
  });
  return account ?? roomFailure("signed_out");
}

/** Making or joining a board while signed in: the account, a refusal, or null when signed out. */
async function optionalAccountOf(request: Request, env: Env) {
  if (bearerOf(request) === "" || (env.CLERK_ISSUER?.trim() ?? "") === "") return null;
  return accountOf(request, env);
}

const accountIndexOf = (env: Env, account: string) =>
  env.ACCOUNTS.get(env.ACCOUNTS.idFromName(account));

/** Ties a new seat to the account and lists the board, then answers as the host did. */
async function linkedResponse(
  env: Env,
  account: string,
  response: Response,
  read: (text: string) => { readonly token: string; readonly credential?: string } | null,
): Promise<Response> {
  if (!response.ok) return response;
  const text = await response.text();
  const seat = read(text);
  const shareId = seat === null ? null : shareOfSecret(seat.token);
  if (seat !== null && shareId !== null) {
    const board = await boardOf(env, shareId).linkAccount(account, seat.token, seat.credential);
    if (board !== null) await accountIndexOf(env, account).add([board]);
  }
  return new Response(text, { status: response.status, headers: response.headers });
}

async function accountRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const account = await accountOf(request, env);
  if (typeof account !== "string") return failureResponse(account);
  const index = accountIndexOf(env, account);
  const path = url.pathname;
  const listed = (boards: ReadonlyArray<CloudBoardAccountBoard>) =>
    Response.json({ boards }, { headers: NO_STORE });
  if (path === CLOUD_BOARD_ACCOUNT_ROUTE && request.method === "GET") {
    return listed(await index.list());
  }
  if (path === CLOUD_BOARD_ACCOUNT_CLAIM_ROUTE && request.method === "POST") {
    const body = await readBody(request, JSON_MAX_BODY_BYTES);
    if (typeof body !== "string") return failureResponse(body);
    const claim = decodeClaim(body);
    if (Option.isNone(claim)) return failureResponse(roomFailure("bad_request"));
    const boards = await Promise.all(
      claim.value.boards.map(({ token, credential }) => {
        const shareId = shareOfSecret(token);
        return shareId === null
          ? null
          : boardOf(env, shareId).linkAccount(account, token, credential);
      }),
    );
    return listed(await index.add(boards.filter((board) => board !== null)));
  }
  const inbox = await inboxRoute(request, env, url, {
    account,
    readBody: (maxBytes) => readBody(request, maxBytes),
  });
  if (inbox !== null) return inbox;
  const shareId = url.searchParams.get(GUEST_SHARE_PARAM);
  if (!isShareId(shareId)) return failureResponse(roomFailure("bad_request"));
  if (path === CLOUD_BOARD_ACCOUNT_OPEN_ROUTE && request.method === "POST") {
    const opened = await boardOf(env, shareId).openAsAccount(account);
    if (opened === null) {
      await index.forget(shareId);
      return failureResponse(roomFailure("ended"));
    }
    // The list keeps the board's invite, which the board itself keeps only as a hash.
    const kept = (await index.add([opened.board])).find((board) => board.shareId === shareId);
    const result: CloudBoardAccountOpenResult = {
      token: opened.token,
      board: kept ?? opened.board,
    };
    return Response.json(result, { headers: NO_STORE });
  }
  if (path === CLOUD_BOARD_ACCOUNT_OUTLINE_ROUTE && request.method === "GET") {
    const outline = await boardOf(env, shareId).outlineFor({ account });
    return outline === null
      ? failureResponse(roomFailure("ended"))
      : Response.json(outline, { headers: NO_STORE });
  }
  if (path === CLOUD_BOARD_ACCOUNT_ROUTE && request.method === "DELETE") {
    await boardOf(env, shareId).leaveAsAccount(account);
    await index.forget(shareId);
    return noContent();
  }
  return failureResponse(roomFailure("unavailable"));
}

/** One address's count of something other than making boards, in the same store under its own key. */
function takeForAddress(
  env: Env,
  request: Request,
  kind: "join" | "frame-check",
  limit: { readonly count: number; readonly windowMs: number },
): Promise<boolean> {
  const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
  return env.CREATE_LIMITS.get(env.CREATE_LIMITS.idFromName(`${kind}:${ip}`)).take(
    Date.now(),
    limit,
  );
}

/**
 * Answers only a page on an allowed origin, and only with one of three words, so it is no way to
 * read another site through this host. Kept by the browser for an hour.
 */
async function frameCheckRoute(request: Request, env: Env, url: URL): Promise<Response> {
  const pageOrigin = allowedOrigin(request, env);
  const address = url.searchParams.get("url");
  if (pageOrigin === null || address === null || address.length > 2048) {
    return failureResponse(roomFailure("bad_request"));
  }
  if (!(await takeForAddress(env, request, "frame-check", FRAME_CHECKS_PER_ADDRESS))) {
    return failureResponse(roomFailure("too_fast"));
  }
  const frame = await frameCheck({
    address,
    pageOrigin,
    ownHosts: [
      url.hostname,
      ...allowedOrigins(env).flatMap((origin) =>
        URL.canParse(origin) ? [new URL(origin).hostname] : [],
      ),
    ],
  });
  return Response.json(
    { frame },
    { headers: { "cache-control": frame === "unknown" ? "no-store" : "private, max-age=3600" } },
  );
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  if (path === CLOUD_BOARD_FRAME_CHECK_ROUTE && request.method === "GET") {
    return frameCheckRoute(request, env, url);
  }
  if (path === CLOUD_BOARD_ACCOUNT_ROUTE || path.startsWith(`${CLOUD_BOARD_ACCOUNT_ROUTE}/`)) {
    return accountRoute(request, env, url);
  }
  if (path === CLOUD_WORKSPACES_ROUTE || path.startsWith(`${CLOUD_WORKSPACES_ROUTE}/`)) {
    return workspaceRoute(request, env, url, {
      account: () => accountOf(request, env),
      readBody: (maxBytes) => readBody(request, maxBytes),
    });
  }
  if (path === CLOUD_BOARD_ROUTE && request.method === "POST") {
    const account = await optionalAccountOf(request, env);
    if (account !== null && typeof account !== "string") return failureResponse(account);
    // A signed-in person has their own count: people behind one address do not share a limit.
    const maker =
      account === null
        ? (request.headers.get("cf-connecting-ip") ?? "unknown")
        : `account:${account}`;
    const limit = env.CREATE_LIMITS.get(env.CREATE_LIMITS.idFromName(maker));
    if (!(await limit.take(Date.now()))) return failureResponse(roomFailure("too_fast"));
    const shareId = crypto.randomUUID();
    const target = new URL(CLOUD_BOARD_ROUTE, url);
    target.searchParams.set(GUEST_SHARE_PARAM, shareId);
    const created = await forward(env, shareId, request, target, JSON_MAX_BODY_BYTES);
    return account === null
      ? created
      : linkedResponse(env, account, created, (text) => Option.getOrNull(decodeCreated(text)));
  }
  if (path === CLOUD_BOARD_COPY_ROUTE && request.method === "POST") {
    const account = await optionalAccountOf(request, env);
    if (account !== null && typeof account !== "string") return failureResponse(account);
    const body = await readBody(request, JSON_MAX_BODY_BYTES);
    if (typeof body !== "string") return failureResponse(body);
    const copy = decodeCopy(body);
    if (Option.isNone(copy)) return failureResponse(roomFailure("bad_request"));
    const sourceId = shareOfSecret(copy.value.source);
    if (sourceId === null) return failureResponse(roomFailure("invalid"));
    // The copier's id is made here, so the source writes the copy's cards as theirs.
    const copier = GuestId.make(crypto.randomUUID());
    const source = await boardOf(env, sourceId).copyFor(copy.value.source, copier, nowIso());
    if ("failure" in source) return failureResponse(source.failure);
    // A copy is a new board: it counts against the same limit as making one, keyed the
    // same way so a signed-in person's address is not shared with strangers behind it.
    const maker =
      account === null
        ? (request.headers.get("cf-connecting-ip") ?? "unknown")
        : `account:${account}`;
    const limit = env.CREATE_LIMITS.get(env.CREATE_LIMITS.idFromName(maker));
    if (!(await limit.take(Date.now()))) return failureResponse(roomFailure("too_fast"));
    const shareId = crypto.randomUUID();
    const made = await boardOf(env, shareId).createCopy({
      shareId,
      name: copy.value.name,
      copier,
      title: source.title,
      board: source.board,
    });
    if ("failure" in made) return failureResponse(made.failure);
    const created = Response.json(made.result, { headers: NO_STORE });
    return account === null
      ? created
      : linkedResponse(env, account, created, (text) => Option.getOrNull(decodeCreated(text)));
  }
  if (
    (path === INVITE_ROUTE || path === REDEEM_ROUTE || path === CLOUD_BOARD_VIEW_ROUTE) &&
    request.method === "POST"
  ) {
    if (path === REDEEM_ROUTE && !(await takeForAddress(env, request, "join", JOINS_PER_ADDRESS))) {
      return failureResponse(roomFailure("too_fast"));
    }
    // Looking on from the view link is nobody's seat: no account comes into it.
    const account = path === REDEEM_ROUTE ? await optionalAccountOf(request, env) : null;
    if (account !== null && typeof account !== "string") return failureResponse(account);
    const body = await readBody(request, JSON_MAX_BODY_BYTES);
    if (typeof body !== "string") return failureResponse(body);
    const credential = decodeInvite(body);
    if (Option.isNone(credential)) return failureResponse(roomFailure("bad_request"));
    const shareId = shareOfSecret(credential.value.credential);
    if (shareId === null) return failureResponse(roomFailure("invalid"));
    const board = boardOf(env, shareId);
    if (account === null) return board.fetch(url.toString(), { method: "POST", body });
    // Someone already on the board comes back as the same person, whatever name they typed.
    const opened = await board.openAsAccount(account);
    if (opened !== null) {
      await accountIndexOf(env, account).add([opened.board]);
      const result: GuestRedeemResult = {
        token: opened.token,
        shareId: opened.board.shareId,
        threadId: opened.board.threadId,
        title: opened.board.title,
      };
      return Response.json(result, { headers: NO_STORE });
    }
    if (await board.locksOut(account)) {
      return failureResponse(
        roomFailure("not_member", "You are no longer in this board's workspace."),
      );
    }
    const redeemed = await board.fetch(url.toString(), { method: "POST", body });
    return linkedResponse(env, account, redeemed, (text) => {
      const result = Option.getOrNull(decodeRedeemed(text));
      return result === null
        ? null
        : { token: result.token, credential: credential.value.credential };
    });
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
  return allowedOrigins(env).includes(origin) ? origin : null;
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
  /**
   * Someone looking on from the view link gets an id of their own that names nobody. It changes
   * only when the person's seat is folded into their account's (see `mergeSeat`).
   */
  guestId: GuestId;
  /** The view link the page was opened with; null for someone on the board. */
  readonly viewHash: string | null;
  /** Where a view-link page was opened from, to cap how many one address holds. */
  readonly address: string | null;
  /** Whether the person manages the board, as it was when the page opened or became theirs. */
  manages: boolean;
  readonly writer: WritableStreamDefaultWriter<Uint8Array>;
  /** Whether the reader took the last ping. One that did not by the next is gone. */
  pingTaken: boolean;
}

// The room as it was kept before it was kept in pieces.
const ROOM_KEY = "room";
const CHUNK_COUNT_KEY = "room:chunks";
// The board's preview, kept apart from the room so writing it shows nobody a new view.
const PREVIEW_KEY = "preview";
// A preview goes to the board's lists at most this often, and a burst of changes (a template
// filling in) settles first; the last one goes as soon as nobody has the board open.
const PREVIEW_STEP_MS = 30_000;
const PREVIEW_SETTLE_MS = 5_000;
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
// A cloud board has no room thread of its own to name.
const outlined = (room: CloudRoom) =>
  Response.json(boardOutline(room.board, null), { headers: NO_STORE });

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
  /** The preview the board's lists were last given; empty before the board changed. */
  private preview = "";
  private previewSentAt = 0;
  private previewTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    void ctx.blockConcurrencyWhile(async () => {
      this.alarmAt = await ctx.storage.getAlarm();
      this.preview = (await ctx.storage.get<string>(PREVIEW_KEY)) ?? "";
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
    const accounts = accountsOn(this.room);
    const shareId = this.room?.shareId;
    const workspaceId = this.room?.workspaceId;
    this.deleted = true;
    this.room = null;
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    for (const stream of this.streams) this.drop(stream, true);
    this.live = EMPTY_LIVE;
    this.agents = EMPTY_AGENTS;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    if (shareId !== undefined) {
      await this.tellAccounts(accounts, (index) => index.forget(shareId));
      if (workspaceId !== undefined) {
        await workspaceOf(this.env, workspaceId)
          .forgetBoard(shareId)
          .catch(() => undefined);
      }
    }
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
        const room = this.room;
        const refused = checkInvite(room, await hashSecret(body.value.credential));
        return refused !== null || room === null
          ? failureResponse(refused ?? roomFailure("invalid"))
          : Response.json(invitePreviewOf(room), { headers: NO_STORE });
      }
      case REDEEM_ROUTE:
        return this.redeem(await request.text());
      case CLOUD_BOARD_VIEW_ROUTE: {
        const body = decodeInvite(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const room = this.room;
        if (room === null || !isViewLink(room, await hashSecret(body.value.credential))) {
          return failureResponse(roomFailure("invalid"));
        }
        // The view link is its own session: changing the link ends every page opened with it.
        const result: GuestRedeemResult = {
          token: body.value.credential,
          shareId: room.shareId,
          threadId: room.threadId,
          title: room.title,
        };
        return Response.json(result, { headers: NO_STORE });
      }
    }
    if (MACHINE_ROUTES[`${request.method} ${url.pathname}`] !== undefined) {
      return this.machine(request, url);
    }
    const hash = await hashSecret(bearerOf(request));
    const guest = guestBySession(this.room, hash);
    const room = this.room;
    if (room !== null && guest === undefined && isViewLink(room, hash)) {
      const refused = checkAccess("link", url.pathname);
      if (refused !== null) return failureResponse(refused);
      if (url.pathname === STREAM_ROUTE) {
        const address = request.headers.get("cf-connecting-ip") ?? "unknown";
        return this.openStream(room, null, request.signal, hash, false, address);
      }
      if (url.pathname === CLOUD_BOARD_OUTLINE_ROUTE) return outlined(room);
      return noContent();
    }
    // The board was deleted, or this person was taken off it.
    if (guest === undefined || room === null) return failureResponse(roomFailure("ended"));
    const refused = checkAccess(canChange(guest) ? "edit" : "view", url.pathname);
    if (refused !== null) return failureResponse(refused);
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
        const manages =
          body.value.guestId !== guest.id && (await this.manages(this.room ?? room, guest));
        const refused = await this.remove(guest.id, body.value.guestId, manages);
        return refused === null ? noContent() : failureResponse(refused);
      }
      case CLOUD_BOARD_PEOPLE_ROLE_ROUTE: {
        const body = decodeRole(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const manages = await this.manages(this.room ?? room, guest);
        const current = this.room ?? room;
        const next = withRole(current, manages, body.value.guestId, body.value.role, nowIso());
        if (Result.isFailure(next)) return failureResponse(next.failure);
        if (next.success !== current && body.value.role === "view") {
          // Their pointer and their agent's runs go at once; their open pages stay, read-only.
          this.live = withoutPerson(this.live, body.value.guestId);
          this.setAgents(agentsWithoutPerson(this.agents, body.value.guestId), Date.now());
          this.sendCursors(Date.now());
        }
        const told =
          next.success === current
            ? next.success
            : await this.tellRoleChanged(next.success, guest, body.value.guestId, body.value.role);
        await this.save(told);
        return noContent();
      }
      case CLOUD_BOARD_LINK_ROUTE: {
        const body = decodeLink(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const manages = await this.manages(this.room ?? room, guest);
        const current = this.room ?? room;
        const credential = body.value.on
          ? body.value.kind === "view"
            ? makeViewSecret(current.shareId)
            : makeSecret(current.shareId)
          : null;
        const next = withLink(
          current,
          manages,
          body.value.kind,
          credential === null ? null : { credential, hash: await hashSecret(credential) },
          nowIso(),
        );
        if (Result.isFailure(next)) return failureResponse(next.failure);
        await this.save(next.success);
        if (body.value.kind === "view") this.endOldViews();
        const result: CloudBoardLinkResult = { credential };
        return Response.json(result, { headers: NO_STORE });
      }
      case CLOUD_BOARD_SHARING_ROUTE: {
        const body = decodeSharing(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const manages = await this.manages(this.room ?? room, guest);
        const current = this.room ?? room;
        const edit = makeSecret(current.shareId);
        const view = makeViewSecret(current.shareId);
        const [editHash, viewHash] = await Promise.all([hashSecret(edit), hashSecret(view)]);
        const next = withSharing(
          current,
          manages,
          {
            sharing: body.value.sharing,
            renew: body.value.renew === true,
            fresh: {
              edit: { credential: edit, hash: editHash },
              view: { credential: view, hash: viewHash },
            },
          },
          nowIso(),
        );
        if (Result.isFailure(next)) return failureResponse(next.failure);
        await this.save(next.success);
        this.endOldViews();
        return noContent();
      }
      case CLOUD_BOARD_COPIES_ROUTE: {
        const body = decodeCopies(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const manages = await this.manages(this.room ?? room, guest);
        const next = withCopies(this.room ?? room, manages, body.value.on, nowIso());
        if (Result.isFailure(next)) return failureResponse(next.failure);
        await this.save(next.success);
        return noContent();
      }
      case SESSION_ROUTE:
        return noContent();
      case CLOUD_BOARD_OUTLINE_ROUTE:
        return outlined(room);
      case STREAM_ROUTE:
        return this.openStream(
          room,
          guest,
          request.signal,
          null,
          await this.manages(this.room ?? room, guest),
        );
      case CLOUD_BOARD_TITLE_ROUTE: {
        const body = decodeTitle(await request.text());
        if (Option.isNone(body)) return failureResponse(roomFailure("bad_request"));
        const before = this.room ?? room;
        const renamed = renameRoom(before, body.value.title, nowIso());
        await this.save(renamed);
        if (renamed !== before) {
          await this.tellAccounts(accountsOn(renamed), (index) =>
            index.retitle(renamed.shareId, renamed.title),
          );
          if (renamed.workspaceId !== undefined) {
            await workspaceOf(this.env, renamed.workspaceId)
              .retitleBoard(renamed.shareId, renamed.title)
              .catch(() => undefined);
          }
        }
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
        const members = await this.membersFor(this.room ?? room, change.value);
        const before = this.room ?? room;
        const next = changeBoard(before, guest.id, change.value, nowIso(), members);
        if (Result.isFailure(next)) return failureResponse(next.failure);
        await this.saveChange(before, next.success);
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
        this.sendCursors(now, guest.id);
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
      editLink: credential,
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
      title: joined.success.title,
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
    // As a machine's room answers a removed guest's machine, so it stops posting for good. Making
    // someone a viewer drops their machines' tokens; this holds should one be left.
    if (guest === undefined || !canChange(guest)) return failureResponse(roomFailure("ended"));
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
        const before = this.room ?? room;
        const changed = changeBoardAsAgent(before, guest.id, change.value, nowIso(), () =>
          crypto.randomUUID(),
        );
        if (Result.isFailure(changed)) return failureResponse(changed.failure);
        await this.saveChange(before, changed.success.room);
        return Response.json(changed.success.result, { headers: NO_STORE });
      }
    }
    return failureResponse(roomFailure("unavailable"));
  }

  /**
   * Takes `guestId` off the board by `by`'s say, as the remove route does: their open pages are
   * told, their agent's runs go, and their account's list drops the board.
   */
  private async remove(
    by: GuestId,
    guestId: GuestId,
    manages?: boolean,
  ): Promise<RoomFailure | null> {
    const current = this.room;
    if (current === null) return roomFailure("ended");
    const next = removePerson(current, by, guestId, nowIso(), manages);
    if (Result.isFailure(next)) return next.failure;
    if (next.success === current) return null;
    const account = accountOfGuest(current, guestId);
    for (const stream of this.streams) {
      if (stream.guestId === guestId) this.drop(stream, true);
    }
    this.setAgents(agentsWithoutPerson(this.agents, guestId), Date.now());
    await this.save(next.success);
    if (account !== undefined) {
      await this.tellAccounts([account], (index) => index.forget(current.shareId));
    }
    return null;
  }

  /** Whether `guest` manages the board: its maker, or an owner of its workspace as it says now. */
  private async manages(room: CloudRoom, guest: CloudGuest): Promise<boolean> {
    if (managesBoard(room, guest, null)) return true;
    if (room.workspaceId === undefined || guest.accountId === undefined) return false;
    const role = await workspaceOf(this.env, room.workspaceId)
      .roleOf(guest.accountId)
      .catch(() => null);
    return managesBoard(room, guest, role);
  }

  /** Ends every page opened with a view link that no longer opens the board. */
  private endOldViews() {
    for (const stream of this.streams) {
      if (stream.viewHash !== null && !isViewLink(this.room, stream.viewHash)) {
        this.drop(stream, true);
      }
    }
  }

  /** Everyone's pointers as each open page gets them; once for all who look on from the link. */
  private sendCursors(now: number, except?: GuestId) {
    let forViewers: string | null = null;
    for (const stream of this.streams) {
      if (stream.guestId === except) continue;
      if (stream.viewHash !== null) {
        forViewers ??= sseFrame(cursorsEventFor(this.live, stream.guestId, now));
        this.send(stream, forViewers);
      } else this.send(stream, sseFrame(cursorsEventFor(this.live, stream.guestId, now)));
    }
  }

  private async tellAccounts(
    accounts: ReadonlyArray<string>,
    tell: (index: DurableObjectStub<BoardAccount>) => Promise<unknown>,
  ): Promise<void> {
    // A list that missed this still opens nothing: the board answers for itself when opened.
    await Promise.allSettled(
      accounts.map((account) => tell(this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(account)))),
    );
  }

  /**
   * Called by the Worker once it verified `account`: ties it to the person `token` opens the board
   * as. The listed board, or null when the token opens nothing here or the seat is not theirs.
   */
  async linkAccount(
    account: string,
    token: string,
    credential: string | undefined,
  ): Promise<CloudBoardAccountBoard | null> {
    const [sessionHash, credentialHash] = await Promise.all([
      hashSecret(token),
      credential === undefined ? undefined : hashSecret(credential),
    ]);
    const link = () =>
      linkAccount(this.room, {
        account,
        sessionHash,
        ...(credential === undefined || credentialHash === undefined
          ? {}
          : { credential: { value: credential, hash: credentialHash } }),
        now: nowIso(),
      });
    const first = link();
    if (Result.isFailure(first)) return null;
    const person = accountGuestOf(first.success.room, account);
    const manages =
      first.success.merged !== undefined && person !== undefined
        ? await this.manages(first.success.room, person)
        : false;
    // Read again: the wait may have let another change to the board in.
    const linked = first.success.merged === undefined ? first : link();
    if (Result.isFailure(linked)) return null;
    const { merged } = linked.success;
    if (merged !== undefined) {
      // Their open pages are the account's person from here on, before the board is shown again.
      for (const stream of this.streams) {
        if (stream.guestId !== merged.from) continue;
        stream.guestId = merged.into;
        stream.manages = manages;
      }
      this.live = withoutPerson(this.live, merged.from);
      this.setAgents(agentsWithoutPerson(this.agents, merged.from), Date.now());
    }
    await this.save(linked.success.room);
    if (merged !== undefined) {
      this.broadcast(this.presence());
      this.sendCursors(Date.now());
    }
    return this.withPreview(linked.success.board);
  }

  /** Called by the Worker once it verified who reads: the board's outline, or null if they may not. */
  async outlineFor(reader: OutlineReader): Promise<RoomBoardOutline | null> {
    return outlineFor(this.room, reader);
  }

  /** Called by the Worker once it verified `account`, before it lets them join from a link. */
  async locksOut(account: string): Promise<boolean> {
    return accountLockedOut(this.room, account);
  }

  /** Called by the Worker once it verified `account`: a new session as the account's person here. */
  async openAsAccount(account: string): Promise<CloudBoardAccountOpenResult | null> {
    const shareId = this.room?.shareId;
    if (shareId === undefined) return null;
    const token = makeSecret(shareId);
    const hash = await hashSecret(token);
    const opened = withAccountSession(this.room, account, hash);
    if (Result.isFailure(opened)) return null;
    await this.save(opened.success.room);
    return {
      token,
      board: this.withPreview(
        accountBoardOf(opened.success.room, opened.success.guest, { addedAt: nowIso() }),
      ),
    };
  }

  /**
   * Called by the Worker for someone copying this board with `token`, their session here or its
   * view link: the copy's title and cards, written as `copier`'s, or why they may not.
   */
  async copyFor(
    token: string,
    copier: GuestId,
    at: string,
  ): Promise<
    { readonly title: string; readonly board: RoomBoard } | { readonly failure: RoomFailure }
  > {
    const room = this.room;
    const hash = await hashSecret(token);
    const refused = copyRefusal(room, guestBySession(room, hash), isViewLink(room, hash));
    if (refused !== null || room === null) return { failure: refused ?? roomFailure("ended") };
    return { title: copyTitle(room.title), board: copiedBoard(room, copier, at) };
  }

  /** Called by the Worker to make a copy here: a new board whose maker is `copier`, with `board`. */
  async createCopy(input: {
    readonly shareId: string;
    readonly name: string;
    readonly copier: GuestId;
    readonly title: string;
    readonly board: RoomBoard;
  }): Promise<{ readonly result: CloudBoardCreateResult } | { readonly failure: RoomFailure }> {
    if (!isShareId(input.shareId) || this.room !== null) return { failure: roomFailure("exists") };
    const credential = makeSecret(input.shareId);
    const token = makeSecret(input.shareId);
    const [inviteHash, sessionHash] = await Promise.all([
      hashSecret(credential),
      hashSecret(token),
    ]);
    const made = createRoom({
      shareId: GuestShareId.make(input.shareId),
      threadId: ThreadId.make(`board-${input.shareId}`),
      title: input.title,
      inviteHash,
      editLink: credential,
      maker: { id: input.copier, name: input.name, sessionHash },
      now: nowIso(),
    });
    await this.save({ ...made, board: input.board });
    await this.keepAlarm();
    return {
      result: { token, shareId: made.shareId, threadId: made.threadId, credential },
    };
  }

  /** Called by the Worker once it verified `account`: the account's person leaves the board. */
  async leaveAsAccount(account: string): Promise<void> {
    const guest = accountGuestOf(this.room, account);
    if (guest !== undefined) await this.remove(guest.id, guest.id);
  }

  /**
   * Called by the Worker once it verified the account: puts the board in a workspace or takes it
   * out. What the workspace lists of it, and the workspace it was in.
   */
  async placeInWorkspace(
    placement: BoardPlacement,
  ): Promise<Answer<{ readonly board: CloudWorkspaceBoard; readonly previous: string | null }>> {
    const placed = placeBoard(this.room, placement);
    if (Result.isFailure(placed)) return { failure: placed.failure };
    await this.save(placed.success.room);
    return {
      value: {
        board: this.withPreview(workspaceBoardOf(placed.success.room, { addedAt: nowIso() })),
        previous: placed.success.previous ?? null,
      },
    };
  }

  /** Called by the Worker once the workspace said the account is in it: a session as them here. */
  async openAsMember(
    account: string,
    workspaceId: string,
    name: string,
  ): Promise<Answer<CloudBoardAccountOpenResult>> {
    const shareId = this.room?.shareId;
    if (shareId === undefined) return { failure: roomFailure("ended") };
    const token = makeSecret(shareId);
    const seated = seatMember(this.room, {
      account,
      workspaceId,
      sessionHash: await hashSecret(token),
      guestId: GuestId.make(crypto.randomUUID()),
      name,
      now: nowIso(),
    });
    if (Result.isFailure(seated)) return { failure: seated.failure };
    await this.save(seated.success.room);
    return { value: { token, board: this.withPreview(seated.success.board) } };
  }

  /** Called by a workspace that no longer has `account`: their way in goes, their cards stay. */
  async lockOut(account: string, workspaceId: string): Promise<void> {
    const locked = lockOutAccount(this.room, account, workspaceId);
    if (locked === null) return;
    for (const stream of this.streams) {
      if (stream.guestId === locked.guestId) this.drop(stream, true);
    }
    this.setAgents(agentsWithoutPerson(this.agents, locked.guestId), Date.now());
    await this.save(locked.room);
    await this.tellAccounts([account], (index) => index.forget(locked.room.shareId));
  }

  /** Called by a deleted workspace: the board stays, with everyone on it, in no workspace. */
  async leaveWorkspace(workspaceId: string): Promise<void> {
    if (this.room?.workspaceId !== workspaceId) return;
    const { workspaceId: _gone, ...rest } = this.room;
    await this.save(rest);
  }

  private indexOf(account: string) {
    return this.env.ACCOUNTS.get(this.env.ACCOUNTS.idFromName(account));
  }

  /** The member ids of the board's workspace, read only when the change mentions a member. */
  private async membersFor(room: CloudRoom, change: RoomBoardChange): Promise<ReadonlySet<string>> {
    if (room.workspaceId === undefined || mentionedMembers(change).length === 0) return new Set();
    const ids = await workspaceOf(this.env, room.workspaceId)
      .memberIds()
      .catch((): ReadonlyArray<string> => []);
    return new Set(ids);
  }

  /** Keeps a change someone made, once what it gives people is in their inboxes. */
  private async saveChange(before: CloudRoom, next: CloudRoom): Promise<void> {
    if (next === before) return;
    const at = nowIso();
    const deliveries = inboxDeliveries(before, next, { at, newId: () => crypto.randomUUID() });
    const told = await this.deliver(next, deliveries);
    await this.save(withNotified(withInboxAt(next, told, at), deliveries, at));
  }

  /**
   * Puts each item in its person's inbox: an account on the board as it is now, a workspace member
   * as the workspace says now, never the author's own. Who on the board was told, so their open
   * pages read their inbox again.
   */
  private async deliver(
    room: CloudRoom,
    deliveries: ReadonlyArray<InboxDelivery>,
  ): Promise<ReadonlyArray<GuestId>> {
    if (deliveries.length === 0) return [];
    const memberIds = deliveries.flatMap((delivery) =>
      "memberId" in delivery ? [delivery.memberId] : [],
    );
    const members: Readonly<Record<string, string>> =
      memberIds.length === 0 || room.workspaceId === undefined
        ? {}
        : await workspaceOf(this.env, room.workspaceId)
            .accountsOf(memberIds)
            .catch(() => ({}));
    const byAccount = new Map<string, Array<CloudInboxItem>>();
    const seen = new Set<string>();
    const told: Array<GuestId> = [];
    for (const delivery of deliveries) {
      const account = "account" in delivery ? delivery.account : members[delivery.memberId];
      if (account === undefined) continue;
      if (delivery.author !== undefined && accountOfGuest(room, delivery.author) === account) {
        continue;
      }
      const key = `${account} ${delivery.item.noteId ?? delivery.item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      byAccount.set(account, [...(byAccount.get(account) ?? []), delivery.item]);
      const guestId = "guestId" in delivery ? delivery.guestId : accountGuestOf(room, account)?.id;
      if (guestId !== undefined) told.push(guestId);
    }
    await Promise.allSettled(
      [...byAccount].map(([account, items]) => this.indexOf(account).deliver(items)),
    );
    return told;
  }

  /** Tells someone the board's manager changed what they can do; the board with them told. */
  private async tellRoleChanged(
    room: CloudRoom,
    by: CloudGuest,
    guestId: GuestId,
    role: "edit" | "view",
  ): Promise<CloudRoom> {
    const account = accountOfGuest(room, guestId);
    if (account === undefined) return room;
    const at = nowIso();
    const item: CloudInboxItem = {
      id: crypto.randomUUID(),
      kind: "access-changed",
      at,
      by: by.name,
      title: room.title,
      shareId: room.shareId,
      threadId: room.threadId,
      ...(room.workspaceId === undefined ? {} : { workspaceId: room.workspaceId }),
      role,
    };
    await this.indexOf(account)
      .deliver([item])
      .catch(() => undefined);
    return withInboxAt(room, [guestId], at);
  }

  /** The accounts that answer access requests: the maker's, and the workspace's owners'. */
  private async managerAccounts(room: CloudRoom): Promise<ReadonlyArray<string>> {
    const maker = room.guests.find((guest) => guest.id === room.maker);
    const owners =
      room.workspaceId === undefined
        ? []
        : await workspaceOf(this.env, room.workspaceId)
            .ownerAccounts()
            .catch((): ReadonlyArray<string> => []);
    return [
      ...new Set([
        ...(maker?.accountId === undefined || maker.locked === true ? [] : [maker.accountId]),
        ...owners,
      ]),
    ];
  }

  /** Called by the Worker once it verified `account`: the id of its request still open, or null. */
  async openAccessRequest(account: string): Promise<string | null> {
    return openRequestOf(this.room, account)?.id ?? null;
  }

  /**
   * Called by the Worker once it verified `account`: asks whoever manages the board for edit
   * access. The request's id, which the asking page watches for.
   */
  async askAccess(account: string, ask: CloudBoardAccessRequest): Promise<Answer<string>> {
    const room = this.room;
    const viewing =
      room !== null &&
      ask.credential !== undefined &&
      isViewLink(room, await hashSecret(ask.credential));
    const asked = askAccess(this.room, {
      id: crypto.randomUUID(),
      account,
      name: ask.name,
      message: ask.message,
      viewing,
      now: nowIso(),
    });
    if (Result.isFailure(asked)) return { failure: asked.failure };
    const { request } = asked.success;
    const managers = (await this.managerAccounts(asked.success.room)).filter(
      (manager) => manager !== account,
    );
    const item = accessRequestItem(asked.success.room, request);
    await Promise.allSettled(managers.map((manager) => this.indexOf(manager).deliver([item])));
    const told = managers.flatMap(
      (manager) => accountGuestOf(asked.success.room, manager)?.id ?? [],
    );
    await this.save(withInboxAt(asked.success.room, told, request.at));
    return { value: request.id };
  }

  /**
   * Called by the Worker once it verified `account`: approves or declines a request, for its maker
   * or an owner of its workspace. Approved, the person's open page can edit at once.
   */
  async answerAccess(account: string, requestId: string, approve: boolean): Promise<Answer<null>> {
    const room = this.room;
    if (room === null) return { failure: roomFailure("ended") };
    const guest = accountGuestOf(room, account);
    const manages =
      guest === undefined
        ? room.workspaceId !== undefined &&
          (await workspaceOf(this.env, room.workspaceId)
            .roleOf(account)
            .catch(() => null)) === "owner"
        : await this.manages(room, guest);
    const now = nowIso();
    const answered = answerAccess(this.room ?? room, {
      requestId,
      approve,
      manages,
      guestId: GuestId.make(crypto.randomUUID()),
      now,
    });
    if (Result.isFailure(answered)) return { failure: answered.failure };
    const { request, seat } = answered.success;
    const next = answered.success.room;
    const requester = this.indexOf(request.account);
    await requester
      .deliver([accessAnswerItem(next, request, guest?.name ?? "An owner of its workspace")])
      .catch(() => undefined);
    if (seat !== null) {
      await requester
        .add([this.withPreview(accountBoardOf(next, seat, { addedAt: now }))])
        .catch(() => undefined);
    }
    const managers = await this.managerAccounts(next);
    const item = accessRequestItem(next, request, true);
    await Promise.allSettled(managers.map((manager) => this.indexOf(manager).deliver([item])));
    const told = accountGuestOf(next, request.account)?.id;
    await this.save(withInboxAt(next, told === undefined ? [] : [told], now));
    return { value: null };
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
    const boardChanged = room.board !== this.room?.board;
    const previous = this.room;
    this.room = room;
    if (boardChanged) this.previewLater();
    await this.ctx.storage.put({
      [CHUNK_COUNT_KEY]: chunks.length,
      ...Object.fromEntries(chunks.map((chunk, index) => [chunkKey(index), chunk])),
    });
    const stale = Array.from({ length: Math.max(0, before - chunks.length) }, (_, index) =>
      chunkKey(chunks.length + index),
    );
    await this.ctx.storage.delete(before === 0 ? [...stale, ROOM_KEY] : stale);
    let forViewers: string | null = null;
    for (const stream of this.streams) {
      if (stream.viewHash !== null) {
        forViewers ??= sseFrame({ type: "view", view: viewFor(room, null) });
        this.send(stream, forViewers);
        continue;
      }
      const guest = room.guests.find((candidate) => candidate.id === stream.guestId);
      if (guest !== undefined)
        this.send(stream, sseFrame({ type: "view", view: viewFor(room, guest, stream.manages) }));
    }
    await this.keepTaskIndex(previous, room);
  }

  /** Gives each account whose tasks here changed its tasks here now, for its "My tasks". */
  private async keepTaskIndex(previous: CloudRoom | null, room: CloudRoom): Promise<void> {
    if (
      previous === null ||
      (previous.board === room.board &&
        previous.guests === room.guests &&
        previous.title === room.title &&
        previous.workspaceId === room.workspaceId)
    ) {
      return;
    }
    const changes = taskIndexChanges(previous, room);
    await Promise.allSettled(
      changes.map(({ account, tasks }) => this.indexOf(account).setTasks(room.shareId, tasks)),
    );
  }

  /** Sends the board's preview to its lists once changes settle, at most once a step. */
  private previewLater() {
    if (this.previewTimer !== null) return;
    const wait = Math.max(PREVIEW_SETTLE_MS, this.previewSentAt + PREVIEW_STEP_MS - Date.now());
    this.previewTimer = setTimeout(() => void this.sendPreview(), wait);
  }

  /**
   * Gives every account on the board and its workspace the board's preview, when it changed.
   * Only the cards' kinds, places, sizes and paints; never their text.
   */
  private async sendPreview(): Promise<void> {
    if (this.previewTimer !== null) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    const room = this.room;
    if (room === null || this.deleted) return;
    const preview = encodeBoardPreview(room.board);
    if (preview === this.preview) return;
    this.preview = preview;
    this.previewSentAt = Date.now();
    await this.ctx.storage.put(PREVIEW_KEY, preview);
    await this.tellAccounts(accountsOn(room), (index) => index.setPreview(room.shareId, preview));
    if (room.workspaceId !== undefined) {
      await workspaceOf(this.env, room.workspaceId)
        .setBoardPreview(room.shareId, preview)
        .catch(() => undefined);
    }
  }

  /** What a list keeps of the board, with its preview once it has one. */
  private withPreview<T extends object>(listed: T): T & { readonly preview?: string } {
    return this.preview === "" ? listed : { ...listed, preview: this.preview };
  }

  private isOnline(guestId: GuestId) {
    for (const stream of this.streams) if (stream.guestId === guestId) return true;
    return false;
  }

  private online() {
    return onlineOf(
      [...this.streams].flatMap((stream) => (stream.viewHash === null ? [stream.guestId] : [])),
    );
  }

  private viewing() {
    let count = 0;
    for (const stream of this.streams) if (stream.viewHash !== null) count++;
    return count;
  }

  private presence(): CloudStreamEvent {
    return { type: "presence", online: this.online(), viewing: this.viewing() };
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

  /**
   * Opens `guest`'s page on the board, or the page of someone looking on from the view link
   * (`guest` null, with that link's `viewHash`), who counts among those viewing and has no pointer.
   */
  private openStream(
    room: CloudRoom,
    guest: CloudGuest | null,
    signal: AbortSignal,
    viewHash: string | null,
    manages = false,
    address: string | null = null,
  ): Response {
    for (const old of streamsPastCap(
      this.streams,
      guest === null ? { address: address ?? "unknown" } : { guestId: guest.id },
    )) {
      this.drop(old);
    }
    if (guest === null) {
      const full = checkViewerRoom(this.viewing());
      if (full !== null) return failureResponse(full);
    }
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const stream: OpenStream = {
      guestId: guest?.id ?? GuestId.make(`viewer-${crypto.randomUUID()}`),
      viewHash: guest === null ? viewHash : null,
      address: guest === null ? (address ?? "unknown") : null,
      manages,
      writer: writable.getWriter(),
      pingTaken: true,
    };
    const wasOnline = this.isOnline(stream.guestId);
    this.streams.add(stream);
    // Closed or cancelled by the reader, or the request aborted: the guest's page went.
    stream.writer.closed.then(
      () => this.drop(stream),
      () => this.drop(stream),
    );
    signal.addEventListener("abort", () => this.drop(stream));
    const presence = { online: this.online(), viewing: this.viewing() };
    for (const event of openingEvents(room, guest, presence, manages)) {
      this.send(stream, sseFrame(event));
    }
    const now = Date.now();
    const cursors = cursorsEventFor(this.live, stream.guestId, now);
    if (cursors.cursors.length > 0 || (cursors.views?.length ?? 0) > 0) {
      this.send(stream, sseFrame(cursors));
    }
    const agents = agentsEvent(this.agents, now);
    if (agents.running.length > 0 || (agents.boxes?.length ?? 0) > 0) {
      this.send(stream, sseFrame(agents));
    }
    if (!wasOnline) this.broadcast(this.presence(), stream);
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
    // Everyone left: the home they go back to shows the board as they left it.
    if (this.streams.size === 0 && this.previewTimer !== null) void this.sendPreview();
    if (this.isOnline(stream.guestId)) return;
    this.broadcast(this.presence());
    // Someone looking on from the view link had no pointer to take away.
    if (stream.viewHash !== null) return;
    this.live = withoutPerson(this.live, stream.guestId);
    this.sendCursors(Date.now());
  }
}

const ACCOUNT_BOARD_PREFIX = "board:";
const ACCOUNT_WORKSPACE_PREFIX = "workspace:";
const ACCOUNT_INBOX_PREFIX = "inbox:";
// One key per board, holding the account's tasks there.
const ACCOUNT_TASKS_PREFIX = "tasks:";

/**
 * One account's list of its cloud boards, keyed by its Clerk user id. Only the Worker calls it,
 * after verifying the account; the boards themselves say who may open them.
 */
export class BoardAccount extends DurableObject<Env> {
  async list(): Promise<ReadonlyArray<CloudBoardAccountBoard>> {
    const stored = await this.ctx.storage.list<CloudBoardAccountBoard>({
      prefix: ACCOUNT_BOARD_PREFIX,
    });
    return [...stored.values()].toSorted((left, right) =>
      left.addedAt.localeCompare(right.addedAt),
    );
  }

  async add(
    boards: ReadonlyArray<CloudBoardAccountBoard>,
  ): Promise<ReadonlyArray<CloudBoardAccountBoard>> {
    const before = await this.list();
    return this.keep(before, boards.reduce(withAccountBoard, before));
  }

  async forget(shareId: string): Promise<void> {
    const before = await this.list();
    await this.keep(before, withoutAccountBoard(before, shareId));
    await this.ctx.storage.delete(ACCOUNT_TASKS_PREFIX + shareId);
  }

  /** The inbox as kept: each item its own key, those past their days or the cap dropped here. */
  private async inboxItems(incoming: ReadonlyArray<CloudInboxItem> = []) {
    const stored = await this.ctx.storage.list<CloudInboxItem>({ prefix: ACCOUNT_INBOX_PREFIX });
    const before = [...stored.values()];
    const kept = inboxAfter(before, incoming, Date.now());
    await this.keepInbox(before, kept);
    return kept;
  }

  private async keepInbox(
    before: ReadonlyArray<CloudInboxItem>,
    after: ReadonlyArray<CloudInboxItem>,
  ): Promise<void> {
    const kept = new Set(after.map((item) => item.id));
    const dropped = before
      .filter((item) => !kept.has(item.id))
      .map((item) => ACCOUNT_INBOX_PREFIX + item.id);
    const changed = after.filter((item) => !before.includes(item));
    for (let at = 0; at < changed.length; at += 128) {
      await this.ctx.storage.put(
        Object.fromEntries(
          changed.slice(at, at + 128).map((item) => [ACCOUNT_INBOX_PREFIX + item.id, item]),
        ),
      );
    }
    for (let at = 0; at < dropped.length; at += 128) {
      await this.ctx.storage.delete(dropped.slice(at, at + 128));
    }
  }

  /** Called by a board, or a workspace, when something it took is for this account. */
  async deliver(items: ReadonlyArray<CloudInboxItem>): Promise<void> {
    if (items.length > 0) await this.inboxItems(items);
  }

  async inbox(): Promise<CloudInbox> {
    const items = await this.inboxItems();
    return { items, unread: inboxCountOf(items).unread };
  }

  async inboxCount(): Promise<CloudInboxCount> {
    return inboxCountOf(await this.inboxItems());
  }

  async markRead(which: ReadonlyArray<string> | "all"): Promise<CloudInboxCount> {
    const before = await this.inboxItems();
    const after = inboxRead(before, which);
    await this.keepInbox(before, after);
    return inboxCountOf(after);
  }

  /** The account's tasks on one board, as that board says now; none forgets the board. */
  async setTasks(shareId: string, tasks: ReadonlyArray<CloudMyTask>): Promise<void> {
    if (tasks.length === 0) await this.ctx.storage.delete(ACCOUNT_TASKS_PREFIX + shareId);
    else await this.ctx.storage.put(ACCOUNT_TASKS_PREFIX + shareId, tasks);
  }

  async tasks(): Promise<ReadonlyArray<CloudMyTask>> {
    const stored = await this.ctx.storage.list<ReadonlyArray<CloudMyTask>>({
      prefix: ACCOUNT_TASKS_PREFIX,
    });
    return [...stored.values()].flat();
  }

  async retitle(shareId: string, title: string): Promise<void> {
    const before = await this.list();
    await this.keep(before, retitledAccountBoard(before, shareId, title));
  }

  /** The board's new preview, on its one key: the rest of the list is not read. */
  async setPreview(shareId: string, preview: string): Promise<void> {
    const key = ACCOUNT_BOARD_PREFIX + shareId;
    const listed = await this.ctx.storage.get<CloudBoardAccountBoard>(key);
    if (listed === undefined || listed.preview === preview) return;
    await this.ctx.storage.put(key, { ...listed, preview });
  }

  /** The workspaces the account is in; each workspace itself says whether it still has them. */
  async workspaces(): Promise<ReadonlyArray<string>> {
    const stored = await this.ctx.storage.list({ prefix: ACCOUNT_WORKSPACE_PREFIX });
    return [...stored.keys()].map((key) => key.slice(ACCOUNT_WORKSPACE_PREFIX.length));
  }

  async addWorkspace(id: string): Promise<void> {
    await this.ctx.storage.put(ACCOUNT_WORKSPACE_PREFIX + id, true);
  }

  async forgetWorkspaces(ids: ReadonlyArray<string>): Promise<void> {
    await this.ctx.storage.delete(ids.map((id) => ACCOUNT_WORKSPACE_PREFIX + id));
  }

  /** Writes only what changed between the two lists; each board is its own key. */
  private async keep(
    before: ReadonlyArray<CloudBoardAccountBoard>,
    after: ReadonlyArray<CloudBoardAccountBoard>,
  ): Promise<ReadonlyArray<CloudBoardAccountBoard>> {
    const kept = new Set(after.map((board) => board.shareId));
    const dropped = before
      .filter((board) => !kept.has(board.shareId))
      .map((board) => ACCOUNT_BOARD_PREFIX + board.shareId);
    const changed = after.filter((board) => !before.includes(board));
    // One storage call takes at most 128 keys.
    for (let at = 0; at < changed.length; at += 128) {
      await this.ctx.storage.put(
        Object.fromEntries(
          changed.slice(at, at + 128).map((board) => [ACCOUNT_BOARD_PREFIX + board.shareId, board]),
        ),
      );
    }
    for (let at = 0; at < dropped.length; at += 128) {
      await this.ctx.storage.delete(dropped.slice(at, at + 128));
    }
    return after;
  }
}

/** Counts the boards one address made in the last hour. */
export class CreateLimit extends DurableObject<Env> {
  async take(
    now: number,
    limit: { readonly count: number; readonly windowMs: number } = {
      count: BOARD_MAKING_LIMIT,
      windowMs: BOARD_MAKING_WINDOW_MS,
    },
  ): Promise<boolean> {
    const stored = (await this.ctx.storage.get<ReadonlyArray<number>>("recent")) ?? [];
    const recent = takeBoardMaking(stored, now, limit);
    if (recent === null) return false;
    await this.ctx.storage.put("recent", recent);
    // Nothing is kept for an address that took nothing for a whole window.
    await this.ctx.storage.setAlarm(now + limit.windowMs);
    return true;
  }

  override async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
