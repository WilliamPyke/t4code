import {
  type CloudBoardAccountBoard,
  ROOM_BOARD_NOTE_COLORS,
  ROOM_BOARD_SUMMARY_MAX_SHAPES,
  type RoomBoard,
  type RoomBoardNoteColor,
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
  readonly createdAt?: string;
  /** When this person last opened the thread, on any of their devices. */
  readonly lastVisitedAt?: string | null | undefined;
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
  /** A cloud board someone else made: joined from their link, or in a workspace. */
  readonly shared?: boolean;
  /** Listed by the signed-in account, with no session on this browser yet. */
  readonly remote?: boolean;
  /** This person made the cloud board, so they may delete it for everyone. */
  readonly maker?: boolean;
  /** When this browser last opened it. */
  readonly openedAt?: string | undefined;
  /** The workspace it is in, whose members open it without an invite. */
  readonly workspaceId?: string | undefined;
  readonly workspaceName?: string | undefined;
  readonly workspaceColor?: RoomBoardNoteColor | undefined;
  /** A small map of its cards (`@t3tools/shared/boardPreview`), when there is one. */
  readonly preview?: string | undefined;
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
  // The host's preview first: it shows everyone's changes, this browser's only its own visits.
  const local = input.local.map((share) => {
    const board = listed.get(share.shareId);
    return board === undefined
      ? share
      : {
          ...share,
          shared: !board.maker,
          maker: board.maker || share.maker === true,
          preview: board.preview || share.preview,
        };
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
      preview: board.preview,
    }));
  return [...local, ...remote];
}

export interface WorkspaceBoardsSource {
  readonly id: string;
  readonly name: string;
  readonly color?: RoomBoardNoteColor;
  readonly boards: ReadonlyArray<{
    readonly shareId: string;
    readonly threadId: string;
    readonly title: string;
    readonly addedAt: string;
    readonly preview?: string | undefined;
  }>;
}

/**
 * The joined boards with every workspace's: one already listed says which workspace it is in, and
 * one not yet opened here is listed to open as a member. `workspaces` is null without accounts.
 */
export function withWorkspaceBoards(
  joined: ReadonlyArray<JoinedBoardSource>,
  workspaces: ReadonlyArray<WorkspaceBoardsSource> | null,
): ReadonlyArray<JoinedBoardSource> {
  if (workspaces === null || workspaces.length === 0) return joined;
  const inWorkspace = new Map<
    string,
    { readonly workspace: WorkspaceBoardsSource; readonly preview: string | undefined }
  >();
  for (const workspace of workspaces) {
    for (const board of workspace.boards) {
      inWorkspace.set(board.shareId, { workspace, preview: board.preview });
    }
  }
  const tagged = joined.map((share) => {
    const listed = inWorkspace.get(share.shareId);
    return listed === undefined
      ? share
      : {
          ...share,
          workspaceId: listed.workspace.id,
          workspaceName: listed.workspace.name,
          workspaceColor: listed.workspace.color,
          preview: listed.preview || share.preview,
        };
  });
  const listed = new Set(joined.map((share) => share.shareId));
  const unopened = workspaces.flatMap((workspace) =>
    workspace.boards
      .filter((board) => !listed.has(board.shareId))
      .map((board): JoinedBoardSource => ({
        shareId: board.shareId,
        threadId: board.threadId,
        title: board.title,
        joinedAt: board.addedAt,
        cloud: true,
        shared: true,
        remote: true,
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        workspaceColor: workspace.color,
        preview: board.preview,
      })),
  );
  return [...tagged, ...unopened];
}

/**
 * The boards in a scope: every one, the person's own (in no workspace, their computers' boards
 * among them), or one workspace's.
 */
export function boardsInScope(
  boards: ReadonlyArray<HomeBoard>,
  scope: string,
): ReadonlyArray<HomeBoard> {
  if (scope === "all") return boards;
  if (scope === "personal") {
    return boards.filter((board) => board.kind !== "joined" || board.workspaceId === null);
  }
  return boards.filter((board) => board.kind === "joined" && board.workspaceId === scope);
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
      /** When it was made, if known. */
      readonly createdAt: string | null;
      /** When this person last opened it, else when it last changed. */
      readonly openedAt: string;
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
      readonly workspaceId: string | null;
      readonly workspaceName: string | null;
      readonly workspaceColor: RoomBoardNoteColor | null;
      readonly preview: string | null;
      readonly activityAt: string;
      /** When this person made or joined it. */
      readonly createdAt: string | null;
      readonly openedAt: string;
    }
  | {
      readonly kind: "team";
      readonly key: string;
      readonly teamId: string;
      readonly title: string;
      readonly activityAt: null;
      readonly createdAt: null;
      readonly openedAt: null;
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
      createdAt: thread.createdAt ?? null,
      openedAt: latest(
        latest(thread.updatedAt, thread.latestUserMessageAt),
        thread.lastVisitedAt ?? null,
      ),
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
    workspaceId: share.workspaceId ?? null,
    workspaceName: share.workspaceName ?? null,
    workspaceColor: share.workspaceColor ?? null,
    preview: share.preview || null,
    activityAt: latest(share.joinedAt, share.openedAt ?? null),
    createdAt: share.joinedAt,
    openedAt: latest(share.joinedAt, share.openedAt ?? null),
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
    createdAt: null,
    openedAt: null,
  }));
  const query = input.query?.trim().toLowerCase() ?? "";
  const all = [...dated, ...teams];
  if (query === "") return all;
  return all.filter((board) =>
    [
      board.title,
      board.kind === "own" ? input.projectName?.(board.environmentId, board.projectId) : undefined,
      board.kind === "joined" ? board.owner : undefined,
      board.kind === "joined" ? board.workspaceName : undefined,
    ].some((text) => typeof text === "string" && text.toLowerCase().includes(query)),
  );
}

/** How the home orders boards: most recently opened, by name, or newest made or joined first. */
export type HomeBoardSort = "recent" | "name" | "created";
export const HOME_BOARD_SORTS: ReadonlyArray<HomeBoardSort> = ["recent", "name", "created"];

const newestFirst = (left: string | null, right: string | null) =>
  (right ?? "").localeCompare(left ?? "");
const byName = (left: HomeBoard, right: HomeBoard) =>
  left.title.localeCompare(right.title, undefined, { sensitivity: "base", numeric: true });

/**
 * The boards in the chosen order. Ties, and boards with no time (team boards), go by name; a
 * board with no time sorts after every board with one.
 */
export function sortHomeBoards(
  boards: ReadonlyArray<HomeBoard>,
  sort: HomeBoardSort,
): ReadonlyArray<HomeBoard> {
  if (sort === "name") return boards.toSorted((left, right) => byName(left, right));
  const timeOf = (board: HomeBoard) => (sort === "recent" ? board.openedAt : board.createdAt);
  return boards.toSorted(
    (left, right) => newestFirst(timeOf(left), timeOf(right)) || byName(left, right),
  );
}

/** Past this many boards, the home leads with the few most recently opened. */
export const HOME_RECENT_AFTER = 8;
export const HOME_RECENT_COUNT = 4;

/** A paint each board keeps, so boards are told apart at a glance: its workspace's, or its own. */
export function boardPaint(
  board: Pick<HomeBoard, "key"> & {
    readonly workspaceColor?: RoomBoardNoteColor | null;
  },
): RoomBoardNoteColor {
  if (board.workspaceColor != null) return board.workspaceColor;
  let hash = 0;
  for (const char of board.key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ROOM_BOARD_NOTE_COLORS[Math.abs(hash) % ROOM_BOARD_NOTE_COLORS.length]!;
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const plural = (count: number, unit: string) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * When something happened, in words: "Just now", "5 minutes ago", "2 hours ago", "Yesterday",
 * "3 days ago", "2 weeks ago", then the date ("Mar 4", with the year when it is not this one).
 * Days count in UTC, so the same time reads the same everywhere it is tested.
 */
export function boardTimeLabel(iso: string, nowMs: number): string | null {
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return null;
  const elapsed = Math.max(0, nowMs - at);
  if (elapsed < MINUTE_MS) return "Just now";
  if (elapsed < HOUR_MS) return plural(Math.floor(elapsed / MINUTE_MS), "minute");
  if (elapsed < DAY_MS) return plural(Math.floor(elapsed / HOUR_MS), "hour");
  const days = Math.floor(nowMs / DAY_MS) - Math.floor(at / DAY_MS);
  if (days <= 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 35) return plural(Math.floor(days / 7), "week");
  const date = new Date(at);
  const year =
    date.getUTCFullYear() === new Date(nowMs).getUTCFullYear() ? "" : `, ${date.getUTCFullYear()}`;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}${year}`;
}

/**
 * What the home shows: placeholders while it cannot yet know whether the person has boards (the
 * account's list or this device's machines still loading), the welcome when they have none, and
 * their boards otherwise. Never the welcome to someone whose boards are on their way.
 */
export function homeContent(input: {
  readonly boards: number;
  readonly workspaces: number;
  /** This device's machines have said which boards they keep. */
  readonly machinesLoaded: boolean;
  /** Sign-in has said who this is and, signed in, their boards arrived (or could not). */
  readonly accountLoaded: boolean;
  /** The welcome already showed: a sign-in made from it must not take the form away meanwhile. */
  readonly welcomed?: boolean;
  /** Another page is loading: the welcome stays as it is until that page takes over. */
  readonly leaving?: boolean;
}): HomeContent {
  if (input.welcomed === true && input.leaving === true) return "welcome";
  if (input.boards > 0 || input.workspaces > 0) return "boards";
  if (input.welcomed === true) return "welcome";
  return input.machinesLoaded && input.accountLoaded ? "welcome" : "loading";
}

export type HomeContent = "boards" | "loading" | "welcome";

/**
 * Whether the home has the window to itself, with no sidebar beside it: where that is offered,
 * until it has boards to list. Before it has shown anything it counts as having none, so the
 * sidebar arrives with the boards and never leaves a welcome it stood beside.
 */
export function homeIsFocused(input: {
  readonly offered: boolean;
  /** The page drawn, not one still loading. */
  readonly pathname: string;
  readonly shown: HomeContent | null;
}): boolean {
  return input.offered && input.pathname === "/" && input.shown !== "boards";
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

/** Rows a board's outline shows in the sidebar before it offers the board itself. */
const BOARD_OUTLINE_SHOWN = 12;

/**
 * The outline rows a board list shows, in their order: at most `max`, each kind getting an even
 * share before any gets more, so many artifacts never push every agent out. `more` were left out.
 */
export function boardOutlineShown<Item extends { readonly kind: string }>(
  items: ReadonlyArray<Item>,
  max: number = BOARD_OUTLINE_SHOWN,
): { readonly shown: ReadonlyArray<Item>; readonly more: number } {
  if (items.length <= max) return { shown: items, more: 0 };
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.kind, (counts.get(item.kind) ?? 0) + 1);
  const share = Math.floor(max / counts.size);
  const taken = new Map([...counts].map(([kind, count]) => [kind, Math.min(count, share)]));
  let spare = max - [...taken.values()].reduce((sum, count) => sum + count, 0);
  for (const [kind, count] of counts) {
    const extra = Math.min(spare, count - (taken.get(kind) ?? 0));
    taken.set(kind, (taken.get(kind) ?? 0) + extra);
    spare -= extra;
  }
  const shown = items.filter((item) => {
    const left = taken.get(item.kind) ?? 0;
    taken.set(item.kind, left - 1);
    return left > 0;
  });
  return { shown, more: items.length - shown.length };
}
