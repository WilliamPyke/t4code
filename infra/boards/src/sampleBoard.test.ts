import { GuestId, GuestShareId, ThreadId } from "@t3tools/contracts";
import { roomTaskStatus } from "@t3tools/shared/roomBoard";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import sample from "../sample/onboarding-v2.json" with { type: "json" };
import { changeBoard, createRoom, joinRoom, viewFor, type CloudRoom } from "./room.ts";
import { sampleChanges, type SampleBoard } from "./sampleBoard.ts";

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
    now: Date.parse(NOW),
  });
  return changes.reduce((current, { by, change }) => {
    const next = changeBoard(current, GuestId.make(guestOf(by)), change, NOW);
    if (Result.isFailure(next)) {
      throw new Error(`${change.type} by ${by}: ${next.failure.message}`);
    }
    return next.success;
  }, room);
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
    expect(board.notes.filter((note) => note.artifact !== undefined)).toHaveLength(3);
  });

  it("changes nothing more when the script runs again", () => {
    const once = built();
    const twice = apply(once);
    expect(twice.board?.notes.map((note) => [note.id, note.artifact?.previous])).toEqual(
      once.board?.notes.map((note) => [note.id, note.artifact?.previous]),
    );
    expect(twice.board?.notes.map((note) => note.reactions)).toEqual(
      once.board?.notes.map((note) => note.reactions),
    );
  });
});
