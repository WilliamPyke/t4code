import type { CloudInboxItem, GuestId } from "@t3tools/contracts";
import * as Result from "effect/Result";

import { accountGuestOf } from "./account.ts";
import { inboxExcerpt } from "./inbox.ts";
import {
  CLOUD_BOARD_MAX_GUESTS,
  canChange,
  freeGuestName,
  roomFailure,
  withRole,
  type AccessRequest,
  type CloudGuest,
  type CloudRoom,
  type RoomFailure,
} from "./room.ts";

/**
 * Someone signed in who can only look at a board asks to edit it; whoever manages it approves or
 * declines from their inbox. Approving gives their account a seat that can edit, at once.
 */

/** Requests one board keeps: every open one, then the newest answered. */
const MAX_REQUESTS = 20;

/**
 * Asks for edit access as `account`: someone on the board who can only look, or someone looking
 * on from its view link (`viewing`). One open request per person.
 */
/** The request this account asked on the board that is still open, which its pages show as asked. */
export const openRequestOf = (room: CloudRoom | null, account: string) =>
  room?.requests?.find((request) => request.account === account && request.status === "open");

export function askAccess(
  room: CloudRoom | null,
  input: {
    readonly id: string;
    readonly account: string;
    readonly name: string;
    readonly message?: string | undefined;
    readonly viewing: boolean;
    readonly now: string;
  },
): Result.Result<{ readonly room: CloudRoom; readonly request: AccessRequest }, RoomFailure> {
  if (room === null) return Result.fail(roomFailure("ended"));
  const guest = accountGuestOf(room, input.account);
  if (guest?.locked === true) return Result.fail(roomFailure("ended"));
  if (guest !== undefined && canChange(guest)) {
    return Result.fail(roomFailure("rejected", "You can already edit this board."));
  }
  if (guest === undefined && !input.viewing) return Result.fail(roomFailure("invalid"));
  const requests = room.requests ?? [];
  if (requests.some((request) => request.account === input.account && request.status === "open")) {
    return Result.fail(roomFailure("asked"));
  }
  const open = requests.filter((request) => request.status === "open");
  if (open.length >= MAX_REQUESTS) {
    return Result.fail(
      roomFailure("limit", "This board has as many open requests as it holds. Try again later."),
    );
  }
  const message = input.message?.replace(/\s+/g, " ").trim();
  const request: AccessRequest = {
    id: input.id,
    account: input.account,
    name: input.name,
    ...(message === undefined || message === "" ? {} : { message }),
    at: input.now,
    status: "open",
  };
  const answeredBefore = requests.filter((candidate) => candidate.status !== "open");
  const answered = answeredBefore.slice(
    Math.max(0, answeredBefore.length - (MAX_REQUESTS - open.length - 1)),
  );
  return Result.succeed({
    room: { ...room, requests: [...answered, ...open, request] },
    request,
  });
}

/**
 * Approves or declines a request, for whoever manages the board (`manages`). Approving lets their
 * seat edit, or gives their account a new seat that can (`guestId`) when they were only looking.
 */
export function answerAccess(
  room: CloudRoom | null,
  input: {
    readonly requestId: string;
    readonly approve: boolean;
    readonly manages: boolean;
    readonly guestId: GuestId;
    readonly now: string;
  },
): Result.Result<
  {
    readonly room: CloudRoom;
    readonly request: AccessRequest;
    /** Their seat, approved. */
    readonly seat: CloudGuest | null;
  },
  RoomFailure
> {
  if (room === null) return Result.fail(roomFailure("ended"));
  if (!input.manages) return Result.fail(roomFailure("not_maker"));
  const request = room.requests?.find((candidate) => candidate.id === input.requestId);
  if (request === undefined) {
    return Result.fail(roomFailure("rejected", "This request is no longer here."));
  }
  if (request.status !== "open") {
    return Result.fail(roomFailure("rejected", "Someone already answered this request."));
  }
  const answered: AccessRequest = {
    ...request,
    status: input.approve ? "approved" : "declined",
    answeredAt: input.now,
  };
  const withAnswer = (next: CloudRoom): CloudRoom => ({
    ...next,
    requests: (next.requests ?? []).map((candidate) =>
      candidate.id === request.id ? answered : candidate,
    ),
    updatedAt: input.now,
  });
  if (!input.approve)
    return Result.succeed({ room: withAnswer(room), request: answered, seat: null });
  const guest = accountGuestOf(room, request.account);
  if (guest?.locked === true) {
    return Result.fail(roomFailure("rejected", "They are no longer in this board's workspace."));
  }
  if (guest !== undefined) {
    const changed = withRole(room, true, guest.id, "edit", input.now);
    if (Result.isFailure(changed)) return Result.fail(changed.failure);
    const next = withAnswer(changed.success);
    return Result.succeed({
      room: next,
      request: answered,
      seat: next.guests.find((candidate) => candidate.id === guest.id) ?? null,
    });
  }
  if (room.guests.length >= CLOUD_BOARD_MAX_GUESTS) return Result.fail(roomFailure("full"));
  // No session yet: their account opens the board as this seat, from their page or any device.
  const seat: CloudGuest = {
    id: input.guestId,
    name: freeGuestName(room.guests, request.name),
    joinedAt: input.now,
    sessionHash: "",
    accountId: request.account,
  };
  return Result.succeed({
    room: withAnswer({ ...room, guests: [...room.guests, seat] }),
    request: answered,
    seat,
  });
}

/** The item whoever manages the board gets, the same id for each, so an answer updates them all. */
export const accessRequestItem = (
  room: CloudRoom,
  request: AccessRequest,
  read = false,
): CloudInboxItem => ({
  id: `access:${request.id}`,
  kind: "access-request",
  at: request.at,
  ...(read ? { read: true as const } : {}),
  by: request.name,
  title: room.title,
  shareId: room.shareId,
  threadId: room.threadId,
  ...(room.workspaceId === undefined ? {} : { workspaceId: room.workspaceId }),
  ...(request.message === undefined ? {} : { excerpt: inboxExcerpt(request.message) }),
  request: { id: request.id, status: request.status },
});

/** The item the person who asked gets once their request is answered. */
export const accessAnswerItem = (
  room: CloudRoom,
  request: AccessRequest,
  by: string,
): CloudInboxItem => ({
  id: `answer:${request.id}`,
  kind: "access-answer",
  at: request.answeredAt ?? request.at,
  by,
  title: room.title,
  shareId: room.shareId,
  threadId: room.threadId,
  ...(room.workspaceId === undefined ? {} : { workspaceId: room.workspaceId }),
  approved: request.status === "approved",
  ...(request.status === "approved" ? { role: "edit" as const } : {}),
});
