import type { RoomBoard, RoomBoardNote } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

import { Button } from "../ui/button";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuTrigger } from "../ui/menu";
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
import { type BoardAwayRow, boardAwaySummary } from "./boardAway.logic";
import type { BoardPeople } from "./roomBoard.logic";

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

// Beside it, the cards each board had then, so a card not among them reads as added, not changed.
const SEEN_STORAGE_KEY = "t3code:room-board-seen-cards:v1";
const SEEN_KEPT = 30;

const readSeen = (): Readonly<Record<string, BoardVisit>> => {
  try {
    return getLocalStorageItem(SEEN_STORAGE_KEY, Visits) ?? {};
  } catch {
    return {};
  }
};

function rememberVisit(key: string, visit: BoardVisit, cards: string) {
  try {
    setLocalStorageItem(
      VISITS_STORAGE_KEY,
      boardVisitsWith(readVisits(), key, visit, VISITS_KEPT),
      Visits,
    );
    setLocalStorageItem(
      SEEN_STORAGE_KEY,
      boardVisitsWith(readSeen(), key, cards, SEEN_KEPT),
      Visits,
    );
  } catch {
    // Storage that is full or blocked only loses the catch-up.
  }
}

const cardsOf = (notes: ReadonlyArray<RoomBoardNote>) => notes.map((note) => note.id).join(" ");

interface CatchUpState {
  readonly key: string | undefined;
  /** The last visit before this one; undefined on a first visit. */
  readonly since: BoardVisit | undefined;
  /** The cards the board had then, when this browser kept them. */
  readonly seen: ReadonlySet<string> | undefined;
  /**
   * When this visit began. Changes after it happen in front of the viewer and are not marked.
   * The board can first show an older copy, so the marks are not fixed at first sight.
   */
  readonly openedAt: string;
  readonly dismissed: boolean;
}

const seenOf = (cards: string | undefined) =>
  cards === undefined ? undefined : new Set(cards.split(" ").filter(Boolean));

const startCatchUp = (key: string | undefined): CatchUpState => ({
  key,
  since: key === undefined ? undefined : readVisits()[key],
  seen: seenOf(key === undefined ? undefined : readSeen()[key]),
  openedAt: new Date().toISOString(),
  dismissed: false,
});

/**
 * The cards and comments others added, changed or replied to since this person last had the
 * board open on this device, the board named by `board` (none without one). The visit moves on
 * only when they dismiss the changes or leave with none left to show, so a reload keeps them.
 */
export function useBoardCatchUp(
  name: string | undefined,
  board: Pick<RoomBoard, "notes" | "agentTurns">,
  viewer: string | null,
  people: BoardPeople,
): {
  readonly changes: ReadonlyArray<BoardCatchUpStep>;
  /** The same, said as who did what, for the summary. */
  readonly away: ReadonlyArray<BoardAwayRow>;
  readonly dismiss: () => void;
} {
  const { notes } = board;
  const key = name === undefined ? undefined : boardVisitKey(name, viewer);
  const [state, setState] = useState(() => startCatchUp(key));
  const newest = boardNewestChange(notes);
  const current = state.key === key ? state : startCatchUp(key);
  if (current !== state) setState(current);
  const changes = current.dismissed
    ? []
    : boardCatchUp(notes, current.since, viewer, current.openedAt);
  const away =
    current.dismissed || current.since === undefined
      ? []
      : boardAwaySummary({
          steps: changes,
          notes,
          turns: board.agentTurns ?? [],
          since: current.since,
          until: current.openedAt,
          people,
          seen: current.seen,
        });
  const loaded = notes.length > 0;
  const pending = away.length > 0;
  const cards = cardsOf(notes);
  const last = useRef<{
    key: string;
    newest: BoardVisit;
    cards: string;
    pending: boolean;
  } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- what leaving saves, read by the leave effect's cleanup after the board has gone
  useEffect(() => {
    last.current = key === undefined || !loaded ? null : { key, newest, cards, pending };
  }, [key, loaded, newest, cards, pending]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- saves the visit to this device's storage when the page or the board is left
  useEffect(() => {
    if (key === undefined) return;
    const leave = () => {
      const visit = last.current;
      if (visit !== null && !visit.pending) rememberVisit(visit.key, visit.newest, visit.cards);
    };
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [key]);
  return {
    changes,
    away,
    dismiss: () => {
      if (key !== undefined && loaded) rememberVisit(key, newest, cards);
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

/**
 * "N changes since you were here": opens a summary of who changed what, each line showing its
 * cards, and steps the view through the changes and what is new in each.
 */
export function CatchUpPill({
  changes,
  away,
  onShow,
  onShowCards,
  onDismiss,
}: {
  readonly changes: ReadonlyArray<BoardCatchUpStep>;
  readonly away: ReadonlyArray<BoardAwayRow>;
  readonly onShow: (note: RoomBoardNote) => void;
  readonly onShowCards: (noteIds: ReadonlyArray<string>) => void;
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
  const line =
    at === null || current === undefined
      ? count === 0
        ? "Changes since you were here"
        : boardCatchUpLine(changes)
      : `${boardCatchUpStepLabel(current)} · ${at + 1} of ${count}`;
  return (
    <BoardFloat className="gap-0.5 p-1 ps-1.5" role="status">
      <Menu>
        <MenuTrigger
          render={<Button size="sm" variant="ghost" aria-label={`${line}. Show what changed`} />}
        >
          <span className="size-2 shrink-0 rounded-full bg-primary" aria-hidden />
          <span className="text-xs whitespace-nowrap tabular-nums">{line}</span>
        </MenuTrigger>
        <MenuPopup side="top" align="start">
          <MenuGroup>
            <MenuGroupLabel>While you were away</MenuGroupLabel>
            {away.map((row) => (
              <MenuItem key={row.key} onClick={() => onShowCards(row.noteIds)}>
                {row.label}
              </MenuItem>
            ))}
          </MenuGroup>
        </MenuPopup>
      </Menu>
      {count === 0 ? null : (
        <>
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Previous change"
            onClick={() => step(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Next change" onClick={() => step(1)}>
            <ChevronRightIcon />
          </Button>
        </>
      )}
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss changes" onClick={onDismiss}>
        <XIcon />
      </Button>
    </BoardFloat>
  );
}
