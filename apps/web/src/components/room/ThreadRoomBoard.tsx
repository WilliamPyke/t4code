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
  unsharedRoomId,
} from "@t3tools/contracts";
import { roomArtifactSource } from "@t3tools/shared/roomBoard";
import { useNavigate } from "@tanstack/react-router";
import { MessagesSquareIcon, XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentSettings } from "~/hooks/useSettings";
import { useStableCallback } from "~/hooks/useStableCallback";
import { useThreadActions } from "~/hooks/useThreadActions";
import { cn, randomUUID } from "~/lib/utils";
import { deriveThreadAgentWorking } from "~/session-logic";
import { useGitStackedAction, useSourceControlActionRunning } from "~/state/sourceControlActions";
import {
  useProject,
  useQuietThreadProjection,
  useQuietThreadShells,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { environmentThreadDetails, threadEnvironment } from "~/state/threads";
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
import { BoardTitle } from "../boards/BoardTitle";
import { BoardChatPanel } from "./BoardChatPanel";
import { BOARD_TITLE_BAR_CLASS } from "./BoardChrome";
import { BoardSharing } from "./BoardSharing";
import { BoardThreadPicker } from "./BoardThreadPicker";
import { BoardModelPicker, ThreadBoardModelPicker, composerDraftPick } from "./BoardModelPicker";
import { boardAgentEndOf } from "./boardAgents.logic";
import {
  type BoardLocalModelPick,
  boardBoxModelPick,
  boardLocalModelPick,
  boardModelName,
  boardNewBoxModel,
} from "./boardBoxModel.logic";
import type { BoardViewMode } from "./boardPlan.logic";
import { BoardSplit } from "./BoardSplit";
import { RoomBoard, RoomCursors } from "./RoomBoard";
import { RoomReplyProvider, revealRoomReply } from "./RoomReplyComments";
import { BoxApproval } from "./RoomBoardThreadBox";
import {
  ROOM_CODE_PATCH_UNREADABLE,
  type ReadRoomCodePatch,
  roomCodePatchRead,
} from "./RoomBoardCode";
import {
  BOARD_THREAD_MESSAGES,
  EMPTY_ROOM_BOARD,
  appendNoteToDraft,
  type BoardPoint,
  type BoardPrompt,
  boardChangeOutgrowsOlderHosts,
  boardMessages,
} from "./roomBoard.logic";
import { roomBoardViewKey } from "./roomBoardNavigation";
import { RoomLiveContext, type RoomLiveStore, createRoomLiveStore } from "./roomBoardLive";

const NO_GUESTS: ReadonlyArray<ThreadGuest> = [];
const NO_PROVIDERS: ReadonlyArray<ServerProvider> = [];
const NO_BOARD_THREADS: Readonly<Record<string, ThreadId>> = {};
const NO_GUEST_MESSAGES: ReadonlyArray<ThreadGuestMessage> = [];
const GIT_ACTIONS = ["runStackedAction", "pull", "publishRepository"] as const;

/** The share of a thread its owner reads, and how they change its board when they may. */
function useOwnerRoom(threadRef: ScopedThreadRef | null) {
  const structure = useQuietThreadProjection(threadRef)?.projection ?? null;
  const share = structure?.thread.guestShare ?? null;
  const kept = structure?.thread.roomBoard ?? null;
  const canChange = useAtomValue(
    serverEnvironment.changeGuestBoard.permissionAtom(threadRef?.environmentId ?? null),
  );
  const changeBoard = useAtomCommand(serverEnvironment.changeGuestBoard, "change the board");
  // A server from before artifact views and copies, or the larger card sizes, refuses them, and
  // the card stays as it was; the board says so for a size.
  const changeBoardQuietly = useAtomCommand(serverEnvironment.changeGuestBoard, {
    reportFailure: false,
    reportDefect: false,
  });
  const onChange =
    threadRef !== null && canChange
      ? (change: RoomBoardChange) =>
          (change.type === "artifact.copy" ||
            change.type === "artifact.view" ||
            boardChangeOutgrowsOlderHosts(change)
            ? changeBoardQuietly
            : changeBoard)({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId, change },
          }).then((result) => result._tag === "Success")
      : undefined;
  return { structure, share, kept, onChange };
}

/**
 * The owner's timeline with the room's comments on its replies, while the thread has a board.
 * Comments live on the board, so they never reach the agent.
 */
export function OwnerRoomReplies({
  threadRef,
  children,
}: {
  readonly threadRef: ScopedThreadRef | null;
  readonly children: ReactNode;
}) {
  const { share, kept, onChange } = useOwnerRoom(threadRef);
  return (
    <RoomReplyProvider
      room={
        share === null && kept === null
          ? null
          : {
              board: share?.board ?? kept?.board ?? EMPTY_ROOM_BOARD,
              people: { guests: share?.guests ?? NO_GUESTS, viewer: null },
              onChange,
            }
      }
    >
      {children}
    </RoomReplyProvider>
  );
}

/**
 * The owner's board of a thread, shared or not, read from the thread and changed on its server, with
 * a conversation beside it. `chat` names the thread box whose conversation is open, from the URL.
 */
export function ThreadRoomBoard({
  threadRef,
  chat,
  onChat,
  view,
  onView,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly chat: string | null;
  readonly onChat: (chat: string | null) => void;
  readonly view: BoardViewMode;
  readonly onView: (view: BoardViewMode) => void;
}) {
  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const { structure, share, kept, onChange } = useOwnerRoom(threadRef);
  // Unshared, the owner works alone on the board the thread keeps, or an empty one it starts.
  const room = share ?? {
    board: kept?.board ?? EMPTY_ROOM_BOARD,
    messages: NO_GUEST_MESSAGES,
  };
  const roomId = share?.id ?? unsharedRoomId(threadRef.threadId);
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
  // Boards come first: the header's way back is the boards home; the thread opens from its box.
  const openBoards = useStableCallback(() => void navigate({ to: "/" }));
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
    takeRoomTaskToDraft({ threadRef, shareId: roomId, taskId: task.id, text: task.text });
  };
  const agentWorking = structure !== null && deriveThreadAgentWorking(structure);
  const writingArtifactId =
    structure === null
      ? null
      : ownerWritingArtifactId(
          items.map((projected) => projected.item),
          deriveThreadStructureRuntime(structure)?.activeRunId,
          roomId,
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
  // A file that cannot be read says so in its window instead of in a toast.
  const readPatch = useAtomCommand(serverEnvironment.readRoomCodePatch, { reportFailure: false });
  const readCodePatch: ReadRoomCodePatch = ({ note, path, scope }) =>
    readPatch({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, noteId: note.id, path, scope },
    }).then((result) =>
      result._tag === "Success" ? roomCodePatchRead(result.value) : ROOM_CODE_PATCH_UNREADABLE,
    );
  const boardThreads = share?.boardThreads ?? kept?.boardThreads ?? NO_BOARD_THREADS;
  const canRefreshPullRequest = useAtomValue(
    serverEnvironment.refreshRoomPullRequest.permissionAtom(threadRef.environmentId),
  );
  // A read that cannot be asked for shows as the window's own state, not a toast.
  const refreshPullRequest = useAtomCommand(serverEnvironment.refreshRoomPullRequest, {
    reportFailure: false,
  });
  const onRefreshPullRequest = (noteId: string) =>
    void refreshPullRequest({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, noteId },
    });
  // The pull request each of the owner's box threads is linked to, as this app tracks it.
  const shells = useQuietThreadShells();
  const boxPullRequestUrl = (boxId: string) => {
    const boxThreadId = boxId === ROOM_BOARD_ROOM_BOX ? threadRef.threadId : boardThreads[boxId];
    const shell = shells.find(
      (candidate) =>
        candidate.environmentId === threadRef.environmentId && candidate.id === boxThreadId,
    );
    return (
      shell?.pullRequests.findLast((link) => link.source !== "stack-dismissed")?.url ??
      shell?.linkedPullRequest?.url
    );
  };
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
  // The board keeps the room box's pick too: another provider's waits for a turn to reach the thread.
  const roomSelection =
    boardBoxModelPick({
      picked: roomPick,
      chosen: room.board?.roomBoxModel,
      lastRunAt: shell === null ? undefined : (shell.latestRun?.requestedAt ?? null),
    }) ??
    shell?.modelSelection ??
    null;
  // The board keeps each of the owner's boxes' pick; this one until the board shows it.
  const [boxPicks, setBoxPicks] = useState<Readonly<Record<string, BoardLocalModelPick>>>({});
  // Only the owner's own boxes: a guest's box pick names a model on the guest's machine.
  const ownBox = (boxId: string) =>
    room.board?.notes.find(
      (note) => note.id === boxId && note.kind === "thread" && note.guestId === undefined,
    );
  const ownBoxModel = (boxId: string) =>
    boxId === ROOM_BOARD_ROOM_BOX ? room.board?.roomBoxModel : ownBox(boxId)?.boxModel;
  // A box the owner adds starts on the model they last picked for one of theirs here.
  const newBoxSelection = boardNewBoxModel(room.board, null) ?? roomSelection;
  const boxThreadRef = (boxId: string) => {
    if (boxId === ROOM_BOARD_ROOM_BOX) return threadRef;
    const threadId = boardThreads[boxId];
    return threadId === undefined ? null : scopeThreadRef(threadRef.environmentId, threadId);
  };
  const boxShell = (ref: ScopedThreadRef) =>
    shells.find(
      (candidate) => candidate.environmentId === ref.environmentId && candidate.id === ref.threadId,
    );
  // The pick a box's prompt runs with; none leaves its own thread's model.
  const boxSelection = (boxId: string): ModelSelection | undefined => {
    const ref = boxThreadRef(boxId);
    const box = ownBox(boxId);
    const chosen = box?.boxModel;
    if (ref === null) {
      const local = boardLocalModelPick(boxPicks[boxId], chosen);
      // A guest's box, whose request the owner sends: on the owner's pick for it, or the room's.
      if (box === undefined && room.board?.notes.some((note) => note.id === boxId)) {
        return local ?? roomSelection ?? undefined;
      }
      return local ?? chosen?.selection ?? newBoxSelection ?? undefined;
    }
    if (boxId === ROOM_BOARD_ROOM_BOX) return roomSelection ?? undefined;
    const picked = composerDraftPick(useComposerDraftStore.getState().getComposerDraft(ref));
    const run = boxShell(ref)?.latestRun;
    return boardBoxModelPick({
      picked,
      chosen,
      lastRunAt: run === undefined ? undefined : (run?.requestedAt ?? null),
    });
  };
  // The owner's pick for one of their boxes: theirs on the board, and here until it shows there.
  const pickBoxModel = (boxId: string, selection: ModelSelection, name: string) => {
    // The room thread's composer draft holds this device's pick until the board shows it.
    if (boxId === ROOM_BOARD_ROOM_BOX) {
      void onChange?.({ type: "box.model", noteId: boxId, modelSelection: selection, name });
      return;
    }
    const box = ownBox(boxId);
    setBoxPicks((current) => ({
      ...current,
      [boxId]: { selection, name, over: box?.boxModel?.at },
    }));
    if (box !== undefined) {
      void onChange?.({ type: "box.model", noteId: boxId, modelSelection: selection, name });
    }
  };
  const sendingRef = useRef(false);
  const promptBox = async (boxId: string, prompt: BoardPrompt) => {
    if (sendingRef.current) return false;
    const selection = boxSelection(prompt.modelOf ?? boxId);
    // As the composer sends it: the options picked, and an effort the model reads from the prompt.
    const turn =
      selection === undefined
        ? { modelSelection: undefined, text: prompt.text }
        : boardTurnSelection({ selection, providers, text: prompt.text });
    // The version the owner saw: the server refuses the prompt once the artifact shows another.
    const artifact =
      prompt.artifactId === null ? undefined : roomArtifactSource(room.board, prompt.artifactId);
    sendingRef.current = true;
    const result = await promptRoomBox({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        boxId,
        text: turn.text,
        cards: boardContextCards(room.board, share?.guests ?? NO_GUESTS, prompt.cards, ownerName),
        ...(prompt.artifactId === null ? {} : { artifactId: prompt.artifactId }),
        ...(artifact === undefined
          ? {}
          : { artifactUpdatedAt: artifact.artifact?.updatedAt ?? null }),
        ...(prompt.commentId === undefined ? {} : { commentId: prompt.commentId }),
        ...(turn.modelSelection === undefined ? {} : { modelSelection: turn.modelSelection }),
      },
    });
    sendingRef.current = false;
    // A box made by asking took its pick before it was on the board; the board keeps it now.
    const local = boxPicks[boxId];
    const guests = room.board?.notes.some(
      (note) => note.id === boxId && note.guestId !== undefined,
    );
    if (result._tag === "Success" && local !== undefined && local.over === undefined && !guests) {
      void onChange?.({
        type: "box.model",
        noteId: boxId,
        modelSelection: local.selection,
        name: local.name,
      });
    }
    return result._tag === "Success";
  };
  const { deleteThread } = useThreadActions();
  // Only the owner's own boxes: the room thread is the board's, and a guest's box is theirs.
  const boxChatDeleter = (boxId: string) => {
    const ref = ownBox(boxId) === undefined ? null : boxThreadRef(boxId);
    return ref === null ? undefined : () => void deleteThread(ref);
  };
  const interruptTurn = useAtomCommand(threadEnvironment.interruptTurn, "stop the agent");
  // The owner's agent runs their own boxes and the guests' requests they sent, in the box's thread.
  const stopBox = (boxId: string) => {
    const ref = boxThreadRef(boxId);
    return ref === null
      ? undefined
      : () =>
          void interruptTurn({
            environmentId: ref.environmentId,
            input: { threadId: ref.threadId },
          });
  };
  const requests = useGuestMessageResolver(threadRef);
  const resolveRequest = (message: ThreadGuestMessage, decision: "send" | "dismiss") =>
    void requests.resolve(message.id, decision, boxSelection(message.boxId ?? ROOM_BOARD_ROOM_BOX));
  const thread = structure?.thread ?? null;
  const projectId = thread?.projectId ?? null;
  const project = useProject(
    projectId === null ? null : scopeProjectRef(threadRef.environmentId, projectId),
  );
  const renderBoxModel = (boxId: string) => {
    const ref = boxThreadRef(boxId);
    const chosen = ownBoxModel(boxId);
    if (ref !== null) {
      return (
        <ThreadBoardModelPicker
          threadRef={ref}
          projectId={projectId}
          fallback={chosen?.selection ?? roomSelection}
          chosen={chosen}
          onPicked={(selection, name) => pickBoxModel(boxId, selection, name)}
        />
      );
    }
    const selection = boxSelection(boxId) ?? null;
    return selection === null ? null : (
      <BoardModelPicker
        environmentId={threadRef.environmentId}
        projectId={projectId}
        selection={selection}
        onChange={(next, name) => pickBoxModel(boxId, next, name)}
      />
    );
  };
  // How each box's last run ended, from its thread's record here.
  const boxRunEnd = (boxId: string) => {
    // A guest's box runs on their machine too, whose record this client cannot read.
    if (room.board?.notes.some((note) => note.id === boxId && note.guestId !== undefined)) {
      return undefined;
    }
    const ref = boxThreadRef(boxId);
    if (ref === null) return null;
    const found = boxShell(ref);
    return found === undefined
      ? undefined
      : (boardAgentEndOf(found.latestRun, found.source.latestRunStopRequested === true) ?? null);
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
  const chatBox =
    chat === null || chat === ROOM_BOARD_ROOM_BOX
      ? undefined
      : room.board?.notes.find((note) => note.id === chat && note.kind === "thread");
  const chatRef = chat === null ? null : boxThreadRef(chat);
  const chatShell = useThreadShell(chatRef);
  // A box taken off the board, or whose thread is gone, opens on the room thread instead.
  const panelChat =
    chat !== null &&
    chat !== ROOM_BOARD_ROOM_BOX &&
    (chatBox === undefined || (chatRef !== null && chatShell === null))
      ? ROOM_BOARD_ROOM_BOX
      : chat;
  const panelRef = panelChat === chat ? chatRef : threadRef;
  const boxGone =
    structure !== null && chat !== null && chat !== ROOM_BOARD_ROOM_BOX && chatBox === undefined;
  const showRoomChat = useStableCallback(() => onChat(ROOM_BOARD_ROOM_BOX));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the URL names the open box; once that box is off the board, it names the room thread's conversation the panel shows instead
  useEffect(() => {
    if (boxGone) showRoomChat();
  }, [boxGone, showRoomChat]);
  const panelTitle =
    panelChat === null || panelChat === ROOM_BOARD_ROOM_BOX
      ? title
      : chatBox?.text.trim() || "Thread box";
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
        <OwnerBoardLive threadRef={threadRef} shareId={roomId} live={live} />
        <BoardSplit
          open={chat !== null}
          board={
            <RoomBoard
              title={title}
              room={room}
              shareId={roomId}
              viewKey={roomBoardViewKey(threadRef)}
              view={view}
              onViewChange={onView}
              onToggleChat={() => (chat === null ? openPanel() : closePanel())}
              sharing={<BoardSharing threadRef={threadRef} shared={share !== null} />}
              titleEditor={<BoardTitle threadRef={threadRef} title={title} />}
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
              onBack={openBoards}
              backLabel="Boards"
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
              onPromptBox={canPrompt ? promptBox : undefined}
              stopBox={canPrompt ? stopBox : undefined}
              boxChatDeleter={boxChatDeleter}
              boxRunEnd={boxRunEnd}
              roomModel={
                roomSelection === null ? undefined : boardModelName(roomSelection, providers)
              }
              askInComments
              readCodePatch={readCodePatch}
              onRefreshPullRequest={canRefreshPullRequest ? onRefreshPullRequest : undefined}
              boxPullRequestUrl={boxPullRequestUrl}
              onAddThread={canAddThread ? setAddingAt : undefined}
              renderBoxModel={renderBoxModel}
              onOpenConversation={openPanel}
              renderRequestModel={renderBoxModel}
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
            panelChat === null ? null : panelRef === null ? (
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
      <div className={cn(BOARD_TITLE_BAR_CLASS, "gap-1 pe-1")}>
        <MessagesSquareIcon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="ms-1 min-w-0 flex-1 truncate font-semibold">{title}</span>
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
