import { GuestId, type RoomBoardNote } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  boardCatchUp,
  boardCatchUpLine,
  boardCatchUpStepLabel,
  boardNewestChange,
  boardVisitKey,
  boardVisitsWith,
} from "./boardCatchUp.logic";

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
    expect(boardCatchUp(notes, t(10), null).map(({ note }) => note.id)).toEqual([
      "comment",
      "edited",
      "late",
      "newest",
    ]);
    // Sam sees only the owner's.
    expect(boardCatchUp(notes, t(10), sam).map(({ note }) => note.id)).toEqual(["owner"]);
    // A visit before anything was stamped counts every stamped change.
    expect(boardCatchUp(notes, "", sam).map(({ note }) => note.id)).toEqual(["owner"]);
    // A first visit shows nothing.
    expect(boardCatchUp(notes, undefined, null)).toEqual([]);
    // What changes after this visit began happens in front of the viewer.
    expect(boardCatchUp(notes, t(10), null, t(40)).map(({ note }) => note.id)).toEqual([
      "comment",
      "edited",
      "late",
    ]);
  });

  it("counts new replies in an older comment thread as one step, at the newest", () => {
    const reply = (id: string, at: string, by?: GuestId) => ({
      id,
      text: id,
      at,
      ...(by === undefined ? {} : { guestId: by }),
    });
    const thread = card("thread", t(1), sam, {
      kind: "comment",
      replies: [
        reply("r1", t(2), sam),
        reply("r2", t(35), sam),
        reply("r3", t(36)),
        reply("r4", t(45), sam),
      ],
    });
    const board = [thread, card("late", t(30), sam)];
    // The owner: Sam's replies at 10:35 and 10:45 make one step, after the 10:30 card.
    expect(boardCatchUp(board, t(10), null).map(({ note }) => note.id)).toEqual(["late", "thread"]);
    // Before this visit began only the 10:35 reply counts, still after the card.
    expect(boardCatchUp(board, t(10), null, t(40)).map(({ note }) => note.id)).toEqual([
      "late",
      "thread",
    ]);
    // Only one's own replies since: nothing to show there.
    expect(boardCatchUp([thread], t(40), sam)).toEqual([]);
    // Sam sees the owner's reply.
    expect(boardCatchUp([thread], t(10), sam).map(({ note }) => note.id)).toEqual(["thread"]);
    // The thread is one step that says what is new in it, and the line counts the replies too.
    const steps = boardCatchUp(board, t(10), null);
    expect(steps.map(boardCatchUpStepLabel)).toEqual(["New or changed note", "2 new replies"]);
    expect(boardCatchUpLine(steps)).toBe("2 changes, 2 new replies since you were here");
    // A guest's new comment with their reply in it, beside their note.
    const fresh = card("fresh", t(31), sam, { kind: "comment", replies: [reply("r", t(32), sam)] });
    const guest = boardCatchUp([card("late", t(30), sam), fresh], t(10), null);
    expect(guest.map(boardCatchUpStepLabel)).toEqual([
      "New or changed note",
      "New comment and 1 reply",
    ]);
    expect(boardCatchUpLine(guest)).toBe("2 changes, 1 new reply since you were here");
    expect(boardCatchUpLine(guest.slice(0, 1))).toBe("1 change since you were here");
    const edited = card("edited", t(33), sam, { kind: "comment", editedAt: t(33) });
    expect(boardCatchUp([edited], t(10), null).map(boardCatchUpStepLabel)).toEqual([
      "Edited comment",
    ]);
    // Dismissing keeps the newest reply as the visit, so none of them comes back.
    expect(boardNewestChange(board)).toBe(t(45));
    expect(boardCatchUp(board, boardNewestChange(board), null)).toEqual([]);
  });

  it("keeps each person's visit to each board apart", () => {
    const keys = [
      boardVisitKey("guest:a", sam),
      boardVisitKey("guest:a", GuestId.make("kim")),
      boardVisitKey("guest:b", sam),
      boardVisitKey("guest:a", null),
    ];
    expect(new Set(keys).size).toBe(keys.length);
    expect(boardVisitKey("guest:a", sam)).toBe(boardVisitKey("guest:a", sam));
  });

  it("remembers the newest stamp a board showed, and a bounded number of boards", () => {
    expect(boardNewestChange(notes)).toBe(t(50));
    expect(boardNewestChange([card("a", null)])).toBe("");
    const visits = { a: t(1), b: t(2), c: t(3) };
    expect(boardVisitsWith(visits, "a", t(9), 3)).toEqual({ b: t(2), c: t(3), a: t(9) });
    expect(boardVisitsWith(visits, "d", t(9), 3)).toEqual({ b: t(2), c: t(3), d: t(9) });
  });
});
