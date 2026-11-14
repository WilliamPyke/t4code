import { GuestId, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardByVotes, boardVoteCount, boardVoteToggles } from "./boardVotes.logic";

const sam = GuestId.make("sam");
const eve = GuestId.make("eve");
const note = (id: string, voters: ReadonlyArray<GuestId | null>, extra = {}): RoomBoardNote => ({
  id,
  text: id,
  x: 0,
  y: 0,
  reactions: [
    { emoji: "🎉", guestId: sam },
    ...voters.map((voter) => ({
      emoji: "👍" as const,
      ...(voter === null ? {} : { guestId: voter }),
    })),
  ],
  ...extra,
});

describe("boardVoteToggles", () => {
  it("votes for what this person has not voted for yet, and takes them all back once they have", () => {
    const voted = note("voted", [sam]);
    const open = note("open", [eve]);
    const section = note("section", [], { section: true });
    const pin = note("pin", [], { kind: "comment" });
    expect(boardVoteToggles([voted, open, section, pin], sam)).toEqual([open]);
    expect(boardVoteToggles([voted, section], sam)).toEqual([voted]);
    // The owner's vote has no guest.
    expect(boardVoteToggles([voted, note("owner", [null])], null)).toEqual([voted]);
    expect(boardVoteCount(voted)).toBe(1);
  });
});

describe("boardByVotes", () => {
  it("puts the most-voted first and keeps the order of ties", () => {
    const items = [
      note("a", []),
      note("b", [sam]),
      note("c", [sam, eve]),
      note("d", [eve]),
      note("e", []),
    ];
    expect(boardByVotes(items, boardVoteCount).map(({ id }) => id)).toEqual([
      "c",
      "b",
      "d",
      "a",
      "e",
    ]);
  });
});
