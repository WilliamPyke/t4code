import { useAtomValue } from "@effect/atom-react";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import {
  useQuietThreadProjection,
  useThreadShell,
  useThreadVisibleTurnItems,
} from "~/state/entities";
import { useEnvironmentQuery } from "~/state/query";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { SidebarInset } from "../ui/sidebar";
import { RoomBoard } from "./RoomBoard";
import { BOARD_THREAD_MESSAGES, boardMessages } from "./roomBoard.logic";

/** The owner's board for a thread they share, read from the thread and changed on its server. */
export function ThreadRoomBoard({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const navigate = useNavigate();
  const shell = useThreadShell(threadRef);
  const share = useQuietThreadProjection(threadRef)?.projection.thread.guestShare ?? null;
  const items = useThreadVisibleTurnItems(threadRef);
  const { data: presence } = useEnvironmentQuery(
    serverEnvironment.guestPresence({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canChange = useAtomValue(
    serverEnvironment.changeGuestBoard.permissionAtom(threadRef.environmentId),
  );
  const changeBoard = useAtomCommand(serverEnvironment.changeGuestBoard, "change the board");
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
        viewer={null}
        onOpenThread={() =>
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: threadRef.environmentId, threadId: threadRef.threadId },
          })
        }
        onChange={
          canChange
            ? (change) =>
                changeBoard({
                  environmentId: threadRef.environmentId,
                  input: { threadId: threadRef.threadId, change },
                }).then((result) => result._tag === "Success")
            : undefined
        }
      />
    </SidebarInset>
  );
}
