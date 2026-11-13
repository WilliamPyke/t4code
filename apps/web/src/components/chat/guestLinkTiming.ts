const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// Below this a day reads as hours: a link made for a day still reads "1 day" moments later.
const DAYS_FROM_MS = 20 * HOUR_MS;
const ENDS_SOON_MS = 6 * HOUR_MS;

/** "Ends in 7 days", "Ends in 5 hours": the nearest whole day, or hour once under most of a day. */
export function linkEndsLabel(expiresAt: string, nowMs: number): string {
  const left = Date.parse(expiresAt) - nowMs;
  if (left >= DAYS_FROM_MS) {
    const days = Math.max(1, Math.round(left / DAY_MS));
    return `Ends in ${days} ${days === 1 ? "day" : "days"}`;
  }
  const hours = Math.round(left / HOUR_MS);
  return hours >= 1 ? `Ends in ${hours} ${hours === 1 ? "hour" : "hours"}` : "Ends within the hour";
}

/** Whether a link is close enough to its end to ask the owner to extend it. */
export const linkEndsSoon = (expiresAt: string, nowMs: number): boolean =>
  Date.parse(expiresAt) - nowMs < ENDS_SOON_MS;
