import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { UserPlusIcon } from "lucide-react";

import { GuestShareIndicator } from "../chat/GuestShareControls";
import { canShareWithGuestAtom } from "../chat/guestShareAvailability";
import { openGuestShareDialog } from "../chat/guestShareDialogState";
import { Button } from "../ui/button";

/**
 * Who is in the room and the way to share it, on the owner's board: the same status and dialog
 * the thread page has. Unshared, it says so once.
 */
export function BoardSharing({
  threadRef,
  shared,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly shared: boolean;
}) {
  const canShare = useAtomValue(canShareWithGuestAtom(threadRef.environmentId));
  return (
    <span className="flex min-w-0 shrink-0 items-center gap-1">
      {shared ? (
        <GuestShareIndicator threadRef={threadRef} onBoard />
      ) : (
        <span className="text-xs text-muted-foreground">Not shared</span>
      )}
      {canShare ? (
        <Button size="xs" variant="outline" onClick={() => openGuestShareDialog(threadRef)}>
          <UserPlusIcon />
          Share
        </Button>
      ) : null}
    </span>
  );
}
