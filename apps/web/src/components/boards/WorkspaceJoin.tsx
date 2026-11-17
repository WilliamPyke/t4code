import type { CloudWorkspacePreview } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { LogInIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { joinWorkspace, previewWorkspaceInvite } from "~/guest/workspaces";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";
import { Spinner } from "../ui/spinner";
import { toastManager } from "../ui/toast";
import { AccountCorner } from "./BoardsAccount";
import { WorkspaceMark } from "./Workspaces";

/**
 * The page an invite link opens: what the workspace is, and joining it in one click. Someone
 * signed out signs in first and comes back here, link and all.
 */
export function WorkspaceJoinPage({ code }: { readonly code: string }) {
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
  if (code === "") {
    return (
      <Notice
        title="This invite link is not complete"
        detail="Copy the whole link again, or ask for a new one."
      />
    );
  }
  const result = preview?.code === code ? preview.result : null;
  if (result === null) {
    return (
      <Empty className="flex-1">
        <Spinner aria-label="Reading the invite" />
      </Empty>
    );
  }
  if (typeof result === "string") {
    return <Notice title="Could not open the invite" detail={result} />;
  }
  const join = async () => {
    setJoining(true);
    const joined = await joinWorkspace(code);
    setJoining(false);
    if (typeof joined === "string") {
      toastManager.add({ type: "error", title: "Could not join", description: joined });
      return;
    }
    toastManager.add({ type: "success", title: `You joined ${joined.name}` });
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
          {result.members === 1 ? "1 person is" : `${result.members} people are`} in this workspace.
          Once you join, you see its boards and open them as yourself.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {account.status === "signed-in" ? (
          <Button disabled={joining} aria-busy={joining || undefined} onClick={() => void join()}>
            {joining ? <Spinner aria-hidden /> : null}
            Join {result.name}
          </Button>
        ) : account.status === "signed-out" ? (
          <>
            <Button onClick={openAuthPrompt} data-workspace-join-sign-in>
              <LogInIcon />
              Sign in to join
            </Button>
            <p className="text-xs text-muted-foreground">You come back here after signing in.</p>
          </>
        ) : (
          <Spinner aria-label="Checking who is signed in" />
        )}
      </EmptyContent>
    </Empty>
  );
}
