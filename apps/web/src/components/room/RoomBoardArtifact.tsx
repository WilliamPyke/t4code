import type { RoomArtifactContent } from "@t3tools/contracts";
import type { PointerEvent } from "react";

import ChatMarkdown from "../ChatMarkdown";
import { isBoardHtmlArtifact } from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * What an agent wrote into an artifact card: a whole HTML page in a sandboxed frame with no access
 * to this page, or markdown. The frame lets pointers through to the board while anything on it is
 * dragged, so a drag over the frame does not stall.
 */
export function RoomArtifactBody({
  artifact,
}: {
  readonly artifact: RoomArtifactContent | undefined;
}) {
  if (artifact === undefined) {
    return (
      <p className="px-3 pb-3 text-xs text-muted-foreground">
        Nothing here yet. Draw an arrow from the thread's card to this card, then ask from the box
        on the thread's card. The reply shows here for everyone.
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
