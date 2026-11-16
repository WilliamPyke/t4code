import { isGuestEnvironment, scopeThreadRef } from "@t3tools/client-runtime/environment";
import {
  type EnvironmentId,
  GuestShareId,
  type ModelSelection,
  type RoomBoxModel,
  type ThreadId,
} from "@t3tools/contracts";
import { Atom } from "effect/reactivity";
import { useEffect, useState } from "react";

import { appAtomRegistry } from "~/rpc/atomRegistry";
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

// Bumped when one of this person's machines joins a room from this page, so the room asks again.
const roomMachineJoinsAtom = Atom.family((_shareId: string) =>
  Atom.make(0).pipe(Atom.keepAlive, Atom.withLabel("guest:room-machine-joins")),
);

/** Tells an open room that one of this person's machines just joined it. */
export const announceRoomMachineJoined = (shareId: string) =>
  appAtomRegistry.update(roomMachineJoinsAtom(shareId), (count) => count + 1);

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
    let found = false;
    const ask = async () => {
      for (const environmentId of environmentKey === "" ? [] : environmentKey.split("\n")) {
        const result = await findSharedRoom({
          environmentId: environmentId as EnvironmentId,
          input: { host: share.host, shareId: GuestShareId.make(share.shareId) },
        });
        if (!current) return;
        if (result._tag === "Success" && result.value.threadId !== null) {
          found = true;
          setMachine({
            environmentId: environmentId as EnvironmentId,
            threadId: result.value.threadId,
            boxes: result.value.boxes,
          });
          return;
        }
      }
      setMachine(null);
    };
    void ask();
    // Until one is found: the guest may join this room on their machine in another tab.
    const again = () => {
      if (!found && document.visibilityState === "visible") void ask();
    };
    document.addEventListener("visibilitychange", again);
    // Or right away, when one of their machines joined it from this page.
    const stopListening = appAtomRegistry.subscribe(roomMachineJoinsAtom(share.shareId), () => {
      if (!found) void ask();
    });
    return () => {
      current = false;
      document.removeEventListener("visibilitychange", again);
      stopListening();
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
 * the box thread's own once it has one, else the pick for the box, starting from the joined
 * thread's model.
 */
export function OwnBoxModelPicker({
  machine,
  boxId,
  pick,
  chosen,
  onPick,
}: {
  readonly machine: OwnRoomMachine;
  readonly boxId: string;
  /** What the box runs on while it has no thread: its pick, or the guest's for new boxes. */
  readonly pick: ModelSelection | undefined;
  /** The pick the board keeps for the box. */
  readonly chosen: RoomBoxModel | undefined;
  readonly onPick: (selection: ModelSelection, name: string) => void;
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
        fallback={chosen?.selection ?? fallback}
        chosen={chosen}
        onPicked={onPick}
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
