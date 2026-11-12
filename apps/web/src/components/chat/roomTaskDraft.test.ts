import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, GuestShareId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { useComposerDraftStore } from "~/composerDraftStore";

import { readRoomTaskDraft, takeRoomTaskToDraft, withRoomTaskContext } from "./roomTaskDraft";

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
    store.setPrompt(threadRef, "Fix login, and on Safari too");
    expect(readRoomTaskDraft(threadRef)).toBe(task);
    expect(withRoomTaskContext(undefined, task)?.records).toMatchObject([
      { kind: "room-task", payload: { shareId: "share:room", taskId: "task:1" } },
    ]);

    // An emptied draft, as a send or the owner leaves it, takes the task with it.
    store.setPrompt(threadRef, "");
    store.setPrompt(threadRef, "Something unrelated");
    expect(readRoomTaskDraft(threadRef)).toBeUndefined();
    expect(withRoomTaskContext(undefined, readRoomTaskDraft(threadRef))).toBeUndefined();
  });
});
