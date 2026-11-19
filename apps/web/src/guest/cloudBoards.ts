import { guestShareRequest } from "@t3tools/client-runtime/rpc";
import {
  CLOUD_BOARD_COPIES_ROUTE,
  CLOUD_BOARD_COPY_ROUTE,
  CLOUD_BOARD_LINK_ROUTE,
  CLOUD_BOARD_SHARING_ROUTE,
  CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
  CLOUD_BOARD_PEOPLE_ROLE_ROUTE,
  CLOUD_BOARD_ROUTE,
  CLOUD_BOARD_TITLE_MAX_LENGTH,
  CLOUD_BOARD_TITLE_ROUTE,
  CLOUD_BOARD_VIEW_ROUTE,
  CloudBoardCreateResult,
  CloudBoardLinkResult,
  GUEST_BOARD_ROUTE,
  GUEST_HANDOFF_ROUTE,
  GUEST_NAME_MAX_LENGTH,
  GuestHandoff,
  GuestRedeemResult,
  type CloudBoardLinkKind,
  type CloudBoardLinkSharing,
  type CloudBoardRole,
  type RoomBoardChange,
} from "@t3tools/contracts";
import { buildGuestLink } from "@t3tools/shared/guestLinks";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isElectron } from "../env";
import { configuredHostedAppUrl } from "../hostedPairing";
import { toastManager } from "../components/ui/toast";
import {
  SIGN_IN_UNCONFIRMED,
  boardJoinAuth,
  readBoardAccountProfile,
  refreshAccountBoards,
  saveBoardAccountName,
} from "./boardAccount";
import { resolveBoardName } from "./boardAccount.logic";
import {
  readAccountNameSeed,
  readNameSuggestion,
  readSignedOutName,
  rememberSignedOutName,
} from "./browserIdentity";
import { cloudBoardsHost, cloudBoardsOrigin } from "./cloudBoardsHost";
import {
  type JoinedGuestShare,
  guestShareEndpointOf,
  guestShareOrigin,
  isCloudShare,
  rememberGuestShare,
} from "./guestShares";
import { placeNewBoard } from "./workspaces";

const decodeCreated = Schema.decodeUnknownOption(CloudBoardCreateResult);
const decodeHandoff = Schema.decodeUnknownOption(GuestHandoff);
const decodeRedeemed = Schema.decodeUnknownOption(GuestRedeemResult);
const decodeLinkResult = Schema.decodeUnknownOption(CloudBoardLinkResult);

/**
 * The name to join a board under without asking: signed in, the account's own; signed out, the
 * one typed here signed out. Null when that person has none yet.
 */
export const knownBoardName = (): string | null => boardName().known;

/**
 * The name a name field starts with: the known one; else, for an account with none, what it
 * typed here signed out before it signed in, or nothing; signed out, this browser's friendly name.
 */
export const suggestedBoardName = (): string => boardName().suggested;

function boardName() {
  const account = readBoardAccountProfile();
  return resolveBoardName({
    account:
      account === null ? null : { name: account.name, seed: readAccountNameSeed(account.userId) },
    signedOutName: readSignedOutName(),
    suggestion: readNameSuggestion(),
  });
}

/**
 * Keeps the name this person typed for boards: signed in, as their account's (on the account
 * when it can keep one); signed out, as this browser's signed-out name.
 */
export function rememberBoardName(name: string) {
  const kept = name.trim().slice(0, GUEST_NAME_MAX_LENGTH).trim();
  if (kept === "") return;
  if (saveBoardAccountName(kept) === null) rememberSignedOutName(kept);
}

/**
 * Makes a board on the cloud host and joins it as `name`. Resolves to what the browser keeps of
 * it, or to a message for the person making it.
 */
export async function createCloudBoard(input: {
  readonly name: string;
  readonly title?: string;
}): Promise<JoinedGuestShare | string> {
  const origin = cloudBoardsOrigin();
  const host = cloudBoardsHost();
  if (origin === null || host === null) return "Could not reach the board service.";
  try {
    // Signed in, the board is the account's from the start, on every device it signs in on.
    const account = await boardJoinAuth();
    if (account === "unconfirmed") return SIGN_IN_UNCONFIRMED;
    const response = await fetch(`${origin}${CLOUD_BOARD_ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(account === null ? {} : { authorization: account.authorization }),
      },
      body: JSON.stringify({
        name: account?.name ?? input.name,
        ...(input.title === undefined ? {} : { title: input.title }),
      }),
      credentials: "omit",
    });
    if (response.status === 401) return "Sign in again to make a board.";
    if (response.status === 429) {
      return "A lot of boards were made from here in the last hour. Try again in a little while, or sign in.";
    }
    const created = response.ok
      ? Option.getOrNull(decodeCreated(await response.json().catch(() => null)))
      : null;
    if (created === null) return "Could not reach the board service.";
    if (account !== null) {
      // Made while the home shows a workspace, it is that workspace's board from the start. Not
      // waited for: the person is already on the board by then.
      void placeNewBoard(created.shareId).then((unplaced) => {
        if (unplaced === null) return;
        toastManager.add({
          type: "error",
          title: "The board stayed in My boards",
          description: unplaced,
        });
      });
      void refreshAccountBoards();
    }
    return {
      host,
      shareId: created.shareId,
      threadId: created.threadId,
      token: created.token,
      credential: created.credential,
      title: input.title ?? "Untitled board",
      joinedAt: new Date().toISOString(),
      made: true,
      ...(account === null ? {} : { accountId: account.userId }),
    };
  } catch {
    return "Could not reach the board service.";
  }
}

/**
 * Makes the caller's own copy of a board whose maker allows it, from their session on it or its
 * view link, and keeps it in this browser as a board they made. Resolves to it, or a message.
 */
export async function copyCloudBoard(
  source: JoinedGuestShare,
  title: string,
): Promise<JoinedGuestShare | string> {
  const origin = cloudBoardsOrigin();
  const host = cloudBoardsHost();
  if (origin === null || host === null) return "Could not reach the board service.";
  try {
    const account = await boardJoinAuth();
    if (account === "unconfirmed") return SIGN_IN_UNCONFIRMED;
    const response = await fetch(`${origin}${CLOUD_BOARD_COPY_ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(account === null ? {} : { authorization: account.authorization }),
      },
      // An account with no name yet is offered none to keep, so its copy needs a stand-in.
      body: JSON.stringify({
        name: account?.name ?? (suggestedBoardName() || "Teammate"),
        source: source.token,
      }),
      credentials: "omit",
    });
    if (response.status === 429) return "You made many boards in the last hour. Try again later.";
    if (response.status === 403) return "Whoever made this board has not allowed copies.";
    const created = response.ok
      ? Option.getOrNull(decodeCreated(await response.json().catch(() => null)))
      : null;
    if (created === null) return "Could not make the copy. Try again.";
    if (account !== null) void refreshAccountBoards();
    const copy: JoinedGuestShare = {
      host,
      shareId: created.shareId,
      threadId: created.threadId,
      token: created.token,
      credential: created.credential,
      title: `Copy of ${title}`.slice(0, CLOUD_BOARD_TITLE_MAX_LENGTH),
      joinedAt: new Date().toISOString(),
      made: true,
      ...(account === null ? {} : { accountId: account.userId }),
    };
    rememberGuestShare(copy);
    return copy;
  } catch {
    return "Could not reach the board service.";
  }
}

/** Lets anyone who can see the board copy it, or stops that. Resolves to null, or a message. */
export async function setCloudBoardCopies(
  share: JoinedGuestShare,
  on: boolean,
): Promise<string | null> {
  try {
    const response = await guestShareRequest(
      guestShareEndpointOf(share),
      CLOUD_BOARD_COPIES_ROUTE,
      {
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ on }),
        },
      },
    );
    if (response.ok) return null;
    return response.status === 403
      ? "Only the person who made this board can change this."
      : "The board service did not take that. Try again.";
  } catch {
    return "Could not reach the board service.";
  }
}

/** Renames a cloud board for everyone on it. Resolves to null, or to what went wrong. */
export async function renameCloudBoard(
  share: JoinedGuestShare,
  title: string,
): Promise<string | null> {
  try {
    const response = await guestShareRequest(guestShareEndpointOf(share), CLOUD_BOARD_TITLE_ROUTE, {
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        // The host takes no longer name, so a long one is cut rather than refused.
        body: JSON.stringify({ title: title.slice(0, CLOUD_BOARD_TITLE_MAX_LENGTH).trim() }),
      },
    });
    return response.ok ? null : "The board service did not take the new name. Try again.";
  } catch {
    return "Could not reach the board service.";
  }
}

/** Deletes a cloud board for everyone on it; only its maker may. Resolves to null, or why not. */
export async function deleteCloudBoard(share: JoinedGuestShare): Promise<string | null> {
  try {
    const response = await guestShareRequest(guestShareEndpointOf(share), CLOUD_BOARD_ROUTE, {
      init: { method: "DELETE" },
    });
    if (response.ok) return null;
    return response.status === 403
      ? "Only the person who made this board can delete it."
      : "The board service did not delete the board. Try again.";
  } catch {
    return "Could not reach the board service.";
  }
}

/**
 * Takes someone off a cloud board: the maker removing a person, or anyone themselves, which is
 * leaving. Resolves to null, or to what went wrong.
 */
export async function removeFromCloudBoard(
  share: JoinedGuestShare,
  guestId: string,
): Promise<string | null> {
  try {
    const response = await guestShareRequest(
      guestShareEndpointOf(share),
      CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
      {
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ guestId }),
        },
      },
    );
    // Already gone counts as done.
    if (response.ok || response.status === 410) return null;
    return response.status === 403
      ? "Only the person who made this board can remove people."
      : "The board service did not take that. Try again.";
  } catch {
    return "Could not reach the board service.";
  }
}

/** A short-lived token this person's own machine joins a cloud board with, or null. */
export async function cloudBoardHandoff(share: JoinedGuestShare): Promise<string | null> {
  try {
    const response = await guestShareRequest(guestShareEndpointOf(share), GUEST_HANDOFF_ROUTE, {
      init: { method: "POST" },
    });
    if (!response.ok) return null;
    return Option.getOrNull(decodeHandoff(await response.json().catch(() => null)))?.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Lays changes out on a new cloud board, one at a time, as a line waits for the cards it joins.
 * Resolves to whether all were taken.
 */
export async function putOnCloudBoard(
  share: JoinedGuestShare,
  changes: ReadonlyArray<RoomBoardChange>,
): Promise<boolean> {
  const endpoint = guestShareEndpointOf(share);
  for (const change of changes) {
    const taken = await guestShareRequest(endpoint, GUEST_BOARD_ROUTE, {
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      },
    }).then(
      (response) => response.ok,
      () => false,
    );
    if (!taken) return false;
  }
  return true;
}

/**
 * A link to a cloud board with `credential`, its edit or view link: the usual guest link, opening
 * on this app (the hosted app from the desktop app, whose own pages others cannot open).
 */
export function cloudBoardLink(share: JoinedGuestShare, credential: string): string | null {
  if (!isCloudShare(share)) return null;
  return buildGuestLink({
    host: share.host,
    credential,
    hostedAppUrl: isElectron ? configuredHostedAppUrl() : window.location.origin,
  });
}

/**
 * Opens a cloud board from its view link: no name and no seat, the link itself is the session.
 * Resolves to what the browser keeps of it, or to a message.
 */
export async function openViewLink(input: {
  readonly credential: string;
  readonly host: string;
}): Promise<JoinedGuestShare | string> {
  try {
    const response = await fetch(`${guestShareOrigin(input.host)}${CLOUD_BOARD_VIEW_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credential: input.credential }),
      credentials: "omit",
    });
    const opened = response.ok
      ? Option.getOrNull(decodeRedeemed(await response.json().catch(() => null)))
      : null;
    if (opened === null || opened.threadId === undefined) {
      return response.status === 403 || response.status === 410 || response.ok
        ? "This link no longer opens the board. Ask whoever shared it for a new one."
        : "Could not reach the board service.";
    }
    return {
      host: input.host,
      shareId: opened.shareId,
      threadId: opened.threadId,
      token: opened.token,
      title: opened.title?.trim() || "Shared board",
      joinedAt: new Date().toISOString(),
      viewOnly: true,
    };
  } catch {
    return "Could not reach the board service.";
  }
}

/**
 * Makes one of a cloud board's links anew, which ends the old one, or turns it off. Resolves to
 * the new credential, null once off, or a message.
 */
export async function setCloudBoardLink(
  share: JoinedGuestShare,
  kind: CloudBoardLinkKind,
  on: boolean,
): Promise<{ readonly credential: string | null } | string> {
  try {
    const response = await guestShareRequest(guestShareEndpointOf(share), CLOUD_BOARD_LINK_ROUTE, {
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, on }),
      },
    });
    if (response.status === 403) return "Only the person who made this board can change its links.";
    const result = response.ok
      ? Option.getOrNull(decodeLinkResult(await response.json().catch(() => null)))
      : null;
    return result ?? "The board service did not take that. Try again.";
  } catch {
    return "Could not reach the board service.";
  }
}

/**
 * Sets who a cloud board's links let in; `renew` also makes both links anew, which ends the old
 * ones. Resolves to null, or what went wrong.
 */
export async function setCloudBoardSharing(
  share: JoinedGuestShare,
  sharing: CloudBoardLinkSharing,
  renew = false,
): Promise<string | null> {
  try {
    const response = await guestShareRequest(
      guestShareEndpointOf(share),
      CLOUD_BOARD_SHARING_ROUTE,
      {
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(renew ? { sharing, renew } : { sharing }),
        },
      },
    );
    if (response.ok) return null;
    if (response.status === 403) return "Only the person who made this board can change its links.";
    return response.status === 404
      ? "The board service does not have link sharing yet. Try again later."
      : "The board service did not take that. Try again.";
  } catch {
    return "Could not reach the board service.";
  }
}

/** Lets someone on a cloud board edit it, or only look. Resolves to null, or what went wrong. */
export async function setCloudBoardRole(
  share: JoinedGuestShare,
  guestId: string,
  role: CloudBoardRole,
): Promise<string | null> {
  try {
    const response = await guestShareRequest(
      guestShareEndpointOf(share),
      CLOUD_BOARD_PEOPLE_ROLE_ROUTE,
      {
        init: {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ guestId, role }),
        },
      },
    );
    if (response.ok) return null;
    return response.status === 403
      ? "Only the person who made this board can change who edits it."
      : "The board service did not take that. Try again.";
  } catch {
    return "Could not reach the board service.";
  }
}
