import {
  GuestMessageId,
  GuestShareId,
  MessageId,
  RunId,
  TurnItemId,
  type GuestShareView,
  type OrchestrationV2TurnItem,
  type ThreadGuestMessage,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { describe, expect, it } from "vite-plus/test";

import { makeThreadProjectionFixture } from "../../test-fixtures";
import {
  guestFilesProblem,
  inviteShareId,
  nextAwaitingRowIds,
  unplacedGuestMessages,
} from "./guestStream.logic";

const view: GuestShareView = {
  shareId: GuestShareId.make("share-1"),
  title: "Fix login",
  guestName: "Sam",
  guests: [],
  direct: false,
  expiresAt: "2026-10-24T00:00:00.000Z",
  messages: [],
  model: { driver: null, name: "gpt-5.4" },
};

const projection = makeThreadProjectionFixture();
const now = DateTime.makeUnsafe("2026-10-23T10:00:00.000Z");

const base = {
  threadId: projection.thread.id,
  runId: RunId.make("run-1"),
  nodeId: null,
  providerThreadId: null,
  providerTurnId: null,
  nativeItemRef: null,
  parentItemId: null,
  ordinal: 1,
  status: "completed",
  title: null,
  startedAt: now,
  completedAt: now,
  updatedAt: now,
} as const;

const guestMessageRow = (id: string, guestMessageId: GuestMessageId): OrchestrationV2TurnItem => ({
  ...base,
  id: TurnItemId.make(id),
  type: "user_message",
  createdBy: "user",
  creationSource: "web",
  messageId: MessageId.make(id),
  inputIntent: "turn_start",
  text: "Why?",
  context: { version: 1, records: [], guest: { guestMessageId, name: "Sam", text: "Why?" } },
  attachments: [],
});

const row = (item: OrchestrationV2TurnItem) => ({
  position: 0,
  visibility: "local" as const,
  sourceThreadId: projection.thread.id,
  sourceItemId: item.id,
  item,
});

describe("nextAwaitingRowIds", () => {
  it("remembers a waiting message until its row arrives, and never brings it back", () => {
    const waiting = {
      id: GuestMessageId.make("m1"),
      text: "Why?",
      status: "pending" as const,
      submittedAt: "2026-10-23T10:00:00.000Z",
    };
    const none: ReadonlySet<GuestMessageId> = new Set();
    const seen = nextAwaitingRowIds(none, { ...view, messages: [waiting] }, []);
    expect([...seen]).toEqual([waiting.id]);
    // The owner sent it, but its row is still queued: it keeps showing after the transcript.
    const sent = { ...view, messages: [{ ...waiting, status: "sent" as const }] };
    expect(nextAwaitingRowIds(seen, sent, [])).toBe(seen);

    // Once placed, a later window that no longer holds the row must not resurrect it.
    const placed = nextAwaitingRowIds(seen, sent, [row(guestMessageRow("u1", waiting.id))]);
    expect(placed.size).toBe(0);
    expect(nextAwaitingRowIds(placed, sent, [])).toBe(placed);
  });
});

describe("unplacedGuestMessages", () => {
  const message = (id: string, status: ThreadGuestMessage["status"], submittedAt: string) => ({
    id: GuestMessageId.make(id),
    text: id,
    status,
    submittedAt,
  });

  it("shows pending ones, and resolved ones only if this page saw them waiting", () => {
    const messages = [
      message("late", "pending", "2026-10-23T10:05:00.000Z"),
      message("placed", "sent", "2026-10-23T10:00:00.000Z"),
      message("queued", "sent", "2026-10-23T09:59:00.000Z"),
      message("dismissed", "dismissed", "2026-10-23T10:01:00.000Z"),
      message("old-history", "sent", "2026-10-23T09:00:00.000Z"),
    ];
    const seen = new Set(
      ["placed", "queued", "dismissed", "late"].map((id) => GuestMessageId.make(id)),
    );
    const items = [
      {
        position: 0,
        visibility: "local" as const,
        sourceThreadId: projection.thread.id,
        sourceItemId: TurnItemId.make("u1"),
        item: guestMessageRow("u1", GuestMessageId.make("placed")),
      },
    ];
    expect(unplacedGuestMessages(messages, items, seen).map((m) => m.id)).toEqual([
      "queued",
      "dismissed",
      "late",
    ]);
  });
});

describe("inviteShareId", () => {
  it("reads the share id before the signature and rejects anything else", () => {
    expect(inviteShareId("k3J9xQ2mT8vL5nR1pW7yZa.sig")).toBe("k3J9xQ2mT8vL5nR1pW7yZa");
    expect(inviteShareId("no-signature")).toBeNull();
    expect(inviteShareId(".sig")).toBeNull();
    expect(inviteShareId("")).toBeNull();
  });
});

describe("guestFilesProblem", () => {
  const file = (type: string, size = 1) => ({ type, size });
  it("takes up to four files and 10 MB, with images in the types the owner's composer takes", () => {
    expect(guestFilesProblem([file("image/png"), file("application/pdf"), file("")])).toBeNull();
    expect(guestFilesProblem([1, 2, 3, 4, 5].map(() => file("image/png")))).toMatch(/up to 4/);
    expect(guestFilesProblem([file("image/png", 10 * 1024 * 1024 + 1)])).toMatch(/10 MB/);
    expect(guestFilesProblem([file("image/svg+xml")])).toMatch(/PNG, JPEG, GIF, or WebP/);
    expect(guestFilesProblem([file("text/plain", 0)])).toMatch(/cannot be attached/);
  });
});
