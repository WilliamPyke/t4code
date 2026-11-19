// @effect-diagnostics nodeBuiltinImport:off - Exercises the plain-Node service module on real files.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { describe, expect, it } from "vite-plus/test";

import {
  autostartEntry,
  classifyLoginItem,
  installedMacApp,
  installedWindowsApp,
  launchAgentPlist,
  leftoverMarkers,
  parseSyncArgs,
  pinnedInstallArgs,
  readConnectionState,
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

describe("Tinkjam Sync for Mac", () => {
  it("is found in /Applications or ~/Applications, and otherwise not at all", () => {
    const found = (paths: ReadonlyArray<string>) => (path: string) => paths.includes(path);
    expect(installedMacApp("/Users/a", found(["/Users/a/Applications/Tinkjam Sync.app"]))).toBe(
      "/Users/a/Applications/Tinkjam Sync.app",
    );
    expect(
      installedMacApp(
        "/Users/a",
        found(["/Applications/Tinkjam Sync.app", "/Users/a/Applications/Tinkjam Sync.app"]),
      ),
    ).toBe("/Applications/Tinkjam Sync.app");
    expect(installedMacApp("/Users/a", found([]))).toBeUndefined();
  });
});

describe("Tinkjam Sync for Windows", () => {
  it("is found where its installer puts it, and otherwise not at all", () => {
    const app = "C:\\Users\\a b\\AppData\\Local\\Programs\\Tinkjam Sync\\TinkjamSync.exe";
    expect(installedWindowsApp("C:\\Users\\a b\\AppData\\Local", (path) => path === app)).toBe(app);
    expect(installedWindowsApp("C:\\Users\\a b\\AppData\\Local", () => false)).toBeUndefined();
  });
});

describe("Tinkjam Sync's login items", () => {
  const command = {
    programArguments: [
      "/Users/a b/.nvm/node",
      "/Users/a b/.tinkjam/app/node_modules/tinkjam-sync/dist/bin.mjs",
      "sync",
      "--background",
    ],
    environment: { PATH: "/opt/homebrew/bin:/usr/bin", T3CODE_HOME: "/Users/a b/.tinkjam" },
  };

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

  it("writes a LaunchAgent that runs the server itself and restarts it after a crash or kill", () => {
    const plist = launchAgentPlist({
      label: "org.trellium.tinkjam-sync",
      command: { ...command, programArguments: [...command.programArguments, "R&D <1>"] },
      logPath: "/Users/a b/.tinkjam/logs/sync.log",
    });
    expect(plist).toContain("<string>/Users/a b/.nvm/node</string>");
    expect(plist).toContain("<string>R&amp;D &lt;1&gt;</string>");
    expect(plist).toMatch(/<key>PATH<\/key>\s*<string>\/opt\/homebrew\/bin:\/usr\/bin<\/string>/);
    expect(plist).toMatch(
      /<key>KeepAlive<\/key>\s*<dict>\s*<key>SuccessfulExit<\/key>\s*<false\/>/,
    );
    expect(plist).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/);
  });

  it("quotes systemd and autostart arguments so spaces, % and $ stay literal", () => {
    const unit = systemdUnit({
      programArguments: ["/opt/n o/node", "50%$HOME"],
      environment: { A: "x y" },
    });
    expect(unit).toContain('ExecStart="/opt/n o/node" "50%%$$HOME"');
    expect(unit).toContain('Environment="A=x y"');
    expect(unit).toContain("StartLimitBurst=6");
    expect(
      autostartEntry({
        programArguments: ["/opt/n o/node", 'say "hi" 50%', "a\\b"],
        environment: {},
      }),
    ).toContain('Exec="/usr/bin/env" "/opt/n o/node" "say \\\\"hi\\\\" 50%%" "a\\\\\\\\b"');
  });

  it("builds a Windows script that sets the environment and restarts a few times at most", () => {
    expect(
      windowsCommandLine(["C:\\Program Files\\nodejs\\node.exe", "--background", "C:\\a b\\"]),
    ).toBe('"C:\\Program Files\\nodejs\\node.exe" --background "C:\\a b\\\\"');
    const script = windowsStartScript({
      programArguments: ["C:\\Users\\Zoë\\node.exe", "sync"],
      environment: { T3CODE_HOME: "C:\\Users\\Zoë\\.tinkjam" },
    });
    expect(script).toContain('env("T3CODE_HOME") = "C:\\\\Users\\\\Zo\\u00eb\\\\.tinkjam";');
    expect(script).toContain('var command = "C:\\\\Users\\\\Zo\\u00eb\\\\node.exe sync";');
    expect(script).toContain("for (var attempt = 0; attempt <= 5; attempt++)");
    // WSH reads scripts in the ANSI code page, so the script itself stays ASCII.
    expect([...script].every((char) => char.charCodeAt(0) < 128)).toBe(true);
  });

  it("removes this home's items and leftovers that run Sync, and nothing else", () => {
    const base = "/Users/a/.tinkjam";
    const ours = { names: ["Tinkjam Sync"], markers: leftoverMarkers(base, true) };
    const cases = [
      [{ name: "Tinkjam Sync", content: "wscript.exe start-sync.js" }, "ours"],
      // A Scheduled Task or Startup shortcut by our name counts as ours too.
      [{ name: "Tinkjam Sync.lnk", content: "" }, "ours"],
      [{ name: "Tinkjam Sync (test-home)", content: "/tmp/test-home" }, "other-home"],
      [{ name: "org.trellium.tinkjam-sync.work", content: "tinkjam-sync" }, "other-home"],
      // What agents made when the first flow failed.
      [{ name: "com.codex.tinkjam", content: "npx -y https://trellium.org/sync.tgz" }, "leftover"],
      [
        {
          name: "Start Tinkjam",
          content: "/Users/a/Documents/Start Tinkjam Sync.command ~/.tinkjam",
        },
        "leftover",
      ],
      [
        { name: "sync-helper", content: "node /Users/a/.tinkjam/app/node_modules/x.js" },
        "leftover",
      ],
      [
        { name: "OneDrive", content: "C:\\Program Files\\OneDrive\\OneDrive.exe /background" },
        "unrelated",
      ],
      [{ name: "com.apple.something", content: "tinkjam" }, "unrelated"],
    ] as const;
    for (const [item, expected] of cases)
      expect([item.name, classifyLoginItem(item, ours)]).toEqual([item.name, expected]);
    // Another home's path is not this home's leftover.
    expect(
      classifyLoginItem(
        { name: "x", content: "/Users/a/.tinkjam" },
        {
          names: [],
          markers: leftoverMarkers("/tmp/other", false).filter((m) => m !== "tinkjam-sync"),
        },
      ),
    ).toBe("unrelated");
  });
});

describe("Tinkjam Sync's background copy", () => {
  const tempDir = () => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "tinkjam-sync-test-"));

  it("copies npm's install with its dependencies, and replaces the copy when installed again", () => {
    const npx = tempDir();
    const packageDir = NodePath.join(npx, "node_modules", "tinkjam-sync");
    NodeFS.mkdirSync(NodePath.join(packageDir, "dist"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(packageDir, "dist", "bin.mjs"), "v1");
    NodeFS.mkdirSync(NodePath.join(npx, "node_modules", "dependency"), { recursive: true });
    const home = tempDir();
    const service = syncService(home, "linux");
    // A copy that failed half way last time.
    NodeFS.mkdirSync(`${service.paths.app}.new`, { recursive: true });

    service.copyPackage(packageDir);
    NodeFS.writeFileSync(NodePath.join(packageDir, "dist", "bin.mjs"), "v2");
    NodeFS.rmSync(NodePath.join(npx, "node_modules", "dependency"), { recursive: true });
    service.copyPackage(packageDir);

    expect(NodeFS.readFileSync(service.paths.serverEntry, "utf8")).toBe("v2");
    expect(NodeFS.existsSync(NodePath.join(service.paths.app, "node_modules", "dependency"))).toBe(
      false,
    );
    expect(NodeFS.existsSync(`${service.paths.app}.new`)).toBe(false);
  });

  it("installs exactly the package's shrinkwrap when npm is at hand, not what npx put beside it", () => {
    const npx = tempDir();
    const packageDir = NodePath.join(npx, "node_modules", "tinkjam-sync");
    NodeFS.mkdirSync(NodePath.join(packageDir, "dist"), { recursive: true });
    NodeFS.writeFileSync(NodePath.join(packageDir, "dist", "bin.mjs"), "v1");
    NodeFS.writeFileSync(NodePath.join(packageDir, "npm-shrinkwrap.json"), "{}");
    NodeFS.mkdirSync(NodePath.join(packageDir, "node_modules", "stale"), { recursive: true });
    NodeFS.mkdirSync(NodePath.join(npx, "node_modules", "dependency"), { recursive: true });
    const tools = tempDir();
    const calls = NodePath.join(tools, "calls.json");
    // .cjs: a module type above the temp folder must not change how it loads.
    const npmCli = NodePath.join(tools, "npm-cli.cjs");
    NodeFS.writeFileSync(
      npmCli,
      `const fs = require("node:fs");
const seen = fs.existsSync(${JSON.stringify(calls)}) ? JSON.parse(fs.readFileSync(${JSON.stringify(calls)}, "utf8")) : [];
fs.writeFileSync(${JSON.stringify(calls)}, JSON.stringify([...seen, process.argv.slice(2)]));`,
    );
    const service = syncService(tempDir(), "linux");

    service.copyPackage(packageDir, npmCli);

    const installed = NodePath.dirname(NodePath.dirname(service.paths.serverEntry));
    expect(NodeFS.readFileSync(service.paths.serverEntry, "utf8")).toBe("v1");
    expect(NodeFS.existsSync(NodePath.join(installed, "node_modules", "stale"))).toBe(false);
    expect(NodeFS.existsSync(NodePath.join(service.paths.app, "node_modules", "dependency"))).toBe(
      false,
    );
    // npm ran in the staged copy, which then took the installed one's place.
    const staged = NodePath.join(`${service.paths.app}.new`, "node_modules", "tinkjam-sync");
    expect(JSON.parse(NodeFS.readFileSync(calls, "utf8"))).toEqual(
      pinnedInstallArgs(npmCli, staged).map((args) => args.slice(1)),
    );
  });

  it("trusts only a status the running Sync wrote since it started", () => {
    const paths = servicePaths(tempDir());
    NodeFS.mkdirSync(NodePath.dirname(paths.status), { recursive: true });
    const write = (value: unknown) => NodeFS.writeFileSync(paths.status, JSON.stringify(value));
    write({
      status: "unreachable",
      cause: "not_linked",
      reason: "The server has not set up a Tinkjam tunnel.",
      fix: "Nothing to do: Tinkjam Sync keeps trying.",
    });
    // Written before this start: an earlier run's word, not this one's.
    expect(
      readConnectionState(paths, NodeFS.statSync(paths.status).mtimeMs + 60_000),
    ).toBeUndefined();
    expect(readConnectionState(paths, 0)).toEqual({
      kind: "waiting",
      reason: "The server has not set up a Tinkjam tunnel. (not_linked)",
    });
    write({ status: "reachable" });
    expect(readConnectionState(paths, 0)).toEqual({ kind: "connected" });
  });
});
