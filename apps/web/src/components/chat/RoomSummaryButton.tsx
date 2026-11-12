import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  roomCatchUpFailureMessage,
  roomSummaryOutcome,
} from "@t3tools/client-runtime/room-catch-up";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useComposerHandleContext } from "~/composerHandleContext";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useQuietThreadProjection } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { Button } from "../ui/button";

/**
 * Beside Catch up on a thread joined from a room: catches up and drafts a request for the
 * user's own agent to summarize it. Only a draft: the user reads, edits and sends it.
 */
export function RoomSummaryButton({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const roomLink = useQuietThreadProjection(threadRef)?.projection.thread.roomLink ?? null;
  const canCatchUp = useAtomValue(
    serverEnvironment.catchUpSharedRoom.permissionAtom(threadRef.environmentId),
  );
  const catchUpSharedRoom = useAtomCommand(serverEnvironment.catchUpSharedRoom, "catch up");
  const composerRef = useComposerHandleContext();
  const nowMinute = useNowMinute();
  const [status, setStatus] = useState<"idle" | "working" | string>("idle");
  if (roomLink === null || roomLink.expiresAt.slice(0, 16) <= nowMinute) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
      {status === "idle" || status === "working" ? null : <span role="status">{status}</span>}
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={!canCatchUp || status === "working"}
        onClick={async () => {
          setStatus("working");
          const result = await catchUpSharedRoom({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          });
          if (result._tag === "Failure") {
            setStatus(
              isAtomCommandInterrupted(result)
                ? "idle"
                : roomCatchUpFailureMessage(squashAtomCommandFailure(result)),
            );
            return;
          }
          const store = useComposerDraftStore.getState();
          const outcome = roomSummaryOutcome(
            result.value,
            store.getComposerDraft(threadRef)?.prompt ?? "",
          );
          setStatus(outcome.status);
          if (outcome.record === null || outcome.prompt === null) return;
          store.setPrompt(threadRef, outcome.prompt);
          // Appended after the request, which refers to it as attached.
          store.addRoomUpdatesContexts(threadRef, [outcome.record], { insertAtCaret: false });
          // After the editor has taken the new prompt, so the caret lands at its end.
          window.requestAnimationFrame(() => composerRef?.current?.focusAtEnd());
        }}
      >
        Summarize what I missed
      </Button>
    </div>
  );
}
