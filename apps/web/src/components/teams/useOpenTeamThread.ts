import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import type { RelayTeamThread } from "@t3tools/contracts/relay";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";

import { joinTeamThread } from "~/teams/teams";

/** Joins a team's thread as the member and opens it; `state` is "idle", "opening", or why not. */
export function useOpenTeamThread(teamId: string, thread: RelayTeamThread) {
  const navigate = useNavigate();
  const [state, setState] = useState<"idle" | "opening" | string>("idle");
  const open = async () => {
    setState("opening");
    const joined = await joinTeamThread(teamId, thread);
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
  return { state, open };
}
