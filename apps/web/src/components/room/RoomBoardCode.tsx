import type {
  RoomBoardNote,
  RoomCodeChanges,
  RoomCodePatch,
  RoomCodePatchScope,
} from "@t3tools/contracts";
import { ExternalLinkIcon } from "lucide-react";
import { lazy, type PointerEvent, Suspense, useState } from "react";

import { formatDayAwareTimestamp } from "~/timestampFormat";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { MiddleTruncate } from "../ui/middle-truncate";
import {
  type BoardPeople,
  boardAgentName,
  boardCodeTotals,
  boardPersonName,
} from "./roomBoard.logic";
import { BoardChip } from "./BoardChrome";
import { BoardProgressLine } from "./RoomBoardArtifact";
import { useBoxProgress } from "./roomBoardLive";

const RoomCodeDiff = lazy(() => import("./RoomCodeDiff"));

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** One file's patch as a code window got it: the patch, too large to show, or why not. */
export type RoomCodePatchRead =
  | { readonly patch: string }
  | { readonly tooLarge: true }
  | { readonly error: string };

export const ROOM_CODE_PATCH_UNREADABLE: RoomCodePatchRead = {
  error: "This file's changes cannot be read now.",
};

/** A machine's answer as the window shows it. */
export const roomCodePatchRead = (read: RoomCodePatch): RoomCodePatchRead =>
  read.patch === undefined ? { tooLarge: true } : { patch: read.patch };

/** Asks the machine that has a box's thread for one file of a code window. */
export type ReadRoomCodePatch = (input: {
  readonly note: RoomBoardNote;
  readonly changes: RoomCodeChanges;
  readonly path: string;
  readonly scope: RoomCodePatchScope;
}) => Promise<RoomCodePatchRead>;

interface Opened {
  /** The file, the changes it was read from, and which of them: one read per key. */
  readonly key: string;
  readonly read: RoomCodePatchRead | null;
}

/**
 * What a thread box's thread changed, as its code window shows it to the room: the files and
 * their counts from the board, and the patch of the one opened, read from the machine that has
 * the thread when someone opens it. Nothing else is kept here.
 */
export function RoomCodeWindow({
  note,
  boxId,
  boxName,
  people,
  readPatch,
  onOpenThread,
}: {
  readonly note: RoomBoardNote;
  /** The box with a line into the window now; undefined once none has. */
  readonly boxId: string | undefined;
  readonly boxName: (boxId: string) => string;
  readonly people: BoardPeople;
  /** Absent where no machine can be asked. */
  readonly readPatch: ReadRoomCodePatch | undefined;
  /** Opens the box's own thread, where its whole diff is. The owner's. */
  readonly onOpenThread: (() => void) | undefined;
}) {
  const changes = note.changes;
  const progress = useBoxProgress(boxId ?? "");
  const [scope, setScope] = useState<RoomCodePatchScope>("thread");
  const [selected, setSelected] = useState<string | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const running =
    boxId !== undefined && progress !== undefined ? (
      <p role="status" className="flex shrink-0 px-3 pb-1.5">
        <BoardChip tone="primary">
          {boxName(boxId)} · <BoardProgressLine progress={progress} />
        </BoardChip>
      </p>
    ) : null;
  if (changes === undefined) {
    return (
      <>
        {running}
        <p className="min-h-0 flex-1 px-3 pb-3 text-xs text-muted-foreground">
          {boxId === undefined
            ? "Draw a line from a thread box to this window. Everyone in the room will then see the files its thread changes, and their diffs."
            : "No changes yet. They show here when the box's next turn ends."}
        </p>
      </>
    );
  }
  const lastTurnOnly = scope === "turn";
  const files = lastTurnOnly
    ? changes.files.filter((file) => file.lastTurn !== undefined)
    : changes.files;
  const hasLastTurn = changes.files.some((file) => file.lastTurn !== undefined);
  // A guest's box's thread is on their machine: only they can open its files.
  const elsewhere =
    changes.guestId !== undefined && changes.guestId !== people.viewer
      ? boardPersonName(people, changes.guestId)
      : null;
  const canOpen = readPatch !== undefined && elsewhere === null;
  const keyOf = (path: string) => `${changes.turnId}:${scope}:${path}`;
  const open = (path: string, at: RoomCodePatchScope = scope) => {
    setSelected(path);
    if (readPatch === undefined || !canOpen) return;
    const key = `${changes.turnId}:${at}:${path}`;
    setOpened({ key, read: null });
    void readPatch({ note, changes, path, scope: at })
      .catch(() => ROOM_CODE_PATCH_UNREADABLE)
      .then((read) => setOpened((current) => (current?.key === key ? { key, read } : current)));
  };
  const shown =
    selected !== null && opened !== null && opened.key === keyOf(selected) ? opened : null;
  const stale = selected !== null && canOpen && shown === null && opened !== null;
  return (
    <>
      <div className="flex shrink-0 flex-col gap-0.5 px-3 pb-1.5">
        <div className="flex min-w-0 items-center gap-1.5">
          <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
            {[
              boardAgentName(people, changes.guestId).replace(/^./, (first) => first.toUpperCase()),
              boardCodeTotals(changes),
              formatDayAwareTimestamp(changes.updatedAt, "locale"),
            ].join(" · ")}
          </p>
          {onOpenThread === undefined ? null : (
            <Button
              size="micro"
              variant="ghost-muted"
              onPointerDown={stopPointer}
              onClick={onOpenThread}
            >
              <ExternalLinkIcon />
              Open in thread
            </Button>
          )}
        </div>
        <p className="truncate text-2xs text-muted-foreground">
          {boxId === undefined
            ? `No longer attached to a thread box. Last from ${boxName(changes.boxId)}.`
            : boxId !== changes.boxId
              ? `From ${boxName(changes.boxId)} until ${boxName(boxId)}'s next turn ends.`
              : `Changes of ${boxName(boxId)} since it began.`}
        </p>
        {elsewhere === null ? null : (
          <p className="text-2xs text-muted-foreground">
            Open on {elsewhere}'s machine only: the diffs stay there.
          </p>
        )}
      </div>
      {running}
      <div className="@container/code flex min-h-0 flex-1 flex-col border-t border-board-hairline">
        <div className="flex min-h-0 flex-1 flex-col @[30rem]/code:flex-row">
          <div
            data-board-scroll
            className="flex max-h-36 shrink-0 flex-col overflow-y-auto border-board-hairline py-1 @[30rem]/code:max-h-none @[30rem]/code:w-56 @[30rem]/code:border-e"
            onPointerDown={stopPointer}
          >
            {hasLastTurn ? (
              <label className="flex items-center gap-1.5 px-3 py-1 text-2xs text-muted-foreground">
                <Checkbox
                  checked={lastTurnOnly}
                  onCheckedChange={(checked) => {
                    const next = checked ? "turn" : "thread";
                    setScope(next);
                    if (selected !== null) open(selected, next);
                  }}
                />
                Last turn only
              </label>
            ) : null}
            {files.length === 0 ? (
              <p className="px-3 py-1 text-2xs text-muted-foreground">No changes yet</p>
            ) : (
              files.map((file) => {
                const counts = lastTurnOnly && file.lastTurn !== undefined ? file.lastTurn : file;
                return (
                  <button
                    key={file.path}
                    type="button"
                    disabled={!canOpen}
                    aria-pressed={selected === file.path}
                    className={cn(
                      "mx-1 flex min-w-0 items-center gap-2 rounded-md px-2 py-1 text-start font-mono text-2xs transition-colors enabled:hover:bg-foreground/5",
                      selected === file.path && "bg-foreground/6",
                    )}
                    onClick={() => open(file.path)}
                  >
                    <span className="flex min-w-0 flex-1">
                      <MiddleTruncate value={file.path} />
                    </span>
                    <span className="shrink-0 text-success-foreground">+{counts.additions}</span>
                    <span className="shrink-0 text-error-foreground">−{counts.deletions}</span>
                  </button>
                );
              })
            )}
            {changes.more === undefined || lastTurnOnly ? null : (
              <p className="px-3 py-1 text-2xs text-muted-foreground">
                and {changes.more} more {changes.more === 1 ? "file" : "files"}
              </p>
            )}
            {changes.truncated === true ? (
              <p className="px-3 py-1 text-2xs text-muted-foreground">
                The diff was longer than the machine reads; counts may be short.
              </p>
            ) : null}
          </div>
          <div
            data-board-scroll
            data-board-text
            className="min-h-0 min-w-0 flex-1 cursor-auto overflow-auto"
            onPointerDown={stopPointer}
          >
            {selected === null ? (
              <p className="px-3 py-2 text-2xs text-muted-foreground">
                {canOpen ? "Pick a file to see its diff." : null}
              </p>
            ) : stale ? (
              <div className="p-2">
                <Button size="micro" variant="ghost-muted" onClick={() => open(selected)}>
                  Changed since. Show again
                </Button>
              </div>
            ) : shown === null || shown.read === null ? (
              canOpen ? (
                <p role="status" className="px-3 py-2 text-2xs text-muted-foreground">
                  Loading the diff…
                </p>
              ) : null
            ) : "patch" in shown.read ? (
              <Suspense
                fallback={
                  <p className="px-3 py-2 text-2xs text-muted-foreground">Loading the diff…</p>
                }
              >
                <RoomCodeDiff patch={shown.read.patch} />
              </Suspense>
            ) : (
              <p className="px-3 py-2 text-2xs text-muted-foreground">
                {"tooLarge" in shown.read
                  ? "This file's diff is too large to show here."
                  : shown.read.error}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
