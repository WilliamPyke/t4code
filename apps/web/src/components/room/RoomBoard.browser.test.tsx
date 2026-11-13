import type { RoomBoardChange, RoomBoardNote, RoomCursor } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import "../../index.css";

import { RoomBoard, RoomCursors } from "./RoomBoard";
import { rememberRoomBoardView } from "./roomBoardNavigation";

function sizedContainer() {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;width:1000px;height:700px";
  return container;
}

function renderBoard(notes: ReadonlyArray<RoomBoardNote>, viewKey?: string) {
  const onChange = vi.fn(async (_change: RoomBoardChange) => true);
  const screen = render(
    <RoomBoard
      title="Launch"
      room={{ messages: [], board: { positions: {}, notes: [...notes] } }}
      viewKey={viewKey}
      online={[]}
      messages={[]}
      viewer={null}
      ownerName={undefined}
      cursorLayer={null}
      onOpenThread={() => {}}
      onOpenReply={() => {}}
      onChange={onChange}
      onCursor={undefined}
      onUseNote={undefined}
    />,
    { container: sizedContainer() },
  );
  return { screen, onChange };
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
