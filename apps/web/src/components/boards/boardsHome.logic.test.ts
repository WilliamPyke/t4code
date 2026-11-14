import { describe, expect, it } from "vite-plus/test";

import {
  type OwnBoardSource,
  boardThumbnail,
  listHomeBoards,
  newBoardProject,
  newBoardProjectKey,
} from "./boardsHome.logic";

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
