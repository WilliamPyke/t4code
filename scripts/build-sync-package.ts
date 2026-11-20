#!/usr/bin/env node
// @effect-diagnostics nodeBuiltinImport:off globalConsole:off globalDate:off - A plain build step: bundle, stage and tar.
/**
 * `pnpm run build:sync` writes dist-sync/sync.tgz, run as `npx <its url>`: the server bundle with
 * .env's sign-in, relay and hosted app baked in (no web client), and a launcher for `t3 sync`.
 * npm installs the native runtime packages the bundle leaves out. Beside it, sync.json names this
 * build's version, which every copy already out checks at start; publish both, at the same URL.
 */
import * as NodeChildProcess from "node:child_process";
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";

import { transformSync } from "esbuild";

import serverPackageJson from "../apps/server/package.json" with { type: "json" };
import { selectCliRuntimeExternalDependencies } from "./lib/cli-external-packages.ts";
import { loadRepoEnv } from "./lib/public-config.ts";
import { resolveCatalogDependencies } from "./lib/resolve-catalog.ts";
import { windowsSystemTar } from "./lib/windows-tar.ts";
import { requireReleaseKey, signFile } from "./sign-release.ts";
import { syncVersion } from "./sync-package/updateCheck.ts";

const SYNC_PACKAGE_NAME = "tinkjam-sync";
// Cloudflare Workers static assets refuse larger files.
const MAX_TARBALL_BYTES = 25 * 1024 * 1024;
const DEFAULT_HOSTED_APP_URL = "https://app.tinkjam.com";
// Where the tarball is published. It stays the same for every build; sync.json goes beside it.
// tinkjam.com serves it too, but the signed manifest names trellium.org, which every installed
// copy and every network told to allow it reaches.
const DEFAULT_SYNC_URL = "https://trellium.org/sync.tgz";

const repoRoot = NodePath.resolve(NodeURL.fileURLToPath(import.meta.url), "../..");
const serverDir = NodePath.join(repoRoot, "apps/server");
const outputDir = NodePath.join(repoRoot, "dist-sync");

/** The `catalog:` block of pnpm-workspace.yaml, read as flat `name: version` lines. */
export function readWorkspaceCatalog(workspaceYaml: string): Record<string, string> {
  const catalog: Record<string, string> = {};
  let inCatalog = false;
  for (const line of workspaceYaml.split(/\r?\n/)) {
    if (/^\S/.test(line)) inCatalog = line.trim() === "catalog:";
    else if (inCatalog) {
      const entry = /^\s+["']?([^"':\s]+)["']?:\s*["']?([^"'\s#]+)["']?/.exec(line);
      if (entry?.[1] && entry[2]) catalog[entry[1]] = entry[2];
    }
  }
  return catalog;
}

/** package.json of the tarball: one bin, and only the packages the bundle loads from disk. */
function syncPackageManifest(input: {
  readonly version: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly nodeEngine: string;
}) {
  return {
    name: SYNC_PACKAGE_NAME,
    version: input.version,
    description: "Tinkjam Sync: connect the agents on this computer to Tinkjam.",
    license: serverPackageJson.license,
    type: "module",
    bin: { [SYNC_PACKAGE_NAME]: "./bin/tinkjam-sync.mjs" },
    files: ["bin", "dist", "npm-shrinkwrap.json"],
    engines: { node: input.nodeEngine },
    dependencies: input.dependencies,
    // Tinkjam Sync for Mac reads this to know it may run `sync --app`; older copies lack it.
    tinkjamSync: { features: ["app"] },
  };
}

function run(command: string, args: ReadonlyArray<string>, cwd: string) {
  const result = NodeChildProcess.spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} exited with ${result.status ?? result.signal}.`);
  }
}

/**
 * Locks the staged package's whole dependency tree, with integrity hashes, for `npm ci` in the
 * unpacked package. `npm install <sync.tgz>` and npx ignore it: npm 11 reads no shrinkwrap from a
 * tarball that did not come from a registry.
 */
function writeShrinkwrap(stage: string) {
  // Fixed arguments only, so one shell command line runs npm's .cmd shim on Windows too.
  const npm = (args: ReadonlyArray<string>) => {
    const result = NodeChildProcess.spawnSync(`npm ${args.join(" ")}`, {
      cwd: stage,
      stdio: "inherit",
      shell: true,
    });
    if (result.status !== 0) {
      throw new Error(`npm ${args.join(" ")} exited with ${result.status ?? result.signal}.`);
    }
  };
  npm(["install", "--package-lock-only", "--ignore-scripts", "--no-audit", "--no-fund"]);
  npm(["shrinkwrap"]);
  const missing = packagesWithoutIntegrity(
    JSON.parse(NodeFS.readFileSync(NodePath.join(stage, "npm-shrinkwrap.json"), "utf8")),
  );
  if (missing.length > 0) {
    throw new Error(`npm-shrinkwrap.json has no integrity for ${missing.join(", ")}.`);
  }
}

interface LockEntry {
  readonly integrity?: string;
  readonly link?: boolean;
  readonly inBundle?: boolean;
}

/** Every package a lockfile would download must carry the hash npm checks it against. */
export function packagesWithoutIntegrity(lock: {
  readonly packages?: Readonly<Record<string, LockEntry>>;
}): ReadonlyArray<string> {
  return Object.entries(lock.packages ?? {})
    .filter(
      ([path, entry]) =>
        path !== "" && entry.link !== true && entry.inBundle !== true && !entry.integrity,
    )
    .map(([path]) => path);
}

function main() {
  const releaseKey = requireReleaseKey();
  const skipBundle = process.argv.includes("--skip-bundle");
  if (!skipBundle) run(process.execPath, ["--run", "build:bundle"], serverDir);
  const serverDist = NodePath.join(serverDir, "dist");
  if (!NodeFS.existsSync(NodePath.join(serverDist, "bin.mjs"))) {
    throw new Error(`Missing ${serverDist}/bin.mjs. Run without --skip-bundle.`);
  }

  const catalog = readWorkspaceCatalog(
    NodeFS.readFileSync(NodePath.join(repoRoot, "pnpm-workspace.yaml"), "utf8"),
  );
  const dependencies = selectCliRuntimeExternalDependencies(
    resolveCatalogDependencies(serverPackageJson.dependencies, catalog, serverPackageJson.name),
  );
  const env = loadRepoEnv();
  const hostedAppUrl = env.T3CODE_HOSTED_APP_URL?.trim() || DEFAULT_HOSTED_APP_URL;
  const syncUrl = env.TINKJAM_SYNC_URL?.trim() || DEFAULT_SYNC_URL;
  const manifestUrl = new URL("sync.json", syncUrl).toString();
  const version = syncVersion(serverPackageJson.version, new Date().toISOString());

  const stageRoot = NodePath.join(outputDir, ".stage");
  const stage = NodePath.join(stageRoot, "package");
  NodeFS.rmSync(stageRoot, { recursive: true, force: true });
  NodeFS.mkdirSync(NodePath.join(stage, "bin"), { recursive: true });
  // Source maps would double the download for nobody.
  NodeFS.cpSync(serverDist, NodePath.join(stage, "dist"), {
    recursive: true,
    filter: (source) => !source.endsWith(".map"),
  });
  const launcher = NodeFS.readFileSync(
    NodePath.join(repoRoot, "scripts/sync-package/tinkjam-sync.mjs"),
    "utf8",
  )
    .replace("__TINKJAM_HOSTED_APP_URL__", hostedAppUrl)
    .replace("__TINKJAM_SYNC_VERSION__", version)
    .replace("__TINKJAM_SYNC_MANIFEST_URL__", manifestUrl)
    .replace("__TINKJAM_SYNC_URL__", syncUrl);
  NodeFS.writeFileSync(NodePath.join(stage, "bin/tinkjam-sync.mjs"), launcher, { mode: 0o755 });
  // Node 22 runs no TypeScript, so the launcher's modules go in as plain JavaScript.
  for (const [source, output] of [
    ["updateCheck.ts", "update-check.mjs"],
    ["service.ts", "service.mjs"],
  ] as const) {
    const code = transformSync(
      NodeFS.readFileSync(NodePath.join(repoRoot, "scripts/sync-package", source), "utf8"),
      { loader: "ts", format: "esm", target: "node22" },
    ).code;
    NodeFS.writeFileSync(NodePath.join(stage, "bin", output), code);
  }
  NodeFS.writeFileSync(
    NodePath.join(stage, "package.json"),
    `${JSON.stringify(
      syncPackageManifest({
        version: serverPackageJson.version,
        dependencies,
        nodeEngine: serverPackageJson.engines.node,
      }),
      null,
      2,
    )}\n`,
  );

  writeShrinkwrap(stage);

  const tarball = NodePath.join(outputDir, "sync.tgz");
  NodeFS.rmSync(tarball, { force: true });
  // npm tarballs root everything under `package/`. Windows' own tar, not Git's, takes C:\ paths.
  run(
    NodeFS.existsSync(windowsSystemTar()) ? windowsSystemTar() : "tar",
    ["-czf", tarball, "-C", stageRoot, "package"],
    repoRoot,
  );
  NodeFS.rmSync(stageRoot, { recursive: true, force: true });

  // The apps check the tarball against this, and this against the release key, before installing.
  const sha256 = NodeCrypto.createHash("sha256").update(NodeFS.readFileSync(tarball)).digest("hex");
  const syncJson = NodePath.join(outputDir, "sync.json");
  NodeFS.writeFileSync(syncJson, `${JSON.stringify({ version, url: syncUrl, sha256 }, null, 2)}\n`);
  try {
    signFile(syncJson, releaseKey);
  } catch (error) {
    NodeFS.rmSync(syncJson, { force: true });
    throw error;
  }

  const bytes = NodeFS.statSync(tarball).size;
  console.log(
    `[sync] Wrote ${tarball} (${(bytes / 1024 / 1024).toFixed(1)} MiB), version ${version}`,
  );
  console.log(`[sync] Wrote ${NodePath.join(outputDir, "sync.json")}: publish it beside sync.tgz`);
  console.log(`[sync] Hosted app: ${hostedAppUrl}`);
  console.log(`[sync] Installs from npm: ${Object.keys(dependencies).join(", ")}`);
  if (bytes > MAX_TARBALL_BYTES) {
    throw new Error("sync.tgz is over the 25 MiB a static asset may be.");
  }
}

if (import.meta.main) main();
