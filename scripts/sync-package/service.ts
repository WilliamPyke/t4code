// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off globalTimers:off - Plain Node beside the launcher, before any server code runs.
// Tinkjam Sync in the background: a copy of the package under the base dir whose server is the
// login item itself, started with no window by launchd (macOS), systemd or XDG autostart (Linux),
// or the Run key (Windows). The server keeps one Sync per home (apps/server/src/cli/syncProcesses.ts).
// Node built-ins only: the build strips its types into bin/service.mjs, beside the launcher.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

export type SyncAction = "run" | "install" | "uninstall" | "status";

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

export const defaultBaseDir = () => NodePath.join(NodeOS.homedir(), ".tinkjam");

/**
 * Tinkjam Sync for Mac, if this Mac has it: the app runs Sync itself and is its own login item,
 * so `--install` leaves the Mac to it instead of adding a second Sync at log-in.
 */
export function installedMacApp(
  home: string,
  exists: (path: string) => boolean = NodeFS.existsSync,
): string | undefined {
  // Only ever a Mac's paths, whatever machine runs this.
  return ["/Applications", NodePath.posix.join(home, "Applications")]
    .map((dir) => NodePath.posix.join(dir, "Tinkjam Sync.app"))
    .find(exists);
}

/**
 * Tinkjam Sync for Windows, if this PC has it: like the Mac app, it runs Sync itself, keeps the
 * package under the home and is its own startup app, so the launcher leaves the default home to it.
 */
export function installedWindowsApp(
  localAppData: string,
  exists: (path: string) => boolean = NodeFS.existsSync,
): string | undefined {
  const app = NodePath.win32.join(localAppData, "Programs", "Tinkjam Sync", "TinkjamSync.exe");
  return exists(app) ? app : undefined;
}

export function resolveBaseDir(flag: string | undefined, envHome: string | undefined): string {
  const chosen = flag?.trim() || envHome?.trim() || defaultBaseDir();
  const expanded =
    chosen === "~" || /^~[\\/]/.test(chosen) ? NodeOS.homedir() + chosen.slice(1) : chosen;
  return NodePath.resolve(expanded);
}

const samePath = (a: string, b: string) =>
  NodePath.resolve(a).toLowerCase() === NodePath.resolve(b).toLowerCase();

/** Login item names. A home other than the default gets its own, so two homes never share one. */
export function serviceNames(baseDir: string, defaultDir: string) {
  const suffix = samePath(baseDir, defaultDir)
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

export type ServiceNames = ReturnType<typeof serviceNames>;

export function servicePaths(baseDir: string) {
  const app = NodePath.join(baseDir, "app");
  const packageDir = NodePath.join(app, "node_modules", "tinkjam-sync");
  return {
    baseDir,
    app,
    serverEntry: NodePath.join(packageDir, "dist", "bin.mjs"),
    log: NodePath.join(baseDir, "logs", "sync.log"),
    status: NodePath.join(baseDir, "userdata", "sync-status.json"),
    starts: NodePath.join(baseDir, "sync-starts.json"),
    windowsScript: NodePath.join(baseDir, "start-sync.js"),
    // The first background Sync kept these; nothing reads them now.
    legacy: ["sync-service.json", "sync-service.pid", "sync-service.stop"].map((name) =>
      NodePath.join(baseDir, name),
    ),
  };
}

export type ServicePaths = ReturnType<typeof servicePaths>;

/** What the login item runs: the server itself, so one process is the whole background Sync. */
export interface LoginCommand {
  readonly programArguments: ReadonlyArray<string>;
  readonly environment: Readonly<Record<string, string>>;
}

const xmlText = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * A LaunchAgent that launchd starts at log-in and again whenever it exits with an error, which
 * includes a stray `kill` (the server exits 130 on SIGTERM). A clean exit (not connected, or the
 * server's restart limit) stays down; `--uninstall` boots it out first. ThrottleInterval keeps
 * launchd to one start per 10 seconds.
 */
export function launchAgentPlist(input: {
  readonly label: string;
  readonly command: LoginCommand;
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
    ...input.command.programArguments.map((arg) => `    <string>${xmlText(arg)}</string>`),
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...Object.entries(input.command.environment).flatMap(([key, value]) => [
      `    <key>${xmlText(key)}</key>`,
      `    <string>${xmlText(value)}</string>`,
    ]),
    "  </dict>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>KeepAlive</key>",
    "  <dict>",
    "    <key>SuccessfulExit</key>",
    "    <false/>",
    "  </dict>",
    "  <key>ThrottleInterval</key>",
    "  <integer>10</integer>",
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
const systemdQuote = (value: string) =>
  `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%").replace(/\$/g, "$$$$")}"`;

/** Restarts after a failure every 10 seconds, at most 6 times in 10 minutes. */
export function systemdUnit(command: LoginCommand): string {
  return [
    "[Unit]",
    "Description=Tinkjam Sync: connects this computer's agents to Tinkjam",
    "StartLimitIntervalSec=600",
    "StartLimitBurst=6",
    "",
    "[Service]",
    ...Object.entries(command.environment).map(
      ([key, value]) => `Environment=${systemdQuote(`${key}=${value}`)}`,
    ),
    `ExecStart=${command.programArguments.map(systemdQuote).join(" ")}`,
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

/** Autostart cannot set variables itself; `env` sets them and then becomes the server. */
export function autostartEntry(command: LoginCommand): string {
  const args = [
    "/usr/bin/env",
    ...Object.entries(command.environment).map(([key, value]) => `${key}=${value}`),
    ...command.programArguments,
  ];
  return [
    "[Desktop Entry]",
    "Type=Application",
    "Name=Tinkjam Sync",
    "Comment=Connects this computer's agents to Tinkjam",
    `Exec=${args.map(desktopArg).join(" ")}`,
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

// WSH reads scripts in the ANSI code page, so every literal is kept ASCII.
const jscriptString = (value: string) =>
  JSON.stringify(value).replace(
    /[\u007f-\uffff]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );

/** Most restarts the Windows script host makes in one log-in before it leaves Sync stopped. */
export const WINDOWS_RESTART_LIMIT = 5;

/**
 * Run by wscript, which has no console, so the server starts with its window hidden (style 0).
 * wscript waits for it and starts it again after a failure (a growing pause, at most
 * WINDOWS_RESTART_LIMIT times); a clean exit ends it. JScript, not VBScript, which Windows is
 * phasing out.
 */
export function windowsStartScript(command: LoginCommand): string {
  return [
    "// Starts Tinkjam Sync with no window at log-in. `--install` writes it; `--uninstall` removes it.",
    'var shell = new ActiveXObject("WScript.Shell");',
    'var env = shell.Environment("PROCESS");',
    ...Object.entries(command.environment).map(
      ([key, value]) => `env(${jscriptString(key)}) = ${jscriptString(value)};`,
    ),
    `var command = ${jscriptString(windowsCommandLine(command.programArguments))};`,
    `for (var attempt = 0; attempt <= ${WINDOWS_RESTART_LIMIT}; attempt++) {`,
    "  if (shell.Run(command, 0, true) === 0) break;",
    "  WScript.Sleep(Math.min(2000 * Math.pow(2, attempt), 60000));",
    "}",
    "",
  ].join("\r\n");
}

/** A login item found on this computer. `content` is what it runs, or its whole file. */
export interface FoundLoginItem {
  readonly name: string;
  readonly location: string;
  readonly content: string;
}

const OUR_NAME_PATTERNS = [
  /^org\.trellium\.tinkjam-sync(\.[a-z0-9-]+)?$/i,
  /^tinkjam-sync(-[a-z0-9-]+)?(\.service|\.desktop)?$/i,
  /^Tinkjam Sync( \([a-z0-9-]+\))?$/i,
];

/** Text that only a login item for Tinkjam Sync (or for this home) would contain. */
export function leftoverMarkers(baseDir: string, isDefaultHome: boolean): ReadonlyArray<string> {
  return [
    "trellium.org/sync.tgz",
    "tinkjam-sync",
    baseDir,
    baseDir.replaceAll("\\", "/"),
    ...(isDefaultHome
      ? ["~/.tinkjam", "$HOME/.tinkjam", "${HOME}/.tinkjam", "%USERPROFILE%\\.tinkjam"]
      : []),
  ];
}

/**
 * Ours (this home's own item, replaced on install), another home's (left alone), a leftover that
 * runs Tinkjam Sync but is not ours (removed), or unrelated (never touched).
 */
export function classifyLoginItem(
  item: Pick<FoundLoginItem, "name" | "content">,
  ours: { readonly names: ReadonlyArray<string>; readonly markers: ReadonlyArray<string> },
): "ours" | "other-home" | "leftover" | "unrelated" {
  const name = item.name.replace(/\.(plist|lnk)$/i, "");
  if (ours.names.some((candidate) => candidate.toLowerCase() === name.toLowerCase())) return "ours";
  if (OUR_NAME_PATTERNS.some((pattern) => pattern.test(name))) return "other-home";
  const content = item.content.toLowerCase();
  return ours.markers.some((marker) => content.includes(marker.toLowerCase()))
    ? "leftover"
    : "unrelated";
}

const run = (command: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.spawnSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 60_000,
    maxBuffer: 16 * 1024 * 1024,
  });

type RunResult = ReturnType<typeof run>;

const succeeded = (result: RunResult) => result.error === undefined && result.status === 0;

const failure = (what: string, result: RunResult) =>
  new Error(
    `${what}: ${(result.error?.message ?? (result.stderr || result.stdout || `exit code ${result.status}`)).trim()}`,
  );

const sleepSync = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const remove = (path: string) => NodeFS.rmSync(path, { recursive: true, force: true });

/**
 * The same two npm runs as Tinkjam Sync for Windows and Mac: exactly the shrinkwrap, with no
 * install scripts, then the scripts of the two native packages that need theirs.
 */
export function pinnedInstallArgs(npmCli: string, packageDir: string) {
  return [
    [npmCli, "ci", "--prefix", packageDir, "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund", "--loglevel=error"],
    [npmCli, "rebuild", "koffi", "node-pty", "--prefix", packageDir, "--loglevel=error"],
  ];
}

/** npm's CLI for this Node: the one npx ran under, else the one installed beside Node. */
export function npmCliFor(execPath: string, platform: NodeJS.Platform, npmExecPath?: string) {
  const beside =
    platform === "win32"
      ? NodePath.join(NodePath.dirname(execPath), "node_modules", "npm", "bin", "npm-cli.js")
      : NodePath.join(NodePath.dirname(execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js");
  return [npmExecPath, beside].find(
    (candidate) => candidate?.endsWith("npm-cli.js") === true && NodeFS.existsSync(candidate),
  );
}

const writeFile = (path: string, contents: string) => {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, contents);
};

/** File text as both single-byte and UTF-16, so paths inside Windows shortcuts match too. */
const readLoose = (path: string) => {
  try {
    const bytes = NodeFS.readFileSync(path);
    return `${bytes.toString("latin1")}\n${bytes.toString("utf16le")}`;
  } catch {
    return "";
  }
};

const listDir = (dir: string, extensions: ReadonlyArray<string>) => {
  try {
    return NodeFS.readdirSync(dir)
      .filter((name) => extensions.some((extension) => name.toLowerCase().endsWith(extension)))
      .map((name) => NodePath.join(dir, name));
  } catch {
    return [];
  }
};

/** Every kind of login item Tinkjam Sync uses or an agent might have made on one system. */
interface LoginItems {
  readonly find: () => ReadonlyArray<FoundLoginItem>;
  readonly remove: (item: FoundLoginItem) => boolean;
  /** Writes this home's item and starts it now. */
  readonly register: (command: LoginCommand) => string;
  readonly ourNames: ReadonlyArray<string>;
}

const startDetached = (command: string, args: ReadonlyArray<string>) =>
  NodeChildProcess.spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();

function macosLoginItems(names: ServiceNames, paths: ServicePaths): LoginItems {
  const agents = NodePath.join(NodeOS.homedir(), "Library", "LaunchAgents");
  const plist = NodePath.join(agents, `${names.launchdLabel}.plist`);
  const domain = `gui/${process.getuid?.() ?? 0}`;
  // Both ways a job may have been loaded: `bootstrap`, and the older `load -w`.
  const unload = (label: string, path: string) => {
    run("launchctl", ["bootout", `${domain}/${label}`]);
    run("launchctl", ["unload", "-w", path]);
  };
  return {
    ourNames: [names.launchdLabel],
    find: () =>
      listDir(agents, [".plist"]).map((path) => ({
        name: NodePath.basename(path, ".plist"),
        location: path,
        content: readLoose(path),
      })),
    remove: (item) => {
      // A plist's Label usually matches its file name; this one's own label is what launchd knows.
      const label = /<key>Label<\/key>\s*<string>([^<]+)<\/string>/.exec(item.content)?.[1];
      unload(label ?? item.name, item.location);
      remove(item.location);
      return !NodeFS.existsSync(item.location);
    },
    register: (command) => {
      writeFile(
        plist,
        launchAgentPlist({ label: names.launchdLabel, command, logPath: paths.log }),
      );
      unload(names.launchdLabel, plist);
      run("launchctl", ["enable", `${domain}/${names.launchdLabel}`]);
      let result = run("launchctl", ["bootstrap", domain, plist]);
      // Right after a bootout, launchd can still be tearing the old job down.
      if (!succeeded(result)) {
        sleepSync(1000);
        result = run("launchctl", ["bootstrap", domain, plist]);
      }
      if (!succeeded(result)) result = run("launchctl", ["load", "-w", plist]);
      if (!succeeded(result)) throw failure("launchctl could not start it", result);
      return plist;
    },
  };
}

function linuxLoginItems(names: ServiceNames): LoginItems {
  const configHome =
    process.env.XDG_CONFIG_HOME?.trim() || NodePath.join(NodeOS.homedir(), ".config");
  const units = NodePath.join(configHome, "systemd", "user");
  const autostart = NodePath.join(configHome, "autostart");
  const unitName = `${names.linuxName}.service`;
  const unit = NodePath.join(units, unitName);
  const desktop = NodePath.join(autostart, `${names.linuxName}.desktop`);
  const systemctl = (...args: ReadonlyArray<string>) => run("systemctl", ["--user", ...args]);
  return {
    ourNames: [names.linuxName, unitName, `${names.linuxName}.desktop`],
    find: () =>
      [...listDir(units, [".service"]), ...listDir(autostart, [".desktop"])].map((path) => ({
        name: NodePath.basename(path),
        location: path,
        content: readLoose(path),
      })),
    remove: (item) => {
      if (item.location.endsWith(".service")) {
        systemctl("disable", "--now", NodePath.basename(item.location));
        remove(item.location);
        systemctl("daemon-reload");
      } else {
        remove(item.location);
      }
      return !NodeFS.existsSync(item.location);
    },
    // Exactly one of the two: a systemd unit when a user manager runs, else autostart.
    register: (command) => {
      if (succeeded(systemctl("show-environment"))) {
        writeFile(unit, systemdUnit(command));
        if (
          succeeded(systemctl("daemon-reload")) &&
          succeeded(systemctl("enable", unitName)) &&
          succeeded(systemctl("restart", unitName))
        ) {
          return unit;
        }
        systemctl("disable", "--now", unitName);
        remove(unit);
        systemctl("daemon-reload");
      }
      writeFile(desktop, autostartEntry(command));
      startDetached("/usr/bin/env", [
        ...Object.entries(command.environment).map(([key, value]) => `${key}=${value}`),
        ...command.programArguments,
      ]);
      return desktop;
    },
  };
}

function windowsLoginItems(names: ServiceNames, paths: ServicePaths): LoginItems {
  const system32 = NodePath.join(process.env.SystemRoot || "C:\\Windows", "System32");
  const reg = NodePath.join(system32, "reg.exe");
  const wscript = NodePath.join(system32, "wscript.exe");
  // The per-user Run key needs no administrator, unlike a log-on scheduled task, and shows in
  // Task Manager's Startup apps, where the person can turn it off.
  const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";
  const startup = NodePath.join(
    process.env.APPDATA || NodePath.join(NodeOS.homedir(), "AppData", "Roaming"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
  );
  const wscriptArgs = ["//B", "//Nologo", "//E:JScript", paths.windowsScript];
  const runValues = (): ReadonlyArray<FoundLoginItem> => {
    const result = run(reg, ["query", key]);
    if (!succeeded(result)) return [];
    return result.stdout.split(/\r?\n/).flatMap((line) => {
      const match = /^ {4}(.+?) {4}REG_(?:EXPAND_)?SZ {4}(.*)$/.exec(line);
      return match
        ? [{ name: match[1]!, location: `${key}\\${match[1]!}`, content: match[2]! }]
        : [];
    });
  };
  // Agents make tasks too. Listing them takes PowerShell a moment, so only names and actions.
  const tasks = (): ReadonlyArray<FoundLoginItem> => {
    const result = run("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-ScheduledTask | ForEach-Object { $_.TaskPath + $_.TaskName + [char]9 + (($_.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join ' ; ') }",
    ]);
    if (!succeeded(result)) return [];
    return result.stdout.split(/\r?\n/).flatMap((line) => {
      const [path, actions] = line.split("\t");
      return path && actions !== undefined
        ? [
            {
              name: NodePath.win32.basename(path),
              location: `Task Scheduler ${path}`,
              content: actions,
            },
          ]
        : [];
    });
  };
  return {
    ourNames: [names.windowsName],
    find: () => [
      ...runValues(),
      ...listDir(startup, [".lnk", ".cmd", ".bat", ".vbs", ".js", ".ps1", ".url"]).map((path) => ({
        name: NodePath.basename(path),
        location: path,
        content: readLoose(path),
      })),
      ...tasks(),
    ],
    remove: (item) => {
      if (item.location.startsWith(`${key}\\`)) {
        return succeeded(run(reg, ["delete", key, "/v", item.name, "/f"]));
      }
      if (item.location.startsWith("Task Scheduler ")) {
        return succeeded(
          run("schtasks.exe", [
            "/Delete",
            "/TN",
            item.location.slice("Task Scheduler ".length),
            "/F",
          ]),
        );
      }
      remove(item.location);
      return !NodeFS.existsSync(item.location);
    },
    register: (command) => {
      writeFile(paths.windowsScript, windowsStartScript(command));
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
      return `${key}\\${names.windowsName}`;
    },
  };
}

export function syncService(baseDir: string, platform: NodeJS.Platform) {
  const paths = servicePaths(baseDir);
  const isDefaultHome = samePath(baseDir, defaultBaseDir());
  const names = serviceNames(baseDir, defaultBaseDir());
  const items =
    platform === "darwin"
      ? macosLoginItems(names, paths)
      : platform === "linux"
        ? linuxLoginItems(names)
        : platform === "win32"
          ? windowsLoginItems(names, paths)
          : undefined;
  const classify = (item: FoundLoginItem) =>
    classifyLoginItem(item, {
      names: items?.ourNames ?? [],
      markers: leftoverMarkers(baseDir, isDefaultHome),
    });

  return {
    paths,
    supported: items !== undefined,
    /** This home's login items now. */
    installed: () => (items?.find() ?? []).filter((item) => classify(item) === "ours"),

    /**
     * Removes this home's login items and any leftover that runs Tinkjam Sync but is not ours,
     * on every mechanism, before anything is set up or after it is taken down. Returns one line
     * per item, for the person.
     */
    sweep: (): ReadonlyArray<string> =>
      (items?.find() ?? []).flatMap((item) => {
        const kind = classify(item);
        if (kind !== "ours" && kind !== "leftover") return [];
        const removed = items!.remove(item);
        const what = kind === "ours" ? "Tinkjam Sync login item" : "Leftover login item";
        return [
          removed
            ? `${what} ${item.name} (${item.location})`
            : `Could not remove ${what.toLowerCase()} ${item.name} (${item.location})`,
        ];
      }),

    /**
     * Copies this package for the background copy, which then needs neither npx's cache nor this
     * terminal. With `npmCli` it installs exactly the package's npm-shrinkwrap.json, as the apps
     * do (npx ignores it); otherwise it copies what npx installed beside it. Older copies go first.
     */
    copyPackage: (packageDir: string, npmCli?: string) => {
      const staging = `${paths.app}.new`;
      remove(staging);
      const pinnedCli = NodeFS.existsSync(NodePath.join(packageDir, "npm-shrinkwrap.json"))
        ? npmCli
        : undefined;
      const pinned = pinnedCli !== undefined;
      const installedBeside =
        !pinned && NodePath.basename(NodePath.dirname(packageDir)) === "node_modules";
      const target = installedBeside
        ? NodePath.join(staging, "node_modules")
        : NodePath.join(staging, "node_modules", "tinkjam-sync");
      NodeFS.cpSync(installedBeside ? NodePath.dirname(packageDir) : packageDir, target, {
        recursive: true,
        dereference: true,
        filter: (source) => !pinned || NodePath.relative(packageDir, source) !== "node_modules",
      });
      if (pinnedCli !== undefined) {
        for (const args of pinnedInstallArgs(pinnedCli, target)) {
          const result = NodeChildProcess.spawnSync(process.execPath, args, { stdio: "inherit" });
          if (result.status !== 0) {
            remove(staging);
            throw new Error(`npm ${args[1]} ended with ${result.status ?? result.signal}`);
          }
        }
      }
      remove(paths.app);
      NodeFS.renameSync(staging, paths.app);
    },

    /**
     * Writes the login item and starts it. A login item does not get the shell's PATH, and the
     * agents Sync starts (claude, codex) are found on PATH, so this install's PATH and node go in.
     */
    start: (urls: { readonly hostedAppUrl: string; readonly syncUrl: string }) => {
      if (items === undefined) throw new Error("this system has no supported login items");
      for (const path of [paths.starts, paths.status]) remove(path);
      return items.register({
        programArguments: [
          process.execPath,
          paths.serverEntry,
          "sync",
          "--background",
          "--base-dir",
          baseDir,
        ],
        environment: {
          PATH: [NodePath.dirname(process.execPath), process.env.PATH ?? ""].join(
            NodePath.delimiter,
          ),
          T3CODE_HOME: baseDir,
          T3CODE_HOSTED_APP_URL: urls.hostedAppUrl,
          TINKJAM_SYNC_URL: urls.syncUrl,
        },
      });
    },

    /** Removes the installed copy and the files of older background setups. Keeps the account. */
    removeFiles: () => {
      for (const path of [
        paths.app,
        `${paths.app}.new`,
        paths.windowsScript,
        paths.starts,
        ...paths.legacy,
      ]) {
        remove(path);
      }
    },
  };
}

export type SyncService = ReturnType<typeof syncService>;

export type ConnectionState =
  | { readonly kind: "connected" }
  | { readonly kind: "waiting"; readonly reason: string | undefined };

/** The background Sync's own answer, from `sync-status.json`, if written since `since`. */
export function readConnectionState(
  paths: ServicePaths,
  since: number,
): ConnectionState | undefined {
  try {
    if (NodeFS.statSync(paths.status).mtimeMs < since) return undefined;
    const status: unknown = JSON.parse(NodeFS.readFileSync(paths.status, "utf8"));
    if (typeof status !== "object" || status === null || !("status" in status)) return undefined;
    if (status.status === "reachable") return { kind: "connected" };
    const cause = "cause" in status && typeof status.cause === "string" ? ` (${status.cause})` : "";
    const reason =
      "reason" in status && typeof status.reason === "string"
        ? `${status.reason}${cause}`
        : undefined;
    return { kind: "waiting", reason };
  } catch {
    return undefined;
  }
}

/** Waits for the background Sync to say it connected, or returns where it got to. */
export async function waitForConnected(
  paths: ServicePaths,
  since: number,
  timeoutMs: number,
): Promise<ConnectionState | undefined> {
  const deadline = Date.now() + timeoutMs;
  let state = readConnectionState(paths, since);
  while (state?.kind !== "connected" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    state = readConnectionState(paths, since) ?? state;
  }
  return state;
}

/** The last lines of the background Sync's log, to show when something went wrong. */
export function logTail(paths: ServicePaths, lines = 12): string {
  try {
    return NodeFS.readFileSync(paths.log, "utf8").trimEnd().split(/\r?\n/).slice(-lines).join("\n");
  } catch {
    return "";
  }
}
