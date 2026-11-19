import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { EnvironmentId, ProviderDriverKind } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  agentsChecked,
  boxComputer,
  bringAgentComputers,
  computersAwaitingReconnect,
  computersBackOnline,
  noAgentMessage,
  steadyDiscovered,
  uncheckedDiscovered,
} from "./bringAgent.logic";

const id = (value: string) => EnvironmentId.make(value);
const LINKED_AT = "2026-11-17T12:00:00.000Z";

describe("steadyDiscovered", () => {
  const computer = (
    environmentId: string,
    availability: "checking" | "online" | "offline" | "error",
  ) => ({
    environmentId: id(environmentId),
    name: environmentId,
    availability,
    unsupported: false,
    linkedAt: LINKED_AT,
  });

  it("keeps what it showed while the account's list is asked again, and adds new computers", () => {
    const shown = [computer("desk", "online"), computer("gone", "offline")];
    expect(steadyDiscovered(shown, { listed: false, computers: [] })).toBe(shown);
    expect(
      steadyDiscovered(shown, {
        listed: true,
        computers: [computer("desk", "checking"), computer("new", "checking")],
      }),
    ).toEqual([computer("desk", "online"), computer("new", "checking")]);
    expect(
      steadyDiscovered(shown, { listed: true, computers: [computer("desk", "offline")] }),
    ).toEqual([computer("desk", "offline")]);
    // Unanswered for too long: the computers stay, but nothing says they are up.
    expect(uncheckedDiscovered(shown)).toEqual([
      computer("desk", "error"),
      computer("gone", "error"),
    ]);
  });
});

describe("boxComputer", () => {
  const desk = { environmentId: "desk", boxes: { old: "thread-1" } };
  const laptop = { environmentId: "laptop", boxes: {} };
  const none = new Set<string>();

  it("runs a box with no chat on the board's pick, else on a computer that is connected", () => {
    const fresh = { here: [desk, laptop], boxId: "new", remembered: null, disconnected: none };
    expect(boxComputer({ ...fresh, picked: "laptop" })).toEqual({
      machine: laptop,
      fixed: false,
      stranded: null,
    });
    // The pick is not connected now: the first one that is, never the pick.
    expect(boxComputer({ ...fresh, here: [desk], picked: "laptop" }).machine).toBe(desk);
    expect(boxComputer({ ...fresh, here: [], picked: "laptop" }).machine).toBeNull();
  });

  it("keeps a box on the computer its chat is on, whatever the board's pick", () => {
    expect(
      boxComputer({
        here: [desk, laptop],
        boxId: "old",
        picked: "laptop",
        remembered: null,
        disconnected: none,
      }),
    ).toEqual({ machine: desk, fixed: true, stranded: null });
  });

  it("runs a box nowhere while the computer its chat is on is not connected", () => {
    const away = { here: [laptop], boxId: "old", picked: "laptop", remembered: "desk" };
    expect(boxComputer({ ...away, disconnected: new Set(["desk"]) })).toEqual({
      machine: null,
      fixed: true,
      stranded: "desk",
    });
    // Removed from this browser, or off the board: the box starts over on the pick.
    expect(boxComputer({ ...away, disconnected: none })).toEqual({
      machine: laptop,
      fixed: false,
      stranded: null,
    });
  });
});

describe("bringAgentComputers", () => {
  const discovered = (
    environmentId: string,
    name: string,
    availability: "checking" | "online" | "offline" | "error",
    unsupported = false,
  ) => ({ environmentId: id(environmentId), name, availability, unsupported, linkedAt: LINKED_AT });

  const saved = (
    environmentId: string,
    name: string,
    phase: EnvironmentConnectionPhase,
    hasConfig: boolean,
    relayOnly = true,
  ) => ({ environmentId: id(environmentId), name, phase, hasConfig, relayOnly });

  it("retries at once the waiting computers the account says are online again", () => {
    const savedHere = [
      saved("back", "Back", "reconnecting", false),
      saved("stopped", "Stopped", "error", false),
      saved("asleep", "Asleep", "reconnecting", false),
      saved("desk", "Desk", "connected", true),
      saved("off", "Off", "available", false),
      saved("lan", "Lan", "error", false, false),
      saved("stale", "Stale", "error", false),
    ];
    expect(computersAwaitingReconnect(savedHere)).toEqual([
      id("back"),
      id("stopped"),
      id("asleep"),
      id("stale"),
    ]);
    expect(
      computersBackOnline(savedHere, [
        discovered("back", "Back", "online"),
        discovered("stopped", "Stopped", "online"),
        discovered("asleep", "Asleep", "offline"),
        discovered("desk", "Desk", "online"),
        discovered("off", "Off", "online"),
        discovered("stale", "Stale", "online", true),
      ]),
    ).toEqual([id("back"), id("stopped")]);
  });

  it("is ready only once connected here with its config, and trusts the account otherwise", () => {
    const computers = bringAgentComputers({
      saved: [
        saved("desk", "Desk", "connected", true),
        saved("laptop", "Laptop", "connected", false),
        saved("old", "Old", "offline", false),
        saved("back", "Back", "error", false),
        // Retrying here, but the account says Tinkjam Sync is not running on it.
        saved("asleep", "Asleep", "reconnecting", false),
        // Retrying here, but no longer on the account at all.
        saved("ghost", "Ghost", "reconnecting", false),
        // Paired directly, so the account never lists it.
        saved("lan", "Lan", "connected", true, false),
        // Stopped here, and the account could not say whether it is up.
        saved("unsure", "Unsure", "error", false),
      ],
      discovered: [
        // Saved here already: the account only says whether it is up.
        discovered("back", "Back", "online"),
        discovered("asleep", "Asleep", "offline"),
        discovered("desk", "Desk", "online"),
        discovered("laptop", "Laptop", "online"),
        discovered("old", "Old", "offline"),
        discovered("new", "New", "online"),
        discovered("away", "Away", "offline"),
        discovered("stale", "Stale", "online", true),
        discovered("unsure", "Unsure", "error"),
        discovered("unknown", "Unknown", "error"),
      ],
      listed: true,
    });
    expect(
      computers.map(({ environmentId, status, saved }) => [environmentId, status, saved]),
    ).toEqual([
      ["desk", "ready", true],
      ["lan", "ready", true],
      ["new", "online", false],
      ["back", "connecting", true],
      ["laptop", "connecting", true],
      ["asleep", "offline", true],
      ["away", "offline", false],
      ["old", "offline", true],
      ["unknown", "unchecked", false],
      ["unsure", "unchecked", true],
      ["stale", "unsupported", false],
      ["ghost", "gone", true],
    ]);
  });

  it("does not call a computer gone before the account's list has loaded", () => {
    const [ghost] = bringAgentComputers({
      saved: [saved("ghost", "Ghost", "reconnecting", false)],
      discovered: [],
      listed: false,
    });
    expect(ghost?.status).toBe("connecting");
  });

  it("tells computers with the same name apart by when the account got them", () => {
    const computers = bringAgentComputers({
      saved: [saved("mac-old", "James's Laptop", "reconnecting", false)],
      discovered: [
        discovered("mac-new", "James's Laptop", "online"),
        discovered("desk", "Desk", "online"),
      ],
      listed: true,
    });
    expect(computers.map(({ environmentId, addedAt }) => [environmentId, addedAt])).toEqual([
      ["desk", null],
      ["mac-new", LINKED_AT],
      // Gone from the account, so there is no date to show; "gone" tells it apart.
      ["mac-old", null],
    ]);
  });
});

describe("noAgentMessage", () => {
  const claude = ProviderDriverKind.make("claudeAgent");
  const codex = ProviderDriverKind.make("codex");
  const cursor = ProviderDriverKind.make("cursor");
  const provider = (
    driver: ProviderDriverKind,
    state: Partial<{
      enabled: boolean;
      installed: boolean;
      status: "ready" | "warning" | "error" | "disabled";
      auth: "authenticated" | "unauthenticated" | "unknown";
    }>,
  ) => ({
    driver,
    enabled: state.enabled ?? true,
    installed: state.installed ?? true,
    status: state.status ?? "ready",
    auth: { status: state.auth ?? "authenticated" },
  });

  it.each([
    {
      name: "the computer has not sent its settings yet",
      settingsLoaded: false,
      providers: [],
      message: "James's Laptop is still checking its agents. Try again in a moment.",
    },
    {
      name: "its agents have not been checked yet",
      settingsLoaded: true,
      providers: [provider(claude, { installed: false, status: "warning", auth: "unknown" })],
      message: "James's Laptop is still checking its agents. Try again in a moment.",
    },
    {
      name: "Claude Code is signed out and Codex is missing",
      settingsLoaded: true,
      providers: [
        provider(claude, { auth: "unauthenticated", status: "error" }),
        provider(codex, { installed: false, status: "error", auth: "unknown" }),
      ],
      message:
        "Tinkjam Sync found no signed-in agent on James's Laptop.\nClaude Code: not signed in. Open Claude Code on that computer and sign in.\nCodex: not installed.",
    },
    {
      name: "other installed agents are named, missing or turned-off ones are not",
      settingsLoaded: true,
      providers: [
        provider(claude, { enabled: false, installed: false, status: "warning" }),
        provider(codex, { auth: "unauthenticated" }),
        provider(cursor, { status: "error", auth: "unknown" }),
        provider(ProviderDriverKind.make("grok"), { installed: false, status: "error" }),
        provider(ProviderDriverKind.make("kiro"), { enabled: false, installed: false }),
      ],
      message:
        "Tinkjam Sync found no signed-in agent on James's Laptop.\nClaude Code: turned off in Tinkjam settings.\nCodex: not signed in. Open the ChatGPT or Codex app on that computer and sign in.\nCursor: installed, but it did not start.",
    },
  ])("says what it found when $name", ({ settingsLoaded, providers, message }) => {
    expect(noAgentMessage({ computerName: "James's Laptop", settingsLoaded, providers })).toBe(
      message,
    );
    // An agent comes by itself only once none of them is still being checked.
    expect(agentsChecked(providers)).toBe(!message.includes("still checking"));
  });
});
