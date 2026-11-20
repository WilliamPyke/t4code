import { GuestId, type RoomBoardAgentTurn, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { type BoardAwayInput, boardAwaySummary } from "./boardAway.logic";
import { boardCatchUp } from "./boardCatchUp.logic";
import type { BoardPeople } from "./roomBoard.logic";

const maya = GuestId.make("maya");
const sam = GuestId.make("sam");
const people: BoardPeople = {
  guests: [
    { id: maya, name: "Maya" },
    { id: sam, name: "Sam" },
  ],
  viewer: null,
  ownerName: "Will",
};
const SINCE = "2026-11-10T00:00:00.000Z";
const UNTIL = "2026-11-12T00:00:00.000Z";
const AT = "2026-11-11T00:00:00.000Z";
const at = (minute: number) => `2026-11-11T00:${String(minute).padStart(2, "0")}:00.000Z`;

const note = (id: string, fields: Partial<RoomBoardNote> = {}): RoomBoardNote => ({
  id,
  text: id,
  x: 0,
  y: 0,
  ...fields,
});
const by = (guestId: GuestId, when = AT) => ({ changed: { at: when, guestId } });

const summary = (notes: ReadonlyArray<RoomBoardNote>, extra: Partial<BoardAwayInput> = {}) =>
  boardAwaySummary({
    steps: boardCatchUp(notes, SINCE, people.viewer, UNTIL),
    notes,
    turns: [],
    since: SINCE,
    until: UNTIL,
    people,
    seen: undefined,
    ...extra,
  }).map(({ label, noteIds }) => ({ label, noteIds }));

describe("boardAwaySummary", () => {
  it.each<{
    readonly name: string;
    readonly notes: ReadonlyArray<RoomBoardNote>;
    readonly extra?: Partial<BoardAwayInput>;
    readonly rows: ReadonlyArray<{
      readonly label: string;
      readonly noteIds: ReadonlyArray<string>;
    }>;
  }>([
    {
      name: "nothing when nobody else changed anything since",
      notes: [
        note("old", by(maya, "2026-11-01T00:00:00.000Z")),
        note("mine", { changed: { at: AT } }),
        note("later", by(maya, "2026-11-13T00:00:00.000Z")),
      ],
      rows: [],
    },
    {
      name: "added or changed, by person and kind, when this browser kept no earlier cards",
      notes: [
        note("a", by(maya, at(1))),
        note("b", by(maya, at(2))),
        note("t", { ...by(maya, at(3)), kind: "task" }),
        note("s", by(sam, at(4))),
      ],
      rows: [
        { label: "Maya added or changed 2 notes and 1 task", noteIds: ["a", "b", "t"] },
        { label: "Sam added or changed 1 note", noteIds: ["s"] },
      ],
    },
    {
      name: "added apart from changed when the cards of the last visit are known",
      notes: [note("a", by(maya, at(1))), note("b", by(maya, at(2))), note("old", by(maya, at(3)))],
      extra: { seen: new Set(["old"]) },
      rows: [{ label: "Maya added 2 notes and changed 1 note", noteIds: ["a", "b", "old"] }],
    },
    {
      name: "the tasks now done, after who changed them",
      notes: [
        note("t1", { ...by(sam, at(1)), kind: "task", done: true }),
        note("t2", { ...by(maya, at(2)), kind: "task", done: true }),
        note("t3", { ...by(maya, at(3)), kind: "task" }),
      ],
      extra: { seen: new Set(["t1", "t2", "t3"]) },
      rows: [
        { label: "Sam changed 1 task", noteIds: ["t1"] },
        { label: "Maya changed 2 tasks", noteIds: ["t2", "t3"] },
        { label: "2 tasks now done", noteIds: ["t1", "t2"] },
      ],
    },
    {
      name: "replies by who wrote them, an agent's apart",
      notes: [
        note("c", {
          kind: "comment",
          replies: [
            { id: "r1", text: "Yes", guestId: maya, at: at(1) },
            { id: "r2", text: "Sure", guestId: maya, at: at(2) },
            {
              id: "r3",
              text: "Done",
              guestId: sam,
              at: at(3),
              agent: { turnId: "run", boxId: "box" },
            },
            { id: "r4", text: "Mine", at: at(4) },
          ],
        }),
      ],
      rows: [
        { label: "Maya wrote 2 replies", noteIds: ["c"] },
        { label: "Sam's agent wrote 1 reply", noteIds: ["c"] },
      ],
    },
  ])("says $name", ({ notes, extra, rows }) => {
    expect(summary(notes, extra)).toEqual(rows);
  });

  it("gives an agent's turn its cards, and names the artifacts an agent rewrote", () => {
    const turn: RoomBoardAgentTurn = {
      id: "run",
      boxId: "box",
      guestId: sam,
      at: at(5),
      cards: [
        { id: "new", after: { text: "new", x: 0, y: 0 } },
        { id: "old", before: { text: "was", x: 0, y: 0 }, after: { text: "old", x: 0, y: 0 } },
      ],
    };
    const undone: RoomBoardAgentTurn = { ...turn, id: "undone", undone: true, cards: [] };
    const notes = [
      note("new", by(sam, at(5))),
      note("old", by(sam, at(5))),
      // Sam changed it by hand after the agent did: it is Sam's change.
      note("hand", by(sam, at(9))),
      note("page", {
        text: "Onboarding page",
        kind: "artifact",
        artifact: { body: "Hi", guestId: sam, turnId: "run", updatedAt: at(6) },
      }),
      note("typed", {
        text: "Typed page",
        kind: "artifact",
        artifact: { body: "Hi", guestId: maya, turnId: "edit", updatedAt: at(7), byHand: true },
        ...by(maya, at(7)),
      }),
    ];
    const handTurn = {
      ...turn,
      id: "hand-turn",
      at: at(4),
      cards: [{ id: "hand", after: { text: "hand", x: 0, y: 0 } }],
    };
    expect(
      summary(notes, { turns: [handTurn, turn, undone], seen: new Set(["hand", "typed"]) }),
    ).toEqual([
      { label: "Maya changed 1 artifact", noteIds: ["typed"] },
      { label: "Sam changed 1 note", noteIds: ["hand"] },
      { label: "Sam's agent added 1 note and changed 1 note", noteIds: ["new", "old"] },
      { label: "Sam's agent rewrote Onboarding page", noteIds: ["page"] },
    ]);
  });
});
