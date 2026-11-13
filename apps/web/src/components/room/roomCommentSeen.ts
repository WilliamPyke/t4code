import type { RoomBoardNote } from "@t3tools/contracts";
import * as Schema from "effect/Schema";
import { useEffect, useSyncExternalStore } from "react";

import {
  readLocalStorageValue,
  subscribeLocalStorageKey,
  writeLocalStorageValue,
} from "~/hooks/useLocalStorage";

import {
  type BoardSeenComments,
  boardCommentsSeen,
  boardCommentUnread,
  boardNewestReplyAt,
  boardSeenCommentKey,
} from "./roomBoard.logic";

const SEEN_COMMENTS_KEY = "t3code.roomCommentsSeen";
const SeenComments = Schema.Record(Schema.String, Schema.String);
const NOTHING_SEEN: BoardSeenComments = {};

// Decoded once per change, not on each of the board's renders.
let snapshot: BoardSeenComments | null = null;
const readSeen = () =>
  (snapshot ??= readLocalStorageValue(SEEN_COMMENTS_KEY, NOTHING_SEEN, SeenComments));
const subscribeSeen = (onChange: () => void) => {
  snapshot = null;
  return subscribeLocalStorageKey(SEEN_COMMENTS_KEY, () => {
    snapshot = null;
    onChange();
  });
};

/**
 * Which comment threads of a board have replies this viewer has not seen on this device, and
 * the open thread remembered as seen. No share, as on a team's board: none are.
 */
export function useCommentUnread(
  shareId: string | undefined,
  open: RoomBoardNote | null,
  viewer: string | null,
): (note: RoomBoardNote) => boolean {
  const seen = useSyncExternalStore(subscribeSeen, readSeen, () => NOTHING_SEEN);
  const openKey =
    shareId === undefined || open === null ? null : boardSeenCommentKey(shareId, open.id);
  const openAt = open === null ? undefined : boardNewestReplyAt(open);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes what the viewer read to this device's storage, which outlives the board
  useEffect(() => {
    if (openKey === null || boardCommentsSeen(readSeen(), openKey, openAt) === readSeen()) return;
    writeLocalStorageValue(
      SEEN_COMMENTS_KEY,
      (current) => boardCommentsSeen(current, openKey, openAt),
      NOTHING_SEEN,
      SeenComments,
    );
  }, [openKey, openAt]);
  return (note) =>
    shareId !== undefined &&
    note.id !== open?.id &&
    boardCommentUnread(note, viewer, seen[boardSeenCommentKey(shareId, note.id)]);
}
