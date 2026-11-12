import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import {
  RELAY_TEAM_NAME_MAX_LENGTH,
  type RelayTeam,
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
  createTeamInvite,
  deleteTeam,
  joinTeamThread,
  leaveTeam,
  removeTeamMember,
  renameTeam,
  type TeamsOutcome,
  useTeam,
} from "~/teams/teams";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { WorkspacePageHeader } from "../WorkspacePageHeader";
import { MemberAvatar } from "./MemberAvatar";

function TeamPageFrame({
  title,
  children,
}: {
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </WorkspacePageHeader>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </div>
    </SidebarInset>
  );
}

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
      <TeamNotice title="Sign in to see this team" detail="Teams use your T Connect account." />
      <Button size="sm" onClick={openAuthPrompt}>
        Sign in to T Connect
      </Button>
    </div>
  );
}

/** A team's members and the threads shared with it, with what the signed-in member can change. */
export function TeamPage({ teamId }: { readonly teamId: string }) {
  const { accountId, team, error, loading } = useTeam(teamId);
  if (accountId === null) {
    return (
      <TeamPageFrame title="Team">
        {hasCloudPublicConfig() ? (
          <SignInToSeeTeams />
        ) : (
          <TeamNotice title="Teams need T Connect" detail="This copy of T Code has no T Connect." />
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
  return (
    <TeamPageFrame title={team.name}>
      <TeamDetails team={team} accountId={accountId} />
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
  const owner = team.role === "owner";
  const act = async <A,>(action: () => Promise<TeamsOutcome<A>>, then?: (value: A) => void) => {
    setBusy(true);
    setError(null);
    const outcome = await action();
    setBusy(false);
    if (!outcome.ok) return setError(outcome.message);
    then?.(outcome.value);
  };
  const confirm = (message: string) =>
    ensureLocalApi().dialogs.confirm(message, { variant: "destructive" });
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

      <InviteLink teamId={team.id} />

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
                  onClick={async () => {
                    if (
                      await confirm(
                        `Remove ${member.name} from ${team.name}?\nThreads they shared with the team are no longer listed.`,
                      )
                    ) {
                      void act(() => removeTeamMember(team.id, member.userId));
                    }
                  }}
                >
                  Remove
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function TeamThreadRow({
  team,
  thread,
}: {
  readonly team: RelayTeam;
  readonly thread: RelayTeamThread;
}) {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "opening" | string>("idle");
  const sharedBy = team.members.find((member) => member.userId === thread.ownerUserId)?.name;
  const open = async () => {
    setState("opening");
    const joined = await joinTeamThread(team.id, thread);
    if (!joined.ok) return setState(joined.message);
    setState("idle");
    void navigate({
      to: "/$environmentId/$threadId",
      params: {
        environmentId: guestEnvironmentId(joined.value.shareId),
        threadId: joined.value.threadId,
      },
    });
  };
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

function InviteLink({ teamId }: { readonly teamId: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "team invite" });
  const [invite, setInvite] = useState<
    | { readonly status: "idle" | "working" }
    | { readonly status: "ready"; readonly url: string; readonly expiresAt: string }
    | { readonly status: "failed"; readonly message: string }
  >({ status: "idle" });
  if (invite.status !== "ready") {
    return (
      <section aria-label="Invite" className="flex flex-col items-start gap-2">
        <Button
          size="sm"
          disabled={invite.status === "working"}
          onClick={async () => {
            setInvite({ status: "working" });
            const made = await createTeamInvite(teamId);
            setInvite(
              made.ok
                ? { status: "ready", url: made.value.url, expiresAt: made.value.expiresAt }
                : { status: "failed", message: made.message },
            );
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
      </div>
      <p className="text-muted-foreground text-xs">
        Anyone signed in to T Connect who opens it before{" "}
        {new Date(invite.expiresAt).toLocaleDateString()} joins the team.
      </p>
    </section>
  );
}
