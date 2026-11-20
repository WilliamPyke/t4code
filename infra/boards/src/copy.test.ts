import { GuestId, GuestShareId, ThreadId, type RoomBoard } from "@t3tools/contracts";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  BOARD_MAKING_LIMIT,
  BOARD_MAKING_WINDOW_MS,
  copiedBoard,
  copyRefusal,
  copyTitle,
  takeBoardMaking,
} from "./copy.ts";
import { createRoom, joinRoom, viewFor, withCopies, type CloudRoom } from "./room.ts";

const NOW = "2026-11-17T10:00:00.000Z";
const AT = "2026-11-17T11:00:00.000Z";
const maya = GuestId.make("guest-maya");
const sam = GuestId.make("guest-sam");
const copier = GuestId.make("guest-copier");

const board: RoomBoard = {
  positions: { [`guest:${sam}`]: { x: 5, y: 5 } },
  notes: [
    { id: "goals", text: "Goals", x: 0, y: 0, section: true, color: "yellow", guestId: maya },
    {
      id: "n",
      text: "Ship it @Sam",
      x: 20,
      y: 60,
      guestId: sam,
      color: "pink",
      reactions: [{ emoji: "👍", guestId: maya }],
      mentions: [{ guestId: sam, name: "Sam" }],
    },
    {
      id: "t",
      text: "Write the copy",
      x: 240,
      y: 60,
      kind: "task",
      guestId: maya,
      status: "doing",
      priority: "high",
      due: "2026-11-20",
      order: 2,
      assignee: { guestId: sam },
      answer: { guestId: sam, excerpt: "Drafted it.", turnId: "turn-1" },
      run: { boxId: "box", at: NOW },
    },
    { id: "l", text: "Spec", x: 0, y: 300, kind: "link", url: "https://example.com/spec" },
    {
      id: "a",
      text: "Welcome copy",
      x: 400,
      y: 0,
      kind: "artifact",
      guestId: maya,
      artifact: {
        body: "# Welcome",
        guestId: sam,
        turnId: "turn-2",
        updatedAt: NOW,
        prompt: "Write it from the hidden notes",
        cards: ["Secret note"],
        boxId: "box",
        previous: { body: "# Old", guestId: maya, byHand: true, turnId: "edit", updatedAt: NOW },
      },
    },
    {
      id: "box",
      text: "Copy helper",
      x: 800,
      y: 0,
      kind: "thread",
      guestId: sam,
      size: { w: 420, h: 360 },
      thread: {
        turns: [{ id: "turn-2", prompt: "Write it", reply: "Done.", at: NOW, guestId: sam }],
      },
    },
    {
      id: "c",
      text: "Before or after?",
      x: 0,
      y: 500,
      kind: "comment",
      guestId: sam,
      replies: [{ id: "r", text: "After", guestId: maya, at: NOW }],
    },
  ],
  edges: [
    { id: "n-t", from: "note:n", to: "note:t", sentAt: NOW, pinned: true },
    { id: "n-box", from: "note:n", to: "note:box" },
    { id: "c-t", from: "note:c", to: "note:t" },
    { id: "card-t", from: `card:guest:${sam}`, to: "note:t" },
  ],
  agentTurns: [{ id: "turn-3", boxId: "box", guestId: sam, at: NOW, cards: [] }],
  start: "goals",
};

function sample(): CloudRoom {
  const made = createRoom({
    shareId: GuestShareId.make("share-sample-00"),
    threadId: ThreadId.make("board-share-sample-00"),
    title: "Onboarding v2",
    inviteHash: "invite",
    maker: { id: maya, name: "Maya Chen", sessionHash: "maya" },
    now: NOW,
  });
  const joined = Result.getOrThrow(
    joinRoom(made, {
      id: sam,
      name: "Sam Okafor",
      sessionHash: "sam",
      inviteHash: "invite",
      now: NOW,
    }),
  );
  return {
    ...joined,
    board,
    requests: [{ id: "q", account: "acct", name: "Lee", at: NOW, status: "open" }],
  };
}

describe("copying a board", () => {
  it("is off until whoever made the board allows it, and then open to anyone who can see it", () => {
    const off = sample();
    const samSeat = off.guests[1];
    expect(copyRefusal(off, samSeat, false)?.reason).toBe("copies_off");
    expect(copyRefusal(off, undefined, true)?.reason).toBe("copies_off");
    expect(viewFor(off, null).copies).toBeUndefined();

    expect(Result.isFailure(withCopies(off, false, true, AT)), "only who manages it").toBe(true);
    const on = Result.getOrThrow(withCopies(off, true, true, AT));
    expect(viewFor(on, null).copies).toBe(true);
    expect(copyRefusal(on, undefined, true)).toBeNull();
    expect(copyRefusal(on, on.guests[1], false)).toBeNull();
    expect(copyRefusal(on, undefined, false)?.reason, "no seat, no view link").toBe("invalid");
    expect(copyRefusal(on, { ...on.guests[1]!, locked: true }, false)?.reason).toBe("invalid");
    expect(copyRefusal(null, undefined, true)?.reason).toBe("ended");
    expect(Result.getOrThrow(withCopies(on, true, true, AT))).toBe(on);
    expect("allowCopies" in Result.getOrThrow(withCopies(on, true, false, AT))).toBe(false);
  });

  it("copies what everyone sees as the copier's own, and nothing of anyone's agent or prompts", () => {
    const copy = copiedBoard(sample(), copier, AT);
    const mine = { guestId: copier, changed: { at: AT, guestId: copier } };
    expect(copy).toEqual({
      positions: {},
      notes: [
        { id: "goals", text: "Goals", x: 0, y: 0, section: true, color: "yellow", ...mine },
        { id: "n", text: "Ship it @Sam", x: 20, y: 60, color: "pink", ...mine },
        {
          id: "t",
          text: "Write the copy",
          x: 240,
          y: 60,
          kind: "task",
          status: "doing",
          priority: "high",
          due: "2026-11-20",
          order: 2,
          ...mine,
        },
        {
          id: "l",
          text: "Spec",
          x: 0,
          y: 300,
          kind: "link",
          url: "https://example.com/spec",
          ...mine,
        },
        {
          id: "a",
          text: "Welcome copy",
          x: 400,
          y: 0,
          kind: "artifact",
          artifact: {
            body: "# Welcome",
            guestId: copier,
            byHand: true,
            turnId: `copy:${AT}`,
            updatedAt: AT,
          },
          ...mine,
        },
        {
          id: "box",
          text: "Sam Okafor's agent worked here: Copy helper",
          x: 800,
          y: 0,
          size: { w: 420, h: 360 },
          color: "grey",
          ...mine,
        },
      ],
      edges: [
        { id: "n-t", from: "note:n", to: "note:t" },
        { id: "n-box", from: "note:n", to: "note:box" },
      ],
      start: "goals",
    });
    expect(JSON.stringify(copy)).not.toMatch(
      /hidden notes|Secret note|turn-|Drafted|After|guest-sam|guest-maya/,
    );
  });

  it("names the copy after the board, and counts it as a new board against the same limit", () => {
    expect(copyTitle("Onboarding v2")).toBe("Copy of Onboarding v2");
    expect(copyTitle(" ")).toBe("Copy of a board");
    expect(copyTitle("x".repeat(200))).toHaveLength(80);
    let made: ReadonlyArray<number> = [];
    for (let at = 0; at < BOARD_MAKING_LIMIT; at++) made = takeBoardMaking(made, at) ?? [];
    expect(made).toHaveLength(BOARD_MAKING_LIMIT);
    expect(takeBoardMaking(made, BOARD_MAKING_LIMIT)).toBeNull();
    // An hour after the first, there is room for one more.
    expect(takeBoardMaking(made, BOARD_MAKING_WINDOW_MS)).toHaveLength(BOARD_MAKING_LIMIT);
    // Another count keeps its own limit and window.
    const joins = { count: 2, windowMs: 1_000 };
    const twice = takeBoardMaking(takeBoardMaking([], 0, joins) ?? [], 1, joins) ?? [];
    expect(takeBoardMaking(twice, 2, joins)).toBeNull();
    expect(takeBoardMaking(twice, 1_000, joins)).toEqual([1, 1_000]);
  });
});
