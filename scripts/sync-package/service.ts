// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off - Plain Node beside the launcher, before any server code runs.
// Tinkjam Sync in the background: a copy of the package under the base dir, started at log-in with
// no window, by launchd (macOS), systemd or XDG autostart (Linux), or the Run key (Windows).
// Node built-ins only: the build strips its types into bin/service.mjs, beside the launcher.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export type SyncAction = "run" | "install" | "uninstall" | "status" | "service";

export interface SyncArgs {
  readonly action: SyncAction;
  readonly baseDir: string | undefined;
  /** What goes on to the server's `sync` command. */
  readonly serverArgs: ReadonlyArray<string>;
}

const ACTION_FLAGS: Readonly<Record<string, SyncAction>> = {
  "--install": "install",
  "--uninstall": "uninstall",
  "--status": "status",
  "--service": "service",
};

/** The launcher's own flags, taken out of what the server sees. Throws a message for a person. */
export function parseSyncArgs(args: ReadonlyArray<string>): SyncArgs {
  let action: SyncAction = "run";
  let baseDir: string | undefined;
  const serverArgs: Array<string> = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const flagAction = ACTION_FLAGS[arg];
    if (flagAction !== undefined) {
      if (action !== "run" && action !== flagAction) {
        throw new Error(`${arg} and --${action} cannot be used together.`);
      }
      action = flagAction;
      continue;
    }
    if (arg === "--base-dir" && args[index + 1] !== undefined) {
      baseDir = args[index + 1];
      serverArgs.push(arg, args[index + 1]!);
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-dir=")) baseDir = arg.slice("--base-dir=".length);
    serverArgs.push(arg);
  }
  if (action !== "run" && serverArgs.includes("--disconnect")) {
    throw new Error(`--disconnect and --${action} cannot be used together.`);
  }
  return { action, baseDir, serverArgs };
}

export function resolveBaseDir(flag: string | undefined, envHome: string | undefined): string {
  const chosen = flag?.trim() || envHome?.trim() || NodePath.join(NodeOS.homedir(), ".tinkjam");
  const expanded =
    chosen === "~" || /^~[\\/]/.test(chosen) ? NodeOS.homedir() + chosen.slice(1) : chosen;
  return NodePath.resolve(expanded);
}

/** Login item names. A home other than the default gets its own, so two homes never share one. */
export function serviceNames(baseDir: string, defaultBaseDir: string) {
  const suffix =
    NodePath.resolve(baseDir).toLowerCase() === NodePath.resolve(defaultBaseDir).toLowerCase()
      ? ""
      : NodePath.basename(baseDir)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, "") || "custom";
  return {
    launchdLabel: suffix ? `org.trellium.tinkjam-sync.${suffix}` : "org.trellium.tinkjam-sync",
    linuxName: suffix ? `tinkjam-sync-${suffix}` : "tinkjam-sync",
    windowsName: suffix ? `Tinkjam Sync (${suffix})` : "Tinkjam Sync",
  };
}

export function servicePaths(baseDir: string) {
  const app = NodePath.join(baseDir, "app");
  const packageDir = NodePath.join(app, "node_modules", "tinkjam-sync");
  return {
    baseDir,
    app,
    launcher: NodePath.join(packageDir, "bin", "tinkjam-sync.mjs"),
    serverEntry: NodePath.join(packageDir, "dist", "bin.mjs"),
    settings: NodePath.join(baseDir, "sync-service.json"),
    pid: NodePath.join(baseDir, "sync-service.pid"),
    stop: NodePath.join(baseDir, "sync-service.stop"),
    log: NodePath.join(baseDir, "logs", "sync.log"),
    windowsScript: NodePath.join(baseDir, "start-sync.js"),
  };
}

export type ServicePaths = ReturnType<typeof servicePaths>;

const xmlText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A LaunchAgent that starts at log-in and again if it crashes, but not after a clean exit. */
export function launchAgentPlist(input: {
  readonly label: string;
  readonly programArguments: ReadonlyArray<string>;
  readonly logPath: string;
}): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlText(input.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...input.programArguments.map((arg) => `    <string>${xmlText(arg)}</string>`),
    "  </array>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>StandardOutPath</key>",
    `  <string>${xmlText(input.logPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlText(input.logPath)}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

// systemd unquotes C-style escapes, expands % specifiers and $ variables.
const systemdArg = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

export function systemdUnit(programArguments: ReadonlyArray<string>): string {
  return [
    "[Unit]",
    "Description=Tinkjam Sync: connects this computer's agents to Tinkjam",
    "",
    "[Service]",
    `ExecStart=${programArguments.map(systemdArg).join(" ")}`,
    "Restart=on-failure",
    "RestartSec=10",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

// Desktop Entry Exec: quote, backslash-escape " ` $ \ inside quotes, then escape every backslash
// again as a string value, and double %.
const desktopArg = (value: string) =>
  `"${value.replace(/["`$\\]/g, (char) => `\\${char}`)}"`
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "%%");

export function autostartEntry(programArguments: ReadonlyArray<string>): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Tinkjam Sync",
    "Comment=Connects this computer's agents to Tinkjam",
    `Exec=${programArguments.map(desktopArg).join(" ")}`,
    "Terminal=false",
    "NoDisplay=true",
    "X-GNOME-Autostart-enabled=true",
    "",
  ].join("\n");
}

/** One argument as Windows programs split their command line (CommandLineToArgvW). */
export const windowsArg = (value: string) =>
  value !== "" && !/[\s"]/.test(value)
    ? value
    : `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`;

export const windowsCommandLine = (args: ReadonlyArray<string>) => args.map(windowsArg).join(" ");

/**
 * Run by wscript, which has no console, so node starts with its window hidden (style 0). JScript,
 * not VBScript, which Windows is phasing out. Non-ASCII is escaped: WSH reads scripts as ANSI.
 */
export function windowsStartScript(commandLine: string): string {
  const literal = JSON.stringify(commandLine).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
  return [
    "// Starts Tinkjam Sync with no window at log-in. `--install` writes it; `--uninstall` removes it.",
    `new ActiveXObject("WScript.Shell").Run(${literal}, 0, false);`,
    "",
  ].join("\r\n");
}

const run = (command: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 30_000,
  });

type RunResult = ReturnType<typeof run>;

const succeeded = (result: RunResult) => result.error === undefined && result.status === 0;

const failure = (what: string, result: RunResult) =>
  new Error(
    `${what}: ${(result.error?.message ?? (result.stderr || result.stdout || `exit code ${result.status}`)).trim()}`,
  );

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const remove = (path: string) => NodeFS.rmSync(path, { recursive: true, force: true });

const writeFile = (path: string, contents: string) => {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, contents);
};

/** Whether a process is alive. EPERM means it is, but belongs to someone else or a sandbox hides it. */
const isAlive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** The background copy's process, if it is running. */
export function backgroundPid(paths: ServicePaths): number | undefined {
  try {
    const pid = Number(NodeFS.readFileSync(paths.pid, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 && pid !== process.pid && isAlive(pid)
      ? pid
      : undefined;
  } catch {
    return undefined;
  }
}

interface LoginItem {
  /** Where the person can find it. */
  readonly location: string;
  readonly installed: () => boolean;
  /** Writes the login item and starts the background copy now. */
  readonly register: (programArguments: ReadonlyArray<string>) => void;
  /** Stops the background copy where a service manager runs it. */
  readonly stop: () => void;
  readonly unregister: () => void;
}

/** Starts the background copy outside this process's session, for login items with no manager. */
const startDetached = (command: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

function macosLoginItem(names: ReturnType<typeof serviceNames>, paths: ServicePaths): LoginItem {
  const plist = NodePath.join(
    NodeOS.homedir(),
    "Library",
    "LaunchAgents",
    `${names.launchdLabel}.plist`,
  );
  const domain = `gui/${process.getuid?.() ?? 0}`;
  const target = `${domain}/${names.launchdLabel}`;
  const stop = () => {
    if (!succeeded(run("launchctl", ["bootout", target]))) run("launchctl", ["unload", plist]);
  };
  return {
    location: plist,
    installed: () => NodeFS.existsSync(plist),
    register: (programArguments) => {
      writeFile(
        plist,
        launchAgentPlist({ label: names.launchdLabel, programArguments, logPath: paths.log }),
      );
      run("launchctl", ["bootout", target]);
      run("launchctl", ["enable", target]);
      let result = run("launchctl", ["bootstrap", domain, plist]);
      // Right after a bootout, launchd can still be tearing the old job down.
      if (!succeeded(result)) {
        sleepSync(1000);
        result = run("launchctl", ["bootstrap", domain, plist]);
      }
      if (!succeeded(result)) {
        run("launchctl", ["unload", plist]);
        result = run("launchctl", ["load", "-w", plist]);
      }
      if (!succeeded(result)) throw failure("launchctl could not start it", result);
    },
    stop,
    unregister: () => {
      stop();
      remove(plist);
    },
  };
}

function linuxLoginItem(names: ReturnType<typeof serviceNames>): LoginItem {
  const configHome =
    process.env.XDG_CONFIG_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".config");
  const unitName = `${names.linuxName}.service`;
  const unit = NodePath.join(configHome, "systemd", "user", unitName);
  const desktop = NodePath.join(configHome, "autostart", `${names.linuxName}.desktop`);
  const systemctl = (...args: ReadonlyArray<string>) => run("systemctl", ["--user", ...args]);
  const removeUnit = () => {
    if (!NodeFS.existsSync(unit)) return;
    systemctl("disable", "--now", unitName);
    remove(unit);
    systemctl("daemon-reload");
  };
  return {
    location: NodeFS.existsSync(desktop) ? desktop : unit,
    installed: () => NodeFS.existsSync(unit) || NodeFS.existsSync(desktop),
    register: (programArguments) => {
      // A user manager answers only when systemd runs this session; otherwise use autostart.
      if (succeeded(systemctl("show-environment"))) {
        writeFile(unit, systemdUnit(programArguments));
        if (
          succeeded(systemctl("daemon-reload")) &&
          succeeded(systemctl("enable", unitName)) &&
          succeeded(systemctl("restart", unitName))
        ) {
          remove(desktop);
          return;
        }
        removeUnit();
      }
      writeFile(desktop, autostartEntry(programArguments));
      startDetached(programArguments[0]!, programArguments.slice(1));
    },
    stop: () => {
      if (NodeFS.existsSync(unit)) systemctl("stop", unitName);
    },
    unregister: () => {
      removeUnit();
      remove(desktop);
    },
  };
}

function windowsLoginItem(names: ReturnType<typeof serviceNames>, paths: ServicePaths): LoginItem {
  const system32 = NodePath.join(process.env.SystemRoot || "C:\\Windows", "System32");
  const reg = NodePath.join(system32, "reg.exe");
  const wscript = NodePath.join(system32, "wscript.exe");
  // The per-user Run key needs no administrator, unlike a log-on scheduled task, and shows in
  // Task Manager's Startup apps, where the person can turn it off.
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const wscriptArgs = ["//B", "//Nologo", "//E:JScript", paths.windowsScript];
  return {
    location: `${key}\\${names.windowsName}`,
    installed: () => succeeded(run(reg, ["query", key, "/v", names.windowsName])),
    register: (programArguments) => {
      writeFile(paths.windowsScript, windowsStartScript(windowsCommandLine(programArguments)));
      const result = run(reg, [
        "add",
        key,
        "/v",
        names.windowsName,
        "/t",
        "REG_SZ",
        "/d",
        windowsCommandLine([wscript, ...wscriptArgs]),
        "/f",
      ]);
      if (!succeeded(result)) throw failure("Windows could not add it to the startup apps", result);
      startDetached(wscript, wscriptArgs);
    },
    // No service manager runs it here; the stop file asks it to stop.
    stop: () => {},
    unregister: () => {
      run(reg, ["delete", key, "/v", names.windowsName, "/f"]);
      remove(paths.windowsScript);
    },
  };
}

export function syncService(baseDir: string, platform: NodeJS.Platform) {
  const paths = servicePaths(baseDir);
  const names = serviceNames(baseDir, NodePath.join(NodeOS.homedir(), ".tinkjam"));
  const loginItem =
    platform === "darwin"
      ? macosLoginItem(names, paths)
      : platform === "linux"
        ? linuxLoginItem(names)
        : platform === "win32"
          ? windowsLoginItem(names, paths)
          : undefined;

  /** Stops the background copy, if it runs, and waits until it has. False if it would not stop. */
  const stop = (): boolean => {
    loginItem?.stop();
    if (backgroundPid(paths) === undefined) return true;
    writeFile(paths.stop, "");
    for (let waited = 0; waited < 20_000 && backgroundPid(paths) !== undefined; waited += 250) {
      sleepSync(250);
    }
    remove(paths.stop);
    return backgroundPid(paths) === undefined;
  };

  return {
    paths,
    supported: loginItem !== undefined,
    location: loginItem?.location,
    installed: () => loginItem?.installed() ?? false,
    running: () => backgroundPid(paths) !== undefined,
    stop,

    /**
     * Copies this package and the packages npm installed beside it, so the background copy
     * needs neither npx's cache nor this terminal. `packageDir` is the running package's root.
     */
    copyPackage: (packageDir: string) => {
      const staging = `${paths.app}.new`;
      remove(staging);
      const installedBeside = NodePath.basename(NodePath.dirname(packageDir)) === "node_modules";
      NodeFS.cpSync(
        installedBeside ? NodePath.dirname(packageDir) : packageDir,
        installedBeside
          ? NodePath.join(staging, "node_modules")
          : NodePath.join(staging, "node_modules", "tinkjam-sync"),
        { recursive: true, dereference: true },
      );
      remove(paths.app);
      NodeFS.renameSync(staging, paths.app);
    },

    /**
     * A login item does not get the shell's PATH, and the agents Sync starts (claude, codex) are
     * found on PATH, so the PATH and node of this install are recorded for the background copy.
     */
    writeSettings: () =>
      writeFile(
        paths.settings,
        `${JSON.stringify({ node: process.execPath, path: process.env.PATH ?? "" }, null, 2)}\n`,
      ),

    start: () => {
      if (loginItem === undefined) throw new Error("this system has no supported login items");
      loginItem.register([process.execPath, paths.launcher, "--service", "--base-dir", baseDir]);
    },

    /** Removes the login item and stops the background copy. Keeps the account connection. */
    uninstall: () => {
      loginItem?.unregister();
      const stopped = stop();
      remove(paths.app);
      remove(paths.settings);
      return stopped;
    },

    /** Log bytes so far, to read only what the background copy writes from now on. */
    logSize: () => {
      try {
        return NodeFS.statSync(paths.log).size;
      } catch {
        return 0;
      }
    },
  };
}

export type SyncService = ReturnType<typeof syncService>;

export type WaitOutcome = "connected" | "not-connected" | "timed-out";

/**
 * Follows the background copy's log from `from` until it says it connected. Lines worth a
 * person's attention go to `say`. Matches the server's words in apps/server/src/cloud/syncAnnounce.ts
 * and cli/sync.ts.
 */
export async function waitForConnected(input: {
  readonly paths: ServicePaths;
  readonly from: number;
  readonly timeoutMs: number;
  readonly say: (line: string) => void;
}): Promise<WaitOutcome> {
  let offset = input.from;
  let pending = "";
  const deadline = Date.now() + input.timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 500));
    let text = "";
    try {
      const size = NodeFS.statSync(input.paths.log).size;
      // The background copy starts a fresh log once the old one grows large.
      if (size < offset) offset = 0;
      if (size > offset) {
        const handle = NodeFS.openSync(input.paths.log, "r");
        const buffer = Buffer.alloc(size - offset);
        NodeFS.readSync(handle, buffer, 0, buffer.length, offset);
        NodeFS.closeSync(handle);
        offset = size;
        text = buffer.toString("utf8");
      }
    } catch {
      continue;
    }
    const lines = (pending + text).split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("Connected.")) return "connected";
      if (line.includes("not connected to Tinkjam")) return "not-connected";
      if (line.startsWith("Still connecting") || line.includes("stopped unexpectedly")) {
        input.say(line.replace(/^\[[^\]]*\] /, ""));
      }
    }
  }
  return "timed-out";
}

/** The last lines of the background copy's log, to show when something went wrong. */
export function logTail(paths: ServicePaths, lines = 15): string {
  try {
    return NodeFS.readFileSync(paths.log, "utf8").trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}

const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Runs as the login item: starts the server, writes its output to the log, starts it again after
 * a crash (with a growing pause), and stops on a signal or when the stop file appears. A clean
 * exit, such as a computer that is no longer connected, ends it.
 */
export async function runService(input: {
  readonly paths: ServicePaths;
  readonly platform: NodeJS.Platform;
  readonly startServer: (output: number) => NodeChildProcess.ChildProcess;
}): Promise<never> {
  const { paths } = input;
  try {
    const settings: unknown = JSON.parse(NodeFS.readFileSync(paths.settings, "utf8"));
    if (
      typeof settings === "object" &&
      settings !== null &&
      "path" in settings &&
      typeof settings.path === "string" &&
      settings.path !== ""
    ) {
      process.env.PATH = [NodePath.dirname(process.execPath), settings.path].join(
        NodePath.delimiter,
      );
    }
  } catch {
    // Without settings, keep the PATH the login item gave.
  }
  NodeFS.mkdirSync(NodePath.dirname(paths.log), { recursive: true });
  try {
    if (NodeFS.statSync(paths.log).size > MAX_LOG_BYTES) {
      NodeFS.renameSync(paths.log, `${paths.log}.1`);
    }
  } catch {
    // No log yet.
  }
  const log = NodeFS.openSync(paths.log, "a");
  const say = (line: string) => NodeFS.writeSync(log, `[${new Date().toISOString()}] ${line}\n`);
  remove(paths.stop);
  NodeFS.writeFileSync(paths.pid, String(process.pid));

  let child: NodeChildProcess.ChildProcess | undefined;
  let stopping = false;
  let wake: (() => void) | undefined;
  const stop = () => {
    stopping = true;
    wake?.();
    const current = child;
    if (current?.pid === undefined || current.exitCode !== null) return;
    // On Windows a killed process leaves its children running; end the whole tree this started.
    if (input.platform === "win32") {
      const system32 = NodePath.join(process.env.SystemRoot || "C:\\Windows", "System32");
      run(NodePath.join(system32, "taskkill.exe"), ["/PID", String(current.pid), "/T", "/F"]);
    } else current.kill("SIGTERM");
  };
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) process.on(signal, stop);
  const watchStop = setInterval(() => {
    if (NodeFS.existsSync(paths.stop)) {
      remove(paths.stop);
      stop();
    }
  }, 2000);

  let delayMs = 5000;
  for (;;) {
    if (stopping) break;
    const startedAt = Date.now();
    say("Starting Tinkjam Sync.");
    const started = input.startServer(log);
    child = started;
    const code = await new Promise<number>((resolve) => {
      started.once("exit", (exitCode) => resolve(exitCode ?? 1));
      started.once("error", (error) => {
        say(`Tinkjam Sync could not start: ${error.message}`);
        resolve(1);
      });
    });
    if (stopping) break;
    if (code === 0) {
      say("Tinkjam Sync stopped.");
      break;
    }
    if (Date.now() - startedAt > 60_000) delayMs = 5000;
    say(
      `Tinkjam Sync stopped unexpectedly (exit code ${code}). Starting it again in ${delayMs / 1000} seconds.`,
    );
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, delayMs);
      wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    wake = undefined;
    delayMs = Math.min(delayMs * 2, 60_000);
  }

  clearInterval(watchStop);
  try {
    if (NodeFS.readFileSync(paths.pid, "utf8").trim() === String(process.pid)) remove(paths.pid);
  } catch {
    // Already gone.
  }
  say("Tinkjam Sync is no longer running in the background.");
  NodeFS.closeSync(log);
  process.exit(0);
}
