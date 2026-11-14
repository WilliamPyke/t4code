import { describe, expect, it } from "vite-plus/test";

import { teamSessionDue } from "./teamSession.logic";

const JOINED = "2026-11-12T00:00:00.000Z";
const team = { id: "team-core", environmentId: "env-owner", credential: "invite" };
const hoursLater = (hours: number) => Date.parse(JOINED) + hours * 60 * 60 * 1000;

describe("teamSessionDue", () => {
  it("renews a team member's session once its day is nearly up", () => {
    expect(teamSessionDue({ team, joinedAt: JOINED }, hoursLater(23))).toBe(false);
    expect(teamSessionDue({ team, joinedAt: JOINED }, hoursLater(23.9))).toBe(true);
    expect(teamSessionDue({ team, joinedAt: JOINED }, hoursLater(30))).toBe(true);
  });

  it("never renews a guest link's session", () => {
    expect(teamSessionDue({ joinedAt: JOINED }, hoursLater(30))).toBe(false);
  });
});
