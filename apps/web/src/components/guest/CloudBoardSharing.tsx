import { LinkIcon } from "lucide-react";

import { cloudBoardInviteLink } from "~/guest/cloudBoards";
import type { JoinedGuestShare } from "~/guest/guestShares";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";

import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";

/**
 * Who is on a cloud board now and the way to invite someone: anyone on it can, with the link they
 * came in on. There is no owner to end sharing or set how long it lasts.
 */
export function CloudBoardSharing({
  share,
  online,
}: {
  readonly share: JoinedGuestShare;
  readonly online: number;
}) {
  const link = cloudBoardInviteLink(share);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => toastManager.add({ type: "success", title: "Invite link copied" }),
    onError: () =>
      toastManager.add({
        type: "error",
        title: "Could not copy the invite link",
        description: "Your browser did not allow it.",
      }),
  });
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span className="truncate text-xs text-muted-foreground">
        {online === 1 ? "Only you here now" : `${online} here now`}
      </span>
      {link === null ? null : (
        <Button size="xs" onClick={() => copyToClipboard(link)} data-cloud-board-invite>
          <LinkIcon />
          {isCopied ? "Copied" : "Copy invite link"}
        </Button>
      )}
    </span>
  );
}
