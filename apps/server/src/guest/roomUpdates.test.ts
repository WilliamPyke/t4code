import { assert, it } from "@effect/vitest";
import {
  GuestId,
  type OrchestrationV2TurnItem,
  ROOM_UPDATE_MAX_LENGTH,
  ROOM_UPDATES_MAX_CHARS,
  ROOM_UPDATES_MAX_MESSAGES,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

import { roomUpdatesOf } from "./roomUpdates.ts";

const sam = GuestId.make("guest:sam");
const alex = GuestId.make("guest:alex");
const minute = (value: number) => `2026-11-10T10:${String(value).padStart(2, "0")}:00.000Z`;
const item = (id: string, at: number, fields: object) =>
  ({
    id,
    runId: "run:1",
    streaming: false,
    updatedAt: DateTime.makeUnsafe(minute(at)),
    ...fields,
  }) as OrchestrationV2TurnItem;
const share = {
  guestName: null,
  guests: [
    { id: sam, name: "Sam" },
    { id: alex, name: "Alex" },
  ],
  turns: [
    { id: "run:sam", guestId: sam, prompt: "Mine", reply: "Sam's reply", postedAt: minute(5) },
    { id: "run:alex", guestId: alex, prompt: "", reply: "Alex's reply", postedAt: minute(6) },
  ],
  // The board is the room's alone: none of it may reach an agent through an update.
  board: {
    positions: {},
    notes: [
      { id: "c", text: "Board comment", x: 0, y: 0, guestId: alex, pinnedTo: "i3" },
      { id: "t", text: "Board task", x: 0, y: 0, kind: "task", assignee: { guestId: sam } },
      { id: "l", text: "", x: 0, y: 0, kind: "link", url: "https://example.com/board" },
    ],
    edges: [{ id: "e", from: "note:c", to: "card:thread" }],
  },
} as unknown as ThreadGuestShare;
const items = [
  item("i1", 1, { type: "user_message", text: "Why does login fail?" }),
  item("i2", 2, { type: "assistant_message", text: "Looking." }),
  item("i3", 3, { type: "assistant_message", text: "It expires early." }),
  item("i4", 4, {
    type: "user_message",
    runId: "run:2",
    text: "Sam (guest): try a refresh",
    context: { guest: { name: "Sam", text: "try a refresh" } },
  }),
  item("i5", 7, {
    type: "assistant_message",
    runId: "run:2",
    text: "Still going",
    streaming: true,
  }),
];
const run = (id: string, status: string, completedAt: number | null) =>
  ({
    id,
    status,
    completedAt: completedAt === null ? null : DateTime.makeUnsafe(minute(completedAt)),
  }) as Parameters<typeof roomUpdatesOf>[0]["runs"][number];
const runs = [run("run:1", "completed", 3), run("run:2", "running", null)];
const updates = (after: string | null, guestId = sam) =>
  roomUpdatesOf({ items, runs, hasMoreHistory: false, share, guestId, after });

it("gives a joined thread what the room said after its cursor, without its own turns", () => {
  assert.deepEqual(updates(null), {
    updates: [
      { author: "owner", text: "Why does login fail?", at: minute(1) },
      { author: "owner_agent", text: "It expires early.", at: minute(3) },
      { author: "guest", name: "Sam", text: "try a refresh", at: minute(4) },
      { author: "guest_agent", name: "Alex", text: "Alex's reply", at: minute(6) },
    ],
    truncated: false,
    cursor: minute(6),
  });
  // Alex gets Sam's turn and not their own.
  assert.deepEqual(
    updates(minute(4), alex).updates.map((update) => [update.author, update.text]),
    [
      ["guest", "Mine"],
      ["guest_agent", "Sam's reply"],
    ],
  );
  // Nothing new keeps the cursor where it was.
  assert.deepEqual(updates(minute(6)), { updates: [], truncated: false, cursor: minute(6) });
});

it("keeps the newest updates that fit and says when some were left out", () => {
  const many = Array.from({ length: ROOM_UPDATES_MAX_MESSAGES + 5 }, (_, index) =>
    item(`m${index}`, index, { type: "user_message", text: `message ${index}` }),
  );
  const capped = roomUpdatesOf({
    items: many,
    runs: [],
    hasMoreHistory: false,
    share: { ...share, turns: [] },
    guestId: sam,
    after: null,
  });
  assert.lengthOf(capped.updates, ROOM_UPDATES_MAX_MESSAGES);
  assert.equal(capped.updates[0]?.text, "message 5");
  assert.equal(capped.updates.at(-1)?.text, `message ${ROOM_UPDATES_MAX_MESSAGES + 4}`);
  assert.isTrue(capped.truncated);

  const long = roomUpdatesOf({
    items: Array.from({ length: 8 }, (_, index) =>
      item(`l${index}`, index, {
        type: "user_message",
        text: "a".repeat(ROOM_UPDATE_MAX_LENGTH + 1),
      }),
    ),
    runs: [],
    hasMoreHistory: false,
    share: { ...share, turns: [] },
    guestId: sam,
    after: null,
  });
  assert.isTrue(long.updates.every((update) => update.text.length === ROOM_UPDATE_MAX_LENGTH));
  assert.equal(long.updates.length, ROOM_UPDATES_MAX_CHARS / ROOM_UPDATE_MAX_LENGTH);
  assert.isTrue(long.truncated);

  // Turns older than the window may have been missed, unless the cursor is inside it.
  const windowed = (after: string | null) =>
    roomUpdatesOf({ items, runs, hasMoreHistory: true, share, guestId: sam, after }).truncated;
  assert.isTrue(windowed(null));
  assert.isFalse(windowed(minute(2)));
});

it("holds an owner run's reply until the run ends, then gives it once", () => {
  const working = [
    item("w1", 1, { type: "user_message", runId: "run:w", text: "Fix it" }),
    item("w2", 2, { type: "assistant_message", runId: "run:w", text: "Reading the code." }),
  ];
  const read = (
    held: ReadonlyArray<OrchestrationV2TurnItem>,
    status: string,
    completedAt: number | null,
    after: string | null,
  ) =>
    roomUpdatesOf({
      items: held,
      runs: [run("run:w", status, completedAt)],
      hasMoreHistory: false,
      share,
      guestId: sam,
      after,
    });

  // Mid-run: the interim message stays out, and Alex's later turn moves the cursor past it.
  const during = read(working, "running", null, null);
  assert.deepEqual(
    during.updates.map((update) => [update.author, update.text]),
    [
      ["owner", "Fix it"],
      ["guest_agent", "Alex's reply"],
    ],
  );
  assert.equal(during.cursor, minute(6));

  // The final reply was written before that cursor, and the run ended after it.
  const done = [
    ...working,
    item("w3", 5, { type: "assistant_message", runId: "run:w", text: "Fixed." }),
  ];
  for (const status of ["completed", "interrupted", "failed"]) {
    assert.deepEqual(read(done, status, 8, during.cursor), {
      updates: [{ author: "owner_agent", text: "Fixed.", at: minute(8) }],
      truncated: false,
      cursor: minute(8),
    });
  }
  assert.deepEqual(read(done, "completed", 8, minute(8)).updates, []);
  // Waiting on the owner is not the end of the run.
  assert.deepEqual(read(done, "waiting", null, during.cursor).updates, []);
});
