import type { ThreadGuest } from "@t3tools/contracts";
import { LinkIcon } from "lucide-react";

import { cloudBoardInviteLink } from "~/guest/cloudBoards";
import type { JoinedGuestShare } from "~/guest/guestShares";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";

import { PersonDot } from "../room/BoardChrome";
import { boardCursorColor } from "../room/roomBoard.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";

/**
 * Who is on a cloud board and the way to invite someone: anyone on it can, with the link they
 * came in on. There is no owner to end sharing or set how long it lasts.
 */
export function CloudBoardSharing({
  share,
  guests,
  viewer,
  online,
}: {
  readonly share: JoinedGuestShare;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string;
  readonly online: ReadonlyArray<string>;
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
  const here = online.length;
  return (
    <span className="flex min-w-0 items-center gap-1">
      <Popover>
        <PopoverTrigger render={<Button size="xs" variant="ghost-muted" data-cloud-board-people />}>
          {here <= 1 ? "Only you here now" : `${here} here now`}
        </PopoverTrigger>
        <PopoverPopup width="sm" padding="compact" align="end">
          <PopoverTitle className="mb-2">On this board</PopoverTitle>
          <BoardPeople guests={guests} viewer={viewer} online={online} />
        </PopoverPopup>
      </Popover>
      {link === null ? null : (
        <Button size="xs" onClick={() => copyToClipboard(link)} data-cloud-board-invite>
          <LinkIcon />
          {isCopied ? "Copied" : "Copy invite link"}
        </Button>
      )}
    </span>
  );
}

/** Everyone who has joined the board, those here now first, the viewer marked as you. */
function BoardPeople({
  guests,
  viewer,
  online,
}: {
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string;
  readonly online: ReadonlyArray<string>;
}) {
  const people = guests.toSorted(
    (left, right) => Number(online.includes(right.id)) - Number(online.includes(left.id)),
  );
  return (
    <ul className="flex flex-col gap-1.5" data-cloud-board-people-list>
      {people.map((guest) => {
        const isHere = online.includes(guest.id);
        return (
          <li key={guest.id} className="flex min-w-0 items-center gap-2 text-sm">
            <PersonDot
              color={boardCursorColor(guests, guest.id)}
              className={cn("size-5 text-2xs font-semibold", !isHere && "opacity-50")}
            >
              {Array.from(guest.name.trim())[0]?.toUpperCase() ?? "?"}
            </PersonDot>
            <span className="min-w-0 flex-1 truncate">
              {guest.name}
              {guest.id === viewer ? <span className="text-muted-foreground"> (you)</span> : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {isHere ? "Here now" : "Away"}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
