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
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { ChevronDownIcon, PlusIcon, SearchIcon } from "lucide-react";
import { type MouseEvent, useEffect, useId, useLayoutEffect, useState } from "react";

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
import { cn } from "~/lib/utils";
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

import { BOARD_PERSON_COLORS } from "../room/roomBoard.logic";
import { roomBoardLocation } from "../room/roomBoardNavigation";
import { AvatarStack } from "../ui/avatar";
import { Badge } from "../ui/badge";
import { Button, InlineButton } from "../ui/button";
import { Group, GroupSeparator } from "../ui/group";
import { InputGroup, InputGroupAddon, InputGroupInput } from "../ui/input-group";
import { Menu, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../ui/menu";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { TinkjamLoading } from "../TinkjamLoading";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardsWelcome } from "./BoardsWelcome";
import { FirstRun, useFirstRunSteps } from "./FirstRun";
import { ConnectComputerNudge } from "./ConnectComputerNudge";
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
import { noteHomeShown, useFirstRunFocusOffered } from "./homeFocus";
import { BLANK_BOARD_TEMPLATE, boardTemplateShapes } from "./boardTemplates";
import {
  openBoardTemplates,
  useNewBoardWaiting,
  useOfferedTemplates,
  useStartNewBoard,
} from "./newBoard";
import { JoinedBoardMenu } from "./removeJoinedBoard";
import { WorkspaceInvite, WorkspacePeople } from "./Workspaces";

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
  // The home is only drawn at "/": any other address is a page still loading.
  const leaving = useLocation({ select: (location) => location.pathname !== "/" });
  const content = homeContent({
    // A board only looked at from a view link (the sample) leaves the welcome in place.
    boards: all.length,
    workspaces: workspaces?.length ?? 0,
    machinesLoaded: bootstrapped,
    accountLoaded: accountSettled,
    welcomed,
    leaving,
  });
  if (content === "welcome" && !welcomed) setWelcomed(true);
  // Before paint, so the sidebar the app shell holds back arrives in the frame the boards do.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- tells the app shell, which draws the sidebar around this page, whether the home has boards to list
  useLayoutEffect(() => noteHomeShown(content), [content]);
  const alone = useFirstRunFocusOffered() && content !== "boards";
  const firstRunSteps = useFirstRunSteps();
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
  const boardsHeadingId = useId();
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

  const peopleCount = workspace?.members.length ?? 0;

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-y-auto overscroll-y-none scrollbar-gutter-both"
      data-boards-home
    >
      {isElectron ? (
        <WorkspacePageHeader electron />
      ) : alone ? null : (
        // Room for the floating sidebar button on phones.
        <WorkspacePageHeader className="md:hidden" />
      )}
      {content === "welcome" ? (
        firstRunSteps ? (
          <FirstRun />
        ) : (
          <BoardsWelcome />
        )
      ) : content === "loading" ? (
        alone ? (
          <TinkjamLoading label="Loading your boards" />
        ) : (
          <BoardsHomeSkeleton />
        )
      ) : (
        <div
          className="@container flex w-full flex-col gap-6.5 px-4 pt-3 pb-8 sm:px-6 md:pt-7 lg:px-10"
          data-boards-home-content
        >
          <header
            className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4"
            data-boards-home-header
          >
            {/* A basis, so the controls wrap under the title before they squeeze it. */}
            <div className="flex min-w-0 flex-1 basis-60 flex-col">
              {workspace === null ? null : (
                <p className="text-ui-sm text-quiet" data-boards-home-crumb>
                  Workspace · {peopleCount} {peopleCount === 1 ? "person" : "people"}
                </p>
              )}
              <h1 className="mt-0.5 line-clamp-2 font-heading text-heading-sm font-semibold tracking-heading text-foreground wrap-anywhere sm:text-heading">
                {workspace?.name ?? (scope === "personal" ? "My boards" : "All boards")}
              </h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {workspace === null ? null : <WorkspacePeople workspace={workspace} />}
              <Group aria-label="New board">
                <Button
                  size="md"
                  disabled={waiting}
                  aria-busy={waiting || undefined}
                  onClick={() => void startNewBoard()}
                  data-new-board
                >
                  {waiting ? <Spinner aria-hidden /> : null}
                  New board
                </Button>
                <GroupSeparator />
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        size="md"
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
          </header>
          <ConnectComputerNudge />
          <SignInNudge cloudBoards={joined.some(isCloudShare)} />
          {workspace !== null &&
          !searching &&
          (workspace.members.length === 1 || shown.length === 0) ? (
            <WorkspaceInvite workspace={workspace} />
          ) : null}
          {searching ? null : <TemplateRow />}
          <section className="flex flex-col gap-3" aria-labelledby={boardsHeadingId}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <h2 id={boardsHeadingId} className="text-ui-md font-semibold text-foreground">
                {searching ? "Search results" : "Boards"}
              </h2>
              <div className="ms-auto flex w-full items-center gap-2 sm:w-auto">
                {all.length > 0 ? (
                  <InputGroup className="min-w-0 flex-1 sm:w-56 sm:flex-none">
                    <InputGroupAddon>
                      <SearchIcon aria-hidden />
                    </InputGroupAddon>
                    <InputGroupInput
                      type="search"
                      value={query}
                      placeholder="Search boards"
                      aria-label="Search boards"
                      onChange={(event) => setQuery(event.currentTarget.value)}
                      data-boards-search
                    />
                  </InputGroup>
                ) : null}
                {all.length > 1 ? (
                  <Menu>
                    <MenuTrigger
                      render={<Button variant="ghost-muted" size="sm" />}
                      data-boards-sort
                    >
                      {SORT_LABELS[sort]}
                      <ChevronDownIcon />
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
            </div>
            {shown.length === 0 && searching ? (
              <p className="text-sm text-muted-foreground" data-boards-no-match>
                No boards match "{query.trim()}". Try another word.
              </p>
            ) : (
              <ul
                className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @lg:gap-4.5 @3xl:grid-cols-3 @5xl:grid-cols-4"
                data-boards-grid
              >
                {!searching ? (
                  <li className="hidden @lg:block">
                    <button
                      type="button"
                      disabled={waiting}
                      aria-busy={waiting || undefined}
                      className="group/new flex h-full min-h-48 w-full flex-col items-center justify-center gap-2.5 rounded-tile border border-dashed border-rule text-sm font-semibold text-foreground outline-none transition-colors hover:border-quiet/60 hover:bg-raised focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                      onClick={() => void startNewBoard()}
                    >
                      <span
                        aria-hidden
                        className="grid size-10 place-items-center rounded-xl bg-accent-tint text-accent-text"
                      >
                        {waiting ? (
                          <Spinner aria-hidden size="md" />
                        ) : (
                          <PlusIcon className="size-4.5" />
                        )}
                      </span>
                      New board
                    </button>
                  </li>
                ) : null}
                {shown.map(tile)}
              </ul>
            )}
          </section>
          {recent.length > 0 ? (
            <section className="flex flex-col gap-3" aria-label="Recent" data-boards-recent>
              <h2 className="text-ui-md font-semibold text-foreground">Recently opened</h2>
              <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @lg:gap-4.5 @3xl:grid-cols-3 @5xl:grid-cols-4">
                {recent.map(tile)}
              </ul>
            </section>
          ) : null}
          {searching ? null : <ViewedBoards />}
        </div>
      )}
    </SidebarInset>
  );
}

/** Where the home's content goes while the boards load: its shape, still, without a shimmer. */
function BoardsHomeSkeleton() {
  return (
    <div
      className="@container flex w-full flex-col gap-6.5 px-4 pt-3 pb-8 sm:px-6 md:pt-7 lg:px-10"
      aria-busy
      aria-label="Loading your boards"
      role="status"
      data-boards-home-skeleton
    >
      <div className="flex items-end justify-between gap-6">
        <div className="flex flex-col gap-2">
          <span className="h-3.5 w-36 rounded-full bg-panel" />
          <span className="h-8 w-56 rounded-lg bg-panel" />
        </div>
        <span className="h-9.5 w-36 rounded-full bg-panel" />
      </div>
      <ul className="grid grid-cols-1 gap-3 @lg:grid-cols-2 @lg:gap-4.5 @3xl:grid-cols-3 @5xl:grid-cols-4">
        {SKELETON_TILES.map((key) => (
          <li
            key={key}
            className="flex flex-row gap-3 overflow-hidden rounded-tile border border-rule bg-raised p-2 @lg:flex-col @lg:gap-0 @lg:p-0"
          >
            <span className="aspect-[16/10] w-21 shrink-0 rounded-lg bg-panel @lg:w-full @lg:rounded-none" />
            <span className="flex flex-1 flex-col gap-2 py-1 @lg:px-3.5 @lg:pt-3.5 @lg:pb-4">
              <span className="h-3.5 w-2/3 rounded-full bg-panel" />
              <span className="h-3 w-1/2 rounded-full bg-panel" />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const SKELETON_TILES = ["a", "b", "c", "d"];

/** The first few templates New board offers, one click to a board from each, and the rest. */
function TemplateRow() {
  const { templates, place } = useOfferedTemplates();
  const startNewBoard = useStartNewBoard();
  const waiting = useNewBoardWaiting();
  const cloud = place === "cloud";
  return (
    <section className="hidden flex-col gap-3 sm:flex" aria-labelledby={TEMPLATES_HEADING}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 id={TEMPLATES_HEADING} className="text-ui-md font-semibold text-foreground">
          Start from a template
        </h2>
        <InlineButton tone="accent" onClick={openBoardTemplates} data-all-templates>
          All {templates.length} templates
        </InlineButton>
      </div>
      <ul
        className="grid grid-cols-3 gap-3.5 @3xl:grid-cols-4 @5xl:grid-cols-6"
        data-home-templates
      >
        {templates.slice(0, 6).map((template, index) => (
          <li
            key={template.id}
            className={cn(
              index >= 3 && "hidden @3xl:block",
              index >= 4 && "@3xl:hidden @5xl:block",
            )}
          >
            <button
              type="button"
              disabled={waiting}
              className="group/template flex w-full flex-col gap-2 rounded-xl text-start outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              onClick={() => void startNewBoard(template, place)}
              data-home-template={template.id}
            >
              {template.id === BLANK_BOARD_TEMPLATE.id ? (
                <span className="grid aspect-[240/116] w-full place-items-center rounded-xl border border-dashed border-rule bg-background text-quiet transition-colors group-hover/template:border-quiet/60 group-hover/template:text-foreground">
                  <PlusIcon aria-hidden className="size-4.5" />
                </span>
              ) : (
                <span className="overflow-hidden rounded-xl border border-rule transition-shadow group-hover/template:shadow-float">
                  <BoardThumbnail shapes={boardTemplateShapes(template, cloud)} ratio="strip" />
                </span>
              )}
              <span className="truncate text-ui-sm font-semibold text-foreground">
                {template.name}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const TEMPLATES_HEADING = "boards-home-templates";

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
  const relation =
    board.kind === "own"
      ? projectName
      : board.kind === "joined"
        ? board.cloud
          ? board.maker
            ? "Made by you"
            : "Shared with you"
          : board.owner === null
            ? "Shared with you"
            : `Shared by ${board.owner}`
        : "Team";
  const subtitle = [board.kind === "joined" && showWorkspace ? board.workspaceName : null, relation]
    .filter((part): part is string => part !== null && part !== undefined && part !== "")
    .join(" · ");
  const activity = board.openedAt === null ? null : boardTimeLabel(board.openedAt, nowMs);
  const counts =
    summary === null
      ? null
      : `${summary.cards} ${summary.cards === 1 ? "card" : "cards"} · ${summary.agentBoxes} ${
          summary.agentBoxes === 1 ? "agent" : "agents"
        }`;
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
        className="flex h-full flex-row items-center gap-3 overflow-hidden rounded-tile border border-rule bg-raised p-2 outline-none transition-shadow hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset @lg:flex-col @lg:items-stretch @lg:gap-0 @lg:p-0"
      >
        <div className="w-21 shrink-0 overflow-hidden rounded-lg border border-rule @lg:w-auto @lg:rounded-none @lg:border-0 @lg:border-b">
          <BoardThumbnail
            shapes={shapes}
            paint={boardPaint(board.kind === "joined" ? board : { key: board.key })}
            seed={board.key}
            ratio="tile"
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col pe-8 @lg:px-3.5 @lg:pt-3 @lg:pb-3.5">
          <div className="flex min-w-0 items-center gap-2">
            {unread ? (
              <span
                className="size-1.75 shrink-0 rounded-full bg-primary"
                role="img"
                aria-label="Something new for you"
                data-board-unread
              />
            ) : null}
            <h3
              className="min-w-0 flex-1 truncate text-ui-md font-semibold text-foreground"
              data-board-name
            >
              {board.title}
            </h3>
            {live ? (
              <Badge variant="live" size="status" data-board-live-mark>
                Live
              </Badge>
            ) : null}
          </div>
          {subtitle === "" ? null : (
            <p className="mt-0.5 truncate text-ui-sm text-quiet">{subtitle}</p>
          )}
          <div className="mt-1 flex min-h-6 min-w-0 items-center gap-2 text-xs text-quiet @lg:mt-3">
            <span className="min-w-0 truncate">
              {counts === null ? null : <span data-board-counts>{counts}</span>}
              {counts !== null && activity !== null ? " · " : null}
              {activity === null ? null : <span data-board-activity>{activity}</span>}
            </span>
            {summary === null || summary.people.length === 0 ? null : (
              <AvatarStack
                className="ms-auto hidden shrink-0 @lg:flex"
                label="People on this board"
                size="sm"
                max={4}
                people={summary.people.map((name, index) => ({
                  key: `${name}:${index}`,
                  name,
                  color: BOARD_PERSON_COLORS[index % BOARD_PERSON_COLORS.length]!,
                }))}
              />
            )}
          </div>
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
