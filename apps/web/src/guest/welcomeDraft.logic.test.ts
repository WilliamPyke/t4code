import { CLOUD_BOARD_TITLE_MAX_LENGTH, GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  EMPTY_WELCOME_DRAFT,
  parseWelcomeDraft,
  serializeWelcomeDraft,
} from "./welcomeDraft.logic";

const STARTERS = ["blank", "project-kickoff", "design-review"];

describe("what the welcome form keeps across signing in", () => {
  it("brings back the starter, the board name and the typed name", () => {
    const draft = { templateId: "design-review", title: "Launch plan", name: "Maya" };
    expect(parseWelcomeDraft(serializeWelcomeDraft(draft), STARTERS)).toEqual(draft);
  });

  it("leaves an untouched name untouched, so the account's name or the suggestion shows", () => {
    const draft = { templateId: "project-kickoff", title: "", name: null };
    expect(parseWelcomeDraft(serializeWelcomeDraft(draft), STARTERS)).toEqual(draft);
  });

  it("fits what was kept to what the form can show now", () => {
    const kept = serializeWelcomeDraft({
      templateId: "retired-starter",
      title: "T".repeat(CLOUD_BOARD_TITLE_MAX_LENGTH + 5),
      name: "N".repeat(GUEST_NAME_MAX_LENGTH + 5),
    });
    expect(parseWelcomeDraft(kept, STARTERS)).toEqual({
      templateId: null,
      title: "T".repeat(CLOUD_BOARD_TITLE_MAX_LENGTH),
      name: "N".repeat(GUEST_NAME_MAX_LENGTH),
    });
  });

  it.each([
    ["nothing kept", null],
    ["text that is not a draft", "not json"],
    ["a draft of another shape", JSON.stringify({ templateId: 3, title: null })],
  ])("starts empty from %s", (_case, raw) => {
    expect(parseWelcomeDraft(raw, STARTERS)).toEqual(EMPTY_WELCOME_DRAFT);
  });
});
