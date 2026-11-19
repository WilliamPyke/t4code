import type { CloudBoardLinkKind, CloudBoardRole, ThreadGuest } from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  EyeIcon,
  LinkIcon,
  LogOutIcon,
  RefreshCwIcon,
  Trash2Icon,
  UsersIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { sharedNameIds } from "~/guest/boardAccount.logic";
import type { BoardLinks } from "~/guest/boardLinks.logic";
import {
  cloudBoardLink,
  removeFromCloudBoard,
  setCloudBoardCopies,
  setCloudBoardLink,
  setCloudBoardRole,
} from "~/guest/cloudBoards";
import type { JoinedGuestShare } from "~/guest/guestShares";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";

import { useDeleteCloudBoard, useForgetJoinedBoard } from "../boards/removeJoinedBoard";
import { PersonDot } from "../room/BoardChrome";
import { boardCursorColor } from "../room/roomBoard.logic";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { boardPeopleSummary, boardShareControls, viewingLabel } from "./cloudBoardSharing.logic";

const LINK_WORDS: Record<
  CloudBoardLinkKind,
  { readonly title: string; readonly hint: string; readonly off: string }
> = {
  edit: {
    title: "Can edit",
    hint: "Anyone with this link joins under a name and can change the board. Agents stay their owner's: nobody else can start yours.",
    off: "Off. Nobody new can join to edit.",
  },
  view: {
    title: "Can view",
    hint: "Anyone with this link can watch the board as it changes, with no name or sign-in. They cannot change anything.",
    off: "Off. Nobody can open the board just to look.",
  },
};

/**
 * Sharing a cloud board: its two links, "can edit" and "can view", each copied in one click, and
 * who is on the board. Whoever manages it turns each link on and off, makes it anew, and says who
 * can edit. A menu beside it leaves the board, or deletes it for its maker. On a narrow board it
 * keeps to its marks, and on a phone Share opens as a sheet, like the app's other dialogs.
 */
export function CloudBoardSharing({
  share,
  title,
  guests,
  viewer,
  maker,
  online,
  links,
  manage,
  viewers,
  viewing,
  copies = false,
}: {
  readonly share: JoinedGuestShare;
  readonly title: string;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string;
  readonly maker: string | undefined;
  readonly online: ReadonlyArray<string>;
  readonly links: BoardLinks;
  /** This person turns the links on and off and says who can edit. */
  readonly manage: boolean;
  /** The people on the board who can only look. */
  readonly viewers: ReadonlyArray<string>;
  /** How many look on from the view link now. */
  readonly viewing: number;
  /** Anyone who can see the board may make their own copy. */
  readonly copies?: boolean;
}) {
  const editLink = links.edit == null ? null : cloudBoardLink(share, links.edit);
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => toastManager.add({ type: "success", title: "Edit link copied" }),
    onError: () => toastManager.add({ type: "error", title: "Could not copy the link" }),
  });
  const forget = useForgetJoinedBoard();
  const deleteBoard = useDeleteCloudBoard();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const isMaker = maker !== undefined && maker === viewer;
  const controls = boardShareControls({ manage, isMaker, links });
  const here = guests.filter((guest) => online.includes(guest.id));
  const asSheet = useMediaQuery("max-sm");

  // A confirmation never opens over this popover: closing it first leaves nothing behind.
  const confirmed = async (question: ReadonlyArray<string>, confirmLabel: string) => {
    setOpen(false);
    return ensureLocalApi().dialogs.confirm(question.join("\n"), {
      variant: "destructive",
      confirmLabel,
    });
  };
  const run = async (work: () => Promise<string | null>, done?: string) => {
    setBusy(true);
    const failed = await work();
    setBusy(false);
    toastManager.add(
      failed === null
        ? { type: "success", title: done ?? "Done" }
        : { type: "error", title: "Something went wrong", description: failed },
    );
  };
  const changeLink = (kind: CloudBoardLinkKind, on: boolean, current: string | null) =>
    void (async () => {
      const words = LINK_WORDS[kind].title.toLowerCase();
      if (current !== null) {
        const question = on
          ? [
              `Make a new "${words}" link?`,
              "The old link stops working. Everyone already on the board stays.",
            ]
          : [
              `Turn off the "${words}" link?`,
              kind === "view"
                ? "It stops working, and anyone watching from it loses the board."
                : "It stops working. Everyone already on the board stays.",
            ];
        if (!(await confirmed(question, on ? "Make a new link" : "Turn off link"))) return;
      }
      await run(
        async () => {
          const result = await setCloudBoardLink(share, kind, on);
          return typeof result === "string" ? result : null;
        },
        on ? "The new link is ready" : "Link turned off",
      );
      if (on) setOpen(true);
    })();

  const leave = async () => {
    const question = [
      `Leave "${title}"?`,
      "It goes from your boards. Everyone else keeps it, and the edit link brings you back.",
    ];
    if (!(await confirmed(question, "Leave board"))) return;
    setBusy(true);
    const failed = await removeFromCloudBoard(share, viewer);
    setBusy(false);
    if (failed === null) forget(share.shareId, "You left the board");
    else toastManager.add({ type: "error", title: "Something went wrong", description: failed });
  };
  const remove = (guest: ThreadGuest) =>
    void (async () => {
      const question = [
        `Remove ${guest.name} from this board?`,
        "They lose it at once. The edit link would bring them back.",
      ];
      if (!(await confirmed(question, "Remove person"))) return;
      await run(() => removeFromCloudBoard(share, guest.id), `${guest.name} was removed`);
    })();
  const setRole = (guest: ThreadGuest, role: CloudBoardRole) =>
    void (async () => {
      if (role === "view") {
        const question = [
          `Let ${guest.name} only view this board?`,
          "If they kept the edit link, they can join with it again to edit. A new edit link ends the old one.",
        ];
        if (!(await confirmed(question, "Only view"))) return;
      }
      await run(
        () => setCloudBoardRole(share, guest.id, role),
        role === "view" ? `${guest.name} can only view now` : `${guest.name} can edit now`,
      );
    })();

  const shareLabel = `Share this board. ${here.length <= 1 ? "Only you" : `${here.length} people`} here now.`;
  // A narrow board keeps two faces and the word; the narrowest phones, the faces alone.
  const shareMark: ReactNode = (
    <>
      <span aria-hidden className="flex items-center -space-x-1">
        {here.slice(0, 4).map((guest, index) => (
          <PersonDot
            key={guest.id}
            color={boardCursorColor(guests, guest.id)}
            className={cn(
              "size-5 text-2xs font-semibold ring-2 ring-card",
              index > 1 && "@max-xl/board:hidden",
            )}
          >
            {initialOf(guest.name)}
          </PersonDot>
        ))}
      </span>
      {here.length === 0 ? <UsersIcon /> : null}
      {here.length > 4 ? (
        <span className="text-xs @max-xl/board:hidden">+{here.length - 4}</span>
      ) : null}
      <span className="@max-[22rem]/board:sr-only">Share</span>
    </>
  );
  const shareBody: ReactNode = (
    <>
      <div className="mb-4 flex flex-col gap-4">
        {links.edit === undefined ? null : (
          <BoardLinkRow
            kind="edit"
            link={editLink}
            manage={controls.changeLinks}
            busy={busy}
            onChange={(on) => changeLink("edit", on, links.edit ?? null)}
          />
        )}
        <BoardLinkRow
          kind="view"
          link={links.view === null ? null : cloudBoardLink(share, links.view)}
          manage={controls.changeLinks}
          busy={busy}
          onChange={(on) => changeLink("view", on, links.view)}
        />
      </div>
      {controls.allowCopies ? (
        <label className="mb-4 flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-medium">Allow copies</span>
            <span className="text-xs text-muted-foreground">
              Anyone who can see the board can make their own copy of it.
            </span>
          </span>
          <Switch
            checked={copies}
            disabled={busy}
            onCheckedChange={(on) =>
              void run(
                () => setCloudBoardCopies(share, on),
                on ? "Copies allowed" : "Copies turned off",
              )
            }
            data-cloud-board-copies
          />
        </label>
      ) : null}
      <p className="mb-2 text-xs font-medium text-muted-foreground" data-cloud-board-people-count>
        {boardPeopleSummary({ joined: guests.length, here: here.length, viewing })}
      </p>
      <BoardPeople
        guests={guests}
        viewer={viewer}
        maker={maker}
        online={online}
        viewers={viewers}
        manage={controls.changePeople && !busy ? { remove, setRole } : undefined}
      />
    </>
  );

  return (
    <span className="flex min-w-0 items-center gap-1">
      {viewing > 0 ? (
        <span className="flex shrink-0 items-center gap-1 px-1 text-xs text-muted-foreground @max-xl/board:hidden">
          <EyeIcon className="size-3.5" aria-hidden />
          {viewingLabel(viewing)}
        </span>
      ) : null}
      {asSheet ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={<Button size="xs" variant="ghost-muted" data-cloud-board-people />}
            aria-label={shareLabel}
          >
            {shareMark}
          </DialogTrigger>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Share this board</DialogTitle>
            </DialogHeader>
            <DialogPanel>
              <div>{shareBody}</div>
            </DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={<Button size="xs" variant="ghost-muted" data-cloud-board-people />}
            aria-label={shareLabel}
          >
            {shareMark}
          </PopoverTrigger>
          <PopoverPopup width="md" align="end">
            <PopoverTitle className="mb-3">Share this board</PopoverTitle>
            {shareBody}
          </PopoverPopup>
        </Popover>
      )}
      {editLink === null ? null : (
        <Button size="xs" onClick={() => copyToClipboard(editLink)} data-cloud-board-invite>
          {isCopied ? <CheckIcon /> : <LinkIcon />}
          {/* Read out at every width; a narrow board shows the mark alone. */}
          <span className="@max-xl/board:sr-only">{isCopied ? "Copied" : "Copy invite link"}</span>
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
          {controls.deleteBoard ? (
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

/** One of the board's links: what it lets people do, the link to copy, and, to manage, its switch. */
function BoardLinkRow({
  kind,
  link,
  manage,
  busy,
  onChange,
}: {
  readonly kind: CloudBoardLinkKind;
  readonly link: string | null;
  readonly manage: boolean;
  readonly busy: boolean;
  /** Turns it on with a new link (`true`), or off. */
  readonly onChange: (on: boolean) => void;
}) {
  const words = LINK_WORDS[kind];
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => toastManager.add({ type: "success", title: `${words.title} link copied` }),
    onError: () =>
      toastManager.add({
        type: "error",
        title: "Could not copy the link",
        description: "Your browser did not allow it. Select the link and copy it yourself.",
      }),
  });
  return (
    <section className="flex flex-col gap-1.5" data-cloud-board-link={kind}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{words.title}</h3>
        {manage && link !== null ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="icon-xs"
                  variant="ghost-muted"
                  aria-label={`${words.title} link options`}
                  disabled={busy}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => onChange(true)} data-cloud-board-link-new>
                <RefreshCwIcon />
                New link
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="destructive"
                onClick={() => onChange(false)}
                data-cloud-board-link-off
              >
                Turn off
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">{link === null ? words.off : words.hint}</p>
      {link === null ? (
        manage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => onChange(true)}
            data-cloud-board-link-on
          >
            Turn on
          </Button>
        ) : null
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            readOnly
            size="sm"
            value={link}
            aria-label={`${words.title} link`}
            // Selected for a keyboard to copy; a finger would get the phone's selection handles.
            onFocus={(event) => {
              if (!window.matchMedia("(pointer: coarse)").matches) event.currentTarget.select();
            }}
            data-cloud-board-invite-link={kind === "edit" ? "" : undefined}
          />
          <Button
            size="sm"
            variant={kind === "edit" ? "default" : "outline"}
            onClick={() => copyToClipboard(link)}
          >
            {isCopied ? <CheckIcon /> : <CopyIcon />}
            {isCopied ? "Copied" : "Copy"}
          </Button>
        </div>
      )}
    </section>
  );
}

const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

const joinedOn = (at: string) =>
  new Date(at).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/**
 * Everyone who has joined the board, those here now first, the viewer marked as you and the
 * maker as such. Whoever manages it switches each other person between editing and viewing, and
 * removes them.
 */
function BoardPeople({
  guests,
  viewer,
  maker,
  online,
  viewers,
  manage,
}: {
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string;
  readonly maker: string | undefined;
  readonly online: ReadonlyArray<string>;
  readonly viewers: ReadonlyArray<string>;
  readonly manage:
    | {
        readonly remove: (guest: ThreadGuest) => void;
        readonly setRole: (guest: ThreadGuest, role: CloudBoardRole) => void;
      }
    | undefined;
}) {
  const people = guests.toSorted(
    (left, right) => Number(online.includes(right.id)) - Number(online.includes(left.id)),
  );
  const sameName = sharedNameIds(guests);
  return (
    <ul className="flex flex-col gap-1.5" data-cloud-board-people-list>
      {people.map((guest) => {
        const isHere = online.includes(guest.id);
        const role: CloudBoardRole = viewers.includes(guest.id) ? "view" : "edit";
        const changeable = manage !== undefined && guest.id !== viewer && guest.id !== maker;
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
              {!isHere ? <span className="text-muted-foreground"> · away</span> : null}
            </span>
            {changeable ? (
              <Menu>
                <MenuTrigger
                  render={
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      aria-label={`What ${guest.name} can do`}
                      data-cloud-board-person-role
                    />
                  }
                >
                  {role === "view" ? "Can view" : "Can edit"}
                  <ChevronDownIcon />
                </MenuTrigger>
                <MenuPopup align="end">
                  <MenuRadioGroup
                    value={role}
                    onValueChange={(value) => {
                      if ((value === "edit" || value === "view") && value !== role) {
                        manage.setRole(guest, value);
                      }
                    }}
                  >
                    <MenuRadioItem value="edit" closeOnClick>
                      Can edit
                    </MenuRadioItem>
                    <MenuRadioItem value="view" closeOnClick>
                      Can view
                    </MenuRadioItem>
                  </MenuRadioGroup>
                  <MenuSeparator />
                  <MenuItem
                    variant="destructive"
                    onClick={() => manage.remove(guest)}
                    data-cloud-board-remove-person
                  >
                    Remove from board
                  </MenuItem>
                </MenuPopup>
              </Menu>
            ) : (
              <span className="shrink-0 text-xs text-muted-foreground">
                {role === "view" ? "Can view" : "Can edit"}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
