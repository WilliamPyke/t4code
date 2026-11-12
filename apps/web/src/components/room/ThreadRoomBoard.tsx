import { useAtomValue } from "@effect/atom-react";
import type { GuestShareId, ScopedThreadRef, ThreadGuest } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useComposerDraftStore } from "~/composerDraftStore";
import { deriveThreadAgentWorking } from "~/session-logic";
import {
  useQuietThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { SidebarInset } from "../ui/sidebar";
import { RoomBoard, RoomCursors } from "./RoomBoard";
import { BOARD_THREAD_MESSAGES, appendNoteToDraft, boardMessages } from "./roomBoard.logic";

const NO_GUESTS: ReadonlyArray<ThreadGuest> = [];

/** The owner's board for a thread they share, read from the thread and changed on its server. */
export function ThreadRoomBoard({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const structure = useQuietThreadProjection(threadRef)?.projection ?? null;
  const share = structure?.thread.guestShare ?? null;
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
  const canChange = useAtomValue(
    serverEnvironment.changeGuestBoard.permissionAtom(threadRef.environmentId),
  );
  const changeBoard = useAtomCommand(serverEnvironment.changeGuestBoard, "change the board");
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
        onChange={
          canChange
            ? (change) =>
                changeBoard({
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId, change },
                }).then((result) => result._tag === "Success")
            : undefined
        }
        onCursor={
          share !== null && canPoint
            ? (at) =>
                void moveCursor({
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId, shareId: share.id, at },
                })
            : undefined
        }
        onUseNote={(text) => {
          // Only a draft: the owner reads it and sends it themselves.
          const store = useComposerDraftStore.getState();
          const draft = store.getComposerDraft(threadRef)?.prompt ?? "";
          store.setPrompt(threadRef, appendNoteToDraft(draft, text));
          openThread();
        }}
      />
    </SidebarInset>
  );
}

/** The guests' pointers, read here so a pointer moving renders only this. */
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
  return <RoomCursors cursors={data?.cursors ?? []} guests={guests} ownerName={undefined} />;
}
