import {
  CLOUD_WORKSPACE_NAME_MAX_LENGTH,
  ROOM_BOARD_NOTE_COLORS,
  type CloudWorkspace,
  type CloudWorkspaceMember,
  type RoomBoardNoteColor,
} from "@t3tools/contracts";
import {
  CheckIcon,
  ChevronDownIcon,
  CopyIcon,
  EllipsisIcon,
  LayoutGridIcon,
  LogOutIcon,
  PlusIcon,
  Trash2Icon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { type FormEvent, useState } from "react";

import { sharedNameIds } from "~/guest/boardAccount.logic";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import {
  type WorkspaceScope,
  createWorkspace,
  deleteWorkspace,
  endWorkspaceInvite,
  leaveWorkspace,
  removeWorkspaceMember,
  renameWorkspace,
  renewWorkspaceInvite,
  setWorkspaceMemberRole,
  setWorkspaceScope,
  workspaceInviteLink,
} from "~/guest/workspaces";
import { cn } from "~/lib/utils";
import { ensureLocalApi } from "~/localApi";

import { paintSwatchClassName } from "../room/RoomNoteColor";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
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
import { toastManager } from "../ui/toast";

/** A workspace's mark: its first letter on its colour. */
export function WorkspaceMark({
  name,
  color,
  size = "sm",
}: {
  readonly name: string;
  readonly color: RoomBoardNoteColor;
  readonly size?: "sm" | "md";
}) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid shrink-0 place-items-center rounded-md font-semibold text-foreground ring-1 ring-foreground/10",
        size === "sm" ? "size-5 text-2xs" : "size-9 text-base",
        paintSwatchClassName(color),
      )}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** A colour of its own for a member, the same everywhere they show. */
const memberColor = (memberId: string): RoomBoardNoteColor => {
  let hash = 0;
  for (const char of memberId) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ROOM_BOARD_NOTE_COLORS[hash % ROOM_BOARD_NOTE_COLORS.length]!;
};

const scopeLabel = (scope: WorkspaceScope, workspaces: ReadonlyArray<CloudWorkspace>) =>
  scope === "all"
    ? "All boards"
    : scope === "personal"
      ? "My boards"
      : (workspaces.find((workspace) => workspace.id === scope)?.name ?? "All boards");

/** Picks which boards the home and sidebar show, and starts a workspace. */
export function WorkspaceSwitcher({
  scope,
  workspaces,
}: {
  readonly scope: WorkspaceScope;
  readonly workspaces: ReadonlyArray<CloudWorkspace>;
}) {
  const [creating, setCreating] = useState(false);
  const current = workspaces.find((workspace) => workspace.id === scope);
  return (
    <>
      <Menu>
        <MenuTrigger
          render={<Button variant="outline" aria-label="Show boards from" />}
          data-workspace-switcher
        >
          {current === undefined ? (
            scope === "personal" ? (
              <UserIcon />
            ) : (
              <LayoutGridIcon />
            )
          ) : (
            <WorkspaceMark name={current.name} color={current.color} />
          )}
          <span className="max-w-48 truncate">{scopeLabel(scope, workspaces)}</span>
          <ChevronDownIcon />
        </MenuTrigger>
        <MenuPopup align="start">
          <MenuRadioGroup value={scope} onValueChange={(value) => setWorkspaceScope(value)}>
            <MenuRadioItem value="all" closeOnClick>
              <LayoutGridIcon />
              All boards
            </MenuRadioItem>
            <MenuRadioItem value="personal" closeOnClick>
              <UserIcon />
              My boards
            </MenuRadioItem>
            {workspaces.length > 0 ? <MenuSeparator /> : null}
            {workspaces.map((workspace) => (
              <MenuRadioItem key={workspace.id} value={workspace.id} closeOnClick>
                <WorkspaceMark name={workspace.name} color={workspace.color} />
                <span className="min-w-0 truncate">{workspace.name}</span>
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          <MenuSeparator />
          <MenuItem onClick={() => setCreating(true)} data-new-workspace>
            <PlusIcon />
            New workspace
          </MenuItem>
        </MenuPopup>
      </Menu>
      {creating ? <NewWorkspaceDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

/** Starts a workspace from a screen with no switcher yet, such as the welcome. */
export function CreateWorkspaceButton() {
  const [creating, setCreating] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setCreating(true)} data-new-workspace>
        <UsersIcon />
        Create a workspace for your team
      </Button>
      {creating ? <NewWorkspaceDialog onClose={() => setCreating(false)} /> : null}
    </>
  );
}

function ColorPicker({
  value,
  onChange,
}: {
  readonly value: RoomBoardNoteColor;
  readonly onChange: (color: RoomBoardNoteColor) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Colour" className="flex gap-2">
      {ROOM_BOARD_NOTE_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          className={cn(
            "grid size-7 place-items-center rounded-md ring-1 ring-foreground/10 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
            paintSwatchClassName(color),
          )}
          onClick={() => onChange(color)}
        >
          {value === color ? <CheckIcon aria-hidden className="size-4" /> : null}
        </button>
      ))}
    </div>
  );
}

function NewWorkspaceDialog({ onClose }: { readonly onClose: () => void }) {
  const [name, setName] = useState("");
  const [color, setColor] = useState<RoomBoardNoteColor>("blue");
  const [pending, setPending] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "" || pending) return;
    setPending(true);
    const made = await createWorkspace({ name: trimmed, color });
    setPending(false);
    if (typeof made === "string") {
      toastManager.add({ type: "error", title: "Could not make the workspace", description: made });
      return;
    }
    setWorkspaceScope(made.id);
    toastManager.add({
      type: "success",
      title: `${made.name} is ready`,
      description: "Copy its invite link to bring your team in.",
    });
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-sm" bottomStickOnMobile={false}>
        <form className="flex min-h-0 flex-col" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>New workspace</DialogTitle>
            <DialogDescription>
              A place for your team's boards. Everyone in it sees and opens them.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Name
              <Input
                autoFocus
                maxLength={CLOUD_WORKSPACE_NAME_MAX_LENGTH}
                placeholder="Acme product team"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                data-new-workspace-name
              />
            </label>
            <div className="flex flex-col gap-1.5 text-sm font-medium">
              Colour
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </DialogPanel>
          <DialogFooter variant="bare">
            <Button type="submit" disabled={pending || name.trim() === ""}>
              Make workspace
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

/** Copies a workspace's invite link, saying so either way. */
function useCopyInvite() {
  const { copyToClipboard } = useCopyToClipboard({
    onCopy: () =>
      toastManager.add({
        type: "success",
        title: "Invite link copied",
        description: "Send it to your teammates. Tinkjam does not send emails yet.",
      }),
    onError: () =>
      toastManager.add({
        type: "error",
        title: "Could not copy the invite link",
        description: "Your browser did not allow it. Open People and copy it from there.",
      }),
  });
  return (workspace: CloudWorkspace) => {
    if (workspace.invite === undefined) {
      toastManager.add({
        type: "error",
        title: "The invite link is off",
        description: "An owner can make a new one in People.",
      });
      return;
    }
    copyToClipboard(workspaceInviteLink(workspace.invite), undefined);
  };
}

/** Shown in a workspace with nobody else in it yet, or no boards: the way to bring people in. */
export function WorkspaceInvite({ workspace }: { readonly workspace: CloudWorkspace }) {
  const copyInvite = useCopyInvite();
  const alone = workspace.members.length === 1;
  return (
    // Stacked on a phone: beside a wide button the words have no room.
    <div
      className="flex flex-col gap-3 rounded-board border border-dashed border-foreground/20 p-4 sm:flex-row sm:items-center"
      data-workspace-invite
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <WorkspaceMark name={workspace.name} color={workspace.color} size="md" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <p className="text-sm font-semibold">
            {alone ? `Invite your team to ${workspace.name}` : `No boards in ${workspace.name} yet`}
          </p>
          <p className="text-sm text-muted-foreground">
            {alone
              ? "Everyone you invite sees this workspace's boards and opens them as themselves. Tinkjam does not send emails yet: copy the link and send it."
              : "Press New board to start one, and everyone in the workspace sees it. A board you already made can move here from its menu."}
          </p>
        </div>
      </div>
      {workspace.invite === undefined ? null : (
        <Button variant="outline" onClick={() => copyInvite(workspace)}>
          <CopyIcon />
          Copy invite link
        </Button>
      )}
    </div>
  );
}

/** The people button beside the switcher, with the invite link and the members list. */
export function WorkspacePeople({ workspace }: { readonly workspace: CloudWorkspace }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)} data-workspace-people>
        <UsersIcon />
        People
        <span className="text-muted-foreground">{workspace.members.length}</span>
      </Button>
      {open ? <WorkspacePeopleDialog workspace={workspace} onClose={() => setOpen(false)} /> : null}
    </>
  );
}

const confirm = (message: string, confirmLabel: string) =>
  ensureLocalApi().dialogs.confirm(message, { variant: "destructive", confirmLabel });

const reportFailure = (title: string) => (failed: string | null) => {
  if (failed !== null) toastManager.add({ type: "error", title, description: failed });
  return failed === null;
};

function WorkspacePeopleDialog({
  workspace,
  onClose,
}: {
  readonly workspace: CloudWorkspace;
  readonly onClose: () => void;
}) {
  const owner = workspace.role === "owner";
  const copyInvite = useCopyInvite();
  const [name, setName] = useState(workspace.name);
  const [color, setColor] = useState(workspace.color);
  const renamed =
    name.trim() !== "" && (name.trim() !== workspace.name || color !== workspace.color);
  const link = workspace.invite === undefined ? null : workspaceInviteLink(workspace.invite);
  const sameName = sharedNameIds(
    workspace.members.map((member) => ({ id: member.memberId, name: member.name })),
  );
  const renew = async () => {
    if (
      workspace.invite !== undefined &&
      !(await confirm(
        "Make a new invite link?\nThe old link stops working. People already in stay in.",
        "Make a new link",
      ))
    ) {
      return;
    }
    const made = await renewWorkspaceInvite(workspace.id);
    if (typeof made === "string") {
      toastManager.add({ type: "error", title: "Could not make a new link", description: made });
    }
  };
  const leave = async () => {
    if (
      !(await confirm(
        `Leave ${workspace.name}?\nYou stop seeing its boards. Your cards on them stay.`,
        "Leave workspace",
      ))
    ) {
      return;
    }
    if (reportFailure("Could not leave")(await leaveWorkspace(workspace.id))) {
      setWorkspaceScope("all");
      onClose();
    }
  };
  const remove = async () => {
    const confirmed = await confirm(
      [
        `Delete ${workspace.name}?`,
        "Its boards are not deleted: they stay with everyone already on them, outside any workspace.",
      ].join("\n"),
      "Delete workspace",
    );
    if (!confirmed) return;
    if (reportFailure("Could not delete the workspace")(await deleteWorkspace(workspace.id))) {
      setWorkspaceScope("all");
      onClose();
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="sm:max-w-lg" data-workspace-people-dialog>
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <WorkspaceMark name={workspace.name} color={workspace.color} />
              {workspace.name}
            </span>
          </DialogTitle>
          <DialogDescription>
            Everyone here sees the workspace's boards and opens them as themselves.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <section className="flex flex-col gap-2" aria-label="Invite link">
            <p className="text-sm font-medium">Invite link</p>
            {link === null ? (
              <p className="text-sm text-muted-foreground">
                The invite link is off. {owner ? "Turn it on to invite people." : null}
              </p>
            ) : (
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={link}
                  aria-label="Invite link"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <Button variant="outline" onClick={() => copyInvite(workspace)}>
                  <CopyIcon />
                  Copy invite link
                </Button>
              </div>
            )}
            <p className="text-xs text-muted-foreground">
              Anyone with the link can join after signing in. Tinkjam does not send emails yet, so
              send the link yourself.
            </p>
            {owner ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => void renew()}>
                  {link === null ? "Turn on link" : "New link"}
                </Button>
                {link === null ? null : (
                  <Button
                    size="sm"
                    variant="ghost-destructive"
                    onClick={() =>
                      void endWorkspaceInvite(workspace.id).then(
                        reportFailure("Could not turn off the link"),
                      )
                    }
                  >
                    Turn off link
                  </Button>
                )}
              </div>
            ) : null}
          </section>
          <section className="flex flex-col gap-1" aria-label="People">
            <p className="text-sm font-medium">People</p>
            <ul className="flex flex-col" data-workspace-members>
              {workspace.members.map((member) => (
                <MemberRow
                  key={member.memberId}
                  member={member}
                  workspace={workspace}
                  canManage={owner && member.you !== true}
                  sameName={sameName.has(member.memberId)}
                />
              ))}
            </ul>
          </section>
          {owner ? (
            <section className="flex flex-col gap-2" aria-label="Name and colour">
              <p className="text-sm font-medium">Name and colour</p>
              <div className="flex gap-2">
                <Input
                  maxLength={CLOUD_WORKSPACE_NAME_MAX_LENGTH}
                  value={name}
                  aria-label="Workspace name"
                  onChange={(event) => setName(event.currentTarget.value)}
                />
                <Button
                  variant="outline"
                  disabled={!renamed}
                  onClick={() =>
                    void renameWorkspace(workspace.id, { name: name.trim(), color }).then(
                      reportFailure("Could not save"),
                    )
                  }
                >
                  Save
                </Button>
              </div>
              <ColorPicker value={color} onChange={setColor} />
            </section>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {owner ? (
            <Button variant="ghost-destructive" onClick={() => void remove()}>
              <Trash2Icon />
              Delete workspace
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => void leave()} data-leave-workspace>
            <LogOutIcon />
            Leave workspace
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

function MemberRow({
  member,
  workspace,
  canManage,
  sameName,
}: {
  readonly member: CloudWorkspaceMember;
  readonly workspace: CloudWorkspace;
  readonly canManage: boolean;
  /** Someone else here has the same name: their colour and join date tell them apart. */
  readonly sameName: boolean;
}) {
  const remove = async () => {
    const confirmed = await confirm(
      [
        `Remove ${member.name} from ${workspace.name}?`,
        "Its boards go from their account; their cards stay, with their name. Each board's link sharing stays as it is: a board with it on can still be opened by anyone with its link. To close one, open its Share and turn link sharing off.",
      ].join("\n"),
      "Remove person",
    );
    if (confirmed) {
      reportFailure("Could not remove them")(
        await removeWorkspaceMember(workspace.id, member.memberId),
      );
    }
  };
  const otherRole = member.role === "owner" ? "member" : "owner";
  return (
    <li className="flex min-h-10 items-center gap-3 py-1" data-workspace-member>
      {member.imageUrl === undefined ? (
        <span
          aria-hidden
          className={cn(
            "grid size-7 shrink-0 place-items-center rounded-full text-2xs font-semibold",
            sameName ? paintSwatchClassName(memberColor(member.memberId)) : "bg-muted",
          )}
        >
          {member.name.trim().charAt(0).toUpperCase()}
        </span>
      ) : (
        <img
          src={member.imageUrl}
          alt=""
          referrerPolicy="no-referrer"
          className="size-7 shrink-0 rounded-full object-cover"
        />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">
        {member.name}
        {member.you === true ? <span className="text-muted-foreground"> (you)</span> : null}
        {sameName ? (
          <span className="text-muted-foreground">
            {" "}
            · joined{" "}
            {new Date(member.joinedAt).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            })}
          </span>
        ) : null}
      </span>
      <span className="text-xs text-muted-foreground">
        {member.role === "owner" ? "Owner" : "Member"}
      </span>
      {canManage ? (
        <Menu>
          <MenuTrigger
            render={
              <Button size="icon-xs" variant="ghost-muted" aria-label={`More for ${member.name}`} />
            }
          >
            <EllipsisIcon />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem
              onClick={() =>
                void setWorkspaceMemberRole(workspace.id, member.memberId, otherRole).then(
                  reportFailure("Could not change their role"),
                )
              }
            >
              {otherRole === "owner" ? "Make owner" : "Make member"}
            </MenuItem>
            <MenuItem variant="destructive" onClick={() => void remove()}>
              <LogOutIcon />
              Remove from workspace
            </MenuItem>
          </MenuPopup>
        </Menu>
      ) : null}
    </li>
  );
}
