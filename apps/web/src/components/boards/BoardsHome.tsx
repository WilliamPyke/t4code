import { useAtomValue } from "@effect/atom-react";
import {
  guestEnvironmentId,
  isGuestEnvironment,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  EnvironmentId,
  ROOM_BOARD_SUMMARY_MAX_BOARDS,
  ThreadId,
  type RoomBoardSummary,
} from "@t3tools/contracts";
import { Link } from "@tanstack/react-router";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useState } from "react";

import { isElectron } from "~/env";
import { guestSharesAtom } from "~/guest/guestShares";
import { useNowMinute } from "~/hooks/useNowMinute";
import { workspaceAreaProps } from "~/lib/workspaceFocus";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useTeams } from "~/teams/teams";
import { formatRelativeTimeLabel } from "~/timestampFormat";

import { BoardBackdrop, BoardChip } from "../room/BoardChrome";
import { BOARD_PERSON_COLORS } from "../room/roomBoard.logic";
import { roomBoardLocation } from "../room/roomBoardNavigation";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { BoardThumbnail } from "./BoardThumbnail";
import { type HomeBoard, listHomeBoards } from "./boardsHome.logic";
import { useStartNewBoard } from "./newBoard";

const NO_THREAD_IDS: ReadonlyArray<ThreadId> = [];

/** Every board the user has, most recently active first, and the way to start one. */
export function BoardsHome() {
  const threads = useThreadShells();
  const projects = useProjects();
  const joined = useAtomValue(guestSharesAtom);
  const { teams } = useTeams();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const startNewBoard = useStartNewBoard();
  const [query, setQuery] = useState("");
  const projectName = (environmentId: string, projectId: string) =>
    projects.find((project) => project.environmentId === environmentId && project.id === projectId)
      ?.title;
  const sources = {
    threads,
    joined,
    teams: teams ?? [],
    isOwnEnvironment: (environmentId: string) => !isGuestEnvironment(environmentId),
    projectName,
  };
  const all = listHomeBoards(sources);
  const shown = query.trim() === "" ? all : listHomeBoards({ ...sources, query });
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

  return (
    <SidebarInset
      {...contentArea}
      role="main"
      className="h-dvh min-h-0 overflow-y-auto overscroll-y-none scrollbar-gutter-both"
      data-boards-home
    >
      {isElectron ? <WorkspacePageHeader electron /> : null}
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6">
        <header className="flex flex-wrap items-center gap-3" data-boards-home-header>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="text-2xl leading-tight font-semibold">Boards</h1>
            <p className="text-sm text-muted-foreground">
              Where you, your team and everyone's agents work on the same thing.
            </p>
          </div>
          {all.length > 0 ? (
            <label className="flex w-full items-center gap-2 sm:w-64">
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
          <Button onClick={() => void startNewBoard()} data-new-board>
            <PlusIcon />
            New board
          </Button>
        </header>
        {all.length === 0 ? (
          bootstrapped ? (
            <BoardBackdrop className="flex min-h-80 flex-col rounded-board border border-board-hairline">
              <Empty data-boards-empty>
                <div className="rounded-board border border-board-hairline bg-card px-8 py-7 text-card-foreground shadow-board">
                  <EmptyHeader className="max-w-md">
                    <EmptyTitle>Start your first board</EmptyTitle>
                    <EmptyDescription>
                      A board is where you and your agents work together: notes, thread boxes and
                      what they make, side by side. Share it when you want others in.
                    </EmptyDescription>
                    <div className="mt-5 flex justify-center">
                      <Button onClick={() => void startNewBoard()}>
                        <PlusIcon />
                        New board
                      </Button>
                    </div>
                  </EmptyHeader>
                </div>
              </Empty>
            </BoardBackdrop>
          ) : null
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">No boards match "{query.trim()}".</p>
        ) : (
          <ul
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
            data-boards-grid
          >
            {query.trim() === "" ? (
              <li>
                <button
                  type="button"
                  className="group/new flex h-full min-h-48 w-full flex-col items-center justify-center gap-2.5 rounded-board border border-dashed border-foreground/20 text-sm font-medium text-foreground outline-none transition-colors hover:border-foreground/35 hover:bg-card focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => void startNewBoard()}
                >
                  <span
                    aria-hidden
                    className="grid size-8 place-items-center rounded-lg border border-board-hairline bg-card text-muted-foreground shadow-paint group-hover/new:text-foreground"
                  >
                    <PlusIcon className="size-4" />
                  </span>
                  New board
                </button>
              </li>
            ) : null}
            {shown.map((board) => (
              <BoardTile
                key={board.key}
                board={board}
                projectName={
                  board.kind === "own"
                    ? projectName(board.environmentId, board.projectId)
                    : undefined
                }
                summaryThreadIds={
                  board.kind === "own"
                    ? (threadIdsByEnvironment.get(board.environmentId) ?? NO_THREAD_IDS)
                    : NO_THREAD_IDS
                }
                nowMs={nowMs}
              />
            ))}
          </ul>
        )}
      </div>
    </SidebarInset>
  );
}

function BoardTile({
  board,
  projectName,
  summaryThreadIds,
  nowMs,
}: {
  readonly board: HomeBoard;
  readonly projectName: string | undefined;
  /** The threads its machine's summary request names, the same list for every tile there. */
  readonly summaryThreadIds: ReadonlyArray<ThreadId>;
  readonly nowMs: number;
}) {
  const summary = useBoardSummary(board, summaryThreadIds);
  const subtitle =
    board.kind === "own"
      ? projectName
      : board.kind === "joined"
        ? board.owner === null
          ? "Shared with you"
          : `Shared by ${board.owner}`
        : "Team";
  const activity =
    board.activityAt === null ? null : formatRelativeTimeLabel(board.activityAt, nowMs) || null;
  const live = summary !== null && summary.shared && summary.online > 0;
  return (
    <li data-board-tile data-board-kind={board.kind} data-board-live={live || undefined}>
      <Link
        {...tileLink(board)}
        className="flex h-full flex-col overflow-hidden rounded-board border border-board-hairline bg-card shadow-paint transition-shadow outline-none hover:shadow-board focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="border-b border-board-hairline">
          <BoardThumbnail shapes={summary?.shapes} />
        </div>
        <div className="flex min-w-0 flex-col gap-1 p-3">
          <div className="flex min-w-0 items-center gap-2">
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

function tileLink(board: HomeBoard) {
  switch (board.kind) {
    case "own":
      return roomBoardLocation(
        scopeThreadRef(EnvironmentId.make(board.environmentId), ThreadId.make(board.threadId)),
      );
    case "joined":
      return {
        to: "/$environmentId/$threadId" as const,
        params: { environmentId: guestEnvironmentId(board.shareId), threadId: board.threadId },
      };
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
