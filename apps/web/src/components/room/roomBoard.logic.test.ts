import {
  GuestId,
  GuestMessageId,
  ROOM_BOARD_MAX_CARD_SIZE,
  ROOM_BOARD_MAX_COORDINATE,
  ROOM_BOARD_MAX_EDGES,
  ROOM_BOARD_MAX_REPLIES,
  ROOM_BOARD_MIN_CARD_SIZE,
  ROOM_BOARD_NOTE_MAX_LENGTH,
  ROOM_BOARD_QUOTE_MAX_LENGTH,
  type RoomBoard,
  type RoomBoardEdge,
  type RoomBoardNote,
  type RoomBoardReply,
  type ThreadGuestMessage,
} from "@t3tools/contracts";
import { roomBoardWithCardsSent } from "@t3tools/shared/roomBoard";
import { describe, expect, it, vi } from "vite-plus/test";

import {
  BOARD_MAX_ZOOM,
  BOARD_MIN_ZOOM,
  BOARD_HISTORY_MAX,
  BOARD_PROMPT_MAX_CARDS,
  BOARD_SEEN_COMMENTS_MAX,
  EMPTY_ROOM_BOARD,
  INITIAL_BOARD_VIEW,
  NO_BOARD_EDITS,
  type BoardHistoryEntry,
  type BoardPoint,
  type BoardPresence,
  type BoardRect,
  type BoardValue,
  appendNoteToDraft,
  BOARD_SPLIT_DIVIDER,
  besideBoardItem,
  boardDragItems,
  boardTakenRects,
  boardAddSection,
  boardAddSpot,
  boardCodeEdgeIds,
  boardCodeTotals,
  boardCopySkipped,
  boardAgentCode,
  boardAgents,
  boardArtifactAuthor,
  boardCommentAgentAuthor,
  boardCommentAskBoxes,
  boardCommentPromptCard,
  boardCommentReplying,
  boardCommentsSeen,
  boardCommentUnread,
  boardArtifactWriting,
  boardBoxAgentLabel,
  boardBoxName,
  boardBoxRequests,
  boardThreadBoxTitle,
  boardGuestWaiting,
  boardCardBox,
  boardChangeOf,
  boardChangeQueue,
  boardChangeQueueKey,
  boardCommentLineTo,
  boardCommentPanelSpot,
  boardConnector,
  boardCursorAt,
  boardCursorColor,
  boardDraftIsPage,
  boardEditKey,
  boardGroupMove,
  boardHistoryChanges,
  boardHistoryWith,
  boardItemsInRect,
  boardItemsCentredIn,
  boardDuplicates,
  boardCentreSpot,
  boardKeyEditsNote,
  boardMenuEntries,
  type BoardMenuRights,
  boardTidy,
  boardSectionAround,
  boardItemTarget,
  boardItemRects,
  boardMessages,
  boardNewNoteSize,
  boardNewestReplyAt,
  boardNoteBox,
  boardOwnBoxFor,
  boardPeopleOf,
  boardPersonName,
  boardPanelMaxWidth,
  boardPinScale,
  boardProgressLine,
  boardProgressPhase,
  boardReactionChips,
  boardPromptCardGoes,
  boardPromptContext,
  boardReplyQuote,
  boardRestoreLabel,
  boardSelectionItems,
  boardSelectionRemoval,
  boardThreadBoxes,
  boardUrlIn,
  boardViewportOf,
  canPromptBoardBox,
  clientRectToBoard,
  clientToBoard,
  cursorSender,
  dropBoardEdit,
  fitBoardView,
  followBoardView,
  formatBoardElapsed,
  isBoardHtmlArtifact,
  boardCardsLine,
  boardHtmlTitle,
  panToShow,
  panToShowAdded,
  parseBoardLink,
  pinnedCommentSpot,
  placeBoardCards,
  placeBoardItem,
  putBoardEdit,
  resizeBoardFromLeft,
  resolveBoard,
  roomCodeStatus,
  roomFetchCommand,
  screenToBoard,
  settleBoardEdits,
  settleBoardValue,
  visibleBoardRect,
  openingBoardView,
  selectionBarSpot,
  wheelZoomFactor,
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

describe("selectionBarSpot", () => {
  const bar = { width: 300, height: 32 };
  const board = { width: 1000, height: 700 };
  it.each([
    {
      name: "sits centred just above the selection",
      selection: { x: 400, y: 300, width: 200, height: 100 },
      spot: { left: 350, top: 260 },
    },
    {
      name: "goes below a selection at the top of the board",
      selection: { x: 400, y: 20, width: 200, height: 100 },
      spot: { left: 350, top: 128 },
    },
    {
      name: "stays inside the board beside a selection at its edge",
      selection: { x: -100, y: 300, width: 120, height: 100 },
      spot: { left: 8, top: 260 },
    },
    {
      name: "stays inside the board when the selection fills it",
      selection: { x: 0, y: 0, width: 1000, height: 700 },
      spot: { left: 350, top: 660 },
    },
  ])("$name", ({ selection, spot }) => {
    expect(selectionBarSpot(selection, bar, board)).toEqual(spot);
  });
});

describe("wheelZoomFactor", () => {
  it.each([
    {
      name: "a mouse notch zooms in one small step",
      deltaY: -100,
      deltaMode: 0,
      min: 1.1,
      max: 1.15,
    },
    { name: "a huge notch is still one step", deltaY: -1_000, deltaMode: 0, min: 1.1, max: 1.15 },
    { name: "a notch in lines is one step", deltaY: 3, deltaMode: 1, min: 0.87, max: 0.9 },
    { name: "a pinch's few pixels zoom a little", deltaY: -4, deltaMode: 0, min: 1.01, max: 1.03 },
    { name: "no turn, no zoom", deltaY: 0, deltaMode: 0, min: 1, max: 1 },
  ])("$name", ({ deltaY, deltaMode, min, max }) => {
    const factor = wheelZoomFactor(deltaY, deltaMode);
    expect(factor).toBeGreaterThanOrEqual(min);
    expect(factor).toBeLessThanOrEqual(max);
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

  const overlaps = (a: BoardRect, b: BoardRect) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  // The thread's card as it is drawn with a few messages, as a tester saw it.
  const thread = { width: 320, height: 423 };
  it.each([
    { name: "a fourth card, on a board nobody arranged", saved: {} },
    { name: "a card added after the thread's card was moved", saved: { thread: { x: 80, y: 72 } } },
    { name: "a card added beside a guest who was moved", saved: { "guest:a": { x: 440, y: 72 } } },
  ])("keeps $name off the thread's card at the height it is drawn", ({ saved }) => {
    const ids = ["thread", "guest:a", "guest:b", "guest:c", "agent:a"];
    const placed = placeBoardCards(ids, saved);
    const card = { ...placed.thread!, ...thread };
    for (const id of ids.slice(1)) {
      expect(overlaps({ ...placed[id]!, width: 320, height: 240 }, card)).toBe(false);
    }
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

  it("keeps searching outward past nearby cards, and past the view when it has no room", () => {
    const view = { x: -200, y: -100, width: 900, height: 600 };
    const note = boardNewNoteSize(undefined);
    const middle = { x: 250, y: 200 };
    const blocker = { x: 100, y: 80, width: 300, height: 240 };
    const at = placeBoardItem(note, middle, [blocker], view);
    expect(covers(at, note, blocker)).toBe(false);
    expect(inside(at, note, view)).toBe(true);
    // A view taken up whole puts the item just outside it, clear, rather than on a card.
    const wall = { x: -200, y: -100, width: 900, height: 600 };
    const crowded = placeBoardItem(note, middle, [wall], view);
    expect(covers(crowded, note, wall)).toBe(false);
    expect(inside(crowded, note, view)).toBe(false);
  });

  it("places a thread box at its own size in a narrow view, clear of a note and the thread card", () => {
    // A board narrowed by the conversation beside it: the thread's card and a resized note.
    const view = { x: 0, y: 0, width: 760, height: 700 };
    const thread = { x: 80, y: 72, width: 320, height: 420 };
    const note = { x: 738, y: 100, width: 252, height: 160 };
    const box = boardNewNoteSize("thread");
    expect(box.w).toBeGreaterThan(boardNewNoteSize(undefined).w);
    const at = placeBoardItem(box, { x: 380, y: 350 }, [thread, note], view);
    expect(covers(at, box, thread)).toBe(false);
    expect(covers(at, box, note)).toBe(false);
  });

  it.each([
    {
      name: "the section selected alone, though the pointer is over another",
      hints: { selected: "note:b", pointer: { x: 100, y: 100 }, lastCard: null },
      into: "b",
    },
    {
      name: "the section the pointer was last over",
      hints: { selected: null, pointer: { x: 100, y: 100 }, lastCard: { x: 900, y: 100 } },
      into: "a",
    },
    {
      name: "the section holding the card last added or selected",
      hints: { selected: null, pointer: { x: 500, y: 600 }, lastCard: { x: 900, y: 100 } },
      into: "b",
    },
    {
      name: "no section when the pointer and the last card are on the open board",
      hints: { selected: null, pointer: { x: 500, y: 600 }, lastCard: null },
      into: null,
    },
    {
      name: "no section out of view",
      hints: { selected: "note:c", pointer: null, lastCard: { x: 3_000, y: 100 } },
      into: null,
    },
  ])("adds a card into $name", ({ hints, into }) => {
    const sections = {
      a: { x: 0, y: 0, width: 400, height: 300 },
      b: { x: 700, y: 0, width: 400, height: 300 },
      c: { x: 2_800, y: 0, width: 400, height: 300 },
    };
    const view = { x: 0, y: 0, width: 1_200, height: 800 };
    expect(
      boardAddSection(
        Object.entries(sections).map(([id, rect]) => ({ ref: `note:${id}`, rect })),
        view,
        hints,
      ),
    ).toEqual(into === null ? null : sections[into as keyof typeof sections]);
  });

  it.each([
    {
      name: "as near the middle of the view as is clear, not in a corner",
      taken: [{ x: 500, y: 330, width: 200, height: 140 }],
      section: null,
      check: (at: BoardPoint, size: { w: number; h: number }) =>
        Math.hypot(at.x + size.w / 2 - 600, at.y + size.h / 2 - 400) < 300,
    },
    {
      name: "into a section's free space, below its title",
      taken: [{ x: 100, y: 100, width: 200, height: 120 }],
      section: { x: 100, y: 60, width: 640, height: 420 },
      check: (at: BoardPoint, size: { w: number; h: number }) =>
        at.x >= 100 && at.x + size.w <= 740 && at.y >= 100 && at.y + size.h <= 480,
    },
    {
      name: "beside a section that is full",
      taken: [{ x: 100, y: 100, width: 640, height: 380 }],
      section: { x: 100, y: 60, width: 640, height: 420 },
      check: (at: BoardPoint) => at.x >= 740,
    },
  ])("adds a card from the toolbar $name", ({ taken, section, check }) => {
    const view = { x: 0, y: 0, width: 1_200, height: 800 };
    const note = boardNewNoteSize(undefined);
    const at = boardAddSpot(note, taken, view, section);
    expect(check(at, note)).toBe(true);
    expect(taken.some((rect) => covers(at, note, rect))).toBe(false);
  });

  it("puts a card made from another beside it, to its right and clear of what is there", () => {
    const box = { x: 100, y: 100, width: 340, height: 460 };
    const artifact = boardNewNoteSize("artifact");
    expect(besideBoardItem(box, artifact, [box])).toEqual({ x: 480, y: 100 });
    const neighbour = { x: 470, y: 80, width: 300, height: 300 };
    const at = besideBoardItem(box, artifact, [box, neighbour]);
    expect(covers(at, artifact, neighbour)).toBe(false);
    expect(covers(at, artifact, box)).toBe(false);
    // Beside would reach past what the board shows: a clear spot in view comes first.
    const view = { x: 0, y: 0, width: 780, height: 1_000 };
    const shown = besideBoardItem(box, artifact, [box], view);
    expect(inside(shown, artifact, view)).toBe(true);
    expect(covers(shown, artifact, box)).toBe(false);
    // With no clear spot in view it still goes beside.
    expect(besideBoardItem(box, artifact, [box], { ...view, height: 600 })).toEqual({
      x: 480,
      y: 100,
    });
  });
});

describe("boardTakenRects", () => {
  const room = { x: 80, y: 72, width: 320, height: 165 };
  const sizeRect = (size: { w: number; h: number }) => ({ width: size.w, height: size.h });
  it.each([
    {
      name: "keeps the room thread's card as tall as it grows",
      drawn: [{ ref: "card:thread", rect: room }],
      board: { positions: {} },
      upcoming: [],
      taken: [{ ...room, height: 420 }],
    },
    {
      name: "keeps a resized card at its size",
      drawn: [{ ref: "card:thread", rect: room }],
      board: { positions: {}, sizes: { thread: { w: 320, h: 165 } } },
      upcoming: [],
      taken: [room],
    },
    {
      name: "keeps a guest's card a card row tall, and notes and pins as drawn",
      drawn: [
        { ref: "card:guest:g1", rect: { x: 440, y: 72, width: 320, height: 120 } },
        { ref: "note:a", rect: { x: 0, y: 400, width: 192, height: 90 } },
      ],
      board: { positions: {} },
      upcoming: [],
      taken: [
        { x: 440, y: 72, width: 320, height: 240 },
        { x: 0, y: 400, width: 192, height: 90 },
      ],
    },
    {
      name: "reserves the grid slot a guest's agent card will take",
      drawn: [],
      board: { positions: {} },
      upcoming: ["agent:g1"],
      taken: [{ x: 800, y: 72, width: 320, height: 240 }],
    },
    {
      name: "reserves an upcoming card where it was saved",
      drawn: [],
      board: { positions: { "agent:g1": { x: 1000, y: 900 } } },
      upcoming: ["agent:g1"],
      taken: [{ x: 1000, y: 900, width: 320, height: 240 }],
    },
    {
      name: "keeps clear of a note not drawn yet, such as one just added or a hidden resolved pin",
      drawn: [{ ref: "note:a", rect: { x: 0, y: 400, width: 192, height: 90 } }],
      board: {
        positions: {},
        notes: [
          { id: "a", text: "", x: 0, y: 400 },
          { id: "b", text: "", x: 600, y: 600, kind: "thread" as const },
          { id: "c", text: "", x: 40, y: 40, kind: "comment" as const, resolved: true as const },
        ],
      },
      upcoming: [],
      taken: [
        { x: 0, y: 400, width: 192, height: 90 },
        { x: 600, y: 600, ...sizeRect(boardNewNoteSize("thread")) },
        { x: 40, y: 40, ...sizeRect(boardNewNoteSize("comment")) },
      ],
    },
    {
      name: "leaves a section free to land in",
      drawn: [],
      board: {
        positions: {},
        notes: [
          { id: "s", text: "Plan", x: 0, y: 0, section: true as const, size: { w: 640, h: 420 } },
        ],
      },
      upcoming: [],
      taken: [],
    },
  ])("$name", ({ drawn, board, upcoming, taken }) => {
    expect(
      boardTakenRects(drawn, { notes: [], ...board }, ["thread", "guest:g1"], upcoming),
    ).toEqual(taken);
  });

  it("puts a new box clear of the room thread's card as it will grow, not as it is drawn", () => {
    // Too narrow for the box beside the card: it has to go under it.
    const view = { x: 0, y: 0, width: 520, height: 1_000 };
    const box = boardNewNoteSize("thread");
    const taken = boardTakenRects(
      [{ ref: "card:thread", rect: room }],
      { positions: {}, notes: [] },
      ["thread"],
      [],
    );
    const at = placeBoardItem(box, { x: 260, y: 400 }, taken, view);
    const grown = { ...room, height: 420 };
    expect(
      at.x < grown.x + grown.width &&
        grown.x < at.x + box.w &&
        at.y < grown.y + grown.height &&
        grown.y < at.y + box.h,
    ).toBe(false);
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
    // A colour shows until the room's copy has it, and is sent with the note.
    const green = { ...written, color: "green" as const };
    const coloured = putBoardEdit(stored, NO_BOARD_EDITS, target, green, false);
    expect(settleBoardEdits(stored, coloured)).toBe(coloured);
    expect(resolveBoard(stored, coloured).notes).toEqual([green]);
    expect(boardChangeOf(target, green)).toMatchObject({ type: "note.put", color: "green" });
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
    // Someone else drew the same line first: the server keeps theirs and takes this one as done.
    const theirs: RoomBoard = {
      ...stored,
      edges: [{ id: "f", from: "note:n", to: "card:thread" }],
    };
    expect(resolveBoard(theirs, drawn).edges).toEqual(theirs.edges);
    const gone = putBoardEdit(linked, drawn, { kind: "note", id: "n" }, null, false);
    expect(resolveBoard(linked, gone).edges).toEqual([]);
    expect(boardChangeOf(arrow, null)).toEqual({ type: "edge.remove", edgeId: "e" });
  });

  it("never shows an edit again once the room's copy moved past it and came back", () => {
    const note = { id: "n", text: "Ship", x: 0, y: 0 };
    const stored: RoomBoard = { positions: { thread: { x: 0, y: 0 } }, notes: [note] };
    const value = { id: "e", from: "note:n", to: "card:thread" };
    const drawn = putBoardEdit(stored, NO_BOARD_EDITS, { kind: "edge", id: "e" }, value, false);
    const moved = putBoardEdit(stored, drawn, thread, { x: 40, y: 0 }, false);
    expect(settleBoardEdits(stored, moved)).toBe(moved);
    // The room takes both, then the owner deletes the line and someone moves the card back.
    const taken: RoomBoard = { ...stored, positions: { thread: { x: 40, y: 0 } }, edges: [value] };
    const settled = settleBoardEdits(taken, moved);
    expect(settled).toEqual(NO_BOARD_EDITS);
    expect(resolveBoard(stored, settled)).toMatchObject({
      positions: { thread: { x: 0, y: 0 } },
      edges: [],
    });
  });

  it("shows a line drawn again over the one going away, in the queue the removal went in", () => {
    const note = { id: "n", text: "Ship", x: 0, y: 0 };
    const old = { id: "e", from: "note:n", to: "card:thread" };
    const stored: RoomBoard = { positions: {}, notes: [note], edges: [old] };
    const again = { id: "f", from: "note:n", to: "card:thread" };
    const removed = putBoardEdit(stored, NO_BOARD_EDITS, { kind: "edge", id: "e" }, null, false);
    const redrawn = putBoardEdit(stored, removed, { kind: "edge", id: "f" }, again, false);
    expect(resolveBoard(stored, redrawn).edges).toEqual([again]);
    // Drawn first and removed after, the order the edits sit in does not hide it either.
    const reversed = putBoardEdit(
      stored,
      putBoardEdit(stored, NO_BOARD_EDITS, { kind: "edge", id: "f" }, again, false),
      { kind: "edge", id: "e" },
      null,
      false,
    );
    expect(resolveBoard(stored, reversed).edges).toEqual([again]);
    expect(boardChangeQueueKey(stored, { kind: "edge", id: "e" }, null)).toBe(
      boardChangeQueueKey(stored, { kind: "edge", id: "f" }, again),
    );
    expect(boardChangeQueueKey(stored, thread, { x: 1, y: 1 })).toBe("card:thread");
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

    // From the bottom-left corner the left edge follows the pointer and the right edge stays,
    // stopping at the bounds without pushing the card along.
    const card = { x: 100, y: 50, width: 300, height: 200 };
    expect(resizeBoardFromLeft(card, -40, 25)).toEqual({ x: 60, y: 50, size: { w: 340, h: 225 } });
    expect(resizeBoardFromLeft(card, 250, -500)).toEqual({
      x: 400 - ROOM_BOARD_MIN_CARD_SIZE,
      y: 50,
      size: { w: ROOM_BOARD_MIN_CARD_SIZE, h: ROOM_BOARD_MIN_CARD_SIZE },
    });
    expect(resizeBoardFromLeft(card, -5_000, 0).x).toBe(400 - ROOM_BOARD_MAX_CARD_SIZE);

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
    // A thread box keeps the turns its server wrote while someone renames it.
    const box = { id: "a", text: "", x: 0, y: 0, kind: "thread" as const };
    const naming = putBoardEdit(
      { positions: {}, notes: [box] },
      NO_BOARD_EDITS,
      target,
      { ...box, text: "Pricing" },
      true,
    );
    const thread = {
      turns: [{ id: "t1", prompt: "Hi", reply: "Hello", at: "2026-11-12T00:00:00.000Z" }],
    };
    expect(resolveBoard({ positions: {}, notes: [{ ...box, thread }] }, naming).notes[0]).toEqual({
      ...box,
      text: "Pricing",
      thread,
    });
    // A comment thread keeps the replies and the resolving that land while its pin is dragged.
    const pin = { id: "a", text: "Ship it?", x: 0, y: 0, kind: "comment" as const };
    const dragging = putBoardEdit(
      { positions: {}, notes: [pin] },
      NO_BOARD_EDITS,
      target,
      { ...pin, x: 40 },
      true,
    );
    const replies = [{ id: "r", text: "Not yet", at: "2026-11-13T00:00:00.000Z" }];
    const reactions = [{ emoji: "👍" as const }];
    const answered: RoomBoard = {
      positions: {},
      notes: [{ ...pin, replies, resolved: true, reactions }],
    };
    expect(resolveBoard(answered, dragging).notes[0]).toEqual({
      ...pin,
      x: 40,
      replies,
      resolved: true,
      reactions,
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

  it("joins whichever sides of two cards are nearer each other, from either side", () => {
    const card = boardCardBox({ x: 600, y: 0 });
    // A card to the left: the line leaves the card's left side for the note's right side.
    const left = boardConnector(card, boardNoteBox({ x: 100, y: 300 }));
    expect(left.path.startsWith("M600 18 ")).toBe(true);
    expect(left.path.endsWith(" 292 312")).toBe(true);
    // One under the other at the same place: both ends on the same side, curving out and back.
    const below = boardConnector(card, boardCardBox({ x: 600, y: 400 }));
    expect(below.path).toBe("M920 18 C960 18, 960 418, 920 418");
    expect(below.middle).toEqual({ x: 950, y: 218 });
    // Overlapping a little to the right: the right sides are nearer than the facing ones.
    const overlap = boardConnector(card, boardCardBox({ x: 700, y: 400 }));
    expect(overlap.path.startsWith("M920 18 ")).toBe(true);
    expect(overlap.path.endsWith(" 1020 418")).toBe(true);
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

  it("sends a drag with the pointer, where it landed once, then a pointer without it", () => {
    using _timers = { [Symbol.dispose]: () => vi.useRealTimers() };
    vi.useFakeTimers();
    const sent: Array<BoardPresence> = [];
    const cursor = cursorSender((presence) => sent.push(presence));
    const at = { x: 1, y: 1 };
    const item = (x: number) => ({ ref: "note:a", x, y: 0 });
    cursor.move(at);
    cursor.drag([item(10)]);
    vi.advanceTimersByTime(0);
    expect(sent).toEqual([{ at, drag: { items: [item(10)] } }]);
    // A group dragged with the pointer still: the drag alone is news.
    cursor.drag([item(20)]);
    vi.advanceTimersByTime(80);
    cursor.land([item(25)]);
    vi.advanceTimersByTime(80);
    vi.advanceTimersByTime(80);
    vi.advanceTimersByTime(200);
    expect(sent.slice(1)).toEqual([
      { at, drag: { items: [item(20)] } },
      { at, drag: { items: [item(25)], done: true } },
      { at },
    ]);
    // Nothing dragged is no drag.
    cursor.drag([]);
    vi.advanceTimersByTime(200);
    expect(sent).toHaveLength(4);
    // A drag held still is posted again each second, or the room takes its page for gone.
    cursor.drag([item(30)]);
    vi.advanceTimersByTime(200);
    vi.advanceTimersByTime(1_000);
    expect(sent.slice(4)).toEqual([
      { at, drag: { items: [item(30)] } },
      { at, drag: { items: [item(30)] } },
    ]);
    cursor.close();
    vi.advanceTimersByTime(5_000);
    expect(sent.slice(6)).toEqual([{ at: null, view: null }]);
  });
});

describe("boardDragItems", () => {
  const note = { id: "a", text: "Hi", x: 0, y: 0 };
  it.each([
    {
      name: "a note moved, at the whole pixels the room takes",
      held: [["note:a", { ...note, x: 10.4, y: 20.6 }]],
      items: [{ ref: "note:a", x: 10, y: 21 }],
    },
    {
      name: "a note written in, with its text alone",
      held: [["note:a", { ...note, text: "Hello" }]],
      items: [{ ref: "note:a", text: "Hello" }],
    },
    {
      name: "a note moved while written in, with both",
      held: [["note:a", { ...note, text: "Hello", x: 5 }]],
      items: [{ ref: "note:a", x: 5, y: 0, text: "Hello" }],
    },
    {
      name: "a note resized, with its size",
      held: [["note:a", { ...note, size: { w: 300, h: 200 } }]],
      items: [{ ref: "note:a", x: 0, y: 0, w: 300, h: 200 }],
    },
    {
      name: "a card moved and resized from its left corner, as one",
      held: [
        ["size:thread", { w: 400.2, h: 500 }],
        ["card:thread", { x: -40, y: 0 }],
      ],
      items: [{ ref: "card:thread", x: -40, y: 0, w: 400, h: 500 }],
    },
    {
      name: "a guest's card, whose id has a colon",
      held: [["card:guest:g1", { x: 5, y: 5 }]],
      items: [{ ref: "card:guest:g1", x: 5, y: 5 }],
    },
  ])("$name", ({ held, items }) => {
    expect(
      boardDragItems(new Map(held as Array<[string, BoardValue]>), new Map([["note:a", note]])),
    ).toEqual(items);
  });
});

describe("boardPeopleOf", () => {
  it("names people from an earlier link as they were, apart from who is in the room", () => {
    const board = {
      people: [{ guestId: GuestId.make("old-sam"), name: "Sam" }],
    };
    const guests = [{ id: "new-sam", name: "Sam" }];
    const people = {
      guests: boardPeopleOf(guests, board, [{ id: "left", name: "Lee" }]),
      viewer: "new-sam",
    };
    // The new Sam is the viewer; the earlier Sam is someone else, named as they were.
    expect(boardPersonName(people, "new-sam")).toBe("You");
    expect(boardPersonName(people, "old-sam")).toBe("Sam");
    expect(boardPersonName(people, "left")).toBe("Lee");
    expect(boardPersonName(people, "unknown")).toBe("Guest");
    expect(boardPeopleOf(guests, undefined, [])).toBe(guests);
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
    // Pressed twice, the same card is added once.
    expect(appendNoteToDraft("Look at login.\n\nCheck the cache", "Check the cache")).toBe(
      "Look at login.\n\nCheck the cache",
    );
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
    expect(context.cards.map(({ ref, label, text }) => ({ ref, label, text }))).toEqual([
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
    const changes = {
      files: [
        { path: "src/login.ts", additions: 4, deletions: 1 },
        { path: "README.md", additions: 1, deletions: 0 },
      ],
      more: 1,
      additions: 5,
      deletions: 1,
      turnCount: 2,
      boxId: "box",
      turnId: "t",
      updatedAt: "2026-11-12T00:00:00.000Z",
    };
    const pullRequest = {
      readAt: "2026-11-12T00:00:00.000Z",
      pullRequest: {
        title: "Fix login",
        state: "open" as const,
        headBranch: "fix-login",
        baseBranch: "main",
        commits: 100,
        moreCommits: true as const,
        changedFiles: 1,
        additions: 4,
        deletions: 1,
        checks: { passing: 2, failing: 1, pending: 0, failingNames: ["lint"] },
        updatedAt: "2026-11-12T00:00:00.000Z",
      },
    };
    const context = boardPromptContext(
      board(
        [
          note("task", { text: "Fix login", kind: "task", done: true, guestId: sam }),
          note("link", { text: "Spec", kind: "link", url: "https://example.com/spec" }),
          note("old", { text: "Why?", pinnedTo: "m1", guestId: sam }),
          note("new", { text: "Agreed", pinnedTo: "m2", quote: "Use a 15 minute TTL" }),
          note("page", { text: "Mockup", kind: "artifact", artifact }),
          note("code", { text: "Login fix", kind: "code", changes }),
          note("pr", {
            text: "",
            kind: "pull-request",
            url: "https://github.com/acme/app/pull/12",
            pullRequest,
          }),
          note("empty", { text: "Untitled", kind: "artifact" }),
          note("other", { text: "", kind: "artifact" }),
        ],
        [
          ...["task", "link", "old", "new", "page", "code", "pr"].map((id) =>
            arrow(`note:${id}`, "card:thread"),
          ),
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
      // A code window carries its files and counts, never a patch.
      [
        'Code window "Login fix"',
        "Login fix\nChanged 3 files, +5 −1:\nsrc/login.ts +4 -1\nREADME.md +1 -0\nand 1 more file",
      ],
      // A pull request window carries what the owner's server last read of it.
      [
        'Pull request #12 "Fix login"',
        [
          "acme/app#12: Fix login",
          "State: open, fix-login into main",
          "Checks: 1 failing (lint), 2 passing",
          "100+ commits, 1 file changed, +4 -1",
          "https://github.com/acme/app/pull/12",
        ].join("\n"),
      ],
    ]);
    // What is sent is kept and shown to everyone, so it names people as everyone reads them;
    // the chip says what the card itself says.
    expect(context.cards.map(({ sharedLabel, excerpt }) => [sharedLabel, excerpt])).toEqual([
      ["Task from Sam", "Fix login"],
      ["Link from the owner", "Spec"],
      ["Comment from Sam on a reply", "Why?"],
      ["Comment from the owner on a reply", "Agreed"],
      ['Artifact "Mockup"', ""],
      ['Code window "Login fix"', ""],
      ['Pull request #12 "Fix login"', ""],
    ]);
    const named = boardPromptContext(
      board([note("n", { text: "Ship it\non Friday" })], [arrow("note:n", "card:thread")]),
      { ...people, ownerName: "Alex" },
    );
    expect(
      named.cards.map(({ label, sharedLabel, excerpt }) => [label, sharedLabel, excerpt]),
    ).toEqual([["Note from You", "Note from Alex", "Ship it"]]);
    expect(context.artifact?.id).toBe("empty");
    expect(context.artifactEdgeId).toBe("card:thread>note:empty");
  });

  it("marks the line from the box a code window shows, and sums its changes", () => {
    const code = board(
      [
        note("box", { kind: "thread" }),
        note("diff", { kind: "code" }),
        note("loose", { kind: "code" }),
        note("idea"),
      ],
      [
        arrow("note:idea", "note:diff"),
        arrow("note:box", "note:diff"),
        arrow("card:thread", "note:loose"),
        arrow("note:diff", "note:box"),
      ],
    );
    expect([...boardCodeEdgeIds(code)]).toEqual(["note:box>note:diff", "card:thread>note:loose"]);
    expect(
      boardCodeTotals({
        files: [{ path: "a", additions: 1, deletions: 0 }],
        additions: 1,
        deletions: 0,
      }),
    ).toBe("1 file, +1 −0");
    expect(boardCodeTotals({ files: [], more: 51, additions: 42, deletions: 7 })).toBe(
      "51 files, +42 −7",
    );
  });

  it("carries a comment thread whole, each comment as its author's, the newest that fit", () => {
    const reply = (id: string, text: string, guestId?: GuestId) => ({
      id,
      text,
      at: "2026-11-13T00:00:00.000Z",
      ...(guestId === undefined ? {} : { guestId }),
    });
    const talk = note("talk", {
      text: "Ship it?",
      kind: "comment",
      guestId: sam,
      resolved: true,
      replies: [
        reply("r1", "Not yet\nTests fail"),
        reply("r2", "Fixed", sam),
        // Agents' answers read as whose agent wrote them.
        { ...reply("r3", "Tests pass now.", sam), agent: { turnId: "t3", boxId: "b" } },
        { ...reply("r4", "Ship it.\n"), agent: { turnId: "t4", boxId: "thread" } },
      ],
    });
    const context = boardPromptContext(board([talk], [arrow("note:talk", "card:thread")]), {
      ...people,
      viewer: sam,
    });
    expect(
      context.cards.map(({ label, sharedLabel, text, excerpt }) => ({
        label,
        sharedLabel,
        text,
        excerpt,
      })),
    ).toEqual([
      {
        label: "Comment thread from You",
        sharedLabel: "Comment thread from Sam",
        text: "Sam: Ship it?\nThe owner: Not yet\nTests fail\nSam: Fixed\nSam's agent: Tests pass now.\nThe owner's agent: Ship it.",
        excerpt: "Ship it?",
      },
    ]);
    // Asked from the thread, the card ends with the question just sent, as its asker's.
    expect(boardCommentPromptCard(talk, { ...people, viewer: sam }, "Is it?")?.text).toBe(
      `${context.cards[0]?.text}\nSam: Is it?`,
    );
    expect(boardCommentPromptCard(talk, people, " ")?.text).toBe(context.cards[0]?.text);
    // A long thread keeps its first comment and its newest replies, and says what it left out.
    const long = "x".repeat(ROOM_BOARD_NOTE_MAX_LENGTH);
    const full = note("talk", {
      text: "Ship it?",
      kind: "comment",
      replies: Array.from({ length: ROOM_BOARD_MAX_REPLIES }, (_, index) =>
        reply(`r${index}`, `${index} ${long}`),
      ),
    });
    const [cut] = boardPromptContext(
      board([full], [arrow("note:talk", "card:thread")]),
      people,
    ).cards;
    const lines = cut?.text.split("\n") ?? [];
    expect(cut?.text.length).toBeLessThanOrEqual(4_000);
    expect(lines[0]).toBe("The owner: Ship it?");
    expect(lines[1]).toMatch(/^\(\d+ earlier replies left out\)$/);
    expect(lines.at(-1)).toBe(`The owner: ${ROOM_BOARD_MAX_REPLIES - 1} ${long}`);
    expect(Number(/\d+/.exec(lines[1] ?? "")?.[0]) + lines.length - 2).toBe(ROOM_BOARD_MAX_REPLIES);
  });

  it("carries the cards into any box and into the artifact it rewrites, never thread boxes", () => {
    const shared = board(
      [
        note("a"),
        note("b"),
        note("dark", { text: "Make it dark mode", guestId: sam }),
        note("art", { text: "Mockup", kind: "artifact" }),
        note("other", { text: "Other", kind: "artifact" }),
        note("box", { text: "Sam's box", kind: "thread", guestId: sam }),
        note("box2", { text: "", kind: "thread" }),
      ],
      [
        arrow("note:a", "note:art"),
        arrow("note:b", "note:a"),
        arrow("note:dark", "note:box"),
        // Another box pointing in is a conversation of its own, not a card.
        arrow("note:box2", "note:box"),
        arrow("note:box", "note:art"),
        arrow("note:box", "note:other"),
        arrow("note:art", "note:box"),
        arrow("card:thread", "note:art"),
      ],
    );
    const sams = boardPromptContext(shared, people, [], "box");
    expect(sams.cards.map((card) => [card.ref, card.label])).toEqual([
      ["note:a", "Note from You"],
      ["note:dark", "Note from Sam"],
      ["note:b", "Note from You"],
    ]);
    // The first artifact the box has a line to is the one its replies rewrite.
    expect(sams.artifact?.id).toBe("art");
    expect(sams.artifactEdgeId).toBe("note:box>note:art");
    expect([...sams.edgeIds]).toEqual(["note:a>note:art", "note:b>note:a", "note:dark>note:box"]);
    // The room thread's own card rewrites the same artifact and carries the cards into it.
    const room = boardPromptContext(shared, people);
    expect(room.cards.map((card) => card.ref)).toEqual(["note:a", "note:b"]);
    expect(room.artifactEdgeId).toBe("card:thread>note:art");
    // A box with no line to an artifact rewrites nothing.
    expect(boardPromptContext(shared, people, [], "box2").artifact).toBeNull();
  });

  it("sends a card once, again once it changed, always when pinned, and new on an old board", () => {
    const sentAt = "2026-11-13T10:00:00.000Z";
    const before = "2026-11-13T09:00:00.000Z";
    const after = "2026-11-13T11:00:00.000Z";
    const line = (from: string, fields: Partial<RoomBoardEdge> = {}): RoomBoardEdge => ({
      id: `${from}>box`,
      from: `note:${from}`,
      to: "note:box",
      ...fields,
    });
    const marked: RoomBoard = {
      positions: {},
      notes: [
        note("box", { kind: "thread", text: "Box" }),
        note("old"),
        note("sent", { editedAt: before }),
        note("edited", { editedAt: after }),
        note("talk", {
          kind: "comment",
          replies: [
            { id: "r", text: "Yes", at: before },
            // This box's own agent answering is no change to send back to it.
            { id: "agent:t", text: "Done", at: after, agent: { turnId: "t", boxId: "box" } },
          ],
        }),
        note("replied", { kind: "comment", replies: [{ id: "r", text: "No", at: after }] }),
        note("pin"),
      ],
      edges: [
        line("old"),
        line("sent", { sentAt }),
        line("edited", { sentAt }),
        line("talk", { sentAt }),
        line("replied", { sentAt }),
        line("pin", { sentAt, pinned: true }),
      ],
    };
    const context = boardPromptContext(marked, people, [], "box");
    expect(context.cards.map((card) => [card.ref, card.status, boardPromptCardGoes(card)])).toEqual(
      [
        ["note:old", "new", true],
        ["note:sent", "sent", false],
        ["note:edited", "updated", true],
        ["note:talk", "sent", false],
        ["note:replied", "updated", true],
        ["note:pin", "pinned", true],
      ],
    );
    expect(context.cards.find((card) => card.ref === "note:pin")?.edgeIds).toEqual(["pin>box"]);
    expect(context.edgeStatus.get("sent>box")).toBe("sent");
    expect(context.edgeStatus.get("old>box")).toBe("new");
    // A card newly connected by a second line goes again; one sent never uses up a prompt's room.
    const relinked = boardPromptContext(
      {
        ...marked,
        edges: [...(marked.edges ?? []), { id: "sent>talk", from: "note:sent", to: "note:talk" }],
      },
      people,
      [],
      "box",
    );
    expect(relinked.cards.find((card) => card.ref === "note:sent")?.status).toBe("new");
    const many = Array.from({ length: BOARD_PROMPT_MAX_CARDS + 2 }, (_, index) =>
      note(`s${index}`),
    );
    const crowded = boardPromptContext(
      {
        positions: {},
        notes: [note("box", { kind: "thread" }), ...many, note("fresh")],
        edges: [...many.map((each) => line(each.id, { sentAt })), line("fresh")],
      },
      people,
      [],
      "box",
    );
    expect(crowded.cards.at(-1)?.ref).toBe("note:fresh");
    // A line between cards counts as sent only for the boxes a prompt carried it to; an older
    // board's single mark on it is no box's.
    const shared: RoomBoard = {
      ...marked,
      notes: [...marked.notes, note("box2", { kind: "thread" }), note("far")],
      edges: [
        ...(marked.edges ?? []),
        { id: "far>sent", from: "note:far", to: "note:sent", sentAt, sentFor: { box: sentAt } },
        { id: "sent>box2", from: "note:sent", to: "note:box2" },
      ],
    };
    const statuses = (boxId: string) =>
      boardPromptContext(shared, people, [], boxId).cards.map((card) => [card.ref, card.status]);
    expect(statuses("box")).toContainEqual(["note:far", "sent"]);
    expect(statuses("box2")).toEqual([
      ["note:sent", "new"],
      ["note:far", "new"],
    ]);
    // What a prompt carried, marked the way the server marks it, reads back as sent, however far.
    const chain: RoomBoard = {
      positions: {},
      notes: [note("x", { kind: "thread" }), note("y", { kind: "thread" }), note("b"), note("a")],
      edges: [
        { id: "a>b", from: "note:a", to: "note:b" },
        { id: "b>x", from: "note:b", to: "note:x" },
        { id: "b>y", from: "note:b", to: "note:y" },
      ],
    };
    const carried = boardPromptContext(chain, people, [], "x").cards.map((card) => card.ref);
    const afterSend = roomBoardWithCardsSent(chain, "x", undefined, carried, sentAt);
    const read = (boxId: string) =>
      boardPromptContext(afterSend, people, [], boxId).cards.map((card) => [card.ref, card.status]);
    expect(read("x")).toEqual([
      ["note:b", "sent"],
      ["note:a", "sent"],
    ]);
    expect(read("y")).toEqual([
      ["note:b", "new"],
      ["note:a", "new"],
    ]);
  });

  it("shows an artifact as a page only when it is a whole HTML document", () => {
    expect(isBoardHtmlArtifact("\n  <!DOCTYPE html><html></html>")).toBe(true);
    expect(isBoardHtmlArtifact('<html lang="en"><body>Hi</body></html>')).toBe(true);
    expect(isBoardHtmlArtifact("# Plan\n\n<html> is a tag")).toBe(false);
    expect(isBoardHtmlArtifact("<div>Hi</div>")).toBe(false);
  });

  it.each([
    {
      html: "<!doctype html><html><head><title> Q3 &amp; Q4\n plan </title></head><h1>Other</h1>",
      title: "Q3 & Q4 plan",
    },
    {
      html: '<html><body><h2 class="x">A <em>bold</em> idea</h2></body></html>',
      title: "A bold idea",
    },
    { html: "<html><head><title></title></head><body><h1>Fallback</h1>", title: "Fallback" },
    // A reply cut short before its title closes names nothing.
    { html: "<!doctype html><html><head><title>Cut sho", title: null },
  ])("names an HTML page by its title or first heading: $title", ({ html, title }) => {
    expect(boardHtmlTitle(html)).toBe(title);
  });
});

describe("boardCardsLine", () => {
  const sam = GuestId.make("sam");
  const guests = [
    { id: sam, name: "Sam" },
    { id: "ana", name: "Ana" },
  ];
  const sent = [
    "Note from the owner",
    "Note from the owner",
    "Task from Sam",
    'Artifact "Plan"',
    "Note from Ana",
  ];
  it.each([
    {
      name: "the owner reads their own cards as theirs, counted",
      people: { guests, viewer: null },
      line: '2 notes from You, Task from Sam, Artifact "Plan", Note from Ana',
    },
    {
      name: "a guest reads the owner's by name and their own as theirs",
      people: { guests, viewer: sam, ownerName: "Theo" },
      line: '2 notes from Theo, Task from You, Artifact "Plan", Note from Ana',
    },
    {
      name: "an owner with no name shown is the owner, as the chips say",
      people: { guests, viewer: "ana" },
      line: '2 notes from Owner, Task from Sam, Artifact "Plan", Note from You',
    },
  ])("$name", ({ people, line }) => {
    expect(boardCardsLine(sent, people)).toBe(line);
  });

  it("counts the same card label of another kind without making up a plural", () => {
    expect(boardCardsLine(['Artifact "Plan"', 'Artifact "Plan"'], { guests, viewer: null })).toBe(
      'Artifact "Plan" (2)',
    );
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

  it("names whose agent answers in a comment thread, and on what, while it replies and after", () => {
    const owner = { guests, viewer: null, ownerName: "Alex" };
    const asSam = { guests, viewer: sam };
    const agent = { turnId: "t", boxId: "b", model: "Haiku" };
    expect(boardCommentAgentAuthor({ guestId: sam, agent }, owner)).toBe("Sam's agent · Haiku");
    expect(boardCommentAgentAuthor({ agent }, asSam)).toBe("Owner's agent · Haiku");
    expect(boardCommentAgentAuthor({ agent: {} }, owner)).toBe("Your agent");
    expect(boardCommentReplying({ guestId: sam, phase: "thinking" }, owner)).toBe(
      "Sam's agent is replying… · Thinking",
    );
    expect(boardCommentReplying({ phase: "tool", detail: "Editing files" }, owner)).toBe(
      "Your agent is replying… · Editing files",
    );
  });

  it("says which way a restore goes, by which version is older", () => {
    const older = "2026-11-12T00:00:00.000Z";
    const newer = "2026-11-12T00:05:00.000Z";
    expect(boardRestoreLabel({ updatedAt: newer, previous: { updatedAt: older } })).toBe(
      "Restore previous",
    );
    expect(boardRestoreLabel({ updatedAt: older, previous: { updatedAt: newer } })).toBe(
      "Back to latest",
    );
    expect(boardRestoreLabel({ updatedAt: older, previous: { updatedAt: older } })).toBe(
      "Restore previous",
    );
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

describe("thread boxes", () => {
  const sam = GuestId.make("sam");
  const eve = GuestId.make("eve");
  const guests = [
    { id: sam, name: "Sam" },
    { id: eve, name: "Eve" },
  ];
  const box = (id: string, guestId?: GuestId): RoomBoardNote => ({
    id,
    text: id === "b1" ? " Pricing " : "",
    x: 0,
    y: 0,
    kind: "thread",
    ...(guestId === undefined ? {} : { guestId }),
  });
  const shared: RoomBoard = {
    positions: {},
    notes: [
      box("b1"),
      box("b2", sam),
      { id: "art", text: "Mockup", x: 0, y: 0, kind: "artifact" },
      { id: "n", text: "Dark mode", x: 0, y: 0 },
    ],
    edges: [
      { id: "e1", from: "note:b2", to: "note:art" },
      { id: "e2", from: "card:thread", to: "note:art" },
    ],
  };

  it("lists the room thread's own box first, and lets only its person prompt each", () => {
    const boxes = boardThreadBoxes(shared, "Launch");
    expect(boxes).toEqual([
      { id: "thread", guestId: undefined, title: "Launch" },
      { id: "b1", guestId: undefined, title: "Pricing" },
      { id: "b2", guestId: sam, title: "" },
    ]);
    const [room, own, sams] = boxes;
    expect([room, own, sams].map((each) => canPromptBoardBox(each!, null))).toEqual([
      true,
      true,
      false,
    ]);
    expect([room, own, sams].map((each) => canPromptBoardBox(each!, sam))).toEqual([
      false,
      false,
      true,
    ]);
    expect(canPromptBoardBox(sams!, eve)).toBe(false);
    // A comment thread asks only the viewer's own boxes, the room thread's card first.
    expect(boardCommentAskBoxes(boxes, null)).toEqual([
      { id: "thread", label: "Your agent · Launch" },
      { id: "b1", label: "Your agent · Pricing" },
    ]);
    expect(boardCommentAskBoxes(boxes, sam)).toEqual([
      { id: "b2", label: "Your agent · Untitled thread" },
    ]);
    expect(boardCommentAskBoxes(boxes, eve)).toEqual([]);
  });

  it("says whose agent runs a box, a guest's by who ran its last turn", () => {
    const sent: { readonly guestId?: string } = {};
    expect(boardBoxAgentLabel({ guestId: sam }, { guests, viewer: eve })).toBe("Sam's thread");
    expect(boardBoxAgentLabel({ guestId: sam }, { guests, viewer: sam })).toBe("Your thread");
    expect(boardBoxAgentLabel({ guestId: sam }, { guests, viewer: eve }, { guestId: sam })).toBe(
      "Sam's agent",
    );
    expect(boardBoxAgentLabel({ guestId: sam }, { guests, viewer: sam }, { guestId: sam })).toBe(
      "Your agent",
    );
    expect(boardBoxAgentLabel({}, { guests, viewer: null })).toBe("Your agent");
    expect(boardBoxAgentLabel({}, { guests, viewer: sam, ownerName: "Alex" })).toBe("Alex's agent");
    expect(boardBoxAgentLabel({ guestId: sam }, { guests, viewer: null }, sent)).toBe(
      "Sam, through your agent",
    );
    expect(boardBoxAgentLabel({ guestId: sam }, { guests, viewer: sam }, sent)).toBe(
      "You, through the owner's agent",
    );
    expect(boardBoxAgentLabel({ guestId: sam }, { guests, viewer: eve }, sent)).toBe(
      "Sam, through the owner's agent",
    );
    expect(boardBoxName({ id: "b1", title: "Pricing" }, { guests, viewer: null })).toBe(
      'Your thread "Pricing"',
    );
    expect(boardBoxName({ id: "b2", guestId: sam, title: "" }, { guests, viewer: null })).toBe(
      "Sam's thread",
    );
  });

  it.each([
    ["Fix  the\nlogin ", "Fix the login"],
    ["   ", "Board thread"],
    ["a".repeat(81), `${"a".repeat(79)}…`],
  ])("titles a box added for the thread %j as %j", (threadTitle, title) => {
    expect(boardThreadBoxTitle(threadTitle)).toBe(title);
  });

  it("finds the requests waiting on each box, and none from the room thread's composer", () => {
    const message = (id: string, fields: Partial<ThreadGuestMessage>): ThreadGuestMessage => ({
      id: GuestMessageId.make(id),
      text: id,
      status: "pending",
      submittedAt: "2026-11-12T00:00:00.000Z",
      guestId: sam,
      ...fields,
    });
    const messages = [
      message("plain", {}),
      message("first", { boxId: "b2" }),
      message("sent", { boxId: "b2", status: "sent" }),
      message("room", { boxId: "thread" }),
      message("second", { boxId: "b2", artifactId: "art" }),
    ];
    expect(boardBoxRequests(messages, "b2").map((each) => each.id)).toEqual(["first", "second"]);
    expect(boardBoxRequests(messages, "thread").map((each) => each.id)).toEqual(["room"]);
    expect(boardBoxRequests(messages, "b1")).toEqual([]);
    // A guest's card lists only what no box on the board shows.
    const boxes = boardThreadBoxes(shared, "Launch");
    expect(boardGuestWaiting(messages, sam, boxes).map((each) => each.id)).toEqual(["plain"]);
    expect(boardGuestWaiting(messages, eve, boxes)).toEqual([]);
    // Its box was removed: the request shows on the guest's card again.
    expect(
      boardGuestWaiting(messages, sam, boardThreadBoxes(EMPTY_ROOM_BOARD, "Launch")).map(
        (each) => each.id,
      ),
    ).toEqual(["plain", "first", "second"]);
  });

  it("reuses the viewer's own box that already rewrites an artifact for Attach my agent", () => {
    expect(boardOwnBoxFor(shared, sam, "art")).toBe("b2");
    // The owner's room thread card counts as theirs.
    expect(boardOwnBoxFor(shared, null, "art")).toBe("thread");
    // Eve has no box on it, and a box pointing elsewhere is not one.
    expect(boardOwnBoxFor(shared, eve, "art")).toBeNull();
    expect(
      boardOwnBoxFor(
        { ...shared, edges: [{ id: "e", from: "note:b1", to: "note:n" }] },
        null,
        "art",
      ),
    ).toBeNull();
  });
});

describe("box progress", () => {
  it("says what a box's agent is doing, with its model and how long it has run", () => {
    const startedAt = "2026-11-12T10:00:00.000Z";
    const at = (seconds: number) => Date.parse(startedAt) + seconds * 1000;
    expect(boardProgressPhase({ phase: "queued" })).toBe("Queued");
    expect(boardProgressPhase({ phase: "thinking" })).toBe("Thinking");
    expect(boardProgressPhase({ phase: "tool", detail: " pnpm test " })).toBe("Running pnpm test");
    expect(boardProgressPhase({ phase: "tool" })).toBe("Running a tool");
    expect(boardProgressPhase({ phase: "tool", detail: "Running a command" })).toBe(
      "Running a command",
    );
    expect(boardProgressPhase({ phase: "tool", detail: "Editing files" })).toBe("Editing files");
    expect(boardProgressPhase({ phase: "writing" })).toBe("Writing");
    expect(boardProgressPhase({ phase: "approval" })).toBe("Waiting for approval");
    expect(
      boardProgressLine({ phase: "writing", model: "Claude Opus 4.5", startedAt }, at(65)),
    ).toBe("Writing · Claude Opus 4.5 · 1m 05s");
    expect(boardProgressLine({ phase: "thinking", startedAt }, at(-3))).toBe("Thinking · 0s");
    expect(formatBoardElapsed(8_900)).toBe("8s");
    expect(formatBoardElapsed(3_840_000)).toBe("1h 04m");
  });

  it("shows a draft that starts as markup as a page's source while it streams", () => {
    expect(boardDraftIsPage("<!doc")).toBe(true);
    expect(boardDraftIsPage("\n  <html><body>")).toBe(true);
    expect(boardDraftIsPage("# Plan\n\n<b>bold</b>")).toBe(false);
  });
});

describe("panToShow", () => {
  const size = { width: 800, height: 600 };

  it("leaves the view alone when the card is already in view, and pans once, least, when not", () => {
    const view = { x: -100, y: 50, zoom: 1 };
    expect(panToShow(view, { x: 200, y: 100, width: 300, height: 200 }, size)).toBe(view);
    // Past the right edge: it moves left just enough, and not up or down.
    expect(panToShow(view, { x: 700, y: 100, width: 300, height: 200 }, size)).toEqual({
      x: -224,
      y: 50,
      zoom: 1,
    });
    // Above the top at half zoom: it moves down just enough.
    const zoomed = { x: 0, y: 0, zoom: 0.5 };
    expect(panToShow(zoomed, { x: 100, y: -200, width: 200, height: 200 }, size)).toEqual({
      x: 0,
      y: 124,
      zoom: 0.5,
    });
    // Too wide to show whole: its start shows.
    expect(panToShow(view, { x: 0, y: 100, width: 2_000, height: 100 }, size).x).toBe(24);
  });

  it("leaves the view alone for a new card that shows whole, and shows the rest of one that does not", () => {
    const view = { x: 0, y: 0, zoom: 1 };
    // Placed in view, even a gap from the edge: nothing moves.
    expect(panToShowAdded(view, { x: 16, y: 16, width: 380, height: 400 }, size)).toBe(view);
    expect(panToShowAdded(view, { x: 404, y: 184, width: 380, height: 400 }, size)).toBe(view);
    // A thread box whose prompt box is below the view comes up just enough to show it.
    const tall = { width: 1_200, height: 950 };
    expect(panToShowAdded(view, { x: 400, y: 570, width: 340, height: 460 }, tall).y).toBe(-104);
    // Partly past the edge, mostly past it, or past it whole: it comes into view.
    expect(panToShowAdded(view, { x: 480, y: 72, width: 380, height: 400 }, size).x).toBe(-84);
    expect(panToShowAdded(view, { x: 700, y: 72, width: 380, height: 400 }, size).x).toBe(-304);
    expect(panToShowAdded(view, { x: 100, y: 900, width: 192, height: 144 }, size).y).toBe(-468);
  });

  it("fits every card in the board's area at no more than full size", () => {
    const rects = [
      { x: 0, y: 0, width: 400, height: 300 },
      { x: 1_200, y: 400, width: 400, height: 300 },
    ];
    const fit = fitBoardView(rects, size);
    expect(fit.zoom).toBeCloseTo(720 / 1_600);
    const left = fit.x;
    const right = fit.x + 1_600 * fit.zoom;
    expect(left).toBeGreaterThanOrEqual(39);
    expect(800 - right).toBeGreaterThanOrEqual(39);
    expect(fitBoardView([{ x: 10, y: 10, width: 100, height: 100 }], size).zoom).toBe(1);
    expect(fitBoardView([], size)).toEqual(INITIAL_BOARD_VIEW);
  });
});

describe("the visible board area", () => {
  // The test window: the sidebar ends at 262, and the conversation beside the board starts at 771.
  const area = { left: 262, top: 48, width: 509, height: 700 };

  it("measures from the surface's own place on screen, not the window's", () => {
    const view = { x: -40, y: 20, zoom: 0.5 };
    expect(clientToBoard(view, area, { x: 262, y: 48 })).toEqual({ x: 80, y: -40 });
    expect(clientToBoard(view, area, { x: 362, y: 148 })).toEqual({ x: 280, y: 160 });
    expect(visibleBoardRect(view, area)).toEqual({ x: 80, y: -40, width: 1018, height: 1400 });
    expect(clientRectToBoard(view, area, { x: 312, y: 848, width: 100, height: 40 })).toEqual({
      x: 180,
      y: 1560,
      width: 200,
      height: 80,
    });
  });

  it("reopens on the view last left, unless it shows none of the cards", () => {
    const view = { x: -40, y: 20, zoom: 0.5 };
    const seen = { x: 1000, y: 100, width: 200, height: 100 };
    const away = { x: 1200, y: 100, width: 200, height: 100 };
    expect(openingBoardView(view, area, [away, seen])).toBe(view);
    expect(openingBoardView(view, area, [away])).toBeNull();
    expect(openingBoardView(view, area, [])).toBeNull();
  });

  it("places a new card inside the area beside the conversation, and needs no pan for it", () => {
    const view = { x: 0, y: 0, zoom: 1 };
    const tall = { ...area, height: 800 };
    const visible = visibleBoardRect(view, tall);
    const room = { x: 80, y: 72, width: 320, height: 200 };
    for (const kind of ["artifact", "thread"] as const) {
      const size = boardNewNoteSize(kind);
      const at = placeBoardItem(
        size,
        { x: visible.x + visible.width / 2, y: visible.y + visible.height / 2 },
        [room],
        visible,
      );
      // Its right edge stays left of the conversation's divider.
      expect(at.x + size.w).toBeLessThanOrEqual(visible.x + visible.width);
      expect(at.x).toBeGreaterThanOrEqual(visible.x);
      expect(panToShow(view, { ...at, width: size.w, height: size.h }, tall)).toBe(view);
    }
  });

  it("shows only the top-left of a card too big for the area, panning once if it must", () => {
    const narrow = { width: 348, height: 700 };
    const view = { x: 0, y: 0, zoom: 1 };
    const wide = { x: 100, y: 100, width: 380, height: 400 };
    // Its top-left is already in the first half: nothing moves.
    expect(panToShow(view, wide, narrow)).toBe(view);
    // Further right, it comes back just to the middle.
    expect(panToShow(view, { ...wide, x: 300 }, narrow).x).toBe(-126);
  });

  it("fits cards into the area beside the conversation, from their top-left when too spread", () => {
    const rects = [
      { x: 0, y: 0, width: 300, height: 200 },
      { x: 900, y: 0, width: 300, height: 200 },
    ];
    const fit = fitBoardView(rects, area);
    expect(fit.x).toBeGreaterThanOrEqual(40);
    expect(fit.x + 1_200 * fit.zoom).toBeLessThanOrEqual(area.width - 39);
    const spread = fitBoardView(
      [
        { x: -500, y: 0, width: 100, height: 100 },
        { x: 5_000, y: 0, width: 100, height: 100 },
      ],
      area,
    );
    expect(spread.zoom).toBe(BOARD_MIN_ZOOM);
    expect(spread.x + -500 * spread.zoom).toBe(40);
  });

  it("keeps the board the larger side of the row, whatever width the conversation kept", () => {
    // The board's half is its own: the divider comes out of the conversation's.
    expect(boardPanelMaxWidth(1_018)).toBe(509 - BOARD_SPLIT_DIVIDER);
    expect(boardPanelMaxWidth(1_600)).toBe(800 - BOARD_SPLIT_DIVIDER);
    expect(boardPanelMaxWidth(700)).toBe(320);
  });
});

describe("comment pins", () => {
  it("stay a readable size on screen at any zoom", () => {
    const rows: ReadonlyArray<readonly [number, number]> = [
      [1, 32],
      [BOARD_MIN_ZOOM, 24],
      [0.5, 24],
      [1.2, 38.4],
      [BOARD_MAX_ZOOM, 40],
    ];
    for (const [zoom, onScreen] of rows) {
      expect(32 * boardPinScale(zoom) * zoom).toBeCloseTo(onScreen);
    }
    // A line meets a pin at the middle of its side, at the size it is drawn.
    const pin = { x: 10, y: 20, kind: "comment" as const };
    expect(boardNoteBox(pin, BOARD_MIN_ZOOM)).toEqual({ x: 10, y: 20, width: 120, headerY: 60 });
  });

  it("opens a thread beside its pin, inside the board and never over the pin", () => {
    const area = { width: 800, height: 600 };
    const pin = (x: number, y: number) => ({ x, y, width: 32, height: 32 });
    const rows = [
      // Room on the right, in the top half: below the pin's top, to the right.
      [pin(100, 100), { left: 140, top: 100, maxHeight: 492 }],
      // No room on the right: to the left.
      [pin(700, 100), { left: 692 - 288, top: 100, maxHeight: 492 }],
      // In the bottom half: it grows up from the pin's bottom.
      [pin(100, 500), { left: 140, bottom: 68, maxHeight: 524 }],
      // Above the top edge, it stays inside the board.
      [pin(100, -50), { left: 140, top: 8, maxHeight: 584 }],
    ] as const;
    for (const [rect, spot] of rows) {
      expect(boardCommentPanelSpot(rect, area)).toEqual(spot);
    }
    // Too narrow for either side: below a pin in the top half, above one in the bottom half.
    const narrow = { width: 300, height: 600 };
    const narrowRows = [
      [pin(100, 100), { left: 8, top: 140, maxHeight: 452 }],
      [pin(100, 500), { left: 8, bottom: 108, maxHeight: 484 }],
    ] as const;
    for (const [rect, spot] of narrowRows) {
      expect(boardCommentPanelSpot(rect, narrow)).toEqual(spot);
    }
  });

  it("goes with the thread box or artifact it is dropped on", () => {
    const board: RoomBoard = {
      positions: {},
      notes: [
        { id: "box", text: "", x: 0, y: 0, kind: "thread" },
        { id: "page", text: "", x: 0, y: 0, kind: "artifact" },
        { id: "code", text: "", x: 0, y: 0, kind: "code" },
        { id: "idea", text: "Ship it", x: 0, y: 0 },
        { id: "pin", text: "Why?", x: 0, y: 0, kind: "comment" },
      ],
    };
    const rows = [
      ["card:thread", "card:thread"],
      ["note:box", "note:box"],
      ["note:page", "note:page"],
      ["note:code", "note:code"],
      ["note:idea", null],
      ["note:pin", null],
      ["card:guest:g1", null],
      [null, null],
    ] as const;
    for (const [under, to] of rows) {
      expect(boardCommentLineTo(board, under)).toBe(to);
    }
    // A board with all the lines it holds takes the pin without one.
    const edges = Array.from({ length: ROOM_BOARD_MAX_EDGES }, (_, index) => ({
      id: `e${index}`,
      from: "note:idea",
      to: `note:n${index}`,
    }));
    expect(boardCommentLineTo({ ...board, edges }, "note:box")).toBeNull();
  });
});

describe("unread comment threads", () => {
  const sam = GuestId.make("sam");
  const reply = (id: string, at: string, fields: Partial<RoomBoardReply> = {}): RoomBoardReply => ({
    id,
    text: id,
    at: `2026-11-13T10:0${at}:00.000Z`,
    ...fields,
  });
  const thread = (replies: ReadonlyArray<RoomBoardReply>): RoomBoardNote => ({
    id: "c",
    text: "Ship it?",
    x: 0,
    y: 0,
    kind: "comment",
    replies,
  });

  it("has a reply newer than when this viewer last had it open, unless the viewer wrote it", () => {
    const seen = "2026-11-13T10:02:00.000Z";
    const rows: ReadonlyArray<readonly [ReadonlyArray<RoomBoardReply>, string | null, boolean]> = [
      [[], null, false],
      [[reply("old", "1", { guestId: sam })], null, false],
      [[reply("new", "3", { guestId: sam })], null, true],
      // Their own reply never makes it unread, a guest's or the owner's.
      [[reply("mine", "3", { guestId: sam })], "sam", false],
      [[reply("owners", "3")], null, false],
      [[reply("owners", "3")], "sam", true],
      // An agent's answer does, even their own agent's.
      [[reply("agent", "3", { agent: { turnId: "run", boxId: "thread" } })], null, true],
    ];
    for (const [replies, viewer, unread] of rows) {
      expect(boardCommentUnread(thread(replies), viewer, seen)).toBe(unread);
    }
    // Never opened here: any reply of someone else's is new.
    expect(boardCommentUnread(thread([reply("old", "1", { guestId: sam })]), null, undefined)).toBe(
      true,
    );
  });

  it("remembers the newest reply of the thread that was open, within a cap", () => {
    const note = thread([reply("a", "3"), reply("b", "1")]);
    const at = boardNewestReplyAt(note);
    expect(at).toBe("2026-11-13T10:03:00.000Z");
    const seen = boardCommentsSeen({}, "share/c", at);
    expect(seen).toEqual({ "share/c": at });
    expect(boardCommentsSeen(seen, "share/c", at)).toBe(seen);
    expect(boardCommentsSeen(seen, "share/d", undefined)).toBe(seen);
    const full = Object.fromEntries(
      Array.from({ length: BOARD_SEEN_COMMENTS_MAX }, (_, index) => [
        `share/${index}`,
        new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
      ]),
    );
    const kept = boardCommentsSeen(full, "share/c", at);
    expect(Object.keys(kept)).toHaveLength(BOARD_SEEN_COMMENTS_MAX);
    expect(kept["share/c"]).toBe(at);
    expect(kept["share/0"]).toBeUndefined();
  });
});

describe("selecting several cards", () => {
  const sam = GuestId.make("sam");
  const board: RoomBoard = {
    positions: {},
    notes: [
      { id: "mine", text: "A", x: 10, y: 10 },
      { id: "sams", text: "B", x: 300, y: 10, guestId: sam },
      { id: "pin", text: "Why?", x: 50, y: 50, kind: "comment" },
    ],
  };
  const positions = { thread: { x: 0, y: 400 } };

  it("selects what a marquee touches, edges included", () => {
    const items = [
      { ref: "note:mine", rect: { x: 10, y: 10, width: 100, height: 100 } },
      { ref: "note:sams", rect: { x: 300, y: 10, width: 100, height: 100 } },
      { ref: "card:thread", rect: { x: 0, y: 400, width: 320, height: 200 } },
    ];
    expect(boardItemsInRect(items, { x: 100, y: 100, width: 200, height: 0 })).toEqual([
      "note:mine",
      "note:sams",
    ]);
    expect(boardItemsInRect(items, { x: 150, y: 150, width: 100, height: 100 })).toEqual([]);
    expect(boardItemsInRect(items, { x: -50, y: 300, width: 60, height: 120 })).toEqual([
      "card:thread",
    ]);
  });

  it("carries what sits mostly inside a section, and frames cards in a new one", () => {
    const items = [
      { ref: "note:frame", rect: { x: 0, y: 0, width: 400, height: 300 } },
      { ref: "note:mine", rect: { x: 10, y: 10, width: 100, height: 100 } },
      // Its centre is just outside, though it overlaps.
      { ref: "note:sams", rect: { x: 340, y: 10, width: 140, height: 100 } },
      { ref: "card:thread", rect: { x: 0, y: 400, width: 320, height: 200 } },
    ];
    expect(boardItemsCentredIn(items, items[0]!.rect, "note:frame")).toEqual(["note:mine"]);
    expect(
      boardSectionAround([
        { x: 100, y: 100, width: 200, height: 100 },
        { x: 400, y: 150, width: 100, height: 100 },
      ]),
    ).toEqual({ x: 68, y: 28, size: { w: 464, h: 254 } });
    expect(boardSectionAround([])).toBeNull();
    // A frame never grows past the largest card.
    expect(boardSectionAround([{ x: 0, y: 0, width: 3_000, height: 100 }])?.size.w).toBe(
      ROOM_BOARD_MAX_CARD_SIZE,
    );
  });

  it("duplicates notes, tasks and links as the viewer's own, and nothing else", () => {
    const notes: ReadonlyArray<RoomBoardNote> = [
      { id: "n", text: "Idea", x: 0, y: 0, guestId: sam, color: "green", size: { w: 200, h: 150 } },
      {
        id: "t",
        text: "Ship",
        x: 10,
        y: 0,
        kind: "task",
        done: true,
        assignee: { guestId: sam },
        reactions: [{ emoji: "👍" }],
      },
      { id: "l", text: "Docs", x: 20, y: 0, kind: "link", url: "https://x.dev" },
      { id: "a", text: "Page", x: 0, y: 0, kind: "artifact" },
      { id: "d", text: "Diff", x: 0, y: 0, kind: "code" },
      { id: "b", text: "Box", x: 0, y: 0, kind: "thread" },
      { id: "c", text: "Why?", x: 0, y: 0, kind: "comment" },
      { id: "s", text: "Plan", x: 0, y: 0, section: true },
      { id: "p", text: "On a reply", x: 0, y: 0, pinnedTo: "message:1" },
    ];
    let next = 0;
    const copies = boardDuplicates(notes, null, () => `copy-${next++}`);
    expect(copies).toEqual([
      {
        from: "n",
        note: { id: "copy-0", text: "Idea", x: 0, y: 0, color: "green", size: { w: 200, h: 150 } },
      },
      { from: "t", note: { id: "copy-1", text: "Ship", x: 10, y: 0, kind: "task" } },
      {
        from: "l",
        note: { id: "copy-2", text: "Docs", x: 20, y: 0, kind: "link", url: "https://x.dev" },
      },
    ]);
    expect(boardDuplicates(notes.slice(0, 1), sam, () => "mine")[0]?.note.guestId).toBe(sam);
  });

  it.each([
    { name: "nothing when all of it is copied", kinds: [undefined, "task"], cards: 0, said: null },
    {
      name: "what it left out, in one sentence",
      kinds: [undefined, "artifact", "comment", "thread", "code"],
      cards: 0,
      said: "Artifacts, comment threads, thread boxes and code windows are not copied.",
    },
    {
      name: "the room's cards",
      kinds: [undefined],
      cards: 2,
      said: "The room's cards are not copied.",
    },
  ] as const)("says on copying a selection $name", ({ kinds, cards, said }) => {
    const notes = kinds.map((kind, index) => ({
      id: `n${index}`,
      text: "",
      x: 0,
      y: 0,
      ...(kind === undefined ? {} : { kind }),
    }));
    expect(boardCopySkipped(notes, cards)).toBe(said);
  });

  it("tidies cards into a grid in reading order, with even gaps, clear of the rest", () => {
    const items = [
      { ref: "note:c", rect: { x: 410, y: 30, width: 100, height: 80 } },
      { ref: "note:a", rect: { x: 0, y: 0, width: 100, height: 100 } },
      { ref: "note:d", rect: { x: 50, y: 300, width: 100, height: 50 } },
      { ref: "note:b", rect: { x: 200, y: 20, width: 150, height: 100 } },
    ];
    // Reading order a, b, c, d; two columns as wide as the widest card, rows as tall as theirs.
    expect(boardTidy(items, [])).toEqual([
      { ref: "note:a", x: 0, y: 0 },
      { ref: "note:b", x: 174, y: 0 },
      { ref: "note:c", x: 0, y: 124 },
      { ref: "note:d", x: 174, y: 124 },
    ]);
    // Something else where the grid would go moves it clear.
    const tidied = boardTidy(items, [{ x: 0, y: 0, width: 400, height: 300 }]);
    for (const { ref, x, y } of tidied) {
      const { width, height } = items.find((item) => item.ref === ref)!.rect;
      expect(x >= 400 || y >= 300 || x + width <= 0 || y + height <= 0).toBe(true);
    }
  });

  it.each([
    { name: "where they are when nothing is in the way", taken: [], at: { x: 400, y: 300 } },
    {
      // Nearer up and to the left, but that would take the grid off where they were.
      name: "down or right, never up or left, past a card just beside the grid",
      taken: [{ x: 730, y: 300, width: 200, height: 100 }],
      at: { x: 400, y: 420 },
    },
  ])("starts a tidied grid $name", ({ taken, at }) => {
    const items = [
      { ref: "note:a", rect: { x: 400, y: 300, width: 150, height: 100 } },
      { ref: "note:b", rect: { x: 600, y: 320, width: 150, height: 100 } },
    ];
    const tidied = boardTidy(items, taken);
    expect({
      x: Math.min(...tidied.map(({ x }) => x)),
      y: Math.min(...tidied.map(({ y }) => y)),
    }).toEqual(at);
  });

  it("moves every selected card and note together, one change each, and leaves pins out", () => {
    const refs = ["note:mine", "card:thread", "note:pin", "note:gone", "line:x"];
    const items = boardSelectionItems(board, positions, refs);
    expect(items.map(({ target }) => boardEditKey(target))).toEqual(["note:mine", "card:thread"]);
    const moved = boardGroupMove(items, 25.4, -10);
    expect(
      moved.map(({ target, value }) => boardChangeOf(target, settleBoardValue(value))),
    ).toEqual([
      { type: "note.put", noteId: "mine", text: "A", x: 35, y: 0 },
      { type: "card.move", cardId: "thread", x: 25, y: 390 },
    ]);
    expect(boardItemTarget("card:guest:sam")).toEqual({ kind: "card", id: "guest:sam" });
    expect(boardItemTarget("edge:e")).toBeNull();
  });

  it("deletes only the notes the viewer may, and counts the ones it leaves", () => {
    const refs = ["note:mine", "note:sams", "card:thread"];
    expect(boardSelectionRemoval(board, refs, null)).toEqual({
      noteIds: ["mine", "sams"],
      left: 0,
    });
    expect(boardSelectionRemoval(board, refs, "sam")).toEqual({ noteIds: ["sams"], left: 1 });
  });
});

describe("undo and redo", () => {
  const note = { id: "n", text: "Ship", x: 0, y: 0 };
  const line = { id: "e", from: "note:n", to: "card:thread" };
  const board: RoomBoard = { positions: { thread: { x: 0, y: 0 } }, notes: [note], edges: [line] };
  const noteTarget = { kind: "note", id: "n" } as const;
  const card = { kind: "card", id: "thread" } as const;
  const edge = { kind: "edge", id: "e" } as const;

  it("takes back and makes again each kind of change, while the board still shows it", () => {
    const rows: ReadonlyArray<
      readonly [string, BoardHistoryEntry, RoomBoard, ReadonlyArray<unknown> | null]
    > = [
      [
        "a move",
        [{ target: card, before: { x: 10, y: 10 }, after: { x: 0, y: 0 } }],
        board,
        [{ type: "card.move", cardId: "thread", x: 10, y: 10 }],
      ],
      [
        "an edit, back to no colour",
        [{ target: noteTarget, before: note, after: { ...note, text: "Go", color: "pink" } }],
        { ...board, notes: [{ ...note, text: "Go", color: "pink" }] },
        [{ type: "note.put", noteId: "n", text: "Ship", x: 0, y: 0, color: "yellow" }],
      ],
      [
        "adding a note",
        [{ target: noteTarget, before: null, after: note }],
        board,
        [{ type: "note.remove", noteId: "n" }],
      ],
      [
        "drawing a line",
        [{ target: edge, before: null, after: line }],
        board,
        [{ type: "edge.remove", edgeId: "e" }],
      ],
      [
        "deleting a line",
        [{ target: edge, before: line, after: null }],
        { ...board, edges: [] },
        [{ type: "edge.put", edgeId: "e", from: "note:n", to: "card:thread" }],
      ],
      // Someone else moved the card since: nothing is taken back.
      [
        "a move someone else moved on",
        [{ target: card, before: { x: 10, y: 10 }, after: { x: 5, y: 5 } }],
        board,
        null,
      ],
      // An agent wrote into the artifact this person added: taking it off would lose that.
      [
        "adding a card an agent then wrote into",
        [{ target: noteTarget, before: null, after: note }],
        {
          ...board,
          notes: [
            {
              ...note,
              artifact: { body: "#", turnId: "t", updatedAt: "2026-11-13T00:00:00.000Z" },
            },
          ],
        },
        null,
      ],
      // Or the changes a box's thread made, in a code window this person added.
      [
        "adding a code window a box's changes then filled",
        [{ target: noteTarget, before: null, after: note }],
        {
          ...board,
          notes: [
            {
              ...note,
              changes: {
                files: [],
                additions: 0,
                deletions: 0,
                turnCount: 1,
                boxId: "thread",
                turnId: "t",
                updatedAt: "2026-11-13T00:00:00.000Z",
              },
            },
          ],
        },
        null,
      ],
    ];
    for (const [, entry, now, changes] of rows) {
      const undo = boardHistoryChanges(now, entry, "undo");
      expect(undo?.map(({ target, value }) => boardChangeOf(target, value)) ?? null).toEqual(
        changes,
      );
    }
    // Redo makes the change again once the board shows it taken back.
    const moved = [{ target: card, before: { x: 10, y: 10 }, after: { x: 0, y: 0 } }];
    expect(boardHistoryChanges(board, moved, "redo")).toBeNull();
    expect(
      boardHistoryChanges({ ...board, positions: { thread: { x: 10, y: 10 } } }, moved, "redo"),
    ).toEqual([{ target: card, value: { x: 0, y: 0 } }]);
  });

  it("takes back several cards moved together, and keeps the newest entries", () => {
    const entry = [
      { target: card, before: { x: 10, y: 10 }, after: { x: 0, y: 0 } },
      { target: noteTarget, before: { ...note, x: 10 }, after: note },
    ];
    expect(boardHistoryChanges(board, entry, "undo")?.map(({ target }) => target)).toEqual([
      noteTarget,
      card,
    ]);
    let history: ReadonlyArray<BoardHistoryEntry> = [];
    for (let index = 0; index <= BOARD_HISTORY_MAX; index++) {
      history = boardHistoryWith(history, [
        { target: card, before: null, after: { x: index, y: 0 } },
      ]);
    }
    expect(history).toHaveLength(BOARD_HISTORY_MAX);
    expect(history[0]?.[0]?.after).toEqual({ x: 1, y: 0 });
  });
});

describe("boardReactionChips", () => {
  it("shows each emoji once in a fixed order, with its count, who, and whether it is yours", () => {
    const sam = GuestId.make("sam");
    const people = { guests: [{ id: sam, name: "Sam" }], viewer: sam, ownerName: "Theo" };
    expect(
      boardReactionChips(
        [{ emoji: "🎉" }, { emoji: "👍", guestId: sam }, { emoji: "🎉", guestId: sam }],
        people,
      ),
    ).toEqual([
      { emoji: "👍", count: 1, mine: true, names: "You" },
      { emoji: "🎉", count: 2, mine: true, names: "Theo, You" },
    ]);
    expect(boardReactionChips([{ emoji: "👀" }], { ...people, viewer: null })).toEqual([
      { emoji: "👀", count: 1, mine: true, names: "You" },
    ]);
  });
});

describe("boardCentreSpot", () => {
  const note = { w: 200, h: 150 };
  const view = { x: 1_000, y: 2_000, width: 1_200, height: 800 };
  const centred = { x: 1_500, y: 2_325 };

  it("lands a toolbar note in the middle of the view, beside a card there, never far off", () => {
    expect(boardCentreSpot(note, [], view)).toEqual(centred);
    const blocker = { ...centred, width: 200, height: 150 };
    const beside = boardCentreSpot(note, [blocker], view);
    expect(beside).not.toEqual(centred);
    expect(Math.abs(beside.x - centred.x)).toBeLessThanOrEqual(note.w * 1.5);
    expect(Math.abs(beside.y - centred.y)).toBeLessThanOrEqual(note.h * 1.5);
  });

  it("steps over notes already stacked on the middle of a crowded view", () => {
    const wall = { x: 1_000, y: 2_000, width: 1_200, height: 800 };
    const stacked = [wall, { ...centred, width: 200, height: 150 }];
    expect(boardCentreSpot(note, [wall], view)).toEqual(centred);
    expect(boardCentreSpot(note, stacked, view)).toEqual({ x: 1_524, y: 2_349 });
  });
});

describe("boardMenuEntries", () => {
  const sam = GuestId.make("sam");
  const eve = GuestId.make("eve");
  const owner: BoardMenuRights = {
    viewer: null,
    canEdit: true,
    roomBoard: true,
    canAdd: true,
    canAddThread: true,
    canAddArtifact: true,
    canPaste: false,
  };
  const guest: BoardMenuRights = { ...owner, viewer: sam };
  const looker: BoardMenuRights = {
    ...guest,
    canEdit: false,
    canAdd: false,
    canAddThread: false,
    canAddArtifact: false,
  };
  const samsNote: RoomBoardNote = { id: "n", text: "Idea", x: 0, y: 0, guestId: sam };
  const evesLink: RoomBoardNote = {
    id: "l",
    text: "Docs",
    x: 0,
    y: 0,
    kind: "link",
    url: "https://x.dev",
    guestId: eve,
  };
  const evesBox: RoomBoardNote = { id: "b", text: "", x: 0, y: 0, kind: "thread", guestId: eve };

  it.each([
    {
      name: "everything to add for the owner, with paste when the clipboard is readable",
      rights: { ...owner, canPaste: true },
      entries: [
        "add-note",
        "add-task",
        "add-section",
        "add-thread",
        "add-artifact",
        "paste",
        "select-all",
        "fit",
      ],
    },
    {
      name: "no thread box or artifact past their limits, and no paste without the clipboard",
      rights: { ...guest, canAddThread: false, canAddArtifact: false },
      entries: ["add-note", "add-task", "add-section", "select-all", "fit"],
    },
    {
      name: "notes and tasks only on a team's board",
      rights: { ...owner, roomBoard: false },
      entries: ["add-note", "add-task", "select-all", "fit"],
    },
    {
      name: "only fitting the view for someone who may just look",
      rights: looker,
      entries: ["fit"],
    },
  ])("offers on the open board $name", ({ rights, entries }) => {
    expect(boardMenuEntries({ kind: "canvas" }, rights)).toEqual(entries);
  });

  it("offers copies and links of a card, never of a window, and nothing to a looker", () => {
    // The room thread's card, a person's or an agent's: only its own actions, never the board's.
    expect(boardMenuEntries({ kind: "fixed-card" }, owner)).toEqual([]);
    expect(boardMenuEntries({ kind: "card", note: samsNote }, guest)).toEqual([
      "duplicate",
      "copy",
    ]);
    expect(boardMenuEntries({ kind: "card", note: evesLink }, guest)).toEqual([
      "duplicate",
      "copy",
      "copy-link",
    ]);
    expect(boardMenuEntries({ kind: "card", note: evesBox }, guest)).toEqual([]);
    expect(boardMenuEntries({ kind: "card", note: evesLink }, looker)).toEqual(["copy-link"]);
  });

  it("deletes a selection only when some of it is the viewer's own", () => {
    const both = { kind: "selection", notes: [samsNote, evesBox], count: 2 } as const;
    expect(boardMenuEntries(both, guest)).toEqual(["duplicate", "copy", "tidy", "group", "delete"]);
    const evesOnly = { kind: "selection", notes: [evesBox, evesLink], count: 3 } as const;
    expect(boardMenuEntries(evesOnly, guest)).toEqual(["duplicate", "copy", "tidy", "group"]);
    expect(boardMenuEntries(evesOnly, owner)).toContain("delete");
    expect(boardMenuEntries(both, { ...guest, canAdd: false })).not.toContain("group");
    expect(boardMenuEntries(both, looker)).toEqual([]);
  });
});

describe("boardKeyEditsNote", () => {
  const plain = { ctrlKey: false, metaKey: false, altKey: false };
  it.each([
    { key: "a", modifiers: plain, edits: true },
    { key: "Enter", modifiers: plain, edits: true },
    { key: "a", modifiers: { ...plain, ctrlKey: true }, edits: false },
    { key: "a", modifiers: { ...plain, metaKey: true }, edits: false },
    { key: " ", modifiers: plain, edits: false },
    { key: "Delete", modifiers: plain, edits: false },
    { key: "ArrowUp", modifiers: plain, edits: false },
    { key: "Escape", modifiers: plain, edits: false },
  ])("edits a selected note on $key: $edits", ({ key, modifiers, edits }) => {
    expect(boardKeyEditsNote({ key, ...modifiers })).toBe(edits);
  });
});
