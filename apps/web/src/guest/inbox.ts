import { useAtomValue } from "@effect/atom-react";
import {
  CLOUD_BOARD_ACCESS_ANSWER_ROUTE,
  CLOUD_BOARD_ACCESS_ROUTE,
  CLOUD_INBOX_COUNT_ROUTE,
  CLOUD_INBOX_READ_ROUTE,
  CLOUD_INBOX_ROUTE,
  CLOUD_MY_TASKS_ROUTE,
  CloudBoardAccessResult,
  CloudInbox,
  CloudInboxCount,
  CloudMyTasks,
  GUEST_SHARE_PARAM,
  type CloudInboxItem,
  type CloudMyTask,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { requestBoardFocus } from "../components/room/boardFocus";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  accountRequest,
  boardAccountsEnabled,
  openAccountBoard,
  readBoardAccountProfile,
} from "./boardAccount";
import { findGuestShare, guestShareLocation, reopenGuestShare } from "./guestShares";
import { openListedBoard } from "./workspaces";

/**
 * The signed-in person's inbox on the cloud board host. Its count is read when the page gets
 * focus, once a minute while the page shows, and at once when an open board says it changed;
 * never while the page is hidden. Signed out, or without accounts, there is none.
 */

const inboxCountAtom = Atom.make<CloudInboxCount | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("inbox-count"),
);
const inboxAtom = Atom.make<CloudInbox | null>(null).pipe(Atom.keepAlive, Atom.withLabel("inbox"));
/** Edit access this page asked for, by board: the request's id, until it is answered. */
const askedAtom = Atom.make<Readonly<Record<string, string>>>({}).pipe(
  Atom.keepAlive,
  Atom.withLabel("access-asked"),
);

export const useInboxCount = () => useAtomValue(inboxCountAtom);
export const useInbox = () => useAtomValue(inboxAtom);
export const useAskedAccess = (shareId: string) => useAtomValue(askedAtom)[shareId] ?? null;

const decodeCount = Schema.decodeUnknownOption(CloudInboxCount);
const decodeInbox = Schema.decodeUnknownOption(CloudInbox);
const decodeTasks = Schema.decodeUnknownOption(CloudMyTasks);
const decodeAsked = Schema.decodeUnknownOption(CloudBoardAccessResult);
const decodeMessage = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

const UNREACHABLE = "Could not reach the board service.";

const userNow = () => readBoardAccountProfile()?.userId ?? null;

async function messageOf(response: Response | null, fallback: string): Promise<string> {
  if (response === null) return UNREACHABLE;
  return Option.match(decodeMessage(await response.json().catch(() => null)), {
    onNone: () => fallback,
    onSome: ({ message }) => message,
  });
}

let countUser: string | null = null;
let countReadAt = 0;
// Focus and showing the page come together; one read answers both.
const COUNT_STEP_MS = 5_000;

/** Reads how many are unread again; `now` reads even if it was just read. */
export async function refreshInboxCount(now = false): Promise<void> {
  const user = userNow();
  if (user !== countUser) {
    countUser = user;
    appAtomRegistry.set(inboxCountAtom, null);
    appAtomRegistry.set(inboxAtom, null);
    appAtomRegistry.set(askedAtom, {});
  }
  if (user === null || !boardAccountsEnabled()) return;
  if (!now && Date.now() - countReadAt < COUNT_STEP_MS) return;
  countReadAt = Date.now();
  const response = await accountRequest(CLOUD_INBOX_COUNT_ROUTE);
  if (userNow() !== user || response?.ok !== true) return;
  const count = Option.getOrNull(decodeCount(await response.json().catch(() => null)));
  if (count !== null && userNow() === user) appAtomRegistry.set(inboxCountAtom, count);
}

/** Reads the whole inbox, for its list. */
export async function loadInbox(): Promise<void> {
  const user = userNow();
  if (user === null) return;
  const response = await accountRequest(CLOUD_INBOX_ROUTE);
  if (userNow() !== user || response?.ok !== true) return;
  const inbox = Option.getOrNull(decodeInbox(await response.json().catch(() => null)));
  if (inbox === null) return;
  appAtomRegistry.set(inboxAtom, inbox);
  appAtomRegistry.set(inboxCountAtom, {
    unread: inbox.unread,
    boards: [
      ...new Set(inbox.items.flatMap((item) => (item.read === true ? [] : (item.shareId ?? [])))),
    ],
  });
}

/** Marks some items, or all, read: here at once, then on the host. */
export async function markInboxRead(which: ReadonlyArray<string> | "all"): Promise<void> {
  const inbox = appAtomRegistry.get(inboxAtom);
  if (inbox !== null) {
    const items = inbox.items.map((item) =>
      item.read === true || (which !== "all" && !which.includes(item.id))
        ? item
        : { ...item, read: true as const },
    );
    appAtomRegistry.set(inboxAtom, {
      items,
      unread: items.filter((item) => item.read !== true).length,
    });
  }
  const response = await accountRequest(CLOUD_INBOX_READ_ROUTE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(which === "all" ? { all: true } : { ids: which }),
  });
  if (response?.ok !== true) return;
  const count = Option.getOrNull(decodeCount(await response.json().catch(() => null)));
  if (count !== null) appAtomRegistry.set(inboxCountAtom, count);
}

let watchers = 0;
let timer: ReturnType<typeof setInterval> | null = null;
const INBOX_STEP_MS = 60_000;

const onShown = () => {
  if (document.visibilityState === "visible") {
    void refreshInboxCount();
    timer ??= setInterval(() => void refreshInboxCount(), INBOX_STEP_MS);
  } else if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
};
const onFocus = () => void refreshInboxCount();

/** Keeps the count fresh while anything shows it. Returns how to stop. */
export function watchInbox(): () => void {
  watchers += 1;
  if (watchers === 1) {
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onShown);
    onShown();
  }
  return () => {
    watchers -= 1;
    if (watchers > 0) return;
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onShown);
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
}

/**
 * Asks the board's maker for edit access, with an optional line. The request's id, or what went
 * wrong. `credential` is the view link the page was opened with, for someone not on the board.
 */
export async function askEditAccess(
  shareId: string,
  input: { readonly message: string; readonly credential?: string | undefined },
): Promise<string | null> {
  const name = readBoardAccountProfile()?.name ?? "Someone";
  const message = input.message.trim();
  const response = await accountRequest(
    `${CLOUD_BOARD_ACCESS_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        ...(message === "" ? {} : { message }),
        ...(input.credential === undefined ? {} : { credential: input.credential }),
      }),
    },
  );
  if (response?.ok !== true) return messageOf(response, "Could not ask. Try again.");
  const asked = Option.getOrNull(decodeAsked(await response.json().catch(() => null)));
  if (asked === null) return "Could not ask. Try again.";
  appAtomRegistry.update(askedAtom, (current) => ({ ...current, [shareId]: asked.request }));
  return null;
}

/**
 * Reads whether the account asked for edit access on this board and is still waiting, so a page
 * loaded again says Asked instead of offering to ask once more.
 */
export async function loadAskedAccess(shareId: string): Promise<void> {
  const response = await accountRequest(
    `${CLOUD_BOARD_ACCESS_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`,
  );
  if (response?.status !== 200) return;
  const asked = Option.getOrNull(decodeAsked(await response.json().catch(() => null)));
  if (asked === null) return;
  appAtomRegistry.update(askedAtom, (current) => ({ ...current, [shareId]: asked.request }));
}

/** Forgets a request this page asked once it was answered. */
export const forgetAskedAccess = (shareId: string) =>
  appAtomRegistry.update(askedAtom, ({ [shareId]: _gone, ...rest }) => rest);

/** Approves or declines a request, from the inbox. Null, or what went wrong. */
export async function answerEditAccess(
  item: CloudInboxItem,
  approve: boolean,
): Promise<string | null> {
  if (item.shareId === undefined || item.request === undefined) return "This request is gone.";
  const response = await accountRequest(
    `${CLOUD_BOARD_ACCESS_ANSWER_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(item.shareId)}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: item.request.id, approve }),
    },
  );
  const failed =
    response?.ok === true ? null : await messageOf(response, "Could not answer. Try again.");
  await loadInbox();
  return failed;
}

/**
 * Opens a board an inbox item or a task names, as the account's person on it, and asks it to show
 * the card. Where to go, or what went wrong.
 */
export async function openInboxBoard(target: {
  readonly shareId: string;
  readonly workspaceId?: string | undefined;
  readonly noteId?: string | undefined;
  readonly task?: boolean | undefined;
}): Promise<ReturnType<typeof guestShareLocation> | string> {
  const local = findGuestShare(target.shareId);
  let share = local !== null && local.viewOnly !== true ? local : null;
  if (share === null) {
    const opened = await openListedBoard({
      shareId: target.shareId,
      workspaceId: target.workspaceId ?? null,
    });
    if (typeof opened === "string") {
      if (local === null) return opened;
      share = local;
    } else {
      share = opened;
      // It could only look before: its open connection carries the view link.
      if (local?.viewOnly === true) reopenGuestShare(opened);
    }
  }
  if (target.noteId !== undefined) {
    requestBoardFocus(target.shareId, { noteId: target.noteId, plan: target.task === true });
  }
  return guestShareLocation(share);
}

/**
 * On a board opened from its view link: once the edit access this page asked for is approved,
 * opens the board as the account's new seat, without reloading the page.
 */
export async function takeGrantedAccess(shareId: string): Promise<string | null> {
  forgetAskedAccess(shareId);
  const opened = await openAccountBoard(shareId);
  if (typeof opened === "string") return opened;
  reopenGuestShare(opened);
  void refreshInboxCount(true);
  return null;
}

/** Every task given to the account across its boards, or what went wrong. */
export async function loadMyTasks(): Promise<ReadonlyArray<CloudMyTask> | string> {
  const response = await accountRequest(CLOUD_MY_TASKS_ROUTE);
  if (response?.ok !== true) return messageOf(response, "Could not read your tasks. Try again.");
  const read = Option.getOrNull(decodeTasks(await response.json().catch(() => null)));
  return read?.tasks ?? "Could not read your tasks. Try again.";
}
