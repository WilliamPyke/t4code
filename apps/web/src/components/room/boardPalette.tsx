import * as Schema from "effect/Schema";
import { type ReactNode, useEffect, useSyncExternalStore } from "react";

import { isCommandPaletteOpen } from "~/commandPaletteBus";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useStableCallback } from "~/hooks/useStableCallback";

import type { CommandPaletteActionItem, CommandPaletteGroup } from "../CommandPalette.logic";
import { boardCommandsByRecent, boardRecentWith } from "./boardCommands.logic";

/** One thing the board offers in the app's command menu. */
export interface BoardCommand {
  /** Stable, so the menu can remember it as used lately. */
  readonly id: string;
  readonly title: string;
  readonly keywords?: ReadonlyArray<string>;
  readonly description?: string;
  /** The board's own key for it, as shown. */
  readonly shortcut?: string;
  readonly icon: ReactNode;
  /** Listed last, and never what puts its group first: it matches whatever is typed. */
  readonly secondary?: boolean;
  /** Runs once the menu has closed and given focus back, so it may move focus itself. */
  readonly run: () => void;
}

/** What the board on screen offers the command menu. */
interface BoardPalette {
  /** Listed while nothing is typed, used lately first. */
  readonly commands: ReadonlyArray<BoardCommand>;
  /** Cards and people, listed only for what is typed. */
  readonly finds: ReadonlyArray<BoardCommand>;
  /** Commands made from what is typed: a link to add, a question for the viewer's agent. */
  readonly typed: (query: string) => ReadonlyArray<BoardCommand>;
}

type BoardPaletteSource = () => BoardPalette;

// One board is on screen at a time; the newest to mount owns the menu's board entries.
let source: BoardPaletteSource | null = null;
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const setSource = (next: BoardPaletteSource | null) => {
  source = next;
  for (const listener of listeners) listener();
};

/** Offers this board's commands in the command menu while the calling board is mounted. */
export function useBoardPalette(build: BoardPaletteSource): void {
  const latest = useStableCallback(build);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the command menu lives outside the board and reads its commands through this registry while the board is mounted
  useEffect(() => {
    setSource(latest);
    return () => {
      if (source === latest) setSource(null);
    };
  }, [latest]);
}

// Per browser, a convenience only: the board commands used lately, newest first.
const RECENT_STORAGE_KEY = "t3code:room-board-recent-commands:v1";
const Recent = Schema.Array(Schema.String);

const readRecent = (): ReadonlyArray<string> => {
  try {
    return getLocalStorageItem(RECENT_STORAGE_KEY, Recent) ?? [];
  } catch {
    return [];
  }
};

function rememberUsed(id: string) {
  try {
    setLocalStorageItem(RECENT_STORAGE_KEY, boardRecentWith(readRecent(), id), Recent);
  } catch {
    // Storage that is full or blocked only loses the order.
  }
}

/**
 * Runs `run` once the command menu has gone, so focus it gives is not taken back by the menu
 * closing, and the board is no longer inert behind it.
 */
function afterCommandMenu(run: () => void) {
  // A hidden tab draws no frames, so there the command runs without waiting for one.
  const go = () =>
    document.visibilityState === "hidden"
      ? window.setTimeout(run, 0)
      : window.requestAnimationFrame(run);
  if (!isCommandPaletteOpen()) {
    go();
    return;
  }
  const observer = new MutationObserver(() => {
    if (!isCommandPaletteOpen()) done();
  });
  const timer = window.setTimeout(done, 1_500);
  function done() {
    observer.disconnect();
    window.clearTimeout(timer);
    go();
  }
  observer.observe(document.body, { childList: true, subtree: true });
}

function paletteItem(command: BoardCommand, remember: boolean): CommandPaletteActionItem {
  return {
    kind: "action",
    value: `board:${command.id}`,
    searchTerms: [command.title, ...(command.keywords ?? [])],
    title: command.title,
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.shortcut === undefined ? {} : { shortcutLabel: command.shortcut }),
    ...(command.secondary === true ? { secondary: true } : {}),
    icon: command.icon,
    run: async () => {
      if (remember) rememberUsed(command.id);
      afterCommandMenu(command.run);
    },
  };
}

const BOARD_PALETTE_GROUP = "board";

/**
 * The board on screen's entries for the command menu: its commands as a group of their own, and
 * its cards and people to search. Empty off a board.
 */
export function useBoardPaletteEntries(query: string): {
  readonly group: CommandPaletteGroup | null;
  readonly finds: ReadonlyArray<CommandPaletteActionItem>;
} {
  const current = useSyncExternalStore(subscribe, () => source);
  if (current === null) return { group: null, finds: [] };
  const palette = current();
  const typed = query.trim() === "" ? [] : palette.typed(query.trim());
  const commands = [
    ...typed.map((command) => paletteItem(command, false)),
    ...boardCommandsByRecent(palette.commands, readRecent()).map((command) =>
      paletteItem(command, true),
    ),
  ];
  return {
    group:
      commands.length === 0
        ? null
        : { value: BOARD_PALETTE_GROUP, label: "This board", items: commands },
    finds: palette.finds.map((command) => paletteItem(command, false)),
  };
}
