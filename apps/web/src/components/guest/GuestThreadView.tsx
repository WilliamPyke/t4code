import { useAtomValue } from "@effect/atom-react";
import { guestEnvironmentId, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { type GuestShareEndpoint, guestShareRequest } from "@t3tools/client-runtime/rpc";
import { formatAttachmentSize } from "@t3tools/client-runtime/state/attachments";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  deriveRunlessWorkStartedAt,
  deriveThreadActivityRun,
  deriveThreadStructureRuntime,
} from "@t3tools/client-runtime/state/thread-execution";
import { createQuestionHistoryProjector } from "@t3tools/client-runtime/state/thread-requests";
import { shouldShowLoadEarlierControl } from "@t3tools/client-runtime/state/threads";
import {
  GUEST_ATTACHMENT_ROUTE,
  GUEST_BOARD_CURSOR_ROUTE,
  GUEST_BOARD_ROUTE,
  GUEST_HANDOFF_ROUTE,
  GUEST_MEDIA_ROUTE,
  GUEST_MESSAGE_MAX_LENGTH,
  GUEST_ROUTE_PREFIX,
  GUEST_SHARE_PARAM,
  GUEST_SIGN_IN_BEGIN_ROUTE,
  GUEST_SIGN_IN_ROUTE,
  type GuestAccount,
  GuestHandoff,
  GuestMessageId,
  GuestShareId,
  type GuestShareView,
  type GuestSignInFailure,
  GuestSignInStart,
  guestMessageAuthorName,
  type GuestThreadModel,
  type OrchestrationV2ThreadProjection,
  type RoomAgentActivity,
  type RoomBoardChange,
  type RoomBoardNote,
  type ModelSelection,
  type ScopedThreadRef,
  type ThreadGuest,
  type ThreadGuestMessage,
  type ThreadGuestMessageStatus,
} from "@t3tools/contracts";
import { buildJoinLink } from "@t3tools/shared/promptLinks";
import { useNavigate } from "@tanstack/react-router";
import type { LegendListRef } from "@legendapp/list/react";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { ArrowUpIcon, PaperclipIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type Dispatch,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from "react";
import { flushSync } from "react-dom";

import {
  guestRoomAtom,
  guestRoomBoxesAtom,
  guestRoomCursorsAtom,
  guestRoomViewsAtom,
  guestShareEndpointOf,
  guestSharesAtom,
  type JoinedGuestShare,
} from "~/guest/guestShares";
import { useIncrementalTimelineEntries } from "~/hooks/useIncrementalTimelineEntries";
import { useNowMinute } from "~/hooks/useNowMinute";
import { useStableCallback } from "~/hooks/useStableCallback";
import { configuredHostedAppUrl } from "~/hostedPairing";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { deriveActiveWorkStartedAt, derivePhase, deriveThreadAgentWorking } from "~/session-logic";
import { useComposerDraftStore } from "~/composerDraftStore";
import { useEnvironmentProviders } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { environmentThreadDetails, threadEnvironment, useEnvironmentThread } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { ComposerControl, ComposerControlIcon } from "../chat/ComposerControl";
import type { ExpandedImagePreview } from "../chat/ExpandedImagePreview";
import { GuestMessageAttachments } from "../chat/GuestMessageAttachments";
import { HostImageUrlContext } from "../chat/hostImageUrl";
import { PierreEntryIcon } from "../chat/PierreEntryIcon";
import {
  boardContextCards,
  boardTurnSelection,
  guestBoardPromptText,
  guestMessageArtifactTitle,
  ownerWritingArtifactId,
} from "../chat/roomBoardPrompt";
import { GuestMessageName, guestBubbleClassName } from "../chat/guestMessageStyle";
import { GuestTurnList } from "../chat/GuestTurnList";
import { MessagesTimeline, type MessagesTimelineHistoryControls } from "../chat/MessagesTimeline";
import { ProviderInstanceIcon } from "../chat/ProviderInstanceIcon";
import { getDisplayModelName, getTriggerDisplayModelName } from "../chat/providerIconUtils";
import { ScrollToEndButton } from "../chat/TimelineOverlays";
import type { TimelineRow } from "../chat/timelineRowContext";
import { useTimelineFollow } from "../chat/useTimelineFollow";
import { composerDraftPick } from "../room/BoardModelPicker";
import { BoardSplit } from "../room/BoardSplit";
import { RoomBoard, RoomCursors } from "../room/RoomBoard";
import { RoomReplyProvider, revealRoomReply } from "../room/RoomReplyComments";
import {
  BOARD_THREAD_MESSAGES,
  type BoardPresence,
  EMPTY_ROOM_BOARD,
  appendNoteToDraft,
  type BoardPrompt,
  boardMessages,
  boardNoteMessage,
} from "../room/roomBoard.logic";
import { RoomLiveContext, type RoomLiveStore, createRoomLiveStore } from "../room/roomBoardLive";
import { Button } from "../ui/button";
import { SidebarInset, SidebarTrigger } from "../ui/sidebar";
import { toastManager } from "../ui/toast";
import { GuestHtmlRender } from "./GuestHtmlRender";
import { openGuestFile, useGuestFiles } from "./guestFiles";
import {
  formatGuestExpiry,
  guestFilesProblem,
  nextAwaitingRowIds,
  unplacedGuestMessages,
} from "./guestStream.logic";
import { guestTurnItemSource } from "./guestTurnItemSource";
import { type OwnRoomMachine, OwnBoxModelPicker, useOwnRoomMachine } from "./ownRoomMachine";

// A reload keeps the tab's session, so it keeps which messages still wait for a row too.
const AWAITING_ROWS_KEY = "t3:guest-awaiting-rows";
const AWAITING_ROWS_LIMIT = 50;

function readAwaitingRowIds(): ReadonlySet<GuestMessageId> {
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(AWAITING_ROWS_KEY) ?? "[]");
    return new Set(
      Array.isArray(stored)
        ? stored.filter((id) => typeof id === "string").map((id) => GuestMessageId.make(id))
        : [],
    );
  } catch {
    return new Set();
  }
}

function writeAwaitingRowIds(ids: ReadonlySet<GuestMessageId>) {
  try {
    sessionStorage.setItem(AWAITING_ROWS_KEY, JSON.stringify([...ids].slice(-AWAITING_ROWS_LIMIT)));
  } catch {}
}

// Why the GitHub sign-in a share's guest just came back from did not finish. Shown once.
const signInFailures = new Map<string, GuestSignInFailure>();
export function noteGuestSignInFailure(shareId: string, failure: GuestSignInFailure) {
  signInFailures.set(shareId, failure);
}

const decodeErrorBody = Schema.decodeUnknownOption(Schema.Struct({ message: Schema.String }));
const messageOfFailure = (error: unknown) =>
  error instanceof Error && error.message ? error.message : "Try again.";
const decodeHandoff = Schema.decodeUnknownOption(GuestHandoff);
const decodeSignInStart = Schema.decodeUnknownOption(GuestSignInStart);
const UNREACHABLE = "Could not reach the server.";

/** The message a failed guest request carries, or `fallback`. */
async function failureOf(response: Response, fallback: string): Promise<string> {
  const json: unknown = await response.json().catch(() => null);
  return Option.match(decodeErrorBody(json), {
    onNone: () => fallback,
    onSome: ({ message }) => message,
  });
}

/** Posts to a guest route with no body. Resolves to its answer, or to a message for the guest. */
async function postGuestAction<A>(
  endpoint: GuestShareEndpoint,
  route: string,
  decode: (json: unknown) => Option.Option<A>,
  failed: string,
): Promise<A | string> {
  try {
    const response = await guestShareRequest(endpoint, route, { init: { method: "POST" } });
    if (!response.ok) return await failureOf(response, failed);
    return Option.getOrElse(decode(await response.json().catch(() => null)), () => failed);
  } catch {
    return UNREACHABLE;
  }
}

/** Sends one change to the room's board. Resolves to whether the owner's server took it. */
async function postBoardChange(
  endpoint: GuestShareEndpoint,
  change: RoomBoardChange,
): Promise<boolean> {
  try {
    const response = await guestShareRequest(endpoint, GUEST_BOARD_ROUTE, {
      init: {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(change),
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Sends the owner a message from this guest, which waits for them unless they let this guest's
 * messages through. Resolves to what went wrong, or null.
 */
async function postGuestMessage(
  endpoint: GuestShareEndpoint,
  text: string,
  files: ReadonlyArray<File>,
  board: {
    /** The artifact card the reply should rewrite once the owner sends it. */
    readonly artifactId?: string | undefined;
    /** The thread box it was asked from, whose own conversation runs it. */
    readonly boxId?: string;
    /** The board cards that went with it, so the server names them for everyone. */
    readonly cardRefs?: ReadonlyArray<string>;
  } = {},
): Promise<string | null> {
  const form = new FormData();
  form.append("shareId", endpoint.shareId);
  form.append("text", text);
  if (board.artifactId !== undefined) form.append("artifactId", board.artifactId);
  if (board.boxId !== undefined) form.append("boxId", board.boxId);
  if (board.cardRefs !== undefined && board.cardRefs.length > 0) {
    form.append("cardRefs", JSON.stringify(board.cardRefs));
  }
  for (const file of files) form.append("file", file, file.name);
  return guestShareRequest(endpoint, `${GUEST_ROUTE_PREFIX}/messages`, {
    init: { method: "POST", body: form },
  }).then(
    (response) => (response.ok ? null : failureOf(response, "Something went wrong. Try again.")),
    () => UNREACHABLE,
  );
}

/** Shows the room where this guest's pointer is and what their board shows. A lost one is replaced soon. */
function postBoardCursor(endpoint: GuestShareEndpoint, presence: BoardPresence) {
  void guestShareRequest(endpoint, GUEST_BOARD_CURSOR_ROUTE, {
    init: {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(presence),
      // The pointer leaving, or the board closing, is sent even as the page goes away.
      keepalive: presence.at === null,
    },
  }).catch(() => {});
}

const STATUS_LABEL: Record<ThreadGuestMessageStatus, string> = {
  pending: "Waiting for approval",
  sent: "Sent",
  dismissed: "Not sent",
};

/** Same column as the owner's timeline, so both views wrap text at the same width. */
const LANE = "chat-content-lane px-4";

export function GuestNotice({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail?: string;
}) {
  return (
    <div className="m-auto flex max-w-sm flex-col gap-1 p-6 text-center">
      <p className="text-sm font-medium">{title}</p>
      {detail ? <p className="text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

/**
 * A thread someone shared with this browser, in the app's main pane. The guest reads the
 * owner's timeline and proposes messages; nothing here can act on the owner's machine.
 */
export function GuestThreadRoute({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const share =
    useAtomValue(guestSharesAtom).find(
      (candidate) => guestEnvironmentId(candidate.shareId) === threadRef.environmentId,
    ) ?? null;
  return (
    <SidebarInset className="flex h-svh min-h-0 flex-col overflow-hidden overscroll-y-none md:h-dvh">
      {share === null || share.threadId !== threadRef.threadId ? (
        <GuestNotice
          title="This link has ended or is not valid"
          detail="Ask the owner for a new link."
        />
      ) : (
        <GuestThreadSession key={share.shareId} share={share} threadRef={threadRef} />
      )}
    </SidebarInset>
  );
}

function GuestThreadSession({
  share,
  threadRef,
}: {
  readonly share: JoinedGuestShare;
  readonly threadRef: ScopedThreadRef;
}) {
  // Stable for the share: the timeline's file and item sources hang off it.
  const [endpoint] = useState(() => guestShareEndpointOf(share));
  const { view, online, running, ownerCode } = useAtomValue(guestRoomAtom(share.shareId));
  // Mounting the thread opens the share's stream, which also says who is in the room.
  const thread = useEnvironmentThread(threadRef.environmentId, threadRef.threadId);
  const projection = Option.getOrNull(thread.data);
  const pendingRequests = useAtomValue(environmentThreadDetails.pendingRequestsAtom(threadRef));
  const loadEarlier = useAtomCommand(threadEnvironment.loadEarlierHistory, {
    label: "load earlier thread history",
    reportFailure: false,
  });
  // The room thread's conversation beside the board; closing it hides it without unmounting it.
  const [panelOpen, setPanelOpen] = useState(true);
  const [live] = useState(createRoomLiveStore);
  // Here, not in the composer, so a note from the board can land in it.
  const [draft, setDraft] = useState("");
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();
  // The guest's own machine in this room, whose agent runs their thread boxes.
  const { machine, setBoxThread } = useOwnRoomMachine(share);
  const ownProviders = useEnvironmentProviders();
  const promptOwnBox = useAtomCommand(serverEnvironment.promptSharedRoomBox, {
    reportFailure: false,
  });
  // A box with no thread yet has no composer to keep its model pick, so the board keeps it.
  const [boxPicks, setBoxPicks] = useState<Readonly<Record<string, ModelSelection>>>({});
  const [awaitingRowIds, setAwaitingRowIds] = useState(readAwaitingRowIds);
  const awaiting = nextAwaitingRowIds(awaitingRowIds, view, projection?.visibleTurnItems ?? []);
  if (awaiting !== awaitingRowIds) setAwaitingRowIds(awaiting);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- persists the awaiting row ids to sessionStorage so a reload keeps them
  useEffect(() => writeAwaitingRowIds(awaitingRowIds), [awaitingRowIds]);

  if (view === null || projection === null) {
    return (
      <GuestNotice
        title={Option.isSome(thread.error) ? "Could not load this thread" : "Connecting..."}
        {...(Option.isSome(thread.error) ? { detail: thread.error.value } : {})}
      />
    );
  }
  const historyControls: MessagesTimelineHistoryControls | undefined = shouldShowLoadEarlierControl(
    thread.history,
  )
    ? {
        hasMoreHistory: thread.history.hasMoreHistory,
        loading: thread.history.loading,
        error: thread.history.error,
        onLoadEarlier: () =>
          void loadEarlier({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          }),
      }
    : undefined;
  const guestId = view.guestId;
  const reportOpenFailure = (error: string | null) => {
    if (error !== null) {
      toastManager.add({ type: "error", title: "Could not open your T Code", description: error });
    }
  };
  // The task becomes this guest's, and a draft in their own T Code; neither sends anything.
  const takeTask = (task: RoomBoardNote) => {
    const opened = openOnMyMachine(endpoint, share.host, {
      task: { shareId: share.shareId, taskId: task.id, text: task.text },
    });
    if (guestId !== undefined && task.assignee?.guestId !== guestId) {
      void postBoardChange(endpoint, {
        type: "note.put",
        noteId: task.id,
        text: task.text,
        x: task.x,
        y: task.y,
        assignee: { guestId },
      });
    }
    void opened.then(reportOpenFailure);
  };
  /**
   * Runs a prompt to this guest's own thread box on their own agent, on their machine in this
   * room, with the model picked for the box. Resolves to whether it ran.
   */
  const promptBoxHere = async (own: OwnRoomMachine, boxId: string, prompt: BoardPrompt) => {
    const boxThreadId = own.boxes[boxId];
    // The pick a box's prompt runs with; none leaves its own thread's model, or the joined one's.
    const selection =
      boxThreadId === undefined
        ? boxPicks[boxId]
        : (composerDraftPick(
            useComposerDraftStore
              .getState()
              .getComposerDraft(scopeThreadRef(own.environmentId, boxThreadId)),
          ) ?? undefined);
    const turn =
      selection === undefined
        ? { modelSelection: undefined, text: prompt.text.trim() }
        : boardTurnSelection({
            selection,
            providers: ownProviders.get(own.environmentId) ?? [],
            text: prompt.text.trim(),
          });
    const result = await promptOwnBox({
      environmentId: own.environmentId,
      input: {
        host: share.host,
        shareId: GuestShareId.make(share.shareId),
        boxId,
        title: view.board?.notes.find((note) => note.id === boxId)?.text ?? "",
        text: turn.text,
        cards: boardContextCards(view.board, view.guests, prompt.cards, view.ownerName),
        ...(prompt.artifactId === null ? {} : { artifactId: prompt.artifactId }),
        ...(turn.modelSelection === undefined ? {} : { modelSelection: turn.modelSelection }),
      },
    });
    if (result._tag === "Success" && result.value.threadId !== null) {
      setBoxThread(own.environmentId, boxId, result.value.threadId);
      return true;
    }
    if (result._tag === "Failure" && isAtomCommandInterrupted(result)) return false;
    toastManager.add({
      type: "error",
      title: "Could not run it on your agent",
      description:
        result._tag === "Success"
          ? "Your machine is no longer in this room. Choose Continue on my machine again."
          : messageOfFailure(squashAtomCommandFailure(result)),
    });
    return false;
  };
  // A prompt from this guest's own thread box. Their own agent runs it when a machine of theirs
  // joined this room. Otherwise it is a request that waits for the owner like any message, with
  // the cards written into it, so the owner reads exactly what would reach their agent.
  const promptBox = async (boxId: string, prompt: BoardPrompt) => {
    if (machine != null) {
      if (prompt.text.trim() === "" || prompt.text.length > GUEST_MESSAGE_MAX_LENGTH) {
        toastManager.add({
          type: "error",
          title: "Could not send the prompt",
          description:
            prompt.text.trim() === "" ? "Write a prompt first." : "This prompt is too long.",
        });
        return false;
      }
      return promptBoxHere(machine, boxId, prompt);
    }
    const text = guestBoardPromptText(
      prompt.text,
      boardContextCards(view.board, view.guests, prompt.cards, view.ownerName),
    );
    const failure =
      text === ""
        ? "Write a prompt first."
        : text.length > GUEST_MESSAGE_MAX_LENGTH
          ? "This prompt and its cards are too long. Remove a card or shorten the prompt."
          : await postGuestMessage(endpoint, text, [], {
              boxId,
              cardRefs: prompt.cards.map((card) => card.ref),
              ...(prompt.artifactId === null ? {} : { artifactId: prompt.artifactId }),
            });
    if (failure !== null) {
      toastManager.add({
        type: "error",
        title: "Could not send the prompt",
        description: failure,
      });
    }
    return failure === null;
  };
  // The same draft a task makes. The room answers only a task card, so a note answers nothing.
  const giveNote = (note: RoomBoardNote) =>
    void openOnMyMachine(endpoint, share.host, {
      task: { shareId: share.shareId, taskId: note.id, text: boardNoteMessage(note) },
    }).then(reportOpenFailure);
  const conversation = (
    <GuestThread
      endpoint={endpoint}
      host={share.host}
      view={view}
      projection={projection}
      online={online}
      awaitingRowIds={awaitingRowIds}
      historyControls={historyControls}
      onClose={guestId === undefined ? undefined : () => setPanelOpen(false)}
      onBoardChange={
        guestId === undefined ? undefined : (change) => postBoardChange(endpoint, change)
      }
      draft={draft}
      onDraftChange={setDraft}
      composerRef={composerRef}
    />
  );
  // The one guest of a link made before several could join cannot sign a note, so has no board.
  if (guestId === undefined) return conversation;
  return (
    <RoomLiveContext value={live}>
      <GuestBoardLive shareId={share.shareId} running={running} live={live} />
      <BoardSplit
        open={panelOpen}
        panel={<div className="flex h-full min-h-0 flex-col">{conversation}</div>}
        board={
          <RoomBoard
            title={view.title}
            room={view}
            online={online}
            messages={boardMessages(
              projection.visibleTurnItems.map((row) => row.item),
              BOARD_THREAD_MESSAGES,
              "Owner",
            )}
            agentWorking={deriveThreadAgentWorking(projection)}
            ownerCode={ownerCode}
            onTakeTask={takeTask}
            onGiveNote={giveNote}
            viewer={guestId}
            ownerName={view.ownerName}
            cursorLayer={
              <GuestBoardCursors
                shareId={share.shareId}
                guests={view.guests}
                ownerName={view.ownerName}
              />
            }
            onOpenThread={() => setPanelOpen(true)}
            onOpenReply={(messageId) => {
              revealRoomReply(messageId);
              setPanelOpen(true);
            }}
            onChange={(change) => postBoardChange(endpoint, change)}
            onCursor={(presence) => postBoardCursor(endpoint, presence)}
            onPromptBox={promptBox}
            renderBoxModel={(boxId) =>
              machine == null ? (
                <span className="truncate text-2xs text-muted-foreground">
                  {machine === null ? "Goes to the owner" : ""}
                </span>
              ) : (
                <OwnBoxModelPicker
                  machine={machine}
                  boxId={boxId}
                  pick={boxPicks[boxId]}
                  onPick={(selection) =>
                    setBoxPicks((current) => ({ ...current, [boxId]: selection }))
                  }
                />
              )
            }
            guestBoxPlaceholder={
              machine === undefined
                ? "Ask an agent"
                : machine === null
                  ? "Ask the owner's agent"
                  : "Ask your agent"
            }
            conversationBoxIds={Object.keys(machine?.boxes ?? {})}
            onOpenConversation={(boxId) => {
              const threadId = machine?.boxes[boxId];
              if (machine != null && threadId !== undefined) {
                void navigate({
                  to: "/$environmentId/$threadId",
                  params: { environmentId: machine.environmentId, threadId },
                });
              }
            }}
            ownerWritingArtifactId={ownerWritingArtifactId(
              projection.visibleTurnItems.map((row) => row.item),
              deriveThreadStructureRuntime(projection)?.activeRunId,
              view.shareId,
            )}
            needsApproval={(pendingRequests?.approvals.length ?? 0) > 0}
            onUseNote={(text) => {
              // Only a draft in the message box: the guest sends it, and the owner still approves it.
              flushSync(() => {
                setDraft((current) =>
                  appendNoteToDraft(current, text).slice(0, GUEST_MESSAGE_MAX_LENGTH),
                );
                setPanelOpen(true);
              });
              composerRef.current?.focus();
            }}
          />
        }
      />
    </RoomLiveContext>
  );
}

/** The thread boxes' runs, read here and kept in the board's live store. */
function GuestBoardLive({
  shareId,
  running,
  live,
}: {
  readonly shareId: string;
  readonly running: ReadonlyArray<RoomAgentActivity>;
  readonly live: RoomLiveStore;
}) {
  const boxes = useAtomValue(guestRoomBoxesAtom(shareId));
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands the room's live runs to the board's store, which lives outside React
  useEffect(() => {
    live.setRunning(running);
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

/** Everyone else's pointers and views, read here so a pointer moving renders only this. */
function GuestBoardCursors({
  shareId,
  guests,
  ownerName,
}: {
  readonly shareId: string;
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly ownerName: string | undefined;
}) {
  const cursors = useAtomValue(guestRoomCursorsAtom(shareId));
  const views = useAtomValue(guestRoomViewsAtom(shareId));
  return <RoomCursors cursors={cursors} views={views} guests={guests} ownerName={ownerName} />;
}

const NO_TURN_DIFFS: ReadonlyArray<never> = [];
const NO_OPTIMISTIC_MESSAGES: ReadonlyArray<never> = [];
const ignore = () => {};

/**
 * The owner's timeline, read-only: every action that would reach the owner's machine (fork,
 * revert, diffs, files, other threads, shell, approvals) is left out, so its control does not
 * render. The timeline is given no thread of an environment to look up either.
 */
function GuestThread({
  endpoint,
  host,
  view: {
    shareId,
    title,
    expiresAt,
    messages,
    turns,
    model,
    guests,
    guestId,
    direct,
    signIn,
    ownerName,
    board,
  },
  projection,
  online,
  awaitingRowIds,
  historyControls,
  onClose,
  onBoardChange,
  draft,
  onDraftChange,
  composerRef,
}: {
  readonly endpoint: GuestShareEndpoint;
  readonly host: string;
  readonly view: GuestShareView;
  readonly projection: OrchestrationV2ThreadProjection;
  readonly online: ReadonlyArray<string>;
  readonly awaitingRowIds: ReadonlySet<GuestMessageId>;
  readonly historyControls: MessagesTimelineHistoryControls | undefined;
  /** Closes the conversation beside the board. Absent where there is no board beside it. */
  readonly onClose: (() => void) | undefined;
  /** Sends one change to the room's board. Absent, like the board, for that one guest. */
  readonly onBoardChange: ((change: RoomBoardChange) => Promise<boolean>) | undefined;
  readonly draft: string;
  readonly onDraftChange: Dispatch<SetStateAction<string>>;
  readonly composerRef: RefObject<HTMLTextAreaElement | null>;
}) {
  // No ":" so the timeline finds no environment thread behind the key.
  const threadKey = `guest-${shareId}`;
  const listRef = useRef<LegendListRef | null>(null);
  const { resolvedTheme } = useTheme();
  // The rest is what ChatView derives from the same projection.
  const [projectQuestionHistory] = useState(() => createQuestionHistoryProjector());
  const items = projectQuestionHistory(projection);
  const files = useGuestFiles(endpoint);
  // Expanded rows read detail and command output through the guest routes.
  const [turnItemSource] = useState(() => guestTurnItemSource(endpoint));
  const loadedUrls = new Map(
    items.flatMap(({ item }) =>
      item.type === "user_message"
        ? item.attachments.flatMap((attachment) => {
            const url = files.url(GUEST_ATTACHMENT_ROUTE, { id: attachment.id });
            return url === undefined ? [] : [[attachment.id, url] as const];
          })
        : [],
    ),
  );
  // The timeline compares this by identity and sets state when it changes, so keep one per content.
  const [attachmentUrlById, setAttachmentUrlById] = useState(loadedUrls);
  if (
    loadedUrls.size !== attachmentUrlById.size ||
    [...loadedUrls].some(([id, url]) => attachmentUrlById.get(id) !== url)
  ) {
    setAttachmentUrlById(loadedUrls);
  }
  const entries = useIncrementalTimelineEntries(threadKey, {
    visibleTurnItems: items,
    optimisticMessages: NO_OPTIMISTIC_MESSAGES,
    attachmentUrlById,
    attempts: projection.attempts,
    nodes: projection.nodes,
    plans: projection.plans,
  });
  const openFile = useStableCallback((file: { readonly id: string; readonly name?: string }) => {
    void openGuestFile(endpoint, GUEST_ATTACHMENT_ROUTE, { id: file.id }, file.name ?? "file");
  });
  // An image not loaded yet has no address; the markdown renders again when it has one.
  const hostImageUrl = (path: string) => files.url(GUEST_MEDIA_ROUTE, { path }) ?? "";
  const activityRun = deriveThreadActivityRun(projection);
  const runtime = deriveThreadStructureRuntime(projection);
  const runlessWorkStartedAt = deriveRunlessWorkStartedAt(projection);
  const isWorking = derivePhase(runtime) === "running" || runlessWorkStartedAt !== null;
  const workStartedAt =
    deriveActiveWorkStartedAt(activityRun, runtime, null) ?? runlessWorkStartedAt;
  const runningRunId = runtime?.activeRunId ?? null;
  const follow = useTimelineFollow({
    legendListRef: listRef,
    composerTimelineInset: 0,
    routeThreadKey: threadKey,
    activeThreadKey: threadKey,
    // Not a server thread: new turns follow the end instead of anchoring near the top.
    isServerThread: false,
    serverProjection: null,
    threadStatus: "live",
    activeActivityRun: activityRun,
    activeRunningTurnId: runningRunId,
    timelineEntries: entries,
    timelineAnchorMessageId: null,
    setTimelineAnchor: ignore,
  });
  const renderHtmlRender = useStableCallback(
    (row: Extract<TimelineRow, { kind: "html-render" }>) => (
      <GuestHtmlRender itemId={row.id} reference={row.htmlRender} endpoint={endpoint} />
    ),
  );
  const unplaced = unplacedGuestMessages(messages, items, awaitingRowIds);
  const otherGuests = guests
    .filter((guest) => guest.id !== guestId)
    .map((guest) => (online.includes(guest.id) ? guest.name : `${guest.name} (away)`));
  return (
    <>
      <header className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-4 py-2.5">
        <SidebarTrigger className="md:hidden" />
        <h1 className="min-w-0 flex-1 truncate text-sm font-medium">{title}</h1>
        {otherGuests.length === 0 ? null : (
          <span className="max-w-[40%] min-w-0 truncate text-xs text-muted-foreground">
            With {otherGuests.join(", ")}
          </span>
        )}
        <GuestGitHubSignIn
          endpoint={endpoint}
          account={guests.find((guest) => guest.id === guestId)?.account}
          available={signIn === true}
        />
        <ContinueOnMyMachine endpoint={endpoint} host={host} />
        <ExpiryLabel expiresAt={expiresAt} />
        {onClose === undefined ? null : (
          <Button size="icon-xs" variant="ghost" aria-label="Close conversation" onClick={onClose}>
            <XIcon />
          </Button>
        )}
      </header>
      <div className="relative min-h-0 flex-1">
        <RoomReplyProvider
          room={
            guestId === undefined
              ? null
              : {
                  board: board ?? EMPTY_ROOM_BOARD,
                  people: { guests, viewer: guestId, ownerName },
                  onChange: onBoardChange,
                }
          }
        >
          <HostImageUrlContext value={hostImageUrl}>
            <MessagesTimeline
              listRef={listRef}
              timelineEntries={entries}
              isWorking={isWorking}
              activeTurnStartedAt={workStartedAt}
              latestRun={activityRun}
              runningRunId={runningRunId}
              turnDiffSummaries={NO_TURN_DIFFS}
              runs={projection.runs}
              routeThreadKey={threadKey}
              onOpenThread={ignore}
              supportsConversationRollback={false}
              onRevertToTurnCount={ignore}
              isRevertingCheckpoint={false}
              onImageExpand={openExpandedImage}
              onFileOpen={openFile}
              onFileDownload={openFile}
              renderHtmlRender={renderHtmlRender}
              turnItemSource={turnItemSource}
              historyControls={historyControls}
              activeThreadEnvironmentId={guestEnvironmentId(shareId)}
              markdownCwd={undefined}
              resolvedTheme={resolvedTheme}
              timestampFormat="locale"
              workspaceRoot={undefined}
              anchorMessageId={null}
              onAnchorReady={ignore}
              onAnchorSizeChanged={ignore}
              contentInsetEndAdjustment={0}
              emptyPlaceholderInset={0}
              liveFollowEnabled={follow.timelineLiveFollowEnabled}
              onIsAtEndChange={follow.onIsAtEndChangeStable}
              onViewportAttach={follow.attachTimelineViewport}
              onFooterGrow={follow.onTimelineFooterGrowStable}
              footer={
                unplaced.length === 0 && (turns ?? []).length === 0 ? null : (
                  <>
                    <GuestTurnList
                      roster={{ guests, guestName: null }}
                      turns={turns ?? []}
                      ownGuestId={guestId}
                    />
                    {unplaced.length === 0 ? null : (
                      <ol className="chat-content-lane flex flex-col gap-4 pb-4">
                        {unplaced.map((message) => (
                          <li key={message.id}>
                            <UnplacedGuestMessage
                              endpoint={endpoint}
                              fileUrl={(id) => files.url(GUEST_ATTACHMENT_ROUTE, { id })}
                              message={message}
                              artifactTitle={
                                message.status === "pending"
                                  ? guestMessageArtifactTitle(board, message)
                                  : null
                              }
                              author={
                                message.guestId === guestId
                                  ? "You"
                                  : guestMessageAuthorName({ guests, guestName: null }, message)
                              }
                            />
                          </li>
                        ))}
                      </ol>
                    )}
                  </>
                )
              }
            />
          </HostImageUrlContext>
        </RoomReplyProvider>
        {follow.showScrollToBottom ? (
          <ScrollToEndButton
            summary={null}
            bottom={4}
            onScrollToEnd={() => follow.scrollToEnd(true)}
          />
        ) : null}
      </div>
      <div className={cn(LANE, "shrink-0 pb-4")}>
        <GuestComposer
          endpoint={endpoint}
          model={model}
          direct={direct}
          text={draft}
          onTextChange={onDraftChange}
          textareaRef={composerRef}
          onSent={() => follow.scrollToEnd(true)}
        />
      </div>
    </>
  );
}

const SIGN_IN_FAILED = "Could not sign in with GitHub. Try again.";
const SIGN_IN_ENDINGS = {
  expired: "The GitHub sign-in took too long. Try again.",
  denied: "The sign-in was cancelled on GitHub.",
  failed: SIGN_IN_FAILED,
} as const;

/**
 * Leaves for GitHub from a page on another origin than the owner's host. A fetch from here could
 * not store the cookie the owner's server ties the sign-in to, so the browser posts a form
 * there: the answer sets the cookie and sends it on.
 */
function beginHostedSignIn(endpoint: GuestShareEndpoint & { readonly token: string }) {
  const form = document.createElement("form");
  form.method = "POST";
  form.action = new URL(GUEST_SIGN_IN_BEGIN_ROUTE, endpoint.httpBaseUrl).toString();
  for (const [name, value] of [
    ["token", endpoint.token],
    [GUEST_SHARE_PARAM, endpoint.shareId],
  ] as const) {
    const field = document.createElement("input");
    field.type = "hidden";
    field.name = name;
    field.value = value;
    form.append(field);
  }
  document.body.append(form);
  form.submit();
}

/**
 * Proves who the guest is to the owner. The guest's browser goes to GitHub and comes back; the
 * owner's server learns their username and nothing else, and the owner can then approve them by
 * account.
 */
function GuestGitHubSignIn({
  endpoint,
  account,
  available,
}: {
  readonly endpoint: GuestShareEndpoint;
  readonly account: GuestAccount | undefined;
  readonly available: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => {
    const failure = signInFailures.get(endpoint.shareId);
    signInFailures.delete(endpoint.shareId);
    return failure === undefined ? null : SIGN_IN_ENDINGS[failure];
  });

  if (account !== undefined) {
    return <span className="shrink-0 text-xs text-muted-foreground">@{account.login}</span>;
  }
  if (!available) return null;
  const start = async () => {
    setBusy(true);
    const { token } = endpoint;
    if (token !== null && new URL(endpoint.httpBaseUrl).origin !== window.location.origin) {
      beginHostedSignIn({ ...endpoint, token });
      return;
    }
    // On the owner's own host the answer may set the cookie, so it must not be a bearer-only
    // request that drops cookies.
    const started = await fetch(
      `${GUEST_SIGN_IN_ROUTE}?${GUEST_SHARE_PARAM}=${encodeURIComponent(endpoint.shareId)}`,
      {
        method: "POST",
        ...(token === null ? {} : { headers: { authorization: `Bearer ${token}` } }),
      },
    ).then(
      async (response) =>
        response.ok
          ? Option.getOrElse(
              Option.map(decodeSignInStart(await response.json().catch(() => null)), (s) => s.url),
              () => null,
            )
          : null,
      () => null,
    );
    if (started === null) {
      setBusy(false);
      setError(SIGN_IN_FAILED);
      return;
    }
    // The page leaves for GitHub, and loads again when GitHub sends the guest back.
    window.location.assign(started);
  };
  return (
    <>
      {error === null ? null : (
        <span role="alert" className="min-w-0 truncate text-xs text-destructive">
          {error}
        </span>
      )}
      <Button size="xs" variant="outline" disabled={busy} onClick={() => void start()}>
        Sign in with GitHub
      </Button>
    </>
  );
}

/**
 * Opens the guest's own T Code on a short-lived handoff token, with a task or artifact card as a
 * draft when given one. Call it in the click itself: a tab opened after a request counts as a
 * popup. Resolves to what went wrong, or null.
 */
async function openOnMyMachine(
  endpoint: GuestShareEndpoint,
  host: string,
  card: Pick<Parameters<typeof buildJoinLink>[0], "task" | "artifact"> = {},
): Promise<string | null> {
  const tab = window.open("", "_blank");
  const handoff = await postGuestAction(
    endpoint,
    GUEST_HANDOFF_ROUTE,
    decodeHandoff,
    "Could not start the handoff. Try again.",
  );
  if (typeof handoff === "string") {
    tab?.close();
    return handoff;
  }
  const url = buildJoinLink({
    host,
    token: handoff.token,
    origin: configuredHostedAppUrl(),
    ...card,
  });
  if (tab === null) {
    window.location.href = url;
    return null;
  }
  tab.opener = null;
  tab.location.href = url;
  return null;
}

/**
 * Takes the guest to their own T Code with a short-lived token, where they get their own copy
 * of this thread. From then on their turns run on their machine, not the owner's.
 */
function ContinueOnMyMachine({
  endpoint,
  host,
}: {
  readonly endpoint: GuestShareEndpoint;
  readonly host: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    const failed = await openOnMyMachine(endpoint, host);
    setBusy(false);
    setError(failed);
  };
  return (
    <>
      {error === null ? null : (
        <span role="alert" className="min-w-0 truncate text-xs text-destructive">
          {error}
        </span>
      )}
      <Button size="xs" variant="outline" disabled={busy} onClick={() => void start()}>
        Continue on my machine
      </Button>
    </>
  );
}

function ExpiryLabel({ expiresAt }: { readonly expiresAt: string }) {
  const nowMinute = useNowMinute();
  return (
    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
      {formatGuestExpiry(expiresAt, Date.parse(`${nowMinute}Z`))}
    </span>
  );
}

const BUBBLE =
  "flex min-w-0 max-w-[80%] flex-col gap-2 rounded-2xl p-3 text-sm whitespace-pre-wrap [overflow-wrap:anywhere]";

/** Guests have no image viewer; the browser shows the picture in its own tab. */
const openExpandedImage = (preview: ExpandedImagePreview) => {
  const src = preview.images[preview.index]?.src;
  if (src) window.open(src, "_blank", "noopener,noreferrer");
};

/** A guest message the owner has not sent yet, or chose not to send. */
function UnplacedGuestMessage({
  endpoint,
  fileUrl,
  message,
  author,
  artifactTitle,
}: {
  readonly endpoint: GuestShareEndpoint;
  /** Where a file of the message has loaded to, once it has. */
  readonly fileUrl: (attachmentId: string) => string | undefined;
  readonly message: ThreadGuestMessage;
  /** "You", or the name of the other guest who wrote it. */
  readonly author: string;
  /** The artifact card the reply fills once the owner sends it. */
  readonly artifactTitle: string | null;
}) {
  // A dismissed message's files are deleted, so only their names remain.
  const served = message.status !== "dismissed";
  const open = (attachment: { readonly id: string; readonly name: string }) =>
    void openGuestFile(endpoint, GUEST_ATTACHMENT_ROUTE, { id: attachment.id }, attachment.name);
  return (
    <div className="flex flex-col items-end gap-1">
      <GuestMessageName name={author} />
      <div
        className={cn(
          BUBBLE,
          guestBubbleClassName(message.status !== "sent"),
          message.status === "dismissed" ? "text-muted-foreground" : "text-message-foreground",
        )}
      >
        <GuestMessageAttachments
          attachments={message.attachments ?? []}
          imageUrl={(attachment) => (served ? fileUrl(attachment.id) : undefined)}
          onOpenImage={open}
          {...(served ? { onOpenFile: open } : {})}
        />
        {message.text ? <span>{message.text}</span> : null}
      </div>
      <p className="me-1 text-2xs text-muted-foreground">
        {artifactTitle === null
          ? STATUS_LABEL[message.status]
          : `${STATUS_LABEL[message.status]} · the reply replaces "${artifactTitle}"`}
      </p>
    </div>
  );
}

/** The thread's model, labeled as the owner's composer labels it, with no way to change it. */
function GuestModelLabel({ model }: { readonly model: GuestThreadModel }) {
  const label = getTriggerDisplayModelName({ slug: model.name, ...model }, model.driver);
  const fullLabel = getDisplayModelName({ slug: model.name, ...model });
  return (
    <ComposerControl
      render={<span />}
      aria-label={`Model: ${fullLabel}`}
      className="pointer-events-none min-w-0 shrink"
    >
      {model.driver === null ? null : (
        <ProviderInstanceIcon
          driverKind={model.driver}
          displayName={label}
          className="size-4"
          iconClassName="size-4"
        />
      )}
      <span className="min-w-0 truncate" data-chat-provider-model-picker-label="true">
        {label}
      </span>
    </ComposerControl>
  );
}

interface StagedFile {
  readonly key: string;
  readonly file: File;
}

/** A staged image's thumbnail; its object URL lives as long as the element. */
function StagedImage({ file }: { readonly file: File }) {
  return (
    <img
      alt={file.name}
      className="size-full object-cover"
      ref={(image) => {
        if (!image) return;
        const url = URL.createObjectURL(file);
        image.src = url;
        return () => URL.revokeObjectURL(url);
      }}
    />
  );
}

/**
 * Where a guest writes. A message goes to the owner's server, which decides whether it waits
 * for the owner or reaches the agent; the guest picks no model, mode, or queue.
 */
function GuestComposer({
  endpoint,
  model,
  direct,
  text,
  onTextChange: setText,
  textareaRef,
  onSent,
}: {
  readonly endpoint: GuestShareEndpoint;
  readonly model: GuestThreadModel;
  /** The owner lets this guest's messages through without sending each one. */
  readonly direct: boolean;
  readonly text: string;
  readonly onTextChange: Dispatch<SetStateAction<string>>;
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  /** The guest's own message comes into view even if they had scrolled up, as the owner's does. */
  readonly onSent: () => void;
}): ReactNode {
  const [files, setFiles] = useState<ReadonlyArray<StagedFile>>([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nextFileKey = useRef(0);
  const { resolvedTheme } = useTheme();
  const addFiles = (added: ReadonlyArray<File>) => {
    if (added.length === 0) return;
    const next = [
      ...files,
      ...added.map((file) => ({ key: `staged-${nextFileKey.current++}`, file })),
    ];
    const problem = guestFilesProblem(next.map((staged) => staged.file));
    setError(problem);
    if (problem === null) setFiles(next);
  };
  const send = async () => {
    const trimmed = text.trim();
    if ((trimmed === "" && files.length === 0) || sending) return;
    setSending(true);
    const sentFiles = files;
    const failure = await postGuestMessage(
      endpoint,
      trimmed,
      sentFiles.map((staged) => staged.file),
    );
    setSending(false);
    setError(failure);
    // Keep anything typed or attached while the request was in flight.
    if (failure === null) {
      onSent();
      setText((current) => (current.trim() === trimmed ? "" : current));
      setFiles((current) => current.filter((staged) => !sentFiles.includes(staged)));
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Same as the app composer: Enter sends, Shift+Enter adds a line, IME composition is left alone.
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void send();
    }
  };
  // As in the app composer: pasted images attach, and other files attach when no text came along.
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(event.clipboardData.files);
    const hasImage = pasted.some((file) => file.type.startsWith("image/"));
    if (pasted.length === 0 || (!hasImage && event.clipboardData.getData("text/plain") !== "")) {
      return;
    }
    event.preventDefault();
    addFiles(pasted);
  };
  return (
    <form
      className="flex flex-col gap-2 rounded-3xl border border-border bg-card px-4 pt-3 pb-2.5 shadow-composer dark:shadow-composer-dark"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length === 0) return;
        event.preventDefault();
        addFiles(Array.from(event.dataTransfer.files));
      }}
    >
      {files.length > 0 ? (
        <ul className="flex flex-wrap gap-2" aria-label="Attached files">
          {files.map((staged) => (
            <li
              key={staged.key}
              className="flex h-14 min-w-0 items-center gap-2 overflow-hidden rounded-lg border border-border/80 bg-background/70 pe-1"
            >
              {staged.file.type.startsWith("image/") ? (
                <span className="size-14 shrink-0">
                  <StagedImage file={staged.file} />
                </span>
              ) : (
                <span className="flex min-w-0 items-center gap-2 ps-2 text-sm">
                  <PierreEntryIcon pathValue={staged.file.name} kind="file" theme={resolvedTheme} />
                  <span className="max-w-40 truncate">{staged.file.name}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {formatAttachmentSize(staged.file.size)}
                  </span>
                </span>
              )}
              <Button
                size="icon-xs"
                variant="ghost-muted"
                aria-label={`Remove ${staged.file.name}`}
                onClick={() => {
                  setError(null);
                  setFiles((current) => current.filter((candidate) => candidate !== staged));
                }}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <textarea
        ref={textareaRef}
        aria-label="Message"
        placeholder="Message"
        rows={2}
        maxLength={GUEST_MESSAGE_MAX_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        className="max-h-60 min-h-12 w-full resize-none bg-transparent text-sm outline-none field-sizing-content placeholder:text-placeholder"
      />
      <div className="flex items-center gap-3">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          hidden
          aria-label="Files to attach"
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            // The same file can be picked again after it is removed.
            event.target.value = "";
          }}
        />
        <ComposerControl aria-label="Attach files" onClick={() => fileInputRef.current?.click()}>
          <ComposerControlIcon icon={PaperclipIcon} />
        </ComposerControl>
        <GuestModelLabel model={model} />
        {error !== null ? (
          <p role="alert" className="min-w-0 flex-1 text-xs text-destructive">
            {error}
          </p>
        ) : (
          <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
            {direct ? "Your messages go straight to the agent" : "The owner approves each message"}
          </p>
        )}
        <button
          type="submit"
          aria-label="Send"
          disabled={sending || (text.trim() === "" && files.length === 0)}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-message-action text-message-action-foreground shadow-xs hover:bg-message-action-hover focus-visible:outline-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-64"
        >
          <ArrowUpIcon aria-hidden className="size-4" />
        </button>
      </div>
    </form>
  );
}
