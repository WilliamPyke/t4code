import {
  GuestId,
  type ModelSelection,
  ProviderInstanceId,
  type RoomBoard,
  type RoomBoxModel,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { boardBoxModelPick, boardLocalModelPick, boardNewBoxModel } from "./boardBoxModel.logic";

const selection = (model: string): ModelSelection => ({
  instanceId: ProviderInstanceId.make("codex"),
  model,
});
const picked = (model: string, at: string): RoomBoxModel => ({
  selection: selection(model),
  name: model,
  at,
});
const sam = GuestId.make("sam");

describe("boardNewBoxModel", () => {
  it("starts a person's new box on the model they last picked for one of their own boxes", () => {
    const board: RoomBoard = {
      positions: {},
      notes: [
        {
          id: "a",
          text: "",
          x: 0,
          y: 0,
          kind: "thread",
          boxModel: picked("mini", "2026-11-15T10:00:00Z"),
        },
        {
          id: "b",
          text: "",
          x: 0,
          y: 0,
          kind: "thread",
          boxModel: picked("nano", "2026-11-15T11:00:00Z"),
        },
        { id: "c", text: "", x: 0, y: 0, kind: "thread" },
        {
          id: "sams",
          text: "",
          x: 0,
          y: 0,
          kind: "thread",
          guestId: sam,
          boxModel: picked("sam-model", "2026-11-15T12:00:00Z"),
        },
      ],
    };
    expect(boardNewBoxModel(board, null)).toEqual(selection("nano"));
    expect(boardNewBoxModel(board, sam)).toEqual(selection("sam-model"));
    expect(boardNewBoxModel(board, "eve")).toBeUndefined();
    expect(boardNewBoxModel(undefined, null)).toBeUndefined();
    // The room thread's own box is the owner's too.
    const room = { ...board, roomBoxModel: picked("room", "2026-11-15T13:00:00Z") };
    expect(boardNewBoxModel(room, null)).toEqual(selection("room"));
    expect(boardNewBoxModel(room, sam)).toEqual(selection("sam-model"));
  });
});

describe("boardBoxModelPick", () => {
  const chosen = picked("mini", "2026-11-15T10:00:00Z");
  it.each<[string, Parameters<typeof boardBoxModelPick>[0], ModelSelection | undefined]>([
    [
      "a box that never ran takes the board's pick",
      { picked: undefined, chosen, lastRunAt: null },
      chosen.selection,
    ],
    [
      "the pick came after its last run",
      { picked: undefined, chosen, lastRunAt: "2026-11-15T09:00:00Z" },
      chosen.selection,
    ],
    [
      "it ran since the pick: its own model",
      { picked: undefined, chosen, lastRunAt: "2026-11-15T10:05:00Z" },
      undefined,
    ],
    [
      "its thread not known here yet",
      { picked: undefined, chosen, lastRunAt: undefined },
      chosen.selection,
    ],
    [
      "nobody picked: its own model",
      { picked: undefined, chosen: undefined, lastRunAt: null },
      undefined,
    ],
    [
      "this device's unsent pick",
      { picked: selection("nano"), chosen, lastRunAt: null },
      selection("nano"),
    ],
  ])("%s", (_, input, expected) => {
    expect(boardBoxModelPick(input)).toEqual(expected);
  });

  it("keeps this device's pick only until the board shows a newer one", () => {
    const pick = { selection: selection("nano"), name: "nano", over: chosen.at };
    expect(boardLocalModelPick(pick, chosen)).toEqual(selection("nano"));
    expect(boardLocalModelPick(pick, picked("nano", "2026-11-15T10:01:00Z"))).toBeUndefined();
    expect(boardLocalModelPick({ ...pick, over: undefined }, undefined)).toEqual(selection("nano"));
  });
});
