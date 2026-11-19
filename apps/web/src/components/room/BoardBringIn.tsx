import {
  ROOM_BOARD_NOTE_MAX_LENGTH,
  type RoomBoard,
  type RoomBoardNote,
  roomBoardNoteRef,
} from "@t3tools/contracts";
import { roomEmbedBringInPrompt } from "@t3tools/shared/roomEmbed";
import { ExternalLinkIcon, ImportIcon, RefreshCwIcon } from "lucide-react";
import { type PointerEvent, useState } from "react";

import { randomUUID } from "~/lib/utils";

import { boardTimeLabel } from "../boards/boardsHome.logic";
import { Button } from "../ui/button";
import {
  boardBringInBox,
  boardLinkSnapshot,
  boardLinkTitle,
  boardSnapshotLink,
} from "./boardSnapshot.logic";
import {
  type BoardPeople,
  type BoardPrompt,
  type BoardThreadBox,
  boardAgentName,
  boardPersonName,
  boardPromptCard,
  boardThreadBoxTitle,
} from "./roomBoard.logic";
import type { BoardPromptDraft } from "./RoomBoardPrompt";
import { WhatItDoes, WhyNot } from "./RoomBoardWhy";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** What "Bring in" does for this viewer on one link card. */
interface BoardBringInAction {
  readonly label: string;
  readonly hint: string;
  /** Absent when it cannot be done now; `hint` says why. */
  readonly run: (() => void) | undefined;
}

interface Preparing {
  readonly key: string;
  readonly boxId: string;
  readonly linkId: string;
  /** The snapshot it fills: one that exists, or the one its first Send added. */
  readonly snapshotId: string | null;
  readonly refresh: boolean;
}

/**
 * Bringing a link onto the board with the viewer's own agent: a prompt for one of their own thread
 * boxes, shown in its field for them to send, whose reply fills a snapshot artifact joined to the
 * link card. Nothing is sent for them, and no one else's box is ever asked.
 */
export function useBoardBringIn(input: {
  readonly board: RoomBoard;
  readonly people: BoardPeople;
  readonly viewer: string | null;
  /** Every thread box on the board; only the viewer's own are used. */
  readonly boxes: ReadonlyArray<BoardThreadBox>;
  /** Whether this board takes agents and the viewer can prompt their own boxes from it. */
  readonly canPrompt: boolean;
  readonly canEdit: boolean;
  readonly canAddArtifact: boolean;
  readonly canAddBox: boolean;
  /** Set while the viewer has no agent on the board: it says how to bring one. */
  readonly bringAgent: (() => void) | undefined;
  /** Adds a card beside an item, with a line from it; null when it cannot. */
  readonly addBeside: (ref: string, kind: "artifact" | "thread", title: string) => string | null;
  /** Waits until the changes queued for a card have reached the board. */
  readonly settle: (ref: string) => Promise<unknown>;
  readonly prompt: (boxId: string, prompt: BoardPrompt) => Promise<boolean>;
  /** Shows a box and puts the caret in its prompt field. */
  readonly focusBox: (boxId: string) => void;
  /**
   * Picks which of the viewer's own boxes takes the draft, `preferred` when the link points to
   * one, asking them when nothing says which, then runs `then` with it.
   */
  readonly chooseBox: (preferred: string | null, then: (boxId: string) => void) => void;
}) {
  const { board, people, viewer } = input;
  const [preparing, setPreparing] = useState<Preparing | null>(null);
  const linkOf = (linkId: string) =>
    board.notes.find(
      (note) => note.id === linkId && note.kind === "link" && note.url !== undefined,
    );

  const prepare = (boxId: string, linkId: string, snapshotId: string | null) => {
    setPreparing({ key: randomUUID(), boxId, linkId, snapshotId, refresh: snapshotId !== null });
    input.focusBox(boxId);
  };

  const actionFor = (link: RoomBoardNote, snapshotId: string | null): BoardBringInAction | null => {
    if (link.kind !== "link" || link.url === undefined) return null;
    const preferred = boardBringInBox(board, input.boxes, viewer, link.id);
    const hasOwnBox = input.boxes.some((box) => (box.guestId ?? null) === viewer);
    const label = snapshotId === null ? "Bring in with my agent" : "Refresh with my agent";
    const noRoom =
      snapshotId === null && input.canEdit && !input.canAddArtifact
        ? {
            label,
            hint: "This board has no room for another artifact. Remove one to bring this in.",
            run: undefined,
          }
        : null;
    if (!hasOwnBox) {
      if (input.bringAgent !== undefined) {
        return {
          label: "Bring my agent to read this",
          hint: "Your agent opens links with the tools you connected to it. Bring it to this board first.",
          run: input.bringAgent,
        };
      }
      if (!input.canPrompt || !input.canEdit) return null;
      if (!input.canAddBox) {
        return { label, hint: "This board has no room for a thread box of yours.", run: undefined };
      }
      if (noRoom !== null) return noRoom;
      return {
        label,
        hint: "Adds a thread box of yours beside the link and writes a prompt in it for your agent. Nothing runs until you press Send.",
        run: () => {
          const title = boardThreadBoxTitle(`Read ${boardLinkTitle(link)}`);
          const made = input.addBeside(roomBoardNoteRef(link.id), "thread", title);
          if (made !== null) prepare(made, link.id, snapshotId);
        },
      };
    }
    // A new snapshot is a card this person adds, so they must be able to add cards.
    if (!input.canPrompt || (snapshotId === null && !input.canEdit)) return null;
    if (noRoom !== null) return noRoom;
    return {
      label,
      hint: "Writes a prompt in your thread box asking your agent to open this with its own connections and write what it says onto the board. Nothing runs until you press Send.",
      run: () => input.chooseBox(preferred, (boxId) => prepare(boxId, link.id, snapshotId)),
    };
  };

  /** "Bring in" on a link card, or Refresh on its snapshot once it has one. */
  const bringInOf = (link: RoomBoardNote) =>
    actionFor(link, boardLinkSnapshot(board, link.id)?.id ?? null);

  /** The prepared prompt for this box, while there is one. */
  const draftFor = (boxId: string): BoardPromptDraft | undefined => {
    if (preparing === null || preparing.boxId !== boxId) return undefined;
    const link = linkOf(preparing.linkId);
    const card = link === undefined ? null : boardPromptCard(link, people);
    if (link?.url === undefined || card === null) return undefined;
    const title = boardLinkTitle(link);
    const box = input.boxes.find((candidate) => candidate.id === boxId)?.title ?? "";
    const where = ` · in ${box === "" ? "your agent box" : box}`;
    return {
      key: preparing.key,
      text: roomEmbedBringInPrompt(link.url),
      cards: [{ ...card, status: "new" }],
      title: `${preparing.refresh ? "Refresh" : "Bring in"} ${title}${where}`,
      fills: preparing.refresh
        ? "Its reply replaces the snapshot for everyone; Restore previous brings this one back."
        : "Its reply becomes a snapshot beside the link, for everyone.",
      onCancel: () => setPreparing(null),
      onSend: async (prompt) => {
        const existing =
          preparing.snapshotId !== null &&
          board.notes.some((note) => note.id === preparing.snapshotId && note.kind === "artifact")
            ? preparing.snapshotId
            : null;
        const id =
          existing ??
          input.addBeside(
            roomBoardNoteRef(link.id),
            "artifact",
            title.slice(0, ROOM_BOARD_NOTE_MAX_LENGTH),
          );
        if (id === null) return false;
        if (existing === null) {
          // A failed Send keeps the card it added, and the next one fills it.
          setPreparing({ ...preparing, snapshotId: id });
          await input.settle(roomBoardNoteRef(id));
        }
        const sent = await input.prompt(boxId, { ...prompt, artifactId: id });
        if (sent) setPreparing((current) => (current?.key === preparing.key ? null : current));
        return sent;
      },
    };
  };

  /** The mark on a snapshot artifact: what it was read from, by whom and when, and Refresh. */
  const snapshotOf = (note: RoomBoardNote) => {
    if (note.kind !== "artifact") return null;
    const link = boardSnapshotLink(board, note.id);
    if (link?.url === undefined) return null;
    return (
      <BoardSnapshotMark
        link={link}
        artifact={note.artifact}
        people={people}
        refresh={actionFor(link, note.id)}
      />
    );
  };

  /** What a card shows of it: a link card's button, or a snapshot's mark. */
  const partOf = (note: RoomBoardNote) => {
    if (note.kind !== "link") return snapshotOf(note);
    const action = bringInOf(note);
    return action === null ? null : <BoardBringInButton action={action} />;
  };

  return { bringInOf, draftFor, partOf };
}

/** A link card's or a snapshot's "Bring in" button. */
function BoardBringInButton({
  action,
  compact = false,
}: {
  readonly action: BoardBringInAction;
  /** Only the icon and a short word, as on a snapshot's mark. */
  readonly compact?: boolean;
}) {
  const Icon = action.label.startsWith("Refresh") ? RefreshCwIcon : ImportIcon;
  const button = (
    <Button
      size="micro"
      variant={compact ? "ghost-muted" : "outline"}
      disabled={action.run === undefined}
      onPointerDown={stopPointer}
      onClick={action.run}
      data-board-bring-in
    >
      <Icon />
      {compact && action.run !== undefined && action.label.startsWith("Refresh")
        ? "Refresh"
        : action.label}
    </Button>
  );
  return action.run === undefined ? (
    <WhyNot reason={action.hint}>{button}</WhyNot>
  ) : (
    <WhatItDoes hint={action.hint}>{button}</WhatItDoes>
  );
}

/**
 * "Snapshot of ENG-123 · read by Sam's agent 3 days ago", with the way to the original and to
 * read it again.
 */
function BoardSnapshotMark({
  link,
  artifact,
  people,
  refresh,
}: {
  readonly link: RoomBoardNote;
  readonly artifact: RoomBoardNote["artifact"];
  readonly people: BoardPeople;
  readonly refresh: BoardBringInAction | null;
}) {
  // When the card was drawn: how long ago it was read is said against that, without a clock.
  const [now] = useState(() => Date.now());
  const when = artifact === undefined ? null : boardTimeLabel(artifact.updatedAt, now);
  const by =
    artifact === undefined
      ? "not read yet"
      : artifact.byHand === true
        ? `written by ${boardPersonName(people, artifact.guestId)}`
        : `read by ${boardAgentName(people, artifact.guestId)}`;
  // "just now", "3 days ago", "yesterday"; a date reads "on Mar 4".
  const ago =
    when === null
      ? ""
      : /^[A-Z][a-z]{2} \d/.test(when)
        ? ` on ${when}`
        : ` ${when.charAt(0).toLowerCase()}${when.slice(1)}`;
  return (
    <div
      className="flex shrink-0 flex-wrap items-center gap-x-1.5 gap-y-1 px-3 pb-1.5"
      data-board-snapshot
    >
      <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
        Snapshot of {boardLinkTitle(link)} · {by}
        {ago}
      </p>
      <Button
        size="micro"
        variant="ghost-muted"
        onPointerDown={stopPointer}
        render={<a href={link.url} target="_blank" rel="noreferrer noopener" />}
      >
        <ExternalLinkIcon />
        Open source
      </Button>
      {refresh === null ? null : <BoardBringInButton action={refresh} compact />}
    </div>
  );
}
