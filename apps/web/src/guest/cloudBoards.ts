import { guestShareRequest } from "@t3tools/client-runtime/rpc";
import {
  CLOUD_BOARD_ROUTE,
  CLOUD_BOARD_TITLE_MAX_LENGTH,
  CLOUD_BOARD_TITLE_ROUTE,
  CloudBoardCreateResult,
  GUEST_BOARD_ROUTE,
  GUEST_NAME_MAX_LENGTH,
  type RoomBoardChange,
} from "@t3tools/contracts";
import { buildGuestLink } from "@t3tools/shared/guestLinks";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import { isElectron } from "../env";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { configuredHostedAppUrl } from "../hostedPairing";
import { cloudBoardsHost, cloudBoardsOrigin } from "./cloudBoardsHost";
import { type JoinedGuestShare, guestShareEndpointOf, isCloudShare } from "./guestShares";

const decodeCreated = Schema.decodeUnknownOption(CloudBoardCreateResult);

// Per browser: the name this person joins boards under, so a new cloud board asks only once.
const BOARD_NAME_KEY = "t3code:board-name:v1";
const BoardName = Schema.String;

export function readBoardName(): string | null {
  try {
    return getLocalStorageItem(BOARD_NAME_KEY, BoardName)?.trim() || null;
  } catch {
    return null;
  }
}

export function rememberBoardName(name: string) {
  try {
    setLocalStorageItem(BOARD_NAME_KEY, name.trim().slice(0, GUEST_NAME_MAX_LENGTH), BoardName);
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
    const response = await fetch(`${origin}${CLOUD_BOARD_ROUTE}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: input.name,
        ...(input.title === undefined ? {} : { title: input.title }),
      }),
      credentials: "omit",
    });
    const created = response.ok
      ? Option.getOrNull(decodeCreated(await response.json().catch(() => null)))
      : null;
    if (created === null) return "Could not reach the board service.";
    return {
      host,
      shareId: created.shareId,
      threadId: created.threadId,
      token: created.token,
      credential: created.credential,
      title: input.title ?? "Untitled board",
      joinedAt: new Date().toISOString(),
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
