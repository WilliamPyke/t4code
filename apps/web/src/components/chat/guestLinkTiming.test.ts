import { describe, expect, it } from "vite-plus/test";

import { linkEndsLabel, linkEndsSoon, linkLifetimeDays } from "./guestLinkTiming";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const endsIn = (ms: number) => new Date(NOW + ms).toISOString();

describe("linkEndsLabel", () => {
  it.each([
    [DAY - MINUTE, "Ends in 1 day"],
    [7 * DAY - 5 * MINUTE, "Ends in 7 days"],
    [6 * DAY + 13 * HOUR, "Ends in 7 days"],
    [6 * DAY + 11 * HOUR, "Ends in 6 days"],
    [36 * HOUR, "Ends in 2 days"],
    [20 * HOUR, "Ends in 1 day"],
    [19 * HOUR, "Ends in 19 hours"],
    [90 * MINUTE, "Ends in 2 hours"],
    [70 * MINUTE, "Ends in 1 hour"],
    [20 * MINUTE, "Ends within the hour"],
    [0, "Expired"],
  ])("a link with %i ms left reads %s", (left, label) => {
    expect(linkEndsLabel(endsIn(left), NOW)).toBe(label);
  });
});

describe("linkLifetimeDays", () => {
  it.each([
    [DAY, 1],
    [7 * DAY, 7],
    // Extended from a week to a month a few days in.
    [33 * DAY, 30],
    [3 * DAY, 1],
  ])("a link made to end %i ms later lasts %i days", (lasted, days) => {
    expect(linkLifetimeDays(endsIn(0), endsIn(lasted), [1, 7, 30])).toBe(days);
  });
});

describe("linkEndsSoon", () => {
  it.each([
    [DAY - MINUTE, false],
    [6 * HOUR + MINUTE, false],
    [6 * HOUR - MINUTE, true],
  ])("a link with %i ms left asks to be extended: %s", (left, soon) => {
    expect(linkEndsSoon(endsIn(left), NOW)).toBe(soon);
  });
});
