import { TEAM_SESSION_TTL_MS } from "@t3tools/contracts";

// Renewed a little early, so a thread opened near the end of the day does not drop mid-read.
const RENEW_BEFORE_MS = 10 * 60 * 1000;

/**
 * Whether a joined share's session should be renewed before it is used: only a share joined from
 * a team, whose member can ask the team again, once its day is nearly up. A guest link never is.
 */
export function teamSessionDue(
  share: { readonly team?: unknown; readonly joinedAt: string },
  now: number,
): boolean {
  if (share.team === undefined) return false;
  const joinedAt = Date.parse(share.joinedAt);
  return Number.isNaN(joinedAt) || now >= joinedAt + TEAM_SESSION_TTL_MS - RENEW_BEFORE_MS;
}
