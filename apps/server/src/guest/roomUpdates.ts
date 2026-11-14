import {
  type GuestId,
  guestMessageAuthorName,
  type OrchestrationV2Run,
  type OrchestrationV2TurnItem,
  ROOM_UPDATE_MAX_LENGTH,
  ROOM_UPDATES_MAX_CHARS,
  ROOM_UPDATES_MAX_MESSAGES,
  type RoomUpdate,
  type RoomUpdates,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";

export const clip = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max - 1).replace(/[\uD800-\uDBFF]$/, "")}…`;

const RUNNING: ReadonlySet<OrchestrationV2Run["status"]> = new Set([
  "preparing",
  "queued",
  "starting",
  "running",
  "waiting",
]);

/**
 * What a guest's joined thread has not seen, newest that fit: the owner's and other guests' words,
 * never the caller's own turns. An owner run's last reply waits for the run to end and is dated
 * then: a cursor handed out mid-run is always older, so the reply cannot be skipped.
 */
export function roomUpdatesOf(input: {
  /** The thread's items, oldest first. */
  readonly items: ReadonlyArray<OrchestrationV2TurnItem>;
  readonly runs: ReadonlyArray<Pick<OrchestrationV2Run, "id" | "status" | "completedAt">>;
  /** Turns older than `items` exist. */
  readonly hasMoreHistory: boolean;
  readonly share: ThreadGuestShare;
  readonly guestId: GuestId;
  readonly after: string | null;
}): RoomUpdates {
  const after = input.after === null ? Number.NEGATIVE_INFINITY : Date.parse(input.after);
  const runs = new Map(input.runs.map((run) => [run.id as string, run]));
  const lastReplyOfRun = new Map<string, string>();
  for (const item of input.items) {
    if (item.type === "assistant_message" && !item.streaming && item.text.trim() !== "") {
      lastReplyOfRun.set(item.runId ?? item.id, item.id);
    }
  }
  const spoken = input.items.flatMap((item): ReadonlyArray<RoomUpdate> => {
    const at = DateTime.formatIso(item.updatedAt);
    if (item.type === "user_message") {
      const guest = item.context?.guest;
      return guest === undefined
        ? [{ author: "owner", text: item.text, at }]
        : [{ author: "guest", name: guest.name, text: guest.text, at }];
    }
    if (
      item.type !== "assistant_message" ||
      lastReplyOfRun.get(item.runId ?? item.id) !== item.id
    ) {
      return [];
    }
    const run = item.runId === null ? undefined : runs.get(item.runId);
    if (run === undefined) return [{ author: "owner_agent", text: item.text, at }];
    if (RUNNING.has(run.status)) return [];
    const ended = run.completedAt ?? item.updatedAt;
    return [
      {
        author: "owner_agent",
        text: item.text,
        at: DateTime.formatIso(DateTime.max(ended, item.updatedAt)),
      },
    ];
  });
  const turns = (input.share.turns ?? []).flatMap((turn): ReadonlyArray<RoomUpdate> => {
    if (turn.guestId === input.guestId) return [];
    const name = guestMessageAuthorName(input.share, turn);
    return [
      { author: "guest", name, text: turn.prompt, at: turn.postedAt },
      { author: "guest_agent", name, text: turn.reply, at: turn.postedAt },
    ];
  });
  const fresh = [...spoken, ...turns]
    .filter((update) => update.text.trim() !== "" && Date.parse(update.at) > after)
    .toSorted((left, right) => Date.parse(left.at) - Date.parse(right.at));

  const kept: Array<RoomUpdate> = [];
  let chars = 0;
  let cut = false;
  for (const update of fresh.toReversed()) {
    const text = clip(update.text.trim(), ROOM_UPDATE_MAX_LENGTH);
    if (kept.length >= ROOM_UPDATES_MAX_MESSAGES || chars + text.length > ROOM_UPDATES_MAX_CHARS) {
      break;
    }
    cut ||= text !== update.text.trim();
    kept.push({ ...update, text });
    chars += text.length;
  }
  const oldestHeld = Math.min(...input.items.map((item) => DateTime.toEpochMillis(item.updatedAt)));
  return {
    updates: kept.toReversed(),
    truncated: cut || kept.length < fresh.length || (input.hasMoreHistory && oldestHeld > after),
    cursor: kept[0]?.at ?? input.after,
  };
}
