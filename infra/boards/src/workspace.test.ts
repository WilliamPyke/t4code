import {
  CLOUD_WORKSPACE_MAX_BOARDS,
  CLOUD_WORKSPACE_MAX_MEMBERS,
  GuestId,
  GuestShareId,
  ThreadId,
  type RoomBoardChange,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { accountLockedOut, linkAccount, withAccountSession } from "./account.ts";
import { machineGuestOf } from "./machines.ts";
import { changeBoard, createRoom, guestBySession, joinRoom, type CloudRoom } from "./room.ts";
import {
  checkAddBoard,
  createWorkspace,
  joinWorkspace,
  leaveWorkspace,
  lockOutAccount,
  BOARD_WORK_ATTEMPTS,
  nextBoardWork,
  placeBoard,
  previewOf,
  removeMember,
  seatMember,
  setMemberRole,
  withInvite,
  workspaceView,
  type WorkspaceState,
} from "./workspace.ts";

const NOW = "2026-11-17T10:00:00.000Z";
const INVITE = "ws-one-0000.invite";

const team = (): WorkspaceState =>
  createWorkspace({
    id: "ws-one-0000",
    name: "Acme",
    color: "blue",
    owner: { account: "user_ada", memberId: "m-ada", profile: { name: "Ada" } },
    invite: INVITE,
    now: NOW,
  });

const join = (state: WorkspaceState, account: string, code = INVITE) =>
  joinWorkspace(state, {
    code,
    account,
    memberId: `m-${account}`,
    profile: { name: account, imageUrl: "https://img.clerk.com/face.png" },
    now: NOW,
  });

const withGrace = () => Result.getOrThrow(join(team(), "user_grace"));
const memberIdOf = (state: WorkspaceState, account: string) =>
  state.members.find((member) => member.account === account)!.memberId;

describe("workspace rules", () => {
  it("makes a workspace with its maker as owner, and shows nobody's account", () => {
    const view = workspaceView(withGrace(), [], "user_grace")!;
    expect(view).toMatchObject({ name: "Acme", role: "member", invite: INVITE });
    expect(view.members.map((member) => [member.name, member.role, member.you])).toEqual([
      ["Ada", "owner", undefined],
      ["user_grace", "member", true],
    ]);
    expect(JSON.stringify(view)).not.toContain("user_ada");
    expect(workspaceView(withGrace(), [], "user_eve")).toBeNull();
  });

  it("joins by the invite once, keeps only Clerk pictures, and refuses a wrong or ended link", () => {
    const state = withGrace();
    expect(Result.getOrThrow(join(state, "user_grace")).members).toHaveLength(2);
    expect(state.members[1]!.imageUrl).toBe("https://img.clerk.com/face.png");
    const tracked = Result.getOrThrow(
      joinWorkspace(team(), {
        code: INVITE,
        account: "user_eve",
        memberId: "m-eve",
        profile: { name: "Eve", imageUrl: "https://evil.example/pixel.png" },
        now: NOW,
      }),
    );
    expect(tracked.members[1]).not.toHaveProperty("imageUrl");
    expect(Result.isFailure(join(team(), "user_eve", "ws-one-0000.guess"))).toBe(true);
    expect(previewOf(team(), "ws-one-0000.guess")).toBeNull();
    expect(previewOf(team(), INVITE)).toEqual({
      id: "ws-one-0000",
      name: "Acme",
      color: "blue",
      members: 1,
      owner: "Ada",
    });
  });

  it("lets only an owner make a new link or end it, which ends the old one", () => {
    const state = withGrace();
    const refused = withInvite(state, "user_grace", "ws-one-0000.new");
    expect(Result.isFailure(refused) && refused.failure.reason).toBe("not_owner");
    const renewed = Result.getOrThrow(withInvite(state, "user_ada", "ws-one-0000.new"));
    expect(Result.isFailure(join(renewed, "user_eve"))).toBe(true);
    expect(Result.isSuccess(join(renewed, "user_eve", "ws-one-0000.new"))).toBe(true);
    const ended = Result.getOrThrow(withInvite(state, "user_ada", null));
    expect(ended.invite).toBeUndefined();
    expect(Result.isFailure(join(ended, "user_eve"))).toBe(true);
    expect(workspaceView(ended, [], "user_ada")).not.toHaveProperty("invite");
  });

  it("lets an owner remove a member, nobody else, and someone gone changes nothing", () => {
    const state = Result.getOrThrow(join(withGrace(), "user_eve"));
    const byMember = removeMember(state, "user_grace", memberIdOf(state, "user_eve"));
    expect(Result.isFailure(byMember) && byMember.failure.reason).toBe("not_owner");
    const outsider = removeMember(state, "user_mallory", memberIdOf(state, "user_eve"));
    expect(Result.isFailure(outsider) && outsider.failure.reason).toBe("not_member");
    const removed = Result.getOrThrow(
      removeMember(state, "user_ada", memberIdOf(state, "user_eve")),
    );
    expect(removed.removed?.account).toBe("user_eve");
    expect(workspaceView(removed.state, [], "user_eve")).toBeNull();
    expect(Result.getOrThrow(removeMember(removed.state, "user_ada", "m-gone")).removed).toBeNull();
  });

  it("keeps an owner until there is another: leaving, removing yourself and stepping down", () => {
    const state = withGrace();
    const left = leaveWorkspace(state, "user_ada");
    expect(Result.isFailure(left) && left.failure.reason).toBe("last_owner");
    expect(Result.isFailure(removeMember(state, "user_ada", "m-ada"))).toBe(true);
    expect(Result.isFailure(setMemberRole(state, "user_ada", "m-ada", "member"))).toBe(true);
    // Alone too: the workspace is deleted, not left with nobody to run it.
    expect(Result.isFailure(leaveWorkspace(team(), "user_ada"))).toBe(true);
    const promoted = Result.getOrThrow(
      setMemberRole(state, "user_ada", memberIdOf(state, "user_grace"), "owner"),
    );
    const adaGone = Result.getOrThrow(leaveWorkspace(promoted, "user_ada")).state;
    expect(adaGone.members.map((member) => [member.account, member.role])).toEqual([
      ["user_grace", "owner"],
    ]);
    expect(Result.isSuccess(leaveWorkspace(state, "user_grace"))).toBe(true);
    expect(Result.isFailure(leaveWorkspace(state, "user_eve"))).toBe(true);
  });

  it("holds at most its members and boards, and only members add boards", () => {
    let state = team();
    for (let index = 1; index < CLOUD_WORKSPACE_MAX_MEMBERS; index++) {
      state = Result.getOrThrow(join(state, `user_${index}`));
    }
    const full = join(state, "user_late");
    expect(Result.isFailure(full) && full.failure.reason).toBe("limit");
    expect(checkAddBoard(state, "user_1", CLOUD_WORKSPACE_MAX_BOARDS - 1, false)).toBeNull();
    expect(checkAddBoard(state, "user_1", CLOUD_WORKSPACE_MAX_BOARDS, false)?.reason).toBe("limit");
    expect(checkAddBoard(state, "user_1", CLOUD_WORKSPACE_MAX_BOARDS, true)).toBeNull();
    expect(checkAddBoard(state, "user_late", 0, false)?.reason).toBe("not_member");
  });
});

const board = (): CloudRoom => {
  const made = createRoom({
    shareId: GuestShareId.make("share-one-0000"),
    threadId: ThreadId.make("board-share-one-0000"),
    title: "Plans",
    inviteHash: "invite-hash",
    maker: { id: GuestId.make("guest-ada"), name: "Ada", sessionHash: "ada-session" },
    now: NOW,
  });
  return Result.getOrThrow(
    linkAccount(made, { account: "user_ada", sessionHash: "ada-session", now: NOW }),
  ).room;
};

const inTeam = () =>
  Result.getOrThrow(placeBoard(board(), { account: "user_ada", into: "ws-one-0000" })).room;

const seat = (room: CloudRoom, account: string, sessionHash: string, workspaceId = "ws-one-0000") =>
  seatMember(room, {
    account,
    workspaceId,
    sessionHash,
    guestId: GuestId.make(`guest-${account}`),
    name: "Grace",
    now: NOW,
  });

describe("boards in a workspace", () => {
  it("moves in only by its maker, and out by its maker or an owner", () => {
    const byOther = placeBoard(board(), { account: "user_grace", into: "ws-one-0000" });
    expect(Result.isFailure(byOther) && byOther.failure.reason).toBe("not_maker");
    const room = inTeam();
    expect(room.workspaceId).toBe("ws-one-0000");
    const out = { account: "user_grace", outOf: "ws-one-0000", owner: false };
    expect(Result.isFailure(placeBoard(room, out))).toBe(true);
    expect(Result.getOrThrow(placeBoard(room, { ...out, owner: true })).room).not.toHaveProperty(
      "workspaceId",
    );
    // An owner of another workspace takes nothing out of this one.
    expect(
      Result.getOrThrow(placeBoard(room, { ...out, outOf: "ws-two-0000", owner: true })).room,
    ).toBe(room);
    const moved = Result.getOrThrow(placeBoard(room, { account: "user_ada", into: "ws-two-0000" }));
    expect([moved.room.workspaceId, moved.previous]).toEqual(["ws-two-0000", "ws-one-0000"]);
  });

  it("seats a member on first open without the invite, then opens the same seat", () => {
    const first = Result.getOrThrow(seat(inTeam(), "user_grace", "grace-1"));
    expect(first.board).toMatchObject({ guestId: "guest-user_grace", maker: false });
    expect(guestBySession(first.room, "grace-1")?.accountId).toBe("user_grace");
    const again = Result.getOrThrow(seat(first.room, "user_grace", "grace-2"));
    expect(again.room.guests).toHaveLength(2);
    expect(guestBySession(again.room, "grace-2")?.id).toBe("guest-user_grace");
    // Not for a board outside the workspace, or in another one.
    const outside = seat(board(), "user_grace", "grace-3");
    expect(Result.isFailure(outside) && outside.failure.reason).toBe("not_in_workspace");
    expect(Result.isFailure(seat(inTeam(), "user_grace", "grace-3", "ws-two-0000"))).toBe(true);
  });

  it("takes a removed member's way in and keeps their cards, until they are back", () => {
    const seated = Result.getOrThrow(seat(inTeam(), "user_grace", "grace-1")).room;
    const graceId = GuestId.make("guest-user_grace");
    const noted = Result.getOrThrow(
      changeBoard(
        {
          ...seated,
          machines: [{ guestId: graceId, hash: "grace-machine", kind: "room" }],
        },
        graceId,
        { type: "note.put", noteId: "note-1", text: "Ship it", x: 0, y: 0 } as RoomBoardChange,
        NOW,
      ),
    );
    const locked = lockOutAccount(noted, "user_grace", "ws-one-0000")!;
    expect(locked.guestId).toBe(graceId);
    expect(guestBySession(locked.room, "grace-1")).toBeUndefined();
    expect(machineGuestOf(locked.room, "grace-machine", "room", Date.parse(NOW))).toBeUndefined();
    expect(Result.isFailure(withAccountSession(locked.room, "user_grace", "grace-2"))).toBe(true);
    // Nor may the account join again as a spare seat from the edit link.
    expect([
      accountLockedOut(locked.room, "user_grace"),
      accountLockedOut(noted, "user_grace"),
    ]).toEqual([true, false]);
    expect(locked.room.board?.notes.find((note) => note.id === "note-1")?.guestId).toBe(graceId);
    expect(locked.room.guests.map((guest) => guest.name)).toEqual(["Ada", "Grace"]);
    // Again, or on a board not in that workspace, there is nothing to take.
    expect(lockOutAccount(locked.room, "user_grace", "ws-one-0000")).toBeNull();
    expect(lockOutAccount(noted, "user_grace", "ws-two-0000")).toBeNull();
    // Back in the workspace, they are the same person on the board again.
    const back = Result.getOrThrow(seat(locked.room, "user_grace", "grace-3")).room;
    expect(guestBySession(back, "grace-3")?.id).toBe(graceId);
    expect(back.guests.find((guest) => guest.id === graceId)?.locked).toBeUndefined();
  });

  it("leaves people who came by the board's own invite alone", () => {
    const joined = Result.getOrThrow(
      joinRoom(inTeam(), {
        id: GuestId.make("guest-link"),
        name: "Linda",
        sessionHash: "link-session",
        inviteHash: "invite-hash",
        now: NOW,
      }),
    );
    expect(lockOutAccount(joined, "user_grace", "ws-one-0000")).toBeNull();
    expect(guestBySession(joined, "link-session")?.id).toBe("guest-link");
  });

  it("asks again the boards a lock-out step could not reach, a few times", () => {
    const lock = { kind: "lock", account: "user_grace", workspaceId: "ws-one-0000" } as const;
    const release = { kind: "release", workspaceId: "ws-one-0000" } as const;
    type Work = (typeof lock | typeof release) & {
      readonly after?: string;
      readonly retry?: { readonly shareIds: ReadonlyArray<string>; readonly attempt: number };
    };
    expect(nextBoardWork<Work>(lock, [release], ["a", "b"], ["b"], 2)).toEqual([
      { ...lock, after: "b" },
      release,
      { ...lock, retry: { shareIds: ["b"], attempt: 1 } },
    ]);
    // A retry asks only its boards, and stops after the last attempt.
    const retry = { ...lock, retry: { shareIds: ["b"], attempt: 1 } };
    expect(nextBoardWork<Work>(retry, [], ["b"], [], 2)).toEqual([]);
    const last = { ...lock, retry: { shareIds: ["b"], attempt: BOARD_WORK_ATTEMPTS - 1 } };
    expect(nextBoardWork<Work>(last, [], ["b"], ["b"], 2)).toEqual([]);
  });
});
