import { isGuestEnvironment, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  GuestShareId,
  type ModelSelection,
  type ThreadId,
} from "@t3tools/contracts";
import { useEffect, useState } from "react";

import { useProjects, useThreadShell } from "~/state/entities";
import { serverEnvironment } from "~/state/server";
import { useAtomCommand } from "~/state/use-atom-command";

import { BoardModelPicker, ThreadBoardModelPicker } from "../room/BoardModelPicker";

/** The guest's own machine that joined a room: its thread from the room, and its boxes' threads. */
export interface OwnRoomMachine {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
  readonly boxes: Readonly<Record<string, ThreadId>>;
}

/**
 * Which of the guest's own machines joined this room, if one did. `undefined` while they are
 * asked, `null` when none did, so a box's prompt goes to the owner.
 */
export function useOwnRoomMachine(share: { readonly host: string; readonly shareId: string }): {
  readonly machine: OwnRoomMachine | null | undefined;
  /** Records the thread a box's prompt just ran in. */
  readonly setBoxThread: (environmentId: EnvironmentId, boxId: string, threadId: ThreadId) => void;
} {
  // The guest's own machines: the ones with projects, which a shared thread's page has none of.
  const environmentIds = [...new Set(useProjects().map((project) => project.environmentId))]
    .filter((environmentId) => !isGuestEnvironment(environmentId))
    .toSorted();
  const environmentKey = environmentIds.join("\n");
  const findSharedRoom = useAtomCommand(serverEnvironment.findSharedRoom, { reportFailure: false });
  const [machine, setMachine] = useState<OwnRoomMachine | null | undefined>(undefined);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- asks the guest's own servers which of them joined this room
  useEffect(() => {
    let current = true;
    void (async () => {
      for (const environmentId of environmentKey === "" ? [] : environmentKey.split("\n")) {
        const result = await findSharedRoom({
          environmentId: environmentId as EnvironmentId,
          input: { host: share.host, shareId: GuestShareId.make(share.shareId) },
        });
        if (!current) return;
        if (result._tag === "Success" && result.value.threadId !== null) {
          setMachine({
            environmentId: environmentId as EnvironmentId,
            threadId: result.value.threadId,
            boxes: result.value.boxes,
          });
          return;
        }
      }
      setMachine(null);
    })();
    return () => {
      current = false;
    };
  }, [environmentKey, findSharedRoom, share.host, share.shareId]);
  return {
    machine,
    setBoxThread: (environmentId, boxId, threadId) =>
      setMachine((known) => ({
        environmentId,
        threadId: known?.environmentId === environmentId ? known.threadId : threadId,
        boxes: {
          ...(known?.environmentId === environmentId ? known.boxes : {}),
          [boxId]: threadId,
        },
      })),
  };
}

/**
 * The model one of the guest's own boxes runs on, on their machine, and the way to change it:
 * the box thread's own once it has one, else the pick kept here, starting from the joined
 * thread's model.
 */
export function OwnBoxModelPicker({
  machine,
  boxId,
  pick,
  onPick,
}: {
  readonly machine: OwnRoomMachine;
  readonly boxId: string;
  readonly pick: ModelSelection | undefined;
  readonly onPick: (selection: ModelSelection) => void;
}) {
  const joined = useThreadShell(scopeThreadRef(machine.environmentId, machine.threadId));
  const projectId = joined?.projectId ?? null;
  const fallback = joined?.modelSelection ?? null;
  const boxThreadId = machine.boxes[boxId];
  if (boxThreadId !== undefined) {
    return (
      <ThreadBoardModelPicker
        threadRef={scopeThreadRef(machine.environmentId, boxThreadId)}
        projectId={projectId}
        fallback={fallback}
      />
    );
  }
  const selection = pick ?? fallback;
  return selection === null ? (
    <span className="truncate text-2xs text-muted-foreground">Runs on your agent</span>
  ) : (
    <BoardModelPicker
      environmentId={machine.environmentId}
      projectId={projectId}
      selection={selection}
      onChange={onPick}
    />
  );
}
