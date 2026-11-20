import {
  CLOUD_BOARD_ACCOUNT_MAX_BOARDS,
  GuestId,
  GuestShareId,
  ThreadId,
  type CloudBoardAccountBoard,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import {
  accountsOn,
  linkAccount,
  outlineFor,
  retitledAccountBoard,
  withAccountBoard,
  withAccountSession,
  withoutAccountBoard,
} from "./account.ts";
import { machineGuestOf } from "./machines.ts";
import {
  createRoom,
  guestBySession,
  joinRoom,
  removePerson,
  viewFor,
  type CloudRoom,
} from "./room.ts";

const NOW = "2026-11-17T10:00:00.000Z";
const maker = GuestId.make("guest-maker");

const boardWithTwo = (): CloudRoom =>
  Result.getOrThrow(
    joinRoom(
      createRoom({
        shareId: GuestShareId.make("share-one-0000"),
        threadId: ThreadId.make("board-share-one-0000"),
        title: "Plans",
        inviteHash: "invite-hash",
        maker: { id: maker, name: "Ada", sessionHash: "maker-session" },
        now: NOW,
      }),
      {
        id: GuestId.make("guest-two"),
        name: "Grace",
        sessionHash: "two-session",
        inviteHash: "invite-hash",
        now: NOW,
      },
    ),
  );

const link = (room: CloudRoom, account: string, sessionHash: string, credentialHash?: string) =>
  linkAccount(room, {
    account,
    sessionHash,
    ...(credentialHash === undefined
      ? {}
      : { credential: { value: "share-one-0000.invite", hash: credentialHash } }),
    now: NOW,
  });

describe("accounts on a cloud board", () => {
  it("ties an account only to the seat a session opens, once", () => {
    const linked = Result.getOrThrow(link(boardWithTwo(), "user_ada", "maker-session"));
    expect(linked.board).toEqual({
      shareId: "share-one-0000",
      threadId: "board-share-one-0000",
      title: "Plans",
      guestId: maker,
      maker: true,
      addedAt: NOW,
    });
    expect(accountsOn(linked.room)).toEqual(["user_ada"]);
    // Again from the same seat changes nothing.
    expect(Result.getOrThrow(link(linked.room, "user_ada", "maker-session")).room).toBe(
      linked.room,
    );
    // The account is never shown to anyone on the board.
    expect(JSON.stringify(viewFor(linked.room, linked.room.guests[1]!))).not.toContain("user_ada");
  });

  it("refuses a session that opens nothing and another account's seat", () => {
    const room = Result.getOrThrow(link(boardWithTwo(), "user_ada", "maker-session")).room;
    expect(Result.isFailure(link(room, "user_ada", "guessed-session"))).toBe(true);
    const taken = link(room, "user_eve", "maker-session");
    expect(Result.isFailure(taken) && taken.failure.reason).toBe("taken");
    // Nor does an account fold another account's seat into its own.
    const both = Result.getOrThrow(link(room, "user_grace", "two-session")).room;
    const stolen = link(both, "user_ada", "two-session");
    expect(Result.isFailure(stolen) && stolen.failure.reason).toBe("taken");
    expect(both.guests).toHaveLength(2);
  });

  it("folds a seat joined signed out into the account's own, so one account is one person", () => {
    const two = GuestId.make("guest-two");
    const note = (id: string, guestId: GuestId, text: string) => ({
      id,
      text,
      x: 0,
      y: 0,
      guestId,
      reactions: [
        { emoji: "👀" as const, guestId: maker },
        { emoji: "👀" as const, guestId: two },
      ],
    });
    const room: CloudRoom = {
      ...Result.getOrThrow(link(boardWithTwo(), "user_ada", "maker-session")).room,
      board: {
        positions: { [`guest:${two}`]: { x: 5, y: 5 }, [`guest:${maker}`]: { x: 1, y: 1 } },
        // A card whose text is the id itself is still only text.
        notes: [note("note-a", two, two), note("note-b", maker, "Hers already")],
        edges: [{ id: "edge-1", from: `card:guest:${two}`, to: "note:note-b" }],
      },
      turns: [],
      machines: [{ guestId: two, hash: "machine-hash", kind: "room" }],
    };
    // The same person, signed out in a second browser, now signs in there.
    const folded = Result.getOrThrow(link(room, "user_ada", "two-session"));
    expect(folded.merged).toEqual({ from: two, into: maker });
    expect(folded.board).toMatchObject({ guestId: maker, maker: true });
    expect(folded.room.guests.map((guest) => guest.id)).toEqual([maker]);
    expect(viewFor(folded.room, folded.room.guests[0]!).guests).toHaveLength(1);
    // That browser's session, and their machine, are the account's person from here on.
    expect(guestBySession(folded.room, "two-session")?.id).toBe(maker);
    expect(machineGuestOf(folded.room, "machine-hash", "room", Date.parse(NOW))?.id).toBe(maker);
    // What they added stays theirs, once.
    expect(folded.room.board?.notes.map((kept) => [kept.guestId, kept.text])).toEqual([
      [maker, two],
      [maker, "Hers already"],
    ]);
    expect(folded.room.board?.notes[0]?.reactions).toEqual([{ emoji: "👀", guestId: maker }]);
    expect(folded.room.board?.positions).toEqual({ [`guest:${maker}`]: { x: 1, y: 1 } });
    expect(folded.room.board?.edges?.[0]?.from).toBe(`card:guest:${maker}`);
    expect(JSON.stringify({ ...folded.room.board, notes: [] })).not.toContain(two);
    // Claiming again from either browser changes nothing more.
    const again = Result.getOrThrow(link(folded.room, "user_ada", "two-session"));
    expect(again.room).toBe(folded.room);
    expect(again.merged).toBeUndefined();
  });

  it("keeps a board its maker made signed out theirs once they sign in as someone on it", () => {
    const room = Result.getOrThrow(link(boardWithTwo(), "user_grace", "two-session")).room;
    const folded = Result.getOrThrow(link(room, "user_grace", "maker-session"));
    expect(folded.room.maker).toBe("guest-two");
    expect(folded.board).toMatchObject({ guestId: "guest-two", maker: true });
    expect(folded.room.guests.map((guest) => guest.name)).toEqual(["Grace"]);
  });

  it("keeps the invite only when it is the board's", () => {
    expect(
      Result.getOrThrow(link(boardWithTwo(), "user_grace", "two-session", "invite-hash")).board,
    ).toMatchObject({ guestId: "guest-two", maker: false, credential: "share-one-0000.invite" });
    expect(
      Result.getOrThrow(link(boardWithTwo(), "user_grace", "two-session", "other-hash")).board,
    ).not.toHaveProperty("credential");
  });

  it("opens the same person on another device, and only the board's own routes", () => {
    const room = Result.getOrThrow(link(boardWithTwo(), "user_grace", "two-session")).room;
    const opened = Result.getOrThrow(withAccountSession(room, "user_grace", "device-two"));
    expect(guestBySession(opened.room, "device-two")?.id).toBe("guest-two");
    expect(machineGuestOf(opened.room, "device-two", "room", Date.parse(NOW))).toBeUndefined();
    expect(machineGuestOf(opened.room, "device-two", "handoff", Date.parse(NOW))).toBeUndefined();
    // An account not on the board gets nothing, nor one that was never linked.
    expect(Result.isFailure(withAccountSession(room, "user_eve", "device-three"))).toBe(true);
    expect(Result.isFailure(withAccountSession(boardWithTwo(), "user_grace", "x"))).toBe(true);
  });

  it("names what is on the board only to whoever could open it with no invite", () => {
    const linked = Result.getOrThrow(link(boardWithTwo(), "user_grace", "two-session")).room;
    const room: CloudRoom = {
      ...linked,
      workspaceId: "ws-one-0000",
      board: {
        positions: {},
        notes: [
          { id: "n1", text: "Secret plan", x: 0, y: 0 },
          { id: "a1", text: "Pricing page", x: 0, y: 0, kind: "artifact" },
        ],
      },
    };
    const outline = { items: [{ id: "a1", kind: "artifact", name: "Pricing page" }] };
    expect(outlineFor(room, { account: "user_grace" })).toEqual(outline);
    expect(outlineFor(room, { workspaceId: "ws-one-0000" })).toEqual(outline);
    // Not an account on it, not the workspace it is in, taken out of it, or a board that ended.
    expect(outlineFor(room, { account: "user_eve" })).toBeNull();
    expect(outlineFor(room, { workspaceId: "ws-two-0000" })).toBeNull();
    expect(outlineFor(linked, { workspaceId: "ws-one-0000" })).toBeNull();
    const locked = room.guests.map((guest) =>
      guest.accountId === "user_grace" ? { ...guest, locked: true as const } : guest,
    );
    expect(outlineFor({ ...room, guests: locked }, { account: "user_grace" })).toBeNull();
    expect(outlineFor(null, { account: "user_grace" })).toBeNull();
  });

  it("keeps the newest few device sessions", () => {
    let room = Result.getOrThrow(link(boardWithTwo(), "user_ada", "maker-session")).room;
    for (let device = 0; device < 10; device++) {
      room = Result.getOrThrow(withAccountSession(room, "user_ada", `device-${device}`)).room;
    }
    expect(room.guests[0]!.accountSessions).toHaveLength(8);
    expect(guestBySession(room, "device-0")).toBeUndefined();
    expect(guestBySession(room, "device-9")?.id).toBe(maker);
    expect(guestBySession(room, "maker-session")?.id).toBe(maker);
  });

  it("forgets the account with the person when they leave or are removed", () => {
    const room = Result.getOrThrow(link(boardWithTwo(), "user_grace", "two-session")).room;
    const left = Result.getOrThrow(removePerson(room, maker, GuestId.make("guest-two"), NOW));
    expect(accountsOn(left)).toEqual([]);
    expect(Result.isFailure(withAccountSession(left, "user_grace", "device"))).toBe(true);
  });
});

const listed = (shareId: string, addedAt: string, extra: Partial<CloudBoardAccountBoard> = {}) =>
  ({
    shareId: GuestShareId.make(shareId),
    threadId: ThreadId.make(`board-${shareId}`),
    title: "Board",
    guestId: maker,
    maker: true,
    addedAt,
    ...extra,
  }) satisfies CloudBoardAccountBoard;

describe("an account's list of boards", () => {
  it("lists a board once, keeping when it was added, its invite and its preview", () => {
    const first = withAccountBoard(
      [],
      listed("share-a-0000", NOW, { credential: "invite", preview: "1:n00000101y" }),
    );
    const again = withAccountBoard(
      first,
      listed("share-a-0000", "2026-11-18T00:00:00.000Z", { title: "Renamed" }),
    );
    expect(again).toEqual([
      listed("share-a-0000", NOW, {
        title: "Renamed",
        credential: "invite",
        preview: "1:n00000101y",
      }),
    ]);
  });

  it("drops the oldest added past the cap", () => {
    let boards: ReadonlyArray<CloudBoardAccountBoard> = [];
    for (let index = 0; index <= CLOUD_BOARD_ACCOUNT_MAX_BOARDS; index++) {
      const at = `2026-11-17T10:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`;
      boards = withAccountBoard(boards, listed(`share-${String(index).padStart(8, "0")}`, at));
    }
    expect(boards).toHaveLength(CLOUD_BOARD_ACCOUNT_MAX_BOARDS);
    expect(boards[0]!.shareId).toBe("share-00000001");
  });

  it("forgets and renames a board, and leaves the list alone when nothing changes", () => {
    const boards = [listed("share-a-0000", NOW), listed("share-b-0000", NOW)];
    expect(withoutAccountBoard(boards, "share-a-0000").map((board) => board.shareId)).toEqual([
      "share-b-0000",
    ]);
    expect(withoutAccountBoard(boards, "share-c-0000")).toBe(boards);
    expect(retitledAccountBoard(boards, "share-b-0000", "Roadmap")[1]!.title).toBe("Roadmap");
    expect(retitledAccountBoard(boards, "share-b-0000", "Board")).toBe(boards);
  });
});
