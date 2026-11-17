// @effect-diagnostics nodeBuiltinImport:off - Exercises the plain-Node service module on real files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  autostartEntry,
  backgroundPid,
  launchAgentPlist,
  parseSyncArgs,
  serviceNames,
  servicePaths,
  syncService,
  systemdUnit,
  windowsCommandLine,
  windowsStartScript,
} from "./service.ts";

describe("Tinkjam Sync's arguments", () => {
  it("takes out its own flags and passes the rest, base dir included, to the server", () => {
    expect(parseSyncArgs(["--install", "--base-dir", "/tmp/home"])).toEqual({
      action: "install",
      baseDir: "/tmp/home",
      serverArgs: ["--base-dir", "/tmp/home"],
    });
    expect(parseSyncArgs(["--base-dir=/x", "--disconnect"])).toEqual({
      action: "run",
      baseDir: "/x",
      serverArgs: ["--base-dir=/x", "--disconnect"],
    });
    expect(parseSyncArgs(["--install", "--install"]).action).toBe("install");
  });

  it("refuses flags that contradict each other", () => {
    expect(() => parseSyncArgs(["--install", "--uninstall"])).toThrow("cannot be used together");
    expect(() => parseSyncArgs(["--install", "--disconnect"])).toThrow("cannot be used together");
  });
});

describe("Tinkjam Sync's login items", () => {
  const programArguments = [
    "/Users/a b/.nvm/node",
    "/Users/a b/.tinkjam/app/node_modules/tinkjam-sync/bin/tinkjam-sync.mjs",
    "--service",
    "--base-dir",
    "/Users/a b/.tinkjam",
  ];

  it("gives a home other than the default its own names", () => {
    const home = NodeOS.homedir();
    expect(serviceNames(NodePath.join(home, ".tinkjam"), NodePath.join(home, ".tinkjam"))).toEqual({
      launchdLabel: "org.trellium.tinkjam-sync",
      linuxName: "tinkjam-sync",
      windowsName: "Tinkjam Sync",
    });
    expect(
      serviceNames(NodePath.join(home, "Test Home"), NodePath.join(home, ".tinkjam")).windowsName,
    ).toBe("Tinkjam Sync (test-home)");
  });

  it("writes a LaunchAgent that restarts only after a crash, with every argument escaped", () => {
    const plist = launchAgentPlist({
      label: "org.trellium.tinkjam-sync",
      programArguments: [...programArguments, "R&D <1>"],
      logPath: "/Users/a b/.tinkjam/logs/sync.log",
    });
    expect(plist).toContain("<string>/Users/a b/.nvm/node</string>");
    expect(plist).toContain("<string>R&amp;D &lt;1&gt;</string>");
    expect(plist).toMatch(
      /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/,
    );
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/);
  });

  it("quotes systemd and autostart arguments so spaces, % and $ stay literal", () => {
    expect(systemdUnit(["/opt/n o/node", "50%$HOME"])).toContain(
      'ExecStart="/opt/n o/node" "50%%$$HOME"',
    );
    expect(autostartEntry(["/opt/n o/node", 'say "hi" 50%', "a\\b"])).toContain(
      'Exec="/opt/n o/node" "say \\\\"hi\\\\" 50%%" "a\\\\\\\\b"',
    );
  });

  it("builds a Windows command line that survives spaces and trailing backslashes", () => {
    expect(
      windowsCommandLine(["C:\\Program Files\\nodejs\\node.exe", "--service", "C:\\a b\\"]),
    ).toBe('"C:\\Program Files\\nodejs\\node.exe" --service "C:\\a b\\\\"');
    const script = windowsStartScript(
      windowsCommandLine(["C:\\Users\\Zoë\\node.exe", "--service"]),
    );
    // WSH reads scripts in the ANSI code page, so the script itself stays ASCII.
    expect(script).toContain('Run("C:\\\\Users\\\\Zo\\u00eb\\\\node.exe --service", 0, false)');
    expect([...script].every((char) => char.charCodeAt(0) < 128)).toBe(true);
  });
});

describe("Tinkjam Sync's background copy", () => {
  const tempDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tinkjam-sync-test-"));

  it("copies npm's install with its dependencies, and replaces the copy when installed again", () => {
    const npx = tempDir();
    const packageDir = NodePath.join(npx, "node_modules", "tinkjam-sync");
    NodeFS.mkdirSync(NodePath.join(packageDir, "bin"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(packageDir, "bin", "tinkjam-sync.mjs"), "v1");
    NodeFS.mkdirSync(NodePath.join(npx, "node_modules", "dependency"), { recursive: true });
    const home = tempDir();
    const service = syncService(home, "linux");

    service.copyPackage(packageDir);
    NodeFS.writeFileSync(NodePath.join(packageDir, "bin", "tinkjam-sync.mjs"), "v2");
    NodeFS.rmSync(NodePath.join(npx, "node_modules", "dependency"), { recursive: true });
    service.copyPackage(packageDir);

    expect(NodeFS.readFileSync(service.paths.launcher, "utf8")).toBe("v2");
    expect(NodeFS.existsSync(NodePath.join(service.paths.app, "node_modules", "dependency"))).toBe(
      false,
    );
    expect(NodeFS.existsSync(`${service.paths.app}.new`)).toBe(false);
  });

  it("counts a background copy as running only while its process lives", () => {
    const paths = servicePaths(tempDir());
    expect(backgroundPid(paths)).toBeUndefined();
    // A pid file left by a copy that is gone, here a number no process has.
    NodeFS.writeFileSync(paths.pid, "2147483646");
    expect(backgroundPid(paths)).toBeUndefined();
    NodeFS.writeFileSync(paths.pid, "not a pid");
    expect(backgroundPid(paths)).toBeUndefined();
  });
});
