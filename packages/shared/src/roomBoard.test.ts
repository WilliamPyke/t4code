import {
  GuestId,
  GuestShareId,
  type OrchestrationV2TurnItem,
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_REACTIONS,
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOARD_MAX_THREADS,
  ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH,
  RoomBoard,
  type RoomBoardChange,
  type RoomBoardNote,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_ROOM_BOARD,
  ROOM_COMMENT_THREAD_FULL,
  type RoomBoardScope,
  applyRoomBoardChange,
  canRestoreRoomArtifact,
  roomArtifactAfterFill,
  roomArtifactBody,
  roomArtifactRequestOf,
  roomBoardWithCards,
  roomBoardCardIdentity,
  roomBoxExcerpt,
  roomBoxRequestOf,
  roomCommentAnswer,
  roomCommentRequestOf,
} from "./roomBoard.ts";

describe("roomBoardWithCards", () => {
  const board: RoomBoard = {
    positions: { kept: { x: 1, y: 2 }, gone: { x: 3, y: 4 } },
    notes: [{ id: "note-1", text: "", x: 0, y: 0 }],
    edges: [
      { id: "to-gone", from: "note:note-1", to: "card:gone" },
      { id: "to-kept", from: "card:kept", to: "note:note-1" },
    ],
    sizes: { kept: { w: 300, h: 200 }, gone: { w: 400, h: 300 } },
  };

  it("drops the places, sizes and arrows of cards the board no longer has", () => {
    expect(roomBoardWithCards(board, (cardId) => cardId === "kept")).toEqual({
      positions: { kept: { x: 1, y: 2 } },
      notes: board.notes,
      edges: [{ id: "to-kept", from: "card:kept", to: "note:note-1" }],
      sizes: { kept: { w: 300, h: 200 } },
    });
  });

  it("returns the same board when every card is still there", () => {
    expect(roomBoardWithCards(board, () => true)).toBe(board);
  });
});

const decodeBoard = Schema.decodeUnknownSync(RoomBoard);

describe("applyRoomBoardChange", () => {
  const scope: RoomBoardScope = { hasCard: (cardId) => cardId === "thread", hasPerson: () => true };
  const sam = GuestId.make("guest:sam");
  const at = "2026-11-13T10:00:00.000Z";
  const apply = (board: RoomBoard, change: RoomBoardChange) =>
    applyRoomBoardChange(board, scope, sam, change, at);
  const applied = (board: RoomBoard, change: RoomBoardChange) =>
    Result.getOrThrow(apply(board, change));
  const put = (
    noteId: string,
    fields: Partial<Extract<RoomBoardChange, { type: "note.put" }>> = {},
  ): RoomBoardChange => ({ type: "note.put", noteId, text: "", x: 0, y: 0, ...fields });

  it("sizes a card on the board, and a note with its own change", () => {
    // A board stored before cards had sizes.
    const old: RoomBoard = { positions: {}, notes: [{ id: "n", text: "Hi", x: 1, y: 1 }] };
    const resize: RoomBoardChange = { type: "card.resize", cardId: "thread", w: 480, h: 320 };
    const sized = applied(old, resize);
    expect(sized.sizes).toEqual({ thread: { w: 480, h: 320 } });
    expect(applied(sized, resize)).toBe(sized);
    expect(Result.isFailure(apply(old, { ...resize, cardId: "guest:nobody" }))).toBe(true);

    const note = applied(old, put("n", { text: "Hi", x: 1, y: 1, size: { w: 200, h: 150 } }));
    expect(note.notes[0]?.size).toEqual({ w: 200, h: 150 });
    // An edit that says nothing of the size keeps it, and one that changes only it is a change.
    expect(applied(note, put("n", { text: "Hi", x: 1, y: 1 }))).toBe(note);
    expect(
      applied(note, put("n", { text: "Hi", x: 1, y: 1, size: { w: 260, h: 150 } })).notes[0]?.size,
    ).toEqual({ w: 260, h: 150 });
  });

  it("colours a plain note, which an edit that says nothing of it keeps, and no other card", () => {
    const owners: RoomBoard = {
      positions: {},
      notes: [{ id: "n", text: "Hi", x: 0, y: 0 }],
    };
    // Anyone may colour a note, as anyone may edit its text.
    const green = applied(owners, put("n", { text: "Hi", color: "green" }));
    expect(green.notes[0]).toEqual({ id: "n", text: "Hi", x: 0, y: 0, color: "green" });
    expect(applied(green, put("n", { text: "Hi" }))).toBe(green);
    expect(applied(green, put("n", { text: "Hi", color: "green" }))).toBe(green);
    expect(applied(green, put("n", { text: "Hi", color: "blue" })).notes[0]?.color).toBe("blue");
    expect(applied(EMPTY_ROOM_BOARD, put("p", { color: "pink" })).notes[0]?.color).toBe("pink");
    const refused: ReadonlyArray<Partial<Extract<RoomBoardChange, { type: "note.put" }>>> = [
      { kind: "task" },
      { kind: "link", url: "https://x.dev" },
      { kind: "artifact" },
      { kind: "thread" },
      { kind: "comment" },
      { pinnedTo: "message:1" },
    ];
    for (const fields of refused) {
      expect(
        Result.isFailure(apply(EMPTY_ROOM_BOARD, put("c", { ...fields, color: "blue" }))),
      ).toBe(true);
    }
    const task = applied(EMPTY_ROOM_BOARD, put("t", { kind: "task" }));
    expect(Result.isFailure(apply(task, put("t", { color: "blue" })))).toBe(true);
  });

  it("toggles each person's own reaction on a card, within a cap, and never on a pin", () => {
    const board: RoomBoard = {
      positions: {},
      notes: [
        { id: "n", text: "Hi", x: 0, y: 0 },
        { id: "c", text: "Why?", x: 0, y: 0, kind: "comment" },
      ],
    };
    const react = (emoji: "👍" | "🎉"): RoomBoardChange => ({
      type: "note.react",
      noteId: "n",
      emoji,
    });
    const reacted = (from: RoomBoard, emoji: "👍" | "🎉", by: GuestId | null) =>
      Result.getOrThrow(applyRoomBoardChange(from, scope, by, react(emoji), at));
    const rows: ReadonlyArray<
      readonly [string, RoomBoard, "👍" | "🎉", GuestId | null, RoomBoardNote["reactions"]]
    > = [
      ["Sam adds one", board, "👍", sam, [{ emoji: "👍", guestId: sam }]],
      [
        "the owner adds the same, as their own",
        reacted(board, "👍", sam),
        "👍",
        null,
        [{ emoji: "👍", guestId: sam }, { emoji: "👍" }],
      ],
      [
        "Sam adds another",
        reacted(board, "👍", sam),
        "🎉",
        sam,
        [
          { emoji: "👍", guestId: sam },
          { emoji: "🎉", guestId: sam },
        ],
      ],
      ["Sam takes theirs back", reacted(board, "👍", sam), "👍", sam, undefined],
      [
        "Sam's again leaves the owner's",
        reacted(reacted(board, "👍", null), "👍", sam),
        "👍",
        sam,
        [{ emoji: "👍" }],
      ],
    ];
    for (const [, from, emoji, by, reactions] of rows) {
      expect(reacted(from, emoji, by).notes[0]?.reactions).toEqual(reactions);
    }
    expect(Result.isFailure(apply(board, { type: "note.react", noteId: "c", emoji: "👍" }))).toBe(
      true,
    );
    expect(
      Result.isFailure(apply(board, { type: "note.react", noteId: "gone", emoji: "👍" })),
    ).toBe(true);
    const full: RoomBoard = {
      ...board,
      notes: [
        {
          ...board.notes[0]!,
          reactions: Array.from({ length: ROOM_BOARD_MAX_REACTIONS }, () => ({ emoji: "👀" })),
        },
      ],
    };
    expect(Result.isFailure(apply(full, react("👍")))).toBe(true);
    // Editing a card keeps its reactions.
    const kept = applied(reacted(board, "👍", sam), put("n", { text: "Hello" }));
    expect(kept.notes[0]?.reactions).toEqual([{ emoji: "👍", guestId: sam }]);
  });

  it("keeps the quote a comment was added with, and takes none on any other note", () => {
    const board = applied(
      applied(EMPTY_ROOM_BOARD, put("c", { pinnedTo: "message:1", quote: "It expires early." })),
      put("plain", { quote: "Not a comment." }),
    );
    expect(board.notes.map((note) => note.quote)).toEqual(["It expires early.", undefined]);
    const edited = applied(board, put("c", { text: "Why?", quote: "Something else" }));
    expect(edited.notes[0]?.quote).toBe("It expires early.");
  });

  it("holds a few artifacts, whose content no change sets or clears", () => {
    let board = EMPTY_ROOM_BOARD;
    for (let index = 0; index < ROOM_BOARD_MAX_ARTIFACTS; index++) {
      board = applied(board, put(`a${index}`, { kind: "artifact", text: `Page ${index}` }));
    }
    expect(Result.isFailure(apply(board, put("over", { kind: "artifact" })))).toBe(true);
    const artifact = {
      body: "# Plan",
      turnId: "run:1",
      updatedAt: "2026-11-12T00:00:00.000Z",
    };
    const filled: RoomBoard = {
      ...board,
      notes: board.notes.map((note) => (note.id === "a0" ? { ...note, artifact } : note)),
    };
    const renamed = applied(filled, put("a0", { text: "The plan" }));
    expect(renamed.notes[0]).toMatchObject({ text: "The plan", kind: "artifact", artifact });
    const added = applied(filled, put("a6", { text: "Other" }));
    expect(added.notes.at(-1)?.artifact).toBeUndefined();
  });

  it("holds a few thread boxes, whose turns no change sets or clears, and drops their arrows", () => {
    let board = EMPTY_ROOM_BOARD;
    for (let index = 0; index < ROOM_BOARD_MAX_THREADS; index++) {
      board = applied(board, put(`t${index}`, { kind: "thread", text: `Box ${index}` }));
    }
    expect(Result.isFailure(apply(board, put("over", { kind: "thread" })))).toBe(true);
    expect(board.notes[0]).toMatchObject({ kind: "thread", guestId: sam });
    const thread = {
      turns: [{ id: "run:1", prompt: "Go", reply: "Done", at: "2026-11-12T00:00:00.000Z" }],
    };
    const ran: RoomBoard = {
      ...board,
      notes: board.notes.map((note) => (note.id === "t0" ? { ...note, thread } : note)),
      edges: [{ id: "into", from: "note:t1", to: "note:t0" }],
    };
    expect(applied(ran, put("t0", { text: "Renamed" })).notes[0]).toMatchObject({
      text: "Renamed",
      kind: "thread",
      thread,
    });
    // A box is no task: it is never done or assigned.
    expect(Result.isFailure(apply(ran, put("t0", { done: true })))).toBe(true);
    const removed = applied(ran, { type: "note.remove", noteId: "t0" });
    expect(removed.edges).toEqual([]);
  });

  it("lets only a card's person, or the owner, remove it or rename a thread box", () => {
    const eve = GuestId.make("guest:eve");
    const board: RoomBoard = {
      positions: {},
      notes: [
        { id: "sams", text: "Sam's", x: 0, y: 0, guestId: sam },
        { id: "owners", text: "Owner's", x: 0, y: 0, kind: "task" },
        { id: "box", text: "Box", x: 0, y: 0, kind: "thread", guestId: sam },
      ],
    };
    const remove = (noteId: string): RoomBoardChange => ({ type: "note.remove", noteId });
    const rows: ReadonlyArray<readonly [RoomBoardChange, typeof sam | null, boolean]> = [
      [remove("sams"), sam, true],
      [remove("sams"), null, true],
      [remove("sams"), eve, false],
      [remove("owners"), eve, false],
      [remove("box"), eve, false],
      [put("box", { text: "Renamed" }), sam, true],
      [put("box", { text: "Renamed" }), null, true],
      [put("box", { text: "Renamed" }), eve, false],
      // Anyone moves or sizes any card, edits a note or a task, and ticks or assigns a task.
      [put("box", { text: "Box", x: 40, y: 40, size: { w: 400, h: 300 } }), eve, true],
      [put("sams", { text: "Edited" }), eve, true],
      [put("owners", { text: "Owner's", done: true, assignee: { guestId: sam } }), eve, true],
      [{ type: "edge.put", edgeId: "e", from: "note:sams", to: "note:box" }, eve, true],
    ];
    for (const [change, person, allowed] of rows) {
      expect(Result.isSuccess(applyRoomBoardChange(board, scope, person, change, at))).toBe(
        allowed,
      );
    }
  });

  it("keeps a comment thread's replies, signed and timed by the board, for the room to resolve", () => {
    const eve = GuestId.make("guest:eve");
    const later = "2026-11-13T10:05:00.000Z";
    // A board stored before comment threads had replies decodes as it did.
    const board = decodeBoard({
      positions: {},
      notes: [
        { id: "c", text: "Is this right?", x: 0, y: 0, guestId: sam, kind: "comment" },
        { id: "note", text: "Hi", x: 0, y: 0 },
        { id: "pinned", text: "Why?", x: 0, y: 0, pinnedTo: "message:1" },
      ],
    });
    const reply = (replyId: string, text = "Yes", noteId = "c"): RoomBoardChange => ({
      type: "comment.reply",
      noteId,
      replyId,
      text,
    });
    const unreply = (replyId: string): RoomBoardChange => ({
      type: "comment.reply.remove",
      noteId: "c",
      replyId,
    });
    const resolve = (resolved: boolean, noteId = "c"): RoomBoardChange => ({
      type: "comment.resolve",
      noteId,
      resolved,
    });
    const byEve = Result.getOrThrow(
      applyRoomBoardChange(board, scope, eve, reply("r1", " Yes "), at),
    );
    const both = Result.getOrThrow(
      applyRoomBoardChange(byEve, scope, null, reply("r2", "Agreed"), later),
    );
    expect(both.notes[0]?.replies).toEqual([
      { id: "r1", text: "Yes", guestId: eve, at },
      { id: "r2", text: "Agreed", at: later },
    ]);
    expect(
      Result.getOrThrow(applyRoomBoardChange(both, scope, eve, reply("r1", "Again"), later)),
    ).toBe(both);
    // Only the owner's server writes an agent's reply: a client's change that claims one is a
    // plain reply of its sender.
    const claimed = { ...reply("r9"), agent: { turnId: "run:9", boxId: "thread" } };
    expect(applied(both, claimed as RoomBoardChange).notes[0]?.replies?.at(-1)).toEqual({
      id: "r9",
      text: "Yes",
      guestId: sam,
      at,
    });
    // Nor can a client take the id an agent's answer will have, which would keep it out.
    expect(Result.isFailure(applyRoomBoardChange(both, scope, sam, reply("agent:run:9"), at))).toBe(
      true,
    );
    // Agents' answers, by whose agent: Eve's, and the owner's.
    const answered: RoomBoard = {
      ...both,
      notes: both.notes.map((note) =>
        note.id === "c"
          ? {
              ...note,
              replies: [
                ...(note.replies ?? []),
                { id: "a1", text: "Done.", guestId: eve, at, agent: { turnId: "t1", boxId: "b" } },
                { id: "a2", text: "Yes.", at, agent: { turnId: "t2", boxId: "thread" } },
              ],
            }
          : note,
      ),
    };
    const agentRows: ReadonlyArray<readonly [string, typeof sam | null, boolean]> = [
      ["a1", eve, true],
      ["a1", null, true],
      ["a1", sam, false],
      ["a2", null, true],
      ["a2", eve, false],
    ];
    for (const [replyId, person, allowed] of agentRows) {
      expect(
        Result.isSuccess(applyRoomBoardChange(answered, scope, person, unreply(replyId), at)),
      ).toBe(allowed);
    }

    const rows: ReadonlyArray<readonly [RoomBoardChange, typeof sam | null, boolean]> = [
      [reply("r3"), sam, true],
      [reply("r3", "   "), sam, false],
      [reply("r3", "Yes", "note"), sam, false],
      [reply("r3", "Yes", "pinned"), sam, false],
      [reply("r3", "Yes", "gone"), sam, false],
      // A reply goes with its author or the owner, not with whoever started the thread.
      [unreply("r1"), eve, true],
      [unreply("r1"), null, true],
      [unreply("r1"), sam, false],
      [unreply("r2"), eve, false],
      [resolve(true), eve, true],
      [resolve(true, "note"), eve, false],
      // The first comment is its author's to edit; anyone moves the pin.
      [put("c", { text: "Edited" }), eve, false],
      [put("c", { text: "Edited" }), sam, true],
      [put("c", { text: "Is this right?", x: 40, y: 40 }), eve, true],
      [{ type: "note.remove", noteId: "c" }, eve, false],
      [{ type: "note.remove", noteId: "c" }, sam, true],
    ];
    for (const [change, person, allowed] of rows) {
      expect(Result.isSuccess(applyRoomBoardChange(both, scope, person, change, at))).toBe(allowed);
    }

    const moved = applied(both, put("c", { text: "Is this right?", x: 40, y: 40 }));
    expect(moved.notes[0]?.replies).toHaveLength(2);
    const removed = Result.getOrThrow(applyRoomBoardChange(both, scope, eve, unreply("r1"), at));
    expect(removed.notes[0]?.replies).toEqual([{ id: "r2", text: "Agreed", at: later }]);
    expect(applied(both, unreply("gone"))).toBe(both);

    const resolved = applied(both, resolve(true));
    expect(resolved.notes[0]).toMatchObject({ resolved: true });
    expect(applied(resolved, resolve(true))).toBe(resolved);
    const reopened = applied(resolved, resolve(false));
    expect(reopened.notes[0]).toStrictEqual(both.notes[0]);

    // A new thread is timed by the board too.
    expect(applied(EMPTY_ROOM_BOARD, put("new", { kind: "comment", text: "Hi" })).notes[0]).toEqual(
      {
        id: "new",
        text: "Hi",
        x: 0,
        y: 0,
        guestId: sam,
        kind: "comment",
        createdAt: at,
      },
    );

    let full = both;
    for (let index = 2; index < ROOM_BOARD_MAX_REPLIES; index++) {
      full = applied(full, reply(`more-${index}`));
    }
    expect(full.notes[0]?.replies).toHaveLength(ROOM_BOARD_MAX_REPLIES);
    expect(apply(full, reply("over"))).toStrictEqual(Result.fail(ROOM_COMMENT_THREAD_FULL));
  });

  it("swaps an artifact with the version it replaced, and back, for the people behind it", () => {
    const first = { body: "# One", turnId: "run:1", updatedAt: "2026-11-12T00:00:00.000Z" };
    const second = roomArtifactAfterFill(roomArtifactAfterFill(undefined, first), {
      body: "# Two",
      guestId: sam,
      turnId: "run:2",
      updatedAt: "2026-11-12T00:01:00.000Z",
    });
    // Only one step is kept: the version replaced loses its own earlier one.
    const third = roomArtifactAfterFill(second, { ...first, body: "# Three", turnId: "run:3" });
    const { previous: _first, ...secondAlone } = second;
    expect(third.previous).toStrictEqual(secondAlone);
    const board: RoomBoard = {
      positions: {},
      notes: [
        { id: "a", text: "Plan", x: 0, y: 0, kind: "artifact", artifact: second },
        { id: "empty", text: "Empty", x: 0, y: 0, kind: "artifact" },
        { id: "note", text: "Note", x: 0, y: 0 },
      ],
    };
    const restore = (noteId: string): RoomBoardChange => ({ type: "artifact.restore", noteId });
    const restored = Result.getOrThrow(applyRoomBoardChange(board, scope, null, restore("a"), at));
    expect(restored.notes[0]?.artifact).toStrictEqual({ ...first, previous: secondAlone });
    // Restoring again undoes the restore.
    expect(applied(restored, restore("a")).notes[0]?.artifact).toEqual(second);
    // No earlier version, not an artifact, or no such card: nothing happens.
    for (const noteId of ["empty", "note", "gone"]) {
      expect(applied(board, restore(noteId))).toBe(board);
    }
    // The owner, whoever added the card, and whoever asked for or wrote either version.
    const eve = GuestId.make("guest:eve");
    const ada = GuestId.make("guest:ada");
    const cardOf = (fields: Partial<RoomBoardNote>): RoomBoard => ({
      positions: {},
      notes: [{ id: "a", text: "Plan", x: 0, y: 0, kind: "artifact", ...fields }],
    });
    const byOwner = roomArtifactAfterFill(first, { ...first, body: "# Two", turnId: "run:2" });
    const rows: ReadonlyArray<readonly [RoomBoard, typeof sam | null, boolean]> = [
      [cardOf({ artifact: byOwner }), null, true],
      [cardOf({ artifact: byOwner }), eve, false],
      [cardOf({ artifact: byOwner, guestId: eve }), eve, true],
      [cardOf({ artifact: { ...byOwner, askedBy: eve } }), eve, true],
      [cardOf({ artifact: second }), sam, true],
      [cardOf({ artifact: second }), eve, false],
      [cardOf({ artifact: { ...byOwner, previous: { ...first, askedBy: ada } } }), ada, true],
      [cardOf({ artifact: { ...byOwner, previous: { ...first, guestId: ada } } }), ada, true],
    ];
    for (const [shared, person, allowed] of rows) {
      expect(canRestoreRoomArtifact(shared.notes[0]!, person)).toBe(allowed);
      expect(Result.isSuccess(applyRoomBoardChange(shared, scope, person, restore("a"), at))).toBe(
        allowed,
      );
    }
  });
});

describe("roomArtifactRequestOf", () => {
  const shareId = GuestShareId.make("share:mine");
  const record = (share: string) => ({
    version: 1,
    contextId: "room-artifact_1",
    kind: "room-artifact",
    label: 'Artifact "Plan"',
    shareId: share,
    noteId: "note:plan",
    title: "Plan",
  });
  const message = (context: object) =>
    ({ type: "user_message", text: "Draw it", context }) as unknown as OrchestrationV2TurnItem;

  it("finds the card a message of this share asked for, and the guest message it was", () => {
    expect(roomArtifactRequestOf([message({ records: [record(shareId)] })], shareId)).toEqual({
      noteId: "note:plan",
    });
    const guest = { guestMessageId: "guest-message:1", name: "Sam", text: "Draw it" };
    expect(
      roomArtifactRequestOf([message({ guest, records: [record(shareId)] })], shareId),
    ).toEqual({ noteId: "note:plan", guestMessageId: "guest-message:1" });
    // Another share's card, or none, is no request here.
    expect(roomArtifactRequestOf([message({ records: [record("share:old")] })], shareId)).toBe(
      undefined,
    );
    expect(roomArtifactRequestOf([message({ records: [] })], shareId)).toBeUndefined();
    expect(
      roomArtifactRequestOf(
        [message({ records: [{ ...record(shareId), boxId: "box:1" }] })],
        shareId,
      ),
    ).toEqual({ noteId: "note:plan", boxId: "box:1" });
    // The comment thread a message asked its agent to answer, of this share only.
    const comment = (share: string) => ({
      version: 1,
      contextId: "room-comment_1",
      kind: "room-comment",
      label: "Reply in the comment thread",
      shareId: share,
      noteId: "note:ask",
    });
    const asked = [message({ records: [record(shareId), comment(shareId)] })];
    expect(roomCommentRequestOf(asked, shareId)).toBe("note:ask");
    expect(roomCommentRequestOf([message({ records: [comment("share:old")] })], shareId)).toBe(
      undefined,
    );
    expect(roomCommentRequestOf([message({ records: [record(shareId)] })], shareId)).toBe(
      undefined,
    );
  });

  it("finds the thread box the owner's server marked a message for, and nothing else", () => {
    const box = (payload: object) => ({
      version: 1,
      contextId: "room-box_1",
      kind: "room-box",
      label: "Thread box",
      payload,
    });
    expect(roomBoxRequestOf([message({ records: [box({ shareId, boxId: "box:1" })] })])).toEqual({
      shareId,
      boxId: "box:1",
    });
    expect(roomBoxRequestOf([message({ records: [box({ shareId })] })])).toBeUndefined();
    expect(roomBoxRequestOf([message({ records: [record(shareId)] })])).toBeUndefined();
  });
});

describe("roomBoardCardIdentity", () => {
  const sam = GuestId.make("guest:sam");
  const names = (guestId: GuestId | undefined) => (guestId === sam ? "Sam" : undefined);
  const note = (fields: Partial<RoomBoardNote>): RoomBoardNote => ({
    id: "n",
    text: "Plan",
    x: 0,
    y: 0,
    ...fields,
  });

  it("names a card and its author from the board, the same for everyone", () => {
    expect(roomBoardCardIdentity(note({ guestId: sam }), names)).toEqual({
      label: "Note from Sam",
      author: "guest",
      name: "Sam",
    });
    expect(roomBoardCardIdentity(note({ kind: "task" }), names)).toEqual({
      label: "Task from the owner",
      author: "owner",
    });
    expect(roomBoardCardIdentity(note({ pinnedTo: "message:1" }), () => "Will").label).toBe(
      "Comment from Will on a reply",
    );
    // The owner by the name they show guests, which their cards carry too.
    expect(roomBoardCardIdentity(note({ kind: "comment" }), () => "Alex")).toEqual({
      label: "Comment thread from Alex",
      author: "owner",
      name: "Alex",
    });
    expect(roomBoardCardIdentity(note({ kind: "comment", guestId: sam }), names)).toEqual({
      label: "Comment thread from Sam",
      author: "guest",
      name: "Sam",
    });
    // An artifact's content is its last writer's agent's, whoever added the card.
    const filled = note({
      kind: "artifact",
      artifact: {
        body: "# Plan",
        guestId: sam,
        turnId: "run:1",
        updatedAt: "2026-11-12T00:00:00Z",
      },
    });
    expect(roomBoardCardIdentity(filled, names)).toEqual({
      label: 'Artifact "Plan"',
      author: "guest_agent",
      name: "Sam",
    });
  });
});

describe("roomBoxExcerpt", () => {
  it("reads a markdown reply, or the one line it was cut to, as plain prose", () => {
    const table = "| File | Change |\n| --- | :---: |\n| a.ts | fixed |\n| b.ts | added |";
    const rows: ReadonlyArray<readonly [string, string]> = [
      ["## Done\n\nAll **three** fixed in `a.ts`.", "Done All three fixed in a.ts."],
      ["  ### Plan\n> Quoted\n---\nSee [the docs](https://x.dev/a).", "Plan Quoted See the docs."],
      [
        `Summary:\n\n${table}\n\nThat's it.`,
        "Summary: File · Change · a.ts · fixed · b.ts · added · That's it.",
      ],
      // The live preview arrives already on one line.
      [
        `## Done ${table.replace(/\n/g, " ")}`,
        "Done · File · Change · a.ts · fixed · b.ts · added",
      ],
      ["```ts\nconst a = 1;\n```", "const a = 1;"],
      // Prose that only looks like markdown is left alone.
      ["Issue #12 in C# - a 1-2 fix", "Issue #12 in C# - a 1-2 fix"],
    ];
    for (const [text, plain] of rows) expect(roomBoxExcerpt(text, 600)).toBe(plain);
    expect(roomBoxExcerpt("## Done\nAll fixed", 8)).toBe("Done Al…");
  });
});

describe("roomCommentAnswer", () => {
  const max = ROOM_COMMENT_AGENT_REPLY_MAX_LENGTH;

  it("keeps an agent's markdown, without hidden characters, cut at a line or a word", () => {
    expect(roomCommentAnswer("  Done.\r\n\n- **one**​\n- two\n")).toBe("Done.\n\n- **one**\n- two");
    const first = "a".repeat(max - 200);
    const atLine = roomCommentAnswer(`${first}\n${"b".repeat(300)}`);
    expect(atLine).toBe(`${first}…`);
    const words = roomCommentAnswer(`intro\n${"word ".repeat(400)}`);
    expect(words.endsWith(" word…")).toBe(true);
    expect(words.length).toBeLessThanOrEqual(max);
  });

  it("closes a code block the cut leaves open", () => {
    const answer = roomCommentAnswer(`Here:\n\`\`\`ts\n${"const a = 1;\n".repeat(200)}\`\`\``);
    expect(answer.endsWith("…\n```")).toBe(true);
    expect(answer.length).toBeLessThanOrEqual(max);
  });
});

describe("roomArtifactBody", () => {
  const page = "<!DOCTYPE html>\n<html><body>Hi</body></html>";

  it("takes the first whole page from an html block, and anything else as markdown", () => {
    expect(roomArtifactBody(`Here it is:\n\n\`\`\`html\n${page}\n\`\`\`\n\nEnjoy.`)).toEqual({
      body: page,
      truncated: false,
    });
    expect(roomArtifactBody("~~~~ HTML\n<html lang=en></html>\n~~~~").body).toBe(
      "<html lang=en></html>",
    );
    // A fragment stays markdown with its code, and a later block may still hold the page.
    const fragment = "```html\n<div>Hi</div>\n```";
    expect(roomArtifactBody(`${fragment}\n`).body).toBe(fragment);
    expect(roomArtifactBody(`${fragment}\n\n\`\`\`html\n${page}\n\`\`\``).body).toBe(page);
    expect(roomArtifactBody("  # Plan\n\n- one\n").body).toBe("# Plan\n\n- one");
    // A reply that is a page already is kept as it is.
    expect(roomArtifactBody(`${page}\n`).body).toBe(page);
  });

  it("cuts a body longer than the board keeps", () => {
    const long = roomArtifactBody(`${"a".repeat(ROOM_ARTIFACT_MAX_LENGTH - 1)}😀 and more`);
    expect(long.truncated).toBe(true);
    expect(long.body).toBe("a".repeat(ROOM_ARTIFACT_MAX_LENGTH - 1));
  });
});
