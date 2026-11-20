import { describe, expect, it } from "vite-plus/test";

import {
  formatDayAwareTimestamp,
  formatRecentTimestamp,
  formatUpcomingTimestamp,
} from "./timestampFormat";

describe("timestamps in an explicit time zone", () => {
  // 23:00 UTC on July 1 is 7 PM on July 1 in New York, whatever the host zone.
  const now = Date.parse("2026-07-01T23:00:00.000Z");
  const zone = "America/New_York";

  it("picks relative days from the calendar in that zone", () => {
    expect(formatUpcomingTimestamp("2026-07-02T00:30:00.000Z", "12-hour", now, zone)).not.toMatch(
      /tomorrow/,
    );
    expect(formatUpcomingTimestamp("2026-07-02T05:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^tomorrow at /,
    );
    expect(formatDayAwareTimestamp("2026-07-01T03:30:00.000Z", "12-hour", now, zone)).toMatch(
      /^yesterday at /,
    );
  });

  it("says how long ago something was today, and the day and time before that", () => {
    const rows: ReadonlyArray<readonly [string, RegExp]> = [
      ["2026-07-01T22:59:30.000Z", /^just now$/],
      // A clock a little ahead reads as now, never as the future.
      ["2026-07-01T23:00:20.000Z", /^just now$/],
      ["2026-07-01T22:55:00.000Z", /^5m ago$/],
      ["2026-07-01T20:00:00.000Z", /^3h ago$/],
      // 11:30 PM the day before in New York, though under a day ago.
      ["2026-07-01T03:30:00.000Z", /^yesterday at 11:30\sPM$/],
      ["2026-06-20T16:00:00.000Z", /^\D*6\D+20\D*12:00\sPM$/],
      ["2025-06-20T16:00:00.000Z", /2025/],
    ];
    for (const [at, label] of rows) {
      expect(formatRecentTimestamp(at, "12-hour", now, zone)).toMatch(label);
    }
  });
});
