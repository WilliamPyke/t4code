import type { RoomBoardNote } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { BoardFloat } from "./BoardChrome";
import {
  type BoardCatchUpStep,
  type BoardVisit,
  boardCatchUp,
  boardCatchUpLine,
  boardCatchUpStepLabel,
  boardNewestChange,
  boardVisitKey,
  boardVisitsWith,
} from "./boardCatchUp.logic";

// Per device, a convenience only: the newest change each board showed when it was last open.
const VISITS_STORAGE_KEY = "t3code:room-board-visits:v1";
const VISITS_KEPT = 100;
const Visits = Schema.Record(Schema.String, Schema.String);

const readVisits = (): Readonly<Record<string, BoardVisit>> => {
  try {
    return getLocalStorageItem(VISITS_STORAGE_KEY, Visits) ?? {};
  } catch {
    return {};
  }
};

function rememberVisit(key: string, visit: BoardVisit) {
  try {
    setLocalStorageItem(
      VISITS_STORAGE_KEY,
      boardVisitsWith(readVisits(), key, visit, VISITS_KEPT),
      Visits,
    );
  } catch {
    // Storage that is full or blocked only loses the catch-up.
  }
}

interface CatchUpState {
  readonly key: string | undefined;
  /** The last visit before this one; undefined on a first visit. */
  readonly since: BoardVisit | undefined;
  /**
   * When this visit began. Changes after it happen in front of the viewer and are not marked.
   * The board can first show an older copy, so the marks are not fixed at first sight.
   */
  readonly openedAt: string;
  readonly dismissed: boolean;
}

const startCatchUp = (key: string | undefined): CatchUpState => ({
  key,
  since: key === undefined ? undefined : readVisits()[key],
  openedAt: new Date().toISOString(),
  dismissed: false,
});

/**
 * The cards and comments others added, changed or replied to since this person last had the
 * board open on this device, the board named by `board` (none without one). The visit moves on
 * only when they dismiss the changes or leave with none left to show, so a reload keeps them.
 */
export function useBoardCatchUp(
  board: string | undefined,
  notes: ReadonlyArray<RoomBoardNote>,
  viewer: string | null,
): { readonly changes: ReadonlyArray<BoardCatchUpStep>; readonly dismiss: () => void } {
  const key = board === undefined ? undefined : boardVisitKey(board, viewer);
  const [state, setState] = useState(() => startCatchUp(key));
  const newest = boardNewestChange(notes);
  const current = state.key === key ? state : startCatchUp(key);
  if (current !== state) setState(current);
  const changes = current.dismissed
    ? []
    : boardCatchUp(notes, current.since, viewer, current.openedAt);
  const loaded = notes.length > 0;
  const pending = changes.length > 0;
  const last = useRef<{ key: string; newest: BoardVisit; pending: boolean } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- what leaving saves, read by the leave effect's cleanup after the board has gone
  useEffect(() => {
    last.current = key === undefined || !loaded ? null : { key, newest, pending };
  }, [key, loaded, newest, pending]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves the visit to this device's storage when the page or the board is left
  useEffect(() => {
    if (key === undefined) return;
    const leave = () => {
      const visit = last.current;
      if (visit !== null && !visit.pending) rememberVisit(visit.key, visit.newest);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [key]);
  return {
    changes,
    dismiss: () => {
      if (key !== undefined && loaded) rememberVisit(key, newest);
      setState({ ...current, dismissed: true });
    },
  };
}

/** A quiet dot on a card's corner that someone else added or changed since the last visit. */
export function CatchUpMark({ label }: { readonly label: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span
            role="img"
            aria-label={label}
            className="absolute -top-1 -right-1 z-10 size-2.5 rounded-full bg-primary ring-2 ring-card"
          />
        }
      />
      <TooltipPopup side="top">{label}</TooltipPopup>
    </Tooltip>
  );
}

/** "N changes since you were here", stepping the view through them and what is new in each. */
export function CatchUpPill({
  changes,
  onShow,
  onDismiss,
}: {
  readonly changes: ReadonlyArray<BoardCatchUpStep>;
  readonly onShow: (note: RoomBoardNote) => void;
  readonly onDismiss: () => void;
}) {
  // The change last stepped to, or null before any.
  const [at, setAt] = useState<number | null>(null);
  const count = changes.length;
  const current = at === null ? undefined : changes[at];
  const step = (direction: 1 | -1) => {
    const next = at === null ? (direction === 1 ? 0 : count - 1) : (at + direction + count) % count;
    const change = changes[next];
    if (change === undefined) return;
    setAt(next);
    onShow(change.note);
  };
  return (
    <BoardFloat className="gap-0.5 p-1 ps-2.5" role="status">
      <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
      <span className="px-1 text-xs whitespace-nowrap tabular-nums">
        {at === null || current === undefined
          ? boardCatchUpLine(changes)
          : `${boardCatchUpStepLabel(current)} · ${at + 1} of ${count}`}
      </span>
      <Button size="icon-sm" variant="ghost" aria-label="Previous change" onClick={() => step(-1)}>
        <ChevronLeftIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Next change" onClick={() => step(1)}>
        <ChevronRightIcon />
      </Button>
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss changes" onClick={onDismiss}>
        <XIcon />
      </Button>
    </BoardFloat>
  );
}
