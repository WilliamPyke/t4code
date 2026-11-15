import type { RoomBoardAgentTurn, RoomBoardEdge, RoomBoardNote } from "@t3tools/contracts";

import {
  BOARD_PROMPT_MAX_CARDS,
  type BoardPromptCard,
  type BoardThreadBox,
  canPromptBoardBox,
} from "./roomBoard.logic";

/** The target that adds a thread box beside the selection. Box ids are UUIDs or "thread". */
export const BOARD_ASK_NEW_BOX = "new";

/** How long a card an agent just added or changed keeps its box's mark. */
export const BOARD_AGENT_WORK_MS = 4_000;

/**
 * The selected cards an agent can be asked about, as a prompt carries them, at most as many as one
 * prompt takes. Thread boxes and sections never go; nor does a card with nothing written.
 */
export function boardAskCards(
  notes: ReadonlyArray<RoomBoardNote>,
  toCard: (note: RoomBoardNote) => BoardPromptCard | null,
): { readonly cards: ReadonlyArray<BoardPromptCard>; readonly left: number } {
  const cards = notes.flatMap((note) => {
    if (note.kind === "thread" || note.section === true) return [];
    const card = toCard(note);
    return card === null ? [] : [card];
  });
  return {
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

/** A few asks that fit what is selected, by the kinds of card in it. */
export function boardAskSuggestions(
  notes: ReadonlyArray<Pick<RoomBoardNote, "kind">>,
): ReadonlyArray<BoardAskSuggestion> {
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
  if (any("artifact")) {
    return [suggestion("Suggest improvements", `Suggest improvements to ${these}.`), summarise];
  }
  return [summarise, suggestion("Turn into tasks", `Turn ${these} into tasks.`), missing];
}

export interface BoardAskTarget {
  readonly id: string;
  readonly label: string;
}

/** Where this person can send an ask: their own thread boxes, then a new box when they may add one. */
export function boardAskTargets(
  boxes: ReadonlyArray<BoardThreadBox>,
  viewer: string | null,
  canAddBox: boolean,
): ReadonlyArray<BoardAskTarget> {
  return [
    ...boxes
      .filter((box) => canPromptBoardBox(box, viewer))
      .map((box) => ({ id: box.id, label: box.title === "" ? "Untitled thread" : box.title })),
    ...(canAddBox ? [{ id: BOARD_ASK_NEW_BOX, label: "New thread box" }] : []),
  ];
}

/**
 * Which target an ask starts on: a box selected with the cards, else the box last asked from here,
 * else the first box, else a new one.
 */
export function boardAskDefaultTarget(
  targets: ReadonlyArray<BoardAskTarget>,
  hints: { readonly selectedBoxes: ReadonlyArray<string>; readonly lastUsed: string | null },
): string | null {
  const offered = (id: string | null) => id !== null && targets.some((target) => target.id === id);
  const selected = hints.selectedBoxes.find(offered);
  if (selected !== undefined) return selected;
  if (offered(hints.lastUsed)) return hints.lastUsed;
  return (targets.find((target) => target.id !== BOARD_ASK_NEW_BOX) ?? targets[0])?.id ?? null;
}

/**
 * The lines an ask draws into its box: one from each card with no line straight there yet, while
 * the board has room for them. `going` is every card that then has one, in the order given; a card
 * left without a line does not go, so everyone sees what the agent was given.
 */
export function boardAskLines(
  edges: ReadonlyArray<Pick<RoomBoardEdge, "from" | "to">>,
  refs: ReadonlyArray<string>,
  boxRef: string,
  maxEdges: number,
): { readonly add: ReadonlyArray<string>; readonly going: ReadonlyArray<string> } {
  const add: Array<string> = [];
  const going: Array<string> = [];
  for (const ref of refs) {
    if (edges.some((edge) => edge.from === ref && edge.to === boxRef)) {
      going.push(ref);
    } else if (edges.length + add.length < maxEdges) {
      add.push(ref);
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
