import type { RoomBoardChange } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  type BoardGuideInput,
  type BoardGuideKept,
  boardGuideAfterSignIn,
  boardGuideStepOfChange,
  boardGuideSteps,
} from "./boardGuide.logic";

const maker: BoardGuideInput = {
  canEdit: true,
  canInvite: true,
  othersJoined: false,
  agent: "absent",
  done: [],
};

const shown = (input: BoardGuideInput) =>
  boardGuideSteps(input).map((step) => `${step.id}:${step.done ? "done" : "todo"}`);

describe("boardGuideSteps", () => {
  it.each([
    {
      name: "a board's maker with no agent yet has all four steps to do",
      input: maker,
      steps: ["note:todo", "line:todo", "invite:todo", "agent:todo"],
    },
    {
      name: "steps done before in this browser stay ticked",
      input: { ...maker, done: ["note", "agent"] },
      steps: ["note:done", "line:todo", "invite:todo", "agent:done"],
    },
    {
      name: "the board itself ticks inviting and the agent: someone joined, their agent is here",
      input: { ...maker, othersJoined: true, agent: "here" as const },
      steps: ["note:todo", "line:todo", "invite:done", "agent:done"],
    },
    {
      name: "a guest on someone else's board is not asked to invite, whoever else is on it",
      input: { ...maker, canInvite: false, othersJoined: true },
      steps: ["note:todo", "line:todo", "agent:todo"],
    },
    {
      name: "a board that takes no agent of theirs has no agent step, even one done elsewhere",
      input: { ...maker, agent: "none" as const, done: ["agent"] },
      steps: ["note:todo", "line:todo", "invite:todo"],
    },
    {
      name: "someone who can only look gets no steps",
      input: { ...maker, canEdit: false, othersJoined: true, agent: "here" as const },
      steps: [],
    },
  ])("$name", ({ input, steps }) => {
    expect(shown(input)).toEqual(steps);
  });
});

describe("boardGuideStepOfChange", () => {
  const note = { type: "note.put", noteId: "n1", text: "", x: 0, y: 0 } as const;
  it.each<{ name: string; change: RoomBoardChange; isNew: boolean; step: string | null }>([
    { name: "a new sticky note", change: note, isNew: true, step: "note" },
    { name: "a new task", change: { ...note, kind: "task" }, isNew: true, step: "note" },
    { name: "typing in a note already there", change: note, isNew: false, step: null },
    { name: "a new section", change: { ...note, section: true }, isNew: true, step: null },
    { name: "a new agent box", change: { ...note, kind: "thread" }, isNew: true, step: null },
    { name: "a new comment", change: { ...note, kind: "comment" }, isNew: true, step: null },
    {
      name: "a new line between two cards",
      change: { type: "edge.put", edgeId: "e1", from: "note:n1", to: "note:n2" },
      isNew: true,
      step: "line",
    },
    {
      name: "a card moved",
      change: { type: "card.move", cardId: "thread", x: 1, y: 2 },
      isNew: true,
      step: null,
    },
  ])("$name", ({ change, isNew, step }) => {
    expect(boardGuideStepOfChange(change, isNew)).toBe(step);
  });
});

describe("boardGuideAfterSignIn", () => {
  const fresh = (owner: string | null): BoardGuideKept => ({
    owner,
    hidden: false,
    collapsed: false,
    done: [],
  });
  const kept = (owner: string | null): BoardGuideKept => ({
    owner,
    hidden: true,
    collapsed: true,
    done: ["note", "invite"],
  });
  it.each<{
    name: string;
    kept: BoardGuideKept | null;
    signedIn: string | null;
    after: BoardGuideKept;
  }>([
    {
      name: "a browser that kept nothing starts the guide for whoever is here",
      kept: null,
      signedIn: "user_ada",
      after: fresh("user_ada"),
    },
    {
      name: "the same account keeps its steps",
      kept: kept("user_ada"),
      signedIn: "user_ada",
      after: kept("user_ada"),
    },
    {
      name: "another account signing in sees none of the last one's steps",
      kept: kept("user_ada"),
      signedIn: "user_grace",
      after: fresh("user_grace"),
    },
    {
      name: "signing out leaves nothing of the account's for the next person",
      kept: kept("user_ada"),
      signedIn: null,
      after: fresh(null),
    },
    {
      name: "steps done signed out go with the person who then signs in",
      kept: kept(null),
      signedIn: "user_ada",
      after: kept("user_ada"),
    },
    {
      name: "and are theirs alone: the next account starts again",
      kept: boardGuideAfterSignIn(kept(null), "user_ada", fresh("user_ada")),
      signedIn: "user_grace",
      after: fresh("user_grace"),
    },
  ])("$name", ({ kept: before, signedIn, after }) => {
    expect(boardGuideAfterSignIn(before, signedIn, fresh(signedIn))).toEqual(after);
  });
});
