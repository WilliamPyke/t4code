import { CLOUD_BOARD_FRAME_CHECK_ROUTE } from "@t3tools/contracts";
import { OWN_DOMAINS } from "@t3tools/shared/ownDomains";
import type { RoomEmbedFrameVerdict } from "@t3tools/shared/roomEmbed";
import { useEffect, useState } from "react";

import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";

/** The app's and the board host's hosts, and both of our domains, whose pages a board never frames. */
export function boardOwnHosts(): ReadonlyArray<string> {
  const boards = cloudBoardsOrigin();
  return [
    window.location.hostname,
    ...(boards === null ? [] : [new URL(boards).hostname]),
    ...OWN_DOMAINS,
  ];
}

const CHECK_TIMEOUT_MS = 8_000;
const verdicts = new Map<string, Promise<RoomEmbedFrameVerdict>>();

/** Asks the board host, once per address for as long as the page is open. */
function frameVerdict(origin: string, url: string): Promise<RoomEmbedFrameVerdict> {
  let verdict = verdicts.get(url);
  if (verdict === undefined) {
    verdict = fetch(`${origin}${CLOUD_BOARD_FRAME_CHECK_ROUTE}?url=${encodeURIComponent(url)}`, {
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((answer: unknown): RoomEmbedFrameVerdict => {
        const frame =
          typeof answer === "object" && answer !== null && "frame" in answer ? answer.frame : null;
        return frame === "ok" || frame === "refused" ? frame : "unknown";
      })
      .catch((): RoomEmbedFrameVerdict => "unknown");
    if (verdicts.size >= 256) verdicts.clear();
    verdicts.set(url, verdict);
  }
  return verdict;
}

/** The same answer for a click to wait on: "unknown" where there is no board host. */
export function boardFrameVerdict(url: string): Promise<RoomEmbedFrameVerdict> {
  const origin = cloudBoardsOrigin();
  return origin === null ? Promise.resolve("unknown") : frameVerdict(origin, url);
}

/**
 * Whether the site at `url` lets other pages frame it, as the cloud board host read from its
 * headers: null while it is asked, and "unknown" at once for no address or no board host, where
 * the board just tries the frame.
 */
export function useBoardFrameCheck(url: string | null): RoomEmbedFrameVerdict | null {
  const origin = url === null ? null : cloudBoardsOrigin();
  const [known, setKnown] = useState<{ url: string; verdict: RoomEmbedFrameVerdict } | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the board host, another server, whether this address's site refuses frames
  useEffect(() => {
    if (url === null || origin === null) return;
    let current = true;
    void frameVerdict(origin, url).then((verdict) => {
      if (current) setKnown({ url, verdict });
    });
    return () => {
      current = false;
    };
  }, [url, origin]);
  if (url === null || origin === null) return "unknown";
  return known?.url === url ? known.verdict : null;
}
