import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useState } from "react";

import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { UNTITLED_BOARD } from "./boardsHome.logic";

// Boards made in this tab whose name is not yet confirmed: they open with the name being edited,
// so the first keys typed name the board instead of reaching a prompt. A reload forgets them.
const boardsToName = new Set<string>();
const boardKey = (ref: ScopedThreadRef) => `${ref.environmentId}:${ref.threadId}`;

/** Opens this new board with its name being edited. */
export const nameBoardOnOpen = (ref: ScopedThreadRef) => void boardsToName.add(boardKey(ref));

/**
 * A board's name in its header, renamed in place: click it, type, Enter or click away to keep it,
 * Escape to leave it as it was. The name is the title of the thread underneath.
 */
export function BoardTitle({
  threadRef,
  title,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
}) {
  // A new board's shell can arrive after it opens, so its draft starts from the name it was made with.
  const [draft, setDraft] = useState<string | null>(() =>
    boardsToName.has(boardKey(threadRef)) ? UNTITLED_BOARD : null,
  );
  const updateMetadata = useOrchestrationCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const close = () => {
    boardsToName.delete(boardKey(threadRef));
    setDraft(null);
  };
  const commit = (value: string) => {
    close();
    const next = value.trim();
    if (next === "" || next === title) return;
    void updateMetadata({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, title: next },
    }).then((result) => {
      if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
        const error = squashAtomCommandFailure(result);
        toastManager.add({
          type: "error",
          title: "Could not rename the board",
          description: error instanceof Error ? error.message : "An error occurred.",
        });
      }
    });
  };
  if (draft === null) {
    return (
      <button
        type="button"
        className="max-w-full cursor-text truncate rounded-sm text-start outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        aria-label={`Rename board ${title}`}
        data-board-title
        onClick={() => setDraft(title)}
      >
        {title}
      </button>
    );
  }
  return (
    <Input
      size="sm"
      autoFocus
      aria-label="Board name"
      value={draft}
      data-board-title-input
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.currentTarget.value)}
      onBlur={(event) => commit(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit(event.currentTarget.value);
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    />
  );
}
