import {
  GuestId,
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_MAX_COORDINATE,
  ROOM_BOARD_MIN_CARD_SIZE,
  ROOM_BOARD_QUOTE_MAX_LENGTH,
  type RoomBoard,
  type RoomBoardNote,
} from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  BOARD_PROMPT_MAX_CARDS,
  EMPTY_ROOM_BOARD,
  INITIAL_BOARD_VIEW,
  NO_BOARD_EDITS,
  type BoardPoint,
  type BoardPresence,
  type BoardRect,
  appendNoteToDraft,
  boardAgentCode,
  boardAgents,
  boardArtifactAuthor,
  boardArtifactWriting,
  boardCardBox,
  boardChangeOf,
  boardChangeQueue,
  boardConnector,
  boardCursorAt,
  boardCursorColor,
  boardItemRects,
  boardMessages,
  boardNewNoteSize,
  boardNoteBox,
  boardPromptContext,
  boardReplyQuote,
  boardUrlIn,
  boardViewportOf,
  cursorSender,
  dropBoardEdit,
  followBoardView,
  isBoardHtmlArtifact,
  parseBoardLink,
  pinnedCommentSpot,
  placeBoardCards,
  placeBoardItem,
  putBoardEdit,
  resolveBoard,
  roomCodeStatus,
  roomFetchCommand,
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
    const wide = placeBoardCards(["thread", "guest:a"], {}, 3, { thread: { w: 440, h: 484 } });
    expect(wide["guest:a"]!.x).toBeGreaterThanOrEqual(wide.thread!.x + 440);
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

describe("placeBoardItem", () => {
  const covers = (at: BoardPoint, size: { w: number; h: number }, rect: BoardRect) =>
    at.x < rect.x + rect.width &&
    rect.x < at.x + size.w &&
    at.y < rect.y + rect.height &&
    rect.y < at.y + size.h;
  const inside = (at: BoardPoint, size: { w: number; h: number }, view: BoardRect) =>
    at.x >= view.x &&
    at.y >= view.y &&
    at.x + size.w <= view.x + view.width &&
    at.y + size.h <= view.y + view.height;

  it("centres a new item on the spot asked for when nothing is there", () => {
    expect(placeBoardItem({ w: 200, h: 100 }, { x: 500, y: 300 }, [])).toEqual({ x: 400, y: 250 });
  });

  it("lands a new artifact fully in view, clear of every card and note at its real size", () => {
    const view = { x: 0, y: 0, width: 1280, height: 800 };
    const artifact = boardNewNoteSize("artifact");
    const taken: Array<BoardRect> = [
      // The thread's card, resized and in the middle, with a guest's card and notes around it.
      { x: 440, y: 120, width: 420, height: 560 },
      { x: 80, y: 72, width: 320, height: 240 },
      { x: 900, y: 40, width: 192, height: 300 },
      { x: 900, y: 400, width: 380, height: 440 },
    ];
    const at = placeBoardItem(artifact, { x: 640, y: 400 }, taken, view);
    expect(inside(at, artifact, view)).toBe(true);
    expect(taken.some((rect) => covers(at, artifact, rect))).toBe(false);
  });

  it("keeps searching outward past nearby cards, and falls back to the least covered spot", () => {
    const view = { x: -200, y: -100, width: 900, height: 600 };
    const note = boardNewNoteSize(undefined);
    const middle = { x: 250, y: 200 };
    const blocker = { x: 100, y: 80, width: 300, height: 240 };
    const at = placeBoardItem(note, middle, [blocker], view);
    expect(covers(at, note, blocker)).toBe(false);
    expect(inside(at, note, view)).toBe(true);
    // A view taken up whole still gets the item inside it, where it covers least.
    const wall = { x: -200, y: -100, width: 900, height: 600 };
    const corner = { x: -200, y: -100, width: 700, height: 600 };
    const crowded = placeBoardItem(note, middle, [wall, corner], view);
    expect(inside(crowded, note, view)).toBe(true);
    expect(crowded.x).toBeGreaterThan(500 - note.w);
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

  it("resizes a card or a note while held, within the room's bounds, and sends it on release", () => {
    const size = { kind: "size", id: "thread" } as const;
    const held = putBoardEdit(room(0), NO_BOARD_EDITS, size, { w: 401.6, h: 90 }, true);
    expect(resolveBoard(room(0), held).sizes?.thread).toEqual({ w: 401.6, h: 90 });
    const dropped = settleBoardValue({ w: 401.6, h: 90 });
    expect(dropped).toEqual({ w: 402, h: ROOM_BOARD_MIN_CARD_SIZE });
    expect(boardChangeOf(size, { w: 99_999, h: 300 })).toEqual({
      type: "card.resize",
      cardId: "thread",
      w: ROOM_BOARD_MAX_CARD_SIZE,
      h: 300,
    });
    // The room taking it puts the edit away; a resize does not move the card.
    const sent = putBoardEdit(room(0), held, size, dropped, false);
    const resized: RoomBoard = { ...room(0), sizes: { thread: dropped } };
    expect(resolveBoard(resized, sent).sizes?.thread).toEqual(dropped);
    expect(resolveBoard(resized, sent).positions.thread).toEqual({ x: 0, y: 0 });

    const note = { id: "n", text: "Ship", x: 0.4, y: 0, size: { w: 250.2, h: 3_000 } };
    const settled = settleBoardValue(note);
    expect(settled.size).toEqual({ w: 250, h: ROOM_BOARD_MAX_CARD_SIZE });
    expect(boardChangeOf({ kind: "note", id: "n" }, settled)).toMatchObject({
      type: "note.put",
      x: 0,
      size: { w: 250, h: ROOM_BOARD_MAX_CARD_SIZE },
    });
  });

  it("keeps what the owner's server wrote into a note while this person edits it", () => {
    const target = { kind: "note", id: "a" } as const;
    const empty = { id: "a", text: "Plan", x: 0, y: 0, kind: "artifact" as const };
    const typing = putBoardEdit(
      { positions: {}, notes: [empty] },
      NO_BOARD_EDITS,
      target,
      { ...empty, text: "Release plan" },
      true,
    );
    const artifact = { body: "# Plan", turnId: "t1", updatedAt: "2026-11-12T00:00:00.000Z" };
    const written: RoomBoard = { positions: {}, notes: [{ ...empty, artifact }] };
    expect(resolveBoard(written, typing).notes[0]).toEqual({
      ...empty,
      text: "Release plan",
      artifact,
    });
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

describe("boardChangeQueue", () => {
  it("sends a new note's text only once the room has the empty note it fills", async () => {
    const queue = boardChangeQueue();
    const started: Array<string> = [];
    let roomTakesNote: (taken: boolean) => void = () => {};
    const added = queue("note:n", () => {
      started.push("add note");
      return new Promise<boolean>((resolve) => {
        roomTakesNote = resolve;
      });
    });
    const written = queue("note:n", async () => {
      started.push("write text");
      return true;
    });
    // Another card does not wait on this note.
    await queue("card:thread", async () => {
      started.push("move card");
      return true;
    });
    expect(started).toEqual(["add note", "move card"]);
    roomTakesNote(true);
    expect([await added, await written]).toEqual([true, true]);
    expect(started).toEqual(["add note", "move card", "write text"]);
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
    // A resized card and an artifact, at their own widths.
    const wide = boardConnector(boardCardBox({ x: 0, y: 0 }, { w: 450, h: 200 }), note);
    expect(wide.path.startsWith("M450 18 ")).toBe(true);
    const artifact = boardNoteBox({ x: 0, y: 0, kind: "artifact" });
    expect(artifact.width).toBeGreaterThan(boardNoteBox({ x: 0, y: 0 }).width);
    expect(boardConnector(artifact, note).path.startsWith(`M${artifact.width} 12 `)).toBe(true);
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

  it("does not land on a guest's card, which sits beside the thread's until someone moves it", () => {
    const empty: RoomBoard = { positions: {}, notes: [] };
    const guestCard = placeBoardCards(["thread", "guest:sam"], {})["guest:sam"]!;
    const spot = pinnedCommentSpot(empty, ["sam"]);
    const [card] = boardItemRects(empty, ["thread", "guest:sam"]).filter(
      (rect) => rect.x === guestCard.x && rect.y === guestCard.y,
    );
    expect(card).toBeDefined();
    const clear =
      spot.x >= card!.x + card!.width ||
      spot.x + 192 <= card!.x ||
      spot.y >= card!.y + card!.height ||
      spot.y + 200 <= card!.y;
    expect(clear).toBe(true);
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

  it("quotes the start of a reply as plain text, within what the room keeps", () => {
    expect(boardReplyQuote("## Done\n\n- Fixed **login**")).toBe("Done: Fixed login");
    const quote = boardReplyQuote("word ".repeat(100));
    expect(quote.length).toBeLessThanOrEqual(ROOM_BOARD_QUOTE_MAX_LENGTH);
    expect(quote.endsWith("…")).toBe(true);
    // A cut never leaves half of a surrogate pair.
    const emoji = boardReplyQuote("\u{1F600}".repeat(200));
    expect(emoji.length).toBeLessThanOrEqual(ROOM_BOARD_QUOTE_MAX_LENGTH);
    expect(emoji.at(-2)).toBe("\uDE00");
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

  it("shows where an agent's code is while it runs, and after its last turn", () => {
    const pushed = { branch: "fix/login", synced: true, ahead: 0, behind: 0 };
    const local = { branch: "fix/login", synced: false, ahead: 2, behind: 0 };
    const running = { guestId: GuestId.make("eve"), prompt: "", code: local };
    expect(boardAgentCode({ turns: [{ code: pushed }], running })).toBe(local);
    expect(boardAgentCode({ turns: [{}, { code: pushed }], running: undefined })).toBe(pushed);
    expect(boardAgentCode({ turns: [], running: undefined })).toBeUndefined();
  });
});

describe("roomCodeStatus", () => {
  it("says whether a branch is pushed, and what of it is not", () => {
    const code = { branch: "x", synced: false };
    expect(roomCodeStatus({ ...code, synced: true, ahead: 0, behind: 3 })).toBe("pushed, 3 behind");
    expect(roomCodeStatus({ ...code, ahead: 1, behind: 0 })).toBe("1 commit not pushed");
    expect(roomCodeStatus({ ...code, ahead: 2, behind: 0 })).toBe("2 commits not pushed");
    expect(roomCodeStatus({ ...code, ahead: 0, behind: 0 })).toBe("changes not committed");
    expect(roomCodeStatus(code)).toBe("not pushed");
  });
});

describe("roomFetchCommand", () => {
  it("fetches and switches to a branch, quoting what a shell would read, and refuses the rest", () => {
    expect(roomFetchCommand("feature/x")).toBe(
      "git fetch origin feature/x && git switch feature/x",
    );
    expect(roomFetchCommand("it's$(rm)")).toBe(
      "git fetch origin 'it'\\''s$(rm)' && git switch 'it'\\''s$(rm)'",
    );
    for (const unsafe of [
      "-x",
      "a b",
      "a..b",
      "a~1",
      "a:b",
      "x.lock",
      "a//b",
      "a\nb",
      `a${String.fromCharCode(0x202e)}b`,
      "@",
      "x".repeat(201),
    ]) {
      expect(roomFetchCommand(unsafe)).toBeNull();
    }
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

describe("boardPromptContext", () => {
  const sam = GuestId.make("sam");
  const people = { guests: [{ id: sam, name: "Sam" }], viewer: null };
  const note = (id: string, fields: Partial<RoomBoardNote> = {}): RoomBoardNote => ({
    id,
    text: id,
    x: 0,
    y: 0,
    ...fields,
  });
  const arrow = (from: string, to: string) => ({ id: `${from}>${to}`, from, to });
  const board = (
    notes: ReadonlyArray<RoomBoardNote>,
    edges: ReadonlyArray<ReturnType<typeof arrow>>,
  ): RoomBoard => ({ positions: {}, notes, edges });

  it("gathers the cards pointing into the thread and into those, once each, nearest first", () => {
    const context = boardPromptContext(
      board(
        [note("a"), note("b", { guestId: sam }), note("c"), note("d"), note("lone")],
        [
          arrow("note:c", "note:a"),
          arrow("note:a", "card:thread"),
          arrow("note:b", "card:thread"),
          // A cycle, and a card that is not a note, add nothing more.
          arrow("note:a", "note:c"),
          arrow("note:a", "note:b"),
          arrow("card:guest:sam", "card:thread"),
          arrow("note:d", "note:lone"),
          arrow("card:thread", "note:d"),
        ],
      ),
      people,
    );
    expect(context.cards).toEqual([
      { ref: "note:a", label: "Note from You", text: "a" },
      { ref: "note:b", label: "Note from Sam", text: "b" },
      { ref: "note:c", label: "Note from You", text: "c" },
    ]);
    expect([...context.edgeIds]).toEqual([
      "note:c>note:a",
      "note:a>card:thread",
      "note:b>card:thread",
      "note:a>note:c",
      "note:a>note:b",
    ]);
    expect(context.artifact).toBeNull();
  });

  it("stops at the most cards one message carries, and leaves out cards with nothing written", () => {
    const many = Array.from({ length: BOARD_PROMPT_MAX_CARDS + 3 }, (_, index) =>
      note(`n${index}`),
    );
    const context = boardPromptContext(
      board(
        [...many, note("blank", { text: "  " })],
        [
          arrow("note:blank", "card:thread"),
          ...many.map((each) => arrow(`note:${each.id}`, "card:thread")),
        ],
      ),
      people,
    );
    expect(context.cards).toHaveLength(BOARD_PROMPT_MAX_CARDS - 1);
    expect(context.cards[0]?.ref).toBe("note:n0");
    expect(context.edgeIds.has("note:n9>card:thread")).toBe(false);
  });

  it("names each kind of card and who wrote it, and finds the artifact the thread points to", () => {
    const artifact = {
      body: "<!doctype html><p>Hi</p>",
      turnId: "t",
      updatedAt: "2026-11-12T00:00:00.000Z",
    };
    const context = boardPromptContext(
      board(
        [
          note("task", { text: "Fix login", kind: "task", done: true, guestId: sam }),
          note("link", { text: "Spec", kind: "link", url: "https://example.com/spec" }),
          note("old", { text: "Why?", pinnedTo: "m1", guestId: sam }),
          note("new", { text: "Agreed", pinnedTo: "m2", quote: "Use a 15 minute TTL" }),
          note("page", { text: "Mockup", kind: "artifact", artifact }),
          note("empty", { text: "Untitled", kind: "artifact" }),
          note("other", { text: "", kind: "artifact" }),
        ],
        [
          ...["task", "link", "old", "new", "page"].map((id) => arrow(`note:${id}`, "card:thread")),
          arrow("card:thread", "note:task"),
          arrow("card:thread", "note:empty"),
          arrow("card:thread", "note:other"),
        ],
      ),
      { ...people, viewer: sam },
      [{ id: "m1", author: null, text: "The token TTL is 900s." }],
    );
    expect(context.cards.map(({ label, text }) => [label, text])).toEqual([
      ["Task from You", "Fix login\nStatus: done"],
      ["Link from Owner", "https://example.com/spec\nSpec"],
      ["Comment from You on a reply", 'On the reply: "The token TTL is 900s."\nWhy?'],
      ["Comment from Owner on a reply", 'On the reply: "Use a 15 minute TTL"\nAgreed'],
      ['Artifact "Mockup"', "Mockup\n\n<!doctype html><p>Hi</p>"],
    ]);
    expect(context.artifact?.id).toBe("empty");
    expect(context.artifactEdgeId).toBe("card:thread>note:empty");
  });

  it("gathers the cards pointing into an artifact for its own box, never the artifact itself", () => {
    const shared = board(
      [note("a"), note("b"), note("art", { text: "Mockup", kind: "artifact" }), note("c")],
      [
        arrow("note:a", "note:art"),
        arrow("note:b", "note:a"),
        arrow("note:art", "note:a"),
        arrow("note:art", "card:thread"),
        arrow("card:thread", "note:art"),
        arrow("note:c", "card:thread"),
      ],
    );
    const context = boardPromptContext(shared, people, [], "note:art");
    expect(context.cards.map((card) => card.ref)).toEqual(["note:a", "note:b"]);
    expect([...context.edgeIds]).toEqual(["note:a>note:art", "note:b>note:a"]);
    expect(context.artifact).toBeNull();
    // The thread's card still carries the artifact and fills it.
    const thread = boardPromptContext(shared, people);
    expect(thread.cards.map((card) => card.ref)).toEqual([
      "note:art",
      "note:c",
      "note:a",
      "note:b",
    ]);
    expect(thread.artifactEdgeId).toBe("card:thread>note:art");
  });

  it("shows an artifact as a page only when it is a whole HTML document", () => {
    expect(isBoardHtmlArtifact("\n  <!DOCTYPE html><html></html>")).toBe(true);
    expect(isBoardHtmlArtifact('<html lang="en"><body>Hi</body></html>')).toBe(true);
    expect(isBoardHtmlArtifact("# Plan\n\n<html> is a tag")).toBe(false);
    expect(isBoardHtmlArtifact("<div>Hi</div>")).toBe(false);
  });
});

describe("boardArtifactAuthor", () => {
  const sam = GuestId.make("sam");
  const eve = GuestId.make("eve");
  const guests = [
    { id: sam, name: "Sam" },
    { id: eve, name: "Eve" },
  ];

  it("names whose agent wrote an artifact, and the guest who asked the owner's", () => {
    const owner = { guests, viewer: null };
    const asSam = { guests, viewer: sam };
    expect(boardArtifactAuthor({}, owner)).toBe("Your agent");
    expect(boardArtifactAuthor({ askedBy: sam }, owner)).toBe("Your agent, asked by Sam");
    expect(boardArtifactAuthor({ askedBy: sam }, asSam)).toBe("Owner's agent, asked by you");
    expect(boardArtifactAuthor({ guestId: sam }, owner)).toBe("Sam's agent");
    expect(boardArtifactAuthor({ guestId: sam, askedBy: sam }, asSam)).toBe("Your agent");
  });

  it("says whose agents are writing an artifact now, the owner's first", () => {
    const owner = { guests, viewer: null, ownerName: "Alex" };
    const running = [
      { guestId: sam, prompt: "", artifactId: "art" },
      { guestId: eve, prompt: "", artifactId: "other" },
    ];
    expect(boardArtifactWriting("art", [], null, owner)).toBeNull();
    expect(boardArtifactWriting("art", running, null, { guests, viewer: sam })).toBe(
      "Your agent is writing…",
    );
    expect(boardArtifactWriting("art", running, "art", owner)).toBe(
      "Your agent and Sam's agent are writing…",
    );
    expect(
      boardArtifactWriting(
        "art",
        [...running, { guestId: eve, prompt: "", artifactId: "art" }],
        "art",
        { guests, viewer: eve, ownerName: "Alex" },
      ),
    ).toBe("Alex's agent, Sam's agent and your agent are writing…");
  });
});
