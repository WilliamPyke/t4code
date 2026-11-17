import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import { useNavigate, useParams } from "@tanstack/react-router";
import { EllipsisIcon, LogOutIcon } from "lucide-react";

import { isAccountBoard, leaveAccountBoard } from "~/guest/boardAccount";
import { removeFromCloudBoard } from "~/guest/cloudBoards";
import { findGuestShare, forgetGuestShare } from "~/guest/guestShares";
import { ensureLocalApi } from "~/localApi";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { toastManager } from "../ui/toast";

interface JoinedBoardRef {
  readonly shareId: string;
  readonly title: string;
  readonly cloud: boolean;
}

/**
 * Forgets a joined board on this browser and, when it is the open board, goes home, saying so
 * when `toast` is given.
 */
export function useForgetJoinedBoard() {
  const navigate = useNavigate();
  const openEnvironmentId = useParams({
    strict: false,
    select: (params) => params.environmentId ?? null,
  });
  return (shareId: string, toast?: string) => {
    forgetGuestShare(shareId);
    if (openEnvironmentId === guestEnvironmentId(shareId)) void navigate({ to: "/" });
    if (toast !== undefined) toastManager.add({ type: "success", title: toast });
  };
}

/**
 * Takes a joined board off this browser's boards. A cloud board is left too, freeing the seat,
 * when its host can be reached; it is forgotten here either way. Nobody else loses it.
 */
function useRemoveJoinedBoard() {
  const forget = useForgetJoinedBoard();
  return async (board: JoinedBoardRef) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      [
        `Remove "${board.title}" from your boards?`,
        board.cloud
          ? "You leave the board. Everyone else on it keeps it, and the invite link brings you back."
          : "It goes from this browser only. Everyone else on it keeps it. To come back, you need a new link from the owner.",
      ].join("\n"),
      { variant: "destructive" },
    );
    if (!confirmed) return;
    const share = findGuestShare(board.shareId);
    if (board.cloud && isAccountBoard(board.shareId)) {
      // The account leaves it, so it goes from every device it signs in on.
      const failed = await leaveAccountBoard(board.shareId);
      if (failed !== null) toastManager.add({ type: "error", title: failed });
      else forget(board.shareId);
      return;
    }
    if (board.cloud && share?.guestId !== undefined) {
      await removeFromCloudBoard(share, share.guestId);
    }
    forget(board.shareId);
  };
}

/** The menu on a joined board's card with the way to remove it from this browser. */
export function JoinedBoardMenu({
  board,
  size = "icon-xs",
  variant = "outline",
}: {
  readonly board: JoinedBoardRef;
  readonly size?: "icon-xs" | "icon-micro";
  readonly variant?: "outline" | "ghost-muted";
}) {
  const remove = useRemoveJoinedBoard();
  return (
    <Menu>
      <MenuTrigger
        render={
          <Button
            size={size}
            variant={variant}
            aria-label={`More for ${board.title}`}
            title="More"
          />
        }
        data-joined-board-menu
      >
        <EllipsisIcon />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem variant="destructive" onClick={() => void remove(board)} data-remove-joined-board>
          <LogOutIcon />
          Remove from my boards
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
