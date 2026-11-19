import {
  GUEST_HANDOFF_TTL_MS,
  GUEST_TURN_LIMIT,
  GUEST_TURN_PROMPT_MAX_LENGTH,
  GUEST_TURN_REPLY_MAX_LENGTH,
  GuestId,
  GuestShareId,
  ROOM_ARTIFACT_MAX_LENGTH,
  ROOM_BOARD_MAX_ARTIFACTS,
  ROOM_BOARD_MAX_NOTES,
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  SharedThreadExport,
  ThreadId,
  type GuestTurnRequest,
  type RoomBoardChange,
  type RoomBoardNote,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_AGENTS,
  agentsEvent,
  boardFor,
  changeBoardAsAgent,
  exportFor,
  machineGuestOf,
  postTurn,
  updatesFor,
  withActivity,
  withHandoff,
  withTurnPosted,
} from "./machines.ts";
import {
  ROOM_CHUNK_CHARS,
  ROOM_MAX_CHUNKS,
  changeBoard,
  createRoom,
  guestBySession,
  joinRoom,
  roomChunks,
  roomOfChunks,
  viewFor,
  type CloudRoom,
} from "./room.ts";

const NOW = "2026-11-16T10:00:00.000Z";
const NOW_MS = Date.parse(NOW);
const decodeExport = Schema.decodeUnknownSync(SharedThreadExport);
const ada = GuestId.make("guest-ada");
const grace = GuestId.make("guest-grace");

const twoPeople = (): CloudRoom => {
  const room = createRoom({
    shareId: GuestShareId.make("share-one-0000"),
    threadId: ThreadId.make("board-share-one-0000"),
    title: "Launch",
    inviteHash: "invite-hash",
    maker: { id: ada, name: "Ada", sessionHash: "ada-session" },
    now: NOW,
  });
  return Result.getOrThrow(
    joinRoom(room, {
      id: grace,
      name: "Grace",
      sessionHash: "grace-session",
      inviteHash: "invite-hash",
      now: NOW,
    }),
  );
};

const change = (room: CloudRoom, by: GuestId, board: RoomBoardChange) =>
  Result.getOrThrow(changeBoard(room, by, board, NOW));

const withBox = (room: CloudRoom, by: GuestId, boxId: string) =>
  change(room, by, { type: "note.put", noteId: boxId, text: "My box", x: 0, y: 0, kind: "thread" });

/** The person's machine joined: a handoff, then the export, as `SharedThreadJoin` reads it. */
function joinMachine(room: CloudRoom, guestId: GuestId, name: string) {
  const handed = withHandoff(room, guestId, `${name}-handoff`, NOW_MS);
  const exported = Result.getOrThrow(
    exportFor(handed, {
      handoffHash: `${name}-handoff`,
      roomToken: `share-one-0000.${name}-room`,
      roomHash: `${name}-room`,
      session: `share-one-0000.${name}-machine-session`,
      sessionHash: `${name}-machine-session`,
      now: NOW_MS,
    }),
  );
  return exported;
}

const turn = (id: string, extra: Partial<GuestTurnRequest> = {}): GuestTurnRequest => ({
  id,
  prompt: "Plan the launch",
  reply: "Here is the plan.",
  ...extra,
});

describe("a person's own machine on a cloud board", () => {
  it("joins by handoff and export, and its box shows its turn", () => {
    const { room, export: exported } = joinMachine(twoPeople(), ada, "ada");
    // What the joining machine decodes, with no conversation to import.
    const decoded = decodeExport(exported);
    expect(decoded).toMatchObject({ title: "Launch", messages: [], checkout: null, board: true });
    expect(decoded.room?.shareId).toBe("share-one-0000");
    expect(machineGuestOf(room, "ada-room", "room", NOW_MS)?.id).toBe(ada);
    // The machine's session opens the board as the same person; only hashes are kept.
    expect(guestBySession(room, "ada-machine-session")?.id).toBe(ada);
    expect(JSON.stringify(room)).not.toContain("share-one-0000.ada-room");
    const boxed = withBox(room, ada, "box-ada");
    const posted = Result.getOrThrow(
      postTurn(boxed, ada, turn("run-1", { boxId: "box-ada" }), NOW),
    );
    const box = viewFor(posted, posted.guests[1]!).board?.notes.find(
      (note) => note.id === "box-ada",
    );
    expect(box?.guestId).toBe(ada);
    expect(box?.thread?.turns).toEqual([
      expect.objectContaining({ id: "run-1", reply: "Here is the plan.", guestId: ada }),
    ]);
    expect(viewFor(posted, posted.guests[0]!).machines).toBe(true);
  });

  it("opens the export only with a live handoff token", () => {
    const handed = withHandoff(twoPeople(), ada, "ada-handoff", NOW_MS);
    const late = exportFor(handed, {
      handoffHash: "ada-handoff",
      roomToken: "t",
      roomHash: "h",
      session: "s",
      sessionHash: "sh",
      now: NOW_MS + GUEST_HANDOFF_TTL_MS,
    });
    expect(Result.isFailure(late) && late.failure.status).toBe(403);
    expect(machineGuestOf(handed, "ada-handoff", "room", NOW_MS)).toBeUndefined();
  });

  it("hands each machine what others said, once, never its own", () => {
    const { room } = joinMachine(twoPeople(), grace, "grace");
    const posted = Result.getOrThrow(postTurn(room, grace, turn("run-g"), NOW));
    const first = updatesFor(posted, ada, null);
    expect(first.updates.map((update) => [update.author, update.text])).toEqual([
      ["guest", "Plan the launch"],
      ["guest_agent", "Here is the plan."],
    ]);
    expect(updatesFor(posted, ada, first.cursor).updates).toEqual([]);
    expect(updatesFor(posted, grace, null).updates).toEqual([]);
  });

  it("keeps a machine off another person's box", () => {
    const boxed = withBox(twoPeople(), grace, "box-grace");
    const posted = Result.getOrThrow(
      postTurn(boxed, ada, turn("run-a", { boxId: "box-grace" }), NOW),
    );
    const box = posted.board?.notes.find((note) => note.id === "box-grace");
    expect(box?.thread).toBeUndefined();
    const refused = boardFor(posted, ada, "box-grace");
    expect(Result.isFailure(refused) && refused.failure).toMatchObject({
      status: 404,
      reason: "not_on_board",
    });
    const live = withActivity(
      EMPTY_AGENTS,
      posted,
      ada,
      { id: "run-a", state: "running", prompt: "Hi", boxId: "box-grace" },
      NOW_MS,
    );
    expect(agentsEvent(live, NOW_MS).boxes).toEqual([]);
  });

  it("shows a box's run live until its turn is posted", () => {
    const boxed = withBox(twoPeople(), ada, "box-ada");
    const live = withActivity(
      EMPTY_AGENTS,
      boxed,
      ada,
      { id: "run-1", state: "running", prompt: "Plan", boxId: "box-ada", phase: "writing" },
      NOW_MS,
    );
    expect(agentsEvent(live, NOW_MS).boxes).toEqual([
      expect.objectContaining({ boxId: "box-ada", guestId: ada, phase: "writing" }),
    ]);
    expect(agentsEvent(withTurnPosted(live, ada, "run-1"), NOW_MS).boxes).toEqual([]);
  });

  it("lets a box's agent add a note that undoing its turn takes back", () => {
    const boxed = withBox(twoPeople(), ada, "box-ada");
    let id = 0;
    const added = Result.getOrThrow(
      changeBoardAsAgent(
        boxed,
        ada,
        { boxId: "box-ada", turnId: "run-1", change: { add: { cards: [{ text: "Ship it" }] } } },
        NOW,
        () => `card-${++id}`,
      ),
    );
    expect(added.result).toEqual({ done: ["card-1"], refused: [] });
    const note = added.room.board?.notes.find((candidate) => candidate.id === "card-1");
    expect(note).toMatchObject({ text: "Ship it", guestId: ada, agent: { boxId: "box-ada" } });
    const view = Result.getOrThrow(boardFor(added.room, ada, "box-ada"));
    expect(view.cards.find((card) => card.id === "card-1")?.by).toBe("you");
    const undone = change(added.room, ada, {
      type: "agent-turn.undo",
      turnId: "run-1",
      undone: true,
    });
    expect(undone.board?.notes.some((candidate) => candidate.id === "card-1")).toBe(false);

    // Tasks for people on the board by name, "me" being the box's person; never to Grace's agent.
    const graces = withBox(undone, grace, "box-grace");
    const planned = Result.getOrThrow(
      changeBoardAsAgent(
        graces,
        ada,
        {
          boxId: "box-ada",
          turnId: "run-2",
          change: {
            add: {
              cards: [
                { text: "Review", assignee: "grace", priority: "high" },
                { text: "Mine", assignee: "me" },
              ],
            },
          },
        },
        NOW,
        () => `card-${++id}`,
      ),
    );
    expect(planned.result.refused).toEqual([]);
    const made = "done" in planned.result ? planned.result.done : [];
    const tasks = planned.room.board?.notes.filter((note) => made.includes(note.id));
    expect(tasks?.map((note) => [note.kind, note.assignee, note.priority])).toEqual([
      ["task", { guestId: grace }, "high"],
      ["task", { guestId: ada }, undefined],
    ]);
    const lined = Result.getOrThrow(
      changeBoardAsAgent(
        planned.room,
        ada,
        {
          boxId: "box-ada",
          change: { update: { changes: [{ id: "card-2", lineTo: "box-grace" }] } },
        },
        NOW,
        () => `edge-${++id}`,
      ),
    );
    expect(lined.result.refused[0]?.reason).toContain("Grace's agent");
    expect(lined.room.board?.edges ?? []).toEqual([]);

    // Arranging is the person's too: their cards move, Grace's box does not, and undo puts back.
    const arranged = Result.getOrThrow(
      changeBoardAsAgent(
        planned.room,
        ada,
        {
          boxId: "box-ada",
          turnId: "run-3",
          change: {
            arrange: {
              ops: [
                { do: "layout", cards: ["card-3", "card-2"], as: "row" },
                { do: "resize", card: "card-2", w: 300, h: 300 },
                { do: "move", card: "box-grace", x: 900, y: 900 },
              ],
            },
          },
        },
        NOW,
        () => `id-${++id}`,
      ),
    );
    const placed = (room: CloudRoom, noteId: string) => {
      const note = room.board?.notes.find((candidate) => candidate.id === noteId);
      return note && [note.x, note.y, note.size];
    };
    const [before2, before3] = [placed(planned.room, "card-2"), placed(planned.room, "card-3")];
    expect(arranged.result).toMatchObject({
      moved: [expect.objectContaining({ id: "card-2", w: 300, h: 300 })],
      renamed: [],
      refused: [{ op: 2, reason: expect.stringContaining("Grace's agent's box") }],
    });
    expect(placed(arranged.room, "card-3")).toEqual(before3);
    expect(placed(arranged.room, "box-grace")).toEqual(placed(planned.room, "box-grace"));
    const back = change(arranged.room, ada, {
      type: "agent-turn.undo",
      turnId: "run-3",
      undone: true,
    });
    expect(placed(back, "card-2")).toEqual(before2);
  });

  it("answers a task run in a box when the box's turn comes, leaving it in progress", () => {
    const boxed = withBox(twoPeople(), ada, "box-ada");
    const tasked = change(boxed, grace, {
      type: "note.put",
      noteId: "task-1",
      text: "Write the post",
      x: 400,
      y: 0,
      kind: "task",
    });
    const running = change(tasked, ada, { type: "task.run", noteId: "task-1", boxId: "box-ada" });
    const later = "2026-11-16T10:05:00.000Z";
    const posted = Result.getOrThrow(
      postTurn(running, ada, turn("run-2", { boxId: "box-ada" }), later),
    );
    const task = posted.board?.notes.find((note) => note.id === "task-1");
    expect(task).toMatchObject({ status: "doing", assignee: { guestId: ada } });
    expect(task?.done).toBeUndefined();
    expect(task?.answer).toMatchObject({ turnId: "run-2", boxId: "box-ada" });
  });

  it("fills an artifact from a box's turn", () => {
    const boxed = withBox(twoPeople(), ada, "box-ada");
    const withDoc = change(boxed, grace, {
      type: "note.put",
      noteId: "doc",
      text: "Launch post",
      x: 0,
      y: 600,
      kind: "artifact",
    });
    const posted = Result.getOrThrow(
      postTurn(
        withDoc,
        ada,
        turn("run-3", { boxId: "box-ada", artifact: { noteId: "doc", body: "# Launch" } }),
        NOW,
      ),
    );
    expect(posted.board?.notes.find((note) => note.id === "doc")?.artifact).toMatchObject({
      body: "# Launch",
      guestId: ada,
      boxId: "box-ada",
    });
  });
});

describe("a cloud board's storage", () => {
  it("keeps the largest board the limits allow in values under 128 KiB", () => {
    // Characters that take three bytes each, the most a UTF-16 unit takes in UTF-8.
    const wide = (length: number) => "€".repeat(length);
    const notes: Array<RoomBoardNote> = Array.from({ length: ROOM_BOARD_MAX_NOTES }, (_, index) => {
      const base = { id: `note-${index}`, text: wide(ROOM_BOARD_NOTE_MAX_LENGTH), x: 0, y: 0 };
      if (index < ROOM_BOARD_MAX_ARTIFACTS) {
        const version = { body: wide(ROOM_ARTIFACT_MAX_LENGTH), updatedAt: NOW, turnId: "t" };
        return { ...base, kind: "artifact", artifact: { ...version, previous: version } };
      }
      return {
        ...base,
        kind: "comment",
        replies: Array.from({ length: ROOM_BOARD_MAX_REPLIES }, (_, reply) => ({
          id: `reply-${reply}`,
          text: wide(ROOM_BOARD_NOTE_MAX_LENGTH),
          at: NOW,
        })),
      };
    });
    const room: CloudRoom = {
      ...twoPeople(),
      board: { positions: {}, notes },
      turns: Array.from({ length: GUEST_TURN_LIMIT }, (_, index) => ({
        id: `turn-${index}`,
        guestId: ada,
        prompt: wide(GUEST_TURN_PROMPT_MAX_LENGTH),
        reply: wide(GUEST_TURN_REPLY_MAX_LENGTH),
        postedAt: NOW,
      })),
    };
    const chunks = roomChunks(room);
    expect(chunks.length).toBeLessThanOrEqual(ROOM_MAX_CHUNKS);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(ROOM_CHUNK_CHARS);
      expect(new TextEncoder().encode(chunk).byteLength).toBeLessThan(128 * 1024);
    }
    expect(roomOfChunks(chunks)).toEqual(room);
  });
});
