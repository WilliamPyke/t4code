import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import {
  ComposerContextId,
  type GuestShareId,
  type OrchestrationMessageContext,
  ROOM_TASK_CONTEXT_KIND,
  type RoomArtifactContextRecord,
  type RoomTaskContextPayload,
  type ScopedThreadRef,
  type UnknownContextRecord,
} from "@t3tools/contracts";
import { formatComposerContextReference } from "@t3tools/shared/composerContextReferences";
import { create, type StoreApi, type UseBoundStore } from "zustand";

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

/**
 * An artifact card the user took from a room to this thread's agent, with what the card shows
 * now. The composer shows it until the user sends the draft, which then carries it, so the reply
 * fills the card in the room once the turn finishes; or drops it. It sends nothing.
 */
export interface RoomArtifactDraft {
  readonly threadRef: ScopedThreadRef;
  readonly record: RoomArtifactContextRecord;
}

const useRoomArtifactDrafts = create<Readonly<Record<string, RoomArtifactDraft>>>(() => ({}));

const dropFrom =
  <T>(store: UseBoundStore<StoreApi<Readonly<Record<string, T>>>>) =>
  (threadRef: ScopedThreadRef) => {
    const { [scopedThreadKey(threadRef)]: dropped, ...rest } = store.getState();
    if (dropped !== undefined) store.setState(rest, true);
  };

export const dropRoomTaskDraft = dropFrom(useRoomTaskDrafts);
export const dropRoomArtifactDraft = dropFrom(useRoomArtifactDrafts);

let watchingDrafts = false;
/**
 * A draft sent, cleared or emptied takes its task and artifact with it, so an unrelated message
 * answers or fills none.
 */
function watchDrafts() {
  if (watchingDrafts) return;
  watchingDrafts = true;
  useComposerDraftStore.subscribe((drafts) => {
    const empty = (threadRef: ScopedThreadRef) =>
      (drafts.getComposerDraft(threadRef)?.prompt.trim() ?? "") === "";
    for (const task of Object.values(useRoomTaskDrafts.getState())) {
      if (empty(task.threadRef)) dropRoomTaskDraft(task.threadRef);
    }
    for (const artifact of Object.values(useRoomArtifactDrafts.getState())) {
      if (empty(artifact.threadRef)) dropRoomArtifactDraft(artifact.threadRef);
    }
  });
}

/** Ties the thread's draft to an artifact card. Call it after the prompt is in the draft. */
export function takeRoomArtifactToDraft(draft: RoomArtifactDraft) {
  watchDrafts();
  useRoomArtifactDrafts.setState(
    { ...useRoomArtifactDrafts.getState(), [scopedThreadKey(draft.threadRef)]: draft },
    true,
  );
}

export const readRoomArtifactDraft = (threadRef: ScopedThreadRef): RoomArtifactDraft | undefined =>
  useRoomArtifactDrafts.getState()[scopedThreadKey(threadRef)];

export const useRoomArtifactDraft = (threadRef: ScopedThreadRef): RoomArtifactDraft | undefined =>
  useRoomArtifactDrafts((drafts) => drafts[scopedThreadKey(threadRef)]);

/**
 * A message with the artifact card it fills: the card's chip after the text, so the user sees in
 * the thread what went to their agent, and its record, which tells the agent so.
 */
export function withRoomArtifact(
  message: { readonly text: string; readonly context: OrchestrationMessageContext | undefined },
  artifact: RoomArtifactDraft | undefined,
): { readonly text: string; readonly context: OrchestrationMessageContext | undefined } {
  if (artifact === undefined) return message;
  const { context } = message;
  return {
    text: `${message.text}\n\n${formatComposerContextReference(artifact.record)}`,
    context:
      context === undefined
        ? { version: 1, records: [artifact.record] }
        : { ...context, records: [...context.records, artifact.record] },
  };
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
