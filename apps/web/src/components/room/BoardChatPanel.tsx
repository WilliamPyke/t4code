import { scopeThreadRef, scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { ExternalLinkIcon, XIcon } from "lucide-react";

import { useDiffPanelStore } from "~/diffPanelStore";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import type { SideChatParentPanel } from "~/lib/sideChatPane";
import { useRightPanelStore } from "~/rightPanelStore";

import ChatView from "../ChatView";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * A conversation on the owner's machine beside the board: the thread's own chat, with its composer,
 * approvals, stop and model picker. It is the only chat of the thread mounted while the board is
 * open; the full thread route mounts its own once the owner pops out.
 */
export function BoardChatPanel({
  environmentId,
  threadId,
  title,
  onClose,
  onPopOut,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly title: string;
  readonly onClose: () => void;
  readonly onPopOut: () => void;
}) {
  const threadRef = scopeThreadRef(environmentId, threadId);
  const { copyToClipboard } = useCopyToClipboard({
    target: "command",
    onCopy: () =>
      toastManager.add({
        type: "info",
        title: "Command copied",
        description: "Open the full thread to run it in its terminal.",
      }),
  });
  // The board has no diff panel or terminal of its own: a diff opens in the full thread.
  const parentPanel: SideChatParentPanel = {
    openToolDiff: (target) => {
      useDiffPanelStore.getState().selectToolCall(threadRef, target);
      useRightPanelStore.getState().open(threadRef, "diff");
      onPopOut();
    },
    runShellCommand: (command) => copyToClipboard(command, undefined),
  };
  return (
    // Marked as an embedded chat, so the chat's shortcuts answer only while focus is inside it.
    <div data-side-chat-pane className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Open the full thread"
                onClick={onPopOut}
              />
            }
          >
            <ExternalLinkIcon />
          </TooltipTrigger>
          <TooltipPopup side="bottom">Open the full thread</TooltipPopup>
        </Tooltip>
        <Button variant="ghost" size="icon-xs" aria-label="Close conversation" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <ChatView
        key={scopedThreadKey(threadRef)}
        environmentId={environmentId}
        threadId={threadId}
        routeKind="server"
        embedded={parentPanel}
      />
    </div>
  );
}
