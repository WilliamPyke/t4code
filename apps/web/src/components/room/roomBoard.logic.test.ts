import { GuestId, ROOM_BOARD_MAX_COORDINATE, type RoomBoard } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  EMPTY_ROOM_BOARD,
  INITIAL_BOARD_VIEW,
  NO_BOARD_EDITS,
  type BoardPresence,
  appendNoteToDraft,
  boardAgents,
  boardCardBox,
  boardChangeOf,
  boardConnector,
  boardCursorAt,
  boardCursorColor,
  boardMessages,
  boardNoteBox,
  boardUrlIn,
  boardViewportOf,
  cursorSender,
  dropBoardEdit,
  followBoardView,
  parseBoardLink,
  pinnedCommentSpot,
  placeBoardCards,
  placeBoardNote,
  putBoardEdit,
  resolveBoard,
  screenToBoard,
  settleBoardValue,
  zoomBoardAt,
} from "./roomBoard.logic";

describe("zoomBoardAt", () => {
  it("keeps the board point under the cursor where it is, within the zoom limits", () => {
    const anchor = { x: 400, y: 260 };
    const panned = { x: -120, y: 35, zoom: 1 };
    const held = screenToBoard(panned, anchor);
    const zoomed = zoomBoardAt(panned, anchor, 1.5);
    expect(zoomed.zoom).toBe(1.5);
    expect(screenToBoard(zoomed, anchor).x).toBeCloseTo(held.x);
    expect(screenToBoard(zoomed, anchor).y).toBeCloseTo(held.y);

    expect(zoomBoardAt(INITIAL_BOARD_VIEW, anchor, 100).zoom).toBe(BOARD_MAX_ZOOM);
    expect(zoomBoardAt(INITIAL_BOARD_VIEW, anchor, 0.001).zoom).toBe(BOARD_MIN_ZOOM);
  });
});

describe("placeBoardCards", () => {
  it("keeps saved positions and gives a new card a free slot, not one under a saved card", () => {
    const first = placeBoardCards(["thread", "guest:a"], {});
    expect(first.thread).not.toEqual(first["guest:a"]);

    // The owner left "guest:a" exactly where the grid would put the first card.
    const saved = { "guest:a": first.thread! };
    const placed = placeBoardCards(["thread", "guest:a", "guest:b"], saved);
    expect(placed["guest:a"]).toEqual(saved["guest:a"]);
    const spots = Object.values(placed).map((point) => `${point.x}:${point.y}`);
    expect(new Set(spots).size).toBe(3);
  });
});

describe("placeBoardNote", () => {
  it("puts a new note where asked, or beside the notes and cards already there", () => {
    const wanted = { x: 500, y: 96 };
    expect(placeBoardNote(wanted, [], [])).toEqual(wanted);

    const first = placeBoardNote(wanted, [wanted], []);
    expect(first).toEqual({ x: 708, y: 96 });
    // A note dragged a little off the spot still covers it.
    expect(placeBoardNote(wanted, [{ x: 520, y: 140 }, first], []).x).toBeGreaterThan(708);
    // The thread card sits under the spot: the note goes past its right edge.
    expect(placeBoardNote(wanted, [], [{ x: 440, y: 72 }]).x).toBeGreaterThanOrEqual(760);
    // A full row sends the next note below the cards.
    const row = [wanted, first, { x: 916, y: 96 }];
    expect(placeBoardNote(wanted, row, [])).toEqual({ x: 500, y: 240 });
  });
});

describe("resolveBoard", () => {
  const thread = { kind: "card", id: "thread" } as const;
  const room = (x: number): RoomBoard => ({ positions: { thread: { x, y: 0 } }, notes: [] });

  it("shows a drag over the room's copy, then the room's copy once it moves on", () => {
    const dragging = putBoardEdit(room(0), NO_BOARD_EDITS, thread, { x: 40.4, y: 0 }, true);
    // Someone else moving the card does not pull it from under the pointer.
    expect(resolveBoard(room(900), dragging).positions.thread).toEqual({ x: 40.4, y: 0 });

    const dropped = settleBoardValue({ x: 40.4, y: 0 });
    const sent = putBoardEdit(room(0), dragging, thread, dropped, false);
    expect(boardChangeOf(thread, dropped)).toEqual({
      type: "card.move",
      cardId: "thread",
      x: 40,
      y: 0,
    });
    // Until the server answers, the card stays where it was dropped.
    expect(resolveBoard(room(0), sent).positions.thread).toEqual({ x: 40, y: 0 });
    // A later move by someone else wins, and the edit is forgotten on the next one.
    expect(resolveBoard(room(900), sent).positions.thread).toEqual({ x: 900, y: 0 });
    const note = { kind: "note", id: "n" } as const;
    expect(Object.keys(putBoardEdit(room(900), sent, note, null, false))).toEqual(["note:n"]);
  });

  it("takes back a refused edit, unless a newer one replaced it", () => {
    const first = { x: 5, y: 5 };
    const sent = putBoardEdit(room(0), NO_BOARD_EDITS, thread, first, false);
    expect(dropBoardEdit(sent, thread, { x: 5, y: 5 })).toBe(sent);
    expect(resolveBoard(room(0), dropBoardEdit(sent, thread, first)).positions.thread).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("adds, rewrites and removes notes over the room's copy", () => {
    const target = { kind: "note", id: "n" } as const;
    const written = { id: "n", text: "Ship Friday", x: 1, y: 2 };
    const added = putBoardEdit(EMPTY_ROOM_BOARD, NO_BOARD_EDITS, target, written, false);
    expect(resolveBoard(EMPTY_ROOM_BOARD, added).notes).toEqual([written]);
    const stored: RoomBoard = { positions: {}, notes: [written] };
    const typing = putBoardEdit(stored, added, target, { ...written, text: "Ship Monday" }, true);
    expect(resolveBoard(stored, typing).notes[0]?.text).toBe("Ship Monday");
    const removed = putBoardEdit(stored, typing, target, null, false);
    expect(resolveBoard(stored, removed).notes).toEqual([]);
    expect(boardChangeOf(target, null)).toEqual({ type: "note.remove", noteId: "n" });
  });

  it("draws an arrow at once, and a note taken off takes its arrows", () => {
    const note = { id: "n", text: "Ship", x: 0, y: 0 };
    const stored: RoomBoard = { positions: {}, notes: [note] };
    const arrow = { kind: "edge", id: "e" } as const;
    const value = { id: "e", from: "note:n", to: "card:thread" };
    const drawn = putBoardEdit(stored, NO_BOARD_EDITS, arrow, value, false);
    expect(resolveBoard(stored, drawn).edges).toEqual([value]);
    expect(boardChangeOf(arrow, value)).toEqual({
      type: "edge.put",
      edgeId: "e",
      from: "note:n",
      to: "card:thread",
    });
    // The server's copy stands in for the edit, whatever order it wrote the fields in.
    const linked: RoomBoard = {
      ...stored,
      edges: [{ to: "card:thread", from: "note:n", id: "e" }],
    };
    expect(resolveBoard(linked, drawn).edges).toHaveLength(1);
    const gone = putBoardEdit(linked, drawn, { kind: "note", id: "n" }, null, false);
    expect(resolveBoard(linked, gone).edges).toEqual([]);
    expect(boardChangeOf(arrow, null)).toEqual({ type: "edge.remove", edgeId: "e" });
  });

  it("sends a task whole, so clearing its assignee reaches the room", () => {
    const task = { id: "t", text: "Fix login", x: 1, y: 2, kind: "task" as const };
    const target = { kind: "note", id: "t" } as const;
    expect(boardChangeOf(target, { ...task, done: true })).toEqual({
      type: "note.put",
      noteId: "t",
      text: "Fix login",
      x: 1,
      y: 2,
      kind: "task",
      done: true,
      assignee: null,
    });
    const assigned: RoomBoard = {
      positions: {},
      notes: [{ ...task, assignee: { guestId: GuestId.make("sam") } }],
    };
    // Unassigning differs from the room's copy, so it shows until the server answers.
    const cleared = putBoardEdit(assigned, NO_BOARD_EDITS, target, task, false);
    expect(resolveBoard(assigned, cleared).notes[0]?.assignee).toBeUndefined();
  });
});

describe("boardConnector", () => {
  it("joins the facing sides of two headers and finds the middle of the curve", () => {
    const card = boardCardBox({ x: 0, y: 0 });
    const note = boardNoteBox({ x: 500, y: 100 });
    const ahead = boardConnector(card, note);
    expect(ahead.path.startsWith("M320 18 ")).toBe(true);
    expect(ahead.path.endsWith(" 500 112")).toBe(true);
    expect(ahead.middle).toEqual({ x: 410, y: 65 });
    // Pointing back, the arrow leaves the left side and lands on the right one.
    const back = boardConnector(note, card);
    expect(back.path.startsWith("M500 112 ")).toBe(true);
    expect(back.path.endsWith(" 320 18")).toBe(true);
  });
});

describe("followBoardView", () => {
  it("shows what someone else's board shows, on a screen of another size", () => {
    const theirs = { x: -340, y: 120, zoom: 1.5 };
    const viewport = boardViewportOf(theirs, { width: 1200, height: 800 });
    expect(viewport).toEqual({ x: 627, y: 187, zoom: 1.5 });
    const mine = followBoardView(viewport, { width: 600, height: 400 });
    // The board point in the middle of their screen is in the middle of this one.
    expect(screenToBoard(mine, { x: 300, y: 200 })).toEqual({ x: 627, y: 187 });
    expect(mine.zoom).toBe(1.5);
    expect(followBoardView({ x: 0, y: 0, zoom: 9 }, { width: 10, height: 10 }).zoom).toBe(
      BOARD_MAX_ZOOM,
    );
  });
});

describe("parseBoardLink", () => {
  it("reads GitHub pull requests, issues and files short, and other links by host and path", () => {
    const shown = (url: string) => {
      const link = parseBoardLink(url);
      return link === null ? null : [link.title, link.detail];
    };
    expect(shown("https://github.com/acme/app/pull/123/files")).toEqual([
      "acme/app #123",
      "Pull request",
    ]);
    expect(shown("https://github.com/acme/app/issues/9")).toEqual(["acme/app #9", "Issue"]);
    expect(shown("https://github.com/acme/app/blob/main/src/a%20b.ts")).toEqual([
      "src/a b.ts",
      "acme/app · main",
    ]);
    expect(shown("https://github.com/acme/app")).toEqual(["acme/app", "github.com"]);
    expect(shown("https://www.example.com/docs/setup?x=1")).toEqual(["example.com", "/docs/setup"]);
    expect(shown("javascript:alert(1)")).toBeNull();
    expect(shown("ftp://example.com/file")).toBeNull();
  });

  it("takes pasted text as a link only when it is one http or https URL", () => {
    expect(boardUrlIn("  https://example.com/a  ")).toBe("https://example.com/a");
    expect(boardUrlIn("see https://example.com/a")).toBeNull();
    expect(boardUrlIn("data:text/html,hi")).toBeNull();
    expect(boardUrlIn("example.com")).toBeNull();
  });
});

describe("pinnedCommentSpot", () => {
  it("puts a comment beside the thread's card, clear of the notes there", () => {
    const thread = { x: 80, y: 72 };
    const first = pinnedCommentSpot({ positions: { thread }, notes: [] });
    expect(first).toEqual({ x: 440, y: 72 });
    const next = pinnedCommentSpot({
      positions: { thread },
      notes: [{ id: "c", text: "Why?", ...first, pinnedTo: "message:1" }],
    });
    expect(next).not.toEqual(first);
  });
});

describe("boardMessages", () => {
  it("shows the newest messages oldest first, naming the guest who wrote one", () => {
    const messages = boardMessages(
      [
        { id: "1", type: "user_message", text: "Old question" },
        { id: "2", type: "assistant_message", text: "Old answer" },
        { id: "3", type: "command_execution" },
        {
          id: "4",
          type: "user_message",
          text: "Message from guest Sam, sent by the owner:\n\nWhy 15 minutes?",
          context: { guest: { name: "Sam", text: "Why 15 minutes?" } },
        },
        { id: "5", type: "assistant_message", text: "  The token TTL is 900s.  " },
        { id: "6", type: "assistant_message", text: "" },
      ],
      3,
    );
    expect(messages).toEqual([
      { id: "2", author: null, text: "Old answer" },
      { id: "4", author: "Sam", text: "Why 15 minutes?" },
      { id: "5", author: null, text: "The token TTL is 900s." },
    ]);

    const reply = [
      "## Done",
      "",
      "- Fixed `a.ts`, see [the diff](https://example.com/diff).",
      "",
      "```ts",
      "const a = 1;",
      "```",
      "",
      "| File | Change |",
      "| --- | :-: |",
      "| a.ts | **fixed** |",
    ].join("\n");
    expect(boardMessages([{ id: "7", type: "assistant_message", text: reply }], 1)).toEqual([
      { id: "7", author: null, text: "Done: Fixed a.ts, see the diff. File Change a.ts fixed" },
    ]);
    // A reply that is only code still shows something.
    expect(
      boardMessages([{ id: "8", type: "assistant_message", text: "```sh\nls\n```" }], 1)[0]?.text,
    ).toBe("```sh ls ```");
  });
});

describe("boardCursorAt", () => {
  it("puts a pointer at whole board pixels, inside the board, whatever the pan and zoom", () => {
    expect(boardCursorAt({ x: -100, y: 20, zoom: 2 }, { x: 301, y: 120 })).toEqual({
      x: 201,
      y: 50,
    });
    expect(boardCursorAt({ x: 0, y: 0, zoom: 0.4 }, { x: 1e9, y: -1e9 })).toEqual({
      x: ROOM_BOARD_MAX_COORDINATE,
      y: -ROOM_BOARD_MAX_COORDINATE,
    });
  });
});

describe("cursorSender", () => {
  it("sends at most every interval, ending on the latest, and nothing for a still pointer", () => {
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    vi.useFakeTimers();
    const sent: Array<BoardPresence> = [];
    const cursor = cursorSender((presence) => sent.push(presence));
    cursor.leave();
    cursor.move({ x: 1, y: 1 });
    cursor.move({ x: 2, y: 2 });
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ at: { x: 2, y: 2 } }]);
    cursor.move({ x: 3, y: 3 });
    vi.advanceTimersByTime(40);
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(40);
    expect(sent.at(-1)).toEqual({ at: { x: 3, y: 3 } });
    // Back where it was sent last: nothing new to say.
    vi.advanceTimersByTime(200);
    cursor.move({ x: 3, y: 3 });
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(2);
    // Leaving drops a move not sent yet, and is said once.
    cursor.move({ x: 4, y: 4 });
    cursor.leave();
    cursor.leave();
    vi.advanceTimersByTime(200);
    expect(sent.slice(2)).toEqual([{ at: null }]);
  });

  it("sends the view with the pointer, keeps it once the pointer leaves, and drops both on close", () => {
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    vi.useFakeTimers();
    const sent: Array<BoardPresence> = [];
    const cursor = cursorSender((presence) => sent.push(presence));
    const view = { x: 10, y: 20, zoom: 1 };
    cursor.look(view);
    cursor.move({ x: 1, y: 1 });
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ at: { x: 1, y: 1 }, view }]);
    // A zoom with the pointer off the board still tells the room the view.
    cursor.leave();
    cursor.look({ ...view, zoom: 2 });
    vi.advanceTimersByTime(200);
    expect(sent.slice(1)).toEqual([{ at: null }, { at: null, view: { ...view, zoom: 2 } }]);
    cursor.close();
    cursor.close();
    expect(sent.slice(3)).toEqual([{ at: null, view: null }]);
  });
});

describe("boardCursorColor", () => {
  it("gives the owner and each guest their own colour, the same on every board", () => {
    const guests = [{ id: "a" }, { id: "b" }];
    const colors = [undefined, "a", "b"].map((id) => boardCursorColor(guests, id));
    expect(new Set(colors).size).toBe(3);
    expect(boardCursorColor([{ id: "z" }, ...guests], "b")).not.toBe(colors[2]);
    expect(boardCursorColor(guests, "b")).toBe(colors[2]);
  });
});

describe("boardAgents", () => {
  it("gives a guest's agent a card once it runs a turn or posted one", () => {
    const [sam, eve, alex] = ["sam", "eve", "alex"].map((id) => ({ id: GuestId.make(id) }));
    const agents = boardAgents(
      [sam!, eve!, alex!],
      [{ guestId: "sam" }],
      [{ guestId: GuestId.make("eve"), prompt: "Fix login" }],
    );
    expect(agents.map(({ guest, turns, running }) => [guest.id, turns.length, running])).toEqual([
      ["sam", 1, undefined],
      ["eve", 0, { guestId: "eve", prompt: "Fix login" }],
    ]);
  });
});

describe("appendNoteToDraft", () => {
  it("adds a note to a draft as its own paragraph, and an empty note adds nothing", () => {
    expect(appendNoteToDraft("", " Check the cache ")).toBe("Check the cache");
    expect(appendNoteToDraft("Look at login.\n", "Check the cache")).toBe(
      "Look at login.\n\nCheck the cache",
    );
    expect(appendNoteToDraft("Keep", "  ")).toBe("Keep");
  });
});
