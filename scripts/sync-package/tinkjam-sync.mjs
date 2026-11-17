#!/usr/bin/env node
// Tinkjam Sync: runs this computer's agents for Tinkjam, connected to the person's own account.
// The server's CLI runs only as its own entry point, so it starts as a child that owns the terminal.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { readSyncRelease, syncUpdateNotice } from "./update-check.mjs";

const HOSTED_APP_URL = "__TINKJAM_HOSTED_APP_URL__";
const SYNC_VERSION = "__TINKJAM_SYNC_VERSION__";
const SYNC_MANIFEST_URL = "__TINKJAM_SYNC_MANIFEST_URL__";
const SYNC_URL = "__TINKJAM_SYNC_URL__";
// Long enough for a slow connection, short enough that nobody waits on it.
const UPDATE_CHECK_TIMEOUT_MS = 1500;

const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const supported =
  (major === 22 && minor >= 16) ||
  (major === 23 && minor >= 11) ||
  (major === 24 && minor >= 10) ||
  major >= 25;
if (!supported) {
  console.error(
    `Tinkjam Sync needs Node.js 22.16 or newer; this computer has ${process.versions.node}.\n` +
      "Install the current version from https://nodejs.org, then run the same command again.",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
// The server's own help would name its command and flags in its own words.
if (args.includes("--help") || args.includes("-h")) {
  console.log(
    [
      "Tinkjam Sync connects the agents on this computer, such as Claude Code or Codex, to your",
      "Tinkjam boards. They run here, on your own sign-in, and only you can send them work.",
      "",
      "Usage",
      `  npx -y ${SYNC_URL} [options]`,
      "",
      "Options",
      "  --disconnect      Disconnect this computer from your Tinkjam account and sign out.",
      "  --base-dir <dir>  Where Tinkjam Sync keeps its data on this computer.",
      `                    Default: ${NodePath.join(NodeOS.homedir(), ".tinkjam")}`,
      "  --version         Show which version of Tinkjam Sync this is.",
      "  --help            Show this help.",
      "",
      "Keep the window open while you work. Press Ctrl+C to stop.",
    ].join("\n"),
  );
  process.exit(0);
}
if (args.includes("--version") || args.includes("-v")) {
  console.log(`Tinkjam Sync ${SYNC_VERSION}`);
  process.exit(0);
}

const notice = syncUpdateNotice(
  SYNC_VERSION,
  await readSyncRelease(SYNC_MANIFEST_URL, UPDATE_CHECK_TIMEOUT_MS),
);
if (notice !== null) console.log(notice);

const entry = NodeURL.fileURLToPath(new URL("../dist/bin.mjs", import.meta.url));
const child = NodeChildProcess.spawn(
  process.execPath,
  [...process.execArgv, entry, "sync", ...args],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      // Its own home, apart from any other copy of this server on the computer.
      T3CODE_HOME: process.env.T3CODE_HOME || NodePath.join(NodeOS.homedir(), ".tinkjam"),
      T3CODE_HOSTED_APP_URL: process.env.T3CODE_HOSTED_APP_URL || HOSTED_APP_URL,
    },
  },
);

// Ctrl+C reaches the child too; it shuts down and this process follows it out.
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    if (signal !== "SIGINT") child.kill(signal);
  });
}
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal === null ? 1 : 128 + (NodeOS.constants.signals[signal] ?? 0)));
});
child.on("error", (error) => {
  console.error(`Tinkjam Sync could not start: ${error.message}`);
  process.exit(1);
});
