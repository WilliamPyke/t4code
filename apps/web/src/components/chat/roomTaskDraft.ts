import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  ComposerContextId,
  type GuestShareId,
  type OrchestrationMessageContext,
  ROOM_TASK_CONTEXT_KIND,
  type RoomTaskContextPayload,
  type ScopedThreadRef,
  type UnknownContextRecord,
} from "@t3tools/contracts";
import { create } from "zustand";

import { useComposerDraftStore } from "~/composerDraftStore";
import { randomUUID } from "~/lib/utils";

/**
 * A task card the owner took from their room's board to this thread's agent. The composer shows
 * it until the owner sends the draft, which then answers the task, or drops it. It sends nothing.
 */
export interface RoomTaskDraft {
  readonly threadRef: ScopedThreadRef;
  readonly shareId: GuestShareId;
  readonly taskId: string;
  readonly text: string;
}

const useRoomTaskDrafts = create<Readonly<Record<string, RoomTaskDraft>>>(() => ({}));

export function dropRoomTaskDraft(threadRef: ScopedThreadRef) {
  const key = scopedThreadKey(threadRef);
  const { [key]: dropped, ...rest } = useRoomTaskDrafts.getState();
  if (dropped !== undefined) useRoomTaskDrafts.setState(rest, true);
}

let watchingDrafts = false;
/** A draft sent, cleared or emptied takes its task with it, so an unrelated message answers none. */
function watchDrafts() {
  if (watchingDrafts) return;
  watchingDrafts = true;
  useComposerDraftStore.subscribe((drafts) => {
    for (const task of Object.values(useRoomTaskDrafts.getState())) {
      if ((drafts.getComposerDraft(task.threadRef)?.prompt.trim() ?? "") === "") {
        dropRoomTaskDraft(task.threadRef);
      }
    }
  });
}

/** Ties the thread's draft to a task. Call it after the task's text is in the draft. */
export function takeRoomTaskToDraft(task: RoomTaskDraft) {
  watchDrafts();
  useRoomTaskDrafts.setState(
    { ...useRoomTaskDrafts.getState(), [scopedThreadKey(task.threadRef)]: task },
    true,
  );
}

export const readRoomTaskDraft = (threadRef: ScopedThreadRef): RoomTaskDraft | undefined =>
  useRoomTaskDrafts.getState()[scopedThreadKey(threadRef)];

export const useRoomTaskDraft = (threadRef: ScopedThreadRef): RoomTaskDraft | undefined =>
  useRoomTaskDrafts((drafts) => drafts[scopedThreadKey(threadRef)]);

/**
 * A message's context with a record of the task it answers. The text never references it, so
 * the agent never reads it; the owner's server reads it once the turn finishes.
 */
export function withRoomTaskContext(
  context: OrchestrationMessageContext | undefined,
  task: RoomTaskDraft | undefined,
): OrchestrationMessageContext | undefined {
  if (task === undefined) return context;
  const payload: RoomTaskContextPayload = { shareId: task.shareId, taskId: task.taskId };
  const record: UnknownContextRecord = {
    version: 1,
    contextId: ComposerContextId.make(`room-task-${randomUUID()}`),
    kind: ROOM_TASK_CONTEXT_KIND,
    label: "Task from the board",
    payload,
  };
  return context === undefined
    ? { version: 1, records: [record] }
    : { ...context, records: [...context.records, record] };
}
