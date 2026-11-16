import type { ThreadGuest } from "@t3tools/contracts";
import { LinkIcon, LogOutIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { cloudBoardInviteLink, deleteCloudBoard, removeFromCloudBoard } from "~/guest/cloudBoards";
import type { JoinedGuestShare } from "~/guest/guestShares";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";

import { useForgetJoinedBoard } from "../boards/removeJoinedBoard";
import { PersonDot } from "../room/BoardChrome";
import { boardCursorColor } from "../room/roomBoard.logic";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";

/**
 * Who is on a cloud board and the way to invite someone: anyone on it can, with the link they
 * came in on. Anyone may leave; its maker may also remove people and delete the board.
 */
export function CloudBoardSharing({
  share,
  title,
  guests,
  viewer,
  maker,
  online,
}: {
  readonly share: JoinedGuestShare;
  readonly title: string;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string;
  readonly maker: string | undefined;
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
  const forget = useForgetJoinedBoard();
  const [busy, setBusy] = useState(false);
  const isMaker = maker !== undefined && maker === viewer;
  const here = online.length;

  /** Asks first, then runs `action`; on success the board is gone from this browser. */
  const act = async (question: string, action: () => Promise<string | null>, done: string) => {
    if (!(await ensureLocalApi().dialogs.confirm(question, { variant: "destructive" }))) return;
    setBusy(true);
    const failed = await action();
    setBusy(false);
    if (failed === null) forget(share.shareId, done);
    else toastManager.add({ type: "error", title: "Something went wrong", description: failed });
  };
  const leave = () =>
    act(
      [
        `Leave "${title}"?`,
        "It goes from your boards. Everyone else keeps it, and the invite link brings you back.",
      ].join("\n"),
      () => removeFromCloudBoard(share, viewer),
      "You left the board",
    );
  const remove = (guest: ThreadGuest) =>
    void (async () => {
      const question = [
        `Remove ${guest.name} from this board?`,
        "They lose it at once. The invite link would bring them back.",
      ].join("\n");
      if (!(await ensureLocalApi().dialogs.confirm(question, { variant: "destructive" }))) return;
      setBusy(true);
      const failed = await removeFromCloudBoard(share, guest.id);
      setBusy(false);
      toastManager.add(
        failed === null
          ? { type: "success", title: `${guest.name} was removed` }
          : { type: "error", title: "Could not remove them", description: failed },
      );
    })();
  const deleteBoard = () =>
    act(
      [
        `Delete "${title}"?`,
        "It is deleted for everyone on it, with everything on it. This cannot be undone.",
      ].join("\n"),
      () => deleteCloudBoard(share),
      "Board deleted",
    );

  return (
    <span className="flex min-w-0 items-center gap-1">
      <Popover>
        <PopoverTrigger render={<Button size="xs" variant="ghost-muted" data-cloud-board-people />}>
          {here <= 1 ? "Only you here now" : `${here} here now`}
        </PopoverTrigger>
        <PopoverPopup width="sm" padding="compact" align="end">
          <PopoverTitle className="mb-2">On this board</PopoverTitle>
          <BoardPeople
            guests={guests}
            viewer={viewer}
            maker={maker}
            online={online}
            onRemove={isMaker && !busy ? remove : undefined}
          />
          <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t pt-3">
            <Button
              size="xs"
              variant="outline"
              disabled={busy}
              onClick={() => void leave()}
              data-cloud-board-leave
            >
              <LogOutIcon />
              Leave board
            </Button>
            {isMaker ? (
              <Button
                size="xs"
                variant="destructive-outline"
                disabled={busy}
                onClick={() => void deleteBoard()}
                data-cloud-board-delete
              >
                <Trash2Icon />
                Delete board
              </Button>
            ) : null}
          </div>
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

/**
 * Everyone who has joined the board, those here now first, the viewer marked as you and the
 * maker as such, with a way to remove each other person when `onRemove` is given.
 */
function BoardPeople({
  guests,
  viewer,
  maker,
  online,
  onRemove,
}: {
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string;
  readonly maker: string | undefined;
  readonly online: ReadonlyArray<string>;
  readonly onRemove: ((guest: ThreadGuest) => void) | undefined;
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
              {guest.id === maker ? (
                <span className="text-muted-foreground"> · made it</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs text-muted-foreground">
              {isHere ? "Here now" : "Away"}
            </span>
            {onRemove !== undefined && guest.id !== viewer ? (
              <Button
                size="xs"
                variant="ghost-destructive"
                onClick={() => onRemove(guest)}
                aria-label={`Remove ${guest.name}`}
                data-cloud-board-remove-person
              >
                Remove
              </Button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
