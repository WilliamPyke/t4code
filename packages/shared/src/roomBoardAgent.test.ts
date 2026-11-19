import {
  GuestId,
  RoomBoardAgentArrangeInput,
  type RoomBoard,
  type RoomBoardAgentArrangeOp,
  type RoomBoardChange,
  type RoomBoardEdge,
  type RoomBoardNote,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "@effect/vitest";

import {
  type RoomBoardScope,
  applyRoomBoardChange,
  roomBoardWithAgentChange,
} from "./roomBoard.ts";
import {
  roomBoardAgentArrange,
  roomBoardAgentView,
  type RoomBoardAgentTarget,
} from "./roomBoardAgent.ts";

const sam = GuestId.make("guest:sam");
const AT = "2026-11-19T10:00:00.000Z";
const scope: RoomBoardScope = { hasCard: () => true, hasPerson: () => true };
const mark = { boxId: "box:me", turnId: "run:1" };

const NOTES: ReadonlyArray<RoomBoardNote> = [
  { id: "box:me", text: "Mine", x: 0, y: 2_000, kind: "thread" },
  { id: "box:sam", text: "Sam's", x: 0, y: 3_000, kind: "thread", guestId: sam },
  { id: "a", text: "A", x: 100, y: 100 },
  { id: "b", text: "B", x: 500, y: 300, guestId: sam },
  { id: "c", text: "C", x: 50, y: 700 },
  { id: "s", text: "Ideas", x: 1_000, y: 0, section: true },
  { id: "p", text: "P", x: 1_300, y: 200 },
  { id: "q", text: "Q", x: 1_100, y: 150 },
  // Sam's section, whose line takes its cards to Sam's agent, and Sam's box's code window.
  { id: "sams", text: "For Sam", x: 3_000, y: 0, section: true, guestId: sam },
  { id: "code:sam", text: "Diff", x: 5_000, y: 0, kind: "code", guestId: sam },
];
const EDGES: ReadonlyArray<RoomBoardEdge> = [
  { id: "e1", from: "note:sams", to: "note:box:sam" },
  { id: "e2", from: "note:box:sam", to: "note:code:sam" },
];

/** One arrange call of the owner's box's agent, on a board that takes changes as a host does. */
function arrange(
  ops: ReadonlyArray<RoomBoardAgentArrangeOp>,
  notes: ReadonlyArray<RoomBoardNote> = NOTES,
) {
  const target: RoomBoardAgentTarget = {
    roomTitle: "Room",
    boxId: "box:me",
    hasRoomCard: true,
    people: [
      { guestId: null, name: "Owner" },
      { guestId: sam, name: "Sam" },
    ],
    me: null,
    board: { positions: {}, notes, edges: EDGES },
  };
  const sent: Array<RoomBoardChange> = [];
  const apply = (change: RoomBoardChange) =>
    Effect.sync(() => {
      sent.push(change);
      const next = applyRoomBoardChange(target.board, scope, null, change, AT);
      if (Result.isFailure(next)) return next.failure;
      target.board = roomBoardWithAgentChange(target.board, next.success, change, mark, AT);
      return undefined;
    });
  return Effect.map(
    roomBoardAgentArrange(target, { apply, uuid: Effect.succeed("id") }, { ops }),
    (result) => ({ result, board: target.board, sent, target }),
  );
}

const at = (board: RoomBoard, id: string) => {
  const note = board.notes.find((candidate) => candidate.id === id);
  return note && [note.x, note.y, note.size?.w, note.size?.h];
};

describe("roomBoardAgentArrange", () => {
  it.effect("lays cards out in a row from the first one, reporting only what moved", () =>
    Effect.gen(function* () {
      const { result, board } = yield* arrange([
        { do: "layout", cards: ["a", "b", "c"], as: "row" },
      ]);
      expect(result).toEqual({
        moved: [
          { id: "b", x: 316, y: 100, w: 192, h: 144 },
          { id: "c", x: 532, y: 100, w: 192, h: 144 },
        ],
        renamed: [],
        refused: [],
      });
      // Sam's card moved, and is still Sam's and unmarked.
      expect(board.notes.find((note) => note.id === "b")).toMatchObject({
        guestId: sam,
        text: "B",
      });
      expect(board.notes.find((note) => note.id === "b")?.agent).toBeUndefined();
    }),
  );

  it.effect(
    "lays cards out in a section under what it holds, growing it, and undo puts all back",
    () =>
      Effect.gen(function* () {
        const { result, board, sent } = yield* arrange([
          { do: "layout", cards: ["a", "b", "c"], as: "grid", columns: 2, in: "ideas" },
          { do: "resize", card: "a", w: 50, h: 99_999 },
        ]);
        expect(result.refused).toEqual([]);
        // Below P and Q, which stay; the section grows to hold the second row.
        expect([at(board, "a"), at(board, "b"), at(board, "c")]).toEqual([
          [1_032, 368, 120, 8_000],
          [1_248, 368, undefined, undefined],
          [1_032, 536, undefined, undefined],
        ]);
        expect(at(board, "s")).toEqual([1_000, 0, 640, 712]);
        expect(at(board, "p")).toEqual([1_300, 200, undefined, undefined]);
        expect(result.moved.map((card) => card.id)).toEqual(["a", "b", "c", "s"]);
        // Only the board changes agents already make: nothing that sends a prompt or starts a turn.
        expect(new Set(sent.map((change) => change.type))).toEqual(new Set(["note.put"]));

        const undone = Result.getOrThrow(
          applyRoomBoardChange(
            board,
            scope,
            null,
            { type: "agent-turn.undo", turnId: "run:1", undone: true },
            AT,
          ),
        );
        expect(["a", "b", "c", "s"].map((id) => at(undone, id))).toEqual([
          [100, 100, undefined, undefined],
          [500, 300, undefined, undefined],
          [50, 700, undefined, undefined],
          [1_000, 0, undefined, undefined],
        ]);
      }),
  );

  it.effect(
    "makes the section a layout names when no section has that title, sized to its cards",
    () =>
      Effect.gen(function* () {
        const { result, board } = yield* arrange([
          { do: "layout", cards: ["a", "b", "c"], as: "row", in: "Themes" },
          // Sam's code window stays, and no section is made for it.
          { do: "layout", cards: ["code:sam"], as: "row", in: "Code" },
        ]);
        expect(result.sections).toEqual([{ id: "id", title: "Themes" }]);
        expect(result.refused.map((refusal) => refusal.op)).toEqual([1]);
        const made = board.notes.find((note) => note.id === "id");
        // Beside the agent's box, wide enough for the row.
        expect(made).toMatchObject({ section: true, x: 388, y: 2_000, size: { w: 688, h: 420 } });
        expect(["a", "b", "c"].map((id) => at(board, id))).toEqual([
          [420, 2_072, undefined, undefined],
          [636, 2_072, undefined, undefined],
          [852, 2_072, undefined, undefined],
        ]);
        expect(board.notes.some((note) => note.text === "Code")).toBe(false);
      }),
  );

  it.effect("places a card beside another, past whatever is in the way on that side", () =>
    Effect.gen(function* () {
      const blocker: RoomBoardNote = { id: "d", text: "D", x: 330, y: 100 };
      const { result } = yield* arrange(
        [
          { do: "place", card: "c", side: "right", of: "a" },
          { do: "place", card: "b", side: "below", of: "thread" },
        ],
        [...NOTES, blocker],
      );
      expect(result.refused).toEqual([]);
      expect(result.moved).toEqual([
        { id: "b", x: 80, y: 516, w: 192, h: 144 },
        { id: "c", x: 546, y: 100, w: 192, h: 144 },
      ]);
    }),
  );

  it.effect(
    "tidies a section into a grid, fits it to its cards, and carries them when it moves",
    () =>
      Effect.gen(function* () {
        const tidied = yield* arrange([{ do: "tidy", section: "s" }]);
        expect([at(tidied.board, "q"), at(tidied.board, "p")]).toEqual([
          [1_032, 72, undefined, undefined],
          [1_248, 72, undefined, undefined],
        ]);
        const fitted = yield* arrange(
          [
            { do: "fit", section: "Ideas" },
            { do: "move", card: "s", x: 2_000.4, y: 500 },
            { do: "resize", card: "s", w: 30_000, h: 500 },
          ],
          tidied.board.notes,
        );
        expect(fitted.result.refused).toEqual([]);
        expect(fitted.result.moved).toEqual([
          { id: "s", x: 2_000, y: 500, w: 20_000, h: 500 },
          { id: "p", x: 2_248, y: 572, w: 192, h: 144 },
          { id: "q", x: 2_032, y: 572, w: 192, h: 144 },
        ]);
        // Fitted first: its cards plus the padding and the title.
        expect(fitted.sent[0]).toMatchObject({
          noteId: "s",
          x: 1_000,
          y: 0,
          size: { w: 472, h: 248 },
        });
      }),
  );

  it.effect("renames what has a title, and refuses each op apart from the others", () =>
    Effect.gen(function* () {
      const comment: RoomBoardNote = { id: "k", text: "Why?", x: 0, y: 900, kind: "comment" };
      const { result, board } = yield* arrange(
        [
          { do: "rename", card: "s", title: "  Themes " },
          { do: "rename", card: "k", title: "Because" },
          { do: "move", card: "thread", x: 0, y: 0 },
          { do: "move", card: "nope", x: 0, y: 0 },
          { do: "tidy", section: "Nowhere" },
          { do: "move", card: "a", x: 900_000, y: 0 },
          { do: "rename", card: "a", title: "Alpha" },
        ],
        [...NOTES, comment],
      );
      expect(result.renamed).toEqual([
        { id: "s", title: "Themes" },
        { id: "a", title: "Alpha" },
      ]);
      expect(result.moved).toEqual([]);
      expect(result.refused.map((refusal) => refusal.op)).toEqual([1, 2, 3, 4, 5]);
      expect(board.notes.find((note) => note.id === "k")?.text).toBe("Why?");
    }),
  );

  it.effect(
    "leaves another person's box, code window and section, and what goes to their agent",
    () =>
      Effect.gen(function* () {
        const { result, board } = yield* arrange([
          { do: "move", card: "box:sam", x: 0, y: 0 },
          { do: "resize", card: "code:sam", w: 400, h: 400 },
          { do: "rename", card: "box:sam", title: "Mine now" },
          { do: "move", card: "sams", x: 0, y: 0 },
          { do: "resize", card: "sams", w: 900, h: 900 },
          { do: "move", card: "a", x: 3_100, y: 100 },
          { do: "layout", cards: ["a", "c"], as: "row", in: "For Sam" },
          { do: "rename", card: "sams", title: "Not for Sam" },
          // Beside Sam's box is fine: nothing of Sam's moves, and nothing reaches Sam's agent.
          { do: "place", card: "c", side: "right", of: "box:sam" },
          { do: "move", card: "box:me", x: 40, y: 2_000 },
        ]);
        expect(result.refused.map((refusal) => refusal.op)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        for (const refusal of result.refused) expect(refusal.reason).toContain("Sam's");
        expect(result.moved.map((card) => card.id)).toEqual(["box:me", "c"]);
        expect(result.renamed).toEqual([]);
        expect(["box:sam", "code:sam", "sams", "a"].map((id) => at(board, id))).toEqual(
          ["box:sam", "code:sam", "sams", "a"].map((id) => at({ positions: {}, notes: NOTES }, id)),
        );
      }),
  );

  it("takes at most twenty ops in a call", () => {
    const decode = Schema.decodeUnknownOption(RoomBoardAgentArrangeInput);
    const ops = (count: number) => ({
      ops: Array.from({ length: count }, () => ({ do: "tidy", section: "s" })),
    });
    expect(decode(ops(20))._tag).toBe("Some");
    expect(decode(ops(21))._tag).toBe("None");
    expect(decode({ ops: [{ do: "remove", card: "a" }] })._tag).toBe("None");
  });
});

describe("roomBoardAgentView", () => {
  it.effect("gives each card's size, colour and a link's address", () =>
    Effect.gen(function* () {
      const { target } = yield* arrange(
        [],
        [
          { id: "box:me", text: "Mine", x: 0, y: 0, kind: "thread" },
          { id: "n", text: "N", x: 10, y: 20, color: "pink", size: { w: 300, h: 200 } },
          { id: "l", text: "Spec", x: 0, y: 500, kind: "link", url: "https://example.com/spec" },
        ],
      );
      const view = roomBoardAgentView(target, () => undefined);
      expect(view.cards.slice(2)).toEqual([
        {
          id: "n",
          kind: "note",
          text: "N",
          by: "the owner",
          x: 10,
          y: 20,
          w: 300,
          h: 200,
          color: "pink",
        },
        {
          id: "l",
          kind: "link",
          text: "Spec",
          by: "the owner",
          x: 0,
          y: 500,
          w: 192,
          h: 144,
          url: "https://example.com/spec",
        },
      ]);
      expect(view.cards[0]).toMatchObject({ id: "thread", w: 320, h: 420 });
    }),
  );
});
