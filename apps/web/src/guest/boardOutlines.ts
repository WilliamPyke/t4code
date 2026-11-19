import { guestShareRequest } from "@t3tools/client-runtime/rpc";
import {
  CLOUD_BOARD_ACCOUNT_OUTLINE_ROUTE,
  CLOUD_BOARD_OUTLINE_ROUTE,
  CLOUD_WORKSPACE_OUTLINE_ROUTE,
  CLOUD_WORKSPACE_PARAM,
  GUEST_SHARE_PARAM,
  RoomBoardOutline,
  type RoomBoard,
} from "@t3tools/contracts";
import { boardOutline } from "@t3tools/shared/boardOutline";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { Atom } from "effect/reactivity";

import { appAtomRegistry } from "../rpc/atomRegistry";
import { accountRequest } from "./boardAccount";
import {
  type JoinedGuestShare,
  findGuestShare,
  guestRoomAtom,
  guestShareEndpointOf,
  isCloudShare,
} from "./guestShares";

/**
 * What a board list knows of a joined board it does not have open. `unavailable`: its host names
 * nothing of a board that is not open (a board on someone's computer). The last outline read
 * stays while a newer one loads, and when one could not be read.
 */
interface JoinedBoardOutlineState {
  readonly status: "loading" | "ready" | "failed" | "unavailable";
  readonly outline: RoomBoardOutline | null;
}

const NOT_READ: JoinedBoardOutlineState = { status: "loading", outline: null };

// Kept for the page's life, so a board expanded again shows at once what it showed before.
export const joinedBoardOutlineAtom = Atom.family((shareId: string) =>
  Atom.make<JoinedBoardOutlineState>(NOT_READ).pipe(
    Atom.keepAlive,
    Atom.withLabel(`board-outline:${shareId}`),
  ),
);

const decodeOutline = Schema.decodeUnknownOption(RoomBoardOutline);

/** A joined board's outline as its room names it: only a board on a computer has a room thread. */
const joinedBoardOutline = (
  share: Pick<JoinedGuestShare, "host">,
  view: { readonly title: string; readonly board?: RoomBoard | undefined },
): RoomBoardOutline => boardOutline(view.board, isCloudShare(share) ? null : view.title);

async function readOutline(response: Response | null): Promise<RoomBoardOutline | null> {
  if (response?.ok !== true) return null;
  return Option.getOrNull(decodeOutline(await response.json().catch(() => null)));
}

/** One small request, by the way this person could open the board: never the board itself. */
async function fetchOutline(board: {
  readonly shareId: string;
  readonly workspaceId: string | null;
}): Promise<JoinedBoardOutlineState> {
  const share = findGuestShare(board.shareId);
  if (share !== null) {
    const read = await guestShareRequest(guestShareEndpointOf(share), CLOUD_BOARD_OUTLINE_ROUTE)
      .then(readOutline)
      .catch(() => null);
    if (read !== null) return { status: "ready", outline: read };
    // What this page last saw of it, when it had the board open.
    const seen = appAtomRegistry.get(guestRoomAtom(board.shareId)).view;
    if (seen !== null) return { status: "ready", outline: joinedBoardOutline(share, seen) };
    return { status: isCloudShare(share) ? "failed" : "unavailable", outline: null };
  }
  const named = `${GUEST_SHARE_PARAM}=${encodeURIComponent(board.shareId)}`;
  const read = await readOutline(
    await accountRequest(
      board.workspaceId === null
        ? `${CLOUD_BOARD_ACCOUNT_OUTLINE_ROUTE}?${named}`
        : `${CLOUD_WORKSPACE_OUTLINE_ROUTE}?${CLOUD_WORKSPACE_PARAM}=${encodeURIComponent(board.workspaceId)}&${named}`,
    ),
  );
  return read === null ? { status: "failed", outline: null } : { status: "ready", outline: read };
}

/** Reads a joined board's outline again, as a row does each time it is expanded. */
export async function refreshJoinedBoardOutline(board: {
  readonly shareId: string;
  readonly workspaceId: string | null;
}): Promise<void> {
  const atom = joinedBoardOutlineAtom(board.shareId);
  const kept = appAtomRegistry.get(atom).outline;
  appAtomRegistry.set(atom, { status: "loading", outline: kept });
  const next = await fetchOutline(board);
  appAtomRegistry.set(
    atom,
    next.outline === null && kept !== null ? { status: "ready", outline: kept } : next,
  );
}
