import type { SharedThreadCatchUpResult } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";
import { ROOM_SUMMARY_REQUEST, roomSummaryOutcome } from "./roomCatchUp.ts";

const said: SharedThreadCatchUpResult = {
  updates: [{ author: "owner", text: "Merged the fix.", at: "2026-11-12T10:00:00.000Z" }],
  truncated: false,
  cursor: "2026-11-12T10:00:00.000Z",
};

describe("roomSummaryOutcome", () => {
  it("drafts nothing when the room said nothing new", () => {
    for (const result of [
      { updates: [], truncated: false, cursor: null },
      { ...said, cursor: null },
    ] satisfies ReadonlyArray<SharedThreadCatchUpResult>) {
      expect(roomSummaryOutcome(result, "my draft")).toMatchObject({
        record: null,
        prompt: null,
        status: "Nothing new",
      });
    }
  });

  it("drafts the request alone in an empty composer", () => {
    const outcome = roomSummaryOutcome(said, " \n");
    expect(outcome.prompt).toBe(ROOM_SUMMARY_REQUEST);
    expect(outcome.record?.messageCount).toBe(1);
  });

  it("appends the request as a new paragraph after an existing draft", () => {
    expect(roomSummaryOutcome(said, "Also check the CSS.\n  ").prompt).toBe(
      `Also check the CSS.\n\n${ROOM_SUMMARY_REQUEST}`,
    );
  });
});
