import {
  CLOUD_BOARD_COPIES_ROUTE,
  CLOUD_BOARD_LINK_ROUTE,
  CLOUD_BOARD_OUTLINE_ROUTE,
  CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
  CLOUD_BOARD_PEOPLE_ROLE_ROUTE,
  CLOUD_BOARD_ROUTE,
  CLOUD_BOARD_SHARING_ROUTE,
  CLOUD_BOARD_TITLE_ROUTE,
  GUEST_BOARD_CURSOR_ROUTE,
  GUEST_BOARD_ROUTE,
  GUEST_HANDOFF_ROUTE,
  GUEST_ROUTE_PREFIX,
} from "@t3tools/contracts";

import { roomFailure, type RoomFailure } from "./room.ts";

export const INVITE_ROUTE = `${GUEST_ROUTE_PREFIX}/invite`;
export const REDEEM_ROUTE = `${GUEST_ROUTE_PREFIX}/redeem`;
export const SESSION_ROUTE = `${GUEST_ROUTE_PREFIX}/session`;
export const STREAM_ROUTE = `${GUEST_ROUTE_PREFIX}/stream`;

// As on a machine's guest routes: a name, a title or one board change, and a pointer is a few bytes.
export const JSON_MAX_BODY_BYTES = 64 * 1024;
const CURSOR_MAX_BODY_BYTES = 256;

/** The routes signed by a session on one board (`?share=`), each with its method and body cap. */
export const SESSION_ROUTES: Readonly<Record<string, { method: string; maxBytes: number }>> = {
  [CLOUD_BOARD_ROUTE]: { method: "DELETE", maxBytes: 0 },
  [CLOUD_BOARD_PEOPLE_REMOVE_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [CLOUD_BOARD_PEOPLE_ROLE_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [CLOUD_BOARD_LINK_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [CLOUD_BOARD_SHARING_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [CLOUD_BOARD_COPIES_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [CLOUD_BOARD_TITLE_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [SESSION_ROUTE]: { method: "GET", maxBytes: 0 },
  [STREAM_ROUTE]: { method: "GET", maxBytes: 0 },
  [CLOUD_BOARD_OUTLINE_ROUTE]: { method: "GET", maxBytes: 0 },
  [GUEST_BOARD_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
  [GUEST_BOARD_CURSOR_ROUTE]: { method: "POST", maxBytes: CURSOR_MAX_BODY_BYTES },
  [GUEST_HANDOFF_ROUTE]: { method: "POST", maxBytes: JSON_MAX_BODY_BYTES },
};

/**
 * Who a session is on the board: someone who can change it, someone on it who can only look, or
 * someone looking on from the view link, who is nobody on it.
 */
export type BoardAccess = "edit" | "view" | "link";

// Reading the board. Someone on it who can only look may still leave it, and manage it when they
// are an owner of its workspace; those routes check that themselves.
const LOOKING: ReadonlySet<string> = new Set([
  SESSION_ROUTE,
  STREAM_ROUTE,
  CLOUD_BOARD_OUTLINE_ROUTE,
]);
const ON_THE_BOARD: ReadonlySet<string> = new Set([
  CLOUD_BOARD_PEOPLE_REMOVE_ROUTE,
  CLOUD_BOARD_PEOPLE_ROLE_ROUTE,
  CLOUD_BOARD_LINK_ROUTE,
  CLOUD_BOARD_SHARING_ROUTE,
  CLOUD_BOARD_COPIES_ROUTE,
]);

/** Whether a session with `access` may use a session route at all, or why not. */
export function checkAccess(access: BoardAccess, route: string): RoomFailure | null {
  if (access === "edit" || LOOKING.has(route)) return null;
  if (access === "view" && ON_THE_BOARD.has(route)) return null;
  return roomFailure("view_only");
}
