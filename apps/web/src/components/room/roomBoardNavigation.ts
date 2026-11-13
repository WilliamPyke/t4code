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

// Per device: the pan and zoom each board was last left at, by `roomBoardViewKey`.
const BOARD_VIEW_STORAGE_KEY = "t3code:room-board-view:v1";
const BoardViews = Schema.Record(
  Schema.String,
  Schema.Struct({ x: Schema.Finite, y: Schema.Finite, zoom: Schema.Finite }),
);
type BoardViewState = (typeof BoardViews.Type)[string];

const readBoardViews = () => {
  try {
    return getLocalStorageItem(BOARD_VIEW_STORAGE_KEY, BoardViews) ?? {};
  } catch {
    return {};
  }
};

/** What names a board's remembered view: the owner's thread, or a guest's room. */
export const roomBoardViewKey = (ref: ScopedThreadRef) => threadKey(ref);

/** The view this device last left a board at, if any. */
export const rememberedRoomBoardView = (key: string): BoardViewState | undefined =>
  readBoardViews()[key];

/** Keeps the view a board was left at, for the next time it opens here. */
export function rememberRoomBoardView(key: string, view: BoardViewState): void {
  const { [key]: _previous, ...others } = readBoardViews();
  const kept = Object.entries(others).slice(-(BOARD_CHAT_THREADS_KEPT - 1));
  try {
    setLocalStorageItem(
      BOARD_VIEW_STORAGE_KEY,
      { ...Object.fromEntries(kept), [key]: view },
      BoardViews,
    );
  } catch {
    // Storage that is full or blocked only loses the view.
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
