import {
  CLOUD_BOARD_ACCESS_ANSWER_ROUTE,
  CLOUD_INBOX_COUNT_ROUTE,
  CLOUD_INBOX_MAX_ITEMS,
  CLOUD_INBOX_READ_ROUTE,
  CLOUD_INBOX_ROUTE,
  CLOUD_MY_TASKS_ROUTE,
  GuestId,
  GuestShareId,
  ThreadId,
  type CloudInboxItem,
  type RoomBoardChange,
} from "@t3tools/contracts";
import * as Result from "effect/Result";
import { describe, expect, it } from "vite-plus/test";

import { answerAccess, askAccess, openRequestOf } from "./accessRequests.ts";
import {
  inboxAfter,
  inboxCountOf,
  inboxDeliveries,
  inboxRead,
  taskIndexChanges,
  withInboxAt,
  withNotified,
} from "./inbox.ts";
import { inboxRoute, type InboxEnv } from "./inboxRoutes.ts";
import { changeBoard, viewFor, withRole, type CloudRoom } from "./room.ts";

const NOW = "2026-11-17T10:00:00.000Z";
const ada = GuestId.make("guest-ada");
const sam = GuestId.make("guest-sam");
const kim = GuestId.make("guest-kim");

/** Ada made it; Sam is on it signed in; Kim is on it signed out. */
const board = (): CloudRoom => ({
  shareId: GuestShareId.make("share-one-0000"),
  threadId: ThreadId.make("board-share-one-0000"),
  title: "Launch",
  inviteHash: "invite",
  guests: [
    { id: ada, name: "Ada", joinedAt: NOW, sessionHash: "s-ada", accountId: "user_ada" },
    { id: sam, name: "Sam", joinedAt: NOW, sessionHash: "s-sam", accountId: "user_sam" },
    { id: kim, name: "Kim", joinedAt: NOW, sessionHash: "s-kim" },
  ],
  maker: ada,
  workspaceId: "ws-one",
  createdAt: NOW,
  updatedAt: NOW,
});

let ids = 0;
const newId = () => `item-${++ids}`;
const change = (room: CloudRoom, by: GuestId, next: RoomBoardChange) =>
  Result.getOrThrow(changeBoard(room, by, next, NOW, new Set(["member-maya"])));
const deliveries = (before: CloudRoom, after: CloudRoom) =>
  inboxDeliveries(before, after, { at: NOW, newId });
const failureOf = <A, E>(result: Result.Result<A, E>) =>
  Result.isFailure(result) ? result.failure : null;

describe("inbox items from board changes", () => {
  it("tells whoever a change mentions, gives a task or replies to, once per card", () => {
    const start = board();
    const mentioned = change(start, ada, {
      type: "note.put",
      noteId: "n1",
      text: "@Sam @Kim @Maya have a look",
      x: 0,
      y: 0,
      mentions: [
        { guestId: sam, name: "Sam" },
        { guestId: kim, name: "Kim" },
        { memberId: "member-maya", name: "Maya" },
      ],
    });
    // Kim is on the board with no account: nobody to tell. Maya is told through the workspace.
    expect(deliveries(start, mentioned)).toEqual([
      {
        account: "user_sam",
        guestId: sam,
        author: ada,
        item: expect.objectContaining({
          kind: "mention",
          by: "Ada",
          title: "Launch",
          shareId: "share-one-0000",
          noteId: "n1",
          excerpt: "@Sam @Kim @Maya have a look",
          workspaceId: "ws-one",
        }),
      },
      { memberId: "member-maya", author: ada, item: expect.objectContaining({ kind: "mention" }) },
    ]);
    // Moving the card tells nobody again; an edit tells only who is newly named.
    const moved = change(mentioned, sam, {
      type: "note.put",
      noteId: "n1",
      text: "@Sam @Kim @Maya have a look",
      x: 40,
      y: 0,
    });
    expect(deliveries(mentioned, moved)).toEqual([]);

    const task = change(start, sam, {
      type: "note.put",
      noteId: "t1",
      text: "Ship it @Ada",
      x: 0,
      y: 0,
      kind: "task",
      assignee: { guestId: ada },
      mentions: [{ guestId: ada, name: "Ada" }],
    });
    // Given a task and named in it: one item, the task.
    expect(deliveries(start, task)).toEqual([
      expect.objectContaining({
        account: "user_ada",
        item: expect.objectContaining({ kind: "assign", by: "Sam", task: true, noteId: "t1" }),
      }),
    ]);
    // Taking a task yourself tells nobody.
    const own = change(start, sam, {
      type: "note.put",
      noteId: "t2",
      text: "Mine",
      x: 0,
      y: 0,
      kind: "task",
      assignee: { guestId: sam },
    });
    expect(deliveries(start, own)).toEqual([]);

    const thread = change(start, ada, {
      type: "note.put",
      noteId: "c1",
      text: "Is this right?",
      x: 0,
      y: 0,
      kind: "comment",
    });
    const replied = change(thread, sam, {
      type: "comment.reply",
      noteId: "c1",
      replyId: "r1",
      text: "Yes",
    });
    expect(deliveries(thread, replied)).toEqual([
      expect.objectContaining({
        account: "user_ada",
        item: expect.objectContaining({ kind: "reply", by: "Sam", excerpt: "Yes" }),
      }),
    ]);
    // Replying to your own thread tells nobody.
    const again = change(replied, ada, {
      type: "comment.reply",
      noteId: "c1",
      replyId: "r2",
      text: "Thanks",
    });
    expect(deliveries(replied, again)).toEqual([]);
    // Someone taken out of the workspace is not told.
    const locked = {
      ...start,
      guests: start.guests.map((guest) =>
        guest.id === sam ? { ...guest, locked: true as const } : guest,
      ),
    };
    const named = change(locked, ada, {
      type: "note.put",
      noteId: "n2",
      text: "@Sam",
      x: 0,
      y: 0,
      mentions: [{ guestId: sam, name: "Sam" }],
    });
    expect(deliveries(locked, named)).toEqual([]);
  });

  it("tells nobody twice when a card is deleted and put back, or a change undone and redone", () => {
    const start = board();
    const put = {
      type: "note.put",
      noteId: "t1",
      text: "@Sam ship it",
      x: 0,
      y: 0,
      kind: "task",
      assignee: { guestId: sam },
      mentions: [{ guestId: sam, name: "Sam" }],
    } as const;
    const made = change(start, ada, put);
    const first = deliveries(start, made);
    // Once per card: the task given says it all.
    expect(first.map(({ item }) => item.kind)).toEqual(["assign"]);
    const told = withNotified(made, first, NOW);
    const gone = change(told, ada, { type: "note.remove", noteId: "t1" });
    const back = change(gone, ada, put);
    expect(inboxDeliveries(gone, back, { at: "2026-11-17T10:05:00.000Z", newId })).toEqual([]);
    // A reply is new words each time, so it always tells.
    const comment = change(back, sam, {
      type: "note.put",
      noteId: "c",
      text: "Hm",
      x: 0,
      y: 0,
      kind: "comment",
    });
    const replied = change(comment, ada, {
      type: "comment.reply",
      noteId: "c",
      replyId: "r",
      text: "Yes",
    });
    expect(deliveries(comment, replied).map(({ item }) => item.kind)).toEqual(["reply"]);
    // A day on, the same task given again tells again.
    expect(
      inboxDeliveries(gone, back, { at: "2026-11-18T10:05:00.000Z", newId }).map(
        ({ item }) => item.kind,
      ),
    ).toEqual(["assign"]);
  });

  it("tells a page on the board its inbox changed", () => {
    const told = withInboxAt(board(), [sam], NOW);
    const samGuest = told.guests.find((guest) => guest.id === sam)!;
    expect(viewFor(told, samGuest).inboxAt).toBe(NOW);
    expect(viewFor(told, told.guests[0]!).inboxAt).toBeUndefined();
  });
});

const item = (id: string, at: string, fields: Partial<CloudInboxItem> = {}): CloudInboxItem => ({
  id,
  kind: "mention",
  at,
  by: "Ada",
  title: "Launch",
  shareId: GuestShareId.make("share-one-0000"),
  ...fields,
});

describe("an account's inbox", () => {
  const now = Date.parse(NOW);

  it("keeps the newest, for 30 days and up to its cap, and replaces an item with the same id", () => {
    const old = item("old", "2026-10-10T10:00:00.000Z");
    const recent = item("recent", "2026-11-16T10:00:00.000Z");
    expect(inboxAfter([old], [recent], now)).toEqual([recent]);
    const many = Array.from({ length: CLOUD_INBOX_MAX_ITEMS + 5 }, (_, at) =>
      item(`i${String(at).padStart(3, "0")}`, `2026-11-16T10:00:00.${999 - at}Z`),
    );
    const kept = inboxAfter([], many, now);
    expect(kept).toHaveLength(CLOUD_INBOX_MAX_ITEMS);
    expect(kept[0]?.id).toBe("i000");
    expect(kept.at(-1)?.id).toBe(`i${CLOUD_INBOX_MAX_ITEMS - 1}`);
    const answered = { ...recent, read: true as const, excerpt: "updated" };
    expect(inboxAfter([recent], [answered], now)).toEqual([answered]);
  });

  it("counts what is unread, by board, and marks some or all read", () => {
    const other = GuestShareId.make("share-two-0000");
    const items = [item("a", NOW), item("b", NOW, { shareId: other }), item("c", NOW)];
    expect(inboxCountOf(items)).toEqual({
      unread: 3,
      boards: ["share-one-0000", "share-two-0000"],
    });
    const some = inboxRead(items, ["b"]);
    expect(inboxCountOf(some)).toEqual({ unread: 2, boards: ["share-one-0000"] });
    expect(some[0]).toBe(items[0]);
    expect(inboxCountOf(inboxRead(some, "all"))).toEqual({ unread: 0, boards: [] });
  });
});

describe("asking for edit access", () => {
  const viewer = () => Result.getOrThrow(withRole(board(), true, sam, "view", NOW));
  const ask = (room: CloudRoom, account: string, viewing = false) =>
    askAccess(room, { id: `req-${account.slice(5)}`, account, name: "Pat", viewing, now: NOW });

  it("lets a viewer ask once, and approving lets their open page edit at once", () => {
    const room = viewer();
    const samGuest = () => room.guests.find((guest) => guest.id === sam)!;
    expect(viewFor(room, samGuest()).viewOnly).toBe(true);
    const asked = Result.getOrThrow(ask(room, "user_sam"));
    expect(failureOf(ask(asked.room, "user_sam"))).toEqual(
      expect.objectContaining({ reason: "asked" }),
    );
    // Someone who can already edit has nothing to ask; someone not on it needs the view link.
    expect(Result.isFailure(ask(board(), "user_ada"))).toBe(true);
    expect(failureOf(ask(room, "user_new"))).toEqual(
      expect.objectContaining({ reason: "invalid" }),
    );
    const answer = (approve: boolean, manages = true) =>
      answerAccess(asked.room, {
        requestId: asked.request.id,
        approve,
        manages,
        guestId: GuestId.make("guest-new"),
        now: "2026-11-17T10:05:00.000Z",
      });
    expect(failureOf(answer(true, false))).toEqual(
      expect.objectContaining({ reason: "not_maker" }),
    );
    const approved = Result.getOrThrow(answer(true));
    const seat = approved.room.guests.find((guest) => guest.id === sam)!;
    expect(approved.seat?.id).toBe(sam);
    const view = viewFor(approved.room, seat);
    expect(view.viewOnly).toBeUndefined();
    expect(view.machines).toBe(true);
    // Answered once; a second answer is refused, and they may ask again later.
    expect(
      Result.isFailure(
        answerAccess(approved.room, {
          requestId: asked.request.id,
          approve: false,
          manages: true,
          guestId: GuestId.make("x"),
          now: NOW,
        }),
      ),
    ).toBe(true);

    const declined = Result.getOrThrow(answer(false));
    expect(
      viewFor(
        declined.room,
        declined.room.guests.find((guest) => guest.id === sam)!,
      ).viewOnly,
    ).toBe(true);
    expect(declined.request.status).toBe("declined");
    expect(Result.isSuccess(ask(declined.room, "user_sam"))).toBe(true);
    // A page loaded again still says Asked while the request is open, and only to who asked.
    expect(openRequestOf(asked.room, "user_sam")?.id).toBe(asked.request.id);
    expect(openRequestOf(asked.room, "user_ada")).toBeUndefined();
    expect(openRequestOf(declined.room, "user_sam")).toBeUndefined();
  });

  it("gives someone looking on from the view link a seat, which their page finds", () => {
    const asked = Result.getOrThrow(ask(board(), "user_pat", true));
    const approved = Result.getOrThrow(
      answerAccess(asked.room, {
        requestId: asked.request.id,
        approve: true,
        manages: true,
        guestId: GuestId.make("guest-pat"),
        now: "2026-11-17T10:05:00.000Z",
      }),
    );
    expect(approved.seat).toEqual(
      expect.objectContaining({
        id: "guest-pat",
        name: "Pat",
        accountId: "user_pat",
        sessionHash: "",
      }),
    );
    expect(viewFor(approved.room, null).granted).toEqual([asked.request.id]);
    // The account and the request's account never go out with the board.
    expect(JSON.stringify(viewFor(approved.room, null))).not.toContain("user_pat");
    expect(viewFor(asked.room, null).granted).toBeUndefined();
  });
});

describe("My tasks", () => {
  it("follows each account's tasks on the board as they are given, changed and taken away", () => {
    const start = board();
    const given = change(start, ada, {
      type: "note.put",
      noteId: "t1",
      text: "Write the brief",
      x: 0,
      y: 0,
      kind: "task",
      assignee: { guestId: sam },
      priority: "high",
    });
    expect(taskIndexChanges(start, given)).toEqual([
      {
        account: "user_sam",
        tasks: [
          expect.objectContaining({
            shareId: "share-one-0000",
            title: "Launch",
            noteId: "t1",
            text: "Write the brief",
            status: "todo",
            priority: "high",
          }),
        ],
      },
    ]);
    const moved = change(given, ada, {
      type: "note.put",
      noteId: "t1",
      text: "Write the brief",
      x: 80,
      y: 0,
      kind: "task",
      assignee: { guestId: sam },
      priority: "high",
    });
    expect(taskIndexChanges(given, moved)).toEqual([]);
    const handed = change(given, ada, {
      type: "note.put",
      noteId: "t1",
      text: "Write the brief",
      x: 0,
      y: 0,
      kind: "task",
      assignee: { guestId: ada },
    });
    expect(taskIndexChanges(given, handed)).toEqual([
      { account: "user_sam", tasks: [] },
      { account: "user_ada", tasks: [expect.objectContaining({ noteId: "t1" })] },
    ]);
  });
});

describe("inbox routes", () => {
  function setup() {
    const calls: Array<string> = [];
    const namespace = (make: (name: string) => object) => ({
      idFromName: (name: string) => name,
      get: (name: string) => make(name),
    });
    const env = {
      ACCOUNTS: namespace((account) => ({
        inbox: async () => {
          calls.push(`inbox ${account}`);
          return { items: [], unread: 0 };
        },
        inboxCount: async () => {
          calls.push(`count ${account}`);
          return { unread: 0, boards: [] };
        },
        markRead: async (which: unknown) => {
          calls.push(`read ${account} ${JSON.stringify(which)}`);
          return { unread: 0, boards: [] };
        },
        tasks: async () => {
          calls.push(`tasks ${account}`);
          return [];
        },
      })),
      BOARDS: namespace((shareId) => ({
        answerAccess: async (account: string, request: string, approve: boolean) => {
          calls.push(`answer ${shareId} ${account} ${request} ${approve}`);
          return { value: null };
        },
      })),
    } as unknown as InboxEnv;
    const send = (account: string, method: string, path: string, body?: unknown) => {
      const url = new URL(path, "https://boards.example");
      const request = new Request(url, {
        method,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return inboxRoute(request, env, url, { account, readBody: async () => request.text() });
    };
    return { calls, send };
  }

  it("reads and changes only the verified account's own inbox, whatever the request names", async () => {
    const { calls, send } = setup();
    await send("user_ada", "GET", `${CLOUD_INBOX_ROUTE}?account=user_sam`);
    await send("user_ada", "GET", `${CLOUD_INBOX_COUNT_ROUTE}?account=user_sam`);
    await send("user_ada", "POST", CLOUD_INBOX_READ_ROUTE, { all: true, account: "user_sam" });
    await send("user_ada", "GET", CLOUD_MY_TASKS_ROUTE);
    await send("user_ada", "POST", `${CLOUD_BOARD_ACCESS_ANSWER_ROUTE}?share=share-one-0000`, {
      request: "req-1",
      approve: true,
    });
    expect(calls).toEqual([
      "inbox user_ada",
      "count user_ada",
      'read user_ada "all"',
      "tasks user_ada",
      "answer share-one-0000 user_ada req-1 true",
    ]);
    expect(await send("user_ada", "GET", "/boards/other")).toBeNull();
  });
});
