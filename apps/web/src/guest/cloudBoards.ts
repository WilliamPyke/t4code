import { guestShareRequest } from "@t3tools/client-runtime/rpc";
import {
  CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
  CLOUD_BOARD_ROUTE,
  CLOUD_BOARD_TITLE_MAX_LENGTH,
  CLOUD_BOARD_TITLE_ROUTE,
  CloudBoardCreateResult,
  GUEST_BOARD_ROUTE,
  GUEST_HANDOFF_ROUTE,
  GUEST_NAME_MAX_LENGTH,
  GuestHandoff,
  type RoomBoardChange,
} from "@t3tools/contracts";
import { buildGuestLink } from "@t3tools/shared/guestLinks";
import { useAtomValue } from "@effect/atom-react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { isElectron } from "../env";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { configuredHostedAppUrl } from "../hostedPairing";
import { appAtomRegistry } from "../rpc/atomRegistry";
import { toastManager } from "../components/ui/toast";
import { boardAccountAuth, readBoardAccountName, refreshAccountBoards } from "./boardAccount";
import { friendlyName } from "./boardAccount.logic";
import { cloudBoardsHost, cloudBoardsOrigin } from "./cloudBoardsHost";
import { type JoinedGuestShare, guestShareEndpointOf, isCloudShare } from "./guestShares";
import { placeNewBoard } from "./workspaces";

const decodeCreated = Schema.decodeUnknownOption(CloudBoardCreateResult);
const decodeHandoff = Schema.decodeUnknownOption(GuestHandoff);

// Per browser: the name this person joins boards under, so a new cloud board asks only once.
const BOARD_NAME_KEY = "t3code:board-name:v1";
const BoardName = Schema.String;

function readStoredBoardName(): string | null {
  try {
    return getLocalStorageItem(BOARD_NAME_KEY, BoardName)?.trim() || null;
  } catch {
    return null;
  }
}

// Kept in an atom too, so the account's name follows it the moment the person sets it.
const boardNameAtom = Atom.make<string | null>(readStoredBoardName()).pipe(
  Atom.keepAlive,
  Atom.withLabel("board-name"),
);

const readBoardName = () => appAtomRegistry.get(boardNameAtom);

/** The name this browser joins boards under, or null before the person typed one. */
export const useRememberedBoardName = () => useAtomValue(boardNameAtom);

/** The name to join a board under without asking: the account's, else the one this browser keeps. */
export const knownBoardName = (): string | null => readBoardAccountName() ?? readBoardName();

/** The name a name field starts with: the known one, else a friendly one to keep or replace. */
export const suggestedBoardName = (): string =>
  knownBoardName() ?? friendlyName((count) => Math.floor(Math.random() * count));

export function rememberBoardName(name: string) {
  const kept = name.trim().slice(0, GUEST_NAME_MAX_LENGTH).trim();
  if (kept === "") return;
  appAtomRegistry.set(boardNameAtom, kept);
  try {
    setLocalStorageItem(BOARD_NAME_KEY, kept, BoardName);
  } catch {
    // Blocked storage only means asking again next time.
  }
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
    const account = await boardAccountAuth();
    const response = await fetch(`${origin}${CLOUD_BOARD_ROUTE}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(account === null ? {} : { authorization: account.authorization }),
      },
      body: JSON.stringify({
        name: input.name,
        ...(input.title === undefined ? {} : { title: input.title }),
      }),
      credentials: "omit",
    });
    if (response.status === 401) return "Sign in again to make a board.";
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
 * The link that invites someone else to a cloud board: the usual guest link, opening on this app
 * (the hosted app from the desktop app, whose own pages others cannot open).
 */
export function cloudBoardInviteLink(share: JoinedGuestShare): string | null {
  if (!isCloudShare(share) || share.credential === undefined) return null;
  return buildGuestLink({
    host: share.host,
    credential: share.credential,
    hostedAppUrl: isElectron ? configuredHostedAppUrl() : window.location.origin,
  });
}
