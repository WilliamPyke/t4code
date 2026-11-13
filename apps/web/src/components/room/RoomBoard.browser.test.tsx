import {
  GuestId,
  ROOM_BOARD_MAX_ARTIFACTS,
  type RoomBoardChange,
  type RoomBoardNote,
  type RoomCursor,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import "../../index.css";

import { RoomBoard, RoomCursors } from "./RoomBoard";
import { rememberRoomBoardView } from "./roomBoardNavigation";

function sizedContainer() {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;width:1000px;height:700px";
  return container;
}

function renderBoard(
  notes: ReadonlyArray<RoomBoardNote>,
  viewKey?: string,
  {
    messages = [],
    onCursor,
    onUseNote,
    onTakeTask,
  }: {
    readonly messages?: ComponentProps<typeof RoomBoard>["messages"];
    readonly onCursor?: ComponentProps<typeof RoomBoard>["onCursor"];
    readonly onUseNote?: ComponentProps<typeof RoomBoard>["onUseNote"];
    readonly onTakeTask?: ComponentProps<typeof RoomBoard>["onTakeTask"];
  } = {},
) {
  const onChange = vi.fn(async (_change: RoomBoardChange) => true);
  const screen = render(
    <RoomBoard
      title="Launch"
      room={{ messages: [], board: { positions: {}, notes: [...notes] } }}
      viewKey={viewKey}
      online={[]}
      messages={messages}
      viewer={null}
      ownerName={undefined}
      cursorLayer={null}
      onOpenThread={() => {}}
      onOpenReply={() => {}}
      onChange={onChange}
      onCursor={onCursor}
      onUseNote={onUseNote}
      onTakeTask={onTakeTask}
    />,
    { container: sizedContainer() },
  );
  return { screen, onChange };
}

/** A frame as big as the board, so the mouse reaches every card on it; put back when disposed. */
async function boardSizedViewport() {
  const was = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(1100, 800);
  return { [Symbol.asyncDispose]: () => page.viewport(was.width, was.height) };
}

/** The middle of an element, in the test frame's pixels. */
function middleOf(element: Element) {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

describe("RoomBoard comments", () => {
  it("puts the caret in a new comment, and joins it to the thread box it is dropped on", async () => {
    const board = renderBoard([{ id: "box", text: "Review", x: 500, y: 0, kind: "thread" }]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(screen.getByRole("button", { name: "Comment", exact: true }));
    const box = screen.container.querySelector('[data-board-item="note:box"]');
    const layer = screen.container.querySelector<HTMLElement>("[data-board-overlay][aria-hidden]");
    if (box === null || layer === null) throw new Error("The board did not draw the box");
    const over = box.getBoundingClientRect();
    const under = layer.getBoundingClientRect();
    await userEvent.click(layer, {
      position: {
        x: over.left + over.width / 2 - under.left,
        y: over.top + over.height / 2 - under.top,
      },
    });
    const field = screen.getByRole("textbox", { name: "Comment", exact: true });
    await expect.element(field).toHaveFocus();

    await userEvent.keyboard("Ship it?{Enter}");
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(2));
    const [put, line] = onChange.mock.calls.map(([change]) => change);
    expect(put).toMatchObject({ type: "note.put", text: "Ship it?", kind: "comment" });
    expect(line).toMatchObject({
      type: "edge.put",
      from: `note:${put?.type === "note.put" ? put.noteId : ""}`,
      to: "note:box",
    });
  });
});

describe("RoomBoard view", () => {
  it("reopens where it was left, and fits the cards when that view shows none", async () => {
    const notes = [{ id: "a", text: "First", x: 0, y: 0 }];
    rememberRoomBoardView("view-test:kept", { x: 0, y: 0, zoom: 0.5 });
    rememberRoomBoardView("view-test:away", { x: -90_000, y: -90_000, zoom: 0.5 });
    {
      await using screen = await renderBoard(notes, "view-test:kept").screen;
      await expect.element(screen.getByText("50%", { exact: true })).toBeVisible();
    }
    await using screen = await renderBoard(notes, "view-test:away").screen;
    await expect.element(screen.getByText("50%", { exact: true })).not.toBeInTheDocument();
  });
});

describe("RoomBoard sections", () => {
  it("carries the cards over a section when its title bar is dragged, and no others", async () => {
    const board = renderBoard([
      { id: "frame", text: "Plan", x: 0, y: 0, section: true, size: { w: 500, h: 400 } },
      { id: "inside", text: "In", x: 60, y: 100 },
      { id: "outside", text: "Out", x: 700, y: 100 },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const bar = screen.container.querySelector('[data-board-item="note:frame"] > div');
    if (bar === null) throw new Error("The board did not draw the section");
    const surface = screen.getByRole("application", { name: "Room board" });
    await userEvent.dragAndDrop(bar, surface, {
      sourcePosition: { x: 400, y: 10 },
      targetPosition: { x: 600, y: 500 },
    });
    await vi.waitFor(() => {
      const moved = onChange.mock.calls.flatMap(([change]) =>
        change.type === "note.put" ? [change.noteId] : [],
      );
      expect(moved.toSorted()).toEqual(["frame", "inside"]);
    });
  });
});

describe("RoomBoard selection", () => {
  it("duplicates the selection with Ctrl+D, as new notes clear of the originals", async () => {
    const board = renderBoard([
      { id: "a", text: "First", x: 0, y: 0 },
      { id: "b", text: "Second", x: 300, y: 0 },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const surface = screen.getByRole("application", { name: "Room board" });
    await userEvent.click(surface, { position: { x: 900, y: 600 } });
    await userEvent.keyboard("{Shift>}");
    for (const id of ["a", "b"]) {
      const header = screen.container.querySelector(`[data-board-item="note:${id}"] > div`);
      if (header === null) throw new Error(`The board did not draw note ${id}`);
      await userEvent.click(header);
    }
    await userEvent.keyboard("{/Shift}{Control>}d{/Control}");
    await vi.waitFor(() => {
      const added = onChange.mock.calls.flatMap(([change]) =>
        change.type === "note.put" ? [change] : [],
      );
      expect(added.map((change) => change.text).toSorted()).toEqual(["First", "Second"]);
      for (const change of added) expect(["a", "b"]).not.toContain(change.noteId);
      // Clear of the originals, which sit in a row 492 wide and a note high from the origin.
      for (const change of added) {
        expect(change.y + 100 <= 0 || change.y >= 100 || change.x >= 492).toBe(true);
      }
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent("2 selected");
  });

  it("colours every selected note at once from the selection bar", async () => {
    const board = renderBoard([
      { id: "a", text: "First", x: 0, y: 0 },
      { id: "b", text: "Second", x: 300, y: 0, color: "blue" },
      { id: "t", text: "Task", x: 600, y: 0, kind: "task" },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(screen.getByRole("application", { name: "Room board" }), {
      position: { x: 900, y: 600 },
    });
    await userEvent.keyboard("{Shift>}");
    for (const id of ["a", "b", "t"]) {
      const header = screen.container.querySelector(`[data-board-item="note:${id}"] > div`);
      if (header === null) throw new Error(`The board did not draw note ${id}`);
      await userEvent.click(header);
    }
    await userEvent.keyboard("{/Shift}");
    const picker = screen.container.querySelector<HTMLElement>(
      '[data-board-overlay] button[aria-label^="Colour"]',
    );
    if (picker === null) throw new Error("The selection bar has no colour control");
    await userEvent.click(picker);
    await userEvent.click(page.getByRole("menuitemradio", { name: "Green" }));
    await vi.waitFor(() => {
      const coloured = onChange.mock.calls.flatMap(([change]) =>
        change.type === "note.put" && change.color === "green" ? [change.noteId] : [],
      );
      expect(coloured.toSorted()).toEqual(["a", "b"]);
    });
  });

  it("selects with Shift-clicks without selecting the page's text, and drags the group", async () => {
    const board = renderBoard([
      { id: "a", text: "First", x: 0, y: 0 },
      { id: "b", text: "Second", x: 300, y: 0 },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const header = (id: string) => {
      const element = screen.container.querySelector(`[data-board-item="note:${id}"] > div`);
      if (element === null) throw new Error(`The board did not draw note ${id}`);
      return element;
    };
    const surface = screen.getByRole("application", { name: "Room board" });
    await userEvent.click(surface, { position: { x: 900, y: 600 } });
    await userEvent.keyboard("{Shift>}");
    await userEvent.click(header("a"));
    await userEvent.click(header("b"));
    await userEvent.keyboard("{/Shift}");
    await expect.element(screen.getByRole("status")).toHaveTextContent("2 selected");
    expect(window.getSelection()?.toString()).toBe("");

    await userEvent.dragAndDrop(header("a"), surface, {
      sourcePosition: { x: 20, y: 6 },
      targetPosition: { x: 600, y: 500 },
    });
    await vi.waitFor(() => {
      const moved = onChange.mock.calls.flatMap(([change]) =>
        change.type === "note.put" ? [change] : [],
      );
      expect(moved.map((change) => change.noteId).toSorted()).toEqual(["a", "b"]);
      for (const change of moved) expect(change.y).toBeGreaterThan(100);
    });
  });
});

describe("RoomBoard clicks", () => {
  const notes: ReadonlyArray<RoomBoardNote> = [
    { id: "a", text: "First", x: 0, y: 0 },
    { id: "b", text: "Second", x: 300, y: 0 },
    { id: "c", text: "Third", x: 0, y: 300 },
  ];
  const headerIn = (container: HTMLElement, id: string) => {
    const element = container.querySelector(`[data-board-item="note:${id}"] > div`);
    if (element === null) throw new Error(`The board did not draw note ${id}`);
    return element;
  };
  const selectWithShift = async (container: HTMLElement, ids: ReadonlyArray<string>) => {
    await userEvent.keyboard("{Shift>}");
    for (const id of ids) await userEvent.click(headerIn(container, id));
    await userEvent.keyboard("{/Shift}");
  };

  it("selects a card alone with a plain click, and lets go of it on a click on the empty board", async () => {
    const board = renderBoard(notes);
    await using screen = await board.screen;
    await selectWithShift(screen.container, ["a", "b"]);
    await expect.element(screen.getByRole("status")).toHaveTextContent("2 selected");

    await userEvent.click(headerIn(screen.container, "c"));
    await expect.element(screen.getByRole("status")).toHaveTextContent("1 selected");
    await userEvent.click(screen.getByRole("application", { name: "Room board" }), {
      position: { x: 900, y: 600 },
    });
    await expect.element(screen.getByRole("status")).not.toBeInTheDocument();
  });

  it("drags a card from outside the selection alone, and makes it the selection", async () => {
    const board = renderBoard(notes);
    const { onChange } = board;
    await using screen = await board.screen;
    await selectWithShift(screen.container, ["a", "b"]);
    await userEvent.dragAndDrop(
      headerIn(screen.container, "c"),
      screen.getByRole("application", { name: "Room board" }),
      { sourcePosition: { x: 20, y: 6 }, targetPosition: { x: 700, y: 500 } },
    );
    await vi.waitFor(() => {
      const moved = onChange.mock.calls.flatMap(([change]) =>
        change.type === "note.put" ? [change.noteId] : [],
      );
      expect(moved).toEqual(["c"]);
    });
    await expect.element(screen.getByRole("status")).toHaveTextContent("1 selected");
  });

  it("deletes the one card a click selected with Delete, asked twice", async () => {
    const board = renderBoard(notes);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(headerIn(screen.container, "b"));
    await userEvent.keyboard("{Delete}");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ type: "note.remove", noteId: "b" }),
    );
  });
});

describe("RoomBoard drags", () => {
  const itemIn = (container: HTMLElement, ref: string) => {
    const element = container.querySelector<HTMLElement>(`[data-board-item="${ref}"]`);
    if (element === null) throw new Error(`The board did not draw ${ref}`);
    return element;
  };
  // A spot on a note's header clear of its buttons.
  const gripOf = (container: HTMLElement, id: string) => {
    const header = itemIn(container, `note:${id}`).firstElementChild;
    if (header === null) throw new Error(`Note ${id} has no header`);
    const rect = header.getBoundingClientRect();
    return { x: rect.left + 20, y: rect.top + rect.height / 2 };
  };

  it("moves the thread's card from its text, and takes a drag on the selection bar, selecting no text", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([{ id: "a", text: "First", x: 600, y: 300 }], undefined, {
      messages: [
        { id: "m1", author: "Ann", text: "A reply long enough to select across the board" },
      ],
    });
    const { onChange } = board;
    await using screen = await board.screen;
    const from = middleOf(screen.getByText("A reply long enough", { exact: false }).element());
    const to = { x: from.x + 150, y: from.y + 120 };
    await commands.mouse([
      { type: "down", ...from },
      { type: "move", ...to },
      { type: "up", ...to },
    ]);
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "card.move", cardId: "thread" }),
      ),
    );
    expect(window.getSelection()?.toString()).toBe("");

    await userEvent.click(itemIn(screen.container, "note:a").firstElementChild!);
    const bar = middleOf(screen.getByRole("status").element());
    await commands.mouse([
      { type: "down", ...bar },
      { type: "move", x: bar.x - 300, y: bar.y + 300 },
      { type: "up", x: bar.x - 300, y: bar.y + 300 },
    ]);
    expect(window.getSelection()?.toString()).toBe("");
  });

  it("puts a card back when Escape is pressed mid-drag, sending nothing and ending others' view of it", async () => {
    await using _viewport = await boardSizedViewport();
    const onCursor = vi.fn();
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }], undefined, { onCursor });
    const { onChange } = board;
    await using screen = await board.screen;
    const from = gripOf(screen.container, "a");
    await commands.mouse([
      { type: "down", ...from },
      { type: "move", x: from.x + 200, y: from.y + 150 },
      { type: "move", x: from.x + 220, y: from.y + 160 },
    ]);
    await vi.waitFor(() =>
      expect(onCursor).toHaveBeenCalledWith(expect.objectContaining({ drag: expect.anything() })),
    );
    await commands.mouse([
      { type: "key", key: "Escape" },
      { type: "move", x: from.x + 260, y: from.y + 200 },
      { type: "up", x: from.x + 260, y: from.y + 200 },
    ]);
    await vi.waitFor(() => expect(onCursor.mock.lastCall?.[0]?.drag).toBeUndefined());
    expect(onCursor.mock.calls.some(([presence]) => presence?.drag?.done === true)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    const note = itemIn(screen.container, "note:a");
    expect([note.style.left, note.style.top]).toEqual(["0px", "0px"]);
  });

  it("drops a resize and a line being drawn when Escape is pressed", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([
      { id: "a", text: "First", x: 0, y: 0 },
      { id: "b", text: "Second", x: 400, y: 0 },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const note = itemIn(screen.container, "note:a");
    const corner = middleOf(note.querySelectorAll("div[data-board-grip]")[1]!);
    await commands.mouse([
      { type: "down", ...corner },
      { type: "move", x: corner.x + 120, y: corner.y + 90 },
      { type: "key", key: "Escape" },
      { type: "up", x: corner.x + 140, y: corner.y + 100 },
    ]);
    expect(note.style.width).toBe("");

    const grip = middleOf(note.querySelector('button[aria-label="Draw a line"]')!);
    const other = middleOf(itemIn(screen.container, "note:b"));
    await commands.mouse([
      { type: "down", ...grip },
      { type: "move", ...other },
      { type: "key", key: "Escape" },
      { type: "up", ...other },
    ]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says what dropping a note on the thread's card does, and moves a note there that it would do nothing for", async () => {
    await using _viewport = await boardSizedViewport();
    const onUseNote = vi.fn();
    const board = renderBoard(
      [
        { id: "a", text: "Ship it", x: 600, y: 0 },
        { id: "e", text: "", x: 600, y: 300 },
      ],
      undefined,
      { onUseNote },
    );
    const { onChange } = board;
    await using screen = await board.screen;
    const thread = itemIn(screen.container, "card:thread");
    const over = middleOf(thread);
    await commands.mouse([
      { type: "down", ...gripOf(screen.container, "a") },
      { type: "move", ...over },
    ]);
    await vi.waitFor(() => expect(thread.textContent).toContain("Use as message"));
    await commands.mouse([{ type: "up", ...over }]);
    await vi.waitFor(() => expect(onUseNote).toHaveBeenCalledWith("Ship it"));
    expect(onChange).not.toHaveBeenCalled();

    await commands.mouse([
      { type: "down", ...gripOf(screen.container, "e") },
      { type: "move", ...over },
    ]);
    expect(thread.textContent).not.toContain("Use as message");
    await commands.mouse([{ type: "up", ...over }]);
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note.put", noteId: "e" }),
      ),
    );
  });
});

describe("RoomBoard selection bar", () => {
  it("sits just above the selected card, and steps away while it is dragged", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([
      { id: "a", text: "First", x: 0, y: 0 },
      { id: "b", text: "Second", x: 400, y: 400 },
    ]);
    await using screen = await board.screen;
    const note = screen.container.querySelector('[data-board-item="note:b"]');
    if (note === null || note.firstElementChild === null) throw new Error("No note b");
    await userEvent.click(note.firstElementChild);
    const status = screen.getByRole("status");
    await expect.element(status).toHaveTextContent("1 selected");
    const bar = status.element().closest<HTMLElement>("[data-board-overlay]");
    if (bar === null) throw new Error("The status is not on the selection bar");
    const card = note.getBoundingClientRect();
    const placed = bar.getBoundingClientRect();
    expect(placed.bottom).toBeLessThanOrEqual(card.top);
    expect(card.top - placed.bottom).toBeLessThan(16);
    expect(placed.left < card.right && card.left < placed.right).toBe(true);

    const header = note.firstElementChild.getBoundingClientRect();
    const from = { x: header.left + 20, y: header.top + header.height / 2 };
    await commands.mouse([
      { type: "down", ...from },
      { type: "move", x: from.x - 100, y: from.y - 100 },
    ]);
    await expect.element(bar).not.toBeVisible();
    await commands.mouse([{ type: "up", x: from.x - 100, y: from.y - 100 }]);
    await expect.element(bar).toBeVisible();
  });
});

describe("RoomBoard keys and pointer", () => {
  const headerIn = (container: HTMLElement, id: string) => {
    const element = container.querySelector(`[data-board-item="note:${id}"] > div`);
    if (element === null) throw new Error(`The board did not draw note ${id}`);
    return element;
  };
  const puts = (onChange: { mock: { calls: Array<[RoomBoardChange]> } }) =>
    onChange.mock.calls.flatMap(([change]) => (change.type === "note.put" ? [change] : []));

  it("nudges the selection with the arrow keys, sends it once they stop, and undoes it in one step", async () => {
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(headerIn(screen.container, "a"));
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{Shift>}{ArrowDown}{/Shift}");
    await vi.waitFor(() => expect(puts(onChange)).toHaveLength(1));
    expect(puts(onChange)[0]).toMatchObject({ noteId: "a", x: 8, y: 40 });

    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(puts(onChange)).toHaveLength(2));
    expect(puts(onChange)[1]).toMatchObject({ noteId: "a", x: 0, y: 0 });
  });

  it("adds a note where the empty board is double-clicked, ready to write in", async () => {
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.dblClick(screen.getByRole("application", { name: "Room board" }), {
      position: { x: 300, y: 600 },
    });
    await vi.waitFor(() => expect(puts(onChange)).toHaveLength(1));
    const [added] = puts(onChange);
    expect(added).toMatchObject({ text: "" });
    expect(added?.y).toBeGreaterThan(100);
    await expect
      .element(screen.getByRole("textbox", { name: "Note", exact: true }).last())
      .toHaveFocus();
  });

  it("pastes copies of the copied cards, and a note of text copied elsewhere", async () => {
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0, color: "blue" }]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(headerIn(screen.container, "a"));
    const surface = screen.getByRole("application", { name: "Room board" }).element();
    const clipboard = new DataTransfer();
    surface.dispatchEvent(
      new ClipboardEvent("copy", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
    expect(clipboard.getData("text/plain")).toBe("First");
    surface.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(puts(onChange)).toHaveLength(1));
    expect(puts(onChange)[0]).toMatchObject({ text: "First", color: "blue" });
    expect(puts(onChange)[0]?.noteId).not.toBe("a");

    const elsewhere = new DataTransfer();
    elsewhere.setData("text/plain", "From another app");
    surface.dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: elsewhere, bubbles: true, cancelable: true }),
    );
    await vi.waitFor(() => expect(puts(onChange)).toHaveLength(2));
    expect(puts(onChange)[1]).toMatchObject({ text: "From another app" });
  });

  it("selects every card with Ctrl+A", async () => {
    const board = renderBoard([
      { id: "a", text: "First", x: 0, y: 0 },
      { id: "b", text: "Second", x: 300, y: 0 },
    ]);
    await using screen = await board.screen;
    await userEvent.click(screen.getByRole("application", { name: "Room board" }), {
      position: { x: 900, y: 600 },
    });
    await userEvent.keyboard("{Control>}a{/Control}");
    // The two notes and the thread's own card.
    await expect.element(screen.getByRole("status")).toHaveTextContent("3 selected");
  });

  it("keeps a card's resize grips on its corners, so a press just beside it is the board's", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }]);
    await using screen = await board.screen;
    const note = screen.container.querySelector('[data-board-item="note:a"]');
    if (note === null) throw new Error("The board did not draw the note");
    const rect = note.getBoundingClientRect();
    const grip = (x: number, y: number) =>
      document.elementFromPoint(x, y)?.closest("[data-board-grip]") ?? null;
    expect(grip(rect.right - 3, rect.bottom - 3)).not.toBeNull();
    expect(grip(rect.right + 8, rect.bottom + 8)).toBeNull();
    expect(grip(rect.left - 8, rect.bottom + 8)).toBeNull();
  });

  it("folds a small card's header buttons into one menu", async () => {
    rememberRoomBoardView("compact-test", { x: 0, y: 0, zoom: 0.6 });
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }], "compact-test", {
      onUseNote: () => {},
    });
    await using screen = await board.screen;
    await expect.element(screen.getByRole("button", { name: "Card actions" })).toBeVisible();
    await expect
      .element(screen.getByRole("button", { name: "Use as message" }))
      .not.toBeInTheDocument();
  });
});

describe("RoomBoard controls", () => {
  it("offers to take a task to the owner's agent only when it is not someone else's", async () => {
    const board = renderBoard(
      [
        { id: "open", text: "Fix login", x: 0, y: 0, kind: "task" },
        { id: "mine", text: "Ship it", x: 300, y: 0, kind: "task", assignee: {} },
        {
          id: "theirs",
          text: "Write docs",
          x: 600,
          y: 0,
          kind: "task",
          assignee: { guestId: GuestId.make("sam") },
        },
      ],
      undefined,
      { onTakeTask: () => {} },
    );
    await using screen = await board.screen;
    await expect
      .element(screen.getByRole("button", { name: "Take it to my agent" }).nth(1))
      .toBeVisible();
    expect(screen.getByRole("button", { name: "Take it to my agent" }).elements()).toHaveLength(2);
  });

  it("says why Artifact is off on a board that holds all the artifacts it can", async () => {
    const board = renderBoard(
      Array.from({ length: ROOM_BOARD_MAX_ARTIFACTS }, (_, index) => ({
        id: `art${index}`,
        text: "",
        x: index * 400,
        y: 0,
        kind: "artifact" as const,
      })),
    );
    await using screen = await board.screen;
    const artifact = screen.getByRole("button", { name: "Artifact", exact: true });
    await expect.element(artifact).toBeDisabled();
    await userEvent.hover(artifact.element().parentElement!);
    await expect
      .element(page.getByText(`The board holds ${ROOM_BOARD_MAX_ARTIFACTS} artifacts at most`))
      .toBeVisible();
  });
});

describe("RoomBoard lines", () => {
  it("selects a line between two cards that sit close together", async () => {
    const board = render(
      <RoomBoard
        title="Launch"
        room={{
          messages: [],
          board: {
            positions: {},
            notes: [
              { id: "a", text: "First", x: 0, y: 0 },
              { id: "b", text: "Second", x: 212, y: 0 },
            ],
            edges: [{ id: "line", from: "note:a", to: "note:b" }],
          },
        }}
        online={[]}
        messages={[]}
        viewer={null}
        ownerName={undefined}
        cursorLayer={null}
        onOpenThread={() => {}}
        onOpenReply={() => {}}
        onChange={async () => true}
        onCursor={undefined}
        onUseNote={undefined}
      />,
      { container: sizedContainer() },
    );
    await using screen = await board;
    const rectOf = (id: string) => {
      const element = screen.container.querySelector(`[data-board-item="note:${id}"]`);
      if (element === null) throw new Error(`The board did not draw note ${id}`);
      return element.getBoundingClientRect();
    };
    const surface = screen.getByRole("application", { name: "Room board" });
    const under = surface.element().getBoundingClientRect();
    const a = rectOf("a");
    const zoom = a.width / 192;
    await userEvent.click(surface, {
      position: {
        x: (a.right + rectOf("b").left) / 2 - under.left,
        y: a.top + 12 * zoom - under.top,
      },
    });
    await expect.element(screen.getByRole("button", { name: "Delete line" })).toBeVisible();
  });
});

describe("RoomBoard live drags", () => {
  it("moves a card as someone else drags it, and keeps it where it landed", async () => {
    const board = (x: number, drag: RoomCursor["drag"]) => (
      <RoomBoard
        title="Launch"
        room={{ messages: [], board: { positions: {}, notes: [{ id: "a", text: "Hi", x, y: 0 }] } }}
        online={[]}
        messages={[]}
        viewer={null}
        ownerName={undefined}
        cursorLayer={
          <RoomCursors
            cursors={drag === undefined ? [] : [{ x: 1, y: 1, drag }]}
            views={undefined}
            guests={[]}
            ownerName="Ann"
          />
        }
        onOpenThread={() => {}}
        onOpenReply={() => {}}
        onChange={async () => true}
        onCursor={undefined}
        onUseNote={undefined}
      />
    );
    const items = [{ ref: "note:a", x: 300, y: 0 }];
    await using screen = await render(board(0, { items }), { container: sizedContainer() });
    const note = () => screen.container.querySelector<HTMLElement>('[data-board-item="note:a"]');
    await vi.waitFor(() => expect(note()?.style.transform).toBe("translate(300px, 0px)"));

    // Let go: it stays where it landed after the drag is over, until the board has it there.
    await screen.rerender(board(0, { items, done: true }));
    await screen.rerender(board(0, undefined));
    expect(note()?.style.transform).toBe("translate(300px, 0px)");
    await screen.rerender(board(300, undefined));
    await vi.waitFor(() => expect(note()?.style.transform).toBe(""));
    await vi.waitFor(() => expect(note()?.style.top).toBe("0px"));
    expect(note()?.style.left).toBe("300px");
  });
});

describe("RoomBoard live lines", () => {
  it("bends a line to follow a card someone else is dragging", async () => {
    const board = (drag: RoomCursor["drag"]) => (
      <RoomBoard
        title="Launch"
        room={{
          messages: [],
          board: {
            positions: {},
            notes: [
              { id: "a", text: "First", x: 0, y: 0 },
              { id: "b", text: "Second", x: 400, y: 0 },
            ],
            edges: [{ id: "line", from: "note:a", to: "note:b" }],
          },
        }}
        online={[]}
        messages={[]}
        viewer={null}
        ownerName={undefined}
        cursorLayer={
          <RoomCursors
            cursors={drag === undefined ? [] : [{ x: 1, y: 1, drag }]}
            views={undefined}
            guests={[]}
            ownerName="Ann"
          />
        }
        onOpenThread={() => {}}
        onOpenReply={() => {}}
        onChange={async () => true}
        onCursor={undefined}
        onUseNote={undefined}
      />
    );
    await using screen = await render(board(undefined), { container: sizedContainer() });
    const line = () =>
      screen.container.querySelector('[data-board-edge="line"]')?.getAttribute("d") ?? "";
    const still = line();
    expect(still).not.toBe("");
    await screen.rerender(board({ items: [{ ref: "note:b", x: 400, y: 300 }] }));
    await vi.waitFor(() => expect(line()).not.toBe(still));
  });
});

describe("RoomBoard note colour", () => {
  it("gives a new note the colour last picked on this device, after a reload", async () => {
    using _stored = {
      [Symbol.dispose]: () => localStorage.removeItem("t3code.roomBoardNoteColor"),
    };
    const first = renderBoard([{ id: "idea", text: "Idea", x: 0, y: 0 }]);
    {
      await using screen = await first.screen;
      await userEvent.click(screen.getByRole("button", { name: "Colour: Yellow" }));
      await userEvent.click(page.getByRole("menuitemradio", { name: "Blue" }));
    }
    const board = renderBoard([]);
    await using screen = await board.screen;
    await userEvent.click(screen.getByRole("button", { name: "Note", exact: true }));
    await vi.waitFor(() =>
      expect(board.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note.put", color: "blue" }),
      ),
    );
  });
});

describe("RoomBoard card menus", () => {
  it("takes a click on a note's colour and on a reaction", async () => {
    const board = renderBoard([{ id: "idea", text: "Idea", x: 0, y: 0 }]);
    const { onChange } = board;
    await using screen = await board.screen;

    await userEvent.click(screen.getByRole("button", { name: "Colour: Yellow" }));
    await userEvent.click(page.getByRole("menuitemradio", { name: "Green" }));
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note.put", noteId: "idea", color: "green" }),
      ),
    );
    await expect
      .element(page.getByRole("menuitemradio", { name: "Green" }))
      .not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add reaction" }));
    await userEvent.click(page.getByRole("menuitem", { name: "React 👍" }));
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ type: "note.react", noteId: "idea", emoji: "👍" }),
    );
  });
});
