import {
  GUEST_AGENT_PROMPT_MAX_LENGTH,
  GUEST_TURN_LIMIT,
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOX_PROGRESS_DETAIL_MAX_LENGTH,
  ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH,
  ROOM_BOX_PROMPT_MAX_LENGTH,
  ROOM_BOX_TURN_LIMIT,
  roomBoardAgentCard,
  roomBoardCardRef,
  roomBoardGuestCard,
  roomBoardNoteRef,
  roomTaskAnswerExcerpt,
  type GuestAgentActivityRequest,
  type GuestId,
  type GuestTurnRequest,
  type RoomAgentActivity,
  type RoomArtifactContent,
  type RoomBoard,
  type RoomBoardAgentMark,
  type RoomBoardChange,
  type RoomBoardNote,
  type RoomBoardReaction,
  type RoomBoardReply,
  type RoomBoxProgress,
  type RoomCodeChanges,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import * as Result from "effect/Result";

import { sanitizeLinkedPrompt } from "./promptLinks.ts";
import {
  EMPTY_ROOM_BOARD,
  ROOM_AGENT_REPLY_ID_PREFIX,
  applyRoomBoardChange,
  roomArtifactAfterFill,
  roomArtifactBody,
  roomArtifactSource,
  roomBoardWithAgentChange,
  roomBoardWithBoxRunDone,
  roomBoardWithCardsSent,
  roomBoardWithEdges,
  roomBoardWithoutCards,
  roomBoxCodeWindows,
  roomBoxExcerpt,
  roomBoxReply,
  roomCommentAnswer,
  type RoomBoardScope,
} from "./roomBoard.ts";
import { clip } from "./roomUpdates.ts";

/**
 * The rules of a shared room that hold wherever the room is kept: on the owner's machine, where
 * the share is part of a thread, or on the cloud board host, where nobody owns it.
 */

export const ROOM_BOX_NOT_YOURS =
  "This thread box is someone else's. Only your own takes your messages.";

/** The part of a share these rules read and change. */
export type GuestRoom = Pick<ThreadGuestShare, "guests" | "board" | "turns">;

/** The thread box with this id on the room's board, if it is still there. */
export const roomBoxOn = (room: Pick<ThreadGuestShare, "board">, boxId: string | undefined) =>
  boxId === undefined
    ? undefined
    : room.board?.notes.find((note) => note.id === boxId && note.kind === "thread");

/**
 * The board with a task in progress and answered by this person's agent: a guest's, or the
 * owner's when `guestId` is undefined. Only a task that is no one's or already this person's
 * takes it; any other id, or the same turn again, leaves the board as it was.
 */
export function roomBoardWithTaskAnswered(
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
    // A person ticks it off once they have read the answer.
    ...(task.done === true ? {} : { status: "doing" as const }),
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
export function roomBoardWithArtifactFilled(
  board: RoomBoard,
  noteId: string,
  content: Omit<RoomArtifactContent, "previous">,
): RoomBoard {
  // A view takes nothing itself: the reply goes into the artifact it shows.
  const note = roomArtifactSource(board, noteId);
  const sameTurn = (version: Pick<RoomArtifactContent, "turnId" | "guestId"> | undefined) =>
    version?.turnId === content.turnId && version.guestId === content.guestId;
  // A turn that already wrote it, even one someone restored away since, writes nothing again.
  if (note === undefined || sameTurn(note.artifact) || sameTurn(note.artifact?.previous)) {
    return board;
  }
  const filled: RoomBoardNote = {
    ...note,
    artifact: roomArtifactAfterFill(note.artifact, content),
  };
  return { ...board, notes: board.notes.map((other) => (other === note ? filled : other)) };
}

/**
 * The board with an agent's answer appended to the comment thread it was asked from, as a reply
 * of whose agent it was. Only a comment thread with room for it takes it; any other id, or the
 * same run again, leaves the board as it was, so a thread deleted meanwhile takes nothing.
 */
export function roomBoardWithCommentAnswer(
  board: RoomBoard,
  noteId: string,
  answer: {
    readonly guestId: GuestId | undefined;
    readonly text: string;
    readonly at: string;
    readonly agent: NonNullable<RoomBoardReply["agent"]>;
  },
): RoomBoard {
  const note = board.notes.find((candidate) => candidate.id === noteId);
  const replies = note?.replies ?? [];
  const id = `${ROOM_AGENT_REPLY_ID_PREFIX}${answer.agent.turnId}`.slice(0, 64);
  if (
    note?.kind !== "comment" ||
    answer.text.trim() === "" ||
    replies.length >= ROOM_BOARD_MAX_REPLIES ||
    replies.some(
      (reply) =>
        reply.id === id ||
        (reply.agent?.turnId === answer.agent.turnId && reply.guestId === answer.guestId),
    )
  ) {
    return board;
  }
  const reply: RoomBoardReply = {
    id,
    text: answer.text,
    ...(answer.guestId === undefined ? {} : { guestId: answer.guestId }),
    at: answer.at,
    agent: answer.agent,
  };
  const answered: RoomBoardNote = { ...note, replies: [...replies, reply] };
  return { ...board, notes: board.notes.map((other) => (other === note ? answered : other)) };
}

/**
 * The board with what a thread box's thread changed shown in every code window the box has a line
 * to. A window that already shows this turn of this person's, or a box with no window, leaves the
 * board as it was.
 */
export function roomBoardWithBoxChanges(
  board: RoomBoard,
  boxId: string,
  changes: Omit<RoomCodeChanges, "boxId">,
): RoomBoard {
  const windows = new Set(roomBoxCodeWindows(board, boxId));
  const shows = (note: RoomBoardNote) =>
    note.changes?.boxId === boxId &&
    note.changes.turnId === changes.turnId &&
    note.changes.guestId === changes.guestId;
  if (![...windows].some((note) => !shows(note))) return board;
  return {
    ...board,
    notes: board.notes.map((note) =>
      windows.has(note) && !shows(note) ? { ...note, changes: { ...changes, boxId } } : note,
    ),
  };
}

/**
 * The board with a turn shown on a thread box, keeping the last few. A box that is gone, or the
 * same turn again, leaves the board as it was.
 */
export function roomBoardWithBoxTurn(
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
  // A finished turn is what ticks off the tasks someone ran in the box.
  return roomBoardWithBoxRunDone(
    { ...board, notes: board.notes.map((note) => (note === box ? updated : note)) },
    boxId,
    turn,
  );
}

/**
 * The room once a guest's own machine posted a turn it ran: on their own thread box when it ran
 * in one, else among the room's turns, with the task it answered, the artifact it filled and the
 * comment it answered. The same room when it shows nothing new.
 */
export function roomAfterGuestTurn<R extends GuestRoom>(
  room: R,
  guestId: GuestId,
  posted: GuestTurnRequest,
  at: string,
): R {
  const turns = room.turns ?? [];
  if (turns.some((turn) => turn.guestId === guestId && turn.id === posted.id)) return room;
  const { truncated, taskId, artifact, boxId, cards, cardRefs, model, comment, changes, ...turn } =
    posted;
  // Only the guest's own thread box shows their turn; any other box is ignored.
  const namedBox = roomBoxOn(room, boxId);
  const box = namedBox?.guestId === guestId ? namedBox : undefined;
  // Their machine posts the turn again once its checkpoint is taken, with what it changed.
  const changed =
    box === undefined || changes === undefined || room.board === undefined
      ? room.board
      : roomBoardWithBoxChanges(room.board, box.id, {
          ...changes,
          guestId,
          turnId: turn.id,
          updatedAt: at,
        });
  const about =
    box === undefined
      ? {}
      : {
          prompt: roomBoxExcerpt(turn.prompt, ROOM_BOX_PROMPT_MAX_LENGTH),
          ...(cards === undefined || cards.length === 0 ? {} : { cards }),
          ...(model === undefined ? {} : { model }),
        };
  const answered =
    taskId === undefined || changed === undefined
      ? changed
      : roomBoardWithTaskAnswered(changed, taskId, guestId, turn);
  // The guest's own agent wrote it, on their machine; no other agent sees the post.
  const filled =
    artifact === undefined || answered === undefined
      ? answered
      : roomBoardWithArtifactFilled(answered, artifact.noteId, {
          body: artifact.body,
          ...(artifact.truncated === true ? { truncated: true } : {}),
          guestId,
          turnId: turn.id,
          updatedAt: at,
          ...about,
          ...(box === undefined ? {} : { boxId: box.id }),
        });
  // A box's turn is the box's conversation, so it stays out of the room's own turns.
  if (box !== undefined && filled !== undefined) {
    // Only the guest's own box answers a comment thread, as their agent.
    const commented =
      comment === undefined
        ? filled
        : roomBoardWithCommentAnswer(filled, comment.noteId, {
            guestId,
            text: comment.text,
            at,
            agent: { turnId: turn.id, boxId: box.id, ...(model === undefined ? {} : { model }) },
          });
    const shown = roomBoardWithBoxTurn(commented, box.id, {
      id: turn.id,
      ...about,
      prompt: roomBoxExcerpt(turn.prompt, ROOM_BOX_PROMPT_MAX_LENGTH),
      reply: roomBoxReply(turn.reply),
      at,
      guestId,
    });
    // Only as the box first shows the turn: a post again with its changes marks nothing anew.
    // Their machine posts a turn once it finished, so its cards are sent and done at once.
    const board =
      shown === commented || cardRefs === undefined
        ? shown
        : roomBoardWithCardsSent(
            roomBoardWithCardsSent(shown, box.id, artifact?.noteId, cardRefs, at),
            box.id,
            artifact?.noteId,
            cardRefs,
            at,
            "done",
          );
    return board === room.board ? room : { ...room, board };
  }
  return {
    ...room,
    turns: [
      ...turns,
      { ...turn, guestId, postedAt: at, ...(truncated === true ? { truncated } : {}) },
    ].slice(-GUEST_TURN_LIMIT),
    ...(filled === undefined ? {} : { board: filled }),
  };
}

/**
 * A change to the room's board by a guest (`author`) or the owner (null), and when `agent` is set,
 * by the agent of a thread box. A guest's change is their own box's agent's only when they asked
 * it, in a turn of that box. The same board when the change leaves it as it was.
 */
export function roomBoardAfterChange(
  room: Pick<ThreadGuestShare, "board">,
  scope: RoomBoardScope,
  author: GuestId | null,
  change: RoomBoardChange,
  agent: RoomBoardAgentMark | undefined,
  at: string,
): Result.Result<RoomBoard, string> {
  const before = room.board ?? EMPTY_ROOM_BOARD;
  if (
    agent !== undefined &&
    author !== null &&
    (roomBoxOn(room, agent.boxId)?.guestId !== author ||
      agent.askedBy !== author ||
      before.agentTurns?.some((turn) => turn.id === agent.turnId && turn.guestId !== author) ===
        true)
  ) {
    return Result.fail(ROOM_BOX_NOT_YOURS);
  }
  return Result.map(applyRoomBoardChange(before, scope, author, change, at), (changed) =>
    agent === undefined
      ? changed
      : roomBoardWithAgentChange(before, changed, change, agent, at, author),
  );
}

/**
 * The board without a removed guest's notes, replies, cards and the arrows that touched them.
 * Tasks they were given are left with no one, and lose their agent's answers.
 */
export function roomBoardWithoutGuest(board: RoomBoard, guestId: GuestId): RoomBoard {
  // Removed comment threads kept for undo go too, rather than keep what they wrote in them.
  const { removed: _forUndo, ...withoutCards } = roomBoardWithoutCards(board, [
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
        const theirs = [
          ...(note.replies ?? []),
          ...(note.reactions ?? []),
          ...(note.replies ?? []).flatMap((reply) => reply.reactions ?? []),
        ].some((entry) => entry.guestId === guestId);
        if (!theirs && note.assignee?.guestId !== guestId && note.answer?.guestId !== guestId) {
          return [note];
        }
        const { assignee, answer, replies, reactions, ...rest } = note;
        const notTheirs = (reaction: RoomBoardReaction) => reaction.guestId !== guestId;
        const kept =
          replies?.flatMap((reply) => {
            if (reply.guestId === guestId) return [];
            const left = reply.reactions?.filter(notTheirs);
            if (left === undefined || left.length === reply.reactions?.length) return [reply];
            const { reactions: _theirs, ...replyRest } = reply;
            return [left.length === 0 ? replyRest : { ...replyRest, reactions: left }];
          }) ?? [];
        const keptReactions = reactions?.filter(notTheirs) ?? [];
        return [
          {
            ...rest,
            ...(assignee === undefined || assignee.guestId === guestId ? {} : { assignee }),
            ...(answer === undefined || answer.guestId === guestId ? {} : { answer }),
            ...(kept.length === 0 ? {} : { replies: kept }),
            ...(keptReactions.length === 0 ? {} : { reactions: keptReactions }),
          },
        ];
      }),
    },
    (edge) => !gone.has(edge.from) && !gone.has(edge.to),
  );
}

/** The room once a guest is removed: they, their turns and what they put on the board go. */
export function roomWithoutGuest<R extends GuestRoom>(room: R, guestId: GuestId): R {
  return {
    ...room,
    guests: room.guests?.filter((guest) => guest.id !== guestId),
    ...(room.turns === undefined
      ? {}
      : { turns: room.turns.filter((turn) => turn.guestId !== guestId) }),
    ...(room.board === undefined ? {} : { board: roomBoardWithoutGuest(room.board, guestId) }),
  };
}

/** Text another machine sent, as one line the whole room can read, cut to `max`. */
const roomOneLine = (text: string, max: number) =>
  clip(sanitizeLinkedPrompt(text).text.replace(/\s+/g, " ").trim(), max);

/**
 * A turn a guest's machine posted, as the room keeps it: no characters nobody can see, labels on
 * one line, an artifact's and a comment's answers taken from the text again, and the box fields
 * only for the guest's own box. Null when the reply is empty.
 */
export function guestTurnFromRequest(
  room: Pick<ThreadGuestShare, "board">,
  guestId: GuestId,
  request: GuestTurnRequest,
): GuestTurnRequest | null {
  const prompt = sanitizeLinkedPrompt(request.prompt).text.trim();
  const reply = sanitizeLinkedPrompt(request.reply).text.trim();
  if (reply === "") return null;
  const {
    artifact: posted,
    boxId: askedBox,
    cards: sentCards,
    cardRefs: sentRefs,
    model: sentModel,
    comment: postedComment,
    ...turn
  } = request;
  // Only the guest's own box shows it; anything else is one of the room's turns as before.
  const box = roomBoxOn(room, askedBox);
  const boxId = box !== undefined && box.guestId === guestId ? box.id : undefined;
  const cards = (sentCards ?? []).flatMap((label) => {
    const text = roomOneLine(label, 200);
    return text === "" ? [] : [text];
  });
  const model = roomOneLine(sentModel ?? "", 120);
  // What fills the card is taken from the body again, as from any reply, so a guest's machine
  // can put no more in it than an agent's reply would.
  const filled =
    posted === undefined ? undefined : roomArtifactBody(sanitizeLinkedPrompt(posted.body).text);
  const artifact =
    posted === undefined || filled === undefined || filled.body === ""
      ? undefined
      : {
          noteId: posted.noteId,
          body: filled.body,
          ...(posted.truncated === true || filled.truncated ? { truncated: true } : {}),
        };
  // Like an artifact's, the answer is taken from the text again, and only from the guest's own
  // box, as their agent's; the board takes it only in a comment thread.
  const answer =
    postedComment === undefined || boxId === undefined ? "" : roomCommentAnswer(postedComment.text);
  const comment =
    postedComment === undefined || answer === ""
      ? undefined
      : { noteId: postedComment.noteId, text: answer };
  return {
    ...turn,
    prompt,
    reply,
    ...(artifact === undefined ? {} : { artifact }),
    ...(boxId === undefined
      ? {}
      : {
          boxId,
          ...(cards.length === 0 ? {} : { cards }),
          ...(sentRefs === undefined || sentRefs.length === 0 ? {} : { cardRefs: sentRefs }),
          ...(model === "" ? {} : { model }),
          ...(comment === undefined ? {} : { comment }),
        }),
  };
}

/** What a guest's machine said its agent is doing, as the room shows it live. */
export type GuestActivity =
  | { readonly type: "idle" }
  /** A run in the guest's own thread box, keyed by guest and run. */
  | { readonly type: "box"; readonly progress: Omit<RoomBoxProgress, "startedAt"> }
  | { readonly type: "agent"; readonly activity: RoomAgentActivity };

/**
 * A guest machine's activity post as the room shows it: a box's progress only on the guest's own
 * box, a task only one that is the guest's to take, and every text cut to what the room keeps.
 */
export function guestActivityFromRequest(
  room: Pick<ThreadGuestShare, "board">,
  guestId: GuestId,
  request: GuestAgentActivityRequest,
): GuestActivity {
  if (request.state === "idle") return { type: "idle" };
  const notes = room.board?.notes ?? [];
  // The card shows the agent working only on a task that is the guest's to take.
  const task = notes.find((note) => note.id === request.taskId);
  const taskId =
    task?.kind === "task" && (task.assignee === undefined || task.assignee.guestId === guestId)
      ? task.id
      : undefined;
  const artifactId = roomArtifactSource(room.board, request.artifactId)?.id;
  const commentId = notes.find(
    (note) => note.id === request.commentId && note.kind === "comment",
  )?.id;
  // A run in the guest's own thread box shows on the box, with what its agent is doing.
  const box = roomBoxOn(room, request.boxId);
  if (box !== undefined && box.guestId === guestId) {
    const phase = request.phase ?? "thinking";
    const detail = roomOneLine(request.detail ?? "", ROOM_BOX_PROGRESS_DETAIL_MAX_LENGTH);
    const preview = roomOneLine(request.preview ?? "", ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH).slice(
      -ROOM_BOX_PROGRESS_PREVIEW_MAX_LENGTH,
    );
    // Taken from the draft again, as a finished turn's is, so it holds no more than a reply would.
    const draft =
      artifactId === undefined || request.draft === undefined
        ? ""
        : roomArtifactBody(sanitizeLinkedPrompt(request.draft).text).body;
    const model = roomOneLine(request.model ?? "", 120);
    const boxPrompt = roomOneLine(request.prompt ?? "", ROOM_BOX_PROMPT_MAX_LENGTH);
    return {
      type: "box",
      progress: {
        boxId: box.id,
        guestId,
        ...(artifactId === undefined ? {} : { artifactId }),
        ...(commentId === undefined ? {} : { commentId }),
        phase,
        ...(phase === "tool" && detail !== "" ? { detail } : {}),
        ...(phase === "writing" && preview !== "" ? { preview } : {}),
        ...(draft === "" ? {} : { draft }),
        ...(model === "" ? {} : { model }),
        ...(boxPrompt === "" ? {} : { prompt: boxPrompt }),
      },
    };
  }
  return {
    type: "agent",
    activity: {
      guestId,
      prompt: roomOneLine(request.prompt ?? "", GUEST_AGENT_PROMPT_MAX_LENGTH),
      ...(taskId === undefined ? {} : { taskId }),
      ...(artifactId === undefined ? {} : { artifactId }),
      ...(request.code === undefined ? {} : { code: request.code }),
    },
  };
}
