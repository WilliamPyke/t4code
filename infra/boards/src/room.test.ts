import {
  GuestId,
  GuestShareId,
  GuestStreamEvent,
  ThreadId,
  type RoomBoardChange,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { machineGuestOf } from "./machines.ts";
import {
  CLOUD_BOARD_MAX_GUESTS,
  EMPTY_LIVE,
  IDLE_BOARD_MS,
  UNTOUCHED_BOARD_MS,
  boardAlarmAt,
  changeBoard,
  checkDelete,
  createRoom,
  cursorsEventFor,
  guestBySession,
  joinRoom,
  moveCursor,
  openingEvents,
  removePerson,
  renameRoom,
  sseFrame,
  viewFor,
  withoutPerson,
  type CloudRoom,
} from "./room.ts";
import { makeSecret, shareOfSecret } from "./secrets.ts";

const NOW = "2026-11-16T10:00:00.000Z";
const maker = GuestId.make("guest-maker");

const newRoom = (): CloudRoom =>
  createRoom({
    shareId: GuestShareId.make("share-one-0000"),
    threadId: ThreadId.make("board-share-one-0000"),
    title: undefined,
    inviteHash: "invite-hash",
    maker: { id: maker, name: "Ada", sessionHash: "maker-session" },
    now: NOW,
  });

const join = (room: CloudRoom, id: string, name = "Grace") =>
  joinRoom(room, {
    id: GuestId.make(id),
    name,
    sessionHash: `${id}-session`,
    inviteHash: "invite-hash",
    now: NOW,
  });

const notePut = (noteId: string, extra: Partial<RoomBoardChange> = {}) =>
  ({ type: "note.put", noteId, text: "Hello", x: 10, y: 20, ...extra }) as RoomBoardChange;

const decodeEvent = Schema.decodeUnknownSync(
  Schema.fromJsonString(Schema.toCodecJson(GuestStreamEvent)),
);
const frameData = (frame: string) => frame.replace(/^data: /, "").trimEnd();

describe("cloud room", () => {
  it("joins a second guest whose change shows in everyone's view", () => {
    const joined = Result.getOrThrow(join(newRoom(), "guest-two"));
    const second = guestBySession(joined, "guest-two-session");
    expect(second?.name).toBe("Grace");
    const changed = Result.getOrThrow(changeBoard(joined, second!.id, notePut("note-1"), NOW));
    const view = viewFor(changed, changed.guests[0]!);
    expect(view.board?.notes).toEqual([
      expect.objectContaining({ id: "note-1", text: "Hello", guestId: "guest-two" }),
    ]);
    expect(view.guests.map((guest) => guest.name)).toEqual(["Ada", "Grace"]);
    expect(view).not.toHaveProperty("guests.0.sessionHash");
    expect(view.cloud).toBe(true);
  });

  it("names a rejoining person apart, as a new guest", () => {
    const once = Result.getOrThrow(join(newRoom(), "guest-two", "Ada"));
    expect(once.guests.map((guest) => guest.name)).toEqual(["Ada", "Ada 2"]);
  });

  it.each([
    ["a code window", notePut("code", { kind: "code" } as Partial<RoomBoardChange>)],
    [
      "a pull request window",
      notePut("pr", { kind: "pull-request", url: "https://github.com/a/b/pull/1" } as never),
    ],
    ["a task for the owner", notePut("task", { kind: "task", assignee: {} } as never)],
  ])("refuses %s, which needs an owner", (_label, change) => {
    const refused = changeBoard(newRoom(), maker, change, NOW);
    expect(Result.isFailure(refused) && refused.failure).toMatchObject({
      status: 409,
      reason: "rejected",
    });
  });

  it("refuses what the board rules refuse, with their reason", () => {
    const room = Result.getOrThrow(changeBoard(newRoom(), maker, notePut("note-1"), NOW));
    const other = Result.getOrThrow(join(room, "guest-two"));
    const refused = changeBoard(
      other,
      GuestId.make("guest-two"),
      { type: "note.remove", noteId: "note-1" },
      NOW,
    );
    expect(Result.isFailure(refused) && refused.failure).toMatchObject({
      reason: "rejected",
      message: "Only the owner and whoever added this card can remove it.",
    });
  });

  it("refuses a wrong invite and an unknown or other board's token", () => {
    const room = newRoom();
    const wrong = joinRoom(room, {
      id: GuestId.make("x"),
      name: "Eve",
      sessionHash: "s",
      inviteHash: "not-the-invite",
      now: NOW,
    });
    expect(Result.isFailure(wrong) && wrong.failure).toMatchObject({
      status: 403,
      reason: "invalid",
    });
    expect(guestBySession(room, "someone-else")).toBeUndefined();
    expect(shareOfSecret(makeSecret("share-two-0000"))).toBe("share-two-0000");
    expect(shareOfSecret("no-dot-here")).toBeNull();
    expect(shareOfSecret(".secret")).toBeNull();
    expect(shareOfSecret("bad/share.secret")).toBeNull();
  });

  it("renames the board for everyone", () => {
    const renamed = renameRoom(newRoom(), "Launch plan", NOW);
    expect(viewFor(renamed, renamed.guests[0]!).title).toBe("Launch plan");
    expect(renameRoom(renamed, "Launch plan", NOW)).toBe(renamed);
  });

  it("lets in as many people as a cloud board holds", () => {
    let room = newRoom();
    for (let index = 1; index < CLOUD_BOARD_MAX_GUESTS; index++) {
      room = Result.getOrThrow(join(room, `guest-${index}`, `Guest ${index}`));
    }
    const over = join(room, "one-too-many");
    expect(Result.isFailure(over) && over.failure).toMatchObject({ status: 409, reason: "full" });
  });

  it("opens a stream with events a guest's client decodes", () => {
    const room = Result.getOrThrow(changeBoard(newRoom(), maker, notePut("note-1"), NOW));
    const events = openingEvents(room, room.guests[0]!, [maker]).map((event) =>
      decodeEvent(frameData(sseFrame(event))),
    );
    expect(events.map((event) => event.type)).toEqual(["view", "thread", "presence"]);
    const [view, thread] = events;
    expect(view?.type === "view" && view.view.board?.notes[0]?.id).toBe("note-1");
    expect(thread?.type === "thread" && thread.item.kind).toBe("snapshot");
  });

  it("lets only the maker delete the board or remove others, and anyone leave", () => {
    const grace = GuestId.make("guest-two");
    const room = Result.getOrThrow(join(newRoom(), "guest-two"));
    const withCards = Result.getOrThrow(changeBoard(room, grace, notePut("by-grace"), NOW));
    const everyone = {
      ...withCards,
      machines: [{ guestId: grace, hash: "h", kind: "room" as const }],
    };
    expect(viewFor(everyone, everyone.guests[1]!).maker).toBe(maker);
    expect(checkDelete(everyone, maker)).toBeNull();
    expect(checkDelete(everyone, grace)).toMatchObject({ status: 403, reason: "not_maker" });
    const { maker: _before, ...madeBefore } = everyone;
    expect(checkDelete(madeBefore, maker)).not.toBeNull();
    // Nobody but the maker removes anyone, and nobody removes the maker.
    for (const [by, whom] of [
      [grace, maker],
      [GuestId.make("stranger"), grace],
    ] as const) {
      const refused = removePerson(everyone, by, whom, NOW);
      expect(Result.isFailure(refused) && refused.failure.reason).toBe("not_maker");
    }
    // The maker removes Grace: her cards, her machine's token and her session go.
    const removed = Result.getOrThrow(removePerson(everyone, maker, grace, NOW));
    expect(removed.guests.map((guest) => guest.id)).toEqual([maker]);
    expect(removed.board?.notes).toEqual([]);
    expect(removed.machines).toEqual([]);
    expect(guestBySession(removed, "guest-two-session")).toBeUndefined();
    expect(machineGuestOf(removed, "h", "room", 0)).toBeUndefined();
    expect(removePerson(removed, maker, grace, NOW)).toStrictEqual(Result.succeed(removed));
    // Grace leaves on her own; the maker leaving leaves the board, with no maker.
    expect(Result.getOrThrow(removePerson(everyone, grace, grace, NOW)).guests).toHaveLength(1);
    const left = Result.getOrThrow(removePerson(everyone, maker, maker, NOW));
    expect([left.maker, left.guests.map((guest) => guest.id)]).toEqual([undefined, [grace]]);
    expect(viewFor(left, left.guests[0]!)).not.toHaveProperty("maker");
  });

  it("deletes a board a day after it was made if nobody changed it, else after 90 idle days", () => {
    const made = Date.parse(NOW);
    const day = 24 * 60 * 60_000;
    const untouched = newRoom();
    expect(boardAlarmAt(untouched, made + 5, null)).toBe(made + UNTOUCHED_BOARD_MS);
    expect(boardAlarmAt(untouched, made + 5, made + UNTOUCHED_BOARD_MS)).toBeNull();
    const used = renameRoom(untouched, "Plan", "2026-11-16T11:00:00.000Z");
    // Once changed, the untouched deadline moves to 90 idle days, and on at most once a day.
    const first = boardAlarmAt(used, made, made + UNTOUCHED_BOARD_MS);
    expect(first).toBe(made + IDLE_BOARD_MS + day);
    expect(boardAlarmAt(used, made + day - 1, first)).toBeNull();
    expect(boardAlarmAt(used, made + day, first)).toBe(made + day + IDLE_BOARD_MS + day);
  });

  it("shows each guest everyone else's pointer, until they leave", () => {
    const other = GuestId.make("guest-two");
    const now = 1_000;
    const moved = Result.getOrThrow(
      moveCursor(EMPTY_LIVE, other, { at: { x: 5, y: 6 }, view: { x: 0, y: 0, zoom: 1 } }, now),
    );
    const seen = cursorsEventFor(moved, maker, now);
    expect(seen.cursors).toEqual([{ guestId: other, x: 5, y: 6 }]);
    expect(decodeEvent(JSON.stringify(seen))).toMatchObject({ type: "cursors" });
    expect(cursorsEventFor(moved, other, now).cursors).toEqual([]);
    expect(cursorsEventFor(withoutPerson(moved, other), maker, now).cursors).toEqual([]);
  });
});
