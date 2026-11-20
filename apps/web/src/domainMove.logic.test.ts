import { describe, expect, it } from "vite-plus/test";

import { mergeMovedShares, moveStep, packMove, unpackMove } from "./domainMove.logic";

const NEW = "https://app.tinkjam.com";
const OLD = "https://app.trellium.org";
const SHARES = "t3code:guest-shares:v1";

const share = (shareId: string, extra: Record<string, unknown> = {}) => ({
  host: "boards.trellium.org",
  shareId,
  threadId: `thread-${shareId}`,
  token: `token-${shareId}`,
  title: "Plän ✏️",
  joinedAt: "2026-11-01T00:00:00.000Z",
  ...extra,
});

const step = (over: Partial<Parameters<typeof moveStep>[0]>) =>
  moveStep({
    origin: NEW,
    current: NEW,
    origins: [NEW, OLD],
    path: "/guest",
    search: "?host=boards.tinkjam.com",
    hash: "#invite",
    referrer: "",
    moved: false,
    asked: false,
    canStore: true,
    framed: false,
    now: Date.UTC(2026, 10, 20),
    read: () => null,
    cookie: "",
    ...over,
  });

describe("moving between our domains", () => {
  it("hands over signed-out boards and small choices, and the link's own fragment", () => {
    const stored: Record<string, string> = {
      [SHARES]: JSON.stringify([share("a"), share("mine", { accountId: "user_1" })]),
      "t3code:theme": "dark",
      "t3code:composer-drafts:v1": "private",
    };
    const sent = step({
      origin: OLD,
      read: (key) => stored[key] ?? null,
      cookie: "x=1; __clerk_db_jwt_ab12=dev.jwt=",
    });
    if (sent.kind !== "go") throw new Error("expected the older address to leave");
    const url = new URL(sent.href);
    expect(url.origin).toBe(NEW);
    expect(url.pathname).toBe("/guest");
    expect(url.searchParams.get("host")).toBe("boards.tinkjam.com");
    expect(url.searchParams.get("__clerk_db_jwt")).toBe("dev.jwt=");
    const payload = unpackMove(url.hash);
    expect(payload?.hash).toBe("#invite");
    expect(payload?.kept).toEqual({ "t3code:theme": "dark" });
    expect(JSON.parse(payload?.shares ?? "[]")).toEqual([share("a")]);

    // The current address takes it only from our older one, once.
    const arrive = (over: Partial<Parameters<typeof moveStep>[0]>) =>
      step({ search: url.search, hash: url.hash, ...over });
    expect(arrive({ referrer: `${OLD}/` })).toEqual({
      kind: "arrived",
      href: `/guest${url.search}#invite`,
      payload,
      done: true,
    });
    const plain = "/guest?host=boards.tinkjam.com#invite";
    for (const [over, done] of [
      [{ referrer: `${OLD}/`, moved: true }, true],
      [{ referrer: "" }, true],
      [{ referrer: "https://evil.test/" }, false],
      [{ referrer: `${OLD}.evil.test/` }, false],
    ] as const) {
      expect(arrive(over), JSON.stringify(over)).toEqual({
        kind: "arrived",
        href: plain,
        payload: null,
        done,
      });
    }
  });

  it("asks the older address once per browser, and only from the app's own pages", () => {
    expect(step({})).toEqual({
      kind: "go",
      href: `${OLD}/guest?host=boards.tinkjam.com#invite`,
      asking: true,
    });
    for (const over of [
      { moved: true },
      { asked: true },
      { canStore: false },
      { framed: true },
      { now: Date.UTC(2027, 5, 1) },
      { origin: "http://localhost:5733" },
      { origins: [NEW] },
    ]) {
      expect(step(over), JSON.stringify(over)).toEqual({ kind: "stay" });
    }
    expect(unpackMove("#moved=not-json")).toBeNull();
    expect(unpackMove(packMove({ read: () => "{", hash: "" }))?.shares).toBe("[]");
  });

  it("takes in handed-over boards without replacing its own or following a strange host", () => {
    const own = [{ ...share("a"), host: "boards.tinkjam.com", token: "kept" }];
    const hostOf = (host: string) => (host === "boards.trellium.org" ? "boards.tinkjam.com" : null);
    expect(
      mergeMovedShares(own, [share("a"), share("b"), share("c", { host: "evil.test" })], hostOf),
    ).toEqual([own[0], { ...share("b"), host: "boards.tinkjam.com" }]);
    expect(mergeMovedShares(own, [share("a")], hostOf)).toBe(own);
  });
});
