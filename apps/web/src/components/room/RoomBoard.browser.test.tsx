import {
  GuestId,
  ROOM_BOARD_MAX_ARTIFACTS,
  type RoomBoardChange,
  type RoomBoardEdge,
  type RoomBoardNote,
  type RoomCursor,
} from "@t3tools/contracts";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vite-plus/test";
import { commands, page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import "../../index.css";
import { openCommandPalette } from "../../commandPaletteBus";
import { useCommandPaletteStore } from "../../commandPaletteStore";
import { CommandPalette } from "../CommandPalette";

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
    edges = [],
    takes = async () => true,
    withCommandMenu = false,
  }: {
    /** Renders the app's command menu around the board, as the app does. */
    readonly withCommandMenu?: boolean;
    readonly messages?: ComponentProps<typeof RoomBoard>["messages"];
    readonly onCursor?: ComponentProps<typeof RoomBoard>["onCursor"];
    readonly onUseNote?: ComponentProps<typeof RoomBoard>["onUseNote"];
    readonly onTakeTask?: ComponentProps<typeof RoomBoard>["onTakeTask"];
    readonly edges?: ReadonlyArray<RoomBoardEdge>;
    /** What the room says to each change; it takes every one by default. */
    readonly takes?: (change: RoomBoardChange) => Promise<boolean>;
  } = {},
) {
  const onChange = vi.fn(takes);
  // The first-run guide floats over the bottom right corner, where these tests click the board.
  localStorage.setItem(
    "t3code:board-guide:v2",
    JSON.stringify({ owner: null, hidden: true, collapsed: false, done: [] }),
  );
  const element = (
    <RoomBoard
      title="Launch"
      room={{ messages: [], board: { positions: {}, notes: [...notes], edges: [...edges] } }}
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
    />
  );
  const screen = render(withCommandMenu ? <CommandPalette>{element}</CommandPalette> : element, {
    container: sizedContainer(),
  });
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

  it("moves by its edge and, once selected, by its inside, which pans the board until then", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([
      { id: "frame", text: "Plan", x: 0, y: 0, section: true, size: { w: 500, h: 400 } },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const section = screen.container.querySelector('[data-board-item="note:frame"]');
    if (section === null) throw new Error("The board did not draw the section");
    const drag = async (from: { x: number; y: number }) => {
      await commands.mouse([
        { type: "down", ...from },
        { type: "move", x: from.x + 40, y: from.y + 30 },
        { type: "up", x: from.x + 40, y: from.y + 30 },
      ]);
    };
    const moves = () => onChange.mock.calls.filter(([change]) => change.type === "note.put").length;
    const inside = () => {
      const rect = section.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height * 0.75 };
    };
    // Not selected: the inside is the board's, so the section follows the pan and nothing is sent.
    const before = section.getBoundingClientRect().left;
    await drag(inside());
    await vi.waitFor(() =>
      expect(section.getBoundingClientRect().left).toBeCloseTo(before + 40, 0),
    );
    expect(moves()).toBe(0);

    const rect = section.getBoundingClientRect();
    // Off its middle, where the dot a line is drawn from shows.
    await drag({ x: rect.left + 1, y: rect.top + rect.height / 4 });
    await vi.waitFor(() => expect(moves()).toBe(1));
    // The drag selected it: now its inside moves it too.
    await drag(inside());
    await vi.waitFor(() => expect(moves()).toBe(2));
  });

  it("asks whether a deleted section's cards go with it, and keeps them unless told", async () => {
    const board = renderBoard([
      { id: "frame", text: "Plan", x: 0, y: 0, section: true, size: { w: 500, h: 400 } },
      { id: "inside", text: "In", x: 60, y: 100 },
      { id: "empty", text: "Later", x: 0, y: 600, section: true, size: { w: 300, h: 200 } },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const removed = () =>
      onChange.mock.calls.flatMap(([change]) =>
        change.type === "note.remove" ? [change.noteId] : [],
      );
    const remove = (id: string) => {
      const button = screen.container.querySelector<HTMLElement>(
        `[data-board-item="note:${id}"] button[aria-label="Delete section"]`,
      );
      if (button === null) throw new Error(`Section ${id} has no delete button`);
      button.click();
    };
    // An empty section goes with no question.
    remove("empty");
    await vi.waitFor(() => expect(removed()).toEqual(["empty"]));

    remove("frame");
    await expect
      .element(page.getByRole("button", { name: "Delete section and 1 card" }))
      .toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Delete section only" }));
    await vi.waitFor(() => expect(removed()).toEqual(["empty", "frame"]));
  });

  it("puts a title back on Escape, sending nothing, and saves it on Enter", async () => {
    const board = renderBoard([
      { id: "frame", text: "Plan", x: 0, y: 500, section: true, size: { w: 500, h: 300 } },
      { id: "box", text: "Review", x: 600, y: 500, kind: "thread" },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    for (const name of ["Section title", "Thread name"]) {
      const field = screen.getByRole("textbox", { name, exact: true });
      // A section's title is a field of its own; a card's title, like its text, takes a double-click.
      if (name === "Section title") await userEvent.click(field);
      else await userEvent.dblClick(field);
      await expect.element(field).toHaveFocus();
      await userEvent.keyboard(" draft{Escape}");
      await expect.element(field).not.toHaveFocus();
      await expect.element(field).toHaveValue(name === "Section title" ? "Plan" : "Review");
    }
    expect(onChange).not.toHaveBeenCalled();

    const title = screen.getByRole("textbox", { name: "Section title", exact: true });
    await userEvent.click(title);
    await userEvent.keyboard("{Control>}a{/Control}Plan B{Enter}");
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note.put", noteId: "frame", text: "Plan B" }),
      ),
    );
  });

  it("grows a section from its own size when its corner is dragged", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([
      { id: "frame", text: "Plan", x: 0, y: 0, section: true, size: { w: 640, h: 420 } },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const section = screen.container.querySelector('[data-board-item="note:frame"]');
    if (section === null) throw new Error("The board did not draw the section");
    const zoom = section.getBoundingClientRect().width / 640;
    const corner = middleOf(
      section.querySelectorAll("div[data-board-grip]:not([data-board-frame-edge])")[1]!,
    );
    // Ctrl held: the edges go where the pointer puts them, not to the thread card's.
    await commands.mouse([
      { type: "down", ...corner },
      { type: "keydown", key: "Control" },
      { type: "move", x: corner.x + 100, y: corner.y + 60 },
      { type: "up", x: corner.x + 100, y: corner.y + 60 },
      { type: "keyup", key: "Control" },
    ]);
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note.put", noteId: "frame" }),
      ),
    );
    const put = onChange.mock.lastCall?.[0];
    if (put?.type !== "note.put") throw new Error("The section's size was not sent");
    expect(put.size?.w).toBeCloseTo(640 + 100 / zoom, -1);
    expect(put.size?.h).toBeCloseTo(420 + 60 / zoom, -1);

    // Its top-left corner moves its origin and resizes it in one change, so one step to undo.
    const sent = onChange.mock.calls.length;
    const grip = section
      .querySelectorAll("div[data-board-grip]:not([data-board-frame-edge])")[2]!
      .getBoundingClientRect();
    // The part of the corner left of the title that sits above it.
    const topLeft = { x: grip.left + 2, y: grip.bottom - 2 };
    await commands.mouse([
      { type: "down", ...topLeft },
      { type: "keydown", key: "Control" },
      { type: "move", x: topLeft.x - 50, y: topLeft.y - 30 },
      { type: "up", x: topLeft.x - 50, y: topLeft.y - 30 },
      { type: "keyup", key: "Control" },
    ]);
    await vi.waitFor(() => expect(onChange.mock.calls.length).toBe(sent + 1));
    const moved = onChange.mock.lastCall?.[0];
    if (moved?.type !== "note.put") throw new Error("The section's resize was not sent");
    expect(moved.x).toBeCloseTo(-50 / zoom, -1);
    expect(moved.y).toBeCloseTo(-30 / zoom, -1);
    expect(moved.size?.w).toBeCloseTo((put.size?.w ?? 0) + 50 / zoom, -1);
    expect(moved.size?.h).toBeCloseTo((put.size?.h ?? 0) + 30 / zoom, -1);
  });
});

describe("RoomBoard selection", () => {
  it("duplicates the selection with Ctrl+D, a small step right and down from the originals", async () => {
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
      // As in FigJam: each copy just off its original, the view left where it was.
      expect(added.map(({ x, y }) => ({ x, y })).toSorted((p, q) => p.x - q.x)).toEqual([
        { x: 24, y: 24 },
        { x: 324, y: 24 },
      ]);
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

  it("tidies the selection where it is, and groups it in a section without moving it", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([
      { id: "a", text: "First", x: 600, y: 500 },
      { id: "b", text: "Second", x: 900, y: 520 },
      { id: "c", text: "Third", x: 620, y: 700 },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.keyboard("{Shift>}");
    for (const id of ["a", "b", "c"]) {
      const header = screen.container.querySelector(`[data-board-item="note:${id}"] > div`);
      if (header === null) throw new Error(`The board did not draw note ${id}`);
      await userEvent.click(header);
    }
    await userEvent.keyboard("{/Shift}");
    await userEvent.click(screen.getByRole("button", { name: "Tidy" }));
    const moved = () =>
      onChange.mock.calls.flatMap(([change]) => (change.type === "note.put" ? [change] : []));
    await vi.waitFor(() => expect(moved()).toHaveLength(3));
    expect(Math.min(...moved().map((change) => change.x))).toBe(600);
    expect(Math.min(...moved().map((change) => change.y))).toBe(500);

    await userEvent.click(screen.getByRole("button", { name: "Group in a section" }));
    await vi.waitFor(() => expect(moved()).toHaveLength(4));
    expect(moved()[3]).toMatchObject({ section: true, x: 568, y: 428 });
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

  it("adds a card to the selection with Ctrl-click, and keeps a selected note out of its text on a click", async () => {
    const board = renderBoard(notes);
    await using screen = await board.screen;
    await userEvent.click(headerIn(screen.container, "a"));
    await userEvent.keyboard("{Control>}");
    await userEvent.click(headerIn(screen.container, "b"));
    await userEvent.keyboard("{/Control}");
    await expect.element(screen.getByRole("status")).toHaveTextContent("2 selected");

    // A second click on a note selected alone leaves it selected, so Delete takes the note.
    const text = () => {
      const field = screen.container.querySelector<HTMLTextAreaElement>(
        '[data-board-item="note:c"] textarea',
      );
      if (field === null) throw new Error("The board did not draw note c's text");
      return field;
    };
    await userEvent.click(text());
    await userEvent.click(text());
    await expect.element(text()).not.toHaveFocus();
    await userEvent.dblClick(text());
    await expect.element(text()).toHaveFocus();
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

  it("deletes a note a click selected with Delete at once, and Ctrl+Z brings it back", async () => {
    const board = renderBoard(notes);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(headerIn(screen.container, "b"));
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({ type: "note.remove", noteId: "b" }),
    );
    expect(screen.container.querySelector('[data-board-item="note:b"]')).toBeNull();
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenLastCalledWith(
        expect.objectContaining({ type: "note.put", noteId: "b", text: "Second", x: 300, y: 0 }),
      ),
    );
    await vi.waitFor(() =>
      expect(
        screen.container.querySelector<HTMLTextAreaElement>('[data-board-item="note:b"] textarea')
          ?.value,
      ).toBe("Second"),
    );
  });
});

describe("RoomBoard undo", () => {
  it("brings back the lines between notes deleted together, once the room has both notes", async () => {
    // A room that takes a line only between notes it has, and is slow to take note a back.
    const there = new Set(["a", "b"]);
    let releaseA: () => void = () => {};
    const aTaken = new Promise<void>((resolve) => {
      releaseA = resolve;
    });
    const takes = async (change: RoomBoardChange) => {
      if (change.type === "note.remove") there.delete(change.noteId);
      if (change.type === "note.put" && change.noteId === "a" && !there.has("a")) {
        await aTaken;
        there.add("a");
        return true;
      }
      if (change.type === "note.put") there.add(change.noteId);
      if (change.type === "edge.put") {
        return [change.from, change.to].every((ref) => there.has(ref.replace("note:", "")));
      }
      return true;
    };
    const board = renderBoard(
      [
        { id: "a", text: "First", x: 0, y: 0 },
        { id: "b", text: "Second", x: 300, y: 0 },
      ],
      undefined,
      { edges: [{ id: "e", from: "note:a", to: "note:b" }], takes },
    );
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(screen.getByRole("application", { name: "Room board" }), {
      position: { x: 900, y: 600 },
    });
    await userEvent.keyboard("{Control>}a{/Control}");
    await userEvent.keyboard("{Delete}");
    await vi.waitFor(() => expect(there.size).toBe(0));
    await userEvent.keyboard("{Control>}z{/Control}");
    await vi.waitFor(() => expect(there.has("b")).toBe(true));
    releaseA();
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith({
        type: "edge.put",
        edgeId: "e",
        from: "note:a",
        to: "note:b",
      }),
    );
    // Sent once, after both notes: never early, when the room would have refused it.
    const lines = onChange.mock.calls.flatMap(([change], index) =>
      change.type === "edge.put" ? [onChange.mock.results[index]?.value] : [],
    );
    expect(lines).toHaveLength(1);
    await expect(lines[0]).resolves.toBe(true);
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
    const corner = middleOf(
      note.querySelectorAll("div[data-board-grip]:not([data-board-frame-edge])")[1]!,
    );
    await commands.mouse([
      { type: "down", ...corner },
      { type: "move", x: corner.x + 120, y: corner.y + 90 },
      { type: "key", key: "Escape" },
      { type: "up", x: corner.x + 140, y: corner.y + 100 },
    ]);
    expect(note.style.width).toBe("");

    // A side's grip takes presses once its card is hovered.
    const grip = middleOf(note.querySelector("button[data-board-link]")!);
    const other = middleOf(itemIn(screen.container, "note:b"));
    await commands.mouse([
      { type: "move", ...middleOf(note) },
      { type: "move", ...grip },
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

  it("says nothing of resolved comments until one is resolved, and then counts it once", async () => {
    const comment = { id: "c", text: "Hm", x: 300, y: 300, kind: "comment" as const };
    {
      await using screen = await renderBoard([comment]).screen;
      expect(screen.container.textContent).not.toMatch(/Resolved|\(8+\)/);
    }
    await using screen = await renderBoard([{ ...comment, resolved: true }]).screen;
    expect(screen.container.textContent).not.toMatch(/\(8+\)/);
    expect(screen.container.textContent?.match(/Resolved \(1\)/g) ?? []).toHaveLength(1);
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

  it("brings the hidden first-run guide back from the board menu, and ticks a step once the board takes the note", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }]);
    await using screen = await board.screen;
    const guide = screen.getByRole("region", { name: "Getting started" });
    await expect.element(guide).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Board menu" }));
    await userEvent.click(page.getByRole("menuitem", { name: "Getting started" }));
    await expect.element(guide).toBeVisible();
    const noteStep = () => screen.container.querySelector('[data-board-guide-step="note"]');
    expect(noteStep()?.hasAttribute("data-done")).toBe(false);

    // The step only picks the Note tool; the note the board then takes is what ticks it.
    await userEvent.click(screen.getByRole("button", { name: "Add a note" }));
    expect(noteStep()?.hasAttribute("data-done")).toBe(false);
    const layer = screen.container.querySelector<HTMLElement>('[data-board-place="note"]');
    if (layer === null) throw new Error("The guide's step did not pick the Note tool");
    await userEvent.click(layer, { position: { x: 300, y: 250 } });
    await vi.waitFor(() => expect(noteStep()?.hasAttribute("data-done")).toBe(true));

    await userEvent.click(screen.getByRole("button", { name: "Hide getting started" }));
    await expect.element(guide).not.toBeInTheDocument();
  });

  it("adds the Note tool's note centred where the board is clicked next, at any zoom, ready to write in", async () => {
    await using _viewport = await boardSizedViewport();
    rememberRoomBoardView("place-test:zoomed", { x: 300, y: 120, zoom: 0.5 });
    for (const viewKey of [undefined, "place-test:zoomed"]) {
      const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }], viewKey);
      const { onChange } = board;
      await using screen = await board.screen;
      const surface = screen.getByRole("application", { name: "Room board" }).element();
      const drawnAt = (noteId: string) => {
        const card = screen.container.querySelector(`[data-board-item="note:${noteId}"]`);
        if (card === null) throw new Error(`The board did not draw note ${noteId}`);
        return card.getBoundingClientRect();
      };
      const expectUnder = (rect: DOMRect, point: { x: number; y: number }) => {
        expect(point.x).toBeGreaterThan(rect.left);
        expect(point.x).toBeLessThan(rect.right);
        expect(point.y).toBeGreaterThan(rect.top);
        expect(point.y).toBeLessThan(rect.bottom);
      };

      // Picking the tool adds nothing; the next click adds the note there.
      await userEvent.click(screen.getByRole("button", { name: "Note", exact: true }));
      expect(onChange).not.toHaveBeenCalled();
      const layer = screen.container.querySelector<HTMLElement>('[data-board-place="note"]');
      if (layer === null) throw new Error("The Note tool did not wait for a click");
      const box = layer.getBoundingClientRect();
      const clicked = { x: box.left + 600, y: box.top + 250 };
      await userEvent.click(layer, { position: { x: 600, y: 250 } });
      await vi.waitFor(() => expect(puts(onChange)).toHaveLength(1));
      const placed = puts(onChange)[0]!.noteId;
      expectUnder(drawnAt(placed), clicked);
      const field = screen.getByRole("textbox", { name: "Note", exact: true }).last();
      await expect.element(field).toHaveFocus();
      await userEvent.keyboard("Ship it now");
      await expect.element(field).toHaveValue("Ship it now");
      expect(new Set(puts(onChange).map((change) => change.noteId)).size).toBe(1);

      // Escape puts a picked tool down.
      await userEvent.click(screen.getByRole("button", { name: "Task", exact: true }));
      await userEvent.keyboard("{Escape}");
      await vi.waitFor(() =>
        expect(screen.container.querySelector("[data-board-place]")).toBeNull(),
      );

      // N adds a note under the pointer at once.
      const pointed = surface.getBoundingClientRect();
      await userEvent.click(surface, { position: { x: 150, y: 500 } });
      await userEvent.keyboard("n");
      await vi.waitFor(() =>
        expect(puts(onChange).find((change) => change.noteId !== placed)).toBeDefined(),
      );
      expectUnder(drawnAt(puts(onChange).find((change) => change.noteId !== placed)!.noteId), {
        x: pointed.left + 150,
        y: pointed.top + 500,
      });

      // The Task tool's task lands under the click as well, with the caret in it.
      await userEvent.click(screen.getByRole("button", { name: "Task", exact: true }));
      const taskLayer = screen.container.querySelector<HTMLElement>('[data-board-place="task"]');
      if (taskLayer === null) throw new Error("The Task tool did not wait for a click");
      const taskBox = taskLayer.getBoundingClientRect();
      await userEvent.click(taskLayer, { position: { x: 420, y: 330 } });
      await vi.waitFor(() =>
        expect(puts(onChange).find((change) => change.kind === "task")).toBeDefined(),
      );
      expectUnder(drawnAt(puts(onChange).find((change) => change.kind === "task")!.noteId), {
        x: taskBox.left + 420,
        y: taskBox.top + 330,
      });
      await expect
        .element(screen.getByRole("textbox", { name: "Task", exact: true }).last())
        .toHaveFocus();

      // A tap at the surface's very edge lands the card inside the view, under no chrome.
      await userEvent.click(screen.getByRole("button", { name: "Note", exact: true }));
      const edgeLayer = screen.container.querySelector<HTMLElement>('[data-board-place="note"]');
      if (edgeLayer === null) throw new Error("The Note tool did not wait for a click");
      const edgeBox = edgeLayer.getBoundingClientRect();
      const had = new Set(puts(onChange).map((change) => change.noteId));
      await userEvent.click(edgeLayer, { position: { x: 300, y: 2 } });
      await vi.waitFor(() =>
        expect(puts(onChange).some((change) => !had.has(change.noteId))).toBe(true),
      );
      const edged = drawnAt(puts(onChange).find((change) => !had.has(change.noteId))!.noteId);
      expect(edged.top).toBeGreaterThanOrEqual(edgeBox.top);
      expect(edged.bottom).toBeLessThanOrEqual(edgeBox.bottom);
    }
  });

  it("lets go of a selection when the view changes, sets a priority from the Plan's bar beside its filters, and opens the shortcuts there with ?", async () => {
    await using _viewport = await boardSizedViewport();
    const board = renderBoard([
      { id: "a", text: "First", x: 0, y: 0 },
      { id: "t", text: "Ship", x: 300, y: 300, kind: "task" },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    const view = (name: string) =>
      screen.getByRole("group", { name: "View" }).getByRole("button", { name });
    await userEvent.click(headerIn(screen.container, "a"));
    await expect.element(screen.getByText("1 selected")).toBeInTheDocument();

    await userEvent.click(view("Plan"));
    await expect.element(screen.getByText("1 selected")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Task: Ship" }));
    await expect.element(screen.getByText("1 selected")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Hide done" })).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Priority", exact: true }));
    await userEvent.click(page.getByRole("menuitem", { name: "High" }));
    await vi.waitFor(() =>
      expect(puts(onChange).at(-1)).toMatchObject({ noteId: "t", priority: "high" }),
    );

    await userEvent.click(view("List"));
    await expect.element(screen.getByText("1 selected")).not.toBeInTheDocument();
    await userEvent.keyboard("?");
    await expect.element(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(view("Board"));
  });

  it("puts a note added from the toolbar by key into the section last clicked, and a Section where clicked", async () => {
    const board = renderBoard([
      // Below the thread's own card and the places kept for guests' cards.
      { id: "frame", text: "Plan", x: 500, y: 500, section: true, size: { w: 640, h: 420 } },
    ]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(headerIn(screen.container, "frame"), { position: { x: 300, y: 10 } });
    screen.getByRole("button", { name: "Note", exact: true }).element().focus();
    await userEvent.keyboard("{Enter}");
    await vi.waitFor(() => expect(puts(onChange)).toHaveLength(1));
    const note = puts(onChange)[0]!;
    expect(note.x).toBeGreaterThanOrEqual(500);
    expect(note.y).toBeGreaterThanOrEqual(540);
    expect(note.x + 192).toBeLessThanOrEqual(1_140);
    expect(note.y).toBeLessThanOrEqual(920);

    await userEvent.click(screen.getByRole("button", { name: "Section", exact: true }));
    const layer = screen.container.querySelector<HTMLElement>('[data-board-place="section"]');
    if (layer === null) throw new Error("The Section tool did not wait for a click");
    await userEvent.click(layer, { position: { x: 200, y: 200 } });
    await expect
      .element(screen.getByRole("textbox", { name: "Section title" }).last())
      .toHaveFocus();
  });

  it("gives the board its keys back after a toolbar button is clicked", async () => {
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }]);
    const { onChange } = board;
    await using screen = await board.screen;
    await userEvent.click(headerIn(screen.container, "a"));
    await userEvent.click(screen.getByRole("button", { name: "Fit" }));
    await userEvent.keyboard("{ArrowRight}");
    await vi.waitFor(() => expect(puts(onChange)).toHaveLength(1));
    expect(puts(onChange)[0]).toMatchObject({ noteId: "a", x: 4 });
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

  it("keeps a card's resize grips on its edges and corners, so a press just beside it is the board's", async () => {
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
    // Every side and the top corners too, clear of the line grip in a side's middle.
    const quarter = rect.top + rect.height / 4;
    expect(grip(rect.left + 2, rect.top + 2)).not.toBeNull();
    expect(grip(rect.right - 2, quarter)).not.toBeNull();
    expect(grip(rect.left + 2, quarter)).not.toBeNull();
    expect(grip(rect.left + rect.width / 4, rect.top + 2)).not.toBeNull();
    expect(grip(rect.left + rect.width / 4, rect.bottom - 2)).not.toBeNull();
    expect(grip(rect.right + 6, quarter)).toBeNull();
    expect(grip(rect.right - 10, quarter)).toBeNull();
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
    // A task's actions are in its menu, not buttons on the card a click could land on.
    await expect
      .element(screen.getByRole("button", { name: "Take it to my agent" }))
      .not.toBeInTheDocument();
    const offered = async (id: string) => {
      const trigger = screen.container.querySelector(
        `[data-board-item="note:${id}"] [aria-label="Card actions"]`,
      );
      if (!(trigger instanceof HTMLElement)) throw new Error(`No menu on task ${id}`);
      await userEvent.click(trigger);
      await expect.element(page.getByRole("menuitem", { name: "Delete card" })).toBeVisible();
      const take = page.getByRole("menuitem", { name: "Take it to my agent" }).query() !== null;
      await userEvent.keyboard("{Escape}");
      await expect.element(page.getByRole("menu")).not.toBeInTheDocument();
      return take;
    };
    expect([await offered("open"), await offered("mine"), await offered("theirs")]).toEqual([
      true,
      true,
      false,
    ]);
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

describe("RoomBoard notes and agents", () => {
  it("says which notes an agent is done with, and arms one to go again only when asked", async () => {
    const at = "2026-11-13T10:00:00.000Z";
    const board = renderBoard(
      [
        { id: "fix", text: "Bigger title", x: 0, y: 0 },
        { id: "new", text: "Dark mode", x: 260, y: 0 },
      ],
      undefined,
      {
        edges: [
          { id: "fix>thread", from: "note:fix", to: "card:thread", sentAt: at, doneAt: at },
          { id: "new>thread", from: "note:new", to: "card:thread" },
        ],
      },
    );
    const { onChange } = board;
    await using screen = await board.screen;
    const standing = (id: string) =>
      screen.container
        .querySelector(`[data-board-item="note:${id}"] [data-note-agent]`)
        ?.getAttribute("data-note-agent");
    await vi.waitFor(() => expect(standing("fix")).toBe("done"));
    expect(standing("new")).toBe("going");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Not fixed, send again" }));
    await vi.waitFor(() =>
      expect(onChange.mock.calls).toEqual([[{ type: "edge.resend", edgeId: "fix>thread" }]]),
    );
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
    await userEvent.click(surface, {
      position: {
        x: (a.right + rectOf("b").left) / 2 - under.left,
        y: (a.top + a.bottom) / 2 - under.top,
      },
    });
    await expect.element(screen.getByRole("button", { name: "Delete line" })).toBeVisible();
  });

  it("focuses the link field when it opens, and Escape closes it back to the board", async () => {
    const board = renderBoard([{ id: "a", text: "First", x: 0, y: 0 }]);
    await using screen = await board.screen;
    await userEvent.click(screen.getByRole("button", { name: "Link" }));
    const field = screen.getByRole("textbox", { name: "Link" });
    await expect.element(field).toBeVisible();
    await vi.waitFor(() => {
      if (document.activeElement !== field.element()) {
        throw new Error("the link field is not focused");
      }
    });
    await userEvent.keyboard("{Escape}");
    await expect.element(field).not.toBeInTheDocument();
    await vi.waitFor(() => {
      const surface = screen.getByRole("application", { name: "Room board" }).element();
      if (document.activeElement !== surface) throw new Error("the board is not focused");
    });
  });

  it("selects a line 6px off the line, where a card's grip band covers it", async () => {
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
    // The card's east grip band reaches a couple of px past its edge, over the line's
    // hit path; 6px off the line the press is the line's, never a resize's.
    await userEvent.click(surface, {
      position: {
        x: a.right + 1 - under.left,
        y: (a.top + a.bottom) / 2 + 6 - under.top,
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
    const layer = screen.container.querySelector<HTMLElement>('[data-board-place="note"]');
    if (layer === null) throw new Error("The Note tool did not wait for a click");
    await userEvent.click(layer, { position: { x: 400, y: 300 } });
    await vi.waitFor(() =>
      expect(board.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note.put", color: "blue" }),
      ),
    );
  });
});

describe("RoomBoard command menu", () => {
  it("runs a board command on Enter and closes on Escape, though a new card had the caret", async () => {
    useCommandPaletteStore.setState(useCommandPaletteStore.getInitialState(), true);
    const board = renderBoard([], undefined, { withCommandMenu: true });
    const { onChange } = board;
    await using screen = await board.screen;
    const menu = page.getByTestId("command-palette");
    const input = page.getByPlaceholder("Search commands, projects, and threads...");

    await userEvent.click(screen.getByRole("button", { name: "Note", exact: true }));
    const layer = screen.container.querySelector<HTMLElement>('[data-board-place="note"]');
    if (layer === null) throw new Error("The Note tool did not wait for a click");
    await userEvent.click(layer, { position: { x: 400, y: 300 } });
    // Opened while the new note still holds the caret.
    openCommandPalette({});
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("Add task");
    await expect.element(input).toHaveValue("Add task");
    await userEvent.keyboard("{Enter}");
    await expect.element(menu).not.toBeInTheDocument();
    await vi.waitFor(() =>
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ type: "note.put", kind: "task" }),
      ),
    );

    openCommandPalette({});
    await expect.element(input).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    await expect.element(menu).not.toBeInTheDocument();
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
