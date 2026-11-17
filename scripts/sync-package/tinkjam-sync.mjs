#!/usr/bin/env node
// Tinkjam Sync: runs this computer's agents for Tinkjam, connected to the person's own account.
// The server's CLI runs only as its own entry point, so it starts as a child that owns the terminal.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import {
  logTail,
  parseSyncArgs,
  resolveBaseDir,
  runService,
  syncService,
  waitForConnected,
} from "./service.mjs";
import { readSyncRelease, syncUpdateNotice } from "./update-check.mjs";

const HOSTED_APP_URL = "__TINKJAM_HOSTED_APP_URL__";
const SYNC_VERSION = "__TINKJAM_SYNC_VERSION__";
const SYNC_MANIFEST_URL = "__TINKJAM_SYNC_MANIFEST_URL__";
const SYNC_URL = "__TINKJAM_SYNC_URL__";
// Long enough for a slow connection, short enough that nobody waits on it.
const UPDATE_CHECK_TIMEOUT_MS = 1500;
// The tunnel can take a minute or two to route; the server says so itself after 90 seconds.
const CONNECT_TIMEOUT_MS = 3 * 60 * 1000;

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
      "  --install         Run Tinkjam Sync in the background, with no window, and start it",
      "                    again whenever you log in. Connects this computer first if needed.",
      "  --uninstall       Stop running it in the background. This computer stays connected.",
      "  --status          Show whether Tinkjam Sync runs in the background.",
      "  --disconnect      Disconnect this computer from your Tinkjam account and sign out.",
      "  --base-dir <dir>  Where Tinkjam Sync keeps its data on this computer.",
      `                    Default: ${resolveBaseDir(undefined, undefined)}`,
      "  --version         Show which version of Tinkjam Sync this is.",
      "  --help            Show this help.",
      "",
      "Without --install, keep the window open while you work. Press Ctrl+C to stop.",
    ].join("\n"),
  );
  process.exit(0);
}
if (args.includes("--version") || args.includes("-v")) {
  console.log(`Tinkjam Sync ${SYNC_VERSION}`);
  process.exit(0);
}

let parsed;
try {
  parsed = parseSyncArgs(args);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(2);
}
const baseDir = resolveBaseDir(parsed.baseDir, process.env.T3CODE_HOME);
// oxlint-disable-next-line t3code/no-global-process-runtime -- The plain-Node launcher has no Effect runtime to inject it.
const platform = process.platform;
const service = syncService(baseDir, platform);
const packageDir = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const ownEntry = NodeURL.fileURLToPath(new URL("../dist/bin.mjs", import.meta.url));
const serverEnv = {
  ...process.env,
  // Its own home, apart from any other copy of this server on the computer.
  T3CODE_HOME: baseDir,
  T3CODE_HOSTED_APP_URL: process.env.T3CODE_HOSTED_APP_URL || HOSTED_APP_URL,
};
const exitCodeOf = (code, signal) =>
  code ?? (signal === null ? 1 : 128 + (NodeOS.constants.signals[signal] ?? 0));

/** Runs the server's `sync` command in this terminal and resolves with its exit code. */
const runInTerminal = (entry, syncArgs) =>
  new Promise((resolve) => {
    const child = NodeChildProcess.spawn(
      process.execPath,
      [...process.execArgv, entry, "sync", ...syncArgs],
      { stdio: "inherit", env: serverEnv },
    );
    // Ctrl+C reaches the child too; it shuts down and this process follows it out.
    for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      process.on(signal, () => {
        if (signal !== "SIGINT") child.kill(signal);
      });
    }
    child.on("exit", (code, signal) => resolve(exitCodeOf(code, signal)));
    child.on("error", (error) => {
      console.error(`Tinkjam Sync could not start: ${error.message}`);
      resolve(1);
    });
  });

const printUpdateNotice = async (options) => {
  const notice = syncUpdateNotice(
    SYNC_VERSION,
    await readSyncRelease(SYNC_MANIFEST_URL, UPDATE_CHECK_TIMEOUT_MS),
    options,
  );
  if (notice !== null) console.log(notice);
};

const uninstallCommand = `npx -y ${SYNC_URL} --uninstall`;

if (parsed.action === "service") {
  await runService({
    paths: service.paths,
    platform,
    startServer: (output) =>
      NodeChildProcess.spawn(
        process.execPath,
        [ownEntry, "sync", "--background", "--base-dir", baseDir],
        { stdio: ["ignore", output, output], env: serverEnv, windowsHide: true },
      ),
  });
}

if (parsed.action === "status") {
  if (!service.installed()) {
    console.log("Tinkjam Sync is not set up to run in the background on this computer.");
  } else {
    console.log(
      service.running()
        ? "Tinkjam Sync is running in the background and starts when you log in."
        : "Tinkjam Sync starts when you log in, but is not running now.",
    );
    console.log(`Login item: ${service.location}`);
  }
  console.log(`Log: ${service.paths.log}`);
  process.exit(0);
}

if (parsed.action === "uninstall" || parsed.serverArgs.includes("--disconnect")) {
  if (service.installed() || service.running()) {
    if (!service.uninstall()) {
      console.error(
        "Tinkjam Sync in the background did not stop. Restart the computer to stop it.",
      );
    }
    console.log("Tinkjam Sync no longer runs in the background or starts when you log in.");
  } else if (parsed.action === "uninstall") {
    console.log("Tinkjam Sync is not set up to run in the background on this computer.");
  }
  if (parsed.action === "uninstall") {
    console.log(
      `This computer is still connected to your Tinkjam account. To remove it, run:\n\n  npx -y ${SYNC_URL} --disconnect`,
    );
    process.exit(0);
  }
}

if (parsed.action === "install") {
  await printUpdateNotice({ install: true });
  if (!service.supported) {
    console.error(
      "Tinkjam Sync cannot run in the background on this system. Run it without --install.",
    );
    process.exit(1);
  }
  try {
    // A copy already running in the background holds the files this replaces.
    if (!service.stop()) throw new Error("the copy already running in the background did not stop");
    service.copyPackage(packageDir);
    service.writeSettings();
  } catch (error) {
    console.error(`Tinkjam Sync could not be set up to run in the background: ${error.message}`);
    process.exit(1);
  }
  // Only a person at this computer can press Connect, so connecting happens here, in the open.
  const connected = await runInTerminal(service.paths.serverEntry, [
    "--connect-only",
    ...parsed.serverArgs,
  ]);
  if (connected !== 0) process.exit(connected);
  const from = service.logSize();
  try {
    service.start();
  } catch (error) {
    console.error(`Tinkjam Sync could not start in the background: ${error.message}`);
    process.exit(1);
  }
  console.log("Starting Tinkjam Sync in the background...");
  const outcome = await waitForConnected({
    paths: service.paths,
    from,
    timeoutMs: CONNECT_TIMEOUT_MS,
    say: (line) => console.log(line),
  });
  if (outcome !== "connected") {
    console.error(
      [
        outcome === "not-connected"
          ? "Tinkjam Sync in the background found this computer not connected."
          : "Tinkjam Sync started in the background but has not connected yet.",
        `The end of its log (${service.paths.log}):`,
        "",
        logTail(service.paths),
      ].join("\n"),
    );
    process.exit(1);
  }
  console.log(
    [
      "Connected.",
      "",
      `To stop it from starting when you log in, run: ${uninstallCommand}`,
      "Tinkjam Sync is running in the background and will start when you log in.",
    ].join("\n"),
  );
  process.exit(0);
}

// Only one Sync per computer: the background copy already holds this home.
if (!parsed.serverArgs.includes("--disconnect") && service.running()) {
  console.log(
    `Tinkjam Sync is already running in the background on this computer. To stop it, run: ${uninstallCommand}`,
  );
  await printUpdateNotice({ install: true });
  process.exit(0);
}

await printUpdateNotice();
process.exit(await runInTerminal(ownEntry, parsed.serverArgs));
