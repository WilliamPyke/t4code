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
  GlobeIcon,
  LinkIcon,
  LogOutIcon,
  RefreshCwIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
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
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { Popover, PopoverClose, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { Radio, RadioGroup } from "../ui/radio-group";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
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
  // Who is here, as overlapping faces beside Share. A narrow board keeps two; the narrowest none.
  const faces: ReactNode =
    here.length === 0 ? null : (
      <span
        aria-hidden
        className="flex shrink-0 items-center -space-x-1.5 @max-[22rem]/board:hidden"
        data-cloud-board-faces
      >
        {here.slice(0, 4).map((guest, index) => (
          <PersonDot
            key={guest.id}
            color={boardCursorColor(guests, guest.id)}
            className={cn(
              "size-7 text-xs font-semibold ring-2 ring-background",
              index > 1 && "@max-xl/board:hidden",
            )}
          >
            {initialOf(guest.name)}
          </PersonDot>
        ))}
        {here.length > 4 ? (
          <span className="inline-grid size-7 place-items-center rounded-full bg-muted text-2xs font-semibold text-muted-foreground ring-2 ring-background @max-xl/board:hidden">
            +{here.length - 4}
          </span>
        ) : null}
      </span>
    );
  const shareMark: ReactNode = (
    <>
      {here.length === 0 ? <UsersIcon aria-hidden /> : null}
      <span>Share</span>
    </>
  );
  const shareBody: ReactNode = (
    <div className="flex flex-col gap-5">
      <LinkSharingSetting
        sharing={linkSharing}
        manage={controls.changeLinks}
        busy={busy}
        onChange={changeSharing}
      />
      {linkSharing === "off" ? null : (
        <div className="flex flex-col gap-4">
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
        <label className="flex items-center justify-between gap-3">
          <span className="flex min-w-0 flex-col">
            <span className="text-sm font-semibold">Allow copies</span>
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
      <div className="flex flex-col gap-3 border-t pt-4">
        <p className="text-sm font-semibold" data-cloud-board-people-count>
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
      </div>
    </div>
  );
  const shareTitle = (
    <span className="font-heading text-xl leading-tight font-semibold tracking-brand">
      Share this board
    </span>
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
      {editLink === null ? null : (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => copyToClipboard(editLink)}
          data-cloud-board-invite
        >
          {isCopied ? <CheckIcon /> : <LinkIcon />}
          {/* Read out at every width; a narrow board shows the mark alone. */}
          <span className="@max-xl/board:sr-only">{isCopied ? "Copied" : "Copy invite link"}</span>
        </Button>
      )}
      {faces}
      {asSheet ? (
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            render={<Button size="sm" data-cloud-board-people />}
            aria-label={shareLabel}
          >
            {shareMark}
          </DialogTrigger>
          <DialogPopup>
            <DialogHeader>
              <DialogTitle>Share this board</DialogTitle>
            </DialogHeader>
            <DialogPanel>{shareBody}</DialogPanel>
          </DialogPopup>
        </Dialog>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={<Button size="sm" data-cloud-board-people />}
            aria-label={shareLabel}
          >
            {shareMark}
          </PopoverTrigger>
          <PopoverPopup
            padding="none"
            align="end"
            sideOffset={8}
            className="w-[29rem] max-w-[calc(100vw-2rem)]"
          >
            <div className="flex max-h-[min(44rem,var(--available-height))] flex-col gap-5 overflow-y-auto p-6">
              <div className="flex items-start justify-between gap-3">
                <PopoverTitle>{shareTitle}</PopoverTitle>
                <PopoverClose
                  render={<Button size="icon-sm" variant="ghost-muted" aria-label="Close" />}
                >
                  <XIcon />
                </PopoverClose>
              </div>
              {shareBody}
            </div>
          </PopoverPopup>
        </Popover>
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
    <section className="flex flex-col gap-2" data-cloud-board-sharing={sharing}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Link sharing</h3>
        {manage ? null : (
          <span className="shrink-0 text-sm text-muted-foreground">{words.short}</span>
        )}
      </div>
      {manage ? (
        <ToggleGroup
          aria-label="Link sharing"
          className="w-full"
          disabled={busy}
          value={[sharing]}
          onValueChange={(value) => {
            const next = SHARINGS.find((candidate) => candidate === value[0]);
            if (next !== undefined && next !== sharing) onChange(next);
          }}
          data-cloud-board-sharing-menu
        >
          {SHARINGS.map((option) => (
            <Toggle
              key={option}
              value={option}
              className="flex-1"
              aria-label={SHARING_WORDS[option].title}
            >
              {SHARING_WORDS[option].short}
            </Toggle>
          ))}
        </ToggleGroup>
      ) : null}
      <p className="text-sm text-pretty text-muted-foreground">
        <span className="text-foreground">{words.done}.</span> {words.hint}
      </p>
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
    <section className="flex flex-col gap-2" data-cloud-board-link={kind}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{words.title}</h3>
        {manage && link !== null ? (
          <Button
            size="xs"
            variant="ghost"
            disabled={busy}
            onClick={onNew}
            aria-label={`New ${words.title.toLowerCase()}`}
            data-cloud-board-link-new
          >
            <RefreshCwIcon aria-hidden />
            New link
          </Button>
        ) : null}
      </div>
      {link === null ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted-foreground">No {words.title.toLowerCase()} yet.</p>
          {manage ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={onNew}
              data-cloud-board-link-on
            >
              Make link
            </Button>
          ) : null}
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2.5 rounded-xl border bg-background py-1.5 ps-3.5 pe-1.5 focus-within:ring-2 focus-within:ring-ring focus-within:ring-inset">
            <GlobeIcon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <input
              readOnly
              value={link}
              aria-label={words.title}
              className="h-8 min-w-0 flex-1 truncate bg-transparent text-sm text-foreground outline-none"
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
              {isCopied ? "Copied" : "Copy link"}
            </Button>
          </div>
          <p className="text-xs text-pretty text-muted-foreground">{words.hint}</p>
        </>
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
    <ul className="flex flex-col gap-3" data-cloud-board-people-list>
      {people.map((guest) => {
        const isHere = online.includes(guest.id);
        const role: CloudBoardRole = viewers.includes(guest.id) ? "view" : "edit";
        const changeable = manage !== undefined && guest.id !== viewer && guest.id !== maker;
        const note = linkAccessNote(role, sharing);
        return (
          <li key={guest.id} className="flex min-w-0 items-center gap-3 text-sm">
            <span className="relative shrink-0">
              <PersonDot
                color={boardCursorColor(guests, guest.id)}
                className={cn("size-8 text-sm font-semibold", !isHere && "opacity-50")}
              >
                {initialOf(guest.name)}
              </PersonDot>
              {isHere ? (
                <span
                  aria-hidden
                  className="absolute -end-0.5 -bottom-0.5 size-3 rounded-full border-2 border-popover bg-success"
                />
              ) : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                <span className="font-semibold">{guest.name}</span>
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
                <span className="block text-xs text-muted-foreground" data-cloud-board-link-access>
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
              <span className="shrink-0 px-2 text-sm text-muted-foreground">
                {role === "view" ? "Can view" : "Can edit"}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
