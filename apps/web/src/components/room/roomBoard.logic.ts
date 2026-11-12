import {
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_MAX_COORDINATE,
  ROOM_BOARD_MIN_CARD_SIZE,
  ROOM_BOARD_QUOTE_MAX_LENGTH,
  ROOM_BOARD_THREAD_CARD,
  isRoomBoardUrl,
  isRoomBranchName,
  roomBoardCardRef,
  roomBoardNoteRef,
  type RoomAgentActivity,
  type RoomBoard,
  type RoomBoardChange,
  type RoomBoardEdge,
  type RoomBoardNote,
  type RoomBoardSize,
  type RoomBoardViewport,
  type RoomCodeState,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

/** Where the board is scrolled to and how far it is zoomed. `x`/`y` are screen pixels. */
export interface BoardView {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

export interface BoardPoint {
  readonly x: number;
  readonly y: number;
}

export const BOARD_MIN_ZOOM = 0.4;
export const BOARD_MAX_ZOOM = 2;
export const INITIAL_BOARD_VIEW: BoardView = { x: 0, y: 0, zoom: 1 };

export const BOARD_CARD_WIDTH = 320;
const CARD_ROW_HEIGHT = 240;
const CARD_GAP = 40;
const BOARD_ORIGIN: BoardPoint = { x: 80, y: 72 };
/** How many of the thread's newest messages its card shows. */
export const BOARD_THREAD_MESSAGES = 3;

export const EMPTY_ROOM_BOARD: RoomBoard = { positions: {}, notes: [] };

export const screenToBoard = (view: BoardView, point: BoardPoint): BoardPoint => ({
  x: (point.x - view.x) / view.zoom,
  y: (point.y - view.y) / view.zoom,
});

/** Zooms by `factor`, keeping the board point under `anchor` (a screen point) where it is. */
export function zoomBoardAt(view: BoardView, anchor: BoardPoint, factor: number): BoardView {
  const zoom = Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, view.zoom * factor));
  const held = screenToBoard(view, anchor);
  return { zoom, x: anchor.x - held.x * zoom, y: anchor.y - held.y * zoom };
}

export const panBoardBy = (view: BoardView, dx: number, dy: number): BoardView => ({
  ...view,
  x: view.x + dx,
  y: view.y + dy,
});

/**
 * A position for every card: the saved one, or the next free slot of a grid for a card that has
 * none yet, such as a guest who just joined. A slot under a saved card is skipped.
 */
export function placeBoardCards(
  cardIds: ReadonlyArray<string>,
  saved: RoomBoard["positions"],
  columns = 3,
): Record<string, BoardPoint> {
  const stepX = BOARD_CARD_WIDTH + CARD_GAP;
  const stepY = CARD_ROW_HEIGHT + CARD_GAP;
  const slotOf = (point: BoardPoint) =>
    `${Math.round((point.x - BOARD_ORIGIN.x) / stepX)}:${Math.round((point.y - BOARD_ORIGIN.y) / stepY)}`;
  const taken = new Set(
    cardIds.flatMap((id) => {
      const position = saved[id];
      return position === undefined ? [] : [slotOf(position)];
    }),
  );
  const placed: Record<string, BoardPoint> = {};
  let slot = 0;
  for (const id of cardIds) {
    const position = saved[id];
    if (position !== undefined) {
      placed[id] = position;
      continue;
    }
    let point: BoardPoint;
    do {
      point = {
        x: BOARD_ORIGIN.x + (slot % columns) * stepX,
        y: BOARD_ORIGIN.y + Math.floor(slot / columns) * stepY,
      };
      slot += 1;
    } while (taken.has(slotOf(point)));
    placed[id] = point;
  }
  return placed;
}

const NOTE_WIDTH = 192;
const NOTE_HEIGHT = 128;
const NOTE_GAP = 16;
const NOTE_COLUMNS = 3;
const NOTE_ROWS = 24;

/**
 * Where a new note goes: `wanted`, or the nearest spot right of or below it that covers no note
 * and no card. A card is taken to be as tall as a grid row, since its height is the browser's.
 */
export function placeBoardNote(
  wanted: BoardPoint,
  notes: ReadonlyArray<BoardPoint>,
  cards: ReadonlyArray<BoardPoint>,
): BoardPoint {
  const covers = (at: BoardPoint, other: BoardPoint, width: number, height: number) =>
    at.x < other.x + width &&
    other.x < at.x + NOTE_WIDTH &&
    at.y < other.y + height &&
    other.y < at.y + NOTE_HEIGHT;
  for (let slot = 0; slot < NOTE_COLUMNS * NOTE_ROWS; slot += 1) {
    const at = {
      x: wanted.x + (slot % NOTE_COLUMNS) * (NOTE_WIDTH + NOTE_GAP),
      y: wanted.y + Math.floor(slot / NOTE_COLUMNS) * (NOTE_HEIGHT + NOTE_GAP),
    };
    if (
      !notes.some((note) => covers(at, note, NOTE_WIDTH, NOTE_HEIGHT)) &&
      !cards.some((card) => covers(at, card, BOARD_CARD_WIDTH, CARD_ROW_HEIGHT))
    ) {
      return at;
    }
  }
  return wanted;
}

/** Where a comment pinned to a reply lands on the board: beside the thread's card. */
export function pinnedCommentSpot(board: RoomBoard): BoardPoint {
  const thread = placeBoardCards([ROOM_BOARD_THREAD_CARD], board.positions)[
    ROOM_BOARD_THREAD_CARD
  ]!;
  return placeBoardNote({ x: thread.x + BOARD_CARD_WIDTH + CARD_GAP, y: thread.y }, board.notes, [
    thread,
  ]);
}

/** Where a card or note is, how wide it is, and how far down the middle of its header is. */
export interface BoardBox extends BoardPoint {
  readonly width: number;
  readonly headerY: number;
}

/** How big an artifact card is until someone resizes it. */
const BOARD_ARTIFACT_SIZE: RoomBoardSize = { w: 380, h: 320 };

const boardLength = (value: number) =>
  Math.round(Math.min(ROOM_BOARD_MAX_CARD_SIZE, Math.max(ROOM_BOARD_MIN_CARD_SIZE, value)));

/** A size dragged to, at the whole pixels and within the bounds the room takes. */
export const clampBoardSize = (size: RoomBoardSize): RoomBoardSize => ({
  w: boardLength(size.w),
  h: boardLength(size.h),
});

/** The size a note shows at, or undefined for one that grows with its text. */
export const boardNoteSize = (
  note: Pick<RoomBoardNote, "kind" | "size">,
): RoomBoardSize | undefined =>
  note.size ?? (note.kind === "artifact" ? BOARD_ARTIFACT_SIZE : undefined);

export const boardCardBox = (at: BoardPoint, size?: RoomBoardSize): BoardBox => ({
  x: at.x,
  y: at.y,
  width: size?.w ?? BOARD_CARD_WIDTH,
  headerY: 18,
});
export const boardNoteBox = (
  note: BoardPoint & Partial<Pick<RoomBoardNote, "kind" | "size">>,
): BoardBox => ({
  x: note.x,
  y: note.y,
  width: boardNoteSize(note)?.w ?? NOTE_WIDTH,
  headerY: 12,
});

/**
 * A curve from the header of one box to the header of another, leaving and arriving level, and
 * the point halfway along it.
 */
export function boardConnector(
  from: BoardBox,
  to: BoardBox,
): { readonly path: string; readonly middle: BoardPoint } {
  const leftToRight = from.x <= to.x;
  const start = { x: from.x + (leftToRight ? from.width : 0), y: from.y + from.headerY };
  const end = { x: to.x + (leftToRight ? 0 : to.width), y: to.y + to.headerY };
  const bend = Math.max(40, Math.abs(end.x - start.x) / 2) * (leftToRight ? 1 : -1);
  return {
    path: `M${start.x} ${start.y} C${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`,
    // The curve's controls pull level from each end, so halfway is the midpoint of the ends.
    middle: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
  };
}

/** A card, a note or an arrow on the board, or how big a card is (`size`, by card id). */
export interface BoardTarget {
  readonly kind: "card" | "note" | "edge" | "size";
  readonly id: string;
}

/**
 * Where a card is, a note as it reads, an arrow, a card's size, or null for a note or arrow taken
 * off.
 */
export type BoardValue = BoardPoint | RoomBoardNote | RoomBoardEdge | RoomBoardSize | null;

/**
 * What this person did to one card, note or arrow, shown over the room's board so a drag does
 * not wait for the server.
 */
export interface BoardEdit {
  readonly target: BoardTarget;
  readonly value: BoardValue;
  /** Still being dragged or typed: it shows whatever the room's copy does. */
  readonly held: boolean;
  /** The room's copy when it was let go. The edit shows until the room's copy differs. */
  readonly base: BoardValue | undefined;
}
export type BoardEdits = Readonly<Record<string, BoardEdit>>;
export const NO_BOARD_EDITS: BoardEdits = {};

/** A card's or note's key, which is also how an arrow names its ends. */
export const boardEditKey = (target: BoardTarget) => `${target.kind}:${target.id}`;

const roomCopy = (board: RoomBoard, target: BoardTarget): BoardValue | undefined => {
  switch (target.kind) {
    case "card":
      return board.positions[target.id];
    case "size":
      return board.sizes?.[target.id];
    case "note":
      return board.notes.find((note) => note.id === target.id);
    case "edge":
      return board.edges?.find((edge) => edge.id === target.id);
  }
};

/** What the room's copy and an edit are compared on, in whatever order the server wrote it. */
const valueKey = (value: BoardValue | undefined): string => {
  if (value === undefined || value === null) return String(value);
  if ("from" in value) return `${value.from}>${value.to}`;
  if ("w" in value) return `${value.w}x${value.h}`;
  if (!("text" in value)) return `${value.x},${value.y}`;
  return JSON.stringify([
    value.x,
    value.y,
    value.text,
    value.done === true,
    value.assignee === undefined ? null : (value.assignee.guestId ?? ""),
    value.size === undefined ? null : `${value.size.w}x${value.size.h}`,
  ]);
};

const shows = (board: RoomBoard, edit: BoardEdit) =>
  edit.held || valueKey(edit.base) === valueKey(roomCopy(board, edit.target));

/**
 * Records an edit, and forgets the ones the room's copy has moved past. Held while the drag or
 * the typing goes on; let go, it stands in for the room's copy until the server answers.
 */
export function putBoardEdit(
  board: RoomBoard,
  edits: BoardEdits,
  target: BoardTarget,
  value: BoardValue,
  held: boolean,
): BoardEdits {
  const kept = Object.entries(edits).filter(([, edit]) => shows(board, edit));
  return {
    ...Object.fromEntries(kept),
    [boardEditKey(target)]: {
      target,
      value,
      held,
      base: held ? undefined : roomCopy(board, target),
    },
  };
}

/**
 * Sends one card's, note's or arrow's changes one after another, so the room takes them in the
 * order they were made: text typed into a new note cannot land before the empty note it fills.
 */
export function boardChangeQueue() {
  const last = new Map<string, Promise<unknown>>();
  return <A>(key: string, send: () => Promise<A>): Promise<A> => {
    const next = (last.get(key) ?? Promise.resolve()).then(send, send);
    last.set(key, next);
    const forget = () => {
      if (last.get(key) === next) last.delete(key);
    };
    next.then(forget, forget);
    return next;
  };
}

/** Takes back an edit the server refused, unless a newer one replaced it. */
export function dropBoardEdit(
  edits: BoardEdits,
  target: BoardTarget,
  value: BoardValue,
): BoardEdits {
  const key = boardEditKey(target);
  if (edits[key]?.value !== value) return edits;
  const { [key]: _dropped, ...rest } = edits;
  return rest;
}

const replaceById = <Item extends { readonly id: string }>(
  items: ReadonlyArray<Item>,
  item: Item,
): ReadonlyArray<Item> =>
  items.some((other) => other.id === item.id)
    ? items.map((other) => (other.id === item.id ? item : other))
    : [...items, item];

const CARD_REF = roomBoardCardRef("");

/** A note as this person edits it, with what only the owner's server writes taken from the room. */
const withServerFields = (note: RoomBoardNote, room: RoomBoardNote | undefined): RoomBoardNote => {
  const { answer: _answer, artifact: _artifact, ...own } = note;
  return {
    ...own,
    ...(room?.answer === undefined ? {} : { answer: room.answer }),
    ...(room?.artifact === undefined ? {} : { artifact: room.artifact }),
  };
};

/** The room's board with this person's own edits over it. A note taken off takes its arrows. */
export function resolveBoard(board: RoomBoard, edits: BoardEdits): RoomBoard {
  const positions = { ...board.positions };
  const sizes = { ...board.sizes };
  let notes = board.notes;
  let edges = board.edges ?? [];
  for (const edit of Object.values(edits)) {
    if (!shows(board, edit)) continue;
    const { target, value } = edit;
    if (target.kind === "card") {
      if (value !== null && "x" in value) positions[target.id] = { x: value.x, y: value.y };
    } else if (target.kind === "size") {
      if (value !== null && "w" in value) sizes[target.id] = { w: value.w, h: value.h };
    } else if (target.kind === "edge") {
      if (value === null) edges = edges.filter((edge) => edge.id !== target.id);
      else if ("from" in value) edges = replaceById(edges, value);
    } else if (value === null) {
      notes = notes.filter((note) => note.id !== target.id);
    } else if ("text" in value) {
      const room = board.notes.find((note) => note.id === target.id);
      notes = replaceById(notes, withServerFields(value, room));
    }
  }
  const noteRefs = new Set(notes.map((note) => boardEditKey({ kind: "note", id: note.id })));
  const present = (ref: string) => ref.startsWith(CARD_REF) || noteRefs.has(ref);
  return {
    positions,
    notes,
    edges: edges.filter((edge) => present(edge.from) && present(edge.to)),
    sizes,
  };
}

const coordinate = (value: number) =>
  Math.round(Math.min(ROOM_BOARD_MAX_COORDINATE, Math.max(-ROOM_BOARD_MAX_COORDINATE, value)));

/** The value at the whole pixels the room keeps, so the server's copy equals what was let go. */
export const settleBoardValue = <Value extends BoardValue>(value: Value): Value => {
  if (value === null) return value;
  if ("w" in value) return { ...value, ...clampBoardSize(value) };
  if (!("x" in value)) return value;
  const at = { ...value, x: coordinate(value.x), y: coordinate(value.y) };
  return "size" in at && at.size !== undefined ? { ...at, size: clampBoardSize(at.size) } : at;
};

/** The change that makes the room's copy of a card, note or arrow this value. */
export function boardChangeOf(target: BoardTarget, value: BoardValue): RoomBoardChange {
  if (target.kind === "card") {
    const at = value !== null && "x" in value ? value : { x: 0, y: 0 };
    return { type: "card.move", cardId: target.id, x: at.x, y: at.y };
  }
  if (target.kind === "size") {
    const size = clampBoardSize(value !== null && "w" in value ? value : BOARD_ARTIFACT_SIZE);
    return { type: "card.resize", cardId: target.id, ...size };
  }
  if (target.kind === "edge") {
    return value === null || !("from" in value)
      ? { type: "edge.remove", edgeId: target.id }
      : { type: "edge.put", edgeId: target.id, from: value.from, to: value.to };
  }
  if (value === null || !("text" in value)) return { type: "note.remove", noteId: target.id };
  return {
    type: "note.put",
    noteId: target.id,
    text: value.text,
    x: value.x,
    y: value.y,
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    ...(value.url === undefined ? {} : { url: value.url }),
    ...(value.pinnedTo === undefined ? {} : { pinnedTo: value.pinnedTo }),
    ...(value.quote === undefined ? {} : { quote: value.quote }),
    ...(value.size === undefined ? {} : { size: value.size }),
    ...(value.kind === "task"
      ? { done: value.done === true, assignee: value.assignee ?? null }
      : {}),
  };
}

/** Where a pointer at `screen` is on the board, at the whole pixels the room takes. */
export const boardCursorAt = (view: BoardView, screen: BoardPoint): BoardPoint =>
  settleBoardValue(screenToBoard(view, screen));

const CURSOR_SEND_INTERVAL_MS = 80;

/**
 * What the room hears of this person on the board: their pointer, or null once it left, and their
 * view when it changed, or null once they closed the board.
 */
export interface BoardPresence {
  readonly at: BoardPoint | null;
  readonly view?: RoomBoardViewport | null;
}

const samePoint = (a: BoardPoint | null, b: BoardPoint | null) =>
  a === null || b === null ? a === b : a.x === b.x && a.y === b.y;
const sameViewport = (a: RoomBoardViewport | null, b: RoomBoardViewport | null) =>
  a === null || b === null ? a === b : samePoint(a, b) && a.zoom === b.zoom;

/**
 * Sends a pointer's position and the board's view at most every `CURSOR_SEND_INTERVAL_MS`,
 * always ending on the latest, and nothing already sent. A pointer leaving is sent at once, and
 * closing the board takes both away.
 */
export function cursorSender(send: (presence: BoardPresence) => void) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let at: BoardPoint | null = null;
  let view: RoomBoardViewport | null = null;
  let sentAt: BoardPoint | null = null;
  let sentView: RoomBoardViewport | null = null;
  let lastSend = Number.NEGATIVE_INFINITY;
  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    const viewChanged = !sameViewport(view, sentView);
    if (samePoint(at, sentAt) && !viewChanged) return;
    sentAt = at;
    sentView = view;
    lastSend = Date.now();
    send(viewChanged ? { at, view } : { at });
  };
  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(flush, Math.max(0, lastSend + CURSOR_SEND_INTERVAL_MS - Date.now()));
  };
  return {
    move: (point: BoardPoint) => {
      at = point;
      schedule();
    },
    look: (next: RoomBoardViewport) => {
      view = next;
      schedule();
    },
    leave: () => {
      at = null;
      flush();
    },
    close: () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      at = null;
      view = null;
      if (sentAt === null && sentView === null) return;
      sentAt = null;
      sentView = null;
      send({ at: null, view: null });
    },
  };
}

export interface BoardSize {
  readonly width: number;
  readonly height: number;
}

/** What this board shows, as the room hears it: the board point in its middle, and its zoom. */
export function boardViewportOf(view: BoardView, size: BoardSize): RoomBoardViewport {
  const middle = screenToBoard(view, { x: size.width / 2, y: size.height / 2 });
  return {
    x: coordinate(middle.x),
    y: coordinate(middle.y),
    zoom: Math.round(view.zoom * 1000) / 1000,
  };
}

/** The view that shows what someone else's board shows, on a board of this size. */
export function followBoardView(viewport: RoomBoardViewport, size: BoardSize): BoardView {
  const zoom = Math.min(BOARD_MAX_ZOOM, Math.max(BOARD_MIN_ZOOM, viewport.zoom));
  return { zoom, x: size.width / 2 - viewport.x * zoom, y: size.height / 2 - viewport.y * zoom };
}

// Semantic colours that read on the board in both themes; guests take them in join order.
const GUEST_CURSOR_COLORS = [
  "var(--color-guest)",
  "var(--color-info)",
  "var(--color-success)",
  "var(--color-warning)",
  "var(--color-update)",
  "var(--color-destructive)",
];

/** One colour per person for as long as the link lasts: the owner's, or the guest's by join order. */
export function boardCursorColor(
  guests: ReadonlyArray<{ readonly id: string }>,
  guestId: string | undefined,
): string {
  if (guestId === undefined) return "var(--color-primary)";
  const index = Math.max(
    0,
    guests.findIndex((guest) => guest.id === guestId),
  );
  return GUEST_CURSOR_COLORS[index % GUEST_CURSOR_COLORS.length]!;
}

/** Who someone is on the board, as follow mode names them: a guest's id, or the owner. */
export const boardPersonKey = (guestId: string | undefined) => guestId ?? "owner";

export interface BoardPeople {
  readonly guests: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  /** The guest looking, or null for the owner. */
  readonly viewer: string | null;
  /** What the owner is called, when they chose a name to show. */
  readonly ownerName?: string | undefined;
}

/** What the board calls someone: "You", the owner's name or "Owner", or a guest's name. */
export function boardPersonName(people: BoardPeople, guestId: string | undefined): string {
  if ((guestId ?? null) === people.viewer) return "You";
  if (guestId === undefined) return people.ownerName ?? "Owner";
  return people.guests.find((guest) => guest.id === guestId)?.name ?? "Guest";
}

/** Whose agent someone's is, as a sentence names it: "Sam's agent", or "your agent". */
export function boardAgentName(people: BoardPeople, guestId: string | undefined): string {
  const name = boardPersonName(people, guestId);
  return (guestId ?? null) === people.viewer ? "your agent" : `${name}'s agent`;
}

/**
 * The guests whose agent has a card: once it posted a turn or runs one now, with its turns and
 * what it runs.
 */
export function boardAgents<
  Guest extends { readonly id: string },
  Turn extends { readonly guestId: string },
>(
  guests: ReadonlyArray<Guest>,
  turns: ReadonlyArray<Turn>,
  running: ReadonlyArray<RoomAgentActivity>,
) {
  return guests.flatMap((guest) => {
    const own = turns.filter((turn) => turn.guestId === guest.id);
    const now = running.find((agent) => agent.guestId === guest.id);
    return own.length === 0 && now === undefined ? [] : [{ guest, turns: own, running: now }];
  });
}

/** Where an agent's code is: what it says while it runs, or what its last turn said. */
export const boardAgentCode = (agent: {
  readonly turns: ReadonlyArray<{ readonly code?: RoomCodeState | undefined }>;
  readonly running: RoomAgentActivity | undefined;
}): RoomCodeState | undefined => agent.running?.code ?? agent.turns.at(-1)?.code;

/** How a card says where someone's code is: "pushed", "2 commits not pushed", and so on. */
export function roomCodeStatus(code: RoomCodeState): string {
  const state = code.synced
    ? "pushed"
    : code.ahead === undefined
      ? "not pushed"
      : code.ahead > 0
        ? `${code.ahead} commit${code.ahead === 1 ? "" : "s"} not pushed`
        : "changes not committed";
  const behind = code.behind ?? 0;
  return behind > 0 ? `${state}, ${behind} behind` : state;
}

/**
 * The command that gets someone's pushed branch, or null for a name git would not take. A name
 * with anything but plain characters is quoted for the shell.
 */
export function roomFetchCommand(branch: string): string | null {
  if (!isRoomBranchName(branch)) return null;
  const arg = /^[\w./-]+$/.test(branch) ? branch : `'${branch.replaceAll("'", `'\\''`)}'`;
  return `git fetch origin ${arg} && git switch ${arg}`;
}

/** A card an arrow connects to the thread's card, as a prompt from the board carries it. */
export interface BoardPromptCard {
  /** `note:<id>` as arrows name it. */
  readonly ref: string;
  /** For example "Note from Sam", "Task", "Comment on a reply", "Link", 'Artifact "Title"'. */
  readonly label: string;
  readonly text: string;
}

/** A message sent from the thread's card on the board. */
export interface BoardPrompt {
  readonly text: string;
  /** The connected cards the sender left attached. */
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The artifact note the thread card points to, when the sender may fill one. */
  readonly artifactId: string | null;
}

/** A note added to a composer's draft as a paragraph of its own. */
export function appendNoteToDraft(draft: string, note: string): string {
  const text = note.trim();
  if (text === "") return draft;
  return draft.trim() === "" ? text : `${draft.trimEnd()}\n\n${text}`;
}

/** The text "Use as message" puts in a draft: a link card gives its address with its caption. */
export const boardNoteMessage = (note: RoomBoardNote): string =>
  note.url === undefined ? note.text : [note.text.trim(), note.url].filter(Boolean).join("\n");

/** A link card's address as the card shows it. GitHub pull requests, issues and files read short. */
export interface BoardLink {
  readonly href: string;
  readonly title: string;
  readonly detail: string;
}

const GITHUB_KINDS: Readonly<Record<string, string>> = { pull: "Pull request", issues: "Issue" };

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export function parseBoardLink(value: string): BoardLink | null {
  if (!isRoomBoardUrl(value)) return null;
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./, "");
  const parts = url.pathname
    .split("/")
    .filter((part) => part !== "")
    .map(decodeSegment);
  const [owner, repo, section, ...rest] = parts;
  if (host === "github.com" && owner !== undefined && repo !== undefined) {
    const name = `${owner}/${repo}`;
    const kind = section === undefined ? undefined : GITHUB_KINDS[section];
    if (kind !== undefined && /^\d+$/.test(rest[0] ?? "")) {
      return { href: url.href, title: `${name} #${rest[0]}`, detail: kind };
    }
    if ((section === "blob" || section === "tree") && rest.length >= 2) {
      return { href: url.href, title: rest.slice(1).join("/"), detail: `${name} · ${rest[0]}` };
    }
    return { href: url.href, title: name, detail: host };
  }
  return {
    href: url.href,
    title: host,
    detail: parts.length === 0 ? url.search : `/${parts.join("/")}`,
  };
}

/** The address in pasted or typed text that is one http or https URL and nothing else. */
export function boardUrlIn(text: string): string | null {
  const trimmed = text.trim();
  return /\s/.test(trimmed) || !isRoomBoardUrl(trimmed) ? null : trimmed;
}

export interface BoardMessage {
  readonly id: string;
  /** Who wrote it: null for the agent, the owner's label, a guest's name otherwise. */
  readonly author: string | null;
  readonly text: string;
}

interface MessageItem {
  readonly id: string;
  readonly type: string;
  readonly text?: unknown;
  readonly context?: unknown;
}

const GuestContext = Schema.Struct({
  guest: Schema.Struct({ name: Schema.String, text: Schema.String }),
});
const decodeGuestContext = Schema.decodeUnknownOption(GuestContext);
const EXCERPT_LENGTH = 280;
const TABLE_RULE = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

/** Text cut to `max` characters with the ellipsis, never splitting a surrogate pair. */
const cutText = (text: string, max: number): string =>
  text.length <= max
    ? text
    : `${text
        .slice(0, max - 1)
        .replace(/[\uD800-\uDBFF]$/, "")
        .trimEnd()}…`;

/**
 * A message as a card shows it: one run of plain text, without code blocks, heading and list
 * marks, table rules or emphasis marks. A message that is only a code block keeps its text.
 */
function boardExcerpt(markdown: string, max = EXCERPT_LENGTH): string {
  const lines: Array<string> = [];
  let fenced = false;
  for (const raw of markdown.split(/\r?\n/)) {
    if (/^\s*(?:```|~~~)/.test(raw)) {
      fenced = !fenced;
      continue;
    }
    if (fenced || TABLE_RULE.test(raw)) continue;
    const heading = /^\s*#{1,6}\s+(.*)$/.exec(raw)?.[1];
    const line = (heading ?? raw)
      .replace(/^\s*(?:>\s?)*(?:(?:[-*+]|\d+[.)])\s+)?(?:\[[ xX]\]\s+)?/, "")
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/`+|\*\*|~~/g, "")
      .replace(/(^|[^\w*])[*_]([^*_\n]+)[*_](?![\w*])/g, "$1$2")
      .replace(/\|/g, " ")
      .trim();
    if (line === "") continue;
    lines.push(heading !== undefined && !/[.:!?]$/.test(line) ? `${line}:` : line);
  }
  const text = (lines.length === 0 ? markdown : lines.join(" ")).replace(/\s+/g, " ").trim();
  return cutText(text, max);
}

/** The start of a reply, as a comment pinned to it quotes it. */
export const boardReplyQuote = (reply: string): string =>
  boardExcerpt(reply, ROOM_BOARD_QUOTE_MAX_LENGTH);

/** What a comment quotes: what its author's client read, or the reply the thread's card shows. */
export const boardNoteQuote = (
  note: RoomBoardNote,
  messages: ReadonlyArray<BoardMessage>,
): string | undefined => {
  if (note.pinnedTo === undefined) return undefined;
  const quote = note.quote ?? messages.find((message) => message.id === note.pinnedTo)?.text;
  return quote === undefined || quote.trim() === "" ? undefined : quote;
};

const textOf = (value: unknown) => (typeof value === "string" ? boardExcerpt(value) : "");

/** The newest messages of a thread, oldest first, for the thread's card. */
export function boardMessages(
  items: ReadonlyArray<MessageItem>,
  limit: number,
  /** What the owner is called: "You" on their own board. */
  owner = "You",
): ReadonlyArray<BoardMessage> {
  const messages: Array<BoardMessage> = [];
  for (const item of items.toReversed()) {
    if (messages.length === limit) break;
    if (item.type === "user_message") {
      const context = decodeGuestContext(item.context);
      const guest = context._tag === "Some" ? context.value.guest : undefined;
      const text = textOf(guest?.text ?? item.text);
      if (text !== "") messages.push({ id: item.id, author: guest?.name ?? owner, text });
    } else if (item.type === "assistant_message") {
      const text = textOf(item.text);
      if (text !== "") messages.push({ id: item.id, author: null, text });
    }
  }
  return messages.toReversed();
}

/** Whether an artifact is a whole HTML page, which the board shows as a page of its own. */
export const isBoardHtmlArtifact = (body: string): boolean =>
  /^(?:<!doctype html|<html)/i.test(body.trimStart());

/** How many connected cards one message from the board carries. */
export const BOARD_PROMPT_MAX_CARDS = 8;
const PROMPT_ARTIFACT_LENGTH = 4_000;

/** What the thread's card does with the arrows at it: what goes with a message, and where the reply goes. */
export interface BoardPromptContext {
  /** Every card with an arrow into the thread's card, and into those, nearest first. */
  readonly cards: ReadonlyArray<BoardPromptCard>;
  /** The arrows that carry them. */
  readonly edgeIds: ReadonlySet<string>;
  /** The artifact the thread's card points to, and the arrow that does. */
  readonly artifact: RoomBoardNote | null;
  readonly artifactEdgeId: string | null;
}

const isComment = (note: RoomBoardNote) => note.kind === undefined && note.pinnedTo !== undefined;

/** A card as a message from the board carries it, or null for one with nothing written. */
function boardPromptCard(
  note: RoomBoardNote,
  people: BoardPeople,
  quote?: string,
): BoardPromptCard | null {
  const by = boardPersonName(people, note.guestId);
  const text = note.text.trim();
  const card = (label: string, body: string) =>
    body.trim() === "" ? null : { ref: roomBoardNoteRef(note.id), label, text: body };
  switch (note.kind) {
    case "artifact": {
      const body = cutText(note.artifact?.body.trim() ?? "", PROMPT_ARTIFACT_LENGTH);
      return card(
        text === "" ? "Artifact" : `Artifact "${text}"`,
        [text, body].filter(Boolean).join("\n\n"),
      );
    }
    case "task":
      return text === ""
        ? null
        : card(`Task from ${by}`, `${text}\nStatus: ${note.done === true ? "done" : "not done"}`);
    case "link":
      return card(`Link from ${by}`, [note.url ?? "", text].filter(Boolean).join("\n"));
    default:
      if (text === "") return null;
      if (!isComment(note)) return card(`Note from ${by}`, text);
      return card(
        `Comment from ${by} on a reply`,
        quote === undefined ? text : `On the reply: "${quote}"\n${text}`,
      );
  }
}

/**
 * The cards a message from the thread's card carries: each note with an arrow into it, and each
 * note with an arrow into one of those, once each, nearest first and in the order the arrows were
 * drawn. Plus the artifact the thread's card has an arrow to, first drawn first.
 */
export function boardPromptContext(
  board: RoomBoard,
  people: BoardPeople,
  messages: ReadonlyArray<BoardMessage> = [],
): BoardPromptContext {
  const thread = roomBoardCardRef(ROOM_BOARD_THREAD_CARD);
  const notes = new Map(board.notes.map((note) => [roomBoardNoteRef(note.id), note]));
  const edges = board.edges ?? [];
  const reached = new Set<string>();
  const cards: Array<BoardPromptCard> = [];
  let frontier = [thread];
  while (frontier.length > 0 && reached.size < BOARD_PROMPT_MAX_CARDS) {
    const next: Array<string> = [];
    for (const edge of edges) {
      const note = notes.get(edge.from);
      if (!frontier.includes(edge.to) || note === undefined || reached.has(edge.from)) continue;
      if (reached.size === BOARD_PROMPT_MAX_CARDS) break;
      reached.add(edge.from);
      next.push(edge.from);
      const card = boardPromptCard(note, people, boardNoteQuote(note, messages));
      if (card !== null) cards.push(card);
    }
    frontier = next;
  }
  const carried = (ref: string) => ref === thread || reached.has(ref);
  const artifactEdge = edges.find(
    (edge) => edge.from === thread && notes.get(edge.to)?.kind === "artifact",
  );
  return {
    cards,
    edgeIds: new Set(
      edges.filter((edge) => reached.has(edge.from) && carried(edge.to)).map((edge) => edge.id),
    ),
    artifact: artifactEdge === undefined ? null : (notes.get(artifactEdge.to) ?? null),
    artifactEdgeId: artifactEdge?.id ?? null,
  };
}
