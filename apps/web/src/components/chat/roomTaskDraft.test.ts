import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, GuestShareId, ThreadId } from "@t3tools/contracts";
import {
  formatComposerContextReference,
  roomArtifactContextRecord,
} from "@t3tools/shared/composerContextReferences";
import { describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "~/composerDraftStore";

import {
  readRoomArtifactDraft,
  readRoomTaskDraft,
  takeRoomArtifactToDraft,
  takeRoomTaskToDraft,
  withRoomArtifact,
  withRoomTaskContext,
} from "./roomTaskDraft";

describe("room task drafts", () => {
  it("answers a task only with the draft it was taken into", () => {
    const threadRef = scopeThreadRef(
      EnvironmentId.make("environment:owner"),
      ThreadId.make("thread:shared"),
    );
    const task = {
      threadRef,
      shareId: GuestShareId.make("share:room"),
      taskId: "task:1",
      text: "Fix login",
    };
    const store = useComposerDraftStore.getState();
    store.setPrompt(threadRef, "Fix login");
    takeRoomTaskToDraft(task);
    const record = roomArtifactContextRecord({
      batch: "take-1",
      shareId: task.shareId,
      noteId: "note:plan",
      title: "Plan",
      current: "# Plan",
    });
    const artifact = { threadRef, record };
    takeRoomArtifactToDraft(artifact);
    store.setPrompt(threadRef, "Fix login, and on Safari too");
    expect(readRoomTaskDraft(threadRef)).toBe(task);
    expect(withRoomTaskContext(undefined, task)?.records).toMatchObject([
      { kind: "room-task", payload: { shareId: "share:room", taskId: "task:1" } },
    ]);
    // The artifact goes as a chip the user sees after their text, and the record it names.
    const sent = withRoomArtifact({ text: "Make it blue", context: undefined }, artifact);
    expect(sent.text).toBe(`Make it blue\n\n${formatComposerContextReference(record)}`);
    expect(sent.context?.records).toEqual([record]);

    // An emptied draft, as a send or the owner leaves it, takes the task and artifact with it.
    store.setPrompt(threadRef, "");
    store.setPrompt(threadRef, "Something unrelated");
    expect(readRoomTaskDraft(threadRef)).toBeUndefined();
    expect(withRoomTaskContext(undefined, readRoomTaskDraft(threadRef))).toBeUndefined();
    expect(readRoomArtifactDraft(threadRef)).toBeUndefined();
  });
});
