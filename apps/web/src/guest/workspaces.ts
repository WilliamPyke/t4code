import { useAtomValue } from "@effect/atom-react";
import {
  CLOUD_WORKSPACES_ROUTE,
  CLOUD_WORKSPACE_BOARD_ROUTE,
  CLOUD_WORKSPACE_INVITE_ROUTE,
  CLOUD_WORKSPACE_JOIN_ROUTE,
  CLOUD_WORKSPACE_LEAVE_ROUTE,
  CLOUD_WORKSPACE_MEMBER_PARAM,
  CLOUD_WORKSPACE_MEMBER_ROUTE,
  CLOUD_WORKSPACE_OPEN_ROUTE,
  CLOUD_WORKSPACE_PARAM,
  CLOUD_WORKSPACE_PREVIEW_ROUTE,
  CLOUD_WORKSPACE_ROUTE,
  CloudBoardAccountOpenResult,
  CloudWorkspace,
  CloudWorkspaceInviteResult,
  CloudWorkspaceList,
  CloudWorkspacePreview,
  GUEST_SHARE_PARAM,
  type CloudWorkspaceRenameRequest,
  type CloudWorkspaceRole,
  type RoomBoardNoteColor,
} from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { appAtomRegistry } from "../rpc/atomRegistry";
import {
  accountRequest,
  boardAccountsEnabled,
  openAccountBoard,
  readBoardAccountProfile,
  refreshAccountBoards,
} from "./boardAccount";
import { cloudBoardsHost, cloudBoardsOrigin } from "./cloudBoardsHost";
import { type JoinedGuestShare, rememberGuestShare } from "./guestShares";

/** Which boards the home and sidebar show: every one, the person's own, or one workspace's. */
export type WorkspaceScope = "all" | "personal" | (string & {});

const WORKSPACE_JOIN_PATH = "/join-workspace";

const workspacesAtom = Atom.make<ReadonlyArray<CloudWorkspace> | null>(null).pipe(
  Atom.keepAlive,
  Atom.withLabel("workspaces"),
);

// Per browser: the scope last picked, so the home opens where the person left it.
const SCOPE_KEY = "t3code:boards-scope:v1";
const readStoredScope = (): WorkspaceScope => {
  try {
    return getLocalStorageItem(SCOPE_KEY, Schema.String) ?? "all";
  } catch {
    return "all";
  }
};
const scopeAtom = Atom.make<WorkspaceScope>(readStoredScope()).pipe(
  Atom.keepAlive,
  Atom.withLabel("workspace-scope"),
);

const decodeList = Schema.decodeUnknownOption(CloudWorkspaceList);
const decodeWorkspace = Schema.decodeUnknownOption(CloudWorkspace);
const decodeInvite = Schema.decodeUnknownOption(CloudWorkspaceInviteResult);
const decodePreview = Schema.decodeUnknownOption(CloudWorkspacePreview);
const decodeOpened = Schema.decodeUnknownOption(CloudBoardAccountOpenResult);
const decodeMessage = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));

const UNREACHABLE = "Could not reach the board service.";

/** The signed-in account's workspaces; null signed out, before they load, or without accounts. */
export const useWorkspaces = () => useAtomValue(workspacesAtom);

/** The scope shown: the one picked, unless it is a workspace the person is no longer in. */
export function useWorkspaceScope(): WorkspaceScope {
  const scope = useAtomValue(scopeAtom);
  const workspaces = useAtomValue(workspacesAtom);
  return scopeIn(scope, workspaces);
}

const scopeIn = (
  scope: WorkspaceScope,
  workspaces: ReadonlyArray<CloudWorkspace> | null,
): WorkspaceScope => {
  if (scope === "all" || scope === "personal") return workspaces === null ? "all" : scope;
  return workspaces?.some((workspace) => workspace.id === scope) === true ? scope : "all";
};

export function setWorkspaceScope(scope: WorkspaceScope) {
  appAtomRegistry.set(scopeAtom, scope);
  try {
    setLocalStorageItem(SCOPE_KEY, scope, Schema.String);
  } catch {
    // Blocked storage only means the home opens on every board next time.
  }
}

let syncedUser: string | null = null;

/** Follows who is signed in: their workspaces are read, and nobody else's are kept. */
export function syncWorkspaces(userId: string | null) {
  if (userId === syncedUser) return;
  syncedUser = userId;
  appAtomRegistry.set(workspacesAtom, null);
  if (userId !== null && boardAccountsEnabled()) void refreshWorkspaces();
}

/** Reads the account's workspaces again, as the home does each time it opens. */
export const refreshWorkspaceList = () => {
  if (syncedUser !== null && boardAccountsEnabled()) void refreshWorkspaces();
};

async function refreshWorkspaces(): Promise<void> {
  const user = syncedUser;
  const response = await accountRequest(CLOUD_WORKSPACES_ROUTE);
  if (user !== syncedUser) return;
  const listed =
    response?.ok === true
      ? Option.getOrNull(decodeList(await response.json().catch(() => null)))
      : null;
  if (user !== syncedUser) return;
  if (listed !== null) appAtomRegistry.set(workspacesAtom, listed.workspaces);
  // Signed in, the switcher always shows, so a workspace can be started even when the list
  // could not be read this time.
  else if (appAtomRegistry.get(workspacesAtom) === null) appAtomRegistry.set(workspacesAtom, []);
}

async function failureOf(response: Response | null, fallback: string): Promise<string> {
  if (response === null) return UNREACHABLE;
  return Option.match(decodeMessage(await response.json().catch(() => null)), {
    onNone: () => fallback,
    onSome: ({ message }) => message,
  });
}

const scoped = (route: string, params: Readonly<Record<string, string>>) =>
  `${route}?${new URLSearchParams(params).toString()}`;

const jsonInit = (method: string, body?: unknown) => ({
  method,
  ...(body === undefined
    ? {}
    : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
});

/** A change to a workspace; the list is read again after it. Null, or what went wrong. */
async function change(
  path: string,
  init: ReturnType<typeof jsonInit>,
  fallback: string,
): Promise<string | null> {
  const response = await accountRequest(path, init);
  if (response?.ok !== true) return failureOf(response, fallback);
  await refreshWorkspaces();
  return null;
}

/** How the account shows in its workspaces. Its name, else a plain one. */
const profile = () => {
  const account = readBoardAccountProfile();
  return {
    name: account?.name ?? "Teammate",
    ...(account?.imageUrl === undefined ? {} : { imageUrl: account.imageUrl }),
  };
};

export async function createWorkspace(input: {
  readonly name: string;
  readonly color: RoomBoardNoteColor;
}): Promise<CloudWorkspace | string> {
  const response = await accountRequest(
    CLOUD_WORKSPACES_ROUTE,
    jsonInit("POST", { ...input, profile: profile() }),
  );
  if (response?.ok !== true) return failureOf(response, "Could not make the workspace. Try again.");
  const made = Option.getOrNull(decodeWorkspace(await response.json().catch(() => null)));
  await refreshWorkspaces();
  return made ?? "Could not make the workspace. Try again.";
}

export const renameWorkspace = (workspaceId: string, rename: CloudWorkspaceRenameRequest) =>
  change(
    scoped(CLOUD_WORKSPACE_ROUTE, { [CLOUD_WORKSPACE_PARAM]: workspaceId }),
    jsonInit("POST", rename),
    "Could not rename the workspace. Try again.",
  );

export const deleteWorkspace = (workspaceId: string) =>
  change(
    scoped(CLOUD_WORKSPACE_ROUTE, { [CLOUD_WORKSPACE_PARAM]: workspaceId }),
    jsonInit("DELETE"),
    "Could not delete the workspace. Try again.",
  );

export const leaveWorkspace = (workspaceId: string) =>
  change(
    scoped(CLOUD_WORKSPACE_LEAVE_ROUTE, { [CLOUD_WORKSPACE_PARAM]: workspaceId }),
    jsonInit("POST"),
    "Could not leave the workspace. Try again.",
  );

/** A new invite link, which ends the old one. Its code, or what went wrong. */
export async function renewWorkspaceInvite(
  workspaceId: string,
): Promise<{ readonly invite: string } | string> {
  const response = await accountRequest(
    scoped(CLOUD_WORKSPACE_INVITE_ROUTE, { [CLOUD_WORKSPACE_PARAM]: workspaceId }),
    jsonInit("POST"),
  );
  if (response?.ok !== true) return failureOf(response, "Could not make a new link. Try again.");
  const made = Option.getOrNull(decodeInvite(await response.json().catch(() => null)));
  await refreshWorkspaces();
  return made ?? "Could not make a new link. Try again.";
}

export const endWorkspaceInvite = (workspaceId: string) =>
  change(
    scoped(CLOUD_WORKSPACE_INVITE_ROUTE, { [CLOUD_WORKSPACE_PARAM]: workspaceId }),
    jsonInit("DELETE"),
    "Could not turn off the link. Try again.",
  );

export const removeWorkspaceMember = (workspaceId: string, memberId: string) =>
  change(
    scoped(CLOUD_WORKSPACE_MEMBER_ROUTE, {
      [CLOUD_WORKSPACE_PARAM]: workspaceId,
      [CLOUD_WORKSPACE_MEMBER_PARAM]: memberId,
    }),
    jsonInit("DELETE"),
    "Could not remove them. Try again.",
  );

export const setWorkspaceMemberRole = (
  workspaceId: string,
  memberId: string,
  role: CloudWorkspaceRole,
) =>
  change(
    scoped(CLOUD_WORKSPACE_MEMBER_ROUTE, {
      [CLOUD_WORKSPACE_PARAM]: workspaceId,
      [CLOUD_WORKSPACE_MEMBER_PARAM]: memberId,
    }),
    jsonInit("POST", { role }),
    "Could not change their role. Try again.",
  );

const boardPath = (workspaceId: string, shareId: string) =>
  scoped(CLOUD_WORKSPACE_BOARD_ROUTE, {
    [CLOUD_WORKSPACE_PARAM]: workspaceId,
    [GUEST_SHARE_PARAM]: shareId,
  });

/** Puts a board its maker made in a workspace. Null, or what went wrong. */
export async function moveBoardToWorkspace(
  shareId: string,
  workspaceId: string,
): Promise<string | null> {
  const failed = await change(
    boardPath(workspaceId, shareId),
    jsonInit("POST"),
    "Could not move the board. Try again.",
  );
  if (failed === null) void refreshAccountBoards();
  return failed;
}

export const moveBoardOutOfWorkspace = (shareId: string, workspaceId: string) =>
  change(
    boardPath(workspaceId, shareId),
    jsonInit("DELETE"),
    "Could not move the board. Try again.",
  );

/** Puts a board just made in the workspace the home shows, if it shows one. */
export async function placeNewBoard(shareId: string): Promise<string | null> {
  const scope = scopeIn(appAtomRegistry.get(scopeAtom), appAtomRegistry.get(workspacesAtom));
  if (scope === "all" || scope === "personal") return null;
  return moveBoardToWorkspace(shareId, scope);
}

/**
 * Opens a workspace board on this browser as the account's person on it, seating them on first
 * open. Resolves to what the browser keeps of it, or to a message for the person.
 */
async function openWorkspaceBoard(
  workspaceId: string,
  shareId: string,
): Promise<JoinedGuestShare | string> {
  const host = cloudBoardsHost();
  const account = readBoardAccountProfile();
  if (host === null || account === null) return "Sign in to open this board.";
  const response = await accountRequest(
    scoped(CLOUD_WORKSPACE_OPEN_ROUTE, {
      [CLOUD_WORKSPACE_PARAM]: workspaceId,
      [GUEST_SHARE_PARAM]: shareId,
    }),
    jsonInit("POST", { name: profile().name }),
  );
  if (response?.ok !== true) {
    const failed = await failureOf(response, "Could not open this board. Try again.");
    if (response !== null) void refreshWorkspaces();
    return failed;
  }
  const opened = Option.getOrNull(decodeOpened(await response.json().catch(() => null)));
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
  };
  rememberGuestShare(share);
  void refreshAccountBoards();
  return share;
}

/** Opens a board only listed, not yet on this browser: as a workspace member, or as the account. */
export const openListedBoard = (board: {
  readonly shareId: string;
  readonly workspaceId: string | null;
}) =>
  board.workspaceId === null
    ? openAccountBoard(board.shareId)
    : openWorkspaceBoard(board.workspaceId, board.shareId);

/** What an invite link is for, read without signing in. */
export async function previewWorkspaceInvite(
  code: string,
): Promise<CloudWorkspacePreview | string> {
  const origin = cloudBoardsOrigin();
  if (origin === null) return UNREACHABLE;
  try {
    const response = await fetch(`${origin}${CLOUD_WORKSPACE_PREVIEW_ROUTE}`, {
      ...jsonInit("POST", { code }),
      credentials: "omit",
    });
    if (!response.ok) return failureOf(response, "This invite link is not valid.");
    return (
      Option.getOrNull(decodePreview(await response.json().catch(() => null))) ??
      "This invite link is not valid."
    );
  } catch {
    return UNREACHABLE;
  }
}

/** Joins by an invite link and shows that workspace on the home. */
export async function joinWorkspace(code: string): Promise<CloudWorkspace | string> {
  const response = await accountRequest(
    CLOUD_WORKSPACE_JOIN_ROUTE,
    jsonInit("POST", { code, profile: profile() }),
  );
  if (response?.ok !== true) return failureOf(response, "Could not join. Try again.");
  const joined = Option.getOrNull(decodeWorkspace(await response.json().catch(() => null)));
  if (joined === null) return "Could not join. Try again.";
  await refreshWorkspaces();
  setWorkspaceScope(joined.id);
  return joined;
}

/** The link that invites someone to a workspace. Sent by the person; Tinkjam sends no email. */
export const workspaceInviteLink = (code: string) =>
  `${window.location.origin}${WORKSPACE_JOIN_PATH}#${code}`;
