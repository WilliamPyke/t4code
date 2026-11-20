import { useAtomValue } from "@effect/atom-react";
import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId, type RoomBoardOutlineItem } from "@t3tools/contracts";
import { boardOutline } from "@t3tools/shared/boardOutline";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import * as Schema from "effect/Schema";
import { AppWindowIcon, BotIcon, ChevronRightIcon, FrameIcon } from "lucide-react";
import { useEffect } from "react";

import { sharedThreadLocationOf } from "~/guest/boardAddress";
import { joinedBoardOutlineAtom, refreshJoinedBoardOutline } from "~/guest/boardOutlines";
import { guestRoomAtom, guestShareLocation } from "~/guest/guestShares";
import { openListedBoard } from "~/guest/workspaces";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useQuietThreadProjection } from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";

import { type HomeBoard, boardOutlineShown } from "../boards/boardsHome.logic";
import { requestBoardFocus } from "../room/boardFocus";
import { roomBoardLocation, roomBoardViewKey } from "../room/roomBoardNavigation";
import { Button } from "../ui/button";
import {
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "../ui/sidebar";
import { toastManager } from "../ui/toast";

// Per browser: the boards whose outline is open in the sidebar, by board key.
const EXPANDED_KEY = "t3code:sidebar-board-outlines:v1";
const EXPANDED_KEPT = 50;
const ExpandedBoards = Schema.Array(Schema.String);

const readExpanded = (): ReadonlyArray<string> => {
  try {
    return getLocalStorageItem(EXPANDED_KEY, ExpandedBoards) ?? [];
  } catch {
    return [];
  }
};

const expandedBoardsAtom = Atom.make<ReadonlyArray<string>>(readExpanded()).pipe(
  Atom.keepAlive,
  Atom.withLabel("sidebar:board-outlines"),
);

/** The keys of the boards whose outline is open. */
export const useExpandedBoards = () => useAtomValue(expandedBoardsAtom);

function toggleBoardExpanded(key: string) {
  const current = appAtomRegistry.get(expandedBoardsAtom);
  const next = current.includes(key)
    ? current.filter((one) => one !== key)
    : [...current, key].slice(-EXPANDED_KEPT);
  appAtomRegistry.set(expandedBoardsAtom, next);
  try {
    setLocalStorageItem(EXPANDED_KEY, next, ExpandedBoards);
  } catch {
    // Storage that is full or blocked only forgets which boards were open.
  }
}

type ListedBoard = Exclude<HomeBoard, { readonly kind: "team" }>;

/** The id a board's outline list carries, for the button that opens it. */
const boardOutlineId = (board: ListedBoard) => `board-outline-${board.key}`;

/** Opens or closes a board's outline. Its place and when it shows are the row's to say. */
export function BoardOutlineToggle({
  board,
  expanded,
}: {
  readonly board: ListedBoard;
  readonly expanded: boolean;
}) {
  return (
    <Button
      size="icon-micro"
      variant="ghost-muted"
      aria-expanded={expanded}
      aria-controls={expanded ? boardOutlineId(board) : undefined}
      aria-label={expanded ? `Hide what is on ${board.title}` : `Show what is on ${board.title}`}
      data-board-outline-toggle
      onClick={() => toggleBoardExpanded(board.key)}
    >
      <ChevronRightIcon className={expanded ? "rotate-90" : undefined} />
    </Button>
  );
}

interface OutlineState {
  readonly status: "loading" | "ready" | "failed" | "unavailable";
  readonly items: ReadonlyArray<RoomBoardOutlineItem>;
}

const NO_ITEMS: ReadonlyArray<RoomBoardOutlineItem> = [];
const LOADING: OutlineState = { status: "loading", items: NO_ITEMS };

const KIND_NAME: Readonly<Record<RoomBoardOutlineItem["kind"], string>> = {
  artifact: "Artifact",
  thread: "Agent",
  section: "Section",
};

function KindIcon({ kind }: { readonly kind: RoomBoardOutlineItem["kind"] }) {
  if (kind === "artifact") return <AppWindowIcon aria-hidden />;
  if (kind === "thread") return <BotIcon aria-hidden />;
  return <FrameIcon aria-hidden />;
}

const QUIET_ROW = "px-2 py-1 text-xs text-muted-foreground";

/** What is on one board, by name. `onOpen(null)` opens the board itself. */
function OutlineList({
  board,
  state,
  onOpen,
}: {
  readonly board: ListedBoard;
  readonly state: OutlineState;
  readonly onOpen: (item: RoomBoardOutlineItem | null) => void;
}) {
  const { shown, more } = boardOutlineShown(state.items);
  return (
    // Its own scroll: the boards sit above the thread list, in a part of the sidebar that has none.
    <div className="max-h-[min(26rem,50vh)] overflow-y-auto" data-board-outline={state.status}>
      <SidebarMenuSub id={boardOutlineId(board)} aria-label={`On ${board.title}`}>
        {shown.map((item) => (
          <SidebarMenuSubItem key={`${item.kind}:${item.id}`}>
            <SidebarMenuSubButton
              size="sm"
              render={<button type="button" />}
              aria-label={`${KIND_NAME[item.kind]}: ${item.name}`}
              data-board-outline-item={item.kind}
              onClick={() => onOpen(item)}
            >
              <KindIcon kind={item.kind} />
              <span>{item.name}</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ))}
        {more > 0 ? (
          <SidebarMenuSubItem>
            <SidebarMenuSubButton
              size="sm"
              render={<button type="button" />}
              onClick={() => onOpen(null)}
            >
              <span>Show all on the board</span>
            </SidebarMenuSubButton>
          </SidebarMenuSubItem>
        ) : null}
        {shown.length > 0 ? null : (
          <li className={QUIET_ROW} role={state.status === "loading" ? "status" : undefined}>
            {state.status === "loading"
              ? "Loading…"
              : state.status === "failed"
                ? "Could not load"
                : state.status === "unavailable"
                  ? "Open this board to see what is on it"
                  : "Nothing here yet"}
          </li>
        )}
      </SidebarMenuSub>
    </div>
  );
}

/**
 * The outline of a board on one of this person's computers: the board itself while it is open,
 * else its computer's summary of it, which names what is on it without sending the board.
 */
function OwnBoardOutline({
  board,
  open,
}: {
  readonly board: Extract<ListedBoard, { readonly kind: "own" }>;
  readonly open: boolean;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const environmentId = EnvironmentId.make(board.environmentId);
  const threadRef = scopeThreadRef(environmentId, ThreadId.make(board.threadId));
  const thread = useQuietThreadProjection(open ? threadRef : null)?.projection.thread ?? null;
  const summary = useEnvironmentQuery(
    open
      ? null
      : serverEnvironment.roomBoardSummaries({
          environmentId,
          input: { threadIds: [threadRef.threadId], outline: true },
        }),
  );
  const read = summary.data?.boards.find((one) => one.threadId === board.threadId)?.outline;
  const state: OutlineState =
    thread !== null
      ? {
          status: "ready",
          items: boardOutline(thread.guestShare?.board ?? thread.roomBoard?.board, thread.title)
            .items,
        }
      : read !== undefined
        ? { status: "ready", items: read.items }
        : // A computer from before outlines answers without one.
          open || (summary.data === null && summary.error === null)
          ? LOADING
          : { status: "failed", items: NO_ITEMS };
  return (
    <OutlineList
      board={board}
      state={state}
      onOpen={(item) => {
        if (item !== null) {
          requestBoardFocus(roomBoardViewKey(threadRef), { noteId: item.id, plan: false });
        }
        if (!open) void navigate(roomBoardLocation(threadRef));
        if (isMobile) setOpenMobile(false);
      }}
    />
  );
}

/**
 * The outline of a cloud board or one someone shared: what its open page shows while it is open,
 * else one small read from its host, kept for the page's life and read again on each expand.
 */
function JoinedBoardOutline({
  board,
  open,
}: {
  readonly board: Extract<ListedBoard, { readonly kind: "joined" }>;
  readonly open: boolean;
}) {
  const navigate = useNavigate();
  const { isMobile, setOpenMobile } = useSidebar();
  const view = useAtomValue(guestRoomAtom(board.shareId)).view;
  const read = useAtomValue(joinedBoardOutlineAtom(board.shareId));
  const { shareId, workspaceId } = board;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the outline from the board's host each time the row is expanded, and once the board is no longer open here
  useEffect(() => {
    if (!open) void refreshJoinedBoardOutline({ shareId, workspaceId });
  }, [open, shareId, workspaceId]);
  const state: OutlineState = !open
    ? { status: read.status, items: read.outline?.items ?? NO_ITEMS }
    : view === null
      ? LOADING
      : {
          status: "ready",
          // Only a board on a computer has a room thread of its own.
          items: boardOutline(view.board, board.cloud ? null : view.title).items,
        };
  const openBoard = async (item: RoomBoardOutlineItem | null) => {
    let location: ReturnType<typeof guestShareLocation> = sharedThreadLocationOf(
      board,
      board.cloud,
    );
    if (board.remote) {
      // Only the account lists it: a session here first, as the same person.
      const opened = await openListedBoard(board);
      if (typeof opened === "string") {
        toastManager.add({ type: "error", title: opened });
        return;
      }
      location = guestShareLocation(opened);
    }
    if (item !== null) requestBoardFocus(shareId, { noteId: item.id, plan: false });
    if (!open) void navigate(location);
    if (isMobile) setOpenMobile(false);
  };
  return <OutlineList board={board} state={state} onOpen={(item) => void openBoard(item)} />;
}

/** What is on a board, listed under its row: its artifacts, its agents, then its sections. */
export function BoardOutline({
  board,
  open,
}: {
  readonly board: ListedBoard;
  readonly open: boolean;
}) {
  return board.kind === "own" ? (
    <OwnBoardOutline board={board} open={open} />
  ) : (
    <JoinedBoardOutline board={board} open={open} />
  );
}
