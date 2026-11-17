// @effect-diagnostics globalDate:off - Run by a plain Node script, outside the Effect runtime.
/**
 * The public sample board as `sample/onboarding-v2.json` describes it, turned into the board
 * changes `scripts/sample-board.mjs` posts, each by the person who makes it. Kept free of imports
 * other than types so Node runs the script with this file as it is.
 */
import type { RoomBoardChange, RoomBoardNote } from "@t3tools/contracts";

export interface SampleCard {
  readonly id: string;
  /** The key of the person in `people` who adds it. */
  readonly by: string;
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly kind?: "task" | "link" | "artifact" | "comment";
  readonly url?: string;
  readonly size?: { readonly w: number; readonly h: number };
  readonly color?: "yellow" | "green" | "blue" | "pink" | "purple" | "grey";
  readonly section?: true;
  readonly status?: "todo" | "doing" | "done";
  readonly priority?: "low" | "medium" | "high" | "urgent";
  readonly order?: number;
  /** A task's due day, counted from the day the script runs, so the sample never looks late. */
  readonly dueInDays?: number;
  readonly assignee?: string;
  /** An artifact's body: a file beside the description, markdown or a whole HTML page. */
  readonly body?: string;
  readonly replies?: ReadonlyArray<{
    readonly id: string;
    readonly by: string;
    readonly text: string;
  }>;
}

export interface SampleBoard {
  readonly title: string;
  readonly maker: string;
  readonly people: Readonly<Record<string, string>>;
  readonly cards: ReadonlyArray<SampleCard>;
  readonly lines: ReadonlyArray<{
    readonly id: string;
    readonly by: string;
    readonly from: string;
    readonly to: string;
  }>;
  readonly reactions: ReadonlyArray<{
    readonly card: string;
    readonly by: string;
    readonly emoji: string;
  }>;
}

export interface SampleChange {
  readonly by: string;
  readonly change: RoomBoardChange;
}

const DAY_MS = 86_400_000;

/**
 * The changes that make the board look as described, given what it holds now (`notes`). An
 * artifact already showing its body, and a reaction already there, are left as they are, so a
 * second run adds no versions and takes no reaction back.
 */
export function sampleChanges(input: {
  readonly sample: SampleBoard;
  readonly guestOf: (person: string) => string;
  readonly bodyOf: (file: string) => string;
  readonly notes: ReadonlyArray<Pick<RoomBoardNote, "id" | "artifact" | "reactions">>;
  readonly now: number;
}): ReadonlyArray<SampleChange> {
  const { sample, guestOf } = input;
  const existing = new Map(input.notes.map((note) => [note.id, note]));
  const changes: Array<SampleChange> = [];
  for (const card of sample.cards) {
    changes.push({
      by: card.by,
      change: {
        type: "note.put",
        noteId: card.id,
        text: card.text,
        x: card.x,
        y: card.y,
        ...(card.kind === undefined ? {} : { kind: card.kind }),
        ...(card.url === undefined ? {} : { url: card.url }),
        ...(card.size === undefined ? {} : { size: card.size }),
        ...(card.color === undefined ? {} : { color: card.color }),
        ...(card.section === undefined ? {} : { section: true }),
        ...(card.status === undefined ? {} : { status: card.status }),
        ...(card.priority === undefined ? {} : { priority: card.priority }),
        ...(card.order === undefined ? {} : { order: card.order }),
        ...(card.dueInDays === undefined
          ? {}
          : { due: new Date(input.now + card.dueInDays * DAY_MS).toISOString().slice(0, 10) }),
        ...(card.assignee === undefined ? {} : { assignee: { guestId: guestOf(card.assignee) } }),
      } as RoomBoardChange,
    });
    if (card.body !== undefined) {
      const body = input.bodyOf(card.body);
      if (existing.get(card.id)?.artifact?.body !== body) {
        changes.push({ by: card.by, change: { type: "artifact.write", noteId: card.id, body } });
      }
    }
    for (const reply of card.replies ?? []) {
      changes.push({
        by: reply.by,
        change: { type: "comment.reply", noteId: card.id, replyId: reply.id, text: reply.text },
      });
    }
  }
  for (const line of sample.lines) {
    changes.push({
      by: line.by,
      change: {
        type: "edge.put",
        edgeId: line.id,
        from: `note:${line.from}`,
        to: `note:${line.to}`,
      },
    });
  }
  for (const reaction of sample.reactions) {
    const has = existing
      .get(reaction.card)
      ?.reactions?.some(
        (one) => one.emoji === reaction.emoji && one.guestId === guestOf(reaction.by),
      );
    if (has === true) continue;
    changes.push({
      by: reaction.by,
      change: {
        type: "note.react",
        noteId: reaction.card,
        emoji: reaction.emoji,
      } as RoomBoardChange,
    });
  }
  return changes;
}
