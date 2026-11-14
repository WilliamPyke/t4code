import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { acceptTeamInvite, useTeamsAccount } from "~/teams/teams";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";

/** Where a team invite lands: sign in if needed, then join and go to the team. */
export function TeamInvitePage({ name }: { readonly name: string }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden">
      <Empty className="flex-1">
        {hasCloudPublicConfig() ? (
          <ConfiguredTeamInvite name={name} />
        ) : (
          <EmptyHeader>
            <EmptyTitle>Teams need T Connect</EmptyTitle>
            <EmptyDescription>Open this invite in the hosted T Code app.</EmptyDescription>
          </EmptyHeader>
        )}
      </Empty>
    </SidebarInset>
  );
}

function ConfiguredTeamInvite({ name }: { readonly name: string }) {
  const accountId = useTeamsAccount();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "joining" | string>("idle");
  const join = async () => {
    setState("joining");
    const accepted = await acceptTeamInvite(name);
    if (!accepted.ok) return setState(accepted.message);
    void navigate({
      to: "/teams/$teamId",
      params: { teamId: accepted.value.teamId },
      replace: true,
    });
  };
  return (
    <>
      <EmptyHeader>
        <EmptyTitle>Join a team</EmptyTitle>
        <EmptyDescription>
          {accountId === null
            ? "Sign in to T Connect to join. The team sees your account's name and picture."
            : "You join with your T Connect account. The team sees its name and picture."}
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        {accountId === null ? (
          <Button size="sm" onClick={openAuthPrompt}>
            Sign in to T Connect
          </Button>
        ) : (
          <Button size="sm" disabled={state === "joining"} onClick={() => void join()}>
            {state === "joining" ? "Joining..." : "Join team"}
          </Button>
        )}
        {state !== "idle" && state !== "joining" ? (
          <p role="alert" className="text-destructive text-sm">
            {state}
          </p>
        ) : null}
      </EmptyContent>
    </>
  );
}
