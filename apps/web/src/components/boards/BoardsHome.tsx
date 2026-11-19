import { useAtomValue } from "@effect/atom-react";
import { isGuestEnvironment, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ROOM_BOARD_SUMMARY_MAX_BOARDS,
  ThreadId,
  type RoomBoardSummary,
  type RoomBoardSummaryShape,
} from "@t3tools/contracts";
import { decodeBoardPreview } from "@t3tools/shared/boardPreview";
import { Link, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import {
  ArrowDownUpIcon,
  ChevronDownIcon,
  MegaphoneIcon,
  PlusIcon,
  SearchIcon,
} from "lucide-react";
import { type MouseEvent, useEffect, useState } from "react";

import { isElectron } from "~/env";
import { refreshAccountBoards, useBoardAccount } from "~/guest/boardAccount";
import { useInboxCount } from "~/guest/inbox";
import { sharedThreadLocationOf } from "~/guest/boardAddress";
import {
  accountBoardsAtom,
  guestShareLocation,
  guestSharesAtom,
  isCloudShare,
  localBoardPreviewsAtom,
} from "~/guest/guestShares";
import {
  openListedBoard,
  refreshWorkspaceList,
  useWorkspaceScope,
  useWorkspaces,
} from "~/guest/workspaces";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useNowMinute } from "~/hooks/useNowMinute";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { readTeamBoard, useTeams } from "~/teams/teams";
import { useWhatsNewSeen } from "~/whatsNew";

import { BoardChip } from "../room/BoardChrome";
import { BOARD_PERSON_COLORS } from "../room/roomBoard.logic";
import { roomBoardLocation } from "../room/roomBoardNavigation";
import { Button } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { Input } from "../ui/input";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { TinkjamLoading } from "../TinkjamLoading";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardsAccount } from "./BoardsAccount";
import { BoardsWelcome } from "./BoardsWelcome";
import { ConnectComputerNudge } from "./ConnectComputerNudge";
import { InboxBell } from "./InboxBell";
import { MyTasks } from "./MyTasks";
import { ViewedBoards } from "./ViewedBoards";
import { SignInNudge } from "./SignInNudge";
import { BoardThumbnail } from "./BoardThumbnail";
import {
  HOME_BOARD_SORTS,
  HOME_RECENT_AFTER,
  HOME_RECENT_COUNT,
  type HomeBoard,
  type HomeBoardSort,
  boardPaint,
  boardTimeLabel,
  boardsInScope,
  homeContent,
  joinedBoardSources,
  listHomeBoards,
  sortHomeBoards,
  teamBoardShapes,
  withWorkspaceBoards,
} from "./boardsHome.logic";
import { openBoardTemplates, useNewBoardWaiting, useStartNewBoard } from "./newBoard";
import { JoinedBoardMenu } from "./removeJoinedBoard";
import { WorkspaceInvite, WorkspacePeople, WorkspaceSwitcher } from "./Workspaces";

const NO_THREAD_IDS: ReadonlyArray<ThreadId> = [];

// Per browser: how the home orders boards.
const SORT_KEY = "t3code:boards-sort:v1";
const SortSchema = Schema.Literals(HOME_BOARD_SORTS);
const readSort = (): HomeBoardSort => {
  try {
    return getLocalStorageItem(SORT_KEY, SortSchema) ?? "recent";
  } catch {
    return "recent";
  }
};
const SORT_LABELS: Readonly<Record<HomeBoardSort, string>> = {
  recent: "Recently opened",
  name: "Name",
  created: "Newest first",
};

// Past this, a sign-in or a list of boards that has not answered no longer holds the welcome back.
const ACCOUNT_WAIT_MS = 8_000;

/** Whether sign-in said who this is and, signed in, their boards arrived, or it took too long. */
function useAccountSettled(): boolean {
  const account = useBoardAccount();
  const [waitedOut, setWaitedOut] = useState(false);
  const waiting =
    account.status === "loading" || (account.status === "signed-in" && !account.listed);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- caps how long a sign-in or board list that never answers holds the home on placeholders
  useEffect(() => {
    if (!waiting) return;
    const timer = setTimeout(() => setWaitedOut(true), ACCOUNT_WAIT_MS);
    return () => clearTimeout(timer);
  }, [waiting]);
  return !waiting || waitedOut;
}

/** Every board the user has, most recently opened first, and the way to start one. */
export function BoardsHome() {
  const threads = useThreadShells();
  const projects = useProjects();
  const joined = useAtomValue(guestSharesAtom);
  const accountBoards = useAtomValue(accountBoardsAtom);
  const localPreviews = useAtomValue(localBoardPreviewsAtom);
  const accountSettled = useAccountSettled();
  const [sort, setSort] = useState(readSort);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the account's boards and workspaces again from the board service each time the home opens
  useEffect(() => {
    void refreshAccountBoards();
    refreshWorkspaceList();
  }, []);
  // Null signed out and without accounts: then nothing about workspaces shows.
  const workspaces = useWorkspaces();
  const scope = useWorkspaceScope();
  const workspace = workspaces?.find((candidate) => candidate.id === scope) ?? null;
  const { teams } = useTeams();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const startNewBoard = useStartNewBoard();
  const waiting = useNewBoardWaiting();
  const newBoardIcon = waiting ? <Spinner aria-hidden /> : <PlusIcon />;
  const [query, setQuery] = useState("");
  const projectName = (environmentId: string, projectId: string) =>
    projects.find((project) => project.environmentId === environmentId && project.id === projectId)
      ?.title;
  const sources = {
    threads,
    joined: withWorkspaceBoards(
      joinedBoardSources({
        // A board only looked at from a view link is not one of theirs: it is under Viewed.
        local: joined
          .filter((share) => share.viewOnly !== true)
          .map((share) => ({
            ...share,
            cloud: isCloudShare(share),
            maker: share.made === true,
            preview: localPreviews[share.shareId],
          })),
        listed: accountBoards,
      }),
      workspaces,
    ),
    teams: teams ?? [],
    isOwnEnvironment: (environmentId: string) => !isGuestEnvironment(environmentId),
    projectName,
  };
  const all = listHomeBoards(sources);
  // A search looks through every board, whichever workspace is shown.
  const searching = query.trim() !== "";
  const inScope = boardsInScope(all, scope);
  const shown = sortHomeBoards(searching ? listHomeBoards({ ...sources, query }) : inScope, sort);
  const recent =
    !searching && inScope.length > HOME_RECENT_AFTER
      ? sortHomeBoards(inScope, "recent").slice(0, HOME_RECENT_COUNT)
      : [];
  const showWorkspace = searching || scope === "all";
  const [welcomed, setWelcomed] = useState(false);
  const content = homeContent({
    // A board only looked at from a view link (the sample) leaves the welcome in place.
    boards: all.length,
    workspaces: workspaces?.length ?? 0,
    machinesLoaded: bootstrapped,
    accountLoaded: accountSettled,
    welcomed,
  });
  if (content === "welcome" && !welcomed) setWelcomed(true);
  // One summary request per machine, for its most recent boards; every tile there shares it.
  const threadIdsByEnvironment = new Map<string, Array<ThreadId>>();
  for (const board of all) {
    if (board.kind !== "own") continue;
    const ids = threadIdsByEnvironment.get(board.environmentId) ?? [];
    if (ids.length < ROOM_BOARD_SUMMARY_MAX_BOARDS) ids.push(ThreadId.make(board.threadId));
    threadIdsByEnvironment.set(board.environmentId, ids);
  }
  for (const ids of threadIdsByEnvironment.values()) ids.sort();
  const nowMinute = useNowMinute();
  const nowMs = Date.parse(`${nowMinute}:00.000Z`);
  const contentArea = workspaceAreaProps("home", 1, "Boards");
  const whatsNew = useWhatsNewSeen();
  const tile = (board: HomeBoard) => (
    <BoardTile
      key={board.key}
      board={board}
      projectName={
        board.kind === "own" ? projectName(board.environmentId, board.projectId) : undefined
      }
      summaryThreadIds={
        board.kind === "own"
          ? (threadIdsByEnvironment.get(board.environmentId) ?? NO_THREAD_IDS)
          : NO_THREAD_IDS
      }
      showWorkspace={showWorkspace}
      nowMs={nowMs}
    />
  );

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-y-auto overscroll-y-none scrollbar-gutter-both"
      data-boards-home
    >
      {isElectron ? (
        <WorkspacePageHeader electron />
      ) : (
        // Room for the floating sidebar button on phones.
        <WorkspacePageHeader className="md:hidden" />
      )}
      {content === "welcome" ? (
        <BoardsWelcome />
      ) : content === "loading" ? (
        <TinkjamLoading label="Loading your boards" />
      ) : (
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
          {/* Two rows: the title and what is the person's own, then what acts on the boards. */}
          <header className="flex flex-col gap-4" data-boards-home-header>
            <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
              {/* A basis, so the controls wrap under the title before they squeeze it. */}
              <div className="flex min-w-0 flex-1 basis-80 flex-col gap-1">
                <h1 className="line-clamp-2 text-2xl leading-tight font-semibold wrap-anywhere">
                  {workspace?.name ?? (scope === "personal" ? "My boards" : "Boards")}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Where you, your team and everyone's agents work on the same thing.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <Button variant="ghost-muted" render={<Link to="/whats-new" />} data-whats-new-link>
                  <MegaphoneIcon />
                  What's new
                  {whatsNew.unseen ? (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full bg-primary" />
                      <span className="sr-only">(new)</span>
                    </>
                  ) : null}
                </Button>
                <MyTasks />
                <InboxBell />
                <BoardsAccount />
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {workspaces === null ? null : (
                <WorkspaceSwitcher scope={scope} workspaces={workspaces} />
              )}
              {workspace === null ? null : <WorkspacePeople workspace={workspace} />}
              <div className="ms-auto flex w-full items-center gap-3 sm:w-auto">
                {all.length > 0 ? (
                  <label className="flex min-w-0 flex-1 items-center gap-2 sm:w-64 sm:flex-none">
                    <SearchIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <Input
                      type="search"
                      value={query}
                      placeholder="Search boards"
                      aria-label="Search boards"
                      onChange={(event) => setQuery(event.currentTarget.value)}
                    />
                  </label>
                ) : null}
                <Group aria-label="New board">
                  <Button
                    disabled={waiting}
                    aria-busy={waiting || undefined}
                    onClick={() => void startNewBoard()}
                    data-new-board
                  >
                    {newBoardIcon}
                    New board
                  </Button>
                  <GroupSeparator />
                  <Tooltip>
                    <TooltipTrigger
                      render={
                        <Button
                          size="icon"
                          aria-label="New board from a template"
                          onClick={openBoardTemplates}
                          data-new-board-template
                        />
                      }
                    >
                      <ChevronDownIcon />
                    </TooltipTrigger>
                    <TooltipPopup side="bottom">New board from a template</TooltipPopup>
                  </Tooltip>
                </Group>
              </div>
            </div>
          </header>
          <ConnectComputerNudge />
          <SignInNudge cloudBoards={joined.some(isCloudShare)} />
          {workspace !== null &&
          !searching &&
          (workspace.members.length === 1 || shown.length === 0) ? (
            <WorkspaceInvite workspace={workspace} />
          ) : null}
          {recent.length > 0 ? (
            <section className="flex flex-col gap-2" aria-label="Recent" data-boards-recent>
              <h2 className="text-sm font-medium text-muted-foreground">Recent</h2>
              <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {recent.map(tile)}
              </ul>
            </section>
          ) : null}
          <div className="flex items-center gap-2">
            {recent.length > 0 ? (
              <h2 className="text-sm font-medium text-muted-foreground">All boards</h2>
            ) : null}
            {all.length > 1 ? (
              <Menu>
                <MenuTrigger
                  render={<Button variant="ghost-muted" size="sm" className="ms-auto" />}
                  data-boards-sort
                >
                  <ArrowDownUpIcon />
                  {SORT_LABELS[sort]}
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuRadioGroup
                    value={sort}
                    onValueChange={(value) => {
                      const next = HOME_BOARD_SORTS.find((candidate) => candidate === value);
                      if (next === undefined) return;
                      setSort(next);
                      try {
                        setLocalStorageItem(SORT_KEY, next, SortSchema);
                      } catch {
                        // Blocked storage only forgets the order next time.
                      }
                    }}
                  >
                    {HOME_BOARD_SORTS.map((option) => (
                      <MenuRadioItem key={option} value={option} closeOnClick>
                        {SORT_LABELS[option]}
                      </MenuRadioItem>
                    ))}
                  </MenuRadioGroup>
                </MenuPopup>
              </Menu>
            ) : null}
          </div>
          {shown.length === 0 && searching ? (
            <p className="text-sm text-muted-foreground">No boards match "{query.trim()}".</p>
          ) : (
            <ul
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
              data-boards-grid
            >
              {!searching ? (
                <li>
                  <button
                    type="button"
                    disabled={waiting}
                    aria-busy={waiting || undefined}
                    className="group/new flex h-full min-h-48 w-full flex-col items-center justify-center gap-2.5 rounded-board border border-dashed border-foreground/20 text-sm font-medium text-foreground outline-none transition-colors hover:border-foreground/35 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                    onClick={() => void startNewBoard()}
                  >
                    <span
                      aria-hidden
                      className="grid size-8 place-items-center rounded-lg border border-board-hairline bg-card text-muted-foreground shadow-paint group-hover/new:text-foreground"
                    >
                      {waiting ? (
                        <Spinner aria-hidden size="md" />
                      ) : (
                        <PlusIcon className="size-4" />
                      )}
                    </span>
                    New board
                  </button>
                </li>
              ) : null}
              {shown.map(tile)}
            </ul>
          )}
          {searching ? null : <ViewedBoards />}
        </div>
      )}
    </SidebarInset>
  );
}

function BoardTile({
  board,
  projectName,
  summaryThreadIds,
  showWorkspace,
  nowMs,
}: {
  readonly board: HomeBoard;
  readonly projectName: string | undefined;
  /** The threads its machine's summary request names, the same list for every tile there. */
  readonly summaryThreadIds: ReadonlyArray<ThreadId>;
  /** Boards from several workspaces are shown, so each says which it is in. */
  readonly showWorkspace: boolean;
  readonly nowMs: number;
}) {
  const summary = useBoardSummary(board, summaryThreadIds);
  const teamShapes = useTeamBoardShapes(board.kind === "team" ? board.teamId : null);
  const navigate = useNavigate();
  const [opening, setOpening] = useState(false);
  // A board only the account lists gets a session here first, as the same person on it.
  const openRemote = async () => {
    if (board.kind !== "joined" || opening) return;
    setOpening(true);
    const opened = await openListedBoard(board);
    setOpening(false);
    if (typeof opened === "string") {
      toastManager.add({ type: "error", title: opened });
      return;
    }
    void navigate(guestShareLocation(opened));
  };
  const subtitle =
    board.kind === "own"
      ? projectName
      : board.kind === "joined"
        ? showWorkspace && board.workspaceName !== null
          ? board.workspaceName
          : board.cloud
            ? board.maker
              ? "Made by you"
              : "Shared with you"
            : board.owner === null
              ? "Shared with you"
              : `Shared by ${board.owner}`
        : "Team";
  const activity = board.openedAt === null ? null : boardTimeLabel(board.openedAt, nowMs);
  const shapes =
    board.kind === "own"
      ? summary?.shapes
      : board.kind === "team"
        ? teamShapes
        : decodeBoardPreview(board.preview);
  const live = summary !== null && summary.shared && summary.online > 0;
  const unread =
    useInboxCount()?.boards.includes(board.kind === "joined" ? board.shareId : "") === true;
  return (
    <li
      className="relative"
      data-board-tile
      data-board-kind={board.kind}
      data-board-live={live || undefined}
    >
      <Link
        {...tileLink(board)}
        {...(board.kind === "joined" && board.remote
          ? {
              onClick: (event: MouseEvent) => {
                event.preventDefault();
                void openRemote();
              },
              "aria-busy": opening || undefined,
            }
          : {})}
        className="flex h-full flex-col overflow-hidden rounded-board border border-board-hairline bg-card shadow-paint transition-shadow outline-none hover:shadow-board focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="border-b border-board-hairline">
          <BoardThumbnail
            shapes={shapes}
            paint={boardPaint(board.kind === "joined" ? board : { key: board.key })}
            seed={board.key}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1 p-3">
          <div className="flex min-w-0 items-center gap-2">
            {unread ? (
              <span
                className="size-2 shrink-0 rounded-full bg-primary"
                role="img"
                aria-label="Something new for you"
                data-board-unread
              />
            ) : null}
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" data-board-name>
              {board.title}
            </h2>
            {live ? (
              <BoardChip tone="success" data-board-live-mark>
                <span aria-hidden className="size-1.5 rounded-full bg-success" />
                Live
              </BoardChip>
            ) : null}
          </div>
          {subtitle === undefined ? null : (
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          )}
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            {summary === null ? null : (
              <span data-board-counts>
                {summary.cards} {summary.cards === 1 ? "card" : "cards"} · {summary.agentBoxes}{" "}
                {summary.agentBoxes === 1 ? "agent" : "agents"}
              </span>
            )}
            {activity === null ? null : (
              <span className="ms-auto shrink-0" data-board-activity>
                {activity}
              </span>
            )}
          </div>
          {summary === null || summary.people.length === 0 ? null : (
            <ul
              className="flex items-center -space-x-1.5 pt-1"
              aria-label="People on this board"
              data-board-people
            >
              {summary.people.slice(0, 5).map((name, index) => (
                <li
                  // oxlint-disable-next-line react/no-array-index-key -- two people can share a name
                  key={`${name}:${index}`}
                  className="flex size-6 items-center justify-center rounded-full text-2xs font-semibold text-white ring-2 ring-card"
                  style={{
                    backgroundColor: BOARD_PERSON_COLORS[index % BOARD_PERSON_COLORS.length],
                  }}
                >
                  <span aria-hidden>{initialsOf(name)}</span>
                  <span className="sr-only">{name}</span>
                </li>
              ))}
              {summary.people.length > 5 ? (
                <li className="ps-3 text-xs text-muted-foreground">+{summary.people.length - 5}</li>
              ) : null}
            </ul>
          )}
        </div>
      </Link>
      {board.kind === "joined" ? (
        <div className="absolute end-2 top-2">
          <JoinedBoardMenu board={board} />
        </div>
      ) : null}
    </li>
  );
}

/** The summary of an own board, from its machine's one request; null for other boards or before it arrives. */
function useBoardSummary(
  board: HomeBoard,
  threadIds: ReadonlyArray<ThreadId>,
): RoomBoardSummary | null {
  const { data } = useEnvironmentQuery(
    board.kind !== "own" || threadIds.length === 0
      ? null
      : serverEnvironment.roomBoardSummaries({
          environmentId: EnvironmentId.make(board.environmentId),
          input: { threadIds },
        }),
  );
  if (board.kind !== "own") return null;
  return data?.boards.find((summary) => summary.threadId === board.threadId) ?? null;
}

/** A team board's cards, read once from Tinkjam Connect as the board itself reads them. */
function useTeamBoardShapes(
  teamId: string | null,
): ReadonlyArray<RoomBoardSummaryShape> | undefined {
  const [read, setRead] = useState<{
    readonly teamId: string;
    readonly shapes: ReadonlyArray<RoomBoardSummaryShape>;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the team's board from Tinkjam Connect once for its tile
  useEffect(() => {
    if (teamId === null) return;
    let stopped = false;
    void readTeamBoard(teamId, null).then((result) => {
      if (stopped || !result.ok || result.value.board === null) return;
      setRead({ teamId, shapes: teamBoardShapes(result.value.board) });
    });
    return () => {
      stopped = true;
    };
  }, [teamId]);
  return read !== null && read.teamId === teamId ? read.shapes : undefined;
}

function tileLink(board: HomeBoard) {
  switch (board.kind) {
    case "own":
      return roomBoardLocation(
        scopeThreadRef(EnvironmentId.make(board.environmentId), ThreadId.make(board.threadId)),
      );
    case "joined":
      return sharedThreadLocationOf(board, board.cloud);
    case "team":
      return { to: "/teams/$teamId" as const, params: { teamId: board.teamId } };
  }
}

function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const letters = words.length > 1 ? [words[0]![0], words.at(-1)![0]] : [words[0]?.[0]];
  return letters.join("").toUpperCase();
}
