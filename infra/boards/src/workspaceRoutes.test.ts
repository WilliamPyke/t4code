import {
  CLOUD_WORKSPACES_ROUTE,
  CLOUD_WORKSPACE_BOARD_ROUTE,
  CLOUD_WORKSPACE_INVITE_ROUTE,
  CLOUD_WORKSPACE_JOIN_ROUTE,
  CLOUD_WORKSPACE_MEMBER_ROUTE,
  CLOUD_WORKSPACE_OPEN_ROUTE,
  CLOUD_WORKSPACE_OUTLINE_ROUTE,
  CLOUD_WORKSPACE_PREVIEW_ROUTE,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { roomFailure, type RoomFailure } from "./room.ts";
import { workspaceRoute, type WorkspaceEnv } from "./workspaceRoutes.ts";

const HOST = "https://boards.example";
const CODE = "ws-one-0000.code";

/** Objects that record who asked what, standing in for the Durable Objects. */
function setup(members: ReadonlyArray<string>) {
  const calls: Array<string> = [];
  const namespace = (make: (name: string) => object) => ({
    idFromName: (name: string) => name,
    get: (name: string) => make(name),
  });
  const env = {
    WORKSPACES: namespace((id) => ({
      preview: async (code: string) =>
        code === CODE ? { id, name: "Acme", color: "blue", members: members.length } : null,
      roleOf: async (account: string) => {
        calls.push(`roleOf ${account}`);
        return members.includes(account) ? "member" : null;
      },
      hasBoard: async () => true,
      forgetBoard: async () => undefined,
      read: async (account: string) => {
        calls.push(`read ${account}`);
        return null;
      },
    })),
    BOARDS: namespace(() => ({
      openAsMember: async (account: string, workspaceId: string, name: string) => {
        calls.push(`open ${account} ${workspaceId} ${name}`);
        return { failure: roomFailure("ended") };
      },
      outlineFor: async (reader: object) => {
        calls.push(`outline ${JSON.stringify(reader)}`);
        return { items: [{ id: "a1", kind: "artifact", name: "Pricing page" }] };
      },
    })),
    ACCOUNTS: namespace((account) => ({
      workspaces: async () => {
        calls.push(`workspaces ${account}`);
        return [];
      },
      forgetWorkspaces: async () => undefined,
      add: async () => [],
    })),
    CREATE_LIMITS: namespace(() => ({ take: async () => true })),
  } as unknown as WorkspaceEnv;
  const send = (account: string | RoomFailure, method: string, path: string, body?: unknown) => {
    const url = new URL(path, HOST);
    const request = new Request(url, {
      method,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return workspaceRoute(request, env, url, {
      account: async () => account,
      readBody: async () => request.text(),
    });
  };
  return { calls, send };
}

const scoped = (path: string) => `${path}?workspace=ws-one-0000&share=share-one-0000`;

describe("workspace routes", () => {
  it("refuses every route signed out, before asking anything, but an invite's preview", async () => {
    const { calls, send } = setup(["user_ada"]);
    const signedOut = roomFailure("signed_out");
    const routes: ReadonlyArray<readonly [string, string, unknown?]> = [
      ["GET", CLOUD_WORKSPACES_ROUTE],
      ["POST", CLOUD_WORKSPACES_ROUTE, { name: "Acme", color: "blue", profile: { name: "Eve" } }],
      ["POST", CLOUD_WORKSPACE_JOIN_ROUTE, { code: CODE, profile: { name: "Eve" } }],
      ["POST", scoped(CLOUD_WORKSPACE_OPEN_ROUTE), { name: "Eve" }],
      ["GET", scoped(CLOUD_WORKSPACE_OUTLINE_ROUTE)],
      ["POST", scoped(CLOUD_WORKSPACE_BOARD_ROUTE)],
      ["POST", scoped(CLOUD_WORKSPACE_INVITE_ROUTE)],
      ["DELETE", `${CLOUD_WORKSPACE_MEMBER_ROUTE}?workspace=ws-one-0000&member=m-ada`],
    ];
    for (const [method, path, body] of routes) {
      expect((await send(signedOut, method, path, body)).status).toBe(401);
    }
    expect(calls).toEqual([]);
    const preview = await send(signedOut, "POST", CLOUD_WORKSPACE_PREVIEW_ROUTE, { code: CODE });
    expect(await preview.json()).toMatchObject({ name: "Acme", members: 1 });
    const guessed = await send(signedOut, "POST", CLOUD_WORKSPACE_PREVIEW_ROUTE, {
      code: "ws-one-0000.guess",
    });
    expect(guessed.status).toBe(403);
  });

  it("opens a board only as the verified account, and only while it is in the workspace", async () => {
    const { calls, send } = setup(["user_ada"]);
    // Naming someone else in the request changes nothing: the session says who is asking.
    const body = { name: "Ada", account: "user_grace" };
    await send(
      "user_ada",
      "POST",
      `${scoped(CLOUD_WORKSPACE_OPEN_ROUTE)}&account=user_grace`,
      body,
    );
    expect(calls).toEqual(["roleOf user_ada", "open user_ada ws-one-0000 Ada"]);
    calls.length = 0;
    const outsider = await send("user_eve", "POST", scoped(CLOUD_WORKSPACE_OPEN_ROUTE), body);
    expect(outsider.status).toBe(403);
    expect(calls).toEqual(["roleOf user_eve"]);
  });

  it("names what is on a board to a member, and asks the board nothing for anyone else", async () => {
    const { calls, send } = setup(["user_ada"]);
    const read = await send("user_ada", "GET", scoped(CLOUD_WORKSPACE_OUTLINE_ROUTE));
    expect(await read.json()).toEqual({
      items: [{ id: "a1", kind: "artifact", name: "Pricing page" }],
    });
    expect(calls).toEqual(["roleOf user_ada", 'outline {"workspaceId":"ws-one-0000"}']);
    calls.length = 0;
    const outsider = await send("user_eve", "GET", scoped(CLOUD_WORKSPACE_OUTLINE_ROUTE));
    expect(outsider.status).toBe(403);
    expect(calls).toEqual(["roleOf user_eve"]);
  });
});
