import {
  GUEST_NAME_MAX_LENGTH,
  GUEST_PENDING_ATTACHMENT_BYTES_LIMIT,
  GUEST_PENDING_MESSAGE_LIMIT,
  GUEST_RESOLVED_MESSAGE_LIMIT,
  GUEST_SHARE_MAX_GUESTS,
  TEAM_SHARE_MAX_GUESTS,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  ROOM_BOX_CONTEXT_KIND,
  guestMessageAuthorName,
  roomBoardAgentCard,
  roomBoardCardRef,
  roomBoardGuestCard,
  unsharedRoomId,
  type RoomBoard,
  type GuestId,
  type GuestMessageAttribution,
  type GuestMessageId,
  type GuestShareId,
  type ComposerContextRecord,
  type OrchestrationMessageContext,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  type ThreadGuestMessage,
  type ThreadGuestShare,
  type ThreadId,
  type ThreadRoomBoard,
} from "@t3tools/contracts";
import {
  formatComposerContextReference,
  roomArtifactContextRecord,
  toKindScopedComposerContextId,
} from "@t3tools/shared/composerContextReferences";
import {
  EMPTY_ROOM_BOARD,
  ROOM_BOARD_FULL,
  applyRoomBoardChange,
  roomArtifactSource,
  roomBoardCardIdentity,
  roomBoardNoteOfRef,
  roomBoardWithCardsSent,
  roomBoardWithEdges,
  roomBoardWithoutCards,
  type RoomBoardScope,
} from "@t3tools/shared/roomBoard";
import {
  ROOM_BOX_NOT_YOURS,
  roomAfterGuestTurn,
  roomBoardAfterChange,
  roomBoardWithArtifactFilled,
  roomBoardWithBoxChanges,
  roomBoardWithBoxTurn,
  roomBoardWithCommentAnswer,
  roomBoardWithTaskAnswered,
  roomBoardWithoutGuest,
  roomBoxOn,
} from "@t3tools/shared/guestRoom";
import * as DateTime from "effect/DateTime";
import * as Result from "effect/Result";

export type GuestShareCommand = Extract<
  OrchestrationV2ServerCommand,
  {
    readonly type:
      | "thread.guest-share.open"
      | "thread.guest-share.extend"
      | "thread.guest-share.redeem"
      | "thread.guest-share.close"
      | "thread.room-board.clear"
      | "thread.guest-message.submit"
      | "thread.guest-message.dismiss"
      | "thread.guest.trust"
      | "thread.guest.identify"
      | "thread.guest.remove"
      | "thread.guest-turn.post"
      | "thread.guest-board.change"
      | "thread.room-task.answer"
      | "thread.room-artifact.fill"
      | "thread.room-comment.answer"
      | "thread.room-box.link"
      | "thread.room-box.turn"
      | "thread.room-box.changes"
      | "thread.room-pull-request.read"
      | "thread.room-cards.sent"
      | "thread.guest-message.route"
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
  boardFull: ROOM_BOARD_FULL,
  removed: "The owner removed you from this thread.",
  memberJoined: "This member already joined.",
  artifactGone: "This artifact is no longer on the board.",
  boxGone: "This thread box is no longer on the board.",
  boxNotYours: ROOM_BOX_NOT_YOURS,
  threadOnBoard: "This thread is already on the board.",
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

/**
 * A room as the server works on its board: a thread's share, or while the thread is not shared,
 * the board kept on it, which only its owner works on.
 */
export type ThreadRoom = Pick<
  ThreadGuestShare,
  "id" | "board" | "boardThreads" | "guests" | "messages"
>;

/** The thread's room: its share, or its kept board (none until its first change) by its own id. */
export function threadRoomOf(thread: OrchestrationV2AppThread): ThreadRoom {
  const share = thread.guestShare ?? null;
  if (share !== null) return share;
  const kept = thread.roomBoard ?? null;
  return {
    id: unsharedRoomId(thread.id),
    messages: [],
    ...(kept === null ? {} : { board: kept.board }),
    ...(kept?.boardThreads === undefined ? {} : { boardThreads: kept.boardThreads }),
  };
}

/**
 * The room a command names, if it is the thread's now, and the thread with that room's board and
 * box threads replaced. An unshared board with nothing on it is not kept.
 */
function namedRoom(thread: OrchestrationV2AppThread, roomId: GuestShareId) {
  const share = thread.guestShare ?? null;
  const room = threadRoomOf(thread);
  if (room.id !== roomId) return null;
  const withBoard = (
    board: RoomBoard | undefined,
    boardThreads: ThreadRoom["boardThreads"],
  ): OrchestrationV2AppThread => {
    const state = {
      ...(board === undefined ? {} : { board }),
      ...(boardThreads === undefined || Object.keys(boardThreads).length === 0
        ? {}
        : { boardThreads }),
    };
    if (share !== null) {
      const { board: _board, boardThreads: _threads, ...rest } = share;
      return { ...thread, guestShare: { ...rest, ...state } };
    }
    return {
      ...thread,
      roomBoard: state.board === undefined ? null : { ...state, board: state.board },
    };
  };
  return { room, share, withBoard };
}

/**
 * The thread with the board of the room a command names changed by `change`: the same thread when
 * the room is no longer the thread's, has no board, or the change leaves it as it was.
 */
function withRoomBoard(
  thread: OrchestrationV2AppThread,
  roomId: GuestShareId,
  change: (board: RoomBoard) => RoomBoard,
): OrchestrationV2AppThread {
  const named = namedRoom(thread, roomId);
  const board = named?.room.board;
  if (named === null || board === undefined) return thread;
  const next = change(board);
  return next === board ? thread : named.withBoard(next, named.room.boardThreads);
}

/** Only cards the room has, so the positions and arrows cannot grow without bound. */
const isRoomCard = (room: ThreadRoom, cardId: string) =>
  cardId === ROOM_BOARD_THREAD_CARD ||
  room.guests?.some(
    (guest) => cardId === roomBoardGuestCard(guest.id) || cardId === roomBoardAgentCard(guest.id),
  ) === true;

export const roomScope = (room: ThreadRoom): RoomBoardScope => ({
  hasCard: (cardId) => isRoomCard(room, cardId),
  hasPerson: (guestId) => room.guests?.some((guest) => guest.id === guestId) === true,
});

// A view names the artifact it shows.
const artifactOn = (share: Pick<ThreadRoom, "board">, noteId: string | undefined) =>
  roomArtifactSource(share.board, noteId);

/**
 * Names the people of a room for labels everyone reads: a guest by name, and the owner, with no
 * id, by the name they set for guests, or none so the label says "the owner".
 */
export const roomPersonName =
  (share: Pick<ThreadRoom, "guests" | "board">, ownerName: string) =>
  (guestId: GuestId | undefined): string | undefined =>
    guestId === undefined
      ? ownerName.trim().slice(0, GUEST_NAME_MAX_LENGTH).trim() || undefined
      : (share.guests?.find((guest) => guest.id === guestId)?.name ??
        share.board?.people?.find((person) => person.guestId === guestId)?.name);

/** Every guest the board names: on a card, a task, an artifact, a box's turns, a reply or a reaction. */
function boardGuestIds(board: RoomBoard): ReadonlySet<GuestId | undefined> {
  return new Set(
    board.notes.flatMap((note) => [
      note.guestId,
      note.assignee?.guestId,
      note.answer?.guestId,
      note.artifact?.guestId,
      note.artifact?.askedBy,
      note.artifact?.previous?.guestId,
      note.artifact?.previous?.askedBy,
      note.changes?.guestId,
      ...(note.thread?.turns.flatMap((turn) => [turn.guestId, turn.askedBy]) ?? []),
      ...(note.replies?.flatMap((reply) => [
        reply.guestId,
        ...(reply.reactions?.map((reaction) => reaction.guestId) ?? []),
      ]) ?? []),
      ...(note.reactions?.map((reaction) => reaction.guestId) ?? []),
    ]),
  );
}

/**
 * The board as it outlives a share. Its guests leave the room: their own cards go, and what they
 * added stays under the name they had, as nobody's. Only the owner's thread boxes keep a thread.
 */
function roomBoardAfterShare(share: ThreadGuestShare): ThreadRoomBoard | null {
  const board = share.board;
  if (board === undefined) return null;
  const guests = share.guests ?? [];
  const cards = guests.flatMap((guest) => [
    roomBoardGuestCard(guest.id),
    roomBoardAgentCard(guest.id),
  ]);
  const gone = new Set(cards.map(roomBoardCardRef));
  const { people: _earlier, ...withoutCards } = roomBoardWithEdges(
    roomBoardWithoutCards(board, cards),
    (edge) => !gone.has(edge.from) && !gone.has(edge.to),
  );
  const named = new Map((board.people ?? []).map((person) => [person.guestId, person.name]));
  for (const guest of guests) named.set(guest.id, guest.name);
  const onBoard = boardGuestIds(withoutCards);
  const people = [...named]
    .filter(([guestId]) => onBoard.has(guestId))
    .map(([guestId, name]) => ({ guestId, name }));
  const ownersBoxes = Object.entries(share.boardThreads ?? {}).filter(([boxId]) => {
    const box = roomBoxOn(share, boxId);
    return box !== undefined && box.guestId === undefined;
  });
  return {
    board: people.length === 0 ? withoutCards : { ...withoutCards, people },
    ...(ownersBoxes.length === 0 ? {} : { boardThreads: Object.fromEntries(ownersBoxes) }),
  };
}

/** The thread with its share ended, and the share's board kept for the next one. */
export function threadWithoutGuestShare(
  thread: OrchestrationV2AppThread,
): OrchestrationV2AppThread {
  const share = thread.guestShare ?? null;
  const kept = share === null ? null : roomBoardAfterShare(share);
  return { ...thread, guestShare: null, ...(kept === null ? {} : { roomBoard: kept }) };
}

/** The labels of the cards these arrow refs name on the share's board, as everyone reads them. */
export const roomCardLabels = (
  share: Pick<ThreadRoom, "guests" | "board">,
  ownerName: string,
  refs: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  refs.flatMap((ref) => {
    const note = roomBoardNoteOfRef(share.board, ref);
    return note === undefined
      ? []
      : [roomBoardCardIdentity(note, roomPersonName(share, ownerName)).label];
  });

/** The box threads of the boxes this board still has. */
const liveBoardThreads = (board: RoomBoard, threads: ThreadRoom["boardThreads"]) =>
  threads === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(threads).filter(([boxId]) => roomBoxOn({ board }, boxId) !== undefined),
      );

/** The share with the lines a guest's message carried into its box marked sent, as it is sent. */
const withMessageCardsSent = (
  share: ThreadGuestShare,
  message: ThreadGuestMessage | undefined,
  now: DateTime.Utc,
): ThreadGuestShare => {
  if (message?.cardRefs === undefined || share.board === undefined) return share;
  const board = roomBoardWithCardsSent(
    share.board,
    message.boxId ?? ROOM_BOARD_ROOM_BOX,
    message.artifactId,
    message.cardRefs,
    DateTime.formatIso(now),
  );
  return board === share.board ? share : { ...share, board };
};

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
    // A new share takes the board of the one it replaces, or the one kept since the last ended.
    case "thread.guest-share.open": {
      if (thread.archivedAt !== null) return Result.fail("Archived threads cannot be shared.");
      const { roomBoard: kept, ...unshared } = threadWithoutGuestShare(thread);
      return Result.succeed({
        ...unshared,
        ...(kept === undefined ? {} : { roomBoard: null }),
        guestShare: {
          id: command.shareId,
          host: command.host,
          createdAt: DateTime.formatIso(now),
          expiresAt: command.expiresAt,
          guestName: null,
          guests: [],
          messages: [],
          ...(command.team === undefined ? {} : { team: command.team }),
          ...(kept === undefined || kept === null
            ? {}
            : {
                board: kept.board,
                ...(kept.boardThreads === undefined ? {} : { boardThreads: kept.boardThreads }),
              }),
        },
        updatedAt: now,
      });
    }
    case "thread.guest-share.extend": {
      if (
        share === null ||
        share.id !== command.shareId ||
        share.team !== undefined ||
        share.joinsClosed === true ||
        isExpired(share, now)
      ) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      if (Date.parse(command.expiresAt) <= Date.parse(share.expiresAt)) {
        return Result.fail("A link can only be made to last longer.");
      }
      return withShare({ ...share, expiresAt: command.expiresAt, extended: true });
    }
    case "thread.guest-share.close":
      return share === null
        ? Result.succeed(thread)
        : Result.succeed({ ...threadWithoutGuestShare(thread), updatedAt: now });
    // Only the board goes: the share and its guests stay, and the threads behind its boxes stay
    // the owner's, unlinked.
    case "thread.room-board.clear": {
      if (share?.board !== undefined) {
        const { board: _board, boardThreads: _threads, ...cleared } = share;
        return Result.succeed({ ...thread, guestShare: cleared });
      }
      return (thread.roomBoard ?? null) === null
        ? Result.succeed(thread)
        : Result.succeed({ ...thread, roomBoard: null });
    }
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
      // A team share takes only members, each once.
      const member = command.member;
      if ((share.team === undefined) !== (member === undefined)) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      if (member !== undefined) {
        if (share.removedMembers?.includes(member.userId) === true) {
          return Result.fail(GUEST_FAILURE.removed);
        }
        if (guests.some((guest) => guest.member?.userId === member.userId)) {
          return Result.fail(GUEST_FAILURE.memberJoined);
        }
      }
      const maxGuests = share.team === undefined ? GUEST_SHARE_MAX_GUESTS : TEAM_SHARE_MAX_GUESTS;
      if (guests.length >= maxGuests) return Result.fail(GUEST_FAILURE.full);
      // The agent and the owner tell guests apart by name alone.
      const name = command.guestName.toLowerCase();
      if (guests.some((guest) => guest.name.toLowerCase() === name)) {
        return Result.fail(GUEST_FAILURE.nameTaken);
      }
      return withShare({
        ...share,
        guests: [
          ...guests,
          {
            id: command.guestId,
            name: command.guestName,
            joinedAt: DateTime.formatIso(now),
            ...(member === undefined ? {} : { member }),
          },
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
      if (command.artifactId !== undefined && artifactOn(share, command.artifactId) === undefined) {
        return Result.fail(GUEST_FAILURE.artifactGone);
      }
      // The room thread's card is the owner's and takes guests' messages as it always has.
      if (command.boxId !== undefined && command.boxId !== ROOM_BOARD_ROOM_BOX) {
        const box = roomBoxOn(share, command.boxId);
        if (box === undefined) return Result.fail(GUEST_FAILURE.boxGone);
        if (command.guestId === undefined || box.guestId !== command.guestId) {
          return Result.fail(GUEST_FAILURE.boxNotYours);
        }
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
            ...(command.artifactId === undefined ? {} : { artifactId: command.artifactId }),
            ...(command.boxId === undefined ? {} : { boxId: command.boxId }),
            ...(command.cards === undefined || command.cards.length === 0
              ? {}
              : { cards: command.cards }),
            ...(command.cardRefs === undefined || command.cardRefs.length === 0
              ? {}
              : { cardRefs: command.cardRefs }),
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
      // A member is known by account, so only they are kept out, and not when they left the team,
      // which keeps them out until they are back in it; anyone else could rejoin under another
      // name, so the link stops letting new people in.
      const removedMember = share.guests.find((guest) => guest.id === command.guestId)?.member;
      // Their waiting messages go with them; the ones the owner sent are the thread's now.
      return withShare({
        ...share,
        ...(removedMember === undefined
          ? { joinsClosed: true }
          : command.membershipEnded === true
            ? {}
            : { removedMembers: [...(share.removedMembers ?? []), removedMember.userId] }),
        guests: share.guests.filter((guest) => guest.id !== command.guestId),
        messages: share.messages.filter(
          (message) => message.guestId !== command.guestId || message.status === "sent",
        ),
        ...(share.turns === undefined
          ? {}
          : { turns: share.turns.filter((turn) => turn.guestId !== command.guestId) }),
        ...(share.board === undefined
          ? {}
          : { board: roomBoardWithoutGuest(share.board, command.guestId) }),
      });
    }
    // The owner's thread behind a thread box: it stays when the box goes, unlinked.
    case "thread.room-box.link": {
      const named = namedRoom(thread, command.shareId);
      if (named === null) return Result.fail(GUEST_FAILURE.inactive);
      const { room, withBoard } = named;
      const threads = room.boardThreads ?? {};
      if (command.boxThreadId === null) {
        if (threads[command.boxId] === undefined) return Result.succeed(thread);
        const { [command.boxId]: _gone, ...kept } = threads;
        return Result.succeed(withBoard(room.board, kept));
      }
      if (command.box !== undefined) {
        const { turn, ...at } = command.box;
        const boxThreadId = command.boxThreadId;
        if (room.board?.notes.some((note) => note.id === command.boxId) === true) {
          return Result.fail("A card with this id is already on the board.");
        }
        // One box per thread, so a run always shows on one box.
        if (Object.values(threads).includes(boxThreadId)) {
          return Result.fail(GUEST_FAILURE.threadOnBoard);
        }
        return Result.map(
          applyRoomBoardChange(
            room.board ?? EMPTY_ROOM_BOARD,
            roomScope(room),
            null,
            { type: "note.put", noteId: command.boxId, kind: "thread", ...at },
            DateTime.formatIso(now),
          ),
          (added) =>
            withBoard(
              turn === undefined ? added : roomBoardWithBoxTurn(added, command.boxId, turn),
              {
                ...threads,
                [command.boxId]: boxThreadId,
              },
            ),
        );
      }
      // A guest's box runs here too while its requests come through the owner.
      if (roomBoxOn(room, command.boxId) === undefined) return Result.fail(GUEST_FAILURE.boxGone);
      if (threads[command.boxId] === command.boxThreadId) return Result.succeed(thread);
      return Result.succeed(
        withBoard(room.board, { ...threads, [command.boxId]: command.boxThreadId }),
      );
    }
    // Like an artifact's fill: the box's turn already ran, and the room only sees it.
    case "thread.room-box.turn":
      return Result.succeed(
        withRoomBoard(thread, command.shareId, (board) =>
          roomBoardWithBoxTurn(board, command.boxId, command.turn),
        ),
      );
    // Only the owner's own boxes: a guest's box shows what their machine posts with their turn.
    case "thread.room-box.changes":
      return Result.succeed(
        withRoomBoard(thread, command.shareId, (board) =>
          roomBoxOn({ board }, command.boxId)?.guestId !== undefined
            ? board
            : roomBoardWithBoxChanges(board, command.boxId, {
                ...command.changes,
                turnId: command.turnId,
                updatedAt: DateTime.formatIso(now),
              }),
        ),
      );
    // A read lands only on the window that still names the pull request it read.
    case "thread.room-pull-request.read":
      return Result.succeed(
        withRoomBoard(thread, command.shareId, (board) => {
          const window = board.notes.find(
            (note) =>
              note.id === command.noteId &&
              note.kind === "pull-request" &&
              note.url === command.url,
          );
          if (window === undefined) return board;
          const read = { ...window, pullRequest: command.read };
          return { ...board, notes: board.notes.map((note) => (note === window ? read : note)) };
        }),
      );
    // Dispatched by the owner's server once it took the owner's own prompt from a box, and again
    // with `settled` once the run that carried the cards ended.
    case "thread.room-cards.sent":
      return Result.succeed(
        withRoomBoard(thread, command.shareId, (board) =>
          roomBoardWithCardsSent(
            board,
            command.boxId,
            command.artifactId,
            command.cardRefs,
            DateTime.formatIso(now),
            command.settled,
          ),
        ),
      );
    case "thread.guest-message.route": {
      if (share === null) return Result.fail("This thread has no guest link.");
      const message = share.messages.find((candidate) => candidate.id === command.guestMessageId);
      if (command.sentAs === null) {
        // Only a send this server routed and that then failed goes back to waiting.
        if (message?.status !== "sent" || message.sentAs === undefined) {
          return Result.succeed(thread);
        }
        const { sentAs: _sentAs, ...waiting } = message;
        return withShare({
          ...share,
          messages: share.messages.map((candidate) =>
            candidate === message ? { ...waiting, status: "pending" } : candidate,
          ),
        });
      }
      const sentAs = command.sentAs;
      return Result.map(resolveMessage(share, command.guestMessageId, "sent"), (next) => ({
        ...thread,
        guestShare: {
          ...withMessageCardsSent(next, message, now),
          messages: next.messages.map((candidate) =>
            candidate.id === command.guestMessageId ? { ...candidate, sentAs } : candidate,
          ),
        },
        updatedAt: now,
      }));
    }
    // Only the board changes, and the thread keeps its place in every list: arranging a board
    // starts nothing here and reaches no agent. Unshared, only the owner has the board.
    case "thread.guest-board.change": {
      const named = namedRoom(thread, command.shareId);
      if (
        named === null ||
        (command.author !== null &&
          (share === null || !hasGuest(share, command.author) || isExpired(share, now)))
      ) {
        return Result.fail(GUEST_FAILURE.inactive);
      }
      const { room, withBoard } = named;
      const before = room.board ?? EMPTY_ROOM_BOARD;
      // A removed thread box forgets its thread, which stays the owner's.
      return Result.map(
        roomBoardAfterChange(
          room,
          roomScope(room),
          command.author,
          command.change,
          command.agent,
          DateTime.formatIso(now),
        ),
        (board) =>
          board === before ? thread : withBoard(board, liveBoardThreads(board, room.boardThreads)),
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
      const next = roomAfterGuestTurn(
        share,
        command.guestId,
        command.turn,
        DateTime.formatIso(now),
      );
      return next === share ? Result.succeed(thread) : withShare(next);
    }
    // The owner's turn already ran; this only shows on the board which task it answered.
    case "thread.room-task.answer":
      return Result.succeed(
        withRoomBoard(thread, command.shareId, (board) =>
          roomBoardWithTaskAnswered(board, command.taskId, undefined, command.turn),
        ),
      );
    // Like a task's answer: the owner's turn already ran, and the room only sees what it wrote.
    case "thread.room-artifact.fill":
      return Result.succeed(
        withRoomBoard(thread, command.shareId, (board) =>
          roomBoardWithArtifactFilled(board, command.noteId, {
            body: command.body,
            ...(command.truncated === true ? { truncated: true } : {}),
            ...(command.askedBy === undefined ? {} : { askedBy: command.askedBy }),
            turnId: command.turnId,
            updatedAt: DateTime.formatIso(now),
            ...(command.prompt === undefined ? {} : { prompt: command.prompt }),
            ...(command.cards === undefined || command.cards.length === 0
              ? {}
              : { cards: command.cards }),
            ...(command.boxId === undefined ? {} : { boxId: command.boxId }),
            ...(command.model === undefined ? {} : { model: command.model }),
          }),
        ),
      );
    // Like an artifact's fill: the owner's turn already ran, and the thread only shows its answer.
    case "thread.room-comment.answer":
      return Result.succeed(
        withRoomBoard(thread, command.shareId, (board) =>
          roomBoardWithCommentAnswer(board, command.noteId, {
            guestId: undefined,
            text: command.text,
            at: DateTime.formatIso(now),
            agent: {
              turnId: command.turnId,
              boxId: command.boxId,
              ...(command.model === undefined ? {} : { model: command.model }),
            },
          }),
        ),
      );
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
 * Marks a guest message sent. `text` names the guest, and whether the owner read it, so the agent
 * neither mistakes it for the owner's words nor runs a guest's slash command. `guest` lets clients
 * show the guest's own text with their name. `records`, the only ones the message carries, hold
 * the artifact card it names as this board has it now, or nothing once the card is gone.
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
    readonly records: ReadonlyArray<ComposerContextRecord>;
  },
  string
> {
  const share = input.thread.guestShare ?? null;
  if (share === null) return Result.fail("This thread has no guest link.");
  const message = share.messages.find((candidate) => candidate.id === input.guestMessageId);
  const built = guestMessageForAgent(share, input.thread.id, input.guestMessageId, message);
  return Result.map(resolveMessage(share, input.guestMessageId, "sent"), (next) => ({
    thread: {
      ...input.thread,
      guestShare: withMessageCardsSent(next, message, input.now),
      updatedAt: input.now,
    },
    text: built.text,
    guest: built.guest,
    records: built.records,
  }));
}

/**
 * A guest's message as the owner's agent gets it: text that names the guest and whether the
 * owner read it, and only records this server builds. `boxId` names the guest's own thread box
 * when the message goes to that box's thread, which the box record lets the server find again.
 */
export function guestMessageForAgent(
  share: ThreadGuestShare,
  roomThreadId: ThreadId,
  guestMessageId: GuestMessageId,
  message: ThreadGuestMessage | undefined,
  boxId: string = ROOM_BOARD_ROOM_BOX,
): {
  readonly text: string;
  readonly guest: GuestMessageAttribution;
  readonly records: ReadonlyArray<ComposerContextRecord>;
} {
  const name = guestMessageAuthorName(share, message ?? {});
  const guestText = message?.text ?? "";
  const artifact = artifactOn(share, message?.artifactId);
  const artifactRecords =
    artifact === undefined
      ? []
      : [
          roomArtifactContextRecord({
            batch: guestMessageId,
            shareId: share.id,
            noteId: artifact.id,
            title: artifact.text,
            current: artifact.artifact?.body,
            writer: roomBoardCardIdentity(artifact, roomPersonName(share, "")),
            threadId: roomThreadId,
            boxId,
          }),
        ];
  const chips = artifactRecords
    .map((record) => `\n\n${formatComposerContextReference(record)}`)
    .join("");
  return {
    text:
      (message?.direct === true
        ? `Message from guest ${name}, sent without the owner reading it:\n\n${guestText}`
        : `Message from guest ${name}, sent by the owner:\n\n${guestText}`) + chips,
    guest: { guestMessageId, name, text: guestText, shareId: share.id },
    records:
      boxId === ROOM_BOARD_ROOM_BOX
        ? artifactRecords
        : [...artifactRecords, roomBoxContextRecord(guestMessageId, share.id, boxId)],
  };
}

/** Ties a message in a thread box's own thread to the box. The text never references it. */
export function roomBoxContextRecord(
  batch: string,
  shareId: ThreadGuestShare["id"],
  boxId: string,
): ComposerContextRecord {
  return {
    version: 1,
    kind: ROOM_BOX_CONTEXT_KIND,
    contextId: toKindScopedComposerContextId(ROOM_BOX_CONTEXT_KIND, batch),
    label: "Thread box",
    payload: { shareId, boxId },
  };
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
