import type { RoomBoardAgentTurn, RoomBoardEdge, RoomBoardNote } from "@t3tools/contracts";

import {
  BOARD_PROMPT_MAX_CARDS,
  type BoardPromptCard,
  type BoardThreadBox,
  canPromptBoardBox,
  isBoardHtmlArtifact,
} from "./roomBoard.logic";

/** The target that adds a thread box beside the selection. Box ids are UUIDs or "thread". */
export const BOARD_ASK_NEW_BOX = "new";

/** How long a card an agent just added or changed keeps its box's mark. */
export const BOARD_AGENT_WORK_MS = 4_000;

/**
 * What an ask about the selection takes: the artifact it edits, the first one selected, even an
 * empty one, whose reply then rewrites it; and the other cards, as a prompt carries them, at most
 * as many as one prompt takes. Thread boxes and sections never go; nor does a card with nothing
 * written. Other artifacts go as cards.
 */
export function boardAskCards(
  notes: ReadonlyArray<RoomBoardNote>,
  toCard: (note: RoomBoardNote) => BoardPromptCard | null,
): {
  readonly artifact: RoomBoardNote | null;
  readonly cards: ReadonlyArray<BoardPromptCard>;
  readonly left: number;
} {
  const artifact = notes.find((note) => note.kind === "artifact") ?? null;
  const cards = notes.flatMap((note) => {
    if (note === artifact || note.kind === "thread" || note.section === true) return [];
    const card = toCard(note);
    return card === null ? [] : [card];
  });
  return {
    artifact,
    cards: cards.slice(0, BOARD_PROMPT_MAX_CARDS),
    left: Math.max(0, cards.length - BOARD_PROMPT_MAX_CARDS),
  };
}

export interface BoardAskSuggestion {
  readonly label: string;
  /** What is sent when it is picked. */
  readonly prompt: string;
}

const suggestion = (label: string, prompt: string): BoardAskSuggestion => ({ label, prompt });

/**
 * A few asks that fit what is selected: edits to the artifact the ask rewrites when there is one,
 * else by the kinds of the cards that go.
 */
export function boardAskSuggestions(
  notes: ReadonlyArray<Pick<RoomBoardNote, "kind">>,
  artifact: { readonly artifact?: { readonly body: string } | undefined } | null = null,
): ReadonlyArray<BoardAskSuggestion> {
  if (artifact !== null) {
    const withCards = notes.length > 0;
    const body = artifact.artifact?.body.trim() ?? "";
    if (body === "") {
      return [
        suggestion("Write a first draft", "Write a first draft of this artifact."),
        ...(withCards
          ? [suggestion("Write it from the cards", "Write this artifact from the cards I sent.")]
          : []),
        suggestion("Make a web page", "Write this artifact as a complete web page."),
      ];
    }
    return [
      suggestion("Rewrite this", "Rewrite this artifact so it reads clearly."),
      suggestion("Make it shorter", "Make this artifact shorter, keeping what matters."),
      isBoardHtmlArtifact(body)
        ? suggestion("Turn into a document", "Turn this page into a plain markdown document.")
        : suggestion("Turn into a web page", "Turn this artifact into a complete web page."),
      ...(withCards
        ? [suggestion("Work in the cards", "Rewrite this artifact to take in the cards I sent.")]
        : []),
    ];
  }
  const one = notes.length === 1;
  const all = (kind: RoomBoardNote["kind"]) => notes.every((note) => note.kind === kind);
  const any = (kind: RoomBoardNote["kind"]) => notes.some((note) => note.kind === kind);
  const these = one ? "this card" : "these cards";
  const summarise = suggestion("Summarise", `Summarise ${these}.`);
  const missing = suggestion("Find what's missing", `Say what is missing from ${these}.`);
  if (all(undefined)) {
    return [
      suggestion("Turn into tasks", `Turn ${one ? "this note" : "these notes"} into tasks.`),
      one
        ? suggestion("Expand on this", "Expand on this note.")
        : suggestion("Group by theme", "Group these notes by theme."),
      summarise,
    ];
  }
  if (all("task")) {
    return [
      ...(one ? [] : [suggestion("Order by priority", "Order these tasks by priority.")]),
      suggestion(
        "Split into smaller steps",
        `Split ${one ? "this task" : "these tasks"} into smaller steps.`,
      ),
      missing,
    ];
  }
  if (any("code") || any("pull-request")) {
    return [suggestion("Review the changes", "Review these changes."), summarise];
  }
  return [summarise, suggestion("Turn into tasks", `Turn ${these} into tasks.`), missing];
}

export interface BoardAskTarget {
  readonly id: string;
  readonly label: string;
  /** The model the box last ran on, when it ran. */
  readonly model?: string | undefined;
}

/** Where this person can send an ask: their own thread boxes, then a new box when they may add one. */
export function boardAskTargets(
  boxes: ReadonlyArray<BoardThreadBox>,
  viewer: string | null,
  canAddBox: boolean,
  modelOf: (boxId: string) => string | undefined = () => undefined,
): ReadonlyArray<BoardAskTarget> {
  return [
    ...boxes
      .filter((box) => canPromptBoardBox(box, viewer))
      .map((box) => {
        const model = modelOf(box.id);
        return {
          id: box.id,
          label: box.title === "" ? "Untitled thread" : box.title,
          ...(model === undefined || model.trim() === "" ? {} : { model }),
        };
      }),
    ...(canAddBox ? [{ id: BOARD_ASK_NEW_BOX, label: "New thread box" }] : []),
  ];
}

/**
 * Which target an ask starts on: a box selected with the cards, else the box that already writes
 * the artifact asked about, else the box last asked from here, else the first box, else a new one.
 */
export function boardAskDefaultTarget(
  targets: ReadonlyArray<BoardAskTarget>,
  hints: {
    readonly selectedBoxes: ReadonlyArray<string>;
    readonly artifactBox?: string | null;
    readonly lastUsed: string | null;
  },
): string | null {
  const offered = (id: string | null | undefined): id is string =>
    id !== null && id !== undefined && targets.some((target) => target.id === id);
  const selected = hints.selectedBoxes.find(offered);
  if (selected !== undefined) return selected;
  if (offered(hints.artifactBox)) return hints.artifactBox;
  if (offered(hints.lastUsed)) return hints.lastUsed;
  return (targets.find((target) => target.id !== BOARD_ASK_NEW_BOX) ?? targets[0])?.id ?? null;
}

/** Where a draft for the viewer's own agent goes: a box, or a choice for them to make. */
export type BoardDraftBox =
  | { readonly boxId: string }
  | { readonly pick: ReadonlyArray<string> }
  | null;

/**
 * Which of the viewer's own boxes (`own`, never anyone else's) a draft for their agent goes to:
 * the one selected when exactly one is, else `preferred` (as the box that wrote what is being
 * refreshed), else the one they used last on this board, else the one that ran last, else their
 * only one. With several and nothing to go on, they pick. Null when they have none.
 */
export function boardDraftBox(
  own: ReadonlyArray<{ readonly id: string; readonly ranAt?: string | undefined }>,
  hints: {
    readonly selected: ReadonlyArray<string>;
    readonly preferred?: string | null | undefined;
    readonly lastUsed: string | null;
  },
): BoardDraftBox {
  const ids = own.map((box) => box.id);
  const selected = hints.selected.filter((id) => ids.includes(id));
  if (selected.length === 1 && selected[0] !== undefined) return { boxId: selected[0] };
  for (const hint of [hints.preferred, hints.lastUsed]) {
    if (typeof hint === "string" && ids.includes(hint)) return { boxId: hint };
  }
  const ran = own
    .filter((box) => box.ranAt !== undefined)
    .toSorted((a, b) => (b.ranAt ?? "").localeCompare(a.ranAt ?? ""))[0];
  if (ran !== undefined) return { boxId: ran.id };
  if (ids.length === 0) return null;
  return ids.length === 1 && ids[0] !== undefined ? { boxId: ids[0] } : { pick: ids };
}

/**
 * The lines an ask draws while the board has room: the box's line to the artifact it edits, if
 * missing, then one into the box from each card with none there yet. `going` is every card that
 * then has a line; one left without does not go, so everyone sees what the agent was given.
 */
export function boardAskLines(
  edges: ReadonlyArray<Pick<RoomBoardEdge, "from" | "to">>,
  refs: ReadonlyArray<string>,
  boxRef: string,
  maxEdges: number,
  artifactRef: string | null = null,
): {
  readonly add: ReadonlyArray<{ readonly from: string; readonly to: string }>;
  readonly going: ReadonlyArray<string>;
} {
  const add: Array<{ readonly from: string; readonly to: string }> = [];
  const going: Array<string> = [];
  const room = () => edges.length + add.length < maxEdges;
  if (
    artifactRef !== null &&
    !edges.some((edge) => edge.from === boxRef && edge.to === artifactRef) &&
    room()
  ) {
    add.push({ from: boxRef, to: artifactRef });
  }
  for (const ref of refs) {
    if (edges.some((edge) => edge.from === ref && edge.to === boxRef)) {
      going.push(ref);
    } else if (room()) {
      add.push({ from: ref, to: boxRef });
      going.push(ref);
    }
  }
  return { add, going };
}

const sameCard = (
  a: RoomBoardAgentTurn["cards"][number]["after"],
  b: RoomBoardAgentTurn["cards"][number]["after"],
) =>
  a.text === b.text &&
  a.x === b.x &&
  a.y === b.y &&
  a.done === b.done &&
  a.size?.w === b.size?.w &&
  a.size?.h === b.size?.h;

/**
 * The cards an agent turn added or changed between two boards, each with the box whose agent did
 * it. A turn taken back or done again is a person's doing, so it marks nothing.
 */
export function boardAgentWorkFresh(
  before: ReadonlyArray<RoomBoardAgentTurn>,
  after: ReadonlyArray<RoomBoardAgentTurn>,
): ReadonlyArray<{ readonly id: string; readonly boxId: string }> {
  const fresh = new Map<string, string>();
  for (const turn of after) {
    if (turn.undone === true) continue;
    const previous = before.find((candidate) => candidate.id === turn.id);
    if (previous !== undefined && (previous.at === turn.at || previous.undone === true)) continue;
    for (const card of turn.cards) {
      const was = previous?.cards.find((candidate) => candidate.id === card.id);
      if (was === undefined || !sameCard(was.after, card.after)) fresh.set(card.id, turn.boxId);
    }
  }
  return [...fresh].map(([id, boxId]) => ({ id, boxId }));
}

const POPOVER_SIDE_GAP = 12;

/**
 * Where a popover drawn under its anchor (start-aligned, `offset` below) anchors: the selection,
 * with its floating `bar`, while the popover fits below or above; else a flat line beside it,
 * right then left; else a line `room.height` above the bounds' bottom, so it covers only the
 * selection's lower part instead of being cut short by the toolbar.
 */
export function boardPopoverAnchor(
  selected: BoardScreenRect,
  bounds: BoardScreenRect | undefined,
  room: { readonly width: number; readonly height: number },
  offset = 0,
  bar?: BoardScreenRect,
): BoardScreenRect {
  const selection = bar === undefined ? selected : boardPopoverAvoid(selected, bar);
  if (bounds === undefined) return selection;
  const bottom = bounds.y + bounds.height;
  const selectionBottom = selection.y + selection.height;
  if (bottom - selectionBottom >= room.height || selection.y - bounds.y >= room.height) {
    return selection;
  }
  const right = selection.x + selection.width + POPOVER_SIDE_GAP;
  const left = selection.x - POPOVER_SIDE_GAP - room.width;
  const beside =
    right + room.width <= bounds.x + bounds.width ? right : left >= bounds.x ? left : undefined;
  if (beside !== undefined) {
    const besideTop = Math.max(bounds.y, Math.min(selection.y, bottom - room.height));
    return { x: beside, y: besideTop - offset, width: room.width, height: 0 };
  }
  const line = Math.max(bounds.y, Math.min(selectionBottom, bottom - room.height));
  const top = Math.min(selection.y, line);
  return { x: selection.x, y: top, width: selection.width, height: line - top };
}

/**
 * The selection grown to take in its bar: down or up only, keeping the selection's left edge for
 * the popover to align to, while the bar is above or below it; both ways when it is beside it.
 */
function boardPopoverAvoid(selection: BoardScreenRect, bar: BoardScreenRect): BoardScreenRect {
  const top = Math.min(selection.y, bar.y);
  const bottom = Math.max(selection.y + selection.height, bar.y + bar.height);
  const stacked = bar.y >= selection.y + selection.height || bar.y + bar.height <= selection.y;
  if (stacked) return { x: selection.x, y: top, width: selection.width, height: bottom - top };
  const left = Math.min(selection.x, bar.x);
  const right = Math.max(selection.x + selection.width, bar.x + bar.width);
  return { x: left, y: top, width: right - left, height: bottom - top };
}

export interface BoardScreenRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
