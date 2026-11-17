import {
  GuestId,
  ROOM_BOARD_ROOM_BOX,
  type RoomBoard,
  type RoomBoardEdge,
  type RoomBoardNote,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardBringInBox, boardCutForPrompt, boardSnapshotLink } from "./boardSnapshot.logic";
import { boardPromptContext } from "./roomBoard.logic";

const sam = GuestId.make("sam");
const lee = GuestId.make("lee");
const URL = "https://linear.app/acme/issue/ENG-1/fix-login";

const note = (id: string, fields: Partial<RoomBoardNote> = {}): RoomBoardNote => ({
  id,
  text: id,
  x: 0,
  y: 0,
  ...fields,
});
const line = (from: string, to: string, fields: Partial<RoomBoardEdge> = {}): RoomBoardEdge => ({
  id: `${from}>${to}`,
  from,
  to,
  ...fields,
});
const board = (notes: Array<RoomBoardNote>, edges: Array<RoomBoardEdge>): RoomBoard => ({
  positions: {},
  notes,
  edges,
});
const snapshot = (body: string, fields: Partial<NonNullable<RoomBoardNote["artifact"]>> = {}) =>
  note("snap", {
    kind: "artifact",
    text: "ENG-1 · Fix login",
    artifact: { body, turnId: "t1", updatedAt: "2026-11-14T10:00:00.000Z", ...fields },
  });
const people = { guests: [{ id: sam, name: "Sam" }], viewer: null };

describe("boardBringInBox", () => {
  const boxes = [
    { id: ROOM_BOARD_ROOM_BOX },
    { id: "samBox", guestId: sam },
    { id: "samSecond", guestId: sam },
    { id: "leeBox", guestId: lee },
  ];
  const link = note("link", { kind: "link", url: URL });

  it("only ever picks one of the viewer's own boxes", () => {
    // A link with nothing pointing to a box leaves it to the viewer's choice (`boardDraftBox`).
    const plain = board([link], []);
    expect(boardBringInBox(plain, boxes, sam, "link")).toBeNull();
    expect(boardBringInBox(plain, boxes, GuestId.make("kim"), "link")).toBeNull();
    // Lee's agent wrote the snapshot and the link has a line into Lee's box: never Lee's.
    const others = board(
      [link, snapshot("# Fix login", { boxId: "leeBox", guestId: lee })],
      [line("note:link", "note:snap"), line("note:link", "note:leeBox")],
    );
    expect(boardBringInBox(others, boxes, sam, "link")).toBeNull();
    const roomBox = board([link], [line("note:link", "card:thread")]);
    expect(boardBringInBox(roomBox, boxes, null, "link")).toBe(ROOM_BOARD_ROOM_BOX);
  });

  it("prefers the viewer's box that wrote the snapshot, then one the link feeds", () => {
    const fed = board([link], [line("note:link", "note:samSecond")]);
    expect(boardBringInBox(fed, boxes, sam, "link")).toBe("samSecond");
    const wrote = board(
      [link, snapshot("# Fix login", { boxId: "samSecond", guestId: sam })],
      [line("note:link", "note:snap")],
    );
    expect(boardBringInBox(wrote, boxes, sam, "link")).toBe("samSecond");
  });
});

describe("snapshots as context", () => {
  const link = note("link", { kind: "link", url: URL, text: "" });

  it("names the link card an artifact was read from", () => {
    const shown = board([link, snapshot("x")], [line("note:link", "note:snap")]);
    expect(boardSnapshotLink(shown, "snap")?.id).toBe("link");
    expect(boardSnapshotLink(board([link, snapshot("x")], []), "snap")).toBeUndefined();
  });

  it("gives a box the snapshot's content along a line from its link card", () => {
    const shown = board(
      [link, snapshot("# Fix login\n\nStatus: In progress")],
      [line("note:link", "note:snap"), line("note:link", "card:thread")],
    );
    const [card] = boardPromptContext(shown, people).cards;
    expect(card?.text).toBe(
      `ENG-1 · Fix login\n${URL}\n\nSnapshot of it, read on 2026-11-14:\n\n# Fix login\n\nStatus: In progress`,
    );
    // Without a snapshot the link card carries its address alone.
    const bare = board([link], [line("note:link", "card:thread")]);
    expect(boardPromptContext(bare, people).cards[0]?.text).toBe(`ENG-1 · Fix login\n${URL}`);
  });

  it("sends the link again once its snapshot is newer than the last send", () => {
    const sent = line("note:link", "card:thread", { sentAt: "2026-11-15T00:00:00.000Z" });
    const read = (updatedAt: string) =>
      boardPromptContext(
        board(
          [link, snapshot("# Fix login", { updatedAt })],
          [line("note:link", "note:snap"), sent],
        ),
        people,
      ).cards[0]?.status;
    expect(read("2026-11-14T00:00:00.000Z")).toBe("sent");
    expect(read("2026-11-16T00:00:00.000Z")).toBe("updated");
  });

  it("cuts a long snapshot at the cap and says it was cut, whichever line carries it", () => {
    const long = `# Fix login\n\n${"word ".repeat(2_000)}`;
    const viaLink = boardPromptContext(
      board(
        [link, snapshot(long)],
        [line("note:link", "note:snap"), line("note:link", "card:thread")],
      ),
      people,
    ).cards[0]?.text;
    const viaSnapshot = boardPromptContext(
      board(
        [link, snapshot(long)],
        [line("note:link", "note:snap"), line("note:snap", "card:thread")],
      ),
      people,
    ).cards.find((card) => card.ref === "note:snap")?.text;
    for (const text of [viaLink, viaSnapshot]) {
      expect(text).toContain("# Fix login");
      expect(text).toMatch(/\[Cut here: the rest is on the board\.\]$/);
      expect(text?.length).toBeLessThan(4_200);
    }
    expect(boardCutForPrompt("short", 10)).toBe("short");
  });

  it("does not repeat a snapshot that already goes with the prompt", () => {
    const shown = board(
      [link, snapshot("# Fix login")],
      [line("note:link", "note:snap"), line("note:snap", "card:thread")],
    );
    const cards = boardPromptContext(shown, people).cards;
    expect(cards.map((card) => card.ref)).toEqual(["note:snap", "note:link"]);
    expect(cards[1]?.text).toBe(`ENG-1 · Fix login\n${URL}`);
  });
});
