import {
  CommandId,
  ROOM_BOARD_ROOM_BOX,
  ROOM_CODE_MAX_FILES,
  ROOM_CODE_PATCH_MAX_LENGTH,
  ROOM_CODE_PATH_MAX_LENGTH,
  type RoomCodeDiffSummary,
  type RoomCodePatch,
  RoomCodePatchError,
  type RoomCodePatchScope,
  type RunId,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { unquoteGitPatchPath } from "@t3tools/shared/gitPatchPath";
import { roomBoxCodeWindows, roomBoxIdOfRef } from "@t3tools/shared/roomBoard";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as CheckpointDiffQuery from "../checkpointing/CheckpointDiffQuery.ts";
import { threadRoomOf } from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";

/** One file of a unified diff: where it is now, the lines added and removed, and its patch. */
interface PatchFile {
  readonly path: string;
  readonly additions: number;
  readonly deletions: number;
  readonly patch: string;
}

/**
 * Git quotes a name holding a tab, quote or backslash, and ends an unquoted name holding a space
 * with a tab, so the first literal tab is never part of what the file is called.
 */
function headerPath(rest: string, prefix: string): string | null {
  const tab = rest.indexOf("\t");
  const token = tab === -1 ? rest : rest.slice(0, tab);
  const path = token.startsWith('"') ? unquoteGitPatchPath(token) : token;
  return path.startsWith(prefix) ? path.slice(prefix.length) : null;
}

/** The new side's path of a `diff --git a/x b/y` line, for a file whose patch names it no other way. */
function gitHeaderPath(line: string): string | null {
  const rest = line.slice("diff --git ".length);
  if (rest.startsWith('"')) {
    const quoted = /"(?:[^"\\]|\\.)*"$/.exec(rest)?.[0];
    return quoted === undefined ? null : headerPath(quoted, "b/");
  }
  const at = rest.lastIndexOf(" b/");
  return at === -1 ? null : rest.slice(at + 3);
}

/** The files of a unified diff as git writes one, in its order. */
export function splitPatchFiles(diff: string): ReadonlyArray<PatchFile> {
  const files: Array<PatchFile> = [];
  let lines: Array<string> = [];
  let path: string | null = null;
  let oldPath: string | null = null;
  let additions = 0;
  let deletions = 0;
  // Inside a file's hunks a `--- ` or `+++ ` line is a removed or added source line, not a header.
  let inHunks = false;
  const close = () => {
    const name = path ?? oldPath;
    if (name !== null && lines.length > 0) {
      files.push({ path: name, additions, deletions, patch: lines.join("\n") });
    }
  };
  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      close();
      lines = [line];
      path = gitHeaderPath(line);
      oldPath = null;
      additions = 0;
      deletions = 0;
      inHunks = false;
      continue;
    }
    if (lines.length === 0) continue;
    lines.push(line);
    if (line.startsWith("@@")) inHunks = true;
    else if (inHunks) {
      if (line.startsWith("+")) additions += 1;
      else if (line.startsWith("-")) deletions += 1;
    } else if (line.startsWith("+++ ")) path = headerPath(line.slice(4), "b/") ?? path;
    else if (line.startsWith("--- ")) oldPath = headerPath(line.slice(4), "a/");
    else if (line.startsWith("rename to ")) path = line.slice("rename to ".length);
  }
  close();
  return files;
}

/** A path as a code window keeps it: whole, or its end when it is longer than the board takes. */
const roomCodePath = (path: string): string =>
  path.length <= ROOM_CODE_PATH_MAX_LENGTH
    ? path
    : `…${path.slice(-(ROOM_CODE_PATH_MAX_LENGTH - 1)).replace(/^[\uDC00-\uDFFF]/, "")}`;

const withoutTruncation = (diff: string) =>
  diff.endsWith(CheckpointDiffQuery.DIFF_TRUNCATED_MARKER)
    ? { diff: diff.slice(0, -CheckpointDiffQuery.DIFF_TRUNCATED_MARKER.length), truncated: true }
    : { diff, truncated: false };

/**
 * What a code window lists of a thread's diff up to its `turnCount`th turn: the first files with
 * their counts, and what its last turn changed in each, never a patch.
 */
export function roomCodeSummary(
  thread: string,
  lastTurn: string | null,
  turnCount: number,
): RoomCodeDiffSummary {
  const read = withoutTruncation(thread);
  const files = splitPatchFiles(read.diff);
  const last = new Map(
    splitPatchFiles(withoutTruncation(lastTurn ?? "").diff).map((file) => [file.path, file]),
  );
  const total = (count: (file: PatchFile) => number) =>
    files.reduce((sum, file) => sum + count(file), 0);
  return {
    files: files.slice(0, ROOM_CODE_MAX_FILES).map((file) => {
      const turn = last.get(file.path);
      return {
        path: roomCodePath(file.path),
        additions: file.additions,
        deletions: file.deletions,
        ...(turn === undefined
          ? {}
          : { lastTurn: { additions: turn.additions, deletions: turn.deletions } }),
      };
    }),
    ...(files.length > ROOM_CODE_MAX_FILES ? { more: files.length - ROOM_CODE_MAX_FILES } : {}),
    additions: total((file) => file.additions),
    deletions: total((file) => file.deletions),
    ...(read.truncated ? { truncated: true as const } : {}),
    turnCount,
  };
}

/**
 * What the threads behind thread boxes changed, for the code windows on a room's board: a count
 * of each file when a turn ends, and one file's patch when someone opens it. Read from the
 * checkpoints the app takes of every turn.
 */
export class RoomCodeDiffs extends Context.Service<
  RoomCodeDiffs,
  {
    /**
     * What a thread changed from its start to its last finished turn, and that turn's run. Null
     * when it has no finished turn, or its checkpoints cannot be read.
     */
    readonly summarize: (
      threadId: ThreadId,
    ) => Effect.Effect<{ readonly turnId: RunId; readonly changes: RoomCodeDiffSummary } | null>;
    /** One file's patch of a thread up to its `turnCount`th turn, since it began or in that turn. */
    readonly filePatch: (input: {
      readonly threadId: ThreadId;
      readonly turnCount: number;
      readonly scope: RoomCodePatchScope;
      readonly path: string;
    }) => Effect.Effect<RoomCodePatch, RoomCodePatchError>;
    /**
     * Shows, soon, what one of the owner's boxes' threads changed in the code windows the box has
     * a line to on the board of `roomThreadId`. `boxRef` names the box as lines do. Does nothing
     * for anything but one of the owner's boxes with a window. Never fails.
     */
    readonly showBoxChanges: (roomThreadId: ThreadId, boxRef: string) => Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/guest/RoomCodeDiffs") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const diffs = yield* CheckpointDiffQuery.CheckpointDiffQuery;
  const random = yield* SecureRandom.SecureRandom;

  const summarize = Effect.fn("RoomCodeDiffs.summarize")(
    function* (threadId: ThreadId) {
      const context = yield* orchestrator.getCheckpointContext(threadId);
      const completed = new Set(
        context.runs.filter((run) => run.status === "completed").map((run) => run.id),
      );
      let latest: { readonly turnCount: number; readonly runId: RunId } | null = null;
      for (const checkpoint of context.checkpoints) {
        const turnCount = checkpoint.appRunOrdinal;
        const runId = checkpoint.runId;
        if (
          checkpoint.status !== "ready" ||
          turnCount === null ||
          runId === null ||
          !completed.has(runId) ||
          (latest !== null && latest.turnCount >= turnCount)
        ) {
          continue;
        }
        latest = { turnCount, runId };
      }
      if (latest === null) return null;
      const { turnCount, runId } = latest;
      const thread = yield* diffs.getFullThreadDiff({ threadId, toTurnCount: turnCount });
      const lastTurn = yield* diffs
        .getTurnDiff({ threadId, fromTurnCount: turnCount - 1, toTurnCount: turnCount })
        .pipe(
          Effect.map((turn) => turn.diff),
          Effect.orElseSucceed(() => null),
        );
      return { turnId: runId, changes: roomCodeSummary(thread.diff, lastTurn, turnCount) };
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not count a thread's changes", { cause }).pipe(Effect.as(null)),
    ),
  );

  const filePatch = Effect.fn("RoomCodeDiffs.filePatch")(function* (input: {
    readonly threadId: ThreadId;
    readonly turnCount: number;
    readonly scope: RoomCodePatchScope;
    readonly path: string;
  }) {
    const unavailable = new RoomCodePatchError({ reason: "unavailable" });
    const read =
      input.scope === "thread"
        ? diffs.getFullThreadDiff({ threadId: input.threadId, toTurnCount: input.turnCount })
        : diffs.getTurnDiff({
            threadId: input.threadId,
            fromTurnCount: input.turnCount - 1,
            toTurnCount: input.turnCount,
          });
    const diff = yield* read.pipe(Effect.mapError(() => unavailable));
    const file = splitPatchFiles(withoutTruncation(diff.diff).diff).find(
      (candidate) => roomCodePath(candidate.path) === input.path,
    );
    if (file === undefined) return yield* unavailable;
    return file.patch.length > ROOM_CODE_PATCH_MAX_LENGTH
      ? { path: input.path }
      : { path: input.path, patch: file.patch };
  });

  const showChanges = Effect.fn("RoomCodeDiffs.showChanges")(
    function* ({
      roomThreadId,
      boxRef,
    }: {
      readonly roomThreadId: ThreadId;
      readonly boxRef: string;
    }) {
      const { thread } = yield* orchestrator.getThreadRecords(roomThreadId, []);
      const room = threadRoomOf(thread);
      const boxId = room.board === undefined ? undefined : roomBoxIdOfRef(room.board, boxRef);
      if (
        room.board === undefined ||
        boxId === undefined ||
        roomBoxCodeWindows(room.board, boxId).length === 0
      ) {
        return;
      }
      // A guest's box shows only what their own machine posts.
      const guestsBox = room.board.notes.some((note) => note.id === boxId && note.guestId);
      const boxThreadId = boxId === ROOM_BOARD_ROOM_BOX ? roomThreadId : room.boardThreads?.[boxId];
      if (guestsBox || boxThreadId === undefined) return;
      const shown = yield* summarize(boxThreadId);
      if (shown === null) return;
      const uuid = yield* random.uuidV4().pipe(Effect.orDie);
      yield* orchestrator.dispatch({
        type: "thread.room-box.changes",
        commandId: CommandId.make(`server:room-code:${uuid}`),
        threadId: roomThreadId,
        shareId: room.id,
        boxId,
        turnId: shown.turnId,
        changes: shown.changes,
      });
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not show a box's changes on the board", { cause }),
    ),
  );
  // A diff can take a while; whoever drew the line, or finished the turn, does not wait on it.
  const worker = yield* makeDrainableWorker(showChanges);

  return RoomCodeDiffs.of({
    summarize,
    filePatch,
    showBoxChanges: Effect.fn("RoomCodeDiffs.showBoxChanges")(
      (roomThreadId: ThreadId, boxRef: string) => worker.enqueue({ roomThreadId, boxRef }),
    ),
    drain: worker.drain,
  });
});

export const layer = Layer.effect(RoomCodeDiffs, make);
