import type { ThreadGuest } from "@t3tools/contracts";
import {
  CheckIcon,
  CopyIcon,
  EllipsisIcon,
  LinkIcon,
  LogOutIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { useState } from "react";

import { sharedNameIds } from "~/guest/boardAccount.logic";
import { cloudBoardInviteLink, removeFromCloudBoard } from "~/guest/cloudBoards";
import type { JoinedGuestShare } from "~/guest/guestShares";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";

import { useDeleteCloudBoard, useForgetJoinedBoard } from "../boards/removeJoinedBoard";
import { PersonDot } from "../room/BoardChrome";
import { boardCursorColor } from "../room/roomBoard.logic";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";

/**
 * Sharing a cloud board: its invite link, copied in one click, what the link lets people do, and
 * who is on the board. Anyone on it may invite others with the link they came in on. A menu beside
 * it leaves the board, or deletes it for its maker.
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
        description: "Your browser did not allow it. Select the link and copy it yourself.",
      }),
  });
  const forget = useForgetJoinedBoard();
  const deleteBoard = useDeleteCloudBoard();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isMaker = maker !== undefined && maker === viewer;
  const here = guests.filter((guest) => online.includes(guest.id));

  const leave = async () => {
    const question = [
      `Leave "${title}"?`,
      "It goes from your boards. Everyone else keeps it, and the invite link brings you back.",
    ].join("\n");
    if (!(await ensureLocalApi().dialogs.confirm(question, { variant: "destructive" }))) return;
    setBusy(true);
    const failed = await removeFromCloudBoard(share, viewer);
    setBusy(false);
    if (failed === null) forget(share.shareId, "You left the board");
    else toastManager.add({ type: "error", title: "Something went wrong", description: failed });
  };
  const remove = (guest: ThreadGuest) =>
    void (async () => {
      // A confirmation never opens over this popover: closing it first leaves nothing behind.
      setOpen(false);
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

  return (
    <span className="flex min-w-0 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button size="xs" variant="ghost-muted" data-cloud-board-people />}
          aria-label={`Share this board. ${here.length <= 1 ? "Only you" : `${here.length} people`} here now.`}
        >
          <span aria-hidden className="flex items-center -space-x-1">
            {here.slice(0, 4).map((guest) => (
              <PersonDot
                key={guest.id}
                color={boardCursorColor(guests, guest.id)}
                className="size-5 text-2xs font-semibold ring-2 ring-card"
              >
                {initialOf(guest.name)}
              </PersonDot>
            ))}
          </span>
          {here.length === 0 ? <UsersIcon /> : null}
          {here.length > 4 ? <span className="text-xs">+{here.length - 4}</span> : null}
          Share
        </PopoverTrigger>
        <PopoverPopup width="md" align="end">
          <PopoverTitle className="mb-1">Share this board</PopoverTitle>
          <p className="mb-3 text-sm text-muted-foreground">
            Anyone with the link can join, see everything on the board and add to it. Agents stay
            their owner's: nobody else can start yours.
          </p>
          {link === null ? (
            <p className="mb-3 text-sm text-muted-foreground">
              This browser has no invite for it. Ask whoever invited you for the link.
            </p>
          ) : (
            <div className="mb-4 flex items-center gap-1.5">
              <Input
                readOnly
                size="sm"
                value={link}
                aria-label="Invite link"
                onFocus={(event) => event.currentTarget.select()}
                data-cloud-board-invite-link
              />
              <Button size="sm" onClick={() => copyToClipboard(link)}>
                {isCopied ? <CheckIcon /> : <CopyIcon />}
                {isCopied ? "Copied" : "Copy"}
              </Button>
            </div>
          )}
          <p className="mb-2 text-xs font-medium text-muted-foreground">
            On this board · {here.length <= 1 ? "only you here now" : `${here.length} here now`}
          </p>
          <BoardPeople
            guests={guests}
            viewer={viewer}
            maker={maker}
            online={online}
            onRemove={isMaker && !busy ? remove : undefined}
          />
        </PopoverPopup>
      </Popover>
      {link === null ? null : (
        <Button size="xs" onClick={() => copyToClipboard(link)} data-cloud-board-invite>
          {isCopied ? <CheckIcon /> : <LinkIcon />}
          {isCopied ? "Copied" : "Copy invite link"}
        </Button>
      )}
      <Menu>
        <MenuTrigger
          render={<Button size="icon-xs" variant="ghost-muted" aria-label="Board options" />}
          data-cloud-board-menu
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="end">
          {isMaker ? (
            <MenuItem
              variant="destructive"
              disabled={busy}
              onClick={() => void deleteBoard({ shareId: share.shareId, title })}
              data-cloud-board-delete
            >
              <Trash2Icon />
              Delete board
            </MenuItem>
          ) : (
            <MenuItem
              variant="destructive"
              disabled={busy}
              onClick={() => void leave()}
              data-cloud-board-leave
            >
              <LogOutIcon />
              Leave board
            </MenuItem>
          )}
        </MenuPopup>
      </Menu>
    </span>
  );
}

const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

const joinedOn = (at: string) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

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
  const sameName = sharedNameIds(guests);
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
              {initialOf(guest.name)}
            </PersonDot>
            <span className="min-w-0 flex-1 truncate">
              {guest.name}
              {guest.id === viewer ? <span className="text-muted-foreground"> (you)</span> : null}
              {guest.id === maker ? (
                <span className="text-muted-foreground"> · made it</span>
              ) : null}
              {sameName.has(guest.id) ? (
                <span className="text-muted-foreground"> · joined {joinedOn(guest.joinedAt)}</span>
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
