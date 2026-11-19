import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { describe, expect, it } from "vite-plus/test";

import {
  CLOUD_BOARD_PATH,
  cloudBoardRouteParams,
  cloudBoardShareIdOf,
  isSharedThreadPathname,
  sharedThreadLocationOf,
} from "./boardAddress";

const SHARE_ID = "1ecbf7b4-8fc3-46f8-8a5c-8a683e311029";
const LONG = { environmentId: `guest-share-${SHARE_ID}`, threadId: `board-${SHARE_ID}` };

function boardRouter(initialEntry: string) {
  const root = createRootRoute();
  const layout = createRoute({ getParentRoute: () => root, id: "_chat" });
  const thread = createRoute({ getParentRoute: () => layout, path: "/$environmentId/$threadId" });
  const board = createRoute({
    getParentRoute: () => layout,
    path: CLOUD_BOARD_PATH,
    params: {
      parse: ({ shareId }) => cloudBoardRouteParams(shareId),
      stringify: ({ shareId }) => ({ shareId }),
    },
  });
  return createRouter({
    routeTree: root.addChildren([layout.addChildren([thread, board])]),
    history: createMemoryHistory({ initialEntries: [initialEntry] }),
  });
}

describe("cloud board address", () => {
  it("reads the share out of a board's long address", () => {
    expect(cloudBoardShareIdOf(LONG)).toBe(SHARE_ID);
  });

  it("names the same thread at the short address as at the long one", () => {
    const { shareId, ...thread } = cloudBoardRouteParams(SHARE_ID);
    expect(shareId).toBe(SHARE_ID);
    expect(thread).toEqual(LONG);
    expect(cloudBoardShareIdOf(thread)).toBe(SHARE_ID);
  });

  it("leaves every other address alone", () => {
    // A thread on someone's computer, shared: its share and its thread have different ids.
    expect(cloudBoardShareIdOf({ ...LONG, threadId: "thread-on-a-computer" })).toBeNull();
    expect(cloudBoardShareIdOf({ ...LONG, threadId: "board-another-share" })).toBeNull();
    expect(cloudBoardShareIdOf({ environmentId: "local", threadId: LONG.threadId })).toBeNull();
    expect(cloudBoardShareIdOf({ environmentId: "guest-share-", threadId: "board-" })).toBeNull();
    expect(cloudBoardShareIdOf({})).toBeNull();
  });

  it("opens only a share on the cloud host at the short address", () => {
    const board = { shareId: SHARE_ID, threadId: LONG.threadId };
    const long = { to: "/$environmentId/$threadId", params: LONG };
    expect(sharedThreadLocationOf(board, true)).toEqual({
      to: "/b/$shareId",
      params: { shareId: SHARE_ID, ...LONG },
    });
    // The same ids from any other host are not a cloud board.
    expect(sharedThreadLocationOf(board, false)).toEqual(long);
    expect(sharedThreadLocationOf({ shareId: SHARE_ID, threadId: "thread-1" }, true)).toEqual({
      to: "/$environmentId/$threadId",
      params: { environmentId: guestEnvironmentId(SHARE_ID), threadId: "thread-1" },
    });
  });

  it("knows the pages a guest may load first", () => {
    expect(isSharedThreadPathname(`/b/${SHARE_ID}`)).toBe(true);
    expect(isSharedThreadPathname(`/${LONG.environmentId}/${LONG.threadId}`)).toBe(true);
    expect(isSharedThreadPathname("/b")).toBe(false);
    expect(isSharedThreadPathname("/local/thread-1")).toBe(false);
    expect(isSharedThreadPathname("/board/local/thread-1")).toBe(false);
  });

  it("gives the layout above the short address the thread's params", async () => {
    const router = boardRouter(`/b/${SHARE_ID}`);
    await router.load();
    expect(router.state.location.pathname).toBe(`/b/${SHARE_ID}`);
    for (const match of router.state.matches) expect(match.params).toMatchObject(LONG);
  });

  it("builds the short address and still matches the long one", async () => {
    const router = boardRouter(`/${LONG.environmentId}/${LONG.threadId}`);
    await router.load();
    expect(router.state.matches.at(-1)?.params).toEqual(LONG);
    const location = sharedThreadLocationOf({ shareId: SHARE_ID, threadId: LONG.threadId }, true);
    expect(router.buildLocation(location).pathname).toBe(`/b/${SHARE_ID}`);
  });
});
