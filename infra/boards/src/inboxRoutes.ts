import {
  CLOUD_BOARD_ACCESS_ANSWER_ROUTE,
  CLOUD_BOARD_ACCESS_ROUTE,
  CLOUD_INBOX_COUNT_ROUTE,
  CLOUD_INBOX_READ_ROUTE,
  CLOUD_INBOX_ROUTE,
  CLOUD_MY_TASKS_ROUTE,
  CloudBoardAccessAnswer,
  CloudBoardAccessRequest,
  CloudInboxReadRequest,
  GUEST_SHARE_PARAM,
  type CloudBoardAccessResult,
  type CloudMyTasks,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { roomFailure, type RoomFailure } from "./room.ts";
import { isShareId } from "./secrets.ts";
import type { BoardAccount, BoardRoom } from "./worker.ts";

export interface InboxEnv {
  readonly BOARDS: DurableObjectNamespace<BoardRoom>;
  readonly ACCOUNTS: DurableObjectNamespace<BoardAccount>;
}

const NO_STORE = { "cache-control": "no-store" };
const JSON_MAX_BODY_BYTES = 16 * 1024;

const failureResponse = (failure: RoomFailure) =>
  Response.json(
    { reason: failure.reason, message: failure.message },
    { status: failure.status, headers: NO_STORE },
  );

const decodeRead = Schema.decodeUnknownOption(Schema.fromJsonString(CloudInboxReadRequest));
const decodeAsk = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardAccessRequest));
const decodeAnswer = Schema.decodeUnknownOption(Schema.fromJsonString(CloudBoardAccessAnswer));

/**
 * The inbox, "My tasks" and access request routes, or null for any other path. `account` is the
 * one the Worker verified from the request's Clerk session: an account only ever reads its own.
 */
export async function inboxRoute(
  request: Request,
  env: InboxEnv,
  url: URL,
  context: {
    readonly account: string;
    readonly readBody: (maxBytes: number) => Promise<string | RoomFailure>;
  },
): Promise<Response | null> {
  const route = `${request.method} ${url.pathname}`;
  const index = env.ACCOUNTS.get(env.ACCOUNTS.idFromName(context.account));
  const body = async <T>(decode: (text: string) => Option.Option<T>): Promise<T | RoomFailure> => {
    const text = await context.readBody(JSON_MAX_BODY_BYTES);
    if (typeof text !== "string") return text;
    return Option.getOrElse(decode(text), () => roomFailure("bad_request"));
  };
  const isFailure = (value: unknown): value is RoomFailure =>
    typeof value === "object" && value !== null && "status" in value && "reason" in value;
  switch (route) {
    case `GET ${CLOUD_INBOX_ROUTE}`:
      return Response.json(await index.inbox(), { headers: NO_STORE });
    case `GET ${CLOUD_INBOX_COUNT_ROUTE}`:
      return Response.json(await index.inboxCount(), { headers: NO_STORE });
    case `POST ${CLOUD_INBOX_READ_ROUTE}`: {
      const read = await body(decodeRead);
      if (isFailure(read)) return failureResponse(read);
      const count = await index.markRead(read.all === true ? "all" : (read.ids ?? []));
      return Response.json(count, { headers: NO_STORE });
    }
    case `GET ${CLOUD_MY_TASKS_ROUTE}`: {
      const tasks: CloudMyTasks = { tasks: await index.tasks() };
      return Response.json(tasks, { headers: NO_STORE });
    }
    case `GET ${CLOUD_BOARD_ACCESS_ROUTE}`: {
      // The open request this account asked on the board, so a page reloaded still says Asked.
      const shareId = url.searchParams.get(GUEST_SHARE_PARAM);
      if (!isShareId(shareId)) return failureResponse(roomFailure("bad_request"));
      const open = await env.BOARDS.get(env.BOARDS.idFromName(shareId)).openAccessRequest(
        context.account,
      );
      if (open === null) return new Response(null, { status: 204, headers: NO_STORE });
      const result: CloudBoardAccessResult = { request: open };
      return Response.json(result, { headers: NO_STORE });
    }
    case `POST ${CLOUD_BOARD_ACCESS_ROUTE}`:
    case `POST ${CLOUD_BOARD_ACCESS_ANSWER_ROUTE}`: {
      const shareId = url.searchParams.get(GUEST_SHARE_PARAM);
      if (!isShareId(shareId)) return failureResponse(roomFailure("bad_request"));
      const board = env.BOARDS.get(env.BOARDS.idFromName(shareId));
      if (url.pathname === CLOUD_BOARD_ACCESS_ROUTE) {
        const ask = await body(decodeAsk);
        if (isFailure(ask)) return failureResponse(ask);
        const asked = await board.askAccess(context.account, ask);
        if ("failure" in asked) return failureResponse(asked.failure);
        const result: CloudBoardAccessResult = { request: asked.value };
        return Response.json(result, { headers: NO_STORE });
      }
      const answer = await body(decodeAnswer);
      if (isFailure(answer)) return failureResponse(answer);
      const answered = await board.answerAccess(context.account, answer.request, answer.approve);
      return "failure" in answered
        ? failureResponse(answered.failure)
        : new Response(null, { status: 204, headers: NO_STORE });
    }
  }
  return null;
}
