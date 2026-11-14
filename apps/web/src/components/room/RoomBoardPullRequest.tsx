import {
  type RoomBoardNote,
  type RoomPullRequest,
  type RoomPullRequestProblem,
  roomPullRequestOf,
} from "@t3tools/contracts";
import { ExternalLinkIcon, RefreshCwIcon } from "lucide-react";
import { type PointerEvent, useEffect } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { formatRecentTimestamp } from "~/timestampFormat";

import { cn } from "~/lib/utils";

import { PullRequestGlyph } from "../pullRequest/pullRequestIcons";
import { Button } from "../ui/button";
import { BoardChip } from "./BoardChrome";
import {
  BOARD_PULL_REQUEST_STALE_MS,
  boardPullRequestCommits,
  boardPullRequestStale,
} from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** A pull request's state on the board: its branch icon and word, in the theme's state tones. */
const BOARD_PULL_REQUEST_STATE = {
  open: { label: "Open", text: "text-success-foreground", Icon: PullRequestGlyph.pullRequest },
  draft: { label: "Draft", text: "text-muted-foreground", Icon: PullRequestGlyph.draft },
  closed: { label: "Closed", text: "text-error-foreground", Icon: PullRequestGlyph.closed },
  merged: { label: "Merged", text: "text-paint-purple-deep", Icon: PullRequestGlyph.merged },
} as const satisfies Record<RoomPullRequest["state"], unknown>;

const PROBLEMS: Record<RoomPullRequestProblem, string> = {
  not_found:
    "Not found. It may have been deleted, or the board owner's GitHub account cannot see it.",
  signed_out: "GitHub is not signed in on the board owner's machine, so it cannot be read.",
  unavailable: "This pull request could not be read just now.",
};

/**
 * One GitHub pull request on the board, as the board owner's server last read it. Reading it
 * again is asked of that server; nobody else's GitHub is used.
 */
export function RoomPullRequestWindow({
  note,
  onRefresh,
}: {
  readonly note: RoomBoardNote;
  /** Asks for a fresh read; absent where nothing can read it. */
  readonly onRefresh: (() => void) | undefined;
}) {
  const ref = note.url === undefined ? null : roomPullRequestOf(note.url);
  const read = note.pullRequest;
  const readAt = read?.readAt;
  const canRefresh = onRefresh !== undefined;
  const askAgain = useStableCallback(() => onRefresh?.());
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads again from GitHub, through the owner's server, only while this window is on someone's screen
  useEffect(() => {
    if (!canRefresh || readAt === undefined) return;
    const check = () => {
      if (document.visibilityState !== "visible") return;
      if (boardPullRequestStale({ readAt }, Date.now())) askAgain();
    };
    check();
    const timer = window.setInterval(check, BOARD_PULL_REQUEST_STALE_MS / 5);
    return () => window.clearInterval(timer);
  }, [askAgain, canRefresh, readAt]);

  if (ref === null) {
    return <p className="px-3 pb-3 text-xs text-muted-foreground">Not a pull request address.</p>;
  }
  const shown = read?.pullRequest;
  const state = shown === undefined ? null : BOARD_PULL_REQUEST_STATE[shown.state];
  const commits = shown === undefined ? null : boardPullRequestCommits(shown);
  const checks = shown?.checks;
  return (
    <div className="flex min-h-0 flex-1 flex-col text-xs" data-board-pull-request>
      <header className="flex min-w-0 items-center gap-1.5 px-3 pb-1.5">
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {ref.repository} #{ref.number}
        </span>
        {state === null ? null : (
          <span className={cn("shrink-0 text-2xs font-medium", state.text)}>{state.label}</span>
        )}
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3" data-board-scroll>
        {shown === undefined || checks === undefined ? (
          <p role="status" className="text-muted-foreground">
            {read?.problem === undefined ? "Reading the pull request…" : PROBLEMS[read.problem]}
          </p>
        ) : (
          <>
            <p className="text-sm leading-snug font-medium text-foreground">{shown.title}</p>
            <div className="flex flex-wrap gap-1">
              {checks.passing === 0 && checks.failing === 0 && checks.pending === 0 ? (
                <BoardChip>No checks</BoardChip>
              ) : null}
              {checks.passing === 0 ? null : (
                <BoardChip tone="success">
                  {checks.passing} {checks.passing === 1 ? "check" : "checks"} passed
                </BoardChip>
              )}
              {checks.failing === 0 ? null : (
                <BoardChip tone="error">
                  {checks.failing} failing
                  {checks.failingNames.length === 0 ? "" : ` · ${checks.failingNames.join(", ")}`}
                </BoardChip>
              )}
              {checks.pending === 0 ? null : (
                <BoardChip tone="warning">{checks.pending} pending</BoardChip>
              )}
              {commits === null ? null : <BoardChip>{commits}</BoardChip>}
            </div>
            <p className="flex min-w-0 items-center gap-2 font-mono text-2xs text-muted-foreground">
              <span className="min-w-0 flex-1 truncate">
                {shown.headBranch} → {shown.baseBranch}
              </span>
              <span className="shrink-0">
                {shown.changedFiles} {shown.changedFiles === 1 ? "file" : "files"}
              </span>
              <span className="shrink-0 text-success-foreground">+{shown.additions}</span>
              <span className="shrink-0 text-error-foreground">−{shown.deletions}</span>
            </p>
            {read?.problem === undefined ? null : (
              <p className="text-muted-foreground">{PROBLEMS[read.problem]}</p>
            )}
          </>
        )}
      </div>
      <footer className="flex min-w-0 shrink-0 items-center gap-1 border-t border-board-hairline px-3 py-1.5">
        <span className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">
          {shown === undefined
            ? read === undefined
              ? null
              : `Tried ${formatRecentTimestamp(read.readAt, "locale")}`
            : `Updated ${formatRecentTimestamp(shown.updatedAt, "locale")}`}
        </span>
        {onRefresh === undefined ? null : (
          <Button
            size="micro"
            variant="ghost-muted"
            onPointerDown={stopPointer}
            onClick={onRefresh}
          >
            <RefreshCwIcon />
            Refresh
          </Button>
        )}
        <Button
          size="micro"
          variant="ghost-muted"
          onPointerDown={stopPointer}
          render={<a href={ref.url} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLinkIcon />
          GitHub
        </Button>
      </footer>
    </div>
  );
}

/** A pull request window's title-bar mark: the branch icon, tinted by the state last read. */
export function PullRequestStateIcon({ note }: { readonly note: RoomBoardNote }) {
  const state = note.pullRequest?.pullRequest?.state;
  const shown = state === undefined ? null : BOARD_PULL_REQUEST_STATE[state];
  const Icon = shown?.Icon ?? PullRequestGlyph.pullRequest;
  return (
    <Icon
      aria-hidden
      className={cn("size-3.5 shrink-0", shown === null ? "text-muted-foreground" : shown.text)}
    />
  );
}
