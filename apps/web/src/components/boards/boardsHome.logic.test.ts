import {
  GuestId,
  GuestShareId,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_THREAD_CARD,
  type RoomBoard,
  ThreadId,
  roomBoardCardRef,
} from "@t3tools/contracts";
import { EMPTY_ROOM_BOARD, applyRoomBoardChange } from "@t3tools/shared/roomBoard";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  BLANK_BOARD_TEMPLATE,
  BOARD_TEMPLATES,
  boardTemplateChanges,
  boardTemplateShapes,
  cloudBoardTemplateChanges,
  STARTER_BOARD_TEMPLATES,
} from "./boardTemplates";
import {
  type HomeBoardSort,
  type NewBoardPlace,
  type OwnBoardSource,
  boardOutlineShown,
  boardPaint,
  boardThumbnail,
  boardTimeLabel,
  boardsInScope,
  homeContent,
  homeIsFocused,
  sortHomeBoards,
  joinedBoardSources,
  listHomeBoards,
  newBoardProject,
  newBoardProjectKey,
  newBoardStart,
  newCloudBoardAgent,
  teamBoardShapes,
  withWorkspaceBoards,
} from "./boardsHome.logic";
import { boardCardBox, boardConnector } from "../room/roomBoard.logic";

const NOW_ISO = "2026-11-17T00:00:00.000Z";

const thread = (id: string, extra: Partial<OwnBoardSource> = {}): OwnBoardSource => ({
  environmentId: "env-a",
  id,
  projectId: "project-1",
  title: id,
  updatedAt: "2026-11-10T00:00:00.000Z",
  latestUserMessageAt: null,
  archivedAt: null,
  deletedAt: null,
  hasRoomBoard: true,
  ...extra,
});

describe("listHomeBoards", () => {
  it("lists own and joined boards by latest activity, then teams, and leaves out the rest", () => {
    const boards = listHomeBoards({
      threads: [
        thread("old"),
        thread("talked-to", { latestUserMessageAt: "2026-11-12T00:00:00.000Z" }),
        thread("shared", {
          hasRoomBoard: false,
          guestShared: true,
          updatedAt: "2026-11-11T00:00:00.000Z",
        }),
        thread("no-board", { hasRoomBoard: false, updatedAt: "2026-11-13T00:00:00.000Z" }),
        thread("archived", { archivedAt: "2026-11-12T00:00:00.000Z" }),
        thread("mirror", { environmentId: "guest:share-1" }),
        thread("untitled", { title: "  ", updatedAt: "2026-11-01T00:00:00.000Z" }),
      ],
      joined: [
        {
          shareId: "share-1",
          threadId: "t",
          title: "Theirs",
          joinedAt: "2026-11-11T12:00:00.000Z",
        },
      ],
      teams: [{ id: "team-1", name: "Design" }],
      isOwnEnvironment: (environmentId) => !environmentId.startsWith("guest:"),
    });
    expect(boards.map((board) => board.title)).toEqual([
      "talked-to",
      "Theirs",
      "shared",
      "old",
      "Untitled board",
      "Design",
    ]);
  });

  it("keeps boards whose name, project or owner matches the search", () => {
    const boards = listHomeBoards({
      threads: [thread("Roadmap"), thread("Other", { projectId: "project-2" })],
      joined: [
        {
          shareId: "s",
          threadId: "t",
          title: "Sprint",
          owner: "Ada",
          joinedAt: "2026-11-11T00:00:00.000Z",
        },
      ],
      teams: [],
      isOwnEnvironment: () => true,
      projectName: (_environmentId, projectId) => (projectId === "project-2" ? "Website" : "App"),
      query: " web",
    });
    expect(boards.map((board) => board.title)).toEqual(["Other"]);
    const byOwner = listHomeBoards({
      threads: [thread("Roadmap")],
      joined: [
        {
          shareId: "s",
          threadId: "t",
          title: "Sprint",
          owner: "Ada",
          joinedAt: "2026-11-11T00:00:00.000Z",
        },
      ],
      teams: [],
      isOwnEnvironment: () => true,
      query: "ada",
    });
    expect(byOwner.map((board) => board.title)).toEqual(["Sprint"]);
  });

  it("adds the signed-in account's boards this browser has no session on, marking those shared", () => {
    const local = [
      { shareId: "here", threadId: "t-here", title: "Here", joinedAt: NOW_ISO, cloud: true },
      { shareId: "machine", threadId: "t-m", title: "Machine", joinedAt: NOW_ISO },
      {
        shareId: "made-here",
        threadId: "t-mh",
        title: "Made here",
        joinedAt: "2026-11-01T00:00:00.000Z",
        // Opened since it was made, so it lists by then.
        openedAt: "2026-11-18T00:00:00.000Z",
        cloud: true,
        maker: true,
      },
    ];
    const account = (shareId: string, maker: boolean) => ({
      shareId: GuestShareId.make(shareId),
      threadId: ThreadId.make(`t-${shareId}`),
      title: shareId,
      guestId: GuestId.make("g"),
      maker,
      addedAt: NOW_ISO,
    });
    // Signed out: exactly this browser's boards.
    expect(joinedBoardSources({ local, listed: null })).toBe(local);
    const boards = listHomeBoards({
      threads: [],
      joined: joinedBoardSources({
        local,
        listed: [account("here", false), account("elsewhere", true)],
      }),
      teams: [],
      isOwnEnvironment: () => true,
    });
    expect(
      boards.map((board) =>
        board.kind === "joined" ? [board.shareId, board.shared, board.remote, board.maker] : null,
      ),
    ).toEqual([
      ["made-here", false, false, true],
      ["here", true, false, false],
      ["machine", false, false, false],
      ["elsewhere", false, true, true],
    ]);
    // The host's preview shows everyone's changes, so it wins over this browser's own.
    const previews = joinedBoardSources({
      local: [
        { ...local[0]!, preview: "1:here" },
        { ...local[1]!, preview: "1:machine" },
      ],
      listed: [{ ...account("here", false), preview: "1:host" }, account("elsewhere", true)],
    }).map((board) => [board.shareId, board.preview]);
    expect(previews).toEqual([
      ["here", "1:host"],
      ["machine", "1:machine"],
      ["elsewhere", undefined],
    ]);
  });

  it("lists each workspace's boards, opened here or not, and shows one scope at a time", () => {
    const joined = withWorkspaceBoards(
      [
        { shareId: "mine", threadId: "t-mine", title: "Mine", joinedAt: NOW_ISO, cloud: true },
        { shareId: "team-here", threadId: "t-th", title: "Here", joinedAt: NOW_ISO, cloud: true },
      ],
      [
        {
          id: "ws-acme",
          name: "Acme",
          boards: [
            { shareId: "team-here", threadId: "t-th", title: "Here", addedAt: NOW_ISO },
            { shareId: "team-new", threadId: "t-tn", title: "Roadmap", addedAt: NOW_ISO },
          ],
        },
      ],
    );
    const boards = listHomeBoards({
      threads: [thread("On my computer")],
      joined,
      teams: [],
      isOwnEnvironment: () => true,
    });
    const shown = (scope: string, query?: string) =>
      boardsInScope(
        query === undefined
          ? boards
          : listHomeBoards({ threads: [], joined, teams: [], isOwnEnvironment: () => true, query }),
        scope,
      ).map((board) =>
        board.kind === "joined" ? [board.title, board.workspaceName, board.remote] : [board.title],
      );
    expect(shown("ws-acme")).toEqual([
      ["Here", "Acme", false],
      ["Roadmap", "Acme", true],
    ]);
    expect(shown("personal")).toEqual([["Mine", null, false], ["On my computer"]]);
    expect(shown("all")).toHaveLength(4);
    expect(shown("ws-other")).toEqual([]);
    // Search finds boards by their workspace's name too.
    expect(shown("all", "acme").map(([title]) => title)).toEqual(["Here", "Roadmap"]);
  });
});

describe("the home's order and what it shows", () => {
  const boards = listHomeBoards({
    threads: [
      thread("zeta", {
        createdAt: "2026-10-01T00:00:00.000Z",
        updatedAt: "2026-11-02T00:00:00.000Z",
        // Opened most recently of all, though it changed long ago.
        lastVisitedAt: "2026-11-16T00:00:00.000Z",
      }),
    ],
    joined: [
      {
        shareId: "alpha",
        threadId: "t-a",
        title: "Alpha",
        joinedAt: "2026-11-05T00:00:00.000Z",
        openedAt: "2026-11-15T00:00:00.000Z",
      },
      { shareId: "beta", threadId: "t-b", title: "beta 10", joinedAt: "2026-11-10T00:00:00.000Z" },
      { shareId: "gamma", threadId: "t-g", title: "Beta 9", joinedAt: "2026-11-10T00:00:00.000Z" },
    ],
    teams: [{ id: "team-1", name: "Design" }],
    isOwnEnvironment: () => true,
  });
  const titles = (sort: HomeBoardSort) => sortHomeBoards(boards, sort).map((board) => board.title);

  it("sorts by last opened, by name, or newest first, with untimed boards last", () => {
    expect(titles("recent")).toEqual(["zeta", "Alpha", "Beta 9", "beta 10", "Design"]);
    // Names compare without case, and numbers as numbers.
    expect(titles("name")).toEqual(["Alpha", "Beta 9", "beta 10", "Design", "zeta"]);
    expect(titles("created")).toEqual(["Beta 9", "beta 10", "Alpha", "zeta", "Design"]);
  });

  it("never shows the welcome while the person's boards may still be on their way", () => {
    const shows = (boards: number, machinesLoaded: boolean, accountLoaded: boolean) =>
      homeContent({ boards, workspaces: 0, machinesLoaded, accountLoaded });
    expect(shows(0, true, false)).toBe("loading");
    expect(shows(0, false, true)).toBe("loading");
    expect(shows(0, true, true)).toBe("welcome");
    // Boards this browser already has show at once; the account's join them as they arrive.
    expect(shows(2, false, false)).toBe("boards");
    expect(
      homeContent({ boards: 0, workspaces: 1, machinesLoaded: true, accountLoaded: true }),
    ).toBe("boards");
    // Signing in from the welcome keeps its form up until the account's boards say otherwise.
    const signingIn = { workspaces: 0, machinesLoaded: true, accountLoaded: false, welcomed: true };
    expect(homeContent({ ...signingIn, boards: 0 })).toBe("welcome");
    expect(homeContent({ ...signingIn, boards: 1 })).toBe("boards");
    // The first board made from the welcome: it stays put until the board's page takes over.
    expect(homeContent({ ...signingIn, boards: 1, leaving: true })).toBe("welcome");
    expect(homeContent({ ...signingIn, boards: 1, welcomed: false, leaving: true })).toBe("boards");
  });

  it("gives the home the window to itself until it has boards, only where that is offered", () => {
    const focused = (shown: "boards" | "loading" | "welcome" | null, pathname = "/") =>
      homeIsFocused({ offered: true, pathname, shown });
    expect(focused("welcome")).toBe(true);
    // Before the home has shown anything, so the sidebar never stands beside the welcome first.
    expect(focused(null)).toBe(true);
    expect(focused("loading")).toBe(true);
    expect(focused("boards")).toBe(false);
    expect(focused("welcome", "/settings/general")).toBe(false);
    // Desktop, a person's own server, and Advanced keep their sidebar.
    expect(homeIsFocused({ offered: false, pathname: "/", shown: "welcome" })).toBe(false);
  });

  it("says when in words", () => {
    const now = Date.parse("2026-11-17T15:00:00.000Z");
    const label = (iso: string) => boardTimeLabel(iso, now);
    expect(label("2026-11-17T14:59:30.000Z")).toBe("Just now");
    expect(label("2026-11-17T14:59:00.000Z")).toBe("1 minute ago");
    expect(label("2026-11-17T13:00:00.000Z")).toBe("2 hours ago");
    expect(label("2026-11-16T09:00:00.000Z")).toBe("Yesterday");
    expect(label("2026-11-12T09:00:00.000Z")).toBe("5 days ago");
    expect(label("2026-10-27T09:00:00.000Z")).toBe("3 weeks ago");
    expect(label("2026-03-04T09:00:00.000Z")).toBe("Mar 4");
    expect(label("2025-03-04T09:00:00.000Z")).toBe("Mar 4, 2025");
    expect(label("not a date")).toBeNull();
  });

  it("gives a workspace's boards its colour, and every other board a steady one of its own", () => {
    expect(boardPaint({ key: "joined:a", workspaceColor: "pink" })).toBe("pink");
    expect(boardPaint({ key: "joined:a" })).toBe(
      boardPaint({ key: "joined:a", workspaceColor: null }),
    );
  });
});

describe("boardThumbnail", () => {
  it("fits the cards into the frame, centred, keeping their proportions", () => {
    const rects = boardThumbnail(
      [
        { x: 100, y: 100, w: 200, h: 100, kind: "note" },
        { x: 500, y: 200, w: 100, h: 100, kind: "thread" },
      ],
      { width: 120, height: 120, padding: 10 },
    );
    // The board spans 500 by 200; 100 wide inside the padding gives a scale of 0.2, centred down.
    expect(rects).toEqual([
      { x: 10, y: 40, width: 40, height: 20, kind: "note", color: undefined },
      { x: 90, y: 60, width: 20, height: 20, kind: "thread", color: undefined },
    ]);
  });

  it("draws nothing for an empty board, and never a card too small to see", () => {
    expect(boardThumbnail([], { width: 100, height: 60, padding: 4 })).toEqual([]);
    const [tiny] = boardThumbnail(
      [
        { x: 0, y: 0, w: 10_000, h: 10_000, kind: "section" },
        { x: 0, y: 0, w: 1, h: 1, kind: "comment" },
      ],
      { width: 100, height: 100, padding: 0 },
    ).slice(1);
    expect(tiny).toMatchObject({ width: 2, height: 2 });
  });

  it("draws a team board from its notes and cards, sections behind, reply comments left out", () => {
    const board: RoomBoard = {
      ...EMPTY_ROOM_BOARD,
      positions: { "thread:a": { x: 0, y: 0 } },
      sizes: { "thread:a": { w: 400, h: 300 } },
      notes: [
        { id: "n", text: "Idea", x: 500, y: 0, color: "pink" },
        { id: "s", text: "Plan", x: -50, y: -50, section: true, size: { w: 900, h: 500 } },
        { id: "c", text: "On a reply", x: 0, y: 0, kind: "comment", pinnedTo: "message-1" },
      ],
    };
    expect(teamBoardShapes(board).map(({ kind, w, h }) => ({ kind, w, h }))).toEqual([
      { kind: "section", w: 900, h: 500 },
      { kind: "card", w: 400, h: 300 },
      { kind: "note", w: 192, h: 144 },
    ]);
    expect(teamBoardShapes(board)[2]).toMatchObject({ color: "pink" });
  });
});

describe("newBoardProject", () => {
  const a = { environmentId: "env-a", id: "project-1" };
  const b = { environmentId: "env-a", id: "project-2" };
  const archived = {
    environmentId: "env-b",
    id: "project-3",
    archivedAt: "2026-11-01T00:00:00.000Z",
  };
  const boards = listHomeBoards({
    threads: [thread("recent", { projectId: "project-2" })],
    joined: [],
    teams: [],
    isOwnEnvironment: () => true,
  });

  it("uses the only open project, says when there is none, and asks with no default", () => {
    expect(newBoardProject({ projects: [archived], boards: [], lastUsed: null })).toEqual({
      kind: "none",
    });
    expect(newBoardProject({ projects: [a, archived], boards: [], lastUsed: null })).toEqual({
      kind: "use",
      project: a,
    });
    expect(newBoardProject({ projects: [a, b], boards: [], lastUsed: null })).toEqual({
      kind: "ask",
    });
  });

  it("prefers the last new board's project, then the most recent board's", () => {
    expect(newBoardProject({ projects: [a, b], boards, lastUsed: newBoardProjectKey(a) })).toEqual({
      kind: "use",
      project: a,
    });
    expect(newBoardProject({ projects: [a, b], boards, lastUsed: "env-x:gone" })).toEqual({
      kind: "use",
      project: b,
    });
  });
});

describe("newBoardStart", () => {
  const a = { environmentId: "env-a", id: "project-1" };
  const b = { environmentId: "env-b", id: "project-2" };
  const start = (
    operable: ReadonlyArray<string>,
    cloud: boolean,
    connecting: ReadonlyArray<string> = [],
    waited = false,
    place: NewBoardPlace = "machine",
  ) =>
    newBoardStart({
      projects: [a, b],
      boards: [],
      lastUsed: null,
      operable: new Set(operable),
      connecting: new Set(connecting),
      waited,
      cloud,
      place,
    });

  it("goes to the cloud unless the person last chose their computer", () => {
    // No question and no wait for machines: the cloud is the default place.
    expect(start(["env-a", "env-b"], true, ["env-c"], false, "cloud")).toEqual({ kind: "cloud" });
    // A template the cloud cannot take, or no cloud host, goes on a machine.
    expect(start(["env-b"], false, [], false, "cloud")).toEqual({ kind: "use", project: b });
  });

  it("on their computer, goes to the cloud only when no machine can take a board", () => {
    expect(start([], true)).toEqual({ kind: "cloud" });
    // Without a cloud host it fails on a machine as before, where the toast says why.
    expect(start([], false)).toEqual({ kind: "ask" });
    // A machine that can is used, and a disconnected one's projects are not offered.
    expect(start(["env-b"], true)).toEqual({ kind: "use", project: b });
    expect(start(["env-a", "env-b"], true)).toEqual({ kind: "ask" });
    expect(start(["env-c"], true)).toEqual({ kind: "none" });
  });

  it("waits for a machine still connecting before choosing the cloud", () => {
    expect(start([], true, ["env-a"])).toEqual({ kind: "wait" });
    expect(start([], false, ["env-a"])).toEqual({ kind: "wait" });
    // Still not ready after the wait: the cloud, as with no machine at all.
    expect(start([], true, ["env-a"], true)).toEqual({ kind: "cloud" });
    // One ready machine is enough; the other is not waited for.
    expect(start(["env-b"], true, ["env-a"])).toEqual({ kind: "use", project: b });
  });
});

describe("newCloudBoardAgent", () => {
  const a1 = { environmentId: "env-a", id: "project-1" };
  const a2 = { environmentId: "env-a", id: "project-2" };
  const b = { environmentId: "env-b", id: "project-3" };
  const agent = (operable: ReadonlyArray<string>, lastUsed: string | null = null) =>
    newCloudBoardAgent({
      projects: [a1, a2, b],
      boards: [],
      lastUsed,
      operable: new Set(operable),
    });

  it("brings the only machine that may, in the project a machine board would use", () => {
    expect(agent(["env-a"], "env-a:project-2")).toEqual({ environmentId: "env-a", project: a2 });
    // The project last used is on another machine, or there is no telling: no project.
    expect(agent(["env-a"], "env-b:project-3")).toEqual({ environmentId: "env-a", project: null });
    expect(agent(["env-b"])).toEqual({ environmentId: "env-b", project: b });
    expect(agent(["env-c"])).toEqual({ environmentId: "env-c", project: null });
  });

  it("leaves the choice to the person with no machine or several", () => {
    expect(agent([])).toBeNull();
    expect(agent(["env-a", "env-b"])).toBeNull();
  });
});

describe("cloud board templates", () => {
  it("takes the templates that do not need the board's own thread box, and leaves it out", () => {
    const fits = BOARD_TEMPLATES.filter(
      (template) => cloudBoardTemplateChanges(template, () => "id") !== null,
    ).map((template) => template.id);
    expect(fits).toContain(BLANK_BOARD_TEMPLATE.id);
    // Their own thread boxes run on the agent their maker brings to the board.
    expect(fits).toEqual([
      "blank",
      "project-kickoff",
      "research-agents",
      "build-agents",
      "design-review",
      "retro",
    ]);
    // Every template a first board is offered works in the cloud.
    for (const template of STARTER_BOARD_TEMPLATES) expect(fits).toContain(template.id);
    for (const template of BOARD_TEMPLATES) {
      const changes = cloudBoardTemplateChanges(template, () => "id") ?? [];
      expect(changes.filter((change) => change.type === "card.move")).toEqual([]);
      expect(
        changes.filter(
          (change) =>
            change.type === "edge.put" &&
            [change.from, change.to].includes(roomBoardCardRef(ROOM_BOARD_THREAD_CARD)),
        ),
      ).toEqual([]);
    }
  });
});

describe("board templates", () => {
  const scope = {
    hasCard: (cardId: string) => cardId === ROOM_BOARD_THREAD_CARD,
    hasPerson: () => false,
  };

  it.each(BOARD_TEMPLATES.map((template) => [template.name, template] as const))(
    "%s lays out cleanly on a new board, within its limits",
    (_name, template) => {
      let next = 0;
      const changes = boardTemplateChanges(template, () => `id-${(next += 1)}`);
      const board = changes.reduce<RoomBoard>((current, change) => {
        const after = Result.getOrThrow(
          applyRoomBoardChange(current, scope, null, change, "2026-11-14T00:00:00.000Z"),
        );
        expect(after).not.toBe(current);
        return after;
      }, EMPTY_ROOM_BOARD);
      const noteIds = board.notes.map((note) => note.id);
      const edgeIds = (board.edges ?? []).map((edge) => edge.id);
      expect(new Set([...noteIds, ...edgeIds]).size).toBe(noteIds.length + edgeIds.length);
      expect(board.notes).toHaveLength(template.items.length);
      expect(board.notes.length).toBeLessThanOrEqual(ROOM_BOARD_MAX_NOTES);
      expect(board.edges ?? []).toHaveLength(template.lines.length);
      expect(board.positions[ROOM_BOARD_THREAD_CARD]).toEqual(template.thread);
      // Its thread boxes start empty, with no model picked: the default applies when first used.
      for (const box of board.notes.filter((note) => note.kind === "thread")) {
        expect(box.boxModel).toBeUndefined();
        expect(box.thread).toBeUndefined();
      }
      const shapes = boardTemplateShapes(template);
      expect(shapes).toHaveLength(template.items.length + 1);
      // Nothing overlaps, but a card wholly inside its section.
      const meet = (a: (typeof shapes)[number], b: (typeof shapes)[number]) =>
        a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
      const inside = (a: (typeof shapes)[number], b: (typeof shapes)[number]) =>
        a.x >= b.x && a.y >= b.y && a.x + a.w <= b.x + b.w && a.y + a.h <= b.y + b.h;
      for (const [index, shape] of shapes.entries()) {
        for (const other of shapes.slice(index + 1)) {
          if (!meet(shape, other)) continue;
          expect([shape.kind, other.kind].filter((kind) => kind === "section")).toHaveLength(1);
          expect(shape.kind === "section" ? inside(other, shape) : inside(shape, other)).toBe(true);
        }
      }
      // No line runs over a card or section other than its two ends and the sections they sit in.
      const shapeOf = (end: (typeof template.lines)[number]["from"]) =>
        typeof end === "string"
          ? shapes[template.items.findIndex((item) => item.key === end) + 1]!
          : shapes[0]!;
      const covers = (shape: (typeof shapes)[number], x: number, y: number) =>
        x > shape.x && x < shape.x + shape.w && y > shape.y && y < shape.y + shape.h;
      for (const line of template.lines) {
        const from = shapeOf(line.from);
        const to = shapeOf(line.to);
        const others = shapes.filter(
          (shape) =>
            shape !== from &&
            shape !== to &&
            !(shape.kind === "section" && (inside(from, shape) || inside(to, shape))),
        );
        for (let step = 0; step <= 100; step += 1) {
          const x = from.x + from.w / 2 + ((to.x + to.w / 2 - from.x - from.w / 2) * step) / 100;
          const y = from.y + from.h / 2 + ((to.y + to.h / 2 - from.y - from.h / 2) * step) / 100;
          if (covers(from, x, y) || covers(to, x, y)) continue;
          expect(others.filter((shape) => covers(shape, x, y))).toEqual([]);
        }
        // The line as drawn keeps 16px clear of every section border it passes.
        const box = (shape: (typeof shapes)[number]) =>
          boardCardBox({ x: shape.x, y: shape.y }, { w: shape.w, h: shape.h });
        const [x0, y0, x1, y1, x2, y2, x3, y3] = (
          boardConnector(box(from), box(to)).path.match(/-?[\d.]+/g) ?? []
        ).map(Number) as [number, number, number, number, number, number, number, number];
        const sections = others.filter((shape) => shape.kind === "section");
        for (let step = 0; step <= 100; step += 1) {
          const t = step / 100;
          const at = (a: number, b: number, c: number, d: number) =>
            (1 - t) ** 3 * a + 3 * (1 - t) ** 2 * t * b + 3 * (1 - t) * t ** 2 * c + t ** 3 * d;
          const x = at(x0, x1, x2, x3);
          const y = at(y0, y1, y2, y3);
          const near = sections.filter(
            (shape) =>
              x > shape.x - 16 &&
              x < shape.x + shape.w + 16 &&
              y > shape.y - 16 &&
              y < shape.y + shape.h + 16,
          );
          expect(near).toEqual([]);
        }
      }
    },
  );

  it("starts a blank board exactly as before: its thread box placed and nothing else", () => {
    expect(boardTemplateChanges(BLANK_BOARD_TEMPLATE, () => "unused")).toEqual([
      { type: "card.move", cardId: ROOM_BOARD_THREAD_CARD, x: 80, y: 72 },
    ]);
    expect(BOARD_TEMPLATES[0]).toBe(BLANK_BOARD_TEMPLATE);
  });
});

describe("a board's outline in the sidebar", () => {
  const items = (kinds: string) =>
    [...kinds].map((letter, index) => ({
      id: `${letter}${index}`,
      kind: letter === "a" ? "artifact" : letter === "t" ? "thread" : "section",
    }));
  const ids = (kinds: string, max: number) => {
    const { shown, more } = boardOutlineShown(items(kinds), max);
    return [shown.map((item) => item.id).join(" "), more];
  };

  it("shows a short outline whole, in its order", () => {
    expect(ids("aatts", 6)).toEqual(["a0 a1 t2 t3 s4", 0]);
  });

  it("cuts a long one so no kind pushes another out, and counts what it left out", () => {
    // Ten artifacts, two agents, one section, six rows: the agents and the section all stay.
    expect(ids("aaaaaaaaaatts", 6)).toEqual(["a0 a1 a2 t10 t11 s12", 7]);
    // Rows a kind has no use for go to the kinds before it.
    expect(ids("aaaaaaatttttt", 6)).toEqual(["a0 a1 a2 t7 t8 t9", 7]);
    expect(ids("aaaaaaaa", 3)).toEqual(["a0 a1 a2", 5]);
  });
});
