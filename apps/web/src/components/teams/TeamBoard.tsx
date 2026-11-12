import {
  GuestId,
  type RoomBoard as RoomBoardValue,
  type RoomBoardChange,
  type ThreadGuest,
  roomBoardGuestCard,
} from "@t3tools/contracts";
import {
  type RelayTeam,
  type RelayTeamThread,
  teamBoardThreadCard,
} from "@t3tools/contracts/relay";
import { useEffect, useRef, useState } from "react";

import { useStableCallback } from "~/hooks/useStableCallback";
import { changeTeamBoard, readTeamBoard, refreshTeams } from "~/teams/teams";
import { type BoardCardSpec, RoomBoard } from "../room/RoomBoard";
import { Button } from "../ui/button";
import { toastManager } from "../ui/toast";
import { MemberAvatar } from "./MemberAvatar";
import { useOpenTeamThread } from "./useOpenTeamThread";

const POLL_MS = 2_000;
const MAX_POLL_MS = 30_000;
const pollDelay = (failures: number) => Math.min(POLL_MS * 2 ** failures, MAX_POLL_MS);

/**
 * The team's board as the relay keeps it: read every couple of seconds while it is open and the
 * tab is visible, less often while the relay does not answer.
 */
function useTeamBoard(teamId: string) {
  const [board, setBoard] = useState<RoomBoardValue | null>(null);
  const [names, setNames] = useState<Readonly<Record<string, string>>>({});
  const [reachable, setReachable] = useState(true);
  const version = useRef<number | null>(null);
  // A slower answer can arrive after a newer one; only a newer version replaces the board.
  const take = useStableCallback(
    (next: {
      readonly version: number;
      readonly board: RoomBoardValue | null;
      readonly names?: Readonly<Record<string, string>>;
    }) => {
      if (next.board === null || (version.current !== null && next.version <= version.current)) {
        return;
      }
      version.current = next.version;
      setBoard(next.board);
      setNames(next.names ?? {});
    },
  );
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- polls the relay for the board while it is open and the tab is visible
  useEffect(() => {
    let stopped = false;
    let reading = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const hidden = () => document.visibilityState === "hidden";
    const poll = async () => {
      clearTimeout(timer);
      if (stopped || reading || hidden()) return;
      reading = true;
      const read = await readTeamBoard(teamId, version.current);
      reading = false;
      if (stopped) return;
      failures = read.ok ? 0 : failures + 1;
      setReachable(read.ok);
      if (read.ok) take(read.value);
      if (!hidden()) timer = setTimeout(() => void poll(), pollDelay(failures));
    };
    const onVisibility = () => {
      if (hidden()) return clearTimeout(timer);
      // Threads and members may have changed while the tab was away too.
      refreshTeams(teamId);
      void poll();
    };
    document.addEventListener("visibilitychange", onVisibility);
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [teamId, take]);
  const change = async (boardChange: RoomBoardChange) => {
    const changed = await changeTeamBoard(teamId, boardChange);
    if (!changed.ok) {
      toastManager.add({ type: "error", title: changed.message });
      return false;
    }
    take(changed.value);
    return true;
  };
  return { board, names, reachable, change };
}

/**
 * One board for the whole team, kept on T Connect so it is there while every member's machine is
 * off. Each shared thread and each member has a card; notes, tasks, links and arrows work as on a
 * thread's board. Nothing on it reaches an agent.
 */
export function TeamBoard({
  team,
  accountId,
  onShowThreads,
}: {
  readonly team: RelayTeam;
  readonly accountId: string;
  readonly onShowThreads: () => void;
}) {
  const { board, names, reachable, change } = useTeamBoard(team.id);
  if (board === null) {
    return (
      <p className="p-6 text-center text-muted-foreground text-sm">
        {reachable ? "Loading the board..." : "Cannot reach T Connect. Trying again."}
      </p>
    );
  }
  const memberIds = new Set(team.members.map((member) => member.userId));
  // People who left keep their name on the notes they wrote or were given.
  const guests: ReadonlyArray<ThreadGuest> = team.members.map((member) => ({
    id: GuestId.make(member.userId),
    name: member.name,
    joinedAt: "",
  }));
  const formerPeople = Object.entries(names)
    .filter(([userId]) => !memberIds.has(userId))
    .map(([id, name]) => ({ id, name }));
  const cards: ReadonlyArray<BoardCardSpec> = [
    ...team.threads.map((thread) => ({
      id: teamBoardThreadCard(thread.environmentId, thread.threadId),
      title: thread.title || "Shared thread",
      kind: "thread",
      children: <TeamThreadCard team={team} thread={thread} />,
    })),
    ...team.members.map((member) => {
      const shared = team.threads.filter((thread) => thread.ownerUserId === member.userId).length;
      return {
        id: roomBoardGuestCard(member.userId),
        title: member.userId === accountId ? `${member.name} (you)` : member.name,
        kind: member.role,
        dashed: true,
        children: (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <MemberAvatar name={member.name} avatarUrl={member.avatarUrl} />
            {shared === 0
              ? "No threads shared"
              : `${shared} thread${shared === 1 ? "" : "s"} shared`}
          </div>
        ),
      };
    }),
  ];
  const summary = `${team.members.length} member${team.members.length === 1 ? "" : "s"}, ${team.threads.length} thread${team.threads.length === 1 ? "" : "s"}`;
  return (
    <RoomBoard
      title="Team board"
      room={{ guests, messages: [], board }}
      online={[]}
      messages={[]}
      viewer={GuestId.make(accountId)}
      ownerName={undefined}
      cursorLayer={null}
      onOpenThread={onShowThreads}
      // Comments pin to one thread's replies, so a team's board has none.
      onOpenReply={() => undefined}
      onChange={change}
      onCursor={undefined}
      onUseNote={undefined}
      cards={cards}
      summary={reachable ? summary : "Cannot reach T Connect. Trying again."}
      backLabel="Threads"
      ownerAssignable={false}
      formerPeople={formerPeople}
    />
  );
}

function TeamThreadCard({
  team,
  thread,
}: {
  readonly team: RelayTeam;
  readonly thread: RelayTeamThread;
}) {
  const { state, open } = useOpenTeamThread(team.id, thread);
  const sharedBy = team.members.find((member) => member.userId === thread.ownerUserId)?.name;
  return (
    <>
      <p className="text-muted-foreground text-xs">
        {state !== "idle" && state !== "opening"
          ? state
          : sharedBy === undefined
            ? "Shared with the team"
            : `Shared by ${sharedBy}`}
      </p>
      <div>
        <Button
          size="xs"
          variant="outline"
          disabled={state === "opening"}
          onClick={() => void open()}
        >
          {state === "opening" ? "Opening..." : "Open thread"}
        </Button>
      </div>
    </>
  );
}
