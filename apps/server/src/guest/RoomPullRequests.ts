import {
  CommandId,
  type PullRequestCheck,
  type PullRequestDetail,
  type ProjectId,
  ROOM_PULL_REQUEST_MAX_FAILING_NAMES,
  type RoomPullRequest,
  type RoomPullRequestProblem,
  type RoomPullRequestRead,
  roomPullRequestOf,
  type ThreadId,
} from "@t3tools/contracts";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import { threadRoomOf } from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as PullRequestService from "../pullRequest/PullRequestService.ts";

/** How soon after a read someone can ask for another, so a room cannot spend the owner's requests. */
export const ROOM_PULL_REQUEST_REFRESH_MS = 30_000;
// GitHub's commits read stops here; a window says "100+".
const COMMITS_READ = 100;

/** Why a pull request window reads its pull request: it was just added, or someone asked. */
export type RoomPullRequestReadReason = "added" | "asked";

const PASSING = new Set<PullRequestCheck["status"]>(["success", "neutral", "skipped"]);
const FAILING = new Set<PullRequestCheck["status"]>(["failure", "cancelled"]);

const cut = (text: string, max: number) => (text.length <= max ? text : text.slice(0, max));

/** A pull request as its window shows it, from what the app's own pull request read returned. */
function roomPullRequestFromDetail(
  detail: Pick<
    PullRequestDetail,
    | "title"
    | "state"
    | "isDraft"
    | "headBranch"
    | "baseBranch"
    | "changedFiles"
    | "additions"
    | "deletions"
    | "checks"
    | "updatedAt"
  >,
  commits: number | null,
): RoomPullRequest {
  const failing = detail.checks.filter((check) => FAILING.has(check.status));
  const passing = detail.checks.filter((check) => PASSING.has(check.status)).length;
  return {
    title: cut(detail.title, 300),
    state: detail.state === "open" ? (detail.isDraft ? "draft" : "open") : detail.state,
    headBranch: cut(detail.headBranch, 255),
    baseBranch: cut(detail.baseBranch, 255),
    ...(commits === null
      ? {}
      : { commits, ...(commits >= COMMITS_READ ? { moreCommits: true as const } : {}) }),
    changedFiles: detail.changedFiles,
    additions: detail.additions,
    deletions: detail.deletions,
    checks: {
      passing,
      failing: failing.length,
      pending: detail.checks.length - passing - failing.length,
      failingNames: failing
        .slice(0, ROOM_PULL_REQUEST_MAX_FAILING_NAMES)
        .map((check) => cut(check.name, 200)),
    },
    updatedAt: detail.updatedAt,
  };
}

/** What the room is told when the owner's server cannot read the pull request. */
function roomPullRequestProblemOf(error: PullRequestService.PullRequestError) {
  if (error._tag === "PullRequestUnavailableError") {
    return error.reason === "provider-unsupported"
      ? ("unavailable" satisfies RoomPullRequestProblem)
      : ("signed_out" satisfies RoomPullRequestProblem);
  }
  return error.reason === "not-found"
    ? ("not_found" satisfies RoomPullRequestProblem)
    : ("unavailable" satisfies RoomPullRequestProblem);
}

/**
 * Reads the GitHub pull requests that pull request windows on a room's board show, with the
 * owner's own sign-in, and writes what it read onto the window for the whole room. Nothing but a
 * github.com pull request URL a window holds is ever read.
 */
export class RoomPullRequests extends Context.Service<
  RoomPullRequests,
  {
    /**
     * Reads, soon, the pull request the window `noteId` on the board of `roomThreadId` shows. A
     * window just added is read once; one someone asks about, at most every
     * `ROOM_PULL_REQUEST_REFRESH_MS`. Never fails.
     */
    readonly refresh: (
      roomThreadId: ThreadId,
      noteId: string,
      reason: RoomPullRequestReadReason,
    ) => Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/guest/RoomPullRequests") {}

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const pullRequests = yield* PullRequestService.PullRequestService;
  const random = yield* SecureRandom.SecureRandom;

  const readPullRequest = Effect.fn("RoomPullRequests.readPullRequest")(function* (
    projectId: ProjectId,
    repository: string,
    number: number,
    reason: RoomPullRequestReadReason,
  ) {
    const ref = { projectId, host: "github.com", repository, number };
    // Someone asked for what GitHub says now, not what the app read a while ago.
    if (reason === "asked") yield* pullRequests.invalidate({ reference: ref });
    const detail = yield* pullRequests.detail(ref);
    const commits = yield* pullRequests.activity(ref).pipe(
      Effect.map((activity) => activity.commits.length),
      Effect.orElseSucceed(() => null),
    );
    return roomPullRequestFromDetail(detail, commits);
  });

  const read = Effect.fn("RoomPullRequests.read")(
    function* ({
      roomThreadId,
      noteId,
      reason,
    }: {
      readonly roomThreadId: ThreadId;
      readonly noteId: string;
      readonly reason: RoomPullRequestReadReason;
    }) {
      const { thread } = yield* orchestrator.getThreadRecords(roomThreadId, []);
      const room = threadRoomOf(thread);
      const window = room.board?.notes.find(
        (note) => note.id === noteId && note.kind === "pull-request",
      );
      const url = window?.url;
      const target = url === undefined ? null : roomPullRequestOf(url);
      if (window === undefined || url === undefined || target === null || target.url !== url) {
        return;
      }
      const now = yield* DateTime.now;
      const last = window.pullRequest;
      if (
        last !== undefined &&
        (reason === "added" ||
          DateTime.toEpochMillis(now) - Date.parse(last.readAt) < ROOM_PULL_REQUEST_REFRESH_MS)
      ) {
        return;
      }
      const shown = yield* readPullRequest(
        thread.projectId,
        target.repository,
        target.number,
        reason,
      ).pipe(
        Effect.map((pullRequest): Omit<RoomPullRequestRead, "readAt"> => ({ pullRequest })),
        Effect.catch((error) =>
          Effect.succeed<Omit<RoomPullRequestRead, "readAt">>({
            problem: roomPullRequestProblemOf(error),
          }),
        ),
      );
      const uuid = yield* random.uuidV4().pipe(Effect.orDie);
      yield* orchestrator.dispatch({
        type: "thread.room-pull-request.read",
        commandId: CommandId.make(`server:room-pull-request:${uuid}`),
        threadId: roomThreadId,
        shareId: room.id,
        noteId,
        url,
        read: { ...shown, readAt: DateTime.formatIso(yield* DateTime.now) },
      });
    },
    Effect.catch((cause) =>
      Effect.logWarning("Could not show a pull request on the board", { cause }),
    ),
  );
  // GitHub can take a while; whoever added the window or pressed refresh does not wait on it.
  const worker = yield* makeDrainableWorker(read);

  return RoomPullRequests.of({
    refresh: Effect.fn("RoomPullRequests.refresh")(
      (roomThreadId: ThreadId, noteId: string, reason: RoomPullRequestReadReason) =>
        worker.enqueue({ roomThreadId, noteId, reason }),
    ),
    drain: worker.drain,
  });
});

export const layer = Layer.effect(RoomPullRequests, make);
