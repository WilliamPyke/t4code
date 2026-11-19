import type {
  CloudBoardLinkKind,
  CloudBoardLinkSharing,
  CloudBoardRole,
  ThreadGuest,
} from "@t3tools/contracts";
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
  setCloudBoardSharing,
} from "~/guest/cloudBoards";
import type { JoinedGuestShare } from "~/guest/guestShares";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useMediaQuery } from "~/hooks/useMediaQuery";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";

import { useDeleteCloudBoard, useForgetJoinedBoard } from "../boards/removeJoinedBoard";
import { PersonDot } from "../room/BoardChrome";
import { boardCursorColor } from "../room/roomBoard.logic";
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
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
import { Radio, RadioGroup } from "../ui/radio-group";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import {
  boardLinkSharing,
  boardPeopleSummary,
  boardShareControls,
  demotionNote,
  linkAccessNote,
  removalNote,
  viewingLabel,
} from "./cloudBoardSharing.logic";

const LINK_WORDS: Record<CloudBoardLinkKind, { readonly title: string; readonly hint: string }> = {
  edit: {
    title: "Edit link",
    hint: "Joins under a name and can change the board. Agents stay their owner's: nobody else can start yours.",
  },
  view: {
    title: "View link",
    hint: "Shows the board as it changes, with no name or sign-in. Nothing can be changed from it.",
  },
};

const SHARING_WORDS: Record<
  CloudBoardLinkSharing,
  { readonly short: string; readonly title: string; readonly hint: string; readonly done: string }
> = {
  edit: {
    short: "Can edit",
    title: "Anyone with the link can edit",
    hint: "The edit link lets anyone join and change the board. The view link lets anyone look.",
    done: "Anyone with the link can edit",
  },
  view: {
    short: "Can view",
    title: "Anyone with the link can view",
    hint: "The view link lets anyone look. The edit link lets nobody new in.",
    done: "Anyone with the link can view",
  },
  off: {
    short: "Off",
    title: "Off: only people already on this board",
    hint: "No link lets anyone new in. Everyone on the board keeps their access, and turning sharing on again brings back the same links.",
    done: "Link sharing is off",
  },
};
const SHARINGS: ReadonlyArray<CloudBoardLinkSharing> = ["edit", "view", "off"];

/** Removing someone or letting them only view, and what to do about the links as well. */
interface AccessChange {
  readonly kind: "remove" | "demote";
  readonly guest: ThreadGuest;
}
/** `close` turns sharing off (removing) or down to view (demoting); `renew` makes new links. */
type AlsoLinks = "keep" | "close" | "renew";

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
  sharing,
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
  /** Who the links let in, as the host says; absent from an older host. */
  readonly sharing?: CloudBoardLinkSharing | undefined;
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
  const linkSharing = boardLinkSharing(sharing, links);
  const [asking, setAsking] = useState<AccessChange | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [also, setAlso] = useState<AlsoLinks>("keep");

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
  const newLink = (kind: CloudBoardLinkKind, current: string | null) =>
    void (async () => {
      const words = LINK_WORDS[kind].title.toLowerCase();
      if (current !== null) {
        const question = [
          `Make a new ${words}?`,
          "The old link stops working. Everyone already on the board stays.",
        ];
        if (!(await confirmed(question, "Make a new link"))) return;
      }
      await run(async () => {
        const result = await setCloudBoardLink(share, kind, true);
        return typeof result === "string" ? result : null;
      }, "The new link is ready");
      setOpen(true);
    })();
  const changeSharing = (next: CloudBoardLinkSharing) =>
    void run(() => setCloudBoardSharing(share, next), SHARING_WORDS[next].done);

  const leave = async () => {
    const question = [
      `Leave "${title}"?`,
      "It goes from your boards. Everyone else keeps it, and while link sharing is on, the link brings you back.",
    ];
    if (!(await confirmed(question, "Leave board"))) return;
    setBusy(true);
    const failed = await removeFromCloudBoard(share, viewer);
    setBusy(false);
    if (failed === null) forget(share.shareId, "You left the board");
    else toastManager.add({ type: "error", title: "Something went wrong", description: failed });
  };
  // As with a confirmation, the popover closes first, so nothing is left behind the dialog.
  const ask = (change: AccessChange) => {
    setOpen(false);
    setAlso("keep");
    setAsking(change);
    setAskOpen(true);
  };
  const remove = (guest: ThreadGuest) => ask({ kind: "remove", guest });
  const setRole = (guest: ThreadGuest, role: CloudBoardRole) => {
    if (role === "view") {
      ask({ kind: "demote", guest });
      return;
    }
    void run(() => setCloudBoardRole(share, guest.id, role), `${guest.name} can edit now`);
  };
  const confirmAsked = () => {
    if (asking === null) return;
    const { kind, guest } = asking;
    const links = also;
    setAskOpen(false);
    const done =
      kind === "remove" ? `${guest.name} was removed` : `${guest.name} can only view now`;
    void run(
      async () => {
        const failed =
          kind === "remove"
            ? await removeFromCloudBoard(share, guest.id)
            : await setCloudBoardRole(share, guest.id, "view");
        if (failed !== null || links === "keep") return failed;
        if (links === "renew") return setCloudBoardSharing(share, linkSharing, true);
        return setCloudBoardSharing(share, kind === "remove" ? "off" : "view");
      },
      links === "keep"
        ? done
        : links === "renew"
          ? `${done}. The links are new`
          : `${done}. ${SHARING_WORDS[kind === "remove" ? "off" : "view"].done}`,
    );
  };

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
      <LinkSharingSetting
        sharing={linkSharing}
        manage={controls.changeLinks}
        busy={busy}
        onChange={changeSharing}
      />
      {linkSharing === "off" ? null : (
        <div className="mb-4 flex flex-col gap-4">
          {linkSharing === "edit" && links.edit !== undefined ? (
            <BoardLinkRow
              kind="edit"
              link={editLink}
              manage={controls.changeLinks}
              busy={busy}
              onNew={() => newLink("edit", links.edit ?? null)}
            />
          ) : null}
          <BoardLinkRow
            kind="view"
            link={links.view === null ? null : cloudBoardLink(share, links.view)}
            manage={controls.changeLinks}
            busy={busy}
            onNew={() => newLink("view", links.view)}
          />
        </div>
      )}
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
        sharing={linkSharing}
        manage={controls.changePeople && !busy ? { remove, setRole } : undefined}
      />
    </>
  );

  return (
    <span className="flex min-w-0 items-center gap-1">
      <AccessChangeDialog
        open={askOpen}
        change={asking}
        sharing={linkSharing}
        also={also}
        onAlso={setAlso}
        onOpenChange={setAskOpen}
        onConfirm={confirmAsked}
      />
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

/** Who the board's links let in, as one setting; whoever manages the board changes it here. */
function LinkSharingSetting({
  sharing,
  manage,
  busy,
  onChange,
}: {
  readonly sharing: CloudBoardLinkSharing;
  readonly manage: boolean;
  readonly busy: boolean;
  readonly onChange: (sharing: CloudBoardLinkSharing) => void;
}) {
  const words = SHARING_WORDS[sharing];
  return (
    <section className="mb-4 flex flex-col gap-1.5" data-cloud-board-sharing={sharing}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Link sharing</h3>
        {manage ? (
          <Menu>
            <MenuTrigger
              render={
                <Button
                  size="xs"
                  variant="outline"
                  disabled={busy}
                  aria-label={`Link sharing: ${words.title}`}
                  data-cloud-board-sharing-menu
                />
              }
            >
              {words.short}
              <ChevronDownIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuRadioGroup
                value={sharing}
                onValueChange={(value) => {
                  const next = SHARINGS.find((candidate) => candidate === value);
                  if (next !== undefined && next !== sharing) onChange(next);
                }}
              >
                {SHARINGS.map((option) => (
                  <MenuRadioItem key={option} value={option} closeOnClick>
                    {SHARING_WORDS[option].title}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuPopup>
          </Menu>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">{words.short}</span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{words.hint}</p>
    </section>
  );
}

/** One of the board's links: what it does, the link to copy, and, to manage, a new one. */
function BoardLinkRow({
  kind,
  link,
  manage,
  busy,
  onNew,
}: {
  readonly kind: CloudBoardLinkKind;
  readonly link: string | null;
  readonly manage: boolean;
  readonly busy: boolean;
  /** Makes the link anew, or makes it where the board has none yet. */
  readonly onNew: () => void;
}) {
  const words = LINK_WORDS[kind];
  const { copyToClipboard, isCopied } = useCopyToClipboard({
    onCopy: () => toastManager.add({ type: "success", title: `${words.title} copied` }),
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
                  aria-label={`${words.title} options`}
                  disabled={busy}
                />
              }
            >
              <EllipsisIcon />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={onNew} data-cloud-board-link-new>
                <RefreshCwIcon />
                New link
              </MenuItem>
            </MenuPopup>
          </Menu>
        ) : null}
      </div>
      <p className="text-xs text-muted-foreground">
        {link === null ? "This board has no such link yet." : words.hint}
      </p>
      {link === null ? (
        manage ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={onNew}
            data-cloud-board-link-on
          >
            Make link
          </Button>
        ) : null
      ) : (
        <div className="flex items-center gap-1.5">
          <Input
            readOnly
            size="sm"
            value={link}
            aria-label={words.title}
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

/**
 * Asks before removing someone or letting them only view. Where link sharing would still let them
 * back in, it says so and offers to close the links as well, unticked: the choice is the asker's.
 */
function AccessChangeDialog({
  open,
  change,
  sharing,
  also,
  onAlso,
  onOpenChange,
  onConfirm,
}: {
  readonly open: boolean;
  readonly change: AccessChange | null;
  readonly sharing: CloudBoardLinkSharing;
  readonly also: AlsoLinks;
  readonly onAlso: (also: AlsoLinks) => void;
  readonly onOpenChange: (open: boolean) => void;
  readonly onConfirm: () => void;
}) {
  if (change === null) return null;
  const { name } = change.guest;
  const removing = change.kind === "remove";
  const note = removing ? removalNote(name, sharing) : demotionNote(name, sharing);
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {removing ? `Remove ${name} from this board?` : `Let ${name} only view this board?`}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {removing
              ? "They lose it at once, with the cards they added."
              : "They keep the board but can no longer change it, and their agent stops."}
          </AlertDialogDescription>
          {note === null ? null : <AlertDialogDescription>{note}</AlertDialogDescription>}
        </AlertDialogHeader>
        {note === null ? null : removing ? (
          <div className="px-6 pb-4 text-sm">
            <RadioGroup
              aria-label="What to do about the links"
              value={also}
              onValueChange={(value) =>
                onAlso(value === "close" || value === "renew" ? value : "keep")
              }
              data-cloud-board-remove-links
            >
              <label className="flex items-center gap-2">
                <Radio value="keep" />
                Leave link sharing as it is
              </label>
              <label className="flex items-center gap-2">
                <Radio value="close" />
                Also turn link sharing off
              </label>
              <label className="flex items-center gap-2">
                <Radio value="renew" />
                Or make new links, to share again with the people who should have them
              </label>
            </RadioGroup>
          </div>
        ) : (
          <label className="flex items-center gap-2 px-6 pb-4 text-sm">
            <Checkbox
              checked={also === "close"}
              onCheckedChange={(checked) => onAlso(checked === true ? "close" : "keep")}
              data-cloud-board-demote-links
            />
            Also change link sharing to Can view
          </label>
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button variant="destructive" onClick={onConfirm} data-cloud-board-confirm-access>
            {removing ? "Remove person" : "Only view"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
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
  sharing,
  manage,
}: {
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly viewer: string;
  readonly maker: string | undefined;
  readonly online: ReadonlyArray<string>;
  readonly viewers: ReadonlyArray<string>;
  readonly sharing: CloudBoardLinkSharing;
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
        const note = linkAccessNote(role, sharing);
        return (
          <li key={guest.id} className="flex min-w-0 items-center gap-2 text-sm">
            <PersonDot
              color={boardCursorColor(guests, guest.id)}
              className={cn("size-5 text-2xs font-semibold", !isHere && "opacity-50")}
            >
              {initialOf(guest.name)}
            </PersonDot>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {guest.name}
                {guest.id === viewer ? <span className="text-muted-foreground"> (you)</span> : null}
                {guest.id === maker ? (
                  <span className="text-muted-foreground"> · made it</span>
                ) : null}
                {sameName.has(guest.id) ? (
                  <span className="text-muted-foreground">
                    {" "}
                    · joined {joinedOn(guest.joinedAt)}
                  </span>
                ) : null}
                {!isHere ? <span className="text-muted-foreground"> · away</span> : null}
              </span>
              {note === null ? null : (
                <span className="block text-muted-foreground" data-cloud-board-link-access>
                  {note}
                </span>
              )}
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
