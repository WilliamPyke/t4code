import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  type GuestShareId,
  type RoomBoardChange,
  type RoomBoardNote,
  type ScopedThreadRef,
  type ThreadGuest,
  roomCodeStateOf,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { randomUUID } from "~/lib/utils";
import { deriveThreadAgentWorking } from "~/session-logic";
import { useGitStackedAction, useSourceControlActionRunning } from "~/state/sourceControlActions";
import {
  useProject,
  useQuietThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { takeRoomTaskToDraft } from "../chat/roomTaskDraft";
import { resolveQuickAction } from "../GitActionsControl.logic";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { RoomBoard, RoomCursors } from "./RoomBoard";
import { RoomReplyProvider, revealRoomReply } from "./RoomReplyComments";
import {
  BOARD_THREAD_MESSAGES,
  EMPTY_ROOM_BOARD,
  appendNoteToDraft,
  boardMessages,
} from "./roomBoard.logic";

const NO_GUESTS: ReadonlyArray<ThreadGuest> = [];
const GIT_ACTIONS = ["runStackedAction", "pull", "publishRepository"] as const;

/** The share of a thread its owner reads, and how they change its board when they may. */
function useOwnerRoom(threadRef: ScopedThreadRef | null) {
  const structure = useQuietThreadProjection(threadRef)?.projection ?? null;
  const share = structure?.thread.guestShare ?? null;
  const canChange = useAtomValue(
    serverEnvironment.changeGuestBoard.permissionAtom(threadRef?.environmentId ?? null),
  );
  const changeBoard = useAtomCommand(serverEnvironment.changeGuestBoard, "change the board");
  const onChange =
    threadRef !== null && canChange
      ? (change: RoomBoardChange) =>
          changeBoard({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, change },
          }).then((result) => result._tag === "Success")
      : undefined;
  return { structure, share, onChange };
}

/**
 * The owner's timeline with the room's comments on its replies, while the thread is shared.
 * Comments live on the board, so they never reach the agent.
 */
export function OwnerRoomReplies({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  const { share, onChange } = useOwnerRoom(threadRef);
  return (
    <RoomReplyProvider
      room={
        share === null
          ? null
          : {
              board: share.board ?? EMPTY_ROOM_BOARD,
              people: { guests: share.guests ?? NO_GUESTS, viewer: null },
              onChange,
            }
      }
    >
      {children}
    </RoomReplyProvider>
  );
}

/** The owner's board for a thread they share, read from the thread and changed on its server. */
export function ThreadRoomBoard({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const { structure, share, onChange } = useOwnerRoom(threadRef);
  const items = useThreadVisibleTurnItems(threadRef);
  const { data: presence } = useEnvironmentQuery(
    serverEnvironment.guestPresence({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const { data: agents } = useEnvironmentQuery(
    share === null
      ? null
      : serverEnvironment.guestRoomAgents({
          environmentId: threadRef.environmentId,
          input: { threadId: threadRef.threadId, shareId: share.id },
        }),
  );
  const canPoint = useAtomValue(
    serverEnvironment.moveGuestRoomCursor.permissionAtom(threadRef.environmentId),
  );
  const moveCursor = useAtomCommand(serverEnvironment.moveGuestRoomCursor, {
    label: "show your pointer",
    reportFailure: false,
  });
  const openThread = () =>
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
    });
  const putInDraft = (text: string) => {
    // Only a draft: the owner reads it and sends it themselves.
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(threadRef)?.prompt ?? "";
    store.setPrompt(threadRef, appendNoteToDraft(draft, text));
    openThread();
  };
  // The task becomes the owner's, and a draft whose send answers it once the turn finishes.
  const takeTask = (task: RoomBoardNote) => {
    if (share === null) return;
    if (task.assignee === undefined || task.assignee.guestId !== undefined) {
      void onChange?.({
        type: "note.put",
        noteId: task.id,
        text: task.text,
        x: task.x,
        y: task.y,
        assignee: {},
      });
    }
    putInDraft(task.text);
    takeRoomTaskToDraft({ threadRef, shareId: share.id, taskId: task.id, text: task.text });
  };
  const thread = structure?.thread ?? null;
  const project = useProject(
    thread === null ? null : scopeProjectRef(threadRef.environmentId, thread.projectId),
  );
  const cwd = thread?.worktreePath ?? project?.workspaceRoot ?? null;
  const { data: gitStatus } = useEnvironmentQuery(
    share === null || cwd === null
      ? null
      : vcsEnvironment.status({ environmentId: threadRef.environmentId, input: { cwd } }),
  );
  const ownerCode =
    gitStatus === undefined || gitStatus === null || thread === null
      ? undefined
      : (roomCodeStateOf(gitStatus, thread.branch) ?? undefined);
  const sourceControlScope = { environmentId: threadRef.environmentId, cwd };
  const createPullRequest = useGitStackedAction(sourceControlScope);
  const gitBusy = useSourceControlActionRunning(sourceControlScope, GIT_ACTIONS);
  const [openingPullRequest, setOpeningPullRequest] = useState(false);
  // Offered when the thread's own git action would create a pull request right now.
  const canOpenPullRequest =
    createPullRequest.isAllowed &&
    gitStatus !== undefined &&
    gitStatus !== null &&
    (openingPullRequest ||
      resolveQuickAction(gitStatus, gitBusy, gitStatus.isDefaultRef, gitStatus.hasPrimaryRemote)
        .action === "create_pr");
  const openPullRequest = async () => {
    setOpeningPullRequest(true);
    const result = await createPullRequest.run({
      actionId: randomUUID(),
      action: "create_pr",
      threadId: threadRef.threadId,
    });
    setOpeningPullRequest(false);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      const error = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Could not open the pull request",
        description: error instanceof Error ? error.message : "An error occurred.",
      });
    }
  };
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-none">
      <RoomBoard
        title={shell?.title ?? "Board"}
        room={share}
        online={presence?.online ?? []}
        messages={boardMessages(
          items.map((projected) => projected.item),
          BOARD_THREAD_MESSAGES,
        )}
        agentWorking={structure !== null && deriveThreadAgentWorking(structure)}
        running={agents?.running ?? []}
        viewer={null}
        ownerName={undefined}
        cursorLayer={
          share === null ? null : (
            <OwnerBoardCursors
              threadRef={threadRef}
              shareId={share.id}
              guests={share.guests ?? NO_GUESTS}
            />
          )
        }
        onOpenThread={openThread}
        onOpenReply={(messageId) => {
          revealRoomReply(messageId);
          openThread();
        }}
        onChange={onChange}
        onCursor={
          share !== null && canPoint
            ? (presence) =>
                void moveCursor({
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId, shareId: share.id, ...presence },
                })
            : undefined
        }
        onUseNote={putInDraft}
        ownerCode={ownerCode}
        onTakeTask={takeTask}
        onOpenPullRequest={canOpenPullRequest ? () => void openPullRequest() : undefined}
        openingPullRequest={openingPullRequest}
      />
    </SidebarInset>
  );
}

/** The guests' pointers and views, read here so a pointer moving renders only this. */
function OwnerBoardCursors({
  threadRef,
  shareId,
  guests,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly shareId: GuestShareId;
  readonly guests: ReadonlyArray<ThreadGuest>;
}) {
  const { data } = useEnvironmentQuery(
    serverEnvironment.guestRoomCursors({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, shareId },
    }),
  );
  return (
    <RoomCursors
      cursors={data?.cursors ?? []}
      views={data?.views}
      guests={guests}
      ownerName={undefined}
    />
  );
}
