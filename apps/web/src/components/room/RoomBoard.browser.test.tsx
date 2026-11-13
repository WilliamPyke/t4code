import type { RoomBoardChange } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { render } from "../../../test/render";
import "../../index.css";

import { RoomBoard } from "./RoomBoard";

function sizedContainer() {
  const container = document.createElement("div");
  container.style.cssText = "display:flex;flex-direction:column;width:1000px;height:700px";
  return container;
}

describe("RoomBoard comments", () => {
  it("puts the caret in a new comment, and joins it to the thread box it is dropped on", async () => {
    const onChange = vi.fn(async (_change: RoomBoardChange) => true);
    await using screen = await render(
      <RoomBoard
        title="Launch"
        room={{
          messages: [],
          board: {
            positions: {},
            notes: [{ id: "box", text: "Review", x: 500, y: 0, kind: "thread" }],
          },
        }}
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
