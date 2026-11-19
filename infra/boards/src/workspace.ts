import {
  CLOUD_WORKSPACE_MAX_BOARDS,
  CLOUD_WORKSPACE_MAX_MEMBERS,
  type CloudBoardAccountBoard,
  type CloudInboxItem,
  type CloudWorkspace,
  type CloudWorkspaceBoard,
  type CloudWorkspacePreview,
  type CloudWorkspaceProfile,
  type CloudWorkspaceRenameRequest,
  type CloudWorkspaceRole,
  type GuestId,
  type RoomBoardNoteColor,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

import { accountBoardOf, accountGuestOf, withAccountSession } from "./account.ts";
import {
  CLOUD_BOARD_MAX_GUESTS,
  freeGuestName,
  roomFailure,
  type CloudGuest,
  type CloudRoom,
  type RoomFailure,
} from "./room.ts";

/**
 * A workspace is a team's place for cloud boards. It says who is in the team and which boards are
 * the team's; each board still says who is on it. Being in the workspace gives a seat on its
 * boards when first opened, and leaving it takes away the way in, never anyone's cards.
 */
export interface WorkspaceMember {
  readonly memberId: string;
  /** The Clerk user id. Never sent to anyone. */
  readonly account: string;
  readonly name: string;
  readonly imageUrl?: string;
  readonly role: CloudWorkspaceRole;
  readonly joinedAt: string;
}

export interface WorkspaceState {
  readonly id: string;
  readonly name: string;
  readonly color: RoomBoardNoteColor;
  readonly createdAt: string;
  readonly members: ReadonlyArray<WorkspaceMember>;
  /** The invite link's code, `<workspace id>.<random>`, while there is one. */
  readonly invite?: string;
}

type Change<T> = Result.Result<T, RoomFailure>;

// Only Clerk's own image hosts: a picture from anywhere else could see who opens the list.
const AVATAR_ORIGINS = ["https://img.clerk.com/", "https://images.clerk.dev/"];

const profileFields = (profile: CloudWorkspaceProfile) => ({
  name: profile.name,
  ...(profile.imageUrl !== undefined &&
  AVATAR_ORIGINS.some((origin) => profile.imageUrl!.startsWith(origin))
    ? { imageUrl: profile.imageUrl }
    : {}),
});

export const memberOf = (state: WorkspaceState | null, account: string) =>
  state?.members.find((member) => member.account === account);

const owners = (state: WorkspaceState) =>
  state.members.filter((member) => member.role === "owner").length;

/** The owner `account` is, or why they may not do an owner's work here. */
function ownerCheck(state: WorkspaceState | null, account: string): RoomFailure | null {
  const member = memberOf(state, account);
  if (member === undefined) return roomFailure("not_member");
  return member.role === "owner" ? null : roomFailure("not_owner");
}

export function createWorkspace(input: {
  readonly id: string;
  readonly name: string;
  readonly color: RoomBoardNoteColor;
  readonly owner: {
    readonly account: string;
    readonly memberId: string;
    readonly profile: CloudWorkspaceProfile;
  };
  readonly invite: string;
  readonly now: string;
}): WorkspaceState {
  return {
    id: input.id,
    name: input.name,
    color: input.color,
    createdAt: input.now,
    members: [
      {
        memberId: input.owner.memberId,
        account: input.owner.account,
        ...profileFields(input.owner.profile),
        role: "owner",
        joinedAt: input.now,
      },
    ],
    invite: input.invite,
  };
}

const INVALID_INVITE = "This invite link is not valid. Ask for a new one.";

/** Joins by the invite link. Someone already in keeps their role; only their name may change. */
export function joinWorkspace(
  state: WorkspaceState | null,
  input: {
    readonly code: string;
    readonly account: string;
    readonly memberId: string;
    readonly profile: CloudWorkspaceProfile;
    readonly now: string;
  },
): Change<WorkspaceState> {
  if (state === null || state.invite === undefined || state.invite !== input.code) {
    return Result.fail(roomFailure("invalid", INVALID_INVITE));
  }
  const fields = profileFields(input.profile);
  const existing = memberOf(state, input.account);
  if (existing !== undefined) {
    const { imageUrl: _image, ...kept } = existing;
    return Result.succeed({
      ...state,
      members: state.members.map((member) =>
        member === existing ? { ...kept, ...fields } : member,
      ),
    });
  }
  if (state.members.length >= CLOUD_WORKSPACE_MAX_MEMBERS) {
    return Result.fail(roomFailure("limit", "This workspace has as many people as it holds."));
  }
  const member: WorkspaceMember = {
    memberId: input.memberId,
    account: input.account,
    ...fields,
    role: "member",
    joinedAt: input.now,
  };
  return Result.succeed({ ...state, members: [...state.members, member] });
}

/** `account` leaves. The only owner cannot: they make someone else owner, or delete it. */
export function leaveWorkspace(
  state: WorkspaceState | null,
  account: string,
): Change<{ readonly state: WorkspaceState; readonly removed: WorkspaceMember }> {
  const member = memberOf(state, account);
  if (state === null || member === undefined) return Result.fail(roomFailure("not_member"));
  if (member.role === "owner" && owners(state) === 1) return Result.fail(roomFailure("last_owner"));
  return Result.succeed({
    state: { ...state, members: state.members.filter((candidate) => candidate !== member) },
    removed: member,
  });
}

/** An owner takes someone out; themselves is leaving. Someone already gone changes nothing. */
export function removeMember(
  state: WorkspaceState | null,
  by: string,
  memberId: string,
): Change<{ readonly state: WorkspaceState; readonly removed: WorkspaceMember | null }> {
  const refused = ownerCheck(state, by);
  if (state === null || refused !== null) return Result.fail(refused ?? roomFailure("not_member"));
  const target = state.members.find((member) => member.memberId === memberId);
  if (target === undefined) return Result.succeed({ state, removed: null });
  if (target.account === by) return leaveWorkspace(state, by);
  return Result.succeed({
    state: { ...state, members: state.members.filter((member) => member !== target) },
    removed: target,
  });
}

/** An owner makes someone an owner or a member. The last owner stays one. */
export function setMemberRole(
  state: WorkspaceState | null,
  by: string,
  memberId: string,
  role: CloudWorkspaceRole,
): Change<WorkspaceState> {
  const refused = ownerCheck(state, by);
  if (state === null || refused !== null) return Result.fail(refused ?? roomFailure("not_member"));
  const target = state.members.find((member) => member.memberId === memberId);
  if (target === undefined) {
    return Result.fail(roomFailure("not_member", "This person is no longer in this workspace."));
  }
  if (target.role === role) return Result.succeed(state);
  if (role === "member" && owners(state) === 1) return Result.fail(roomFailure("last_owner"));
  return Result.succeed({
    ...state,
    members: state.members.map((member) => (member === target ? { ...member, role } : member)),
  });
}

/** What the member whose role `by` changed finds in their inbox; null when nothing changed. */
export function roleChangedItem(
  before: WorkspaceState | null,
  after: WorkspaceState,
  input: {
    readonly by: string;
    readonly memberId: string;
    readonly id: string;
    readonly at: string;
  },
): { readonly account: string; readonly item: CloudInboxItem } | null {
  const was = before?.members.find((member) => member.memberId === input.memberId);
  const now = after.members.find((member) => member.memberId === input.memberId);
  if (now === undefined || was?.role === now.role || now.account === input.by) return null;
  return {
    account: now.account,
    item: {
      id: input.id,
      kind: "access-changed",
      at: input.at,
      by: memberOf(after, input.by)?.name ?? "An owner",
      title: after.name,
      workspaceId: after.id,
      role: now.role,
    },
  };
}

export function renameWorkspace(
  state: WorkspaceState | null,
  by: string,
  change: CloudWorkspaceRenameRequest,
): Change<WorkspaceState> {
  const refused = ownerCheck(state, by);
  if (state === null || refused !== null) return Result.fail(refused ?? roomFailure("not_member"));
  return Result.succeed({
    ...state,
    ...(change.name === undefined ? {} : { name: change.name }),
    ...(change.color === undefined ? {} : { color: change.color }),
  });
}

/** An owner makes a new invite link, which ends the old one, or ends it (`null`). */
export function withInvite(
  state: WorkspaceState | null,
  by: string,
  invite: string | null,
): Change<WorkspaceState> {
  const refused = ownerCheck(state, by);
  if (state === null || refused !== null) return Result.fail(refused ?? roomFailure("not_member"));
  const { invite: _old, ...rest } = state;
  return Result.succeed(invite === null ? rest : { ...rest, invite });
}

/** Whether `account` may put a board in, given how many it has and whether it is already in. */
export function checkAddBoard(
  state: WorkspaceState | null,
  account: string,
  boards: number,
  listed: boolean,
): RoomFailure | null {
  if (memberOf(state, account) === undefined) return roomFailure("not_member");
  return !listed && boards >= CLOUD_WORKSPACE_MAX_BOARDS
    ? roomFailure("limit", "This workspace has as many boards as it holds.")
    : null;
}

/** The workspace as `account` reads it, or null when they are not in it. */
export function workspaceView(
  state: WorkspaceState | null,
  boards: ReadonlyArray<CloudWorkspaceBoard>,
  account: string,
): CloudWorkspace | null {
  const reader = memberOf(state, account);
  if (state === null || reader === undefined) return null;
  return {
    id: state.id,
    name: state.name,
    color: state.color,
    role: reader.role,
    members: state.members
      .toSorted(
        (left, right) =>
          Number(right.role === "owner") - Number(left.role === "owner") ||
          left.joinedAt.localeCompare(right.joinedAt),
      )
      .map(({ account: memberAccount, ...member }) =>
        memberAccount === account ? { ...member, you: true } : member,
      ),
    boards: boards.toSorted((left, right) => right.addedAt.localeCompare(left.addedAt)),
    ...(state.invite === undefined ? {} : { invite: state.invite }),
    createdAt: state.createdAt,
  };
}

// Told to whoever holds the invite, who sees every member's name once they join.
const ownerNameOf = (state: WorkspaceState) => {
  const owner = state.members
    .filter((member) => member.role === "owner")
    .toSorted((left, right) => left.joinedAt.localeCompare(right.joinedAt))[0]
    ?.name.trim();
  return owner === undefined || owner === "" ? {} : { owner };
};

/** What an invite link shows before anyone signs in. */
export const previewOf = (
  state: WorkspaceState | null,
  code: string,
): CloudWorkspacePreview | null =>
  state === null || state.invite === undefined || state.invite !== code
    ? null
    : {
        id: state.id,
        name: state.name,
        color: state.color,
        members: state.members.length,
        ...ownerNameOf(state),
      };

export type BoardPlacement =
  | { readonly account: string; readonly into: string }
  /** `owner`: the account owns the workspace it is taken out of. */
  | { readonly account: string; readonly outOf: string; readonly owner: boolean };

/**
 * Puts the board in a workspace, or takes it out of one. Only its maker moves it in; its maker or
 * an owner of that workspace takes it out. A board not in `outOf` stays as it is.
 */
export function placeBoard(
  room: CloudRoom | null,
  input: BoardPlacement,
): Change<{ readonly room: CloudRoom; readonly previous: string | undefined }> {
  if (room === null) return Result.fail(roomFailure("ended"));
  const guest = accountGuestOf(room, input.account);
  const isMaker = guest !== undefined && guest.locked !== true && room.maker === guest.id;
  const previous = room.workspaceId;
  if ("outOf" in input) {
    if (previous !== input.outOf) return Result.succeed({ room, previous });
    if (!isMaker && !input.owner) return Result.fail(roomFailure("not_maker"));
    const { workspaceId: _gone, ...rest } = room;
    return Result.succeed({ room: rest, previous });
  }
  if (!isMaker) return Result.fail(roomFailure("not_maker"));
  return Result.succeed({
    room: previous === input.into ? room : { ...room, workspaceId: input.into },
    previous,
  });
}

/** What the workspace lists of a board. */
export const workspaceBoardOf = (
  room: CloudRoom,
  input: { readonly addedAt: string; readonly addedBy?: string | undefined },
): CloudWorkspaceBoard => ({
  shareId: room.shareId,
  threadId: room.threadId,
  title: room.title,
  addedAt: input.addedAt,
  ...(input.addedBy === undefined ? {} : { addedBy: input.addedBy }),
});

/**
 * A session for a workspace member on one of its boards: their seat if they have one (back after
 * being taken out too), else a new seat under `name`. The board must still be in the workspace.
 */
export function seatMember(
  room: CloudRoom | null,
  input: {
    readonly account: string;
    readonly workspaceId: string;
    readonly sessionHash: string;
    readonly guestId: GuestId;
    readonly name: string;
    readonly now: string;
  },
): Change<{ readonly room: CloudRoom; readonly board: CloudBoardAccountBoard }> {
  if (room === null) return Result.fail(roomFailure("ended"));
  if (room.workspaceId !== input.workspaceId) return Result.fail(roomFailure("not_in_workspace"));
  const existing = accountGuestOf(room, input.account);
  let seated: CloudRoom;
  if (existing === undefined) {
    if (room.guests.length >= CLOUD_BOARD_MAX_GUESTS) return Result.fail(roomFailure("full"));
    const guest: CloudGuest = {
      id: input.guestId,
      name: freeGuestName(room.guests, input.name),
      joinedAt: input.now,
      sessionHash: input.sessionHash,
      accountId: input.account,
    };
    seated = { ...room, guests: [...room.guests, guest], updatedAt: input.now };
  } else {
    const { locked: _locked, ...unlocked } = existing;
    const opened = withAccountSession(
      {
        ...room,
        guests: room.guests.map((guest) => (guest === existing ? unlocked : guest)),
      },
      input.account,
      input.sessionHash,
    );
    if (Result.isFailure(opened)) return Result.fail(opened.failure);
    seated = opened.success.room;
  }
  const guest = accountGuestOf(seated, input.account)!;
  return Result.succeed({
    room: seated,
    board: accountBoardOf(seated, guest, { addedAt: input.now }),
  });
}

/**
 * Takes the way in away from `account`'s person on a board of `workspaceId`: every session and
 * machine token goes, their cards stay theirs. Null when there is nothing to take.
 */
export function lockOutAccount(
  room: CloudRoom | null,
  account: string,
  workspaceId: string,
): { readonly room: CloudRoom; readonly guestId: GuestId } | null {
  if (room === null || room.workspaceId !== workspaceId) return null;
  const guest = accountGuestOf(room, account);
  if (guest === undefined || guest.locked === true) return null;
  const locked: CloudGuest = {
    id: guest.id,
    name: guest.name,
    joinedAt: guest.joinedAt,
    accountId: account,
    // No session hashes to an empty string.
    sessionHash: "",
    locked: true,
  };
  const machines = room.machines?.filter((token) => token.guestId !== guest.id);
  return {
    room: {
      ...room,
      guests: room.guests.map((candidate) => (candidate === guest ? locked : candidate)),
      ...(machines === undefined ? {} : { machines }),
    },
    guestId: guest.id,
  };
}

/** Times a board that failed a step is asked again before it is left to its next open. */
export const BOARD_WORK_ATTEMPTS = 5;

/**
 * The work queue once one step told `boards` (at most `perStep`, in order) and `failed` of them
 * failed: the same work goes on after the last board, and the failed ones are asked again later.
 */
export function nextBoardWork<
  W extends {
    readonly after?: string;
    readonly retry?: { readonly shareIds: ReadonlyArray<string>; readonly attempt: number };
  },
>(
  work: W,
  rest: ReadonlyArray<W>,
  boards: ReadonlyArray<string>,
  failed: ReadonlyArray<string>,
  perStep: number,
): ReadonlyArray<W> {
  const { retry, after: _after, ...base } = work;
  const more =
    retry === undefined && boards.length >= perStep
      ? [{ ...base, after: boards.at(-1)! } as W]
      : [];
  const attempt = (retry?.attempt ?? 0) + 1;
  const again =
    failed.length > 0 && attempt < BOARD_WORK_ATTEMPTS
      ? [{ ...base, retry: { shareIds: failed, attempt } } as W]
      : [];
  return [...more, ...rest, ...again];
}
