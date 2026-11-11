import {
  GUEST_PENDING_ATTACHMENT_BYTES_LIMIT,
  GUEST_PENDING_MESSAGE_LIMIT,
  GUEST_RESOLVED_MESSAGE_LIMIT,
  GUEST_SHARE_MAX_GUESTS,
  GUEST_TURN_LIMIT,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_THREAD_CARD,
  guestMessageAuthorName,
  roomBoardAgentCard,
  roomBoardGuestCard,
  type RoomBoard,
  type RoomBoardChange,
  type GuestId,
  type GuestMessageAttribution,
  type GuestMessageId,
  type OrchestrationMessageContext,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  type ThreadGuestMessage,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

export type GuestShareCommand = Extract<
  OrchestrationV2ServerCommand,
  {
    readonly type:
      | "thread.guest-share.open"
      | "thread.guest-share.redeem"
      | "thread.guest-share.close"
      | "thread.guest-message.submit"
      | "thread.guest-message.dismiss"
      | "thread.guest.trust"
      | "thread.guest.identify"
      | "thread.guest.remove"
      | "thread.guest-turn.post"
      | "thread.guest-board.change"
      | "thread.room-link.set";
  }
>;

/** Failures a guest may be told about. Any other dispatch failure reaches them as "rejected". */
export const GUEST_FAILURE = {
  inactive: "This guest link is no longer active.",
  used: "This guest link was already used.",
  full: "This thread already has as many guests as a link allows.",
  closed: "This link is not letting new people in. Ask the owner for a new one.",
  nameTaken: "Someone on this link already uses that name. Pick another.",
  busy: "Wait for the owner to answer your earlier messages.",
  filesBusy: "Wait for the owner to answer your earlier messages before you attach more files.",
  boardFull: "This board has as many notes as it holds. Remove one first.",
} as const;

const isExpired = (share: ThreadGuestShare, now: DateTime.Utc) =>
  DateTime.toEpochMillis(now) >= Date.parse(share.expiresAt);

/**
 * Whether this guest joined the share. No id means the one guest of a link made before several
 * could join, whose session and messages carry none.
 */
export const hasGuest = (share: ThreadGuestShare, guestId: GuestId | undefined) =>
  guestId === undefined
    ? share.guests === undefined && share.guestName !== null
    : share.guests?.some((guest) => guest.id === guestId) === true;

const pendingAttachments = (share: ThreadGuestShare | null) =>
  share?.messages.flatMap((message) =>
    message.status === "pending" ? (message.attachments ?? []) : [],
  ) ?? [];

/**
 * Stored files a share change leaves behind: those of waiting messages that were dismissed or
 * dropped with the share. A sent message keeps its files, which its thread message now holds.
 */
export function releasedGuestAttachmentIds(
  before: ThreadGuestShare | null,
  after: ThreadGuestShare | null,
): ReadonlyArray<string> {
  const kept = new Set(
    after !== null && after.id === before?.id
      ? after.messages.flatMap((message) =>
          message.status === "dismissed"
            ? []
            : (message.attachments ?? []).map((attachment) => attachment.id),
        )
      : [],
  );
  return pendingAttachments(before)
    .map((attachment) => attachment.id)
    .filter((id) => !kept.has(id));
}

/** Keeps every pending message and only the newest resolved ones. */
function trimResolved(messages: ReadonlyArray<ThreadGuestMessage>): Array<ThreadGuestMessage> {
  let resolvedBudget = GUEST_RESOLVED_MESSAGE_LIMIT;
  const kept: Array<ThreadGuestMessage> = [];
  for (const message of messages.toReversed()) {
    if (message.status !== "pending") {
      if (resolvedBudget === 0) continue;
      resolvedBudget -= 1;
    }
    kept.push(message);
  }
  return kept.toReversed();
}

const EMPTY_BOARD: RoomBoard = { positions: {}, notes: [] };

/** The board after one change, the same board when the change does nothing, or why not. */
function changeBoard(
  share: ThreadGuestShare,
  author: GuestId | null,
  change: RoomBoardChange,
): Result.Result<RoomBoard, string> {
  const board = share.board ?? EMPTY_BOARD;
  switch (change.type) {
    case "card.move": {
      // Only cards the room has, so the positions cannot grow without bound.
      const onBoard =
        change.cardId === ROOM_BOARD_THREAD_CARD ||
        share.guests?.some(
          (guest) =>
            change.cardId === roomBoardGuestCard(guest.id) ||
            change.cardId === roomBoardAgentCard(guest.id),
        ) === true;
      if (!onBoard) return Result.fail("This card is not on the board.");
      const at = board.positions[change.cardId];
      if (at?.x === change.x && at.y === change.y) return Result.succeed(board);
      return Result.succeed({
        ...board,
        positions: { ...board.positions, [change.cardId]: { x: change.x, y: change.y } },
      });
    }
    case "note.put": {
      const existing = board.notes.find((note) => note.id === change.noteId);
      const placed = { id: change.noteId, text: change.text, x: change.x, y: change.y };
      if (existing === undefined) {
        if (board.notes.length >= ROOM_BOARD_MAX_NOTES) return Result.fail(GUEST_FAILURE.boardFull);
        return Result.succeed({
          ...board,
          notes: [...board.notes, author === null ? placed : { ...placed, guestId: author }],
        });
      }
      if (existing.text === placed.text && existing.x === placed.x && existing.y === placed.y) {
        return Result.succeed(board);
      }
      // A note stays its author's whoever edits it.
      return Result.succeed({
        ...board,
        notes: board.notes.map((note) => (note === existing ? { ...existing, ...placed } : note)),
      });
    }
    case "note.remove":
      return board.notes.some((note) => note.id === change.noteId)
        ? Result.succeed({
            ...board,
            notes: board.notes.filter((note) => note.id !== change.noteId),
          })
        : Result.succeed(board);
  }
}

/** The board without a removed guest's notes and cards. */
function boardWithoutGuest(board: RoomBoard, guestId: GuestId): RoomBoard {
  const {
    [roomBoardGuestCard(guestId)]: _guest,
    [roomBoardAgentCard(guestId)]: _agent,
    ...positions
  } = board.positions;
  return { positions, notes: board.notes.filter((note) => note.guestId !== guestId) };
}

const resolveMessage = (
  share: ThreadGuestShare,
  guestMessageId: GuestMessageId,
  status: "sent" | "dismissed",
): Result.Result<ThreadGuestShare, string> => {
  const message = share.messages.find((candidate) => candidate.id === guestMessageId);
  if (message === undefined || message.status !== "pending") {
    return Result.fail(`Guest message ${guestMessageId} is not pending.`);
  }
  return Result.succeed({
    ...share,
    messages: trimResolved(
      share.messages.map((candidate) =>
        candidate.id === guestMessageId ? { ...candidate, status } : candidate,
      ),
    ),
  });
};

/**
 * Applies a guest share command to the thread. The orchestrator runs commands one at a time, so
 * checking state here is what makes a link redeem once and a message send once.
 */
export function decideGuestShareCommand(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly command: GuestShareCommand;
  readonly now: DateTime.Utc;
}): Result.Result<OrchestrationV2AppThread, string> {
  const { thread, command, now } = input;
  const share = thread.guestShare ?? null;
  const withShare = (guestShare: ThreadGuestShare | null) =>
    Result.succeed({ ...thread, guestShare, updatedAt: now });

  switch (command.type) {
    case "thread.guest-share.open": {
      if (thread.archivedAt !== null) return Result.fail("Archived threads cannot be shared.");
      return withShare({
        id: command.shareId,
        host: command.host,
        createdAt: DateTime.formatIso(now),
        expiresAt: command.expiresAt,
        guestName: null,
        guests: [],
        messages: [],
      });
    }
    case "thread.guest-share.close":
      return share === null ? Result.succeed(thread) : withShare(null);
    case "thread.guest-share.redeem": {
      if (share === null || share.id !== command.shareId || isExpired(share, now)) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      // A link made before several guests could join was promised to one browser.
      if (share.guests === undefined && share.guestName !== null) {
        return Result.fail(GUEST_FAILURE.used);
      }
      if (share.joinsClosed === true) return Result.fail(GUEST_FAILURE.closed);
      const guests = share.guests ?? [];
      if (guests.length >= GUEST_SHARE_MAX_GUESTS) return Result.fail(GUEST_FAILURE.full);
      // The agent and the owner tell guests apart by name alone.
      const name = command.guestName.toLowerCase();
      if (guests.some((guest) => guest.name.toLowerCase() === name)) {
        return Result.fail(GUEST_FAILURE.nameTaken);
      }
      return withShare({
        ...share,
        guests: [
          ...guests,
          { id: command.guestId, name: command.guestName, joinedAt: DateTime.formatIso(now) },
        ],
      });
    }
    case "thread.guest-message.submit": {
      if (
        share === null ||
        share.id !== command.shareId ||
        !hasGuest(share, command.guestId) ||
        isExpired(share, now)
      ) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      if (
        share.messages.filter(
          (message) => message.status === "pending" && message.guestId === command.guestId,
        ).length >= GUEST_PENDING_MESSAGE_LIMIT
      ) {
        return Result.fail(GUEST_FAILURE.busy);
      }
      const attachments = command.attachments ?? [];
      const pendingBytes = [...pendingAttachments(share), ...attachments].reduce(
        (total, attachment) => total + attachment.sizeBytes,
        0,
      );
      if (attachments.length > 0 && pendingBytes > GUEST_PENDING_ATTACHMENT_BYTES_LIMIT) {
        return Result.fail(GUEST_FAILURE.filesBusy);
      }
      const guestShare: ThreadGuestShare = {
        ...share,
        messages: trimResolved([
          ...share.messages,
          {
            id: command.guestMessageId,
            text: command.text,
            status: "pending",
            submittedAt: DateTime.formatIso(now),
            ...(attachments.length === 0 ? {} : { attachments }),
            ...(command.guestId === undefined ? {} : { guestId: command.guestId }),
            ...(command.direct === true ? { direct: true } : {}),
          },
        ]),
      };
      // A request needs the owner, so a settled thread comes back as a new message brings it.
      return thread.settledOverride === "settled"
        ? Result.succeed({
            ...thread,
            guestShare,
            settledOverride: null,
            settledAt: null,
            unsettledAt: now,
            updatedAt: now,
          })
        : withShare(guestShare);
    }
    case "thread.guest.trust": {
      if (share === null || share.guests?.some((guest) => guest.id === command.guestId) !== true) {
        return Result.fail("This guest is not on the link.");
      }
      return withShare({
        ...share,
        guests: share.guests.map((guest) => {
          if (guest.id !== command.guestId) return guest;
          const { trusted: _trusted, ...rest } = guest;
          return command.trusted ? { ...rest, trusted: true } : rest;
        }),
      });
    }
    case "thread.guest.identify": {
      if (
        share === null ||
        share.id !== command.shareId ||
        share.guests?.some((guest) => guest.id === command.guestId) !== true
      ) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      return withShare({
        ...share,
        guests: share.guests.map((guest) =>
          guest.id === command.guestId
            ? {
                ...guest,
                account: command.account,
                // Signing in never takes away what the owner already switched on by hand.
                ...(command.trusted ? { trusted: true } : {}),
              }
            : guest,
        ),
      });
    }
    case "thread.guest.remove": {
      if (share === null || share.guests?.some((guest) => guest.id === command.guestId) !== true) {
        return Result.fail("This guest is not on the link.");
      }
      // Their waiting messages go with them; the ones the owner sent are the thread's now.
      return withShare({
        ...share,
        joinsClosed: true,
        guests: share.guests.filter((guest) => guest.id !== command.guestId),
        messages: share.messages.filter(
          (message) => message.guestId !== command.guestId || message.status === "sent",
        ),
        ...(share.turns === undefined
          ? {}
          : { turns: share.turns.filter((turn) => turn.guestId !== command.guestId) }),
        ...(share.board === undefined
          ? {}
          : { board: boardWithoutGuest(share.board, command.guestId) }),
      });
    }
    // Only the share changes, and the thread keeps its place in every list: arranging a board
    // starts nothing here and reaches no agent.
    case "thread.guest-board.change": {
      if (
        share === null ||
        share.id !== command.shareId ||
        (command.author !== null && (!hasGuest(share, command.author) || isExpired(share, now)))
      ) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      return Result.map(changeBoard(share, command.author, command.change), (board) =>
        board === (share.board ?? EMPTY_BOARD)
          ? thread
          : { ...thread, guestShare: { ...share, board } },
      );
    }
    // Only the share changes: a guest's own turn starts nothing here and reaches no agent.
    case "thread.guest-turn.post": {
      if (
        share === null ||
        share.id !== command.shareId ||
        share.guests?.some((guest) => guest.id === command.guestId) !== true ||
        isExpired(share, now)
      ) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      const turns = share.turns ?? [];
      if (turns.some((turn) => turn.guestId === command.guestId && turn.id === command.turn.id)) {
        return Result.succeed(thread);
      }
      const { truncated, ...turn } = command.turn;
      return withShare({
        ...share,
        turns: [
          ...turns,
          {
            ...turn,
            guestId: command.guestId,
            postedAt: DateTime.formatIso(now),
            ...(truncated === true ? { truncated } : {}),
          },
        ].slice(-GUEST_TURN_LIMIT),
      });
    }
    case "thread.room-link.set":
      return (thread.roomLink ?? null) === null && command.roomLink === null
        ? Result.succeed(thread)
        : Result.succeed({ ...thread, roomLink: command.roomLink, updatedAt: now });
    case "thread.guest-message.dismiss": {
      if (share === null) return Result.fail("This thread has no guest link.");
      return Result.map(resolveMessage(share, command.guestMessageId, "dismissed"), (next) => ({
        ...thread,
        guestShare: next,
        updatedAt: now,
      }));
    }
  }
}

/**
 * Marks a guest message sent. `text` is what the agent receives: it names the guest so the agent
 * does not mistake it for the owner's words, and so a guest cannot start a slash command. It also
 * says whether the owner read the message first, so the agent knows how far to rely on it.
 * `guest` lets clients show the guest's own text with their name beside it.
 */
export function decideGuestMessageSend(input: {
  readonly thread: OrchestrationV2AppThread;
  readonly guestMessageId: GuestMessageId;
  readonly now: DateTime.Utc;
}): Result.Result<
  {
    readonly thread: OrchestrationV2AppThread;
    readonly text: string;
    readonly guest: GuestMessageAttribution;
  },
  string
> {
  const share = input.thread.guestShare ?? null;
  if (share === null) return Result.fail("This thread has no guest link.");
  const message = share.messages.find((candidate) => candidate.id === input.guestMessageId);
  const name = guestMessageAuthorName(share, message ?? {});
  const guestText = message?.text ?? "";
  return Result.map(resolveMessage(share, input.guestMessageId, "sent"), (next) => ({
    thread: { ...input.thread, guestShare: next, updatedAt: input.now },
    text:
      message?.direct === true
        ? `Message from guest ${name}, sent without the owner reading it:\n\n${guestText}`
        : `Message from guest ${name}, sent by the owner:\n\n${guestText}`,
    guest: { guestMessageId: input.guestMessageId, name, text: guestText, shareId: share.id },
  }));
}

/**
 * The owner cancelled a queued send, so the agent never got the message. It shows as dismissed,
 * which the guest can see, instead of sent with no reply ever coming. A share that changed since
 * the send is left alone.
 */
export function guestShareAfterCancelledSend(
  thread: OrchestrationV2AppThread,
  guest: Pick<GuestMessageAttribution, "guestMessageId" | "shareId">,
  now: DateTime.Utc,
): OrchestrationV2AppThread {
  const share = thread.guestShare ?? null;
  if (share === null || share.id !== guest.shareId) return thread;
  const message = share.messages.find((candidate) => candidate.id === guest.guestMessageId);
  if (message?.status !== "sent") return thread;
  return {
    ...thread,
    guestShare: {
      ...share,
      messages: share.messages.map((candidate) =>
        candidate.id === guest.guestMessageId ? { ...candidate, status: "dismissed" } : candidate,
      ),
    },
    updatedAt: now,
  };
}

/** Guest attribution comes only from `decideGuestMessageSend`; a client cannot claim it. */
export function withoutGuestAttribution<
  C extends { readonly context?: OrchestrationMessageContext | undefined },
>(command: C): C {
  if (command.context?.guest === undefined) return command;
  const { guest: _guest, ...context } = command.context;
  return { ...command, context };
}
