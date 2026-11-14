import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { summarizeRoomBoard } from "./RoomBoardSummary.ts";

const id = ThreadId.make("thread-1");
const now = "2026-11-13T12:00:00.000Z";
const note = (noteId: string, extra: object = {}) => ({
  id: noteId,
  text: noteId,
  x: 400,
  y: 100,
  ...extra,
});

describe("summarizeRoomBoard", () => {
  it("is null for a thread that has no board", () => {
    expect(summarizeRoomBoard({ id }, { nowIso: now, online: 0 })).toBeNull();
  });

  it("counts cards and boxes, draws sections first, and skips comments pinned to replies", () => {
    const summary = summarizeRoomBoard(
      {
        id,
        roomBoard: {
          board: {
            positions: {},
            notes: [
              note("plain", { color: "green" }),
              note("box", { kind: "thread" }),
              note("frame", { section: true, size: { w: 900, h: 600 } }),
              note("pin", { kind: "comment" }),
              note("on-reply", { pinnedTo: "message-1" }),
            ],
          },
        },
      },
      { nowIso: now, online: 3 },
    );
    expect(summary).toMatchObject({ cards: 2, agentBoxes: 2, shared: false, online: 0 });
    expect(summary?.shapes.map((shape) => shape.kind)).toEqual([
      "section",
      "thread",
      "note",
      "thread",
      "comment",
    ]);
    // The board's own thread card sits where the board puts it before anyone moves it.
    expect(summary?.shapes[1]).toMatchObject({ x: 80, y: 72, w: 320, h: 420 });
    expect(summary?.shapes[2]).toMatchObject({ w: 192, h: 144, color: "green" });
  });

  it("names the room's people and who is in only while its link lasts", () => {
    const share = (expiresAt: string) => ({
      expiresAt,
      guests: [{ name: "Ada" }, { name: "Lin" }],
      board: { positions: { thread: { x: 0, y: 0 } }, notes: [] },
    });
    const live = summarizeRoomBoard(
      { id, guestShare: share("2026-11-14T00:00:00.000Z") },
      { nowIso: now, online: 1 },
    );
    expect(live).toMatchObject({ shared: true, people: ["Ada", "Lin"], online: 1 });
    expect(live?.shapes).toEqual([{ x: 0, y: 0, w: 320, h: 420, kind: "thread" }]);
    const ended = summarizeRoomBoard(
      { id, guestShare: share("2026-11-12T00:00:00.000Z") },
      { nowIso: now, online: 1 },
    );
    expect(ended).toMatchObject({ shared: false, people: [], online: 0 });
  });
});
