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
import { appAtomRegistry } from "../rpc/atomRegistry";
import { boardsToClaim, sharesOfOtherAccounts } from "./boardAccount.logic";
import { cloudBoardsHost, cloudBoardsOrigin } from "./cloudBoardsHost";
import {
  type JoinedGuestShare,
  accountBoardsAtom,
  forgetGuestShare,
  isCloudShare,
  readGuestShares,
  rememberGuestShare,
} from "./guestShares";

/** Who is signed in to Tinkjam here, and how to get their current session token. */
interface BoardAccountSession {
  readonly userId: string;
  /** The name the account joins boards under, so it is never asked for. */
  readonly name: string | null;
  readonly readToken: () => Promise<string | null>;
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
  | { readonly status: "signed-in"; readonly name: string | null };

/** Who is signed in for cloud boards, as React reads it. */
export function useBoardAccount(): BoardAccountState {
  const account = useAtomValue(boardAccountAtom);
  const loaded = useAtomValue(boardAccountLoadedAtom);
  if (!boardAccountsEnabled()) return { status: "off" };
  if (!loaded) return { status: "loading" };
  return account === null ? { status: "signed-out" } : { status: "signed-in", name: account.name };
}

/** The signed-in account's name, or null signed out or with none. */
export const readBoardAccountName = () => readBoardAccount()?.name ?? null;

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
export async function boardAccountAuth(): Promise<{
  readonly userId: string;
  readonly authorization: string;
} | null> {
  const account = readBoardAccount();
  if (account === null) return null;
  const token = await account.readToken().catch(() => null);
  return token === null ? null : { userId: account.userId, authorization: `Bearer ${token}` };
}

async function accountRequest(
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
  const listed = await listedOf(await accountRequest(CLOUD_BOARD_ACCOUNT_ROUTE));
  if (listed !== null && readBoardAccount() !== null) {
    appAtomRegistry.set(accountBoardsAtom, listed.boards);
  }
}

/** Adds the cloud boards this browser made or joined while signed out to the account. */
async function claimLocalBoards(): Promise<void> {
  while (readBoardAccount() !== null) {
    const claim = boardsToClaim({
      shares: readGuestShares(),
      listed: appAtomRegistry.get(accountBoardsAtom) ?? [],
      tried: triedClaims,
      isCloud: isCloudShare,
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
    if (readBoardAccount() !== null) appAtomRegistry.set(accountBoardsAtom, listed.boards);
  }
}

/**
 * Follows who is signed in: their boards are read and this browser's are added to them; a board
 * opened under an account no longer signed in goes from this browser.
 */
export function syncBoardAccount(session: BoardAccountSession | null): void {
  appAtomRegistry.set(boardAccountLoadedAtom, true);
  const before = readBoardAccount();
  if (before?.userId === session?.userId) {
    if (session !== null) appAtomRegistry.set(boardAccountAtom, session);
    return;
  }
  appAtomRegistry.set(boardAccountAtom, session);
  appAtomRegistry.set(accountBoardsAtom, null);
  triedClaims.clear();
  for (const shareId of sharesOfOtherAccounts(readGuestShares(), session?.userId ?? null)) {
    forgetGuestShare(shareId);
  }
  if (session === null || cloudBoardsOrigin() === null) return;
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
