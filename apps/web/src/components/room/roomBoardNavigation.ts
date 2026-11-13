import { ROOM_BOARD_ROOM_BOX, type ScopedThreadRef } from "@t3tools/contracts";
import * as Schema from "effect/Schema";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

// Per device: the conversation the owner last had beside each thread's board, or null for none.
const BOARD_CHAT_STORAGE_KEY = "t3code:room-board-chat:v1";
const BOARD_CHAT_THREADS_KEPT = 100;
const BoardChats = Schema.Record(
  Schema.String,
  Schema.NullOr(Schema.String.check(Schema.isMaxLength(64))),
);

const threadKey = (ref: ScopedThreadRef) => `${ref.environmentId}:${ref.threadId}`;

const readBoardChats = () => {
  try {
    return getLocalStorageItem(BOARD_CHAT_STORAGE_KEY, BoardChats) ?? {};
  } catch {
    return {};
  }
};

/** Keeps which conversation is beside a thread's board, so it opens that way next time. */
export function rememberRoomBoardChat(ref: ScopedThreadRef, chat: string | null): void {
  const key = threadKey(ref);
  const { [key]: _previous, ...others } = readBoardChats();
  const kept = Object.entries(others).slice(-(BOARD_CHAT_THREADS_KEPT - 1));
  try {
    setLocalStorageItem(
      BOARD_CHAT_STORAGE_KEY,
      { ...Object.fromEntries(kept), [key]: chat },
      BoardChats,
    );
  } catch {
    // Storage that is full or blocked only loses the preference.
  }
}

/**
 * Where a thread's board opens: with the conversation the owner last left beside it, none if
 * they closed it, or the room thread's the first time.
 */
export function roomBoardLocation(ref: ScopedThreadRef) {
  const remembered = readBoardChats()[threadKey(ref)];
  const chat = remembered === undefined ? ROOM_BOARD_ROOM_BOX : remembered;
  return {
    to: "/board/$roomEnvironmentId/$roomThreadId" as const,
    params: { roomEnvironmentId: ref.environmentId, roomThreadId: ref.threadId },
    search: chat === null ? {} : { chat },
  };
}
