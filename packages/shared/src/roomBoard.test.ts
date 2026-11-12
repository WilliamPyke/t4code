import {
  GuestId,
  GuestShareId,
  type OrchestrationV2TurnItem,
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_THREADS,
  type RoomBoard,
  type RoomBoardChange,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_ROOM_BOARD,
  type RoomBoardScope,
  applyRoomBoardChange,
  roomArtifactAfterFill,
  roomArtifactBody,
  roomArtifactRequestOf,
  roomBoardWithCards,
  roomBoxRequestOf,
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

describe("applyRoomBoardChange", () => {
  const scope: RoomBoardScope = { hasCard: (cardId) => cardId === "thread", hasPerson: () => true };
  const sam = GuestId.make("guest:sam");
  const apply = (board: RoomBoard, change: RoomBoardChange) =>
    applyRoomBoardChange(board, scope, sam, change);
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

  it("swaps an artifact with the version it replaced, and back, for anyone", () => {
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
    const restored = Result.getOrThrow(applyRoomBoardChange(board, scope, null, restore("a")));
    expect(restored.notes[0]?.artifact).toStrictEqual({ ...first, previous: secondAlone });
    // Restoring again undoes the restore.
    expect(applied(restored, restore("a")).notes[0]?.artifact).toEqual(second);
    // No earlier version, not an artifact, or no such card: nothing happens.
    for (const noteId of ["empty", "note", "gone"]) {
      expect(applied(board, restore(noteId))).toBe(board);
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
