import { describe, expect, it } from "vite-plus/test";

import { readShellMode, setShellMode } from "./shellMode";
import {
  advancedOnlyPageName,
  paletteActionShows,
  resolveShellMode,
  settingsLandingPath,
} from "./shellMode.logic";

describe("shell mode", () => {
  it("defaults to Simple on the hosted app and Advanced where the app is served locally", () => {
    expect(resolveShellMode(null, true)).toBe("simple");
    expect(resolveShellMode(null, false)).toBe("advanced");
  });

  it("keeps a choice made on this browser wherever the app is served", () => {
    expect(resolveShellMode("advanced", true)).toBe("advanced");
    expect(resolveShellMode("simple", false)).toBe("simple");
  });

  it("remembers the choice across reads, and switches back", () => {
    // Outside a hosted origin, nothing stored reads as Advanced.
    expect(readShellMode()).toBe("advanced");
    setShellMode("simple");
    expect(readShellMode()).toBe("simple");
    setShellMode("advanced");
    expect(readShellMode()).toBe("advanced");
  });

  it("names the pages only Advanced lists, and leaves every other page alone", () => {
    expect(advancedOnlyPageName("/usage")).toBe("Usage");
    expect(advancedOnlyPageName("/pull-requests")).toBe("Pull requests");
    expect(advancedOnlyPageName("/projects/env:abc")).toBe("Project settings");
    for (const pathname of ["/", "/settings", "/settings/general", "/whats-new", "/account"]) {
      expect(advancedOnlyPageName(pathname)).toBeNull();
    }
    expect(advancedOnlyPageName("/board/env/thread")).toBeNull();
  });

  it("lets Simple open pull requests once the person has a computer connected", () => {
    expect(advancedOnlyPageName("/pull-requests", true)).toBeNull();
    expect(advancedOnlyPageName("/usage", true)).toBe("Usage");
    expect(advancedOnlyPageName("/projects/env:abc", true)).toBe("Project settings");
  });

  it("keeps the command menu to boards and the ways to more in Simple, and everything in Advanced", () => {
    for (const value of ["action:new-board", "action:settings", "action:switch-shell-mode"]) {
      expect(paletteActionShows(value, "simple")).toBe(true);
    }
    for (const value of ["action:add-project", "action:usage", "action:open-file-picker"]) {
      expect(paletteActionShows(value, "simple")).toBe(false);
      expect(paletteActionShows(value, "advanced")).toBe(true);
    }
  });

  it("offers pull requests in Simple only with a computer connected", () => {
    expect(paletteActionShows("action:pull-requests", "simple")).toBe(false);
    expect(paletteActionShows("action:pull-requests", "simple", true)).toBe(true);
    expect(paletteActionShows("action:pull-requests", "advanced")).toBe(true);
    expect(paletteActionShows("action:pull-requests", "advanced", false)).toBe(true);
  });

  it("opens Settings on the short page in Simple and the full set in Advanced", () => {
    expect(settingsLandingPath("simple")).toBe("/settings");
    expect(settingsLandingPath("advanced")).toBe("/settings/general");
  });
});
