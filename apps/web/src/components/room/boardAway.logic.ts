import type { RoomBoardAgentTurn, RoomBoardNote } from "@t3tools/contracts";
import { roomTaskStatus } from "@t3tools/shared/roomBoard";

import type { BoardCatchUpStep } from "./boardCatchUp.logic";
import { type BoardPeople, boardAgentName, boardPersonName } from "./roomBoard.logic";

/** One line of what changed while someone was away, and the cards it is about. */
export interface BoardAwayRow {
  readonly key: string;
  readonly label: string;
  readonly noteIds: ReadonlyArray<string>;
}

export interface BoardAwayInput {
  /** What `boardCatchUp` found others changed since the last visit. */
  readonly steps: ReadonlyArray<BoardCatchUpStep>;
  readonly notes: ReadonlyArray<RoomBoardNote>;
  readonly turns: ReadonlyArray<RoomBoardAgentTurn>;
  /** The last visit, and when this one began, as the board's server stamps times. */
  readonly since: string;
  readonly until: string;
  readonly people: BoardPeople;
  /**
   * The cards on the board at the last visit, by id, when this browser kept them: a card not
   * among them was added. Unknown, a card is "added or changed".
   */
  readonly seen: ReadonlySet<string> | undefined;
}

const NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  note: ["note", "notes"],
  task: ["task", "tasks"],
  link: ["link", "links"],
  artifact: ["artifact", "artifacts"],
  thread: ["agent box", "agent boxes"],
  comment: ["comment", "comments"],
  code: ["code window", "code windows"],
  "pull-request": ["pull request", "pull requests"],
};

const counted = (count: number, kind: string) => {
  const [one, many] = NOUNS[kind] ?? ["card", "cards"];
  return `${count} ${count === 1 ? one : many}`;
};

/** "4 notes and 1 task", "2 notes, 1 task and 1 link". */
const listed = (parts: ReadonlyArray<string>) =>
  parts.length <= 1 ? (parts[0] ?? "") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;

const byKind = (notes: ReadonlyArray<RoomBoardNote>) => {
  const kinds = new Map<string, number>();
  for (const note of notes) {
    const kind = note.kind ?? "note";
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
  }
  return listed([...kinds].map(([kind, count]) => counted(count, kind)));
};

const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

interface Actor {
  readonly key: string;
  readonly name: string;
  readonly added: Array<RoomBoardNote>;
  readonly changed: Array<RoomBoardNote>;
  readonly either: Array<RoomBoardNote>;
  replies: number;
  readonly replyNotes: Set<string>;
}

/**
 * What changed while this person was away, from what the board records: who added or changed
 * which cards, an agent's when its turn made the latest change; artifacts an agent rewrote; and
 * the tasks now done. People first, then agents, each in the order they first changed something.
 * Nothing is counted that the board does not record.
 */
export function boardAwaySummary(input: BoardAwayInput): ReadonlyArray<BoardAwayRow> {
  const { people, since, until } = input;
  const inVisit = (at: string) => at > since && at <= until;
  const turns = input.turns.filter((turn) => turn.undone !== true && inVisit(turn.at));
  const actors = new Map<string, Actor>();
  const actor = (key: string, name: string): Actor => {
    const known = actors.get(key);
    if (known !== undefined) return known;
    const made: Actor = {
      key,
      name,
      added: [],
      changed: [],
      either: [],
      replies: 0,
      replyNotes: new Set(),
    };
    actors.set(key, made);
    return made;
  };
  const rewritten = new Set<string>();
  const rewrites: Array<BoardAwayRow> = [];
  for (const note of input.notes) {
    const artifact = note.artifact;
    if (note.kind !== "artifact" || artifact === undefined || artifact.byHand === true) continue;
    if (!inVisit(artifact.updatedAt) || (artifact.guestId ?? null) === people.viewer) continue;
    rewritten.add(note.id);
    rewrites.push({
      key: `rewrite:${note.id}`,
      label: `${capital(boardAgentName(people, artifact.guestId))} rewrote ${note.text.trim() || "an artifact"}`,
      noteIds: [note.id],
    });
  }
  for (const { note, changed, replies } of input.steps) {
    if (changed && !rewritten.has(note.id)) {
      const at = note.changed?.at ?? "";
      // The agent's turn made the newest change when it is no older than the card's stamp.
      const turn = turns.findLast(
        (candidate) => candidate.at >= at && candidate.cards.some((card) => card.id === note.id),
      );
      if (turn !== undefined) {
        const made = actor(
          `agent:${turn.guestId ?? ""}`,
          capital(boardAgentName(people, turn.guestId)),
        );
        const added = turn.cards.find((card) => card.id === note.id)?.before === undefined;
        (added ? made.added : made.changed).push(note);
      } else {
        const by = note.changed?.guestId;
        const made = actor(`person:${by ?? ""}`, boardPersonName(people, by));
        if (input.seen === undefined) made.either.push(note);
        else (input.seen.has(note.id) ? made.changed : made.added).push(note);
      }
    }
    if (replies > 0) {
      for (const reply of note.replies ?? []) {
        if (!inVisit(reply.at) || (reply.guestId ?? null) === people.viewer) continue;
        const made =
          reply.agent === undefined
            ? actor(`person:${reply.guestId ?? ""}`, boardPersonName(people, reply.guestId))
            : actor(`agent:${reply.guestId ?? ""}`, capital(boardAgentName(people, reply.guestId)));
        made.replies += 1;
        made.replyNotes.add(note.id);
      }
    }
  }
  const actorRows = [...actors.values()]
    .toSorted(
      (left, right) =>
        Number(left.key.startsWith("agent:")) - Number(right.key.startsWith("agent:")),
    )
    .flatMap((made): Array<BoardAwayRow> => {
      const parts = [
        ...(made.added.length === 0 ? [] : [`added ${byKind(made.added)}`]),
        ...(made.changed.length === 0 ? [] : [`changed ${byKind(made.changed)}`]),
        ...(made.either.length === 0 ? [] : [`added or changed ${byKind(made.either)}`]),
        ...(made.replies === 0
          ? []
          : [`wrote ${made.replies} ${made.replies === 1 ? "reply" : "replies"}`]),
      ];
      if (parts.length === 0) return [];
      return [
        {
          key: made.key,
          label: `${made.name} ${listed(parts)}`,
          noteIds: [...made.added, ...made.changed, ...made.either]
            .map((note) => note.id)
            .concat([...made.replyNotes]),
        },
      ];
    });
  const done = input.steps
    .filter(
      ({ note, changed }) => changed && note.kind === "task" && roomTaskStatus(note) === "done",
    )
    .map(({ note }) => note.id);
  return [
    ...actorRows,
    ...rewrites,
    ...(done.length === 0
      ? []
      : [
          {
            key: "done",
            label: `${counted(done.length, "task")} now done`,
            noteIds: done,
          },
        ]),
  ];
}
