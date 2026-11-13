import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import { deriveThreadStructureRuntime } from "@t3tools/client-runtime/state/thread-execution";
import {
  GUEST_NAME_MAX_LENGTH,
  type GuestShareId,
  type ModelSelection,
  ROOM_BOARD_ROOM_BOX,
  type RoomBoardChange,
  type RoomBoardNote,
  type ScopedThreadRef,
  type ServerProvider,
  type ThreadGuest,
  type ThreadGuestMessage,
  type ThreadId,
  roomCodeStateOf,
} from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { randomUUID } from "~/lib/utils";
import { deriveThreadAgentWorking } from "~/session-logic";
import { useGitStackedAction, useSourceControlActionRunning } from "~/state/sourceControlActions";
import {
  useProject,
  useQuietThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { environmentThreadDetails } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { vcsEnvironment } from "~/state/vcs";

import { useGuestMessageResolver } from "../chat/GuestShareControls";
import {
  boardContextCards,
  boardTurnSelection,
  ownerWritingArtifactId,
} from "../chat/roomBoardPrompt";
import { takeRoomTaskToDraft } from "../chat/roomTaskDraft";
import { resolveQuickAction } from "../GitActionsControl.logic";
import { Button } from "../ui/button";
import { SidebarInset } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { BoardChatPanel } from "./BoardChatPanel";
import { BoardThreadPicker } from "./BoardThreadPicker";
import {
  BoardModelName,
  BoardModelPicker,
  ThreadBoardModelName,
  ThreadBoardModelPicker,
  composerDraftPick,
} from "./BoardModelPicker";
import { BoardSplit } from "./BoardSplit";
import { RoomBoard, RoomCursors } from "./RoomBoard";
import { RoomReplyProvider, revealRoomReply } from "./RoomReplyComments";
import { BoxApproval } from "./RoomBoardThreadBox";
import {
  BOARD_THREAD_MESSAGES,
  EMPTY_ROOM_BOARD,
  appendNoteToDraft,
  type BoardPoint,
  type BoardPrompt,
  boardMessages,
} from "./roomBoard.logic";
import { RoomLiveContext, type RoomLiveStore, createRoomLiveStore } from "./roomBoardLive";

const NO_GUESTS: ReadonlyArray<ThreadGuest> = [];
const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const NO_BOARD_THREADS: Readonly<Record<string, ThreadId>> = {};
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

/**
 * The owner's board for a thread they share, read from the thread and changed on its server, with
 * a conversation beside it. `chat` names the thread box whose conversation is open, from the URL.
 */
export function ThreadRoomBoard({
  threadRef,
  chat,
  onChat,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly chat: string | null;
  readonly onChat: (chat: string | null) => void;
}) {
  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const { structure, share, onChange } = useOwnerRoom(threadRef);
  const items = useThreadVisibleTurnItems(threadRef);
  const [live] = useState(createRoomLiveStore);
  const { data: presence } = useEnvironmentQuery(
    serverEnvironment.guestPresence({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canPoint = useAtomValue(
    serverEnvironment.moveGuestRoomCursor.permissionAtom(threadRef.environmentId),
  );
  const moveCursor = useAtomCommand(serverEnvironment.moveGuestRoomCursor, {
    label: "show your pointer",
    reportFailure: false,
  });
  const openFullThread = useStableCallback(
    () =>
      void navigate({
        to: "/$environmentId/$threadId",
        params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
      }),
  );
  const openPanel = (boxId: string = ROOM_BOARD_ROOM_BOX) => onChat(boxId);
  const putInDraft = (text: string) => {
    // Only a draft: the owner reads it and sends it themselves.
    const store = useComposerDraftStore.getState();
    const draft = store.getComposerDraft(threadRef)?.prompt ?? "";
    store.setPrompt(threadRef, appendNoteToDraft(draft, text));
    openPanel();
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
  const agentWorking = structure !== null && deriveThreadAgentWorking(structure);
  const writingArtifactId =
    structure === null
      ? null
      : ownerWritingArtifactId(
          items.map((projected) => projected.item),
          deriveThreadStructureRuntime(structure)?.activeRunId,
          share?.id,
        );
  const pendingRequests = useAtomValue(environmentThreadDetails.pendingRequestsAtom(threadRef));
  const providers = useEnvironmentProviders().get(threadRef.environmentId) ?? NO_PROVIDERS;
  // As guests see it, so what the owner sends names them the way the room does.
  const ownerName = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) =>
      settings.guestOwnerName.trim().slice(0, GUEST_NAME_MAX_LENGTH).trim() || undefined,
  );
  const canPrompt = useAtomValue(
    serverEnvironment.promptRoomBox.permissionAtom(threadRef.environmentId),
  );
  const promptRoomBox = useAtomCommand(serverEnvironment.promptRoomBox, "send the prompt");
  const boardThreads = share?.boardThreads ?? NO_BOARD_THREADS;
  const canAddThread = useAtomValue(
    serverEnvironment.addRoomBoxThread.permissionAtom(threadRef.environmentId),
  );
  const addRoomBoxThread = useAtomCommand(
    serverEnvironment.addRoomBoxThread,
    "add the thread to the board",
  );
  // Where the box goes once the owner picks which of their threads it is.
  const [addingAt, setAddingAt] = useState<BoardPoint | null>(null);
  // What the room thread's composer would send with now; a new box starts from it.
  const roomPick = useComposerDraftStore((store) =>
    composerDraftPick(store.getComposerDraft(threadRef)),
  );
  const roomSelection = roomPick ?? shell?.modelSelection ?? null;
  // A box with no conversation yet has no composer to keep its pick, so the board keeps it.
  const [boxPicks, setBoxPicks] = useState<Readonly<Record<string, ModelSelection>>>({});
  const boxThreadRef = (boxId: string) => {
    if (boxId === ROOM_BOARD_ROOM_BOX) return threadRef;
    const threadId = boardThreads[boxId];
    return threadId === undefined ? null : scopeThreadRef(threadRef.environmentId, threadId);
  };
  // The pick a box's prompt runs with; none leaves its own thread's model.
  const boxSelection = (boxId: string): ModelSelection | undefined => {
    const ref = boxThreadRef(boxId);
    if (ref === null) return boxPicks[boxId] ?? roomSelection ?? undefined;
    const picked = composerDraftPick(useComposerDraftStore.getState().getComposerDraft(ref));
    return (
      picked ?? (boxId === ROOM_BOARD_ROOM_BOX ? (shell?.modelSelection ?? undefined) : undefined)
    );
  };
  const sendingRef = useRef(false);
  const promptBox = async (boxId: string, prompt: BoardPrompt) => {
    if (share === null || sendingRef.current) return false;
    const selection = boxSelection(boxId);
    // As the composer sends it: the options picked, and an effort the model reads from the prompt.
    const turn =
      selection === undefined
        ? { modelSelection: undefined, text: prompt.text }
        : boardTurnSelection({ selection, providers, text: prompt.text });
    sendingRef.current = true;
    const result = await promptRoomBox({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        boxId,
        text: turn.text,
        cards: boardContextCards(share.board, share.guests ?? NO_GUESTS, prompt.cards, ownerName),
        ...(prompt.artifactId === null ? {} : { artifactId: prompt.artifactId }),
        ...(turn.modelSelection === undefined ? {} : { modelSelection: turn.modelSelection }),
      },
    });
    sendingRef.current = false;
    return result._tag === "Success";
  };
  const requests = useGuestMessageResolver(threadRef);
  const resolveRequest = (message: ThreadGuestMessage, decision: "send" | "dismiss") =>
    void requests.resolve(
      message.id,
      decision,
      message.boxId === undefined ? undefined : boxSelection(message.boxId),
    );
  const thread = structure?.thread ?? null;
  const projectId = thread?.projectId ?? null;
  const project = useProject(
    projectId === null ? null : scopeProjectRef(threadRef.environmentId, projectId),
  );
  const renderBoxModel = (boxId: string) => {
    const ref = boxThreadRef(boxId);
    if (ref !== null) {
      return (
        <ThreadBoardModelPicker threadRef={ref} projectId={projectId} fallback={roomSelection} />
      );
    }
    const selection = boxPicks[boxId] ?? roomSelection;
    return selection === null ? null : (
      <BoardModelPicker
        environmentId={threadRef.environmentId}
        projectId={projectId}
        selection={selection}
        onChange={(next) => setBoxPicks((current) => ({ ...current, [boxId]: next }))}
      />
    );
  };
  // What a guest's request would run on: the box's own thread's model, else what a new box starts from.
  const renderRequestModel = (boxId: string) => {
    const ref = boxThreadRef(boxId);
    if (ref !== null) return <ThreadBoardModelName threadRef={ref} fallback={roomSelection} />;
    const selection = boxPicks[boxId] ?? roomSelection;
    return selection === null ? null : (
      <BoardModelName environmentId={threadRef.environmentId} selection={selection} />
    );
  };
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
  const title = shell?.title ?? "Board";
  const panelRef = chat === null ? null : boxThreadRef(chat);
  const panelTitle =
    chat === null || chat === ROOM_BOARD_ROOM_BOX
      ? title
      : share?.board?.notes.find((note) => note.id === chat)?.text.trim() || "Thread box";
  const closePanel = useStableCallback(() => onChat(null));
  const popOut = useStableCallback(() => {
    if (panelRef === null) return;
    void navigate({
      to: "/$environmentId/$threadId",
      params: { environmentId: panelRef.environmentId, threadId: panelRef.threadId },
    });
  });
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-none">
      <RoomLiveContext value={live}>
        {share === null ? null : (
          <OwnerBoardLive threadRef={threadRef} shareId={share.id} live={live} />
        )}
        <BoardSplit
          open={chat !== null}
          board={
            <RoomBoard
              title={title}
              room={share}
              online={presence?.online ?? []}
              messages={boardMessages(
                items.map((projected) => projected.item),
                BOARD_THREAD_MESSAGES,
              )}
              agentWorking={agentWorking}
              viewer={null}
              ownerName={ownerName}
              cursorLayer={
                share === null ? null : (
                  <OwnerBoardCursors
                    threadRef={threadRef}
                    shareId={share.id}
                    guests={share.guests ?? NO_GUESTS}
                  />
                )
              }
              onOpenThread={() => openPanel()}
              onBack={openFullThread}
              onOpenReply={(messageId) => {
                revealRoomReply(messageId);
                openPanel();
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
              onPromptBox={share !== null && canPrompt ? promptBox : undefined}
              onAddThread={share !== null && canAddThread ? setAddingAt : undefined}
              renderBoxModel={renderBoxModel}
              onOpenConversation={openPanel}
              renderRequestModel={renderRequestModel}
              onResolveRequest={requests.canOperate ? resolveRequest : undefined}
              resolvingRequests={requests.busyIds}
              ownerWritingArtifactId={writingArtifactId}
              needsApproval={(pendingRequests?.approvals.length ?? 0) > 0}
              renderBoxApproval={(boxId) => {
                const ref = boxThreadRef(boxId);
                return ref === null ? null : (
                  <BoxApproval
                    threadRef={ref}
                    onOpen={boxId === ROOM_BOARD_ROOM_BOX ? () => openPanel() : undefined}
                  />
                );
              }}
            />
          }
          panel={
            chat === null ? null : panelRef === null ? (
              <BoardPanelEmpty title={panelTitle} onClose={closePanel} />
            ) : (
              <BoardChatPanel
                environmentId={panelRef.environmentId}
                threadId={panelRef.threadId}
                title={panelTitle}
                onClose={closePanel}
                onPopOut={popOut}
              />
            )
          }
        />
        {addingAt === null ? null : (
          <BoardThreadPicker
            environmentId={threadRef.environmentId}
            excluded={new Set([threadRef.threadId, ...Object.values(boardThreads)])}
            onPick={(picked) =>
              addRoomBoxThread({
                environmentId: threadRef.environmentId,
                input: {
                  threadId: threadRef.threadId,
                  boxId: randomUUID(),
                  boxThreadId: picked.id,
                  ...addingAt,
                },
              }).then((result) => result._tag === "Success")
            }
            onClose={() => setAddingAt(null)}
          />
        )}
      </RoomLiveContext>
    </SidebarInset>
  );
}

/** A box whose conversation has not started: its first prompt starts it. */
function BoardPanelEmpty({
  title,
  onClose,
}: {
  readonly title: string;
  readonly onClose: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-border pr-1 pl-3">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{title}</span>
        <Button variant="ghost" size="icon-xs" aria-label="Close conversation" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <p className="p-4 text-sm text-muted-foreground">
        This thread box has no conversation yet. Prompt it from its box on the board to start one.
      </p>
    </div>
  );
}

/**
 * What runs in the room now, read here and kept in the board's live store, so a progress tick
 * renders only the cards it changes and never the whole board.
 */
function OwnerBoardLive({
  threadRef,
  shareId,
  live,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly shareId: GuestShareId;
  readonly live: RoomLiveStore;
}) {
  const { data } = useEnvironmentQuery(
    serverEnvironment.guestRoomAgents({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, shareId },
    }),
  );
  const running = data?.running;
  const boxes = data?.boxes;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the room's live runs to the board's store, which lives outside React
  useEffect(() => {
    live.setRunning(running ?? []);
    live.setBoxes(boxes);
  }, [live, running, boxes]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- stops the store's clock once the board closes
  useEffect(
    () => () => {
      live.setRunning([]);
      live.setBoxes(undefined);
    },
    [live],
  );
  return null;
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
