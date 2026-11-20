// @effect-diagnostics globalDate:off cryptoRandomUUID:off - Plain Cloudflare handlers, outside the Effect runtime.
import {
  CLOUD_WORKSPACES_PER_ACCOUNT,
  CLOUD_WORKSPACES_ROUTE,
  CLOUD_WORKSPACE_BOARD_ROUTE,
  CLOUD_WORKSPACE_INVITE_ROUTE,
  CLOUD_WORKSPACE_JOIN_ROUTE,
  CLOUD_WORKSPACE_LEAVE_ROUTE,
  CLOUD_WORKSPACE_MEMBER_PARAM,
  CLOUD_WORKSPACE_MEMBER_ROUTE,
  CLOUD_WORKSPACE_OPEN_ROUTE,
  CLOUD_WORKSPACE_OUTLINE_ROUTE,
  CLOUD_WORKSPACE_PARAM,
  CLOUD_WORKSPACE_PREVIEW_ROUTE,
  CLOUD_WORKSPACE_ROUTE,
  CloudWorkspaceCreateRequest,
  CloudWorkspaceJoinRequest,
  CloudWorkspaceOpenRequest,
  CloudWorkspacePreviewRequest,
  CloudWorkspaceRenameRequest,
  CloudWorkspaceRoleRequest,
  GUEST_SHARE_PARAM,
  type CloudBoardAccountOpenResult,
  type CloudWorkspaceInviteResult,
  type CloudWorkspaceList,
  type CloudWorkspacePreview,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { roomFailure, type RoomFailure } from "./room.ts";
import { isShareId, shareOfSecret } from "./secrets.ts";
import type { BoardAccount, BoardRoom, CreateLimit } from "./worker.ts";
import type { BoardWorkspace } from "./workspaceObject.ts";

export interface WorkspaceEnv {
  readonly BOARDS: DurableObjectNamespace<BoardRoom>;
  readonly ACCOUNTS: DurableObjectNamespace<BoardAccount>;
  readonly WORKSPACES: DurableObjectNamespace<BoardWorkspace>;
  readonly CREATE_LIMITS: DurableObjectNamespace<CreateLimit>;
}

/** What a call between objects answers: a value, or why not. Plain, so it crosses RPC. */
export type Answer<T> = { readonly value: T } | { readonly failure: RoomFailure };

const NO_STORE = { "cache-control": "no-store" };
const JSON_MAX_BODY_BYTES = 16 * 1024;

const failureResponse = (failure: RoomFailure) =>
  Response.json(
    { reason: failure.reason, message: failure.message },
    { status: failure.status, headers: NO_STORE },
  );
const noContent = () => new Response(null, { status: 204, headers: NO_STORE });
const answered = <T>(answer: Answer<T>, ok: (value: T) => Response) =>
  "failure" in answer ? failureResponse(answer.failure) : ok(answer.value);

const decodeCreate = Schema.decodeUnknownOption(Schema.fromJsonString(CloudWorkspaceCreateRequest));
const decodeRename = Schema.decodeUnknownOption(Schema.fromJsonString(CloudWorkspaceRenameRequest));
const decodePreview = Schema.decodeUnknownOption(
  Schema.fromJsonString(CloudWorkspacePreviewRequest),
);
const decodeJoin = Schema.decodeUnknownOption(Schema.fromJsonString(CloudWorkspaceJoinRequest));
const decodeRole = Schema.decodeUnknownOption(Schema.fromJsonString(CloudWorkspaceRoleRequest));
const decodeOpen = Schema.decodeUnknownOption(Schema.fromJsonString(CloudWorkspaceOpenRequest));

export const workspaceOf = (env: WorkspaceEnv, id: string) =>
  env.WORKSPACES.get(env.WORKSPACES.idFromName(id));
const boardOf = (env: WorkspaceEnv, shareId: string) =>
  env.BOARDS.get(env.BOARDS.idFromName(shareId));
const indexOf = (env: WorkspaceEnv, account: string) =>
  env.ACCOUNTS.get(env.ACCOUNTS.idFromName(account));

interface WorkspaceRequestContext {
  /** The account the request is signed by, verified from its Clerk session by the Worker. */
  readonly account: () => Promise<string | RoomFailure>;
  readonly readBody: (maxBytes: number) => Promise<string | RoomFailure>;
}

/** Every `/workspaces` route. Only the preview of an invite link is read without signing in. */
export async function workspaceRoute(
  request: Request,
  env: WorkspaceEnv,
  url: URL,
  context: WorkspaceRequestContext,
): Promise<Response> {
  const path = url.pathname;
  const route = `${request.method} ${path}`;
  const body = async <T>(decode: (text: string) => Option.Option<T>) => {
    const text = await context.readBody(JSON_MAX_BODY_BYTES);
    if (typeof text !== "string") return text;
    return Option.getOrElse(decode(text), () => roomFailure("bad_request"));
  };
  const isFailure = (value: unknown): value is RoomFailure =>
    typeof value === "object" && value !== null && "status" in value && "reason" in value;

  if (route === `POST ${CLOUD_WORKSPACE_PREVIEW_ROUTE}`) {
    const preview = await body(decodePreview);
    if (isFailure(preview)) return failureResponse(preview);
    const id = shareOfSecret(preview.code);
    const shown = id === null ? null : await workspaceOf(env, id).preview(preview.code);
    return shown === null
      ? failureResponse(roomFailure("invalid", "This invite link is not valid. Ask for a new one."))
      : Response.json(shown satisfies CloudWorkspacePreview, { headers: NO_STORE });
  }

  const account = await context.account();
  if (typeof account !== "string") return failureResponse(account);
  const index = indexOf(env, account);

  if (route === `GET ${CLOUD_WORKSPACES_ROUTE}`) {
    const ids = await index.workspaces();
    const read = await Promise.all(ids.map((id) => workspaceOf(env, id).read(account)));
    // A workspace deleted, or one the account was taken out of, goes from its list here.
    const gone = ids.filter((_, at) => read[at] === null);
    if (gone.length > 0) await index.forgetWorkspaces(gone);
    const list: CloudWorkspaceList = { workspaces: read.filter((view) => view !== null) };
    return Response.json(list, { headers: NO_STORE });
  }
  if (route === `POST ${CLOUD_WORKSPACES_ROUTE}`) {
    const create = await body(decodeCreate);
    if (isFailure(create)) return failureResponse(create);
    const limit = env.CREATE_LIMITS.get(env.CREATE_LIMITS.idFromName(`workspace:${account}`));
    if (!(await limit.take(Date.now()))) return failureResponse(roomFailure("too_fast"));
    if ((await index.workspaces()).length >= CLOUD_WORKSPACES_PER_ACCOUNT) {
      return failureResponse(
        roomFailure("limit", "You are in as many workspaces as Tinkjam holds."),
      );
    }
    const id = crypto.randomUUID();
    const made = await workspaceOf(env, id).create({ id, account, ...create });
    if ("value" in made) await index.addWorkspace(id);
    return answered(made, (view) => Response.json(view, { headers: NO_STORE }));
  }
  if (route === `POST ${CLOUD_WORKSPACE_JOIN_ROUTE}`) {
    const join = await body(decodeJoin);
    if (isFailure(join)) return failureResponse(join);
    const id = shareOfSecret(join.code);
    if (id === null) {
      return failureResponse(
        roomFailure("invalid", "This invite link is not valid. Ask for a new one."),
      );
    }
    const ids = await index.workspaces();
    if (!ids.includes(id) && ids.length >= CLOUD_WORKSPACES_PER_ACCOUNT) {
      return failureResponse(
        roomFailure("limit", "You are in as many workspaces as Tinkjam holds."),
      );
    }
    const joined = await workspaceOf(env, id).join(account, join.code, join.profile);
    if ("value" in joined) await index.addWorkspace(id);
    return answered(joined, (view) => Response.json(view, { headers: NO_STORE }));
  }

  const workspaceId = url.searchParams.get(CLOUD_WORKSPACE_PARAM);
  if (!isShareId(workspaceId)) return failureResponse(roomFailure("bad_request"));
  const workspace = workspaceOf(env, workspaceId);
  switch (route) {
    case `POST ${CLOUD_WORKSPACE_ROUTE}`: {
      const change = await body(decodeRename);
      if (isFailure(change)) return failureResponse(change);
      return answered(await workspace.rename(account, change), noContent);
    }
    case `DELETE ${CLOUD_WORKSPACE_ROUTE}`: {
      const deleted = await workspace.remove(account);
      if ("value" in deleted) await index.forgetWorkspaces([workspaceId]);
      return answered(deleted, noContent);
    }
    case `POST ${CLOUD_WORKSPACE_INVITE_ROUTE}`:
      return answered(await workspace.invite(account, true), (invite) =>
        Response.json({ invite } as CloudWorkspaceInviteResult, { headers: NO_STORE }),
      );
    case `DELETE ${CLOUD_WORKSPACE_INVITE_ROUTE}`:
      return answered(await workspace.invite(account, false), noContent);
    case `POST ${CLOUD_WORKSPACE_LEAVE_ROUTE}`: {
      const left = await workspace.leave(account);
      if ("value" in left) await index.forgetWorkspaces([workspaceId]);
      return answered(left, noContent);
    }
  }
  if (path === CLOUD_WORKSPACE_MEMBER_ROUTE) {
    const memberId = url.searchParams.get(CLOUD_WORKSPACE_MEMBER_PARAM) ?? "";
    if (memberId === "") return failureResponse(roomFailure("bad_request"));
    if (request.method === "DELETE") {
      return answered(await workspace.removeMember(account, memberId), noContent);
    }
    if (request.method === "POST") {
      const role = await body(decodeRole);
      if (isFailure(role)) return failureResponse(role);
      return answered(await workspace.setRole(account, memberId, role.role), noContent);
    }
  }

  const shareId = url.searchParams.get(GUEST_SHARE_PARAM);
  if (!isShareId(shareId)) return failureResponse(roomFailure("bad_request"));
  const board = boardOf(env, shareId);
  switch (route) {
    case `POST ${CLOUD_WORKSPACE_BOARD_ROUTE}`: {
      const refused = await workspace.checkAdd(account, shareId);
      if (refused !== null) return failureResponse(refused);
      const placed = await board.placeInWorkspace({ account, into: workspaceId });
      if ("failure" in placed) return failureResponse(placed.failure);
      await workspace.addBoard(account, placed.value.board);
      if (placed.value.previous !== null && placed.value.previous !== workspaceId) {
        await workspaceOf(env, placed.value.previous).forgetBoard(shareId);
      }
      return noContent();
    }
    case `DELETE ${CLOUD_WORKSPACE_BOARD_ROUTE}`: {
      const role = await workspace.roleOf(account);
      if (role === null) return failureResponse(roomFailure("not_member"));
      const placed = await board.placeInWorkspace({
        account,
        outOf: workspaceId,
        owner: role === "owner",
      });
      if ("failure" in placed && placed.failure.reason !== "ended") {
        return failureResponse(placed.failure);
      }
      await workspace.forgetBoard(shareId);
      return noContent();
    }
    case `GET ${CLOUD_WORKSPACE_OUTLINE_ROUTE}`: {
      // As opening it: in the workspace now, and the workspace lists the board.
      if ((await workspace.roleOf(account)) === null) {
        return failureResponse(roomFailure("not_member"));
      }
      if (!(await workspace.hasBoard(shareId))) {
        return failureResponse(roomFailure("not_in_workspace"));
      }
      const outline = await board.outlineFor({ workspaceId });
      return outline === null
        ? failureResponse(roomFailure("not_in_workspace"))
        : Response.json(outline, { headers: NO_STORE });
    }
    case `POST ${CLOUD_WORKSPACE_OPEN_ROUTE}`: {
      const open = await body(decodeOpen);
      if (isFailure(open)) return failureResponse(open);
      // Being in the workspace now, and the workspace listing the board, is what opens it.
      if ((await workspace.roleOf(account)) === null) {
        return failureResponse(roomFailure("not_member"));
      }
      if (!(await workspace.hasBoard(shareId))) {
        return failureResponse(roomFailure("not_in_workspace"));
      }
      const opened = await board.openAsMember(account, workspaceId, open.name);
      if ("failure" in opened) {
        const reason = opened.failure.reason;
        if (reason === "ended" || reason === "not_in_workspace") {
          await workspace.forgetBoard(shareId);
        }
        return failureResponse(opened.failure);
      }
      await index.add([opened.value.board]);
      return Response.json(opened.value satisfies CloudBoardAccountOpenResult, {
        headers: NO_STORE,
      });
    }
  }
  return failureResponse(roomFailure("unavailable"));
}
