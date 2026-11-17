import {
  CLOUD_INBOX_EXCERPT_MAX_LENGTH,
  CLOUD_INBOX_KEEP_DAYS,
  CLOUD_INBOX_MAX_ITEMS,
  type CloudInboxCount,
  type CloudInboxItem,
  type CloudInboxKind,
  type CloudMyTask,
  type GuestId,
  type RoomBoardMention,
  type RoomBoardNote,
} from "@t3tools/contracts";
import { roomMentionKey, roomTaskStatus } from "@t3tools/shared/roomBoard";

import type { CloudGuest, CloudRoom } from "./room.ts";

/**
 * What brings someone back to a board: an item in their account's inbox when a change names
 * them, gives them a task or answers their comment. Only people the board knows as an account
 * get one: someone on it signed in, or a member of its workspace. Nothing here reaches an agent.
 */

/** Who an item is for: an account the board knows, or a workspace member it asks about. */
export type InboxDelivery = {
  readonly item: CloudInboxItem;
  /** Who did it, so they never hear of their own change. */
  readonly author: GuestId | undefined;
} & ({ readonly account: string; readonly guestId: GuestId } | { readonly memberId: string });

/** Text as an item shows it: one line, cut short. */
export function inboxExcerpt(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length <= CLOUD_INBOX_EXCERPT_MAX_LENGTH
    ? line
    : `${line.slice(0, CLOUD_INBOX_EXCERPT_MAX_LENGTH - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;
}

const nameOf = (room: CloudRoom, guestId: GuestId | undefined) =>
  room.guests.find((guest) => guest.id === guestId)?.name ?? "Someone";

/** The account behind a person on the board, while it still opens the board as them. */
const accountOf = (guest: CloudGuest | undefined) =>
  guest === undefined || guest.locked === true ? undefined : guest.accountId;

/**
 * How long a task given or a mention made stays told: the same item again for the same person and
 * card in this time is not sent, so an undo and a redo, or a card deleted and put back, tell nobody
 * twice.
 */
const INBOX_REPEAT_MS = 24 * 60 * 60_000;
// The items a board remembers having sent, newest last.
const NOTIFIED_MAX = 200;

// A task given and a mention on one card are one item, as each person hears once per card.
const deliveryKey = (to: Pick<RoomBoardMention, "guestId" | "memberId">, noteId: string) =>
  `${roomMentionKey(to)} ${noteId}`;

/** The board once it remembers the task and mention items it sent at `at`. */
export function withNotified(
  room: CloudRoom,
  deliveries: ReadonlyArray<InboxDelivery>,
  at: string,
): CloudRoom {
  const sent = deliveries.flatMap(({ item, ...to }) =>
    item.kind === "reply" || item.noteId === undefined
      ? []
      : [
          {
            key: deliveryKey(
              "memberId" in to ? { memberId: to.memberId } : { guestId: to.guestId },
              item.noteId,
            ),
            at,
          },
        ],
  );
  if (sent.length === 0) return room;
  const since = Date.parse(at) - INBOX_REPEAT_MS;
  const kept = (room.notified ?? []).filter((one) => Date.parse(one.at) > since);
  return { ...room, notified: [...kept, ...sent].slice(-NOTIFIED_MAX) };
}

/**
 * The items a change from `before` to `after` gives, each person once per card: a task given to
 * them, a new `@` mention of them, or a reply to a comment thread they started. Never for the
 * person who made the change, nor anyone the board knows no account for, nor a task or mention
 * the board already told them of lately (`INBOX_REPEAT_MS`).
 */
export function inboxDeliveries(
  before: CloudRoom,
  after: CloudRoom,
  input: { readonly at: string; readonly newId: () => string },
): ReadonlyArray<InboxDelivery> {
  const old = new Map((before.board?.notes ?? []).map((note) => [note.id, note]));
  const deliveries: Array<InboxDelivery> = [];
  const sent = new Set<string>();
  const since = Date.parse(input.at) - INBOX_REPEAT_MS;
  const told = new Set(
    (before.notified ?? []).flatMap((one) => (Date.parse(one.at) > since ? [one.key] : [])),
  );
  const add = (
    to: Pick<RoomBoardMention, "guestId" | "memberId">,
    author: GuestId | undefined,
    kind: CloudInboxKind,
    note: RoomBoardNote,
    text: string,
  ) => {
    if (to.guestId !== undefined && to.guestId === author) return;
    const key = `${roomMentionKey(to)} ${note.id}`;
    if (sent.has(key)) return;
    if (kind !== "reply" && told.has(deliveryKey(to, note.id))) {
      sent.add(key);
      return;
    }
    const item: CloudInboxItem = {
      id: input.newId(),
      kind,
      at: input.at,
      by: nameOf(after, author),
      title: after.title,
      shareId: after.shareId,
      threadId: after.threadId,
      ...(after.workspaceId === undefined ? {} : { workspaceId: after.workspaceId }),
      ...(text.trim() === "" ? {} : { excerpt: inboxExcerpt(text) }),
      noteId: note.id,
      ...(note.kind === "task" ? { task: true as const } : {}),
    };
    if (to.memberId !== undefined) {
      sent.add(key);
      deliveries.push({ item, author, memberId: to.memberId });
      return;
    }
    const guest = after.guests.find((candidate) => candidate.id === to.guestId);
    const account = accountOf(guest);
    if (guest === undefined || account === undefined) return;
    sent.add(key);
    deliveries.push({ item, author, account, guestId: guest.id });
  };
  for (const note of after.board?.notes ?? []) {
    const was = old.get(note.id);
    if (was === note) continue;
    // A change to what the card says; a move or a resize keeps `changed` as it was.
    if (note.changed !== was?.changed) {
      const author = note.changed?.guestId;
      const assignee = note.assignee?.guestId;
      if (note.kind === "task" && assignee !== undefined && assignee !== was?.assignee?.guestId) {
        add({ guestId: assignee }, author, "assign", note, note.text);
      }
      const had = new Set((was?.mentions ?? []).map(roomMentionKey));
      for (const mention of note.mentions ?? []) {
        if (!had.has(roomMentionKey(mention))) add(mention, author, "mention", note, note.text);
      }
    }
    const replied = new Set((was?.replies ?? []).map((reply) => reply.id));
    for (const reply of note.replies ?? []) {
      if (replied.has(reply.id) || reply.agent !== undefined) continue;
      for (const mention of reply.mentions ?? []) {
        add(mention, reply.guestId, "mention", note, reply.text);
      }
      if (note.guestId !== undefined) {
        add({ guestId: note.guestId }, reply.guestId, "reply", note, reply.text);
      }
    }
  }
  return deliveries;
}

/** The board once these people's pages are told their inbox has something new. */
export function withInboxAt(room: CloudRoom, guestIds: ReadonlyArray<GuestId>, at: string) {
  if (guestIds.length === 0) return room;
  const told = new Set(guestIds);
  return {
    ...room,
    guests: room.guests.map((guest) => (told.has(guest.id) ? { ...guest, inboxAt: at } : guest)),
  };
}

const KEEP_MS = CLOUD_INBOX_KEEP_DAYS * 24 * 60 * 60_000;

/**
 * The inbox with `incoming` in it, newest first: an item with an id it has is replaced, those
 * older than the days it keeps go, and past its cap the oldest go.
 */
export function inboxAfter(
  items: ReadonlyArray<CloudInboxItem>,
  incoming: ReadonlyArray<CloudInboxItem>,
  now: number,
): ReadonlyArray<CloudInboxItem> {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()]
    .filter((item) => Date.parse(item.at) > now - KEEP_MS)
    .toSorted((left, right) => right.at.localeCompare(left.at) || right.id.localeCompare(left.id))
    .slice(0, CLOUD_INBOX_MAX_ITEMS);
}

/** The inbox with these items, or every one, read. Items already read stay the same objects. */
export const inboxRead = (
  items: ReadonlyArray<CloudInboxItem>,
  which: ReadonlyArray<string> | "all",
): ReadonlyArray<CloudInboxItem> =>
  items.map((item) =>
    item.read === true || (which !== "all" && !which.includes(item.id))
      ? item
      : { ...item, read: true as const },
  );

export function inboxCountOf(items: ReadonlyArray<CloudInboxItem>): CloudInboxCount {
  const unread = items.filter((item) => item.read !== true);
  return {
    unread: unread.length,
    boards: [...new Set(unread.flatMap((item) => item.shareId ?? []))],
  };
}

/** The tasks given to each account on the board, as its "My tasks" list keeps them. */
export function accountTasksOf(
  room: CloudRoom | null,
): ReadonlyMap<string, ReadonlyArray<CloudMyTask>> {
  const tasks = new Map<string, Array<CloudMyTask>>();
  if (room === null) return tasks;
  for (const note of room.board?.notes ?? []) {
    if (note.kind !== "task" || note.assignee?.guestId === undefined) continue;
    const account = accountOf(room.guests.find((guest) => guest.id === note.assignee?.guestId));
    if (account === undefined) continue;
    const task: CloudMyTask = {
      shareId: room.shareId,
      threadId: room.threadId,
      title: room.title,
      ...(room.workspaceId === undefined ? {} : { workspaceId: room.workspaceId }),
      noteId: note.id,
      text: note.text,
      status: roomTaskStatus(note),
      ...(note.priority === undefined ? {} : { priority: note.priority }),
      ...(note.due === undefined ? {} : { due: note.due }),
    };
    tasks.set(account, [...(tasks.get(account) ?? []), task]);
  }
  return tasks;
}

/** Each account whose tasks on the board changed, with all its tasks there now (none: forget). */
export function taskIndexChanges(
  before: CloudRoom | null,
  after: CloudRoom | null,
): ReadonlyArray<{ readonly account: string; readonly tasks: ReadonlyArray<CloudMyTask> }> {
  const was = accountTasksOf(before);
  const now = accountTasksOf(after);
  return [...new Set([...was.keys(), ...now.keys()])].flatMap((account) => {
    const tasks = now.get(account) ?? [];
    return JSON.stringify(was.get(account) ?? []) === JSON.stringify(tasks)
      ? []
      : [{ account, tasks }];
  });
}
