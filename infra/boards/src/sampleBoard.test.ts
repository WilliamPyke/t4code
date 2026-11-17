import { GuestId, GuestShareId, ThreadId } from "@t3tools/contracts";
import { roomTaskStatus } from "@t3tools/shared/roomBoard";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import sample from "../sample/onboarding-v2.json" with { type: "json" };
import { postTurn } from "./machines.ts";
import { changeBoard, createRoom, joinRoom, viewFor, type CloudRoom } from "./room.ts";
import { sampleChanges, sampleTurns, type SampleBoard } from "./sampleBoard.ts";

const NOW = "2026-11-17T10:00:00.000Z";
const description = sample as SampleBoard;
const guestOf = (person: string) => `guest-${person}`;

/** The board as the script leaves it, built by the same rules the host applies. */
function built(): CloudRoom {
  let room = createRoom({
    shareId: GuestShareId.make("sample-0000"),
    threadId: ThreadId.make("board-sample-0000"),
    title: description.title,
    inviteHash: "invite",
    maker: {
      id: GuestId.make(guestOf(description.maker)),
      name: description.people[description.maker]!,
      sessionHash: "maker",
    },
    now: NOW,
  });
  for (const [person, name] of Object.entries(description.people)) {
    if (person === description.maker) continue;
    const id = guestOf(person);
    room = Result.getOrThrow(
      joinRoom(room, {
        id: GuestId.make(id),
        name,
        sessionHash: id,
        inviteHash: "invite",
        now: NOW,
      }),
    );
  }
  return apply(room);
}

function apply(room: CloudRoom): CloudRoom {
  const changes = sampleChanges({
    sample: description,
    guestOf,
    bodyOf: (file) => `# ${file}`,
    notes: room.board?.notes ?? [],
    start: room.board?.start,
    now: Date.parse(NOW),
  });
  const changed = changes.reduce((current, { by, change }) => {
    const next = changeBoard(current, GuestId.make(guestOf(by)), change, NOW);
    if (Result.isFailure(next)) {
      throw new Error(`${change.type} by ${by}: ${next.failure.message}`);
    }
    return next.success;
  }, room);
  // As the script posts them: each by its person's own machine token, through the turn route.
  return sampleTurns({ sample: description, bodyOf: (file) => `# ${file}` }).reduce(
    (current, { by, turn }) =>
      Result.getOrThrow(postTurn(current, GuestId.make(guestOf(by)), turn, NOW)),
    changed,
  );
}

describe("the public sample board", () => {
  it("is taken whole by the board's rules, with tasks in every Plan column", () => {
    const room = built();
    const board = viewFor(room, null).board!;
    expect(board.notes).toHaveLength(description.cards.length);
    expect(board.edges).toHaveLength(description.lines.length);
    const tasks = board.notes.filter((note) => note.kind === "task");
    expect(new Set(tasks.map(roomTaskStatus))).toEqual(new Set(["todo", "doing", "done"]));
    expect(tasks.every((task) => task.assignee?.guestId !== undefined)).toBe(true);
    expect(board.notes.filter((note) => note.artifact !== undefined)).toHaveLength(4);
    expect(board.start).toBe("goals");
  });

  it("shows agents at work: a finished conversation, an artifact it wrote, a task and a snapshot", () => {
    const board = viewFor(built(), null).board!;
    const note = (id: string) => board.notes.find((one) => one.id === id)!;
    const box = note("maya-agent");
    expect(box).toMatchObject({ kind: "thread", guestId: guestOf("maya") });
    expect(box.thread?.turns).toHaveLength(1);
    expect(box.thread?.turns[0]).toMatchObject({
      guestId: guestOf("maya"),
      model: "Claude Sonnet 5.5",
      cards: [
        "Nobody needs a terminal to get value on day one",
        "Krystal Higgins: User Onboarding for the Long Run",
      ],
    });
    // The lines that fed it read as sent with its prompt.
    for (const id of ["l-g3-maya", "l-yt-maya"]) {
      expect(board.edges?.find((edge) => edge.id === id)?.sentAt).toBe(NOW);
    }
    expect(
      board.edges?.some((edge) => edge.from === "note:maya-agent" && edge.to === "note:welcome"),
    ).toBe(true);
    // Written by Maya's agent, with Jonas's own first version kept to go back to.
    expect(note("welcome").artifact).toMatchObject({
      guestId: guestOf("maya"),
      boxId: "maya-agent",
      previous: { guestId: guestOf("jonas"), byHand: true },
    });
    expect(note("welcome").artifact?.byHand).toBeUndefined();
    expect(note("t7")).toMatchObject({
      status: "doing",
      answer: { guestId: guestOf("jonas"), turnId: "sample-jonas-empty-states-1" },
    });
    expect(note("eng142").artifact).toMatchObject({ guestId: guestOf("sam") });
    expect(note("eng142").artifact?.byHand).toBeUndefined();
    expect(
      board.edges?.some((edge) => edge.from === "note:linear" && edge.to === "note:eng142"),
    ).toBe(true);
  });

  it("changes nothing more when the script runs again", () => {
    const once = built();
    const twice = apply(once);
    expect(twice.board?.notes.map((note) => [note.id, note.artifact?.body])).toEqual(
      once.board?.notes.map((note) => [note.id, note.artifact?.body]),
    );
    expect(twice.board?.notes.find((note) => note.id === "maya-agent")?.thread).toEqual(
      once.board?.notes.find((note) => note.id === "maya-agent")?.thread,
    );
    expect(twice.turns).toEqual(once.turns);
    expect(twice.board?.notes.map((note) => [note.id, note.artifact?.previous])).toEqual(
      once.board?.notes.map((note) => [note.id, note.artifact?.previous]),
    );
    expect(twice.board?.notes.map((note) => note.reactions)).toEqual(
      once.board?.notes.map((note) => note.reactions),
    );
  });
});
