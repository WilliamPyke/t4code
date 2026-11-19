// @effect-diagnostics nodeBuiltinImport:off - A host fact read once per link, behind a Reference tests replace.
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFSP from "node:fs/promises";

import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

const PROBE_TIMEOUT_MS = 5_000;

const runProbe = (command: string, args: ReadonlyArray<string>) =>
  Effect.callback<string | null>((resume) => {
    const child = NodeChildProcess.execFile(
      command,
      args,
      { timeout: PROBE_TIMEOUT_MS, windowsHide: true, encoding: "utf8" },
      (error, stdout) => resume(Effect.succeed(error ? null : stdout)),
    );
    return Effect.sync(() => void child.kill());
  });

const readFirstFile = (paths: ReadonlyArray<string>) =>
  Effect.promise(async () => {
    for (const path of paths) {
      try {
        return await NodeFSP.readFile(path, "utf8");
      } catch {
        continue;
      }
    }
    return null;
  });

/** The id the operating system gives this installation, from its own probe's output. */
export function parseOsMachineId(platform: NodeJS.Platform, output: string | null): string | null {
  if (output === null) return null;
  const match =
    platform === "win32"
      ? /^\s*MachineGuid\s+REG_SZ\s+(\S+)\s*$/mu.exec(output)
      : platform === "darwin"
        ? /"IOPlatformUUID"\s*=\s*"([^"]+)"/u.exec(output)
        : /^\s*([0-9a-f]{32})\s*$/iu.exec(output);
  return match?.[1]?.toLowerCase() ?? null;
}

/** Null where the system names no id; such a computer simply links as a new one each time. */
export const OsMachineId = Context.Reference<Effect.Effect<string | null>>(
  "t3/cloud/linkMachineId/OsMachineId",
  {
    // The enclosing operation owns the span for this inline handler.
    defaultValue: Effect.fnUntraced(function* () {
      const platform = yield* HostProcess.Platform;
      const environment = yield* HostProcess.Environment;
      const output =
        platform === "win32"
          ? yield* runProbe(`${environment.SystemRoot ?? "C:\\Windows"}\\System32\\reg.exe`, [
              "query",
              "HKLM\\SOFTWARE\\Microsoft\\Cryptography",
              "/v",
              "MachineGuid",
            ])
          : platform === "darwin"
            ? yield* runProbe("/usr/sbin/ioreg", ["-rd1", "-c", "IOPlatformExpertDevice"])
            : yield* readFirstFile(["/etc/machine-id", "/var/lib/dbus/machine-id"]);
      return parseOsMachineId(platform, output);
    }),
  },
);

/**
 * Names this computer and state folder to the relay, so a reinstall replaces its earlier entry.
 * Hashed with the folder: two homes on one computer stay two entries, and no raw id leaves it.
 */
export const linkMachineId = Effect.fn("environment.cloud.linkMachineId")(function* (
  stateDir: string,
) {
  const osMachineId = yield* yield* OsMachineId;
  if (osMachineId === null) return null;
  const folder = (yield* HostProcess.isWindows) ? stateDir.toLowerCase() : stateDir;
  return NodeCrypto.createHash("sha256")
    .update(`tinkjam-link-machine:v1\n${osMachineId}\n${folder}`)
    .digest("hex");
});
