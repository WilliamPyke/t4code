import type { RoomBoardSummaryShape } from "@t3tools/contracts";

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
    activityAt: share.joinedAt,
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
