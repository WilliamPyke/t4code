import type { RoomArtifactContent } from "@t3tools/contracts";
import { type PointerEvent, useState } from "react";

import { formatDayAwareTimestamp } from "~/timestampFormat";

import ChatMarkdown from "../ChatMarkdown";
import { Button } from "../ui/button";
import { isBoardHtmlArtifact } from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * What an agent wrote into an artifact card: a whole HTML page in a sandboxed frame with no access
 * to this page, or markdown. The frame lets pointers through to the board while anything on it is
 * dragged, so a drag over the frame does not stall.
 */
export function RoomArtifactBody({
  artifact,
  promptable = false,
}: {
  readonly artifact: RoomArtifactContent | undefined;
  /** The card has a prompt box of its own. */
  readonly promptable?: boolean;
}) {
  if (artifact === undefined) {
    return (
      <p className="min-h-0 flex-1 px-3 pb-3 text-xs text-muted-foreground">
        {promptable
          ? "Nothing here yet. Ask below, and the reply shows here for everyone. Arrows into this card add those cards to what you ask."
          : "Nothing here yet. Draw an arrow from the thread's card to this card, then ask from the box on the thread's card. The reply shows here for everyone."}
      </p>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-border">
      {isBoardHtmlArtifact(artifact.body) ? (
        <iframe
          aria-label="Artifact page"
          sandbox="allow-scripts"
          srcDoc={artifact.body}
          className="min-h-0 w-full flex-1 rounded-b-sm border-0 group-data-board-busy/board:pointer-events-none"
        />
      ) : (
        <div
          data-board-scroll
          className="min-h-0 flex-1 cursor-auto overflow-auto px-3 py-2"
          onPointerDown={stopPointer}
        >
          <ChatMarkdown text={artifact.body} cwd={undefined} />
        </div>
      )}
      {artifact.truncated === true ? (
        <p className="shrink-0 px-3 py-1 text-2xs text-muted-foreground">
          Cut short: the reply was longer than the board keeps.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Who wrote an artifact's current version and when, whose agents are writing it now, and the way
 * back to the version before.
 */
export function RoomArtifactMeta({
  author,
  updatedAt,
  writing,
  onRestore,
}: {
  /** Absent before anything was written. */
  readonly author: string | undefined;
  readonly updatedAt: string | undefined;
  readonly writing: string | null;
  /** Swaps in the version before. Absent when there is none, or the viewer may not. */
  readonly onRestore: (() => Promise<boolean>) | undefined;
}) {
  const [restoring, setRestoring] = useState(false);
  const restore = async () => {
    if (onRestore === undefined || restoring) return;
    setRestoring(true);
    await onRestore().catch(() => false);
    setRestoring(false);
  };
  if (author === undefined && writing === null) return null;
  return (
    <div className="flex shrink-0 flex-col gap-0.5 px-3 pb-1.5">
      {author === undefined ? null : (
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {author}
            {updatedAt === undefined ? null : ` · ${formatDayAwareTimestamp(updatedAt, "locale")}`}
          </p>
          {onRestore === undefined ? null : (
            <Button
              size="micro"
              variant="ghost-muted"
              disabled={restoring}
              onPointerDown={stopPointer}
              onClick={() => void restore()}
            >
              {restoring ? "Restoring..." : "Restore previous"}
            </Button>
          )}
        </div>
      )}
      {writing === null ? null : (
        <p role="status" className="text-2xs font-medium text-info">
          {writing}
        </p>
      )}
    </div>
  );
}
