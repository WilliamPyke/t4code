import { describe, expect, it } from "vite-plus/test";

import {
  parseProcessTable,
  processTree,
  RESTART_WINDOW_MS,
  restartDecision,
  supervisorRow,
  takeoverDecision,
} from "./syncProcesses.ts";

describe("Tinkjam Sync's single instance", () => {
  it("starts alone, leaves a background or Mac app Sync running, and ends a foreground or unknown one", () => {
    expect(takeoverDecision(undefined)).toBe("start");
    expect(takeoverDecision({ pid: 7, parentPid: 6, mode: "background" })).toBe("yield");
    expect(takeoverDecision({ pid: 7, parentPid: 6, mode: "app" })).toBe("yield");
    expect(takeoverDecision({ pid: 7, parentPid: 6, mode: "foreground" })).toBe("take-over");
    // A Sync from before these records, such as an older foreground `npx` run.
    expect(takeoverDecision({ pid: 7, parentPid: undefined, mode: "unknown" })).toBe("take-over");
  });

  it("waits longer after each recent start and gives up after five within ten minutes", () => {
    const now = 1_000_000_000;
    const delays: Array<number> = [];
    let starts: ReadonlyArray<number> = [];
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const decision = restartDecision(starts, now + attempt);
      if (decision.kind !== "start") throw new Error("gave up too early");
      delays.push(decision.delayMs);
      starts = decision.starts;
    }
    expect(delays).toEqual([0, 5000, 10_000, 20_000, 40_000]);
    expect(restartDecision(starts, now + 10).kind).toBe("give-up");
    // Starts older than the window no longer count: a log-in later starts at once.
    expect(restartDecision(starts, now + RESTART_WINDOW_MS + 10)).toEqual({
      kind: "start",
      delayMs: 0,
      starts: [now + RESTART_WINDOW_MS + 10],
    });
  });
});

describe("Tinkjam Sync's process census", () => {
  const windows = [
    "4|0|System",
    "900|600|wscript.exe",
    "1000|900|node.exe",
    "1100|1000|cloudflared.exe",
    "1200|1000|codex.exe",
    "1300|1200|conhost.exe",
    "2000|600|node.exe",
  ].join("\r\n");

  it("reads Windows and ps tables", () => {
    expect(parseProcessTable(windows)).toContainEqual({
      pid: 900,
      parentPid: 600,
      name: "wscript.exe",
    });
    expect(
      parseProcessTable("  41   1 /opt/homebrew/bin/node\n  42  41 /Users/a b/cloudflared\n"),
    ).toEqual([
      { pid: 41, parentPid: 1, name: "node" },
      { pid: 42, parentPid: 41, name: "cloudflared" },
    ]);
  });

  it("counts a Sync's supervisor, itself and what it started, and nothing beside it", () => {
    const rows = parseProcessTable(windows);
    const holder = { pid: 1000, parentPid: 900, mode: "background" } as const;
    const supervisor = supervisorRow(rows, holder);
    expect(supervisor?.pid).toBe(900);
    expect(processTree(rows, supervisor!.pid).map((row) => row.pid)).toEqual([
      900, 1000, 1100, 1200, 1300,
    ]);
    // A foreground Sync's parent is the terminal's launcher, which is not ended for it.
    expect(supervisorRow(rows, { ...holder, mode: "foreground" })).toBeUndefined();
    expect(supervisorRow(rows, { ...holder, parentPid: 2000 })).toBeUndefined();
  });
});
