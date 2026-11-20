import { GUEST_NAME_MAX_LENGTH, type CloudWorkspacePreview } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogInIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { rememberBoardName, suggestedBoardName } from "~/guest/cloudBoards";
import { joinWorkspace, previewWorkspaceInvite } from "~/guest/workspaces";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { TinkjamLoading } from "../TinkjamLoading";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { Input } from "../ui/input";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { AccountCorner } from "./BoardsAccount";
import { workspaceJoinStep } from "./workspaceJoin.logic";
import { WorkspaceMark } from "./Workspaces";

// Per tab: the invite's code while its person signs in, so the address they sign in from (which
// sign-in passes along) does not carry it. Never sent anywhere; gone once they join.
const PENDING_INVITE_KEY = "t3code:pending-workspace-invite:v1";

function readKeptInvite(): string {
  try {
    return window.sessionStorage.getItem(PENDING_INVITE_KEY) ?? "";
  } catch {
    return "";
  }
}

function keepInviteForSignIn(code: string) {
  try {
    window.sessionStorage.setItem(PENDING_INVITE_KEY, code);
  } catch {}
  window.history.replaceState(
    window.history.state,
    "",
    `${window.location.pathname}${window.location.search}`,
  );
}

function forgetKeptInvite() {
  try {
    window.sessionStorage.removeItem(PENDING_INVITE_KEY);
  } catch {}
}

/**
 * The page an invite link opens: what the workspace is, and joining it in one click. Someone
 * signed out signs in first, and the invite is still here when they have.
 */
export function WorkspaceJoinPage({ hash }: { readonly hash: string }) {
  // Held once read: the address loses the code when its person signs in and as the page leaves.
  const [code, setCode] = useState(() => hash || readKeptInvite());
  if (hash !== "" && hash !== code) setCode(hash);
  return (
    <SidebarInset className="relative h-dvh min-h-0 overflow-y-auto overscroll-y-none">
      <AccountCorner />
      {boardAccountsEnabled() ? (
        <WorkspaceJoin code={code} />
      ) : (
        <Notice
          title="Open this link in the Tinkjam web app"
          detail="Workspaces need a Tinkjam account, and this copy of Tinkjam has no sign-in."
        />
      )}
    </SidebarInset>
  );
}

function Notice({ title, detail }: { readonly title: string; readonly detail: string }) {
  return (
    <Empty className="flex-1">
      <EmptyHeader className="max-w-md">
        <EmptyTitle>{title}</EmptyTitle>
        <EmptyDescription>{detail}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button variant="outline" render={<Link to="/" />}>
          Go to your boards
        </Button>
      </EmptyContent>
    </Empty>
  );
}

function WorkspaceJoin({ code }: { readonly code: string }) {
  const account = useBoardAccount();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const navigate = useNavigate();
  const [preview, setPreview] = useState<{
    readonly code: string;
    readonly result: CloudWorkspacePreview | string;
  } | null>(null);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [name, setName] = useState(suggestedBoardName);
  // An account with no name is asked for one here, once; the field stays while it joins.
  const [asksName, setAsksName] = useState(false);
  if (!asksName && account.status === "signed-in" && account.name === null) setAsksName(true);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads what the invite link is for from the board service once per link
  useEffect(() => {
    if (code === "") return;
    let stopped = false;
    void previewWorkspaceInvite(code).then((result) => {
      if (!stopped) setPreview({ code, result });
    });
    return () => {
      stopped = true;
    };
  }, [code]);
  const result = preview?.code === code ? preview.result : null;
  const step = workspaceJoinStep({ code, joined, preview: result, account: account.status });
  if (step === "incomplete") {
    return (
      <Notice
        title="This invite link is not complete"
        detail="Copy the whole link again, or ask for a new one."
      />
    );
  }
  if (step === "refused" && typeof result === "string") {
    return <Notice title="Could not open the invite" detail={result} />;
  }
  if (step !== "invite" || result === null || typeof result === "string") {
    return <TinkjamLoading cover label={joined ? "Opening the workspace" : "Opening the invite"} />;
  }
  const signedIn = account.status === "signed-in";
  const typed = name.trim();
  const join = async (event: FormEvent) => {
    event.preventDefault();
    if (joining || (asksName && typed === "")) return;
    setJoining(true);
    // Kept on the account first, so the workspace lists them under it from the start.
    if (asksName) rememberBoardName(typed);
    const entered = await joinWorkspace(code);
    if (typeof entered === "string") {
      setJoining(false);
      toastManager.add({ type: "error", title: "Could not join", description: entered });
      return;
    }
    forgetKeptInvite();
    setJoined(true);
    toastManager.add({ type: "success", title: `You joined ${entered.name}` });
    void navigate({ to: "/", replace: true });
  };
  return (
    <Empty className="flex-1" data-workspace-join>
      <EmptyHeader className="max-w-md">
        <EmptyMedia>
          <WorkspaceMark name={result.name} color={result.color} size="md" />
        </EmptyMedia>
        <EmptyTitle>Join {result.name} on Tinkjam</EmptyTitle>
        <EmptyDescription>
          {result.owner === undefined ? null : `${result.owner} runs this workspace. `}
          {result.members === 1 ? "1 person is" : `${result.members} people are`} in it. Once you
          join, you see its boards and open them as yourself.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {signedIn ? (
          <form className="flex w-full max-w-xs flex-col gap-3" onSubmit={join}>
            {asksName ? (
              <label
                className="flex flex-col gap-1.5 text-start text-sm font-medium"
                htmlFor="workspace-join-name"
              >
                Your name
                <Input
                  id="workspace-join-name"
                  autoComplete="name"
                  maxLength={GUEST_NAME_MAX_LENGTH}
                  value={name}
                  disabled={joining}
                  onChange={(event) => setName(event.target.value)}
                />
                <span className="text-xs font-normal text-muted-foreground">
                  Your teammates see this name. It is saved to your account.
                </span>
              </label>
            ) : null}
            <Button
              type="submit"
              disabled={joining || (asksName && typed === "")}
              aria-busy={joining || undefined}
              data-workspace-join-submit
            >
              {joining ? <Spinner aria-hidden /> : null}
              Join {result.name}
            </Button>
          </form>
        ) : (
          <>
            <Button
              onClick={() => {
                keepInviteForSignIn(code);
                openAuthPrompt();
              }}
              data-workspace-join-sign-in
            >
              <LogInIcon />
              Sign in to join
            </Button>
            <p className="text-xs text-muted-foreground">
              New to Tinkjam? The same button makes your account and brings you back here.
            </p>
          </>
        )}
      </EmptyContent>
    </Empty>
  );
}
