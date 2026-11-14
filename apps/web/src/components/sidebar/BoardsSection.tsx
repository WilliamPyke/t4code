import { useAtomValue } from "@effect/atom-react";
import {
  guestEnvironmentId,
  isGuestEnvironment,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ROOM_BOARD_NOTE_COLORS, ThreadId } from "@t3tools/contracts";
import { Link, useLocation, useParams } from "@tanstack/react-router";
import { LayoutGridIcon, PlusIcon } from "lucide-react";

import { guestSharesAtom } from "~/guest/guestShares";
import { cn } from "~/lib/utils";
import { useThreadShells } from "~/state/entities";

import { listHomeBoards } from "../boards/boardsHome.logic";
import { useStartNewBoard } from "../boards/newBoard";
import { roomBoardLocation } from "../room/roomBoardNavigation";
import { paintSwatchClassName } from "../room/RoomNoteColor";
import { Button } from "../ui/button";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

// Kept short: the section sits above the thread list, which keeps the rest of the height.
const RECENT_BOARDS = 3;

/** A paint each board keeps, so recent boards are told apart at a glance. */
const boardPaint = (key: string) => {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return ROOM_BOARD_NOTE_COLORS[Math.abs(hash) % ROOM_BOARD_NOTE_COLORS.length];
};

/**
 * Boards first: the way home to every board, the few most recently active, and a new one. Threads
 * follow under their own heading.
 */
export function BoardsSection({ canStart }: { readonly canStart: boolean }) {
  const threads = useThreadShells();
  const joined = useAtomValue(guestSharesAtom);
  const startNewBoard = useStartNewBoard();
  const atHome = useLocation({ select: (location) => location.pathname === "/" });
  const openBoard = useParams({
    strict: false,
    select: (params) =>
      params.roomThreadId ??
      (isGuestEnvironment(params.environmentId) ? params.threadId : null) ??
      null,
  });
  const recent = listHomeBoards({
    threads,
    joined,
    teams: [],
    isOwnEnvironment: (environmentId) => !isGuestEnvironment(environmentId),
  }).slice(0, RECENT_BOARDS);
  return (
    <div aria-label="Boards" role="group" className="pb-1" data-sidebar-boards>
      <div className="flex items-center justify-between px-2 pb-1">
        <p className="text-xs font-medium text-muted-foreground">Boards</p>
        {canStart ? (
          <Button
            size="icon-xs"
            variant="ghost-muted"
            aria-label="New board"
            onClick={() => void startNewBoard()}
          >
            <PlusIcon />
          </Button>
        ) : null}
      </div>
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="sm" isActive={atHome} render={<Link to="/" />}>
            <LayoutGridIcon aria-hidden />
            <span className="min-w-0 truncate">All boards</span>
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
                    />
                  )
                }
              >
                <span
                  aria-hidden
                  className={cn(
                    "mx-0.5 size-3 shrink-0 rounded-xs ring-1 ring-foreground/10",
                    paintSwatchClassName(boardPaint(board.key)),
                  )}
                />
                <span className="min-w-0 truncate">{board.title}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ),
        )}
      </SidebarMenu>
    </div>
  );
}
