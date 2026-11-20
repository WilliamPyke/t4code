/** What a key pressed on the board does, for the keys the board takes as FigJam does. */
type BoardKeyAction =
  | "note"
  | "task"
  | "line"
  | "section"
  | "select"
  | "hand"
  | "fit"
  | "zoom-100"
  | "zoom-in"
  | "zoom-out"
  | "group"
  | "next-card"
  | "previous-card"
  | "shortcuts";

interface BoardKeyEvent {
  readonly key: string;
  readonly code: string;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

const LETTERS: Readonly<Record<string, BoardKeyAction>> = {
  n: "note",
  t: "task",
  l: "line",
  s: "section",
  v: "select",
  h: "hand",
};

/**
 * The board's own key for an event, or null. Shift+1 and Shift+0 go by the key's place, as a
 * layout can put anything on them; letters go by what the key types.
 */
export function boardKeyAction(event: BoardKeyEvent): BoardKeyAction | null {
  if (event.altKey) return null;
  if (event.ctrlKey || event.metaKey) {
    if (event.key === "=" || event.key === "+") return "zoom-in";
    if (event.key === "-" && !event.shiftKey) return "zoom-out";
    if (event.code === "KeyG" && !event.shiftKey) return "group";
    return null;
  }
  if (event.key === "Tab") return event.shiftKey ? "previous-card" : "next-card";
  if (event.key === "?") return "shortcuts";
  if (event.shiftKey) {
    if (event.code === "Digit1") return "fit";
    if (event.code === "Digit0") return "zoom-100";
    return null;
  }
  return LETTERS[event.key.toLowerCase()] ?? null;
}

/** A key as the shortcuts sheet and menus show it: `mod` is Cmd on a Mac and Ctrl elsewhere. */
export interface BoardKey {
  readonly key: string;
  readonly mod?: boolean;
  readonly shift?: boolean;
  readonly alt?: boolean;
}

export function boardKeyLabel(shortcut: BoardKey, mac: boolean): string {
  if (mac) {
    return `${shortcut.alt === true ? "⌥" : ""}${shortcut.shift === true ? "⇧" : ""}${shortcut.mod === true ? "⌘" : ""}${shortcut.key}`;
  }
  return [
    ...(shortcut.mod === true ? ["Ctrl"] : []),
    ...(shortcut.alt === true ? ["Alt"] : []),
    ...(shortcut.shift === true ? ["Shift"] : []),
    shortcut.key,
  ].join("+");
}

interface BoardShortcut {
  readonly label: string;
  /** Each way to press it; most have one. */
  readonly keys: ReadonlyArray<BoardKey>;
}

interface BoardShortcutGroup {
  readonly title: string;
  readonly shortcuts: ReadonlyArray<BoardShortcut>;
}

/** Every key the board takes, as its shortcuts sheet lists them. */
export const BOARD_SHORTCUTS: ReadonlyArray<BoardShortcutGroup> = [
  {
    title: "Add and tools",
    shortcuts: [
      { label: "Note", keys: [{ key: "N" }] },
      { label: "Task", keys: [{ key: "T" }] },
      { label: "Section", keys: [{ key: "S" }] },
      { label: "Line tool", keys: [{ key: "L" }] },
      { label: "Select and move", keys: [{ key: "V" }] },
      { label: "Hand tool: drag to move around", keys: [{ key: "H" }] },
      { label: "Move around while held", keys: [{ key: "Space" }] },
      { label: "Next note beside this one", keys: [{ key: "Enter", mod: true }] },
    ],
  },
  {
    title: "View",
    shortcuts: [
      { label: "Fit everything", keys: [{ key: "1", shift: true }] },
      { label: "Zoom to 100%", keys: [{ key: "0", shift: true }] },
      { label: "Zoom in", keys: [{ key: "+", mod: true }] },
      { label: "Zoom out", keys: [{ key: "-", mod: true }] },
    ],
  },
  {
    title: "Cards",
    shortcuts: [
      { label: "Edit the selected card", keys: [{ key: "Enter" }] },
      { label: "Next card, previous card", keys: [{ key: "Tab" }, { key: "Tab", shift: true }] },
      { label: "Select all", keys: [{ key: "A", mod: true }] },
      {
        label: "Copy, paste at the pointer",
        keys: [
          { key: "C", mod: true },
          { key: "V", mod: true },
        ],
      },
      { label: "Duplicate", keys: [{ key: "D", mod: true }] },
      { label: "Group in a section", keys: [{ key: "G", mod: true }] },
      {
        label: "Move a little, move more",
        keys: [{ key: "Arrows" }, { key: "Arrows", shift: true }],
      },
      { label: "Drag without snapping: hold while dragging", keys: [{ key: "Drag", mod: true }] },
      { label: "Delete", keys: [{ key: "Delete" }] },
      {
        label: "Undo, redo",
        keys: [
          { key: "Z", mod: true },
          { key: "Z", mod: true, shift: true },
        ],
      },
      { label: "Stop: leave text, drop the tool or the selection", keys: [{ key: "Esc" }] },
    ],
  },
  {
    title: "Plan and List",
    shortcuts: [
      { label: "New task", keys: [{ key: "C" }] },
      { label: "Select every task shown", keys: [{ key: "A", mod: true }] },
      { label: "Delete the selected tasks", keys: [{ key: "Delete" }] },
      { label: "Clear the selection", keys: [{ key: "Esc" }] },
    ],
  },
  {
    title: "Menus and agents",
    shortcuts: [
      { label: "Command menu", keys: [{ key: "K", mod: true }] },
      { label: "Card menu", keys: [{ key: "F10", shift: true }] },
      { label: "Ask an agent about the selection", keys: [{ key: "A", alt: true }] },
      { label: "Agents on this board", keys: [{ key: "G", alt: true }] },
      { label: "Vote for the selection", keys: [{ key: "V", alt: true }] },
      { label: "This list", keys: [{ key: "?" }] },
    ],
  },
];

/** The sheet's groups with only the shortcuts whose words or keys hold every word of `query`. */
export function boardShortcutsMatching(
  groups: ReadonlyArray<BoardShortcutGroup>,
  query: string,
  mac: boolean,
): ReadonlyArray<BoardShortcutGroup> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return groups;
  return groups.flatMap((group) => {
    const shortcuts = group.shortcuts.filter((shortcut) => {
      const text =
        `${group.title} ${shortcut.label} ${shortcut.keys.map((key) => boardKeyLabel(key, mac)).join(" ")}`.toLowerCase();
      return words.every((word) => text.includes(word));
    });
    return shortcuts.length === 0 ? [] : [{ ...group, shortcuts }];
  });
}
