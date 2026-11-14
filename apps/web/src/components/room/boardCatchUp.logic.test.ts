import { GuestId, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardCatchUp, boardNewestChange, boardVisitsWith } from "./boardCatchUp.logic";

const sam = GuestId.make("sam");
const card = (id: string, at: string | null, by?: GuestId, extra = {}): RoomBoardNote => ({
  id,
  text: id,
  x: 0,
  y: 0,
  ...(at === null ? {} : { changed: { at, ...(by === undefined ? {} : { guestId: by }) } }),
  ...extra,
});
const t = (minute: number) => `2026-11-15T10:${String(minute).padStart(2, "0")}:00.000Z`;

describe("boardCatchUp", () => {
  const notes = [
    card("late", t(30), sam),
    card("old", t(5), sam),
    card("unstamped", null),
    card("owner", t(20)),
    card("edited", t(25), sam),
    card("newest", t(50), sam),
    card("section", t(21), sam, { section: true }),
    card("comment", t(22), sam, { kind: "comment" }),
  ];

  it("shows what others changed since the last visit, oldest first", () => {
    // The owner looks: Sam's changes after 10:10 count, their own does not.
    expect(boardCatchUp(notes, t(10), null).map(({ id }) => id)).toEqual([
      "edited",
      "late",
      "newest",
    ]);
    // Sam sees only the owner's.
    expect(boardCatchUp(notes, t(10), sam).map(({ id }) => id)).toEqual(["owner"]);
    // A visit before anything was stamped counts every stamped change.
    expect(boardCatchUp(notes, "", sam).map(({ id }) => id)).toEqual(["owner"]);
    // A first visit shows nothing.
    expect(boardCatchUp(notes, undefined, null)).toEqual([]);
    // What changes after this visit began happens in front of the viewer.
    expect(boardCatchUp(notes, t(10), null, t(40)).map(({ id }) => id)).toEqual(["edited", "late"]);
  });

  it("remembers the newest stamp a board showed, and a bounded number of boards", () => {
    expect(boardNewestChange(notes)).toBe(t(50));
    expect(boardNewestChange([card("a", null)])).toBe("");
    const visits = { a: t(1), b: t(2), c: t(3) };
    expect(boardVisitsWith(visits, "a", t(9), 3)).toEqual({ b: t(2), c: t(3), a: t(9) });
    expect(boardVisitsWith(visits, "d", t(9), 3)).toEqual({ b: t(2), c: t(3), d: t(9) });
  });
});
