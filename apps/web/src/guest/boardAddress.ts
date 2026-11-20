import { guestEnvironmentId, isGuestEnvironment } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";

/** A cloud board's own address. Its long one, `/guest-share-<id>/board-<id>`, still opens it. */
export const CLOUD_BOARD_PATH = "/b/$shareId" as const;
const CLOUD_BOARD_SEGMENT = "b";
const BOARD_THREAD_PREFIX = "board-";

// The board host names a board's one thread after its share (infra/boards/src/worker.ts).
const cloudBoardThreadId = (shareId: string) => ThreadId.make(`${BOARD_THREAD_PREFIX}${shareId}`);

/**
 * What the cloud board route's `shareId` stands for: the thread the `_chat` layout shows, under
 * the names it reads, so the board renders as it does at its long address.
 */
export const cloudBoardRouteParams = (shareId: string) => ({
  shareId,
  environmentId: guestEnvironmentId(shareId),
  threadId: cloudBoardThreadId(shareId),
});

/** The share a thread address names the way a cloud board's long address does, or null. */
export function cloudBoardShareIdOf(params: {
  readonly environmentId?: string | undefined;
  readonly threadId?: string | undefined;
}): string | null {
  const { environmentId, threadId } = params;
  if (threadId === undefined || !threadId.startsWith(BOARD_THREAD_PREFIX)) return null;
  const shareId = threadId.slice(BOARD_THREAD_PREFIX.length);
  return shareId !== "" && environmentId === guestEnvironmentId(shareId) ? shareId : null;
}

/**
 * Where a joined share opens: a cloud board at its own address, any other share (a thread on
 * someone's computer, a team's) at its thread's. `cloud` is the share's host, never its id.
 */
export function sharedThreadLocationOf(
  share: { readonly shareId: string; readonly threadId: string },
  cloud: boolean,
) {
  const environmentId = guestEnvironmentId(share.shareId);
  return cloud && cloudBoardShareIdOf({ environmentId, threadId: share.threadId }) !== null
    ? { to: CLOUD_BOARD_PATH, params: cloudBoardRouteParams(share.shareId) }
    : {
        to: "/$environmentId/$threadId" as const,
        params: { environmentId, threadId: ThreadId.make(share.threadId) },
      };
}

/** Whether a pathname is a shared thread's or a cloud board's, which a guest may load first. */
export function isSharedThreadPathname(pathname: string): boolean {
  const [, first, second] = pathname.split("/");
  return isGuestEnvironment(first) || (first === CLOUD_BOARD_SEGMENT && !!second);
}
