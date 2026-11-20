#!/usr/bin/env node
// Tinkjam Sync: runs this computer's agents for Tinkjam, connected to the person's own account.
// The server's CLI runs only as its own entry point, so it starts as a child that owns the terminal.
// In the background the login item runs the server directly; this launcher only sets that up.
import * as NodeChildProcess from "node:child_process";
import * as NodeOS from "node:os";
import * as NodeURL from "node:url";

import {
  installedMacApp,
  installedWindowsApp,
  logTail,
  npmCliFor,
  parseSyncArgs,
  resolveBaseDir,
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
// The environment variable shortens it for tests.
const CONNECT_TIMEOUT_MS = Number(process.env.TINKJAM_SYNC_CONNECT_TIMEOUT_MS) || 3 * 60 * 1000;

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
      "  --status          Show whether Tinkjam Sync runs, and its processes.",
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
const service = syncService(baseDir, process.platform);
const packageDir = NodeURL.fileURLToPath(new URL("..", import.meta.url));
const ownEntry = NodeURL.fileURLToPath(new URL("../dist/bin.mjs", import.meta.url));
const hostedAppUrl = process.env.T3CODE_HOSTED_APP_URL || HOSTED_APP_URL;
const serverEnv = {
  ...process.env,
  // Its own home, apart from any other copy of this server on the computer.
  T3CODE_HOME: baseDir,
  T3CODE_HOSTED_APP_URL: hostedAppUrl,
  TINKJAM_SYNC_URL: SYNC_URL,
};
const exitCodeOf = (code, signal) =>
  code ?? (signal === null ? 1 : 128 + (NodeOS.constants.signals[signal] ?? 0));

/** Runs the server's `sync` command in this terminal and resolves with its exit code. */
const runSync = (entry, syncArgs) =>
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

const homeArgs = ["--base-dir", baseDir];

/**
 * Takes down every Tinkjam Sync of this home: its login items on every mechanism, leftovers an
 * agent made, and running processes (the server ends them by its lock records, whole trees).
 */
const takeDown = async () => {
  const removed = service.sweep();
  await runSync(ownEntry, ["--stop-running", ...homeArgs]);
  if (removed.length > 0) console.log(`Removed:\n${removed.map((line) => `  ${line}`).join("\n")}`);
};

const printUpdateNotice = async (options) => {
  const notice = syncUpdateNotice(
    SYNC_VERSION,
    await readSyncRelease(SYNC_MANIFEST_URL, UPDATE_CHECK_TIMEOUT_MS),
    options,
  );
  if (notice !== null) console.log(notice);
};

const uninstallCommand = `npx -y ${SYNC_URL} --uninstall`;

// The Mac app runs the default home's Sync and is its own login item. Its own calls name the home.
const macApp =
  // oxlint-disable-next-line t3code/no-global-process-runtime -- The plain-Node launcher has no Effect runtime to inject it.
  process.platform === "darwin" &&
  parsed.baseDir === undefined &&
  baseDir === resolveBaseDir(undefined, undefined)
    ? installedMacApp(NodeOS.homedir())
    : undefined;

// So does the Windows app. Its own calls name the home (and set TINKJAM_SYNC_FROM_APP) and go
// through; a person or an agent typing the published command does neither.
const windowsApp =
  // oxlint-disable-next-line t3code/no-global-process-runtime -- The plain-Node launcher has no Effect runtime to inject it.
  process.platform === "win32" &&
  parsed.baseDir === undefined &&
  !process.env.TINKJAM_SYNC_FROM_APP &&
  baseDir === resolveBaseDir(undefined, undefined)
    ? installedWindowsApp(process.env.LOCALAPPDATA || `${NodeOS.homedir()}\\AppData\\Local`)
    : undefined;
const WINDOWS_ICON = "its icon near the clock (click the ^ arrow if it is not showing)";

if (parsed.action === "status") {
  const items = service.installed();
  console.log(
    items.length > 0
      ? `Tinkjam Sync starts when you log in: ${items.map((item) => item.location).join(", ")}`
      : macApp !== undefined
        ? `Tinkjam Sync for Mac (${macApp}) runs Tinkjam Sync; its menu bar icon shows whether it is connected.`
        : windowsApp !== undefined
          ? `Tinkjam Sync for Windows (${windowsApp}) runs Tinkjam Sync; ${WINDOWS_ICON} shows whether it is connected.`
          : "Tinkjam Sync is not set up to start when you log in.",
  );
  await runSync(ownEntry, ["--processes", ...homeArgs]);
  console.log(`Log: ${service.paths.log}`);
  process.exit(0);
}

const disconnecting = parsed.serverArgs.includes("--disconnect");
// The app owns its Sync and files: taking them down here would leave it broken.
if (macApp !== undefined && (parsed.action === "uninstall" || disconnecting)) {
  if (disconnecting) {
    NodeChildProcess.spawnSync("open", ["tinkjam-sync://disconnect"]);
    console.log(
      `Tinkjam Sync for Mac (${macApp}) runs Tinkjam Sync. It now asks you to confirm: choose Disconnect.`,
    );
  } else {
    console.log(
      `Tinkjam Sync for Mac (${macApp}) runs Tinkjam Sync. To remove it, choose Quit in its menu bar menu, then move it to the Trash.`,
    );
  }
  process.exit(0);
}
if (windowsApp !== undefined && (parsed.action === "uninstall" || disconnecting)) {
  console.log(
    disconnecting
      ? `Tinkjam Sync for Windows (${windowsApp}) runs Tinkjam Sync. To disconnect this computer, click ${WINDOWS_ICON} and choose "Disconnect this computer…".`
      : `Tinkjam Sync for Windows (${windowsApp}) runs Tinkjam Sync. To remove it, open Windows Settings, go to Apps, then Installed apps, and uninstall Tinkjam Sync.`,
  );
  process.exit(0);
}
if (parsed.action === "uninstall" || disconnecting) {
  await takeDown();
  // Before the files go: this launcher may be the installed copy it is about to remove.
  const disconnected = disconnecting ? await runSync(ownEntry, parsed.serverArgs) : 0;
  service.removeFiles();
  console.log("Tinkjam Sync no longer runs in the background or starts when you log in.");
  if (parsed.action === "uninstall") {
    console.log(
      `This computer is still connected to your Tinkjam account. To remove it, run:\n\n  npx -y ${SYNC_URL} --disconnect`,
    );
    process.exit(0);
  }
  process.exit(disconnected);
}

if (parsed.action === "install") {
  if (macApp !== undefined) {
    console.log(
      `Tinkjam Sync for Mac is installed (${macApp}). It runs Tinkjam Sync and starts it when you log in, so nothing else is needed. Opening it.`,
    );
    NodeChildProcess.spawnSync("open", [macApp]);
    process.exit(0);
  }
  if (windowsApp !== undefined) {
    console.log(
      `Tinkjam Sync for Windows is installed (${windowsApp}). It runs Tinkjam Sync and starts it with Windows, so nothing else is needed. Opening it.`,
    );
    // Starting it again only brings the running copy forward, or starts it if it had stopped.
    NodeChildProcess.spawn(windowsApp, [], { detached: true, stdio: "ignore" }).unref();
    process.exit(0);
  }
  await printUpdateNotice({ install: true });
  if (!service.supported) {
    console.error(
      "Tinkjam Sync cannot run in the background on this system. Run it without --install.",
    );
    process.exit(1);
  }
  // Clean up before setting up, every time, so one Sync is all that is left.
  await takeDown();
  try {
    service.removeFiles();
    // oxlint-disable-next-line t3code/no-global-process-runtime -- The plain-Node launcher has no Effect runtime to inject it.
    const npmCli = npmCliFor(process.execPath, process.platform, process.env.npm_execpath);
    if (npmCli === undefined) {
      console.log(
        "npm was not found beside this Node.js, so the background copy keeps the packages npx installed.",
      );
    }
    service.copyPackage(packageDir, npmCli);
  } catch (error) {
    console.error(`Tinkjam Sync could not be set up to run in the background: ${error.message}`);
    process.exit(1);
  }
  // Only a person at this computer can press Connect, so connecting happens here, in the open.
  const connected = await runSync(service.paths.serverEntry, [
    "--connect-only",
    ...parsed.serverArgs,
  ]);
  if (connected !== 0) process.exit(connected);
  const startedAt = Date.now();
  let location;
  try {
    location = service.start({ hostedAppUrl, syncUrl: SYNC_URL });
  } catch (error) {
    console.error(`Tinkjam Sync could not start in the background: ${error.message}`);
    process.exit(1);
  }
  console.log(`Starting Tinkjam Sync in the background (login item: ${location})...`);
  const state = await waitForConnected(service.paths, startedAt, CONNECT_TIMEOUT_MS);
  await runSync(service.paths.serverEntry, ["--processes", ...homeArgs]);
  if (state?.kind === "connected") {
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
  console.error(
    [
      `The end of its log (${service.paths.log}):`,
      logTail(service.paths),
      "",
      state === undefined
        ? "Tinkjam Sync is installed and starts when you log in, but it has not reported since it started. Check the log above."
        : `Tinkjam Sync is installed, starts when you log in and keeps trying, but it is not connected yet. It is waiting on: ${state.reason ?? "the tunnel to Tinkjam"}`,
    ].join("\n"),
  );
  process.exit(1);
}

await printUpdateNotice();
process.exit(await runSync(ownEntry, parsed.serverArgs));
