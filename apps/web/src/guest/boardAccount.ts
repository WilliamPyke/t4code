import {
  CLOUD_BOARD_ACCOUNT_CLAIM_ROUTE,
  CLOUD_BOARD_ACCOUNT_OPEN_ROUTE,
  CLOUD_BOARD_ACCOUNT_ROUTE,
  CloudBoardAccountList,
  CloudBoardAccountOpenResult,
  GUEST_SHARE_PARAM,
} from "@t3tools/contracts";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { hasCloudPublicConfig } from "../cloud/publicConfig";
import { isElectron } from "../env";
import { appAtomRegistry, subscribeAtomChanges } from "../rpc/atomRegistry";
import { boardsToClaim, sharesOfOtherAccounts } from "./boardAccount.logic";
import { keepBoardGuideFor } from "../components/room/boardGuideState";
import { toastManager } from "../components/ui/toast";
import {
  noteSignedInAccount,
  readAccountNameSeed,
  rememberAccountSavedName,
} from "./browserIdentity";
import { cloudBoardsHost, cloudBoardsOrigin } from "./cloudBoardsHost";
import {
  type JoinedGuestShare,
  accountBoardsAtom,
  forgetGuestShare,
  isCloudShare,
  readGuestShares,
  rememberGuestShare,
} from "./guestShares";
import { clearWelcomeDraft } from "./welcomeDraft";

/** Who is signed in to Tinkjam here, and how to get their current session token. */
interface BoardAccountSession {
  readonly userId: string;
  /** The name the account joins boards under, so it is never asked for. */
  readonly name: string | null;
  /** Whether that name is the account's own, rather than this browser's or its username. */
  readonly realName: boolean;
  /** Its picture, which its workspaces show beside its name. */
  readonly imageUrl?: string | undefined;
  readonly readToken: () => Promise<string | null>;
  /** Keeps a name on the account itself. Resolves to whether the account took it. */
  readonly saveName: (name: string) => Promise<boolean>;
}

const boardAccountAtom = Atom.make<BoardAccountSession | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("board-account"),
);

// Whether sign-in has said who, if anyone, is signed in on this page yet.
const boardAccountLoadedAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("board-account-loaded"),
);

/**
 * Whether this build signs people in to keep their cloud boards: a browser build with sign-in and
 * a cloud board host. Without, everything works signed out and no sign-in shows.
 */
export const boardAccountsEnabled = () =>
  !isElectron &&
  Boolean((import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined)?.trim()) &&
  hasCloudPublicConfig() &&
  cloudBoardsOrigin() !== null;

export type BoardAccountState =
  | { readonly status: "off" | "loading" | "signed-out" }
  | {
      readonly status: "signed-in";
      readonly name: string | null;
      readonly realName: boolean;
      /** Whether the account's list of boards has been read since it signed in (or failed to). */
      readonly listed: boolean;
    };

// Whether the signed-in account's list of boards was read, or the read failed, since sign-in.
const accountListSettledAtom = Atom.make(false).pipe(
  Atom.keepAlive,
  Atom.withLabel("account-boards-settled"),
);

/** Who is signed in for cloud boards, as React reads it. */
export function useBoardAccount(): BoardAccountState {
  const account = useAtomValue(boardAccountAtom);
  const loaded = useAtomValue(boardAccountLoadedAtom);
  const listed = useAtomValue(accountListSettledAtom);
  if (!boardAccountsEnabled()) return { status: "off" };
  if (!loaded) return { status: "loading" };
  return account === null
    ? { status: "signed-out" }
    : { status: "signed-in", name: account.name, realName: account.realName, listed };
}

/**
 * Keeps a typed name as the signed-in account's: on this browser at once, and on the account so
 * it follows them, resolving to whether the account took it. Null when nobody is signed in.
 */
export function saveBoardAccountName(name: string): Promise<boolean> | null {
  const account = readBoardAccount();
  if (account === null) return null;
  rememberAccountSavedName(account.userId, name);
  // Known from this moment, before sign-in reports it back: nothing after this asks for it again.
  appAtomRegistry.set(boardAccountAtom, { ...account, name, realName: true });
  return account.saveName(name);
}

/** Who is signed in: their id and how others see them, or null. */
export const readBoardAccountProfile = () => {
  const account = readBoardAccount();
  return account === null
    ? null
    : { userId: account.userId, name: account.name, imageUrl: account.imageUrl };
};

const decodeList = Schema.decodeUnknownOption(CloudBoardAccountList);
const decodeOpened = Schema.decodeUnknownOption(CloudBoardAccountOpenResult);
const decodeMessage = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

// Per page load: boards the host already refused to add, so they are not offered again.
const triedClaims = new Set<string>();

const readBoardAccount = () => appAtomRegistry.get(boardAccountAtom);

/** Whether the signed-in account lists this board. */
export const isAccountBoard = (shareId: string) =>
  readBoardAccount() !== null &&
  (appAtomRegistry.get(accountBoardsAtom)?.some((board) => board.shareId === shareId) ?? false);

/**
 * The signed-in account and a fresh session token for a request to the cloud board host, or null
 * when nobody is signed in. Only ever sent to that host.
 */
async function boardAccountAuth(): Promise<{
  readonly userId: string;
  readonly authorization: string;
} | null> {
  const account = readBoardAccount();
  if (account === null) return null;
  const token = await account.readToken().catch(() => null);
  return token === null ? null : { userId: account.userId, authorization: `Bearer ${token}` };
}

// How long making or joining a board waits to learn who is signed in. Past it (sign-in blocked
// or unreachable), the board is made or joined signed out, as on a browser without accounts.
const ACCOUNT_LOAD_WAIT_MS = 8_000;

const accountLoaded = (): Promise<void> =>
  !boardAccountsEnabled() || appAtomRegistry.get(boardAccountLoadedAtom)
    ? Promise.resolve()
    : new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          stop();
          resolve();
        };
        const timer = setTimeout(done, ACCOUNT_LOAD_WAIT_MS);
        const stop = subscribeAtomChanges(boardAccountLoadedAtom, done);
      });

/**
 * Who makes or joins a cloud board now, once sign-in has said: the account, its token and its
 * name; null when nobody is signed in; "unconfirmed" when someone is but their session gave no
 * token, so they are never seated as a stranger beside their own account.
 */
export async function boardJoinAuth(): Promise<
  | { readonly userId: string; readonly authorization: string; readonly name: string | null }
  | "unconfirmed"
  | null
> {
  await accountLoaded();
  if (readBoardAccount() === null) return null;
  const auth = (await boardAccountAuth()) ?? (await boardAccountAuth());
  const account = readBoardAccount();
  // Signed out meanwhile is as unsure as no token: the caller says so, and nothing is joined.
  if (auth === null || account?.userId !== auth.userId) return "unconfirmed";
  return { ...auth, name: account.name };
}

/** What a person is told when `boardJoinAuth` could not confirm them. */
export const SIGN_IN_UNCONFIRMED = "Could not confirm your sign-in. Try again in a moment.";

/** A request to the cloud board host signed as the account, or null signed out or unreachable. */
export async function accountRequest(
  path: string,
  init: {
    readonly method?: string;
    readonly headers?: Readonly<Record<string, string>>;
    readonly body?: string;
  } = {},
): Promise<Response | null> {
  const origin = cloudBoardsOrigin();
  const auth = await boardAccountAuth();
  if (origin === null || auth === null) return null;
  try {
    return await fetch(`${origin}${path}`, {
      ...init,
      headers: { ...init.headers, authorization: auth.authorization },
      credentials: "omit",
    });
  } catch {
    return null;
  }
}

const listedOf = async (response: Response | null) =>
  response?.ok === true
    ? Option.getOrNull(decodeList(await response.json().catch(() => null)))
    : null;

/** Reads the account's boards from the host again. */
export async function refreshAccountBoards(): Promise<void> {
  const reader = readBoardAccount()?.userId;
  const listed = await listedOf(await accountRequest(CLOUD_BOARD_ACCOUNT_ROUTE));
  if (reader === undefined || readBoardAccount()?.userId !== reader) return;
  if (listed !== null) appAtomRegistry.set(accountBoardsAtom, listed.boards);
  appAtomRegistry.set(accountListSettledAtom, true);
}

/**
 * Adds the cloud boards this browser made or joined while signed out to the account. On a board
 * the account is on already, the host folds this browser's seat into the account's, so the open
 * page becomes that person at once and nobody is on a board twice.
 */
async function claimLocalBoards(): Promise<void> {
  while (readBoardAccount() !== null) {
    const claim = boardsToClaim({
      shares: readGuestShares(),
      tried: triedClaims,
      // A board only looked at from its view link is nobody's seat to claim.
      isCloud: (share) => isCloudShare(share) && share.viewOnly !== true,
    });
    if (claim.length === 0) return;
    for (const share of claim) triedClaims.add(share.shareId);
    const listed = await listedOf(
      await accountRequest(CLOUD_BOARD_ACCOUNT_CLAIM_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          boards: claim.map(({ token, credential }) =>
            credential === undefined ? { token } : { token, credential },
          ),
        }),
      }),
    );
    if (listed === null) return;
    const account = readBoardAccount();
    if (account === null) return;
    appAtomRegistry.set(accountBoardsAtom, listed.boards);
    // The account's now: they go from this browser when it signs out, like any of its boards.
    const taken = new Set<string>(listed.boards.map((board) => board.shareId));
    for (const share of claim) {
      if (taken.has(share.shareId)) {
        const current = readGuestShares().find((kept) => kept.shareId === share.shareId);
        if (current !== undefined && current.accountId === undefined) {
          rememberGuestShare({ ...current, accountId: account.userId });
        }
      }
    }
  }
}

/**
 * Follows who is signed in: their boards are read and this browser's are added to them. When an
 * account signs out or another signs in, everything of the last one's goes from this browser:
 * its boards, their previews, its names, the name typed here before it signed in, and its
 * progress through the board's getting-started guide.
 */
export function syncBoardAccount(session: BoardAccountSession | null): void {
  // Before anything shows as loaded: the board's guide is this person's from its first paint.
  keepBoardGuideFor(session?.userId ?? null);
  appAtomRegistry.set(boardAccountLoadedAtom, true);
  const before = readBoardAccount();
  const listedBefore = appAtomRegistry.get(accountBoardsAtom) ?? [];
  const clear = noteSignedInAccount(session?.userId ?? null);
  if (before?.userId === session?.userId && !clear) {
    if (session !== null) appAtomRegistry.set(boardAccountAtom, session);
    return;
  }
  appAtomRegistry.set(boardAccountAtom, session);
  appAtomRegistry.set(accountBoardsAtom, null);
  appAtomRegistry.set(accountListSettledAtom, false);
  triedClaims.clear();
  const leaving = new Set(sharesOfOtherAccounts(readGuestShares(), session?.userId ?? null));
  // Claimed before claims were marked: known as the last account's only by its list.
  if (clear) for (const board of listedBefore) leaving.add(board.shareId);
  for (const shareId of leaving) forgetGuestShare(shareId);
  if (clear) clearWelcomeDraft();
  // Said here, where a sign-out is seen whether or not it loaded the page again.
  if (clear && session === null) toastManager.add({ type: "success", title: "Signed out" });
  if (session === null || cloudBoardsOrigin() === null) return;
  // An account with no name takes the one its person typed here signed out, so it is asked once.
  const typed = session.realName ? null : readAccountNameSeed(session.userId);
  if (typed !== null) void saveBoardAccountName(typed);
  void refreshAccountBoards().then(claimLocalBoards);
}

/**
 * Opens a board of the account's on this browser, as the same person on it. Resolves to what the
 * browser keeps of it, or to a message for the person.
 */
export async function openAccountBoard(shareId: string): Promise<JoinedGuestShare | string> {
  const host = cloudBoardsHost();
  const account = readBoardAccount();
  if (host === null || account === null) return "Sign in to open this board.";
  const response = await accountRequest(
    `${CLOUD_BOARD_ACCOUNT_OPEN_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`,
    { method: "POST" },
  );
  if (response === null) return "Could not reach the board service.";
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 410) forgetGuestShare(shareId);
    return Option.match(decodeMessage(json), {
      onNone: () => "Could not open this board. Try again.",
      onSome: ({ message }) => message,
    });
  }
  const opened = Option.getOrNull(decodeOpened(json));
  if (opened === null) return "Could not open this board. Try again.";
  const { board } = opened;
  const share: JoinedGuestShare = {
    host,
    shareId: board.shareId,
    threadId: board.threadId,
    token: opened.token,
    title: board.title,
    joinedAt: board.addedAt,
    guestId: board.guestId,
    accountId: account.userId,
    ...(board.maker ? { made: true } : {}),
    ...(board.credential === undefined ? {} : { credential: board.credential }),
  };
  rememberGuestShare(share);
  return share;
}

/** Leaves a board of the account's that this browser has no session on. Resolves to why not, or null. */
export async function leaveAccountBoard(shareId: string): Promise<string | null> {
  const response = await accountRequest(
    `${CLOUD_BOARD_ACCOUNT_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(shareId)}`,
    { method: "DELETE" },
  );
  if (response === null || !response.ok) return "Could not reach the board service.";
  forgetGuestShare(shareId);
  return null;
}
