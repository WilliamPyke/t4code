import { useAtomValue } from "@effect/atom-react";
import { isGuestEnvironment, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LayoutGridIcon, PlusIcon, SearchIcon, StickyNoteIcon } from "lucide-react";

import { openCommandPalette } from "~/commandPaletteBus";
import { sharedThreadLocationOf } from "~/guest/boardAddress";
import { guestShareLocation } from "~/guest/guestShares";
import {
  type WorkspaceScope,
  openListedBoard,
  setWorkspaceScope,
  useWorkspaceScope,
  useWorkspaces,
} from "~/guest/workspaces";
import { shortcutLabelForCommand } from "~/keybindings";
import { cn } from "~/lib/utils";
import { primaryServerKeybindingsAtom } from "~/state/server";

import { boardPaint, boardsInScope, sortHomeBoards } from "../boards/boardsHome.logic";
import { useListedBoards } from "../boards/homeFocus";
import { InboxBell } from "../boards/InboxBell";
import { MyTasks } from "../boards/MyTasks";
import { useNewBoardWaiting, useStartNewBoard } from "../boards/newBoard";
import { JoinedBoardMenu } from "../boards/removeJoinedBoard";
import { NewWorkspaceButton, WorkspaceMark } from "../boards/Workspaces";
import { roomBoardLocation } from "../room/roomBoardNavigation";
import { paintSwatchClassName } from "../room/RoomNoteColor";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardOutline, BoardOutlineToggle, useExpandedBoards } from "./BoardOutline";

// Kept short: the section sits above the thread list, which keeps the rest of the height.
const RECENT_BOARDS = 3;

/** A small caps label over a group of rows, with an optional action at its end. */
function SidebarLabel({ children, action }: { children: string; action?: ReactNode }) {
  return (
    <div className="flex h-7 items-center justify-between ps-2.5 pe-1 pt-3 pb-1.5">
      <p className="text-2xs font-semibold tracking-caps text-sidebar-muted-foreground uppercase">
        {children}
      </p>
      {action}
    </div>
  );
}

/**
 * The way around the boards: search, every board or one's own, tasks and the inbox, the
 * workspaces, the few boards most recently open, and a new one. Threads follow in Advanced.
 */
export function BoardsSection({ canStart }: { readonly canStart: boolean }) {
  const boards = useListedBoards();
  const workspaces = useWorkspaces();
  const scope = useWorkspaceScope();
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const startNewBoard = useStartNewBoard();
  const waiting = useNewBoardWaiting();
  const expandedBoards = useExpandedBoards();
  const keybindings = useAtomValue(primaryServerKeybindingsAtom);
  const searchShortcut = shortcutLabelForCommand(keybindings, "commandPalette.toggle");
  const atHome = useLocation({ select: (location) => location.pathname === "/" });
  const openBoard = useParams({
    strict: false,
    select: (params) =>
      params.roomThreadId ??
      (isGuestEnvironment(params.environmentId) ? params.threadId : null) ??
      null,
  });
  // The home's workspace decides which boards these are.
  const recent = sortHomeBoards(boardsInScope(boards, scope), "recent").slice(0, RECENT_BOARDS);
  const closeMobile = () => {
    if (isMobile) setOpenMobile(false);
  };
  const showScope = (next: WorkspaceScope) => {
    setWorkspaceScope(next);
    closeMobile();
    if (!atHome) void navigate({ to: "/" });
  };
  return (
    <div aria-label="Boards" role="group" className="flex flex-col pb-1" data-sidebar-boards>
      <button
        type="button"
        className="mb-2.5 flex h-9 w-full items-center gap-2 rounded-board border border-sidebar-border bg-card px-2.5 text-ui-sm text-sidebar-muted-foreground outline-none transition-colors hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={() => {
          closeMobile();
          openCommandPalette();
        }}
        data-sidebar-search
      >
        <SearchIcon aria-hidden className="size-4.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate text-start">Search boards</span>
        {searchShortcut === null ? null : (
          <kbd className="font-sans text-2xs text-sidebar-muted-foreground">{searchShortcut}</kbd>
        )}
      </button>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton
            size="nav"
            variant="nav"
            isActive={atHome && scope === "all"}
            render={<Link to="/" />}
            onClick={() => {
              setWorkspaceScope("all");
              closeMobile();
            }}
            data-sidebar-all-boards
          >
            <LayoutGridIcon aria-hidden />
            <span className="min-w-0 truncate">All boards</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {workspaces === null ? null : (
          <SidebarMenuItem>
            <SidebarMenuButton
              size="nav"
              variant="nav"
              isActive={atHome && scope === "personal"}
              onClick={() => showScope("personal")}
              data-sidebar-my-boards
            >
              <StickyNoteIcon aria-hidden />
              <span className="min-w-0 truncate">My boards</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        )}
        <MyTasks presentation="sidebar" />
        <InboxBell presentation="sidebar" />
      </SidebarMenu>
      {workspaces === null ? null : (
        <>
          <SidebarLabel action={<NewWorkspaceButton />}>Workspaces</SidebarLabel>
          <SidebarMenu data-sidebar-workspaces>
            {workspaces.map((workspace) => (
              <SidebarMenuItem key={workspace.id}>
                <SidebarMenuButton
                  size="nav"
                  variant="selectable"
                  isActive={scope === workspace.id}
                  onClick={() => showScope(workspace.id)}
                  data-sidebar-workspace={workspace.id}
                >
                  <WorkspaceMark name={workspace.name} color={workspace.color} />
                  <span className="min-w-0 truncate">{workspace.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </>
      )}
      {recent.length === 0 && !canStart ? null : (
        <SidebarLabel
          action={
            canStart ? (
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      size="icon-xs"
                      variant="ghost-muted"
                      aria-label="New board"
                      disabled={waiting}
                      aria-busy={waiting || undefined}
                      onClick={() => void startNewBoard()}
                      data-sidebar-new-board
                    />
                  }
                >
                  {waiting ? <Spinner aria-hidden /> : <PlusIcon />}
                </TooltipTrigger>
                <TooltipPopup side="right">New board</TooltipPopup>
              </Tooltip>
            ) : undefined
          }
        >
          Recent
        </SidebarLabel>
      )}
      <SidebarMenu data-sidebar-recent>
        {recent.map((board) =>
          board.kind === "team" ? null : (
            <SidebarMenuItem
              key={board.key}
              data-expanded={expandedBoards.includes(board.key) ? "" : undefined}
            >
              <SidebarMenuButton
                size="nav"
                variant="nav"
                isActive={openBoard === board.threadId}
                onClick={closeMobile}
                render={
                  board.kind === "own" ? (
                    <Link
                      {...roomBoardLocation(
                        scopeThreadRef(
                          EnvironmentId.make(board.environmentId),
                          ThreadId.make(board.threadId),
                        ),
                      )}
                    />
                  ) : (
                    <Link
                      {...sharedThreadLocationOf(board, board.cloud)}
                      {...(board.remote
                        ? {
                            // Only the account lists it: a session here first, as the same person.
                            onClick: (event) => {
                              event.preventDefault();
                              void openListedBoard(board).then((opened) => {
                                if (typeof opened === "string") {
                                  toastManager.add({ type: "error", title: opened });
                                  return;
                                }
                                void navigate(guestShareLocation(opened));
                              });
                            },
                          }
                        : {})}
                    />
                  )
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-3.5 w-5 shrink-0 rounded-sm border-2 border-sidebar-muted-foreground/60",
                    // The outline's chevron takes the board's mark's place whenever it shows.
                    "group-hover/menu-item:invisible group-focus-within/menu-item:invisible group-data-[expanded]/menu-item:invisible pointer-coarse:invisible",
                    paintSwatchClassName(
                      boardPaint(board.kind === "joined" ? board : { key: board.key }),
                    ),
                  )}
                />
                <span className="min-w-0 truncate">{board.title}</span>
              </SidebarMenuButton>
              {/* Over the mark, in the row itself: the item grows once its outline is open. */}
              <div className="absolute start-[calc(var(--sidebar-row-content-inset)-2px)] top-0 flex h-[34px] items-center opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 group-data-[expanded]/menu-item:opacity-100 pointer-coarse:h-10 pointer-coarse:opacity-100">
                <BoardOutlineToggle board={board} expanded={expandedBoards.includes(board.key)} />
              </div>
              {board.kind === "joined" ? (
                <div className="absolute end-1 top-0 flex h-[34px] items-center opacity-0 group-hover/menu-item:opacity-100 has-[[data-popup-open]]:opacity-100 focus-within:opacity-100 pointer-coarse:h-10">
                  <JoinedBoardMenu board={board} size="icon-micro" variant="ghost-muted" />
                </div>
              ) : null}
              {expandedBoards.includes(board.key) ? (
                <BoardOutline board={board} open={openBoard === board.threadId} />
              ) : null}
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </div>
  );
}
