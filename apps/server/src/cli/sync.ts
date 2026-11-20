// @effect-diagnostics nodeBuiltinImport:off - Joins the background log path.
import * as NodePath from "node:path";

import * as RelayClient from "@t3tools/shared/relayClient";
import * as Clock from "effect/Clock";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Digest from "effect/crypto/Digest";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import { Command, Flag } from "effect/cli";
import * as CliError from "effect/cli/CliError";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import * as CliState from "../cloud/CliState.ts";
import * as CliTokenManager from "../cloud/CliTokenManager.ts";
import { CLOUD_LINK_REVOKED } from "../cloud/config.ts";
import { hasCloudPublicConfig } from "../cloud/publicConfig.ts";
import * as ServerConfig from "../config.ts";
import { resolveServerEnvironmentLabel } from "../environment/ServerEnvironmentLabel.ts";
import * as ExternalLauncher from "../process/externalLauncher.ts";
import * as ProcessRunner from "../processRunner.ts";
import { projectLocationFlags } from "./config.ts";
import {
  acquireRelayClientForLink,
  disconnectCloud,
  requireConnectAllowed,
  runCloudCommand,
} from "./connect.ts";
import { SYNC_URL } from "../cloud/syncAnnounce.ts";
import { runServerCommand } from "./server.ts";
import {
  describeProcesses,
  endSyncTree,
  fileConsole,
  readStarts,
  readSyncHolder,
  restartDecision,
  RESTART_LIMIT,
  stopLegacySupervisor,
  syncProcesses,
  takeoverDecision,
  writeOwnerRecord,
  writeStarts,
} from "./syncProcesses.ts";

/**
 * Whether this computer must be approved in the browser before Tinkjam Sync serves it: it has no
 * sign-in that still works, no link it was asked to keep, or its account removed it.
 */
export const syncNeedsApproval = (link: {
  readonly desired: boolean;
  readonly mode: CliState.CliDesiredLinkMode;
  readonly signedIn: boolean;
  readonly revoked: boolean;
}) => !link.signedIn || !link.desired || link.mode !== "managed" || link.revoked;

/**
 * Signed in unless the account itself asks for a new sign-in. A check that could not finish
 * (no network yet at log-in) is no answer, so a stored sign-in still counts and the server
 * retries it.
 */
export const syncSignedIn = Effect.fn("cli.sync.signed_in")(function* (
  tokens: Pick<CliTokenManager.CloudCliTokenManager["Service"], "getExisting" | "hasCredential">,
) {
  return yield* tokens.getExisting.pipe(
    Effect.map(Option.isSome),
    Effect.catch((error) =>
      CliTokenManager.isCloudCliCredentialRefreshError(error) && error.requiresLogin
        ? Effect.succeed(false)
        : tokens.hasCredential.pipe(Effect.orElseSucceed(() => false)),
    ),
  );
});

const FALLBACK_COMPUTER_NAME = "This computer";

/**
 * The line Tinkjam Sync for Mac reads the approval link from (`sync --app`). The app opens the
 * link itself and keeps an "Open again" item, so the words around it may change freely.
 */
export const appApprovalLine = (url: string) => `TINKJAM_SYNC_APPROVE_URL ${url}`;

/**
 * Under the Mac app, stdin is a pipe the app holds open. It closes when the app quits or is
 * killed, and then Sync shuts down as on Ctrl+C, so it never outlives the app.
 */
const stopWhenAppQuits = () => {
  const stop = () => process.kill(process.pid, "SIGTERM");
  process.stdin.once("end", stop);
  process.stdin.once("error", stop);
  process.stdin.resume();
};

// Over SSH or without a terminal the browser is somewhere else, so the link is only printed.
const canOpenBrowser = Config.all({
  sshConnection: Config.String("SSH_CONNECTION").pipe(Config.option),
  sshTty: Config.String("SSH_TTY").pipe(Config.option),
}).pipe(
  Config.map(
    ({ sshConnection, sshTty }) =>
      Option.isNone(sshConnection) && Option.isNone(sshTty) && Boolean(process.stdout.isTTY),
  ),
);

class SyncAlreadyRunningError extends CliError.UserError {
  override get message() {
    return "Tinkjam Sync is already running on this computer. Use that window, or press Ctrl+C there first.";
  }
}

// The relay commands report in their own words; Tinkjam Sync says what happened itself.
const silentConsole: Console.Console = {
  ...globalThis.console,
  log: () => {},
  info: () => {},
  warn: () => {},
};

const syncCommandWith = Effect.fn("cli.sync.command_with")(function* (flag: string) {
  return `npx -y ${yield* SYNC_URL} ${flag}`;
});

/**
 * Asks the browser to connect this computer to the person's account, unless it already is.
 * In the background nobody can press Connect, so it says so and reports false instead.
 */
const approveIfNeeded = Effect.fn("cli.sync.approve_if_needed")(function* (input: {
  readonly computerName: string;
  readonly openBrowser: (url: string) => Effect.Effect<void>;
  readonly background: boolean;
  readonly app: boolean;
}) {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const tokens = yield* CliTokenManager.CloudCliTokenManager;
  const signedIn = yield* syncSignedIn(tokens);
  const needsApproval = syncNeedsApproval({
    desired: yield* CliState.readCliDesiredCloudLink,
    mode: yield* CliState.readCliDesiredLinkMode,
    signedIn,
    revoked: Option.isSome(yield* secrets.get(CLOUD_LINK_REVOKED)),
  });
  if (!needsApproval) return true;
  if (input.background) {
    yield* Console.log(
      `This computer is not connected to Tinkjam, so Tinkjam Sync stopped. To connect it, run: ${yield* syncCommandWith("--install")}`,
    );
    return false;
  }

  yield* requireConnectAllowed;
  const relayClient = yield* RelayClient.RelayClient;
  yield* acquireRelayClientForLink(
    relayClient,
    () => Effect.succeed(true),
    (event) =>
      event.type === "progress" && event.stage === "downloading"
        ? Console.log("Getting ready (a one-time download)...")
        : Effect.void,
  );
  const { token } = yield* CliTokenManager.approveComputerLogin({
    computerName: input.computerName,
    present: (url) =>
      Console.log(
        `\nTo connect ${input.computerName} to Tinkjam, open this link. It says what connecting does, then asks you to sign in to approve it:\n\n  ${url}\n`,
      ).pipe(
        Effect.andThen(input.app ? Console.log(appApprovalLine(url)) : Effect.void),
        Effect.andThen(input.openBrowser(url)),
      ),
  });
  yield* tokens.store(token);
  yield* CliState.setCliDesiredCloudLink(true, "managed");
  // The approval may be for another account than last time; the next link is made for it.
  yield* CliState.forgetLinkedAccount;
  yield* Console.log("Approved.");
  return true;
});

// Removes this computer from the account with its own sign-in first, then signs out here.
const disconnect = Effect.fn("cli.sync.disconnect")(function* () {
  const { leftAccount } = yield* disconnectCloud({ clearAuthorization: true }).pipe(
    Effect.provideService(Console.Console, silentConsole),
  );
  if (!leftAccount) {
    yield* Console.log(
      "Could not remove this computer from your Tinkjam account, so your boards may still list it. To remove it, open Tinkjam, go to Settings and press Remove next to it.",
    );
  }
  yield* Console.log("This computer is no longer connected to Tinkjam.");
});

export const syncCommand = Command.make("sync", {
  ...projectLocationFlags,
  disconnect: Flag.Boolean("disconnect").pipe(
    Flag.withDescription("Disconnect this computer from your Tinkjam account and sign out."),
    Flag.withDefault(false),
  ),
  // The launcher's --install connects with this in the foreground, then starts the background
  // copy with --background, which must never wait for a Connect nobody can see.
  connectOnly: Flag.Boolean("connect-only").pipe(
    Flag.withDescription("Connect this computer if it is not yet, then exit."),
    Flag.withDefault(false),
  ),
  background: Flag.Boolean("background").pipe(
    Flag.withDescription("Run without asking to connect; exit if this computer is not connected."),
    Flag.withDefault(false),
  ),
  stopRunning: Flag.Boolean("stop-running").pipe(
    Flag.withDescription("End any Tinkjam Sync of this home and everything it started."),
    Flag.withDefault(false),
  ),
  processes: Flag.Boolean("processes").pipe(
    Flag.withDescription("List the processes of the Tinkjam Sync of this home."),
    Flag.withDefault(false),
  ),
  // Tinkjam Sync for Mac runs Sync as its child: the app opens the approval link, shows the
  // state from sync-status.json, restarts Sync after a crash and ends it when it quits.
  app: Flag.Boolean("app").pipe(
    Flag.withDescription(
      "Run as the Tinkjam Sync app's child: print the approval link for it, end any other Sync of this home, and stop when the app does.",
    ),
    Flag.withDefault(false),
  ),
}).pipe(
  Command.withDescription(
    "Connect this computer's agents to Tinkjam and keep them available while this runs.",
  ),
  Command.unlisted,
  Command.withHandler(
    Effect.fn("cli.sync")(
      function* (flags) {
        if (!hasCloudPublicConfig) {
          return yield* new CliError.UserError({
            cause: "sync",
            userMessage: "This build cannot connect to Tinkjam: it has no sign-in configuration.",
          });
        }
        if (flags.disconnect) {
          return yield* runCloudCommand(flags, disconnect(), { quietLogs: true });
        }
        const home = yield* runCloudCommand(
          flags,
          Effect.map(ServerConfig.ServerConfig, (config) => ({
            baseDir: config.baseDir,
            stateDir: config.stateDir,
            statePath: config.serverRuntimeStatePath,
          })),
          { quietLogs: true },
        );
        if (flags.processes) {
          const holder = yield* readSyncHolder(home.statePath);
          return yield* Console.log(
            holder === undefined
              ? "Tinkjam Sync: not running"
              : `Tinkjam Sync: ${describeProcesses(yield* syncProcesses(holder))}`,
          );
        }
        if (flags.stopRunning) {
          const legacy = yield* stopLegacySupervisor(home.baseDir);
          const holder = yield* readSyncHolder(home.statePath);
          if (holder !== undefined) {
            yield* Console.log(
              `Stopped Tinkjam Sync: ${describeProcesses(yield* endSyncTree(holder))}`,
            );
          } else if (legacy) {
            yield* Console.log("Stopped Tinkjam Sync.");
          }
          return;
        }

        if (flags.app) yield* Effect.sync(stopWhenAppQuits);
        const run = Effect.gen(function* () {
          let starts: ReadonlyArray<number> | undefined;
          if (flags.background) {
            const decision = restartDecision(
              readStarts(home.baseDir),
              yield* Clock.currentTimeMillis,
            );
            if (decision.kind === "give-up") {
              return yield* Console.log(
                `Tinkjam Sync did not start: it stopped ${RESTART_LIMIT} times in 10 minutes. It tries again when you log in; to try now, run: ${yield* syncCommandWith("--install")}`,
              );
            }
            starts = decision.starts;
            if (decision.delayMs > 0) {
              yield* Console.log(`Starting again in ${decision.delayMs / 1000} seconds.`);
              yield* Effect.sleep(Duration.millis(decision.delayMs));
            }
          }
          const holder = yield* readSyncHolder(home.statePath);
          if (holder !== undefined && !flags.background && !flags.app) {
            if (holder.mode === "app")
              return yield* Console.log(
                "Tinkjam Sync is already running from the Tinkjam Sync app on this Mac. Use its menu bar icon.",
              );
            if (holder.mode === "background")
              return yield* Console.log(
                `Tinkjam Sync is already running in the background on this computer. To stop it, run: ${yield* syncCommandWith("--uninstall")}`,
              );
            return yield* new SyncAlreadyRunningError({ cause: holder.pid });
          }
          // The app has already removed any login item, so whatever else holds this home goes.
          const takeover = flags.app ? "take-over" : takeoverDecision(holder);
          if (holder !== undefined && takeover === "yield") {
            return yield* Console.log(
              `Tinkjam Sync is already running in the background (pid ${holder.pid}).`,
            );
          }
          // Only a start that goes ahead counts toward the restart limit.
          if (starts !== undefined) writeStarts(home.baseDir, starts);
          if (holder !== undefined && takeover === "take-over") {
            yield* Console.log(
              `Ended an older Tinkjam Sync of this home: ${describeProcesses(yield* endSyncTree(holder))}`,
            );
          }

          yield* Console.log("Tinkjam Sync");
          const computerName = yield* resolveServerEnvironmentLabel({ cwdBaseName: "" }).pipe(
            Effect.map((label) => (label === "T3 environment" ? FALLBACK_COMPUTER_NAME : label)),
            Effect.orElseSucceed(() => FALLBACK_COMPUTER_NAME),
          );
          const launcher = yield* ExternalLauncher.ExternalLauncher;
          const openBrowser =
            !flags.background && !flags.app && (yield* canOpenBrowser)
              ? (url: string) => launcher.launchBrowser(url).pipe(Effect.ignore)
              : () => Effect.void;
          const digest = yield* Digest.Digest;
          const connected = yield* runCloudCommand(
            flags,
            approveIfNeeded({
              computerName,
              openBrowser,
              background: flags.background,
              app: flags.app,
            }).pipe(Effect.provideService(Digest.Digest, digest)),
            { quietLogs: true },
          );
          if (!connected) return;
          if (flags.connectOnly) {
            return yield* Console.log("This computer is connected to your Tinkjam account.");
          }
          yield* writeOwnerRecord(
            home.stateDir,
            flags.app ? "app" : flags.background ? "background" : "foreground",
          );
          // Loopback only: the account's tunnel is the one way in, and no pairing code is printed.
          return yield* runServerCommand(
            {
              mode: Option.some("web"),
              port: Option.none(),
              host: Option.some("127.0.0.1"),
              baseDir: flags.baseDir,
              cwd: Option.none(),
              devUrl: Option.none(),
              noBrowser: Option.some(true),
              bootstrapFd: Option.none(),
              autoBootstrapProjectFromCwd: Option.some(false),
              logWebSocketEvents: Option.none(),
              tailscaleServeEnabled: Option.some(false),
              tailscaleServePort: Option.none(),
              lan: Option.some(false),
            },
            {
              startupPresentation: "sync",
              forceAutoBootstrapProjectFromCwd: false,
              rejectRunningServer: true,
              logLevel: "Error",
            },
          );
        });
        // In the background there is no terminal; its words go to <base>/logs/sync.log.
        return yield* flags.background
          ? run.pipe(
              Effect.provideService(
                Console.Console,
                fileConsole(NodePath.join(home.baseDir, "logs", "sync.log")),
              ),
            )
          : run;
      },
      Effect.provide(Layer.merge(ExternalLauncher.layer, ProcessRunner.layer)),
    ),
  ),
);
