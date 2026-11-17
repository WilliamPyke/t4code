import { useAtomValue } from "@effect/atom-react";
import {
  guestEnvironmentId,
  isGuestEnvironment,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { Link, useLocation, useNavigate, useParams } from "@tanstack/react-router";
import { LayoutGridIcon, PlusIcon } from "lucide-react";

import { accountBoardsAtom, guestSharesAtom, isCloudShare } from "~/guest/guestShares";
import { openListedBoard, useWorkspaceScope, useWorkspaces } from "~/guest/workspaces";
import { cn } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";

import {
  boardPaint,
  boardsInScope,
  joinedBoardSources,
  listHomeBoards,
  sortHomeBoards,
  withWorkspaceBoards,
} from "../boards/boardsHome.logic";
import { useNewBoardWaiting, useStartNewBoard } from "../boards/newBoard";
import { JoinedBoardMenu } from "../boards/removeJoinedBoard";
import { roomBoardLocation } from "../room/roomBoardNavigation";
import { paintSwatchClassName } from "../room/RoomNoteColor";
import { Button } from "../ui/button";
import { Spinner } from "../ui/spinner";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";

// Kept short: the section sits above the thread list, which keeps the rest of the height.
const RECENT_BOARDS = 3;

/**
 * Boards first: the way home to every board, the few most recently active, and a new one. Threads
 * follow under their own heading.
 */
export function BoardsSection({ canStart }: { readonly canStart: boolean }) {
  const threads = useThreadShells();
  const joined = useAtomValue(guestSharesAtom);
  const accountBoards = useAtomValue(accountBoardsAtom);
  const workspaces = useWorkspaces();
  const scope = useWorkspaceScope();
  const navigate = useNavigate();
  const startNewBoard = useStartNewBoard();
  const waiting = useNewBoardWaiting();
  const atHome = useLocation({ select: (location) => location.pathname === "/" });
  const openBoard = useParams({
    strict: false,
    select: (params) =>
      params.roomThreadId ??
      (isGuestEnvironment(params.environmentId) ? params.threadId : null) ??
      null,
  });
  // The home's workspace decides which boards these are.
  const recent = sortHomeBoards(
    boardsInScope(
      listHomeBoards({
        threads,
        // Signed in, the account's and its workspaces' boards too, before any is opened here.
        joined: withWorkspaceBoards(
          joinedBoardSources({
            // A board only looked at from a view link is not one of theirs: it is under Viewed.
            local: joined
              .filter((share) => share.viewOnly !== true)
              .map((share) => ({
                ...share,
                cloud: isCloudShare(share),
                maker: share.made === true,
              })),
            listed: accountBoards,
          }),
          workspaces,
        ),
        teams: [],
        isOwnEnvironment: (environmentId) => !isGuestEnvironment(environmentId),
      }),
      scope,
    ),
    "recent",
  ).slice(0, RECENT_BOARDS);
  const scopeName =
    scope === "all"
      ? "All boards"
      : scope === "personal"
        ? "My boards"
        : (workspaces?.find((workspace) => workspace.id === scope)?.name ?? "All boards");
  return (
    <div aria-label="Boards" role="group" className="pb-1" data-sidebar-boards>
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-xs font-medium text-muted-foreground">Boards</p>
        {canStart ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="New board"
            disabled={waiting}
            aria-busy={waiting || undefined}
            onClick={() => void startNewBoard()}
          >
            {waiting ? <Spinner aria-hidden /> : <PlusIcon />}
          </Button>
        ) : null}
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="sm" isActive={atHome} render={<Link to="/" />}>
            <LayoutGridIcon aria-hidden />
            <span className="min-w-0 truncate">{scopeName}</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
        {recent.map((board) =>
          board.kind === "team" ? null : (
            <SidebarMenuItem key={board.key}>
              <SidebarMenuButton
                size="sm"
                isActive={openBoard === board.threadId}
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
                      to="/$environmentId/$threadId"
                      params={{
                        environmentId: guestEnvironmentId(board.shareId),
                        threadId: board.threadId,
                      }}
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
                                void navigate({
                                  to: "/$environmentId/$threadId",
                                  params: {
                                    environmentId: guestEnvironmentId(opened.shareId),
                                    threadId: opened.threadId,
                                  },
                                });
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
                    "mx-0.5 size-3 shrink-0 rounded-xs ring-1 ring-foreground/10",
                    paintSwatchClassName(
                      boardPaint(board.kind === "joined" ? board : { key: board.key }),
                    ),
                  )}
                />
                <span className="min-w-0 truncate">{board.title}</span>
              </SidebarMenuButton>
              {board.kind === "joined" ? (
                <div className="absolute end-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/menu-item:opacity-100 has-[[data-popup-open]]:opacity-100 focus-within:opacity-100">
                  <JoinedBoardMenu board={board} size="icon-micro" variant="ghost-muted" />
                </div>
              ) : null}
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </div>
  );
}
