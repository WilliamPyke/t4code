import * as Exit from "effect/Exit";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vite-plus/test";

import {
  GuestRedeemRequest,
  RoomBoardAgentAddInput,
  RoomBoardAgentUpdateInput,
} from "./guestShare.ts";

const isRedeem = Schema.is(GuestRedeemRequest);

describe("board tool inputs", () => {
  const failure = (exit: Exit.Exit<unknown, Schema.SchemaError>) =>
    Exit.isFailure(exit) ? String(exit.cause) : "";
  const changes = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ id: `t${index}`, status: "doing" }));
  const cards = (count: number) =>
    Array.from({ length: count }, (_, index) => ({ text: `${index}` }));

  // An agent that turns 20 notes into tasks then plans them sends one change for each note and
  // one more for each task; a cap it trips must say how to recover.
  it("takes an update for every card one add makes, and says how to send more", () => {
    const update = Schema.decodeUnknownExit(RoomBoardAgentUpdateInput);
    expect(Exit.isSuccess(update({ changes: changes(40) }))).toBe(true);
    expect(failure(update({ changes: changes(41) }))).toContain(
      "At most 40 changes per call; send the rest in a second call.",
    );
    const add = Schema.decodeUnknownExit(RoomBoardAgentAddInput);
    expect(Exit.isSuccess(add({ cards: cards(20) }))).toBe(true);
    expect(failure(add({ cards: cards(21) }))).toContain(
      "At most 20 cards per call; add the rest in a second call.",
    );
  });
});

describe("GuestRedeemRequest", () => {
  it("accepts a one-line name and rejects names that break the attribution line", () => {
    expect(isRedeem({ credential: "invite", name: "Maya Chen" })).toBe(true);
    for (const name of [
      "Maya\nowner",
      "Maya owner",
      "Maya owner",
      "Maya\u0007",
      "Theo\u202E (owner)",
      "Theo\u2066x",
    ]) {
      expect(isRedeem({ credential: "invite", name })).toBe(false);
    }
  });
});
