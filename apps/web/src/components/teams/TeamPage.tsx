import {
  RELAY_TEAM_NAME_MAX_LENGTH,
  type RelayTeam,
  type RelayTeamMember,
  type RelayTeamRemovedMember,
  type RelayTeamThread,
} from "@t3tools/contracts/relay";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, CopyIcon } from "lucide-react";
import { type FormEvent, type ReactNode, useState } from "react";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { ensureLocalApi } from "~/localApi";
import {
  allowTeamMemberBack,
  createTeamInvite,
  deleteTeam,
  leaveTeam,
  refreshTeams,
  removeTeamMember,
  renameTeam,
  resetTeamInvite,
  type TeamsOutcome,
  useTeam,
} from "~/teams/teams";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
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
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { MemberAvatar } from "./MemberAvatar";
import { TeamBoard } from "./TeamBoard";
import { useOpenTeamThread } from "./useOpenTeamThread";

function TeamPageFrame({
  title,
  actions,
  fill = false,
  children,
}: {
  readonly title: string;
  readonly actions?: ReactNode;
  /** The content fills the page and scrolls on its own, as a board does. */
  readonly fill?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
          {actions === undefined ? null : <div className="ms-auto flex shrink-0">{actions}</div>}
        </WorkspacePageHeader>
        <div className={fill ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-y-auto"}>
          {children}
        </div>
      </div>
    </SidebarInset>
  );
}

type TeamView = "threads" | "board";

type InviteState =
  | { readonly status: "idle" | "working" }
  | { readonly status: "ready"; readonly url: string; readonly expiresAt: string }
  | { readonly status: "failed"; readonly message: string };

const inviteState = (
  made: TeamsOutcome<{ readonly url: string; readonly expiresAt: string }>,
): InviteState =>
  made.ok
    ? { status: "ready", url: made.value.url, expiresAt: made.value.expiresAt }
    : { status: "failed", message: made.message };

function TeamNotice({ title, detail }: { readonly title: string; readonly detail?: string }) {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyTitle>{title}</EmptyTitle>
        {detail === undefined ? null : <EmptyDescription>{detail}</EmptyDescription>}
      </EmptyHeader>
    </Empty>
  );
}

function SignInToSeeTeams() {
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <div className="flex flex-col items-center gap-3 p-8 text-center">
      <TeamNotice title="Sign in to see this team" detail="Teams use your Tinkjam account." />
      <Button size="sm" onClick={openAuthPrompt}>
        Sign in to Tinkjam
      </Button>
    </div>
  );
}

/** A team's members and the threads shared with it, with what the signed-in member can change. */
export function TeamPage({ teamId }: { readonly teamId: string }) {
  const { accountId, team, error, loading } = useTeam(teamId);
  const [view, setView] = useState<TeamView>("threads");
  if (accountId === null) {
    return (
      <TeamPageFrame title="Team">
        {hasCloudPublicConfig() ? (
          <SignInToSeeTeams />
        ) : (
          <TeamNotice
            title="Teams need a Tinkjam account"
            detail="This copy of Tinkjam cannot sign in to an account."
          />
        )}
      </TeamPageFrame>
    );
  }
  if (team === null) {
    return (
      <TeamPageFrame title="Team">
        {error !== null ? (
          <TeamNotice title="Could not open this team" detail={error} />
        ) : loading ? null : (
          <TeamNotice title="Could not open this team" />
        )}
      </TeamPageFrame>
    );
  }
  const showView = (next: TeamView) => {
    // The board's cards are the team's threads and members, so it opens on fresh ones.
    if (next === "board") refreshTeams(teamId);
    setView(next);
  };
  return (
    <TeamPageFrame
      title={team.name}
      fill={view === "board"}
      actions={
        <ToggleGroup
          aria-label="Team view"
          value={[view]}
          onValueChange={(next) => {
            const value = next[0];
            if (value === "threads" || value === "board") showView(value);
          }}
        >
          <Toggle value="threads">Threads</Toggle>
          <Toggle value="board">Board</Toggle>
        </ToggleGroup>
      }
    >
      {view === "board" ? (
        <TeamBoard team={team} accountId={accountId} onShowThreads={() => showView("threads")} />
      ) : (
        <TeamDetails team={team} accountId={accountId} />
      )}
    </TeamPageFrame>
  );
}

function TeamDetails({
  team,
  accountId,
}: {
  readonly team: RelayTeam;
  readonly accountId: string;
}) {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<InviteState>({ status: "idle" });
  const [removing, setRemoving] = useState<RelayTeamMember | null>(null);
  const owner = team.role === "owner";
  const act = async <A,>(action: () => Promise<TeamsOutcome<A>>, then?: (value: A) => void) => {
    setBusy(true);
    setError(null);
    const outcome = await action();
    setBusy(false);
    if (!outcome.ok) return setError(outcome.message);
    then?.(outcome.value);
  };
  const confirm = (message: string, confirmLabel: string) =>
    ensureLocalApi().dialogs.confirm(message, { variant: "destructive", confirmLabel });
  const goHome = () => void navigate({ to: "/" });

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-6">
      <div className="flex flex-wrap items-center gap-2">
        {owner ? <RenameTeam team={team} /> : null}
        <div className="ms-auto flex gap-2">
          {owner ? (
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm(
                    `Delete ${team.name}?\nEveryone loses the team, and its threads are no longer listed for them.`,
                    "Delete team",
                  )
                ) {
                  void act(() => deleteTeam(team.id), goHome);
                }
              }}
            >
              Delete team
            </Button>
          ) : (
            <Button
              size="sm"
              variant="destructive-outline"
              disabled={busy}
              onClick={async () => {
                if (
                  await confirm(
                    `Leave ${team.name}?\nThreads you shared with it are no longer listed for the team.`,
                    "Leave team",
                  )
                ) {
                  void act(() => leaveTeam(team.id), goHome);
                }
              }}
            >
              Leave team
            </Button>
          )}
        </div>
      </div>
      {error === null ? null : (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <InviteLink teamId={team.id} owner={owner} invite={invite} setInvite={setInvite} />

      <section aria-label="Shared threads" className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">Shared threads</h2>
        {team.threads.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No threads yet. Share one from its menu with Share with guests, then pick this team.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {team.threads.map((thread) => (
              <TeamThreadRow
                key={`${thread.environmentId}:${thread.threadId}`}
                team={team}
                thread={thread}
              />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Members" className="flex flex-col gap-2">
        <h2 className="font-medium text-sm">Members</h2>
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {team.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
              <MemberAvatar name={member.name} avatarUrl={member.avatarUrl} />
              <span className="min-w-0 truncate">{member.name}</span>
              {member.role === "owner" ? (
                <span className="text-muted-foreground text-xs">Owner</span>
              ) : null}
              {owner && member.userId !== accountId && member.role !== "owner" ? (
                <Button
                  size="xs"
                  variant="ghost-destructive"
                  className="ms-auto"
                  disabled={busy}
                  aria-label={`Remove ${member.name}`}
                  onClick={() => setRemoving(member)}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {owner && team.removed !== undefined && team.removed.length > 0 ? (
        <RemovedPeople
          team={team}
          busy={busy}
          onAllowBack={(person) => void act(() => allowTeamMemberBack(team.id, person.userId))}
        />
      ) : null}

      <RemoveMemberDialog
        team={team}
        member={removing}
        onCancel={() => setRemoving(null)}
        onConfirm={(member, newLink) => {
          setRemoving(null);
          void act(
            () => removeTeamMember(team.id, member.userId),
            () => {
              if (!newLink) return;
              setInvite({ status: "working" });
              void resetTeamInvite(team.id).then((made) => setInvite(inviteState(made)));
            },
          );
        }}
      />
    </div>
  );
}

function RemoveMemberDialog({
  team,
  member,
  onCancel,
  onConfirm,
}: {
  readonly team: RelayTeam;
  readonly member: RelayTeamMember | null;
  readonly onCancel: () => void;
  readonly onConfirm: (member: RelayTeamMember, newLink: boolean) => void;
}) {
  const [newLink, setNewLink] = useState(false);
  // Kept while the dialog closes, so its text does not empty mid-animation.
  const [shown, setShown] = useState(member);
  if (member !== null && member !== shown) setShown(member);
  return (
    <AlertDialog
      open={member !== null}
      onOpenChange={(open) => {
        if (open) return;
        setNewLink(false);
        onCancel();
      }}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove {shown?.name} from {team.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Threads they shared with the team are no longer listed. They cannot join again with an
            invite link unless you allow them back.
          </AlertDialogDescription>
          <label className="flex cursor-pointer items-start gap-2 text-sm">
            <Checkbox
              checked={newLink}
              onCheckedChange={(checked) => setNewLink(checked === true)}
            />
            <span>
              Also make a new invite link
              <span className="block text-muted-foreground text-xs">
                The current link stops working for everyone, in case it was passed on.
              </span>
            </span>
          </label>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="outline" />}>Cancel</AlertDialogClose>
          <Button
            variant="destructive"
            onClick={() => {
              if (member === null) return;
              setNewLink(false);
              onConfirm(member, newLink);
            }}
          >
            Remove from team
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  );
}

function RemovedPeople({
  team,
  busy,
  onAllowBack,
}: {
  readonly team: RelayTeam;
  readonly busy: boolean;
  readonly onAllowBack: (person: RelayTeamRemovedMember) => void;
}) {
  return (
    <section aria-label="Removed people" className="flex flex-col gap-2">
      <h2 className="font-medium text-sm">Removed</h2>
      <p className="text-muted-foreground text-xs">
        They cannot join with an invite link until you allow them back.
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
        {team.removed?.map((person) => (
          <li key={person.userId} className="flex items-center gap-2 px-3 py-2 text-sm">
            <span className="min-w-0 truncate">{person.name}</span>
            <span className="shrink-0 text-muted-foreground text-xs">
              Removed {new Date(person.removedAt).toLocaleDateString()}
            </span>
            <Button
              size="xs"
              variant="outline"
              className="ms-auto"
              disabled={busy}
              aria-label={`Allow ${person.name} back`}
              onClick={() => onAllowBack(person)}
            >
              Allow back
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TeamThreadRow({
  team,
  thread,
}: {
  readonly team: RelayTeam;
  readonly thread: RelayTeamThread;
}) {
  const { state, open } = useOpenTeamThread(team.id, thread);
  const sharedBy = team.members.find((member) => member.userId === thread.ownerUserId)?.name;
  return (
    <li className="flex items-center gap-3 px-3 py-2 text-sm">
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{thread.title || "Shared thread"}</span>
        <span className="truncate text-muted-foreground text-xs">
          {state !== "idle" && state !== "opening"
            ? state
            : sharedBy === undefined
              ? "Shared with the team"
              : `Shared by ${sharedBy}`}
        </span>
      </div>
      <Button
        size="xs"
        variant="outline"
        disabled={state === "opening"}
        onClick={() => void open()}
      >
        {state === "opening" ? "Opening..." : "Open"}
      </Button>
    </li>
  );
}

function RenameTeam({ team }: { readonly team: RelayTeam }) {
  const [name, setName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (name === null) {
    return (
      <Button size="sm" variant="outline" onClick={() => setName(team.name)}>
        Rename
      </Button>
    );
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim();
    if (trimmed === "") return;
    const renamed = await renameTeam(team.id, trimmed);
    if (!renamed.ok) return setError(renamed.message);
    setName(null);
  };
  return (
    <form className="flex items-center gap-2" onSubmit={submit}>
      <Input
        autoFocus
        aria-label="Team name"
        maxLength={RELAY_TEAM_NAME_MAX_LENGTH}
        value={name}
        onChange={(event) => setName(event.target.value)}
      />
      <Button type="submit" size="sm" disabled={name.trim() === ""}>
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost-muted" onClick={() => setName(null)}>
        Cancel
      </Button>
      {error === null ? null : (
        <span role="alert" className="text-destructive text-xs">
          {error}
        </span>
      )}
    </form>
  );
}

function InviteLink({
  teamId,
  owner,
  invite,
  setInvite,
}: {
  readonly teamId: string;
  readonly owner: boolean;
  readonly invite: InviteState;
  readonly setInvite: (next: InviteState) => void;
}) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "team invite" });
  if (invite.status !== "ready") {
    return (
      <section aria-label="Invite" className="flex flex-col items-start gap-2">
        <Button
          size="sm"
          disabled={invite.status === "working"}
          onClick={async () => {
            setInvite({ status: "working" });
            setInvite(inviteState(await createTeamInvite(teamId)));
          }}
        >
          {invite.status === "working" ? "Working..." : "Invite people"}
        </Button>
        {invite.status === "failed" ? (
          <p role="alert" className="text-destructive text-xs">
            {invite.message}
          </p>
        ) : null}
      </section>
    );
  }
  const makeNewLink = async () => {
    const confirmed = await ensureLocalApi().dialogs.confirm(
      "Turn off this invite link?\nNobody can join with it any more. A new link replaces it.",
      { variant: "destructive", confirmLabel: "Make a new link" },
    );
    if (!confirmed) return;
    setInvite({ status: "working" });
    setInvite(inviteState(await resetTeamInvite(teamId)));
  };
  return (
    <section aria-label="Invite" className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          readOnly
          aria-label="Team invite link"
          value={invite.url}
          onFocus={(event) => event.currentTarget.select()}
        />
        <Button size="sm" variant="outline" onClick={() => copyToClipboard(invite.url)}>
          {isCopied ? <CheckIcon /> : <CopyIcon />}
          {isCopied ? "Copied" : "Copy"}
        </Button>
        {owner ? (
          <Button size="sm" variant="ghost-muted" onClick={() => void makeNewLink()}>
            Make a new link
          </Button>
        ) : null}
      </div>
      <p className="text-muted-foreground text-xs">
        Anyone signed in to Tinkjam who opens it before{" "}
        {new Date(invite.expiresAt).toLocaleDateString()} joins the team, except people{" "}
        {owner ? "you" : "the owner"} removed.
      </p>
    </section>
  );
}
