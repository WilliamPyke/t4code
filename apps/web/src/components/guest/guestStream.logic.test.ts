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
  guestBoardOpenStep,
  guestEntryStep,
  guestFilesProblem,
  guestShareIdOfEnvironment,
  inviteJoinStep,
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

describe("guestEntryStep", () => {
  const joined = [{ shareId: "board-1" }, { shareId: "board-2" }];
  it("reuses a share this browser joined, checking the session when an invite could replace it", () => {
    expect(guestEntryStep(joined, { credential: "board-2.secret", shareId: "board-2" })).toEqual({
      step: "check",
      share: { shareId: "board-2" },
    });
    expect(guestEntryStep(joined, { credential: null, shareId: "board-1" })).toEqual({
      step: "open",
      share: { shareId: "board-1" },
    });
  });
  it("joins with an invite only for a share not joined yet", () => {
    expect(guestEntryStep(joined, { credential: "board-3.secret", shareId: "board-3" })).toEqual({
      step: "join",
    });
    expect(guestEntryStep(joined, { credential: null, shareId: "board-3" })).toEqual({
      step: "invalid",
    });
    expect(guestEntryStep(joined, { credential: "no-signature", shareId: null })).toEqual({
      step: "invalid",
    });
  });
  it("joins a board only looked at once its edit link comes, and keeps an editor editing", () => {
    const looking = [{ shareId: "board-1", viewOnly: true }, { shareId: "board-2" }];
    expect(guestEntryStep(looking, { credential: "board-1.secret", shareId: "board-1" })).toEqual({
      step: "join",
    });
    expect(guestEntryStep(looking, { credential: "board-1.v.secret", shareId: "board-1" })).toEqual(
      { step: "check", share: looking[0] },
    );
    expect(guestEntryStep(looking, { credential: "board-2.v.secret", shareId: "board-2" })).toEqual(
      { step: "check", share: looking[1] },
    );
    expect(guestEntryStep(looking, { credential: "board-3.v.secret", shareId: "board-3" })).toEqual(
      { step: "join" },
    );
  });
});

describe("inviteJoinStep", () => {
  const signedIn = (name: string | null) => ({ status: "signed-in", name }) as const;
  it("joins a cloud board under the account's own name, and asks an account that has none", () => {
    expect(inviteJoinStep({ cloud: true, account: signedIn("Maya Lin"), failed: false })).toEqual({
      step: "join",
      name: "Maya Lin",
    });
    for (const name of [null, "", "  "]) {
      expect(inviteJoinStep({ cloud: true, account: signedIn(name), failed: false })).toEqual({
        step: "ask",
      });
    }
  });
  it("asks everyone else, and waits only while it does not know who is signed in", () => {
    const ask = { step: "ask" };
    expect(inviteJoinStep({ cloud: true, account: { status: "loading" }, failed: false })).toEqual({
      step: "wait",
    });
    expect(
      inviteJoinStep({ cloud: true, account: { status: "signed-out" }, failed: false }),
    ).toEqual(ask);
    expect(inviteJoinStep({ cloud: true, account: { status: "off" }, failed: false })).toEqual(ask);
    // Someone else's computer never gets the account, and a refused join falls back to the form.
    expect(inviteJoinStep({ cloud: false, account: signedIn("Maya Lin"), failed: false })).toEqual(
      ask,
    );
    expect(inviteJoinStep({ cloud: true, account: signedIn("Maya Lin"), failed: true })).toEqual(
      ask,
    );
  });
});

describe("guestBoardOpenStep", () => {
  const cold = {
    hasSession: false,
    reopening: false,
    cloud: true,
    account: "signed-in",
    accountRefused: false,
  } as const;
  it("opens a cloud board's plain address as the signed-in account before calling it ended", () => {
    expect(guestBoardOpenStep(cold)).toBe("account");
    expect(guestBoardOpenStep({ ...cold, account: "loading" })).toBe("opening");
    expect(guestBoardOpenStep({ ...cold, accountRefused: true })).toBe("invalid");
    expect(guestBoardOpenStep({ ...cold, account: "signed-out" })).toBe("invalid");
    expect(guestBoardOpenStep({ ...cold, cloud: false })).toBe("invalid");
    expect(guestBoardOpenStep({ ...cold, hasSession: true, accountRefused: true })).toBe("board");
    expect(guestBoardOpenStep({ ...cold, reopening: true })).toBe("opening");
  });
  it("reads the share from a board's address", () => {
    expect(guestShareIdOfEnvironment("guest-share-abc-123")).toBe("abc-123");
    expect(guestShareIdOfEnvironment("guest-share-")).toBeNull();
    expect(guestShareIdOfEnvironment("local")).toBeNull();
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
