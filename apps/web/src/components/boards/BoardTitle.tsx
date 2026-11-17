import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { PencilIcon } from "lucide-react";
import { useState } from "react";

import { threadEnvironment } from "~/state/threads";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";

import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { UNTITLED_BOARD } from "./boardsHome.logic";

// Boards made in this tab whose name is not yet confirmed: they open with the name being edited,
// so the first keys typed name the board instead of reaching a prompt. A reload forgets them.
const boardsToName = new Set<string>();
const boardKey = (ref: ScopedThreadRef) => `${ref.environmentId}:${ref.threadId}`;

/** Opens this new board with its name being edited. */
export const nameBoardOnOpen = (ref: ScopedThreadRef) => void boardsToName.add(boardKey(ref));

/**
 * A board's name in its header, renamed in place: click it, type, Enter or click away to keep it,
 * Escape to leave it as it was. The name is the title of the thread underneath, or `rename` sets it
 * where there is no thread to rename (a cloud board), resolving to what went wrong or null.
 */
export function BoardTitle({
  threadRef,
  title,
  rename,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly title: string;
  readonly rename?: (title: string) => Promise<string | null>;
}) {
  // A new board's shell can arrive after it opens, so its draft starts from the name it was made with.
  const [draft, setDraft] = useState<string | null>(() =>
    boardsToName.has(boardKey(threadRef)) ? UNTITLED_BOARD : null,
  );
  const [cut, setCut] = useState(false);
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
    const renamed =
      rename?.(next) ??
      updateMetadata({
        environmentId: threadRef.environmentId,
        input: { threadId: threadRef.threadId, title: next },
      }).then((result) => {
        if (result._tag === "Success" || isAtomCommandInterrupted(result)) return null;
        const error = squashAtomCommandFailure(result);
        return error instanceof Error ? error.message : "An error occurred.";
      });
    void renamed.then((failure) => {
      if (failure !== null) {
        toastManager.add({
          type: "error",
          title: "Could not rename the board",
          description: failure,
        });
      }
    });
  };
  if (draft === null) {
    // Named in a tooltip only while the header cuts it short.
    const measure = (button: HTMLElement) => {
      const name = button.firstElementChild;
      setCut(name !== null && name.scrollWidth > name.clientWidth);
    };
    return (
      <Tooltip disabled={!cut}>
        <TooltipTrigger
          render={
            <button
              type="button"
              // Its negative margins come off the width the header gives it, so it may take them back.
              className="group/title -mx-1 inline-flex max-w-[calc(100%+0.5rem)] cursor-text items-center gap-1.5 rounded-md px-1 py-0.5 text-start outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              aria-label={`Rename board ${title}`}
              data-board-title
              onPointerDown={(event) => event.stopPropagation()}
              onPointerEnter={(event) => measure(event.currentTarget)}
              onFocus={(event) => measure(event.currentTarget)}
              onClick={() => setDraft(title)}
            />
          }
        >
          <span className="min-w-0 truncate">{title}</span>
          <PencilIcon
            aria-hidden
            className="size-3 shrink-0 text-muted-foreground opacity-60 group-hover/title:opacity-100"
          />
        </TooltipTrigger>
        <TooltipPopup side="bottom">{title}</TooltipPopup>
      </Tooltip>
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
