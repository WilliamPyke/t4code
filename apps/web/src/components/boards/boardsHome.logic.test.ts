import { ROOM_BOARD_MAX_NOTES, ROOM_BOARD_THREAD_CARD, type RoomBoard } from "@t3tools/contracts";
import { EMPTY_ROOM_BOARD, applyRoomBoardChange } from "@t3tools/shared/roomBoard";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  BLANK_BOARD_TEMPLATE,
  BOARD_TEMPLATES,
  boardTemplateChanges,
  boardTemplateShapes,
  cloudBoardTemplateChanges,
} from "./boardTemplates";
import {
  type OwnBoardSource,
  boardThumbnail,
  listHomeBoards,
  newBoardProject,
  newBoardProjectKey,
  newBoardStart,
  teamBoardShapes,
} from "./boardsHome.logic";
import { boardCardBox, boardConnector } from "../room/roomBoard.logic";

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
  const start = (operable: ReadonlyArray<string>, cloud: boolean) =>
    newBoardStart({
      projects: [a, b],
      boards: [],
      lastUsed: null,
      operable: new Set(operable),
      cloud,
    });

  it("goes to the cloud only when no machine can take a board", () => {
    expect(start([], true)).toEqual({ kind: "cloud" });
    // Without a cloud host it fails on a machine as before, where the toast says why.
    expect(start([], false)).toEqual({ kind: "ask" });
    // A machine that can is used, and a disconnected one's projects are not offered.
    expect(start(["env-b"], true)).toEqual({ kind: "use", project: b });
    expect(start(["env-a", "env-b"], true)).toEqual({ kind: "ask" });
    expect(start(["env-c"], true)).toEqual({ kind: "none" });
  });
});

describe("cloud board templates", () => {
  it("takes only templates with no agent in them, without the board's own thread box", () => {
    const fits = BOARD_TEMPLATES.filter(
      (template) => cloudBoardTemplateChanges(template, () => "id") !== null,
    ).map((template) => template.id);
    expect(fits).toContain(BLANK_BOARD_TEMPLATE.id);
    expect(fits).toEqual(["blank", "retro"]);
    for (const template of BOARD_TEMPLATES) {
      const changes = cloudBoardTemplateChanges(template, () => "id") ?? [];
      expect(changes.filter((change) => change.type === "card.move")).toEqual([]);
      expect(
        changes.filter((change) => change.type === "note.put" && change.kind === "thread"),
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
