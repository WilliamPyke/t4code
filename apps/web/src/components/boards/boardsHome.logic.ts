import {
  type CloudBoardAccountBoard,
  ROOM_BOARD_SUMMARY_MAX_SHAPES,
  type RoomBoard,
  type RoomBoardSize,
  type RoomBoardSummaryShape,
} from "@t3tools/contracts";

import { boardNewNoteSize, boardNoteSize } from "../room/roomBoard.logic";

/** A board this client owns: a thread with a board, on one of its environments. */
export interface OwnBoardSource {
  readonly environmentId: string;
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly latestUserMessageAt: string | null;
  readonly archivedAt: string | null;
  readonly deletedAt: string | null;
  readonly guestShared?: boolean;
  readonly hasRoomBoard?: boolean;
}

/** A board someone shared that this browser joined. */
export interface JoinedBoardSource {
  readonly shareId: string;
  readonly threadId: string;
  readonly title: string;
  readonly owner?: string | undefined;
  readonly joinedAt: string;
  /** On the cloud board host, on nobody's machine. */
  readonly cloud?: boolean;
  /** A cloud board the signed-in account joined from someone else's link. */
  readonly shared?: boolean;
  /** Listed by the signed-in account, with no session on this browser yet. */
  readonly remote?: boolean;
  /** This person made the cloud board, so they may delete it for everyone. */
  readonly maker?: boolean;
  /** When this browser last opened it. */
  readonly openedAt?: string | undefined;
}

/**
 * The joined boards the home lists: this browser's, then those only the signed-in account lists,
 * which open as the same person once clicked. `listed` is null while nobody is signed in.
 */
export function joinedBoardSources(input: {
  readonly local: ReadonlyArray<JoinedBoardSource>;
  readonly listed: ReadonlyArray<CloudBoardAccountBoard> | null;
}): ReadonlyArray<JoinedBoardSource> {
  if (input.listed === null) return input.local;
  const listed = new Map<string, CloudBoardAccountBoard>(
    input.listed.map((board) => [board.shareId, board]),
  );
  const local = input.local.map((share) => {
    const board = listed.get(share.shareId);
    return board === undefined
      ? share
      : { ...share, shared: !board.maker, maker: board.maker || share.maker === true };
  });
  const here = new Set(input.local.map((share) => share.shareId));
  const remote = input.listed
    .filter((board) => !here.has(board.shareId))
    .map((board): JoinedBoardSource => ({
      shareId: board.shareId,
      threadId: board.threadId,
      title: board.title,
      joinedAt: board.addedAt,
      cloud: true,
      shared: !board.maker,
      maker: board.maker,
      remote: true,
    }));
  return [...local, ...remote];
}

export interface TeamBoardSource {
  readonly id: string;
  readonly name: string;
}

export type HomeBoard =
  | {
      readonly kind: "own";
      readonly key: string;
      readonly environmentId: string;
      readonly threadId: string;
      readonly projectId: string;
      readonly title: string;
      readonly activityAt: string;
    }
  | {
      readonly kind: "joined";
      readonly key: string;
      readonly shareId: string;
      readonly threadId: string;
      readonly title: string;
      readonly owner: string | null;
      readonly cloud: boolean;
      readonly shared: boolean;
      readonly remote: boolean;
      readonly maker: boolean;
      readonly activityAt: string;
    }
  | {
      readonly kind: "team";
      readonly key: string;
      readonly teamId: string;
      readonly title: string;
      readonly activityAt: null;
    };

export const UNTITLED_BOARD = "Untitled board";

const latest = (left: string, right: string | null) =>
  right !== null && right > left ? right : left;

/** Whether a thread has a board to open: one it keeps, or one its share gave it. */
const threadHasBoard = (thread: Pick<OwnBoardSource, "guestShared" | "hasRoomBoard">) =>
  thread.guestShared === true || thread.hasRoomBoard === true;

/**
 * Every board the home lists, most recently active first: the user's own threads with a board
 * (archived and deleted ones left out), the boards shared with them, then their teams, whose
 * activity this client does not know. `isOwnEnvironment` leaves out environments that only mirror
 * a joined share. `query` keeps those whose name, project or owner contains it.
 */
export function listHomeBoards(input: {
  readonly threads: ReadonlyArray<OwnBoardSource>;
  readonly joined: ReadonlyArray<JoinedBoardSource>;
  readonly teams: ReadonlyArray<TeamBoardSource>;
  readonly isOwnEnvironment: (environmentId: string) => boolean;
  readonly projectName?: (environmentId: string, projectId: string) => string | undefined;
  readonly query?: string;
}): ReadonlyArray<HomeBoard> {
  const own: Array<HomeBoard> = input.threads
    .filter(
      (thread) =>
        threadHasBoard(thread) &&
        thread.archivedAt === null &&
        thread.deletedAt === null &&
        input.isOwnEnvironment(thread.environmentId),
    )
    .map((thread) => ({
      kind: "own",
      key: `own:${thread.environmentId}:${thread.id}`,
      environmentId: thread.environmentId,
      threadId: thread.id,
      projectId: thread.projectId,
      title: thread.title.trim() || UNTITLED_BOARD,
      activityAt: latest(thread.updatedAt, thread.latestUserMessageAt),
    }));
  const joined: Array<HomeBoard> = input.joined.map((share) => ({
    kind: "joined",
    key: `joined:${share.shareId}`,
    shareId: share.shareId,
    threadId: share.threadId,
    title: share.title.trim() || UNTITLED_BOARD,
    owner: share.owner ?? null,
    cloud: share.cloud === true,
    shared: share.shared === true,
    remote: share.remote === true,
    maker: share.maker === true,
    activityAt: latest(share.joinedAt, share.openedAt ?? null),
  }));
  const dated = [...own, ...joined].toSorted((left, right) =>
    (right.activityAt ?? "").localeCompare(left.activityAt ?? ""),
  );
  const teams: Array<HomeBoard> = input.teams.map((team) => ({
    kind: "team",
    key: `team:${team.id}`,
    teamId: team.id,
    title: team.name,
    activityAt: null,
  }));
  const query = input.query?.trim().toLowerCase() ?? "";
  const all = [...dated, ...teams];
  if (query === "") return all;
  return all.filter((board) =>
    [
      board.title,
      board.kind === "own" ? input.projectName?.(board.environmentId, board.projectId) : undefined,
      board.kind === "joined" ? board.owner : undefined,
    ].some((text) => typeof text === "string" && text.toLowerCase().includes(query)),
  );
}

// A team board's thread and member cards, at about the size the board draws them.
const TEAM_CARD: RoomBoardSize = { w: 320, h: 200 };
const SECTION: RoomBoardSize = { w: 640, h: 420 };

/**
 * A team board's cards as a thumbnail draws them, as a machine's summary gives its own boards:
 * sections first so they sit behind, then the thread and member cards, then the notes. Comments
 * pinned to a reply are not on the canvas.
 */
export function teamBoardShapes(board: RoomBoard): ReadonlyArray<RoomBoardSummaryShape> {
  const notes = board.notes
    .filter((note) => note.pinnedTo === undefined)
    .map((note): RoomBoardSummaryShape => {
      const size =
        note.section === true
          ? (note.size ?? SECTION)
          : (boardNoteSize(note) ?? boardNewNoteSize(note.kind));
      return {
        x: note.x,
        y: note.y,
        w: size.w,
        h: size.h,
        kind: note.section === true ? "section" : (note.kind ?? "note"),
        ...(note.color === undefined ? {} : { color: note.color }),
      };
    });
  const cards = Object.entries(board.positions).map(([id, at]): RoomBoardSummaryShape => ({
    x: at.x,
    y: at.y,
    ...(board.sizes?.[id] ?? TEAM_CARD),
    kind: "card",
  }));
  return [
    ...notes.filter((shape) => shape.kind === "section"),
    ...cards,
    ...notes.filter((shape) => shape.kind !== "section"),
  ].slice(0, ROOM_BOARD_SUMMARY_MAX_SHAPES);
}

export interface ThumbnailRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly kind: RoomBoardSummaryShape["kind"];
  readonly color: RoomBoardSummaryShape["color"];
}

// A card smaller than this on the thumbnail would vanish; it is drawn at least this big.
const THUMBNAIL_MIN_SIDE = 2;

/**
 * A board's cards fitted into a `width` by `height` thumbnail, keeping their proportions and
 * centred, with `padding` clear on every side. Nothing to draw gives no rectangles.
 */
export function boardThumbnail(
  shapes: ReadonlyArray<RoomBoardSummaryShape>,
  frame: { readonly width: number; readonly height: number; readonly padding: number },
): ReadonlyArray<ThumbnailRect> {
  if (shapes.length === 0) return [];
  const minX = Math.min(...shapes.map((shape) => shape.x));
  const minY = Math.min(...shapes.map((shape) => shape.y));
  const maxX = Math.max(...shapes.map((shape) => shape.x + shape.w));
  const maxY = Math.max(...shapes.map((shape) => shape.y + shape.h));
  const innerWidth = Math.max(frame.width - frame.padding * 2, 1);
  const innerHeight = Math.max(frame.height - frame.padding * 2, 1);
  const scale = Math.min(
    innerWidth / Math.max(maxX - minX, 1),
    innerHeight / Math.max(maxY - minY, 1),
  );
  const offsetX = frame.padding + (innerWidth - (maxX - minX) * scale) / 2;
  const offsetY = frame.padding + (innerHeight - (maxY - minY) * scale) / 2;
  return shapes.map((shape) => ({
    x: offsetX + (shape.x - minX) * scale,
    y: offsetY + (shape.y - minY) * scale,
    width: Math.max(shape.w * scale, THUMBNAIL_MIN_SIDE),
    height: Math.max(shape.h * scale, THUMBNAIL_MIN_SIDE),
    kind: shape.kind,
    color: shape.color,
  }));
}

export interface NewBoardProjectSource {
  readonly environmentId: string;
  readonly id: string;
  readonly archivedAt?: string | null | undefined;
}

/**
 * Which project a new board's thread goes in without asking: the only one, the one the last new
 * board went in, or the project of the most recently active board. Null asks the user; an empty
 * list means there is no project to start one in.
 */
export function newBoardProject<TProject extends NewBoardProjectSource>(input: {
  readonly projects: ReadonlyArray<TProject>;
  readonly boards: ReadonlyArray<HomeBoard>;
  readonly lastUsed: string | null;
}):
  | { readonly kind: "none" }
  | { readonly kind: "ask" }
  | { readonly kind: "use"; readonly project: TProject } {
  const open = input.projects.filter((project) => project.archivedAt == null);
  if (open.length === 0) return { kind: "none" };
  if (open.length === 1) return { kind: "use", project: open[0]! };
  const byKey = (key: string | null) =>
    key === null ? undefined : open.find((project) => newBoardProjectKey(project) === key);
  const lastUsed = byKey(input.lastUsed);
  if (lastUsed !== undefined) return { kind: "use", project: lastUsed };
  const recentBoard = input.boards.find((board) => board.kind === "own");
  const recent =
    recentBoard?.kind === "own"
      ? byKey(
          newBoardProjectKey({
            environmentId: recentBoard.environmentId,
            id: recentBoard.projectId,
          }),
        )
      : undefined;
  return recent === undefined ? { kind: "ask" } : { kind: "use", project: recent };
}

export const newBoardProjectKey = (project: Pick<NewBoardProjectSource, "environmentId" | "id">) =>
  `${project.environmentId}:${project.id}`;

/** Where a new board lives: on the cloud host, or on one of this person's machines. */
export type NewBoardPlace = "cloud" | "machine";

/**
 * Where New board makes a board: the cloud when it can take it, unless the person chose their
 * computer. There, a project as {@link newBoardProject} picks among machines that may take it,
 * else the cloud after all; a machine still connecting is waited for once (`waited`).
 */
export function newBoardStart<TProject extends NewBoardProjectSource>(input: {
  readonly projects: ReadonlyArray<TProject>;
  readonly boards: ReadonlyArray<HomeBoard>;
  readonly lastUsed: string | null;
  /** The machines this browser may make a board on now. */
  readonly operable: ReadonlySet<string>;
  /** The machines this browser keeps whose session has not loaded yet and has not failed. */
  readonly connecting: ReadonlySet<string>;
  readonly waited: boolean;
  /** Whether a cloud host exists and can take this board's template. */
  readonly cloud: boolean;
  readonly place: NewBoardPlace;
}):
  | { readonly kind: "wait" }
  | { readonly kind: "cloud" }
  | { readonly kind: "none" }
  | { readonly kind: "ask" }
  | { readonly kind: "use"; readonly project: TProject } {
  if (input.cloud && input.place === "cloud") return { kind: "cloud" };
  if (input.operable.size === 0) {
    if (input.connecting.size > 0 && !input.waited) return { kind: "wait" };
    return input.cloud ? { kind: "cloud" } : newBoardProject(input);
  }
  return newBoardProject({
    ...input,
    projects: input.projects.filter((project) => input.operable.has(project.environmentId)),
  });
}

/**
 * Whose agent comes along to a cloud board this person just made, and in which project: their
 * only machine that may take it, in the project a machine board would have gone in, or none.
 * With no such machine, or several, they choose later. Someone else's invite never brings one.
 */
export function newCloudBoardAgent<TProject extends NewBoardProjectSource>(input: {
  readonly projects: ReadonlyArray<TProject>;
  readonly boards: ReadonlyArray<HomeBoard>;
  readonly lastUsed: string | null;
  readonly operable: ReadonlySet<string>;
}): { readonly environmentId: string; readonly project: TProject | null } | null {
  if (input.operable.size !== 1) return null;
  const [environmentId] = input.operable;
  const picked = newBoardProject({
    ...input,
    projects: input.projects.filter((project) => project.environmentId === environmentId),
  });
  return { environmentId: environmentId!, project: picked.kind === "use" ? picked.project : null };
}
