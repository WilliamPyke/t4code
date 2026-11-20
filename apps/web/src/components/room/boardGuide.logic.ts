import type { RoomBoardChange } from "@t3tools/contracts";

const BOARD_GUIDE_STEP_IDS = ["note", "line", "invite", "agent"] as const;
export type BoardGuideStepId = (typeof BOARD_GUIDE_STEP_IDS)[number];

interface BoardGuideStep {
  readonly id: BoardGuideStepId;
  readonly done: boolean;
}

export interface BoardGuideInput {
  /** The viewer may change the board. Someone who can only look gets no guide. */
  readonly canEdit: boolean;
  /** The board is the viewer's to share, and it has a way to. */
  readonly canInvite: boolean;
  /** Someone other than the viewer has joined the board. */
  readonly othersJoined: boolean;
  /** The viewer's own agent on this board; `none` where the board takes none of theirs. */
  readonly agent: "here" | "absent" | "none";
  /** The steps this person did before, as this browser remembers them for them. */
  readonly done: ReadonlyArray<string>;
}

/** The guide as a browser keeps it for one person: `owner` is their account, null signed out. */
export interface BoardGuideKept {
  readonly owner: string | null;
  readonly hidden: boolean;
  readonly collapsed: boolean;
  readonly done: ReadonlyArray<string>;
}

/**
 * The guide this browser keeps once `signedIn` (null: nobody) is seen signed in. Progress is a
 * person's: what was done signed out goes with whoever then signs in, as their boards do, and
 * anyone else, a sign-out included, starts from `fresh`.
 */
export function boardGuideAfterSignIn(
  kept: BoardGuideKept | null,
  signedIn: string | null,
  fresh: BoardGuideKept,
): BoardGuideKept {
  if (kept === null) return fresh;
  if (kept.owner === signedIn) return kept;
  return kept.owner === null ? { ...kept, owner: signedIn } : fresh;
}

/** The first-run steps that apply to this viewer on this board, each ticked or not. */
export function boardGuideSteps(input: BoardGuideInput): ReadonlyArray<BoardGuideStep> {
  if (!input.canEdit) return [];
  const did = (id: BoardGuideStepId) => input.done.includes(id);
  return [
    { id: "note" as const, done: did("note") },
    { id: "line" as const, done: did("line") },
    ...(input.canInvite
      ? [{ id: "invite" as const, done: did("invite") || input.othersJoined }]
      : []),
    ...(input.agent === "none"
      ? []
      : [{ id: "agent" as const, done: did("agent") || input.agent === "here" }]),
  ];
}

/**
 * The step a change the board took completes: this person's first sticky note or task, or a line
 * between two cards. `isNew` is false for an edit of something already there.
 */
export function boardGuideStepOfChange(
  change: RoomBoardChange,
  isNew: boolean,
): BoardGuideStepId | null {
  if (!isNew) return null;
  if (change.type === "edge.put") return "line";
  if (change.type !== "note.put" || change.section === true) return null;
  return change.kind === undefined || change.kind === "task" ? "note" : null;
}
