import {
  CLOUD_BOARD_OUTLINE_ROUTE,
  CLOUD_BOARD_COPIES_ROUTE,
  CLOUD_BOARD_LINK_ROUTE,
  CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
  CLOUD_BOARD_PEOPLE_ROLE_ROUTE,
  CLOUD_BOARD_SHARING_ROUTE,
  GUEST_BOARD_ROUTE,
  GuestId,
  GuestShareId,
  GuestStreamEvent,
  ThreadId,
  isCloudBoardViewCredential,
  type RoomBoardChange,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import { SESSION_ROUTE, SESSION_ROUTES, STREAM_ROUTE, checkAccess } from "./access.ts";
import { accountLockedOut, withAccountSession } from "./account.ts";
import { machineGuestOf } from "./machines.ts";
import {
  CLOUD_BOARD_MAX_GUESTS,
  CLOUD_BOARD_MAX_VIEWERS,
  EMPTY_LIVE,
  IDLE_BOARD_MS,
  UNTOUCHED_BOARD_MS,
  boardAlarmAt,
  canChange,
  changeBoard,
  checkDelete,
  checkInvite,
  invitePreviewOf,
  checkViewerRoom,
  STREAMS_PER_SEAT,
  streamsPastCap,
  VIEWER_STREAMS_PER_ADDRESS,
  createRoom,
  cursorsEventFor,
  guestBySession,
  isViewLink,
  joinRoom,
  linkSharingOf,
  managesBoard,
  moveCursor,
  openingEvents,
  removePerson,
  renameRoom,
  roomFailure,
  sseFrame,
  viewFor,
  withLink,
  withRole,
  withSharing,
  withoutPerson,
  type CloudRoom,
} from "./room.ts";
import { makeSecret, makeViewSecret, shareOfSecret } from "./secrets.ts";

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
    const events = openingEvents(room, room.guests[0]!, { online: [maker], viewing: 3 }).map(
      (event) => decodeEvent(frameData(sseFrame(event))),
    );
    expect(events.map((event) => event.type)).toEqual(["view", "thread", "presence"]);
    const [view, thread, presence] = events;
    expect(view?.type === "view" && view.view.board?.notes[0]?.id).toBe("note-1");
    expect(thread?.type === "thread" && thread.item.kind).toBe("snapshot");
    expect(presence).toEqual({ type: "presence", online: [maker], viewing: 3 });
    // Someone looking on from the view link gets a view that names nobody and can change nothing.
    const [looking] = openingEvents(room, null, { online: [maker], viewing: 1 }).map((event) =>
      decodeEvent(frameData(sseFrame(event))),
    );
    expect(looking?.type === "view" && looking.view).toMatchObject({ viewOnly: true });
    expect(looking?.type === "view" && looking.view).not.toHaveProperty("guestId");
    expect(looking?.type === "view" && looking.view).not.toHaveProperty("machines");
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

  it("opens to anyone with the view link, read-only, until the link is made anew or turned off", () => {
    const room = Result.getOrThrow(join(newRoom(), "guest-two"));
    expect(withLink(room, false, "view", null, NOW)).toStrictEqual(
      Result.fail(roomFailure("not_maker")),
    );
    const viewOne = { credential: "share-one-0000.v.one", hash: "view-one" };
    const shown = Result.getOrThrow(withLink(room, true, "view", viewOne, NOW));
    expect([isViewLink(shown, "view-one"), isViewLink(shown, "invite-hash")]).toEqual([
      true,
      false,
    ]);
    const looking = viewFor(shown, null);
    expect(looking).toMatchObject({ viewOnly: true, guestName: "Viewer", cloud: true });
    expect(looking.guests.map((guest) => guest.name)).toEqual(["Ada", "Grace"]);
    for (const field of ["guestId", "machines", "manage", "links"]) {
      expect(looking).not.toHaveProperty(field);
    }
    // Everyone on the board may hand the view link on; only the maker manages it.
    expect(viewFor(shown, shown.guests[1]!).links).toEqual({ view: viewOne.credential });
    expect(viewFor(shown, shown.guests[0]!, true)).toMatchObject({ manage: true });
    const remade = Result.getOrThrow(
      withLink(shown, true, "view", { credential: "share-one-0000.v.two", hash: "view-two" }, NOW),
    );
    expect([isViewLink(remade, "view-one"), isViewLink(remade, "view-two")]).toEqual([false, true]);
    const off = Result.getOrThrow(withLink(remade, true, "view", null, NOW));
    expect(isViewLink(off, "view-two")).toBe(false);
    expect(viewFor(off, off.guests[1]!)).not.toHaveProperty("links");
    expect(isCloudBoardViewCredential(makeViewSecret("share-one-0000"))).toBe(true);
    expect(isCloudBoardViewCredential(makeSecret("share-one-0000"))).toBe(false);
    expect(shareOfSecret(makeViewSecret("share-one-0000"))).toBe("share-one-0000");
  });

  it("turns the edit link off or makes it anew, keeping everyone already on the board", () => {
    const room = Result.getOrThrow(join(newRoom(), "guest-two"));
    // A board made before links were kept shows no edit link; the browser keeps its own.
    expect(viewFor(room, room.guests[1]!)).not.toHaveProperty("links");
    const off = Result.getOrThrow(withLink(room, true, "edit", null, NOW));
    expect(Result.isFailure(join(off, "guest-three"))).toBe(true);
    expect(checkInvite(off, "")).toMatchObject({ reason: "invalid" });
    expect(off.guests).toHaveLength(2);
    expect(viewFor(off, off.guests[1]!).links).toEqual({ edit: null });
    const remade = Result.getOrThrow(
      withLink(off, true, "edit", { credential: "share-one-0000.new", hash: "new-hash" }, NOW),
    );
    expect(checkInvite(remade, "invite-hash")).not.toBeNull();
    expect(checkInvite(remade, "new-hash")).toBeNull();
    // The link's holder is told whose board it is, and its name once it has one of its own.
    expect(invitePreviewOf(remade)).toEqual({ maker: "Ada" });
    expect(invitePreviewOf(renameRoom(remade, "Onboarding v2", NOW))).toEqual({
      title: "Onboarding v2",
      maker: "Ada",
    });
    expect(invitePreviewOf(Result.getOrThrow(removePerson(remade, maker, maker, NOW)))).toEqual({});
    expect(viewFor(remade, remade.guests[1]!).links).toEqual({ edit: "share-one-0000.new" });
  });

  it("refuses every route but reading the board to whoever can only look", () => {
    for (const route of Object.keys(SESSION_ROUTES)) {
      // The outline names what the stream shows, so whoever may read one may read the other.
      const reading =
        route === SESSION_ROUTE || route === STREAM_ROUTE || route === CLOUD_BOARD_OUTLINE_ROUTE;
      const managing = [
        CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
        CLOUD_BOARD_PEOPLE_ROLE_ROUTE,
        CLOUD_BOARD_LINK_ROUTE,
        CLOUD_BOARD_SHARING_ROUTE,
        CLOUD_BOARD_COPIES_ROUTE,
      ].includes(route);
      expect([route, checkAccess("edit", route)]).toEqual([route, null]);
      expect([route, checkAccess("link", route)?.status ?? null]).toEqual([
        route,
        reading ? null : 403,
      ]);
      // Someone on the board who can only look may still leave, or manage it as a workspace owner.
      expect([route, checkAccess("view", route)?.reason ?? null]).toEqual([
        route,
        reading || managing ? null : "view_only",
      ]);
    }
    expect(checkAccess("link", GUEST_BOARD_ROUTE)).toMatchObject({ reason: "view_only" });
  });

  it("makes someone a viewer at once, and takes their agent off the board", () => {
    const grace = GuestId.make("guest-two");
    const joined = Result.getOrThrow(join(newRoom(), "guest-two"));
    const room = { ...joined, machines: [{ guestId: grace, hash: "h", kind: "room" as const }] };
    expect(Result.isFailure(withRole(room, false, grace, "view", NOW))).toBe(true);
    expect(withRole(room, true, maker, "view", NOW)).toMatchObject({
      failure: { reason: "rejected" },
    });
    const viewing = Result.getOrThrow(withRole(room, true, grace, "view", NOW));
    const graceNow = viewing.guests[1]!;
    expect(canChange(graceNow)).toBe(false);
    expect(machineGuestOf(viewing, "h", "room", 0)).toBeUndefined();
    // The view her open page gets next says so, and everyone sees who can only look.
    expect(viewFor(viewing, graceNow)).toMatchObject({ viewOnly: true, viewers: [grace] });
    expect(viewFor(viewing, graceNow)).not.toHaveProperty("machines");
    expect(viewFor(viewing, viewing.guests[0]!).viewers).toEqual([grace]);
    expect(withRole(viewing, true, grace, "view", NOW)).toStrictEqual(Result.succeed(viewing));
    const editing = Result.getOrThrow(withRole(viewing, true, grace, "edit", NOW));
    expect(canChange(editing.guests[1]!)).toBe(true);
    expect(viewFor(editing, editing.guests[1]!)).toMatchObject({ machines: true });
    expect(viewFor(editing, editing.guests[1]!)).not.toHaveProperty("viewOnly");
  });

  it("lets the maker and the workspace's owners manage the board, never removing its maker", () => {
    const grace = GuestId.make("guest-two");
    const room = Result.getOrThrow(join(newRoom(), "guest-two"));
    const [ada, graceSeat] = [room.guests[0]!, room.guests[1]!];
    expect(managesBoard(room, ada, null)).toBe(true);
    expect(managesBoard(room, graceSeat, "owner")).toBe(false);
    const inWorkspace = { ...room, workspaceId: "workspace-1" };
    expect(managesBoard(inWorkspace, graceSeat, "owner")).toBe(true);
    expect(managesBoard(inWorkspace, graceSeat, "member")).toBe(false);
    expect(managesBoard(inWorkspace, { ...graceSeat, locked: true }, "owner")).toBe(false);
    const third = Result.getOrThrow(join(inWorkspace, "guest-three", "Lin"));
    const removed = removePerson(third, grace, GuestId.make("guest-three"), NOW, true);
    expect(Result.getOrThrow(removed).guests).toHaveLength(2);
    expect(Result.isFailure(removePerson(third, grace, maker, NOW, true))).toBe(true);
  });

  it("holds as many people looking on at once as a board allows", () => {
    expect(checkViewerRoom(CLOUD_BOARD_MAX_VIEWERS - 1)).toBeNull();
    expect(checkViewerRoom(CLOUD_BOARD_MAX_VIEWERS)).toMatchObject({
      status: 409,
      reason: "viewers_full",
    });
  });

  it("closes a seat's or an address's oldest open pages past its cap, and nobody else's", () => {
    const seat = (n: number) => ({ guestId: "guest-two", viewHash: null, address: null, n });
    const viewer = (n: number, address: string) => ({
      guestId: `viewer-${n}`,
      viewHash: "view-hash",
      address,
      n,
    });
    const open = [
      ...Array.from({ length: STREAMS_PER_SEAT }, (_, n) => seat(n)),
      { guestId: "guest-three", viewHash: null, address: null, n: 99 },
      ...Array.from({ length: VIEWER_STREAMS_PER_ADDRESS }, (_, n) => viewer(n, "203.0.113.1")),
      viewer(50, "203.0.113.2"),
    ];
    expect(streamsPastCap(open, { guestId: "guest-two" }).map((stream) => stream.n)).toEqual([0]);
    expect(
      streamsPastCap(open, { address: "203.0.113.1" }).map((stream) => stream.guestId),
    ).toEqual(["viewer-0"]);
    expect(streamsPastCap(open, { address: "203.0.113.2" })).toEqual([]);
    expect(streamsPastCap(open, { guestId: "guest-three" })).toEqual([]);
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

describe("link sharing", () => {
  const grace = GuestId.make("guest-two");
  const fresh = {
    edit: { credential: "share-one-0000.fresh", hash: "fresh-edit" },
    view: { credential: "share-one-0000.v.fresh", hash: "fresh-view" },
  };
  // Grace is on the board as her account; Ada kept the edit link she made it with.
  const board = (): CloudRoom => {
    const joined = Result.getOrThrow(join(newRoom(), "guest-two"));
    return {
      ...joined,
      editLink: "share-one-0000.invite",
      guests: joined.guests.map((guest) =>
        guest.id === grace ? { ...guest, accountId: "account-grace" } : guest,
      ),
    };
  };
  const shared = (sharing: "edit" | "view" | "off") =>
    Result.getOrThrow(withSharing(board(), true, { sharing, renew: false, fresh }, NOW));

  it.each([
    {
      sharing: "edit" as const,
      editJoins: true,
      viewOpens: true,
      links: { edit: "share-one-0000.invite", view: fresh.view.credential },
    },
    {
      sharing: "view" as const,
      editJoins: false,
      viewOpens: true,
      links: { edit: null, view: fresh.view.credential },
    },
    { sharing: "off" as const, editJoins: false, viewOpens: false, links: { edit: null } },
  ])(
    "$sharing: the edit link lets someone new in ($editJoins), the view link opens ($viewOpens), seats stay",
    ({ sharing, editJoins, viewOpens, links }) => {
      const room = shared(sharing);
      expect(linkSharingOf(room)).toBe(sharing);
      // Someone new, with each link.
      expect(Result.isSuccess(join(room, "guest-new"))).toBe(editJoins);
      expect(isViewLink(room, "fresh-view")).toBe(viewOpens);
      // Everyone already on the board keeps their seat and what they can do.
      expect(guestBySession(room, "guest-two-session")?.id).toBe(grace);
      expect(Result.isSuccess(withAccountSession(room, "account-grace", "new-device"))).toBe(true);
      expect(Result.isSuccess(changeBoard(room, grace, notePut("still-editing"), NOW))).toBe(true);
      // Removed, her account opens nothing; only the link, as it lets anyone, brings her back.
      const removed = Result.getOrThrow(removePerson(room, maker, grace, NOW));
      expect(Result.isFailure(withAccountSession(removed, "account-grace", "again"))).toBe(true);
      expect(accountLockedOut(removed, "account-grace")).toBe(false);
      expect(Result.isSuccess(join(removed, "guest-two-again"))).toBe(editJoins);
      // Taken out of the workspace instead, her account stays locked out whatever the links do.
      const locked = {
        ...room,
        guests: room.guests.map((guest) =>
          guest.id === grace ? { ...guest, locked: true as const } : guest,
        ),
      };
      expect(accountLockedOut(locked, "account-grace")).toBe(true);
      // Only the links that let people in are handed out, so an older client offers no other.
      expect(viewFor(room, room.guests[1]!)).toMatchObject({ links, sharing });
      expect(viewFor(room, null)).not.toHaveProperty("sharing");
    },
  );

  it("says why a link no longer lets someone in, in words an older client already shows", () => {
    expect(checkInvite(shared("off"), "invite-hash")).toMatchObject({
      status: 403,
      reason: "invalid",
      message: expect.stringContaining("Link sharing is off"),
    });
    expect(checkInvite(shared("view"), "invite-hash")).toMatchObject({
      reason: "invalid",
      message: expect.stringContaining("only lets people look"),
    });
    expect(checkInvite(shared("edit"), "wrong")).toMatchObject({
      message: "This board link is not valid.",
    });
  });

  it("brings back the very same links when sharing comes back on, and new ones only on renew", () => {
    const off = Result.getOrThrow(
      withSharing(shared("edit"), true, { sharing: "off", renew: false, fresh }, NOW),
    );
    expect([checkInvite(off, "invite-hash")?.reason, isViewLink(off, "fresh-view")]).toEqual([
      "invalid",
      false,
    ]);
    const back = Result.getOrThrow(
      withSharing(
        off,
        true,
        {
          sharing: "edit",
          renew: false,
          fresh: {
            edit: { credential: "share-one-0000.other", hash: "other-edit" },
            view: { credential: "share-one-0000.v.other", hash: "other-view" },
          },
        },
        NOW,
      ),
    );
    expect(checkInvite(back, "invite-hash")).toBeNull();
    expect(isViewLink(back, "fresh-view")).toBe(true);
    expect(withSharing(back, true, { sharing: "edit", renew: false, fresh }, NOW)).toStrictEqual(
      Result.succeed(back),
    );
    expect(withSharing(back, false, { sharing: "off", renew: false, fresh }, NOW)).toStrictEqual(
      Result.fail(roomFailure("not_maker")),
    );
    const renewed = Result.getOrThrow(
      withSharing(
        shared("edit"),
        true,
        {
          sharing: "edit",
          renew: true,
          fresh: {
            edit: { credential: "share-one-0000.renewed", hash: "renewed-edit" },
            view: { credential: "share-one-0000.v.renewed", hash: "renewed-view" },
          },
        },
        NOW,
      ),
    );
    expect(checkInvite(renewed, "invite-hash")).not.toBeNull();
    expect(checkInvite(renewed, "renewed-edit")).toBeNull();
    expect([isViewLink(renewed, "fresh-view"), isViewLink(renewed, "renewed-view")]).toEqual([
      false,
      true,
    ]);
    expect(renewed.guests).toHaveLength(2);
  });

  it("shares a board from before the setting as its links say, and an older client's link turns it up", () => {
    const legacy = board();
    expect(linkSharingOf(legacy)).toBe("edit");
    const editOff = Result.getOrThrow(withLink(legacy, true, "edit", null, NOW));
    expect(linkSharingOf(editOff)).toBe("off");
    const viewOn = Result.getOrThrow(withLink(editOff, true, "view", fresh.view, NOW));
    expect(linkSharingOf(viewOn)).toBe("view");
    // An older client turning a link on means it to work, whatever the setting was.
    const turnedOn = Result.getOrThrow(withLink(shared("off"), true, "edit", fresh.edit, NOW));
    expect([linkSharingOf(turnedOn), checkInvite(turnedOn, "fresh-edit")]).toEqual(["edit", null]);
    const viewOnly = Result.getOrThrow(withLink(shared("off"), true, "view", fresh.view, NOW));
    expect(linkSharingOf(viewOnly)).toBe("view");
    // Made anew while it works, a link leaves the setting as it was.
    const remade = Result.getOrThrow(withLink(shared("view"), true, "view", fresh.view, NOW));
    expect(linkSharingOf(remade)).toBe("view");
  });
});
