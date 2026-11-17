// @effect-diagnostics nodeBuiltinImport:off globalDate:off - Tinkjam Sync's small process records are plain files read and written synchronously.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeUtil from "node:util";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Console from "effect/Console";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import * as ProcessRunner from "../processRunner.ts";
import { isServerOwnershipHeld } from "../serverOwnership.ts";
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";

/**
 * One Sync per home: the server's ownership lock (an exclusive SQLite lock the OS drops when its
 * process dies) says whether one runs, the runtime state names its pid, and this record, written
 * by Sync at start, says how it was started and by whom.
 */
const OWNER_FILE = "sync-owner.json";
const STARTS_FILE = "sync-starts.json";
// Written by the first background Sync (a separate supervisor process), which polled for this file.
const LEGACY_SUPERVISOR_PID_FILE = "sync-service.pid";
const LEGACY_SUPERVISOR_STOP_FILE = "sync-service.stop";

/** "app": the child of Tinkjam Sync for Mac, which starts, restarts and stops it itself. */
export type SyncMode = "background" | "foreground" | "app";

export interface SyncHolder {
  readonly pid: number;
  /** The process that started it; on Windows the hidden script host that restarts it. */
  readonly parentPid: number | undefined;
  readonly mode: SyncMode | "unknown";
}

/** A background Sync leaves another background one, or the Mac app's, alone and ends any other. */
export const takeoverDecision = (
  holder: SyncHolder | undefined,
): "start" | "yield" | "take-over" =>
  holder === undefined
    ? "start"
    : holder.mode === "background" || holder.mode === "app"
      ? "yield"
      : "take-over";

/** Starts counted toward giving up: this many within the window and a broken install stops. */
export const RESTART_LIMIT = 5;
export const RESTART_WINDOW_MS = 10 * 60 * 1000;
const FIRST_RESTART_DELAY_MS = 5000;
const MAX_RESTART_DELAY_MS = 60_000;

/**
 * Whether a background start goes ahead, and after how long. Each recent start doubles the wait
 * (5 s, 10 s, 20 s, 40 s); the sixth start within ten minutes gives up until the next log-in.
 */
export function restartDecision(
  previousStarts: ReadonlyArray<number>,
  now: number,
):
  | { readonly kind: "start"; readonly delayMs: number; readonly starts: ReadonlyArray<number> }
  | { readonly kind: "give-up" } {
  const recent = previousStarts.filter((at) => at <= now && now - at < RESTART_WINDOW_MS);
  if (recent.length >= RESTART_LIMIT) return { kind: "give-up" };
  const delayMs =
    recent.length === 0
      ? 0
      : Math.min(FIRST_RESTART_DELAY_MS * 2 ** (recent.length - 1), MAX_RESTART_DELAY_MS);
  return { kind: "start", delayMs, starts: [...recent, now] };
}

export interface ProcessRow {
  readonly pid: number;
  readonly parentPid: number;
  readonly name: string;
}

/** `pid|ppid|name` lines (Windows) or `ps -A -o pid=,ppid=,comm=` output. */
export function parseProcessTable(text: string): ReadonlyArray<ProcessRow> {
  return text.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)[|\s]+(\d+)[|\s]+(.+?)\s*$/.exec(line);
    if (!match) return [];
    return [
      {
        pid: Number(match[1]),
        parentPid: Number(match[2]),
        name: NodePath.basename(match[3]!.replaceAll("\\", "/")),
      },
    ];
  });
}

/** `root` and everything it started, parents first. */
export function processTree(
  rows: ReadonlyArray<ProcessRow>,
  root: number,
): ReadonlyArray<ProcessRow> {
  const tree: Array<ProcessRow> = [];
  const self = rows.find((row) => row.pid === root);
  if (self === undefined) return tree;
  const queue = [self];
  while (queue.length > 0) {
    const next = queue.shift()!;
    if (tree.some((row) => row.pid === next.pid)) continue;
    tree.push(next);
    queue.push(...rows.filter((row) => row.parentPid === next.pid && row.pid !== next.pid));
  }
  return tree;
}

/** The Windows script host that restarts a background Sync, if `holder` has one. */
export const supervisorRow = (rows: ReadonlyArray<ProcessRow>, holder: SyncHolder) =>
  holder.mode === "background" && holder.parentPid !== undefined
    ? rows.find((row) => row.pid === holder.parentPid && /^wscript(\.exe)?$/i.test(row.name))
    : undefined;

const readJson = (path: string): unknown => {
  try {
    return JSON.parse(NodeFS.readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
};

const writeJson = (path: string, value: unknown) => {
  try {
    NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
    NodeFS.writeFileSync(path, `${JSON.stringify(value)}\n`);
  } catch {
    // A record that cannot be written only costs a clearer message later.
  }
};

export const writeOwnerRecord = (stateDir: string, mode: SyncMode) =>
  Effect.sync(() =>
    writeJson(NodePath.join(stateDir, OWNER_FILE), {
      pid: process.pid,
      parentPid: process.ppid,
      mode,
    }),
  );

/** The Sync that holds this home now, if any. */
export const readSyncHolder = Effect.fn("cli.sync.read_holder")(function* (statePath: string) {
  if (!isServerOwnershipHeld(statePath)) return undefined;
  const runtime = yield* readPersistedServerRuntimeState(statePath).pipe(
    Effect.orElseSucceed(() => undefined),
  );
  if (runtime === undefined || runtime._tag === "None") return undefined;
  const pid = runtime.value.pid;
  if (pid === process.pid || !isProcessAlive(pid)) return undefined;
  const owner = readJson(NodePath.join(NodePath.dirname(statePath), OWNER_FILE));
  const record =
    typeof owner === "object" && owner !== null && "pid" in owner && owner.pid === pid
      ? (owner as { readonly parentPid?: unknown; readonly mode?: unknown })
      : undefined;
  return {
    pid,
    parentPid: typeof record?.parentPid === "number" ? record.parentPid : undefined,
    mode:
      record?.mode === "background" || record?.mode === "foreground" || record?.mode === "app"
        ? record.mode
        : "unknown",
  } satisfies SyncHolder;
});

const listProcesses = Effect.gen(function* () {
  const runner = yield* ProcessRunner.ProcessRunner;
  const windows = (yield* HostProcess.Platform) === "win32";
  const result = yield* runner
    .run(
      windows
        ? {
            command: "powershell.exe",
            args: [
              "-NoProfile",
              "-NonInteractive",
              "-Command",
              'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId)|$($_.ParentProcessId)|$($_.Name)" }',
            ],
            timeout: Duration.seconds(15),
            maxOutputBytes: 4_000_000,
          }
        : {
            command: "ps",
            args: ["-A", "-o", "pid=,ppid=,comm="],
            timeout: Duration.seconds(10),
            maxOutputBytes: 4_000_000,
          },
    )
    .pipe(Effect.option);
  return result._tag === "Some" && result.value.code === 0
    ? parseProcessTable(result.value.stdout)
    : undefined;
});

/** Every process of the Sync holding this home: its supervisor (Windows), itself, its children. */
export const syncProcesses = Effect.fn("cli.sync.processes")(function* (holder: SyncHolder) {
  const rows = yield* listProcesses;
  if (rows === undefined) return [{ pid: holder.pid, parentPid: 0, name: "node" }];
  const supervisor = supervisorRow(rows, holder);
  return supervisor === undefined
    ? processTree(rows, holder.pid)
    : processTree(rows, supervisor.pid);
});

/** Sends a signal; a process that is already gone is fine. */
const signal = (pid: number, name: NodeJS.Signals) => {
  try {
    process.kill(pid, name);
  } catch {
    // Already gone.
  }
};

const waitUntil = Effect.fn("cli.sync.wait_until")(function* (
  done: () => boolean,
  timeout: Duration.Duration,
) {
  const step = Duration.millis(250);
  for (let waited = 0; waited < Duration.toMillis(timeout) && !done(); waited += 250) {
    yield* Effect.sleep(step);
  }
  return done();
});

/**
 * Ends a Sync and everything it started. Windows ends the whole tree at once, its restarting script
 * host included; elsewhere SIGTERM lets the server close its tunnel helper itself, and whatever is
 * left after 15 seconds is killed. Only pids proven by the lock and records are touched.
 */
export const endSyncTree = Effect.fn("cli.sync.end_tree")(function* (holder: SyncHolder) {
  const runner = yield* ProcessRunner.ProcessRunner;
  const rows = (yield* listProcesses) ?? [];
  const supervisor = supervisorRow(rows, holder);
  const tree = processTree(rows, supervisor?.pid ?? holder.pid);
  if ((yield* HostProcess.Platform) === "win32") {
    for (const pid of [supervisor?.pid, holder.pid]) {
      if (pid === undefined || !isProcessAlive(pid)) continue;
      yield* runner
        .run({
          command: "taskkill.exe",
          args: ["/PID", String(pid), "/T", "/F"],
          timeout: Duration.seconds(15),
        })
        .pipe(Effect.ignore);
    }
  } else {
    yield* Effect.sync(() => signal(holder.pid, "SIGTERM"));
    if (!(yield* waitUntil(() => !isProcessAlive(holder.pid), Duration.seconds(15)))) {
      yield* Effect.sync(() => signal(holder.pid, "SIGKILL"));
    }
    for (const row of tree) {
      if (row.pid !== holder.pid && isProcessAlive(row.pid)) {
        yield* Effect.sync(() => signal(row.pid, "SIGKILL"));
      }
    }
  }
  yield* waitUntil(
    () => tree.every((row) => !isProcessAlive(row.pid)) && !isProcessAlive(holder.pid),
    Duration.seconds(10),
  );
  return tree.length > 0 ? tree : [{ pid: holder.pid, parentPid: 0, name: "node" }];
});

/** Asks a supervisor from the first background Sync to stop, as it polled for, and waits. */
export const stopLegacySupervisor = Effect.fn("cli.sync.stop_legacy_supervisor")(function* (
  baseDir: string,
) {
  const pidPath = NodePath.join(baseDir, LEGACY_SUPERVISOR_PID_FILE);
  const stopPath = NodePath.join(baseDir, LEGACY_SUPERVISOR_STOP_FILE);
  const pid = Number(readJson(pidPath));
  const running = () =>
    Number.isInteger(pid) && pid > 0 && NodeFS.existsSync(pidPath) && isProcessAlive(pid);
  if (!running()) return false;
  writeJson(stopPath, "");
  yield* waitUntil(() => !running(), Duration.seconds(20));
  NodeFS.rmSync(stopPath, { force: true });
  return true;
});

export const describeProcesses = (rows: ReadonlyArray<ProcessRow>) =>
  `${rows.length} ${rows.length === 1 ? "process" : "processes"} (${rows.map((row) => `${row.name} ${row.pid}`).join(", ")})`;

/** Background starts so far, for the restart limit. */
export const readStarts = (baseDir: string): ReadonlyArray<number> => {
  const value = readJson(NodePath.join(baseDir, STARTS_FILE));
  return Array.isArray(value) ? value.filter((at): at is number => typeof at === "number") : [];
};

export const writeStarts = (baseDir: string, starts: ReadonlyArray<number>) =>
  writeJson(NodePath.join(baseDir, STARTS_FILE), starts);

const MAX_LOG_BYTES = 5 * 1024 * 1024;

/**
 * Where a background Sync's words go: there is no terminal, so they are appended to
 * `<base>/logs/sync.log`, with the time, starting a fresh log once it passes 5 MB.
 */
export function fileConsole(logPath: string): Console.Console {
  try {
    NodeFS.mkdirSync(NodePath.dirname(logPath), { recursive: true });
    if (NodeFS.statSync(logPath).size > MAX_LOG_BYTES) NodeFS.renameSync(logPath, `${logPath}.1`);
  } catch {
    // No log yet.
  }
  const write = (...args: ReadonlyArray<unknown>) => {
    try {
      NodeFS.appendFileSync(logPath, `[${new Date().toISOString()}] ${NodeUtil.format(...args)}\n`);
    } catch {
      // Nowhere else to say it.
    }
  };
  return { ...globalThis.console, log: write, info: write, warn: write, error: write };
}
