import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import { useNavigate, useParams } from "@tanstack/react-router";
import { EllipsisIcon, LogOutIcon } from "lucide-react";

import { forgetGuestShare } from "~/guest/guestShares";
import { ensureLocalApi } from "~/localApi";

import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";

interface JoinedBoardRef {
  readonly shareId: string;
  readonly title: string;
  readonly cloud: boolean;
}

/**
 * Takes a joined board off this browser's boards. Nobody else loses it; the board stays on its
 * host. When it is the open board, home takes its place.
 */
function useRemoveJoinedBoard() {
  const navigate = useNavigate();
  const openEnvironmentId = useParams({
    strict: false,
    select: (params) => params.environmentId ?? null,
  });
  return async (board: JoinedBoardRef) => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      [
        `Remove "${board.title}" from your boards?`,
        board.cloud
          ? "It goes from this browser only. Everyone else on it keeps it, and the invite link brings it back."
          : "It goes from this browser only. Everyone else on it keeps it. To come back, you need a new link from the owner.",
      ].join("\n"),
      { variant: "destructive" },
    );
    if (!confirmed) return;
    forgetGuestShare(board.shareId);
    if (openEnvironmentId === guestEnvironmentId(board.shareId)) void navigate({ to: "/" });
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
