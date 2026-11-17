import { useAtomValue } from "@effect/atom-react";
import {
  guestEnvironmentId,
  isGuestEnvironment,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useLocation, useParams } from "@tanstack/react-router";
import { useEffect } from "react";

import { setDocumentPageName } from "~/documentTitle";
import { guestSharesAtom } from "~/guest/guestShares";
import { useThreadShell } from "~/state/entities";

const PAGE_NAMES: ReadonlyArray<readonly [string, string]> = [
  ["/whats-new", "What's new"],
  ["/account", "Your account"],
  ["/usage", "Usage"],
  ["/pull-requests", "Pull requests"],
  ["/welcome", "Welcome"],
];

function pageNameOf(pathname: string): string | null {
  if (pathname === "/") return "Boards";
  if (pathname === "/settings" || pathname.startsWith("/settings/")) return "Settings";
  return PAGE_NAMES.find(([path]) => path === pathname)?.[1] ?? null;
}

/** The browser tab says where you are: the board's name on a board, else the page's. */
export function DocumentTitleSync() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const params = useParams({ strict: false });
  const shares = useAtomValue(guestSharesAtom);
  const boardRef =
    params.roomEnvironmentId && params.roomThreadId
      ? scopeThreadRef(
          EnvironmentId.make(params.roomEnvironmentId),
          ThreadId.make(params.roomThreadId),
        )
      : null;
  const ownThreadRef =
    params.environmentId && params.threadId && !isGuestEnvironment(params.environmentId)
      ? scopeThreadRef(EnvironmentId.make(params.environmentId), ThreadId.make(params.threadId))
      : null;
  const board = useThreadShell(boardRef);
  const thread = useThreadShell(ownThreadRef);
  const share =
    params.environmentId && isGuestEnvironment(params.environmentId)
      ? shares.find(
          (candidate) =>
            guestEnvironmentId(candidate.shareId) === params.environmentId &&
            candidate.threadId === params.threadId,
        )
      : undefined;
  const name =
    boardRef !== null
      ? (board?.title ?? null)
      : (share?.title ?? thread?.title ?? pageNameOf(pathname));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- writes the page's name into document.title, which lives outside React
  useEffect(() => {
    setDocumentPageName(name);
  }, [name]);
  return null;
}
