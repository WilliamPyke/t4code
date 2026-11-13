import {
  GUEST_PENDING_ATTACHMENT_BYTES_LIMIT,
  GUEST_PENDING_MESSAGE_LIMIT,
  GUEST_RESOLVED_MESSAGE_LIMIT,
  GUEST_SHARE_MAX_GUESTS,
  GUEST_TURN_LIMIT,
  TEAM_SHARE_MAX_GUESTS,
  ROOM_BOARD_ROOM_BOX,
  ROOM_BOARD_THREAD_CARD,
  ROOM_BOX_CONTEXT_KIND,
  ROOM_BOX_PROMPT_MAX_LENGTH,
  ROOM_BOX_REPLY_MAX_LENGTH,
  ROOM_BOX_TURN_LIMIT,
  guestMessageAuthorName,
  roomBoardAgentCard,
  roomBoardCardRef,
  roomBoardGuestCard,
  roomBoardNoteRef,
  roomTaskAnswerExcerpt,
  type RoomArtifactContent,
  type RoomBoard,
  type RoomBoardNote,
  type GuestId,
  type GuestMessageAttribution,
  type GuestMessageId,
  type ComposerContextRecord,
  type OrchestrationMessageContext,
  type OrchestrationV2AppThread,
  type OrchestrationV2ServerCommand,
  type ThreadGuestMessage,
  type ThreadGuestShare,
  type ThreadId,
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
  roomArtifactAfterFill,
  roomBoardCardIdentity,
  roomBoardNoteOfRef,
  roomBoardWithEdges,
  roomBoardWithoutCards,
  roomBoxExcerpt,
  type RoomBoardScope,
} from "@t3tools/shared/roomBoard";
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
      | "thread.room-task.answer"
      | "thread.room-artifact.fill"
      | "thread.room-box.link"
      | "thread.room-box.turn"
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
  boxNotYours: "This thread box is someone else's. Only your own takes your messages.",
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

/** Only cards the room has, so the positions and arrows cannot grow without bound. */
const isRoomCard = (share: ThreadGuestShare, cardId: string) =>
  cardId === ROOM_BOARD_THREAD_CARD ||
  share.guests?.some(
    (guest) => cardId === roomBoardGuestCard(guest.id) || cardId === roomBoardAgentCard(guest.id),
  ) === true;

const roomScope = (share: ThreadGuestShare): RoomBoardScope => ({
  hasCard: (cardId) => isRoomCard(share, cardId),
  hasPerson: (guestId) => hasGuest(share, guestId),
});

/**
 * The board without a removed guest's notes, replies, cards and the arrows that touched them.
 * Tasks they were given are left with no one, and lose their agent's answers.
 */
function boardWithoutGuest(board: RoomBoard, guestId: GuestId): RoomBoard {
  const withoutCards = roomBoardWithoutCards(board, [
    roomBoardGuestCard(guestId),
    roomBoardAgentCard(guestId),
  ]);
  const gone = new Set([
    roomBoardCardRef(roomBoardGuestCard(guestId)),
    roomBoardCardRef(roomBoardAgentCard(guestId)),
    ...board.notes.flatMap((note) => (note.guestId === guestId ? [roomBoardNoteRef(note.id)] : [])),
  ]);
  return roomBoardWithEdges(
    {
      ...withoutCards,
      notes: board.notes.flatMap((note) => {
        if (note.guestId === guestId) return [];
        const theirs = note.replies?.some((reply) => reply.guestId === guestId) === true;
        if (!theirs && note.assignee?.guestId !== guestId && note.answer?.guestId !== guestId) {
          return [note];
        }
        const { assignee, answer, replies, ...rest } = note;
        const kept = replies?.filter((reply) => reply.guestId !== guestId) ?? [];
        return [
          {
            ...rest,
            ...(assignee === undefined || assignee.guestId === guestId ? {} : { assignee }),
            ...(answer === undefined || answer.guestId === guestId ? {} : { answer }),
            ...(kept.length === 0 ? {} : { replies: kept }),
          },
        ];
      }),
    },
    (edge) => !gone.has(edge.from) && !gone.has(edge.to),
  );
}

/**
 * The board with a task marked done and answered by this person's agent: a guest's, or the
 * owner's when `guestId` is undefined. Only a task that is no one's or already this person's
 * takes it; any other id, or the same turn again, leaves the board as it was.
 */
function boardWithTaskAnswered(
  board: RoomBoard,
  taskId: string,
  guestId: GuestId | undefined,
  turn: { readonly id: string; readonly reply: string },
): RoomBoard {
  const task = board.notes.find((note) => note.id === taskId);
  if (
    task?.kind !== "task" ||
    (task.assignee !== undefined && task.assignee.guestId !== guestId) ||
    (task.answer?.turnId === turn.id && task.answer.guestId === guestId)
  ) {
    return board;
  }
  const person = guestId === undefined ? {} : { guestId };
  const answered: RoomBoardNote = {
    ...task,
    done: true,
    assignee: person,
    answer: { ...person, excerpt: roomTaskAnswerExcerpt(turn.reply), turnId: turn.id },
  };
  return { ...board, notes: board.notes.map((note) => (note === task ? answered : note)) };
}

/**
 * The board with an artifact card showing what an agent replied, and the version it replaced
 * kept. Only an artifact card takes it; any other id, or the same turn again, leaves the board
 * as it was. The last turn to finish wins.
 */
function boardWithArtifactFilled(
  board: RoomBoard,
  noteId: string,
  content: Omit<RoomArtifactContent, "previous">,
): RoomBoard {
  const note = board.notes.find((candidate) => candidate.id === noteId);
  const sameTurn = (version: Pick<RoomArtifactContent, "turnId" | "guestId"> | undefined) =>
    version?.turnId === content.turnId && version.guestId === content.guestId;
  // A turn that already wrote it, even one someone restored away since, writes nothing again.
  if (note?.kind !== "artifact" || sameTurn(note.artifact) || sameTurn(note.artifact?.previous)) {
    return board;
  }
  const filled: RoomBoardNote = {
    ...note,
    artifact: roomArtifactAfterFill(note.artifact, content),
  };
  return { ...board, notes: board.notes.map((other) => (other === note ? filled : other)) };
}

const artifactOn = (share: ThreadGuestShare, noteId: string | undefined) =>
  noteId === undefined
    ? undefined
    : share.board?.notes.find((note) => note.id === noteId && note.kind === "artifact");

/**
 * Names the people of a room for labels everyone reads: a guest by name, and the owner, with no
 * id, by the name they set for guests, or none so the label says "the owner".
 */
export const roomPersonName =
  (share: ThreadGuestShare, ownerName: string) =>
  (guestId: GuestId | undefined): string | undefined =>
    guestId === undefined
      ? ownerName.trim() || undefined
      : share.guests?.find((guest) => guest.id === guestId)?.name;

/** The labels of the cards these arrow refs name on the share's board, as everyone reads them. */
export const roomCardLabels = (
  share: ThreadGuestShare,
  ownerName: string,
  refs: ReadonlyArray<string>,
): ReadonlyArray<string> =>
  refs.flatMap((ref) => {
    const note = roomBoardNoteOfRef(share.board, ref);
    return note === undefined
      ? []
      : [roomBoardCardIdentity(note, roomPersonName(share, ownerName)).label];
  });

/** The thread box with this id on the share's board, if it is still there. */
export const roomBoxOn = (share: ThreadGuestShare, boxId: string | undefined) =>
  boxId === undefined
    ? undefined
    : share.board?.notes.find((note) => note.id === boxId && note.kind === "thread");

/** The share without the threads of boxes its board no longer has; the same share when none. */
function withLiveBoardThreads(share: ThreadGuestShare): ThreadGuestShare {
  const threads = share.boardThreads;
  if (threads === undefined) return share;
  const kept = Object.entries(threads).filter(([boxId]) => roomBoxOn(share, boxId) !== undefined);
  if (kept.length === Object.keys(threads).length) return share;
  const { boardThreads: _gone, ...rest } = share;
  return kept.length === 0 ? rest : { ...rest, boardThreads: Object.fromEntries(kept) };
}

/**
 * The board with a turn shown on a thread box, keeping the last few. A box that is gone, or the
 * same turn again, leaves the board as it was.
 */
function boardWithBoxTurn(
  board: RoomBoard,
  boxId: string,
  turn: NonNullable<RoomBoardNote["thread"]>["turns"][number],
): RoomBoard {
  const box = board.notes.find((note) => note.id === boxId && note.kind === "thread");
  const turns = box?.thread?.turns ?? [];
  if (box === undefined || turns.some((shown) => shown.id === turn.id)) return board;
  const updated: RoomBoardNote = {
    ...box,
    thread: { turns: [...turns, turn].slice(-ROOM_BOX_TURN_LIMIT) },
  };
  return { ...board, notes: board.notes.map((note) => (note === box ? updated : note)) };
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
        ...(command.team === undefined ? {} : { team: command.team }),
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
          : { board: boardWithoutGuest(share.board, command.guestId) }),
      });
    }
    // The owner's thread behind a thread box: it stays when the box goes, unlinked.
    case "thread.room-box.link": {
      if (share === null || share.id !== command.shareId)
        return Result.fail(GUEST_FAILURE.inactive);
      const threads = share.boardThreads ?? {};
      if (command.boxThreadId === null) {
        if (threads[command.boxId] === undefined) return Result.succeed(thread);
        const { [command.boxId]: _gone, ...kept } = threads;
        const { boardThreads: _all, ...rest } = share;
        return Result.succeed({
          ...thread,
          guestShare: Object.keys(kept).length === 0 ? rest : { ...rest, boardThreads: kept },
        });
      }
      // A guest's box runs here too while its requests come through the owner.
      if (roomBoxOn(share, command.boxId) === undefined) return Result.fail(GUEST_FAILURE.boxGone);
      if (threads[command.boxId] === command.boxThreadId) return Result.succeed(thread);
      return Result.succeed({
        ...thread,
        guestShare: {
          ...share,
          boardThreads: { ...threads, [command.boxId]: command.boxThreadId },
        },
      });
    }
    // Like an artifact's fill: the box's turn already ran, and the room only sees it.
    case "thread.room-box.turn": {
      if (share === null || share.id !== command.shareId || share.board === undefined) {
        return Result.succeed(thread);
      }
      const board = boardWithBoxTurn(share.board, command.boxId, command.turn);
      return Result.succeed(
        board === share.board ? thread : { ...thread, guestShare: { ...share, board } },
      );
    }
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
          ...next,
          messages: next.messages.map((candidate) =>
            candidate.id === command.guestMessageId ? { ...candidate, sentAs } : candidate,
          ),
        },
        updatedAt: now,
      }));
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
      const before = share.board ?? EMPTY_ROOM_BOARD;
      // A removed thread box forgets its thread, which stays the owner's.
      return Result.map(
        applyRoomBoardChange(
          before,
          roomScope(share),
          command.author,
          command.change,
          DateTime.formatIso(now),
        ),
        (board) =>
          board === before
            ? thread
            : { ...thread, guestShare: withLiveBoardThreads({ ...share, board }) },
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
      const { truncated, taskId, artifact, boxId, cards, model, ...turn } = command.turn;
      // Only the guest's own thread box shows their turn; any other box is ignored.
      const namedBox = roomBoxOn(share, boxId);
      const box = namedBox?.guestId === command.guestId ? namedBox : undefined;
      const about =
        box === undefined
          ? {}
          : {
              prompt: roomBoxExcerpt(turn.prompt, ROOM_BOX_PROMPT_MAX_LENGTH),
              ...(cards === undefined || cards.length === 0 ? {} : { cards }),
              ...(model === undefined ? {} : { model }),
            };
      const answered =
        taskId === undefined || share.board === undefined
          ? share.board
          : boardWithTaskAnswered(share.board, taskId, command.guestId, turn);
      // The guest's own agent wrote it, on their machine; the owner's agent never sees the post.
      const filled =
        artifact === undefined || answered === undefined
          ? answered
          : boardWithArtifactFilled(answered, artifact.noteId, {
              body: artifact.body,
              ...(artifact.truncated === true ? { truncated: true } : {}),
              guestId: command.guestId,
              turnId: turn.id,
              updatedAt: DateTime.formatIso(now),
              ...about,
              ...(box === undefined ? {} : { boxId: box.id }),
            });
      // A box's turn is the box's conversation, so it stays out of the room's own turns.
      if (box !== undefined && filled !== undefined) {
        const board = boardWithBoxTurn(filled, box.id, {
          id: turn.id,
          ...about,
          prompt: roomBoxExcerpt(turn.prompt, ROOM_BOX_PROMPT_MAX_LENGTH),
          reply: roomBoxExcerpt(turn.reply, ROOM_BOX_REPLY_MAX_LENGTH),
          at: DateTime.formatIso(now),
          guestId: command.guestId,
        });
        return board === share.board ? Result.succeed(thread) : withShare({ ...share, board });
      }
      const board = filled;
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
        ...(board === undefined ? {} : { board }),
      });
    }
    // The owner's turn already ran; this only shows on the board which task it answered.
    case "thread.room-task.answer": {
      if (share === null || share.id !== command.shareId || share.board === undefined) {
        return Result.succeed(thread);
      }
      const board = boardWithTaskAnswered(share.board, command.taskId, undefined, command.turn);
      return Result.succeed(
        board === share.board ? thread : { ...thread, guestShare: { ...share, board } },
      );
    }
    // Like a task's answer: the owner's turn already ran, and the room only sees what it wrote.
    case "thread.room-artifact.fill": {
      if (share === null || share.id !== command.shareId || share.board === undefined) {
        return Result.succeed(thread);
      }
      const board = boardWithArtifactFilled(share.board, command.noteId, {
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
      });
      return Result.succeed(
        board === share.board ? thread : { ...thread, guestShare: { ...share, board } },
      );
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
    thread: { ...input.thread, guestShare: next, updatedAt: input.now },
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
