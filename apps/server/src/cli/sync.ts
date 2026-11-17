import * as RelayClient from "@t3tools/shared/relayClient";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
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
import { isProcessAlive, readPersistedServerRuntimeState } from "../serverRuntimeState.ts";
import { projectLocationFlags } from "./config.ts";
import {
  acquireRelayClientForLink,
  disconnectCloud,
  requireConnectAllowed,
  runCloudCommand,
} from "./connect.ts";
import { runServerCommand } from "./server.ts";

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

const FALLBACK_COMPUTER_NAME = "This computer";

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

const SYNC_NOT_CONNECTED_MESSAGE =
  "This computer is not connected to Tinkjam, so Tinkjam Sync stopped. To connect it, run the Tinkjam Sync command again with --install.";

/**
 * Asks the browser to connect this computer to the person's account, unless it already is.
 * In the background nobody can press Connect, so it says so and reports false instead.
 */
const approveIfNeeded = Effect.fn("cli.sync.approve_if_needed")(function* (input: {
  readonly computerName: string;
  readonly openBrowser: (url: string) => Effect.Effect<void>;
  readonly background: boolean;
}) {
  const config = yield* ServerConfig.ServerConfig;
  const running = yield* readPersistedServerRuntimeState(config.serverRuntimeStatePath);
  if (
    Option.isSome(running) &&
    running.value.pid !== process.pid &&
    isProcessAlive(running.value.pid)
  ) {
    return yield* new SyncAlreadyRunningError({ cause: running.value.pid });
  }
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const tokens = yield* CliTokenManager.CloudCliTokenManager;
  const signedIn = yield* tokens.getExisting.pipe(
    Effect.map(Option.isSome),
    Effect.orElseSucceed(() => false),
  );
  const needsApproval = syncNeedsApproval({
    desired: yield* CliState.readCliDesiredCloudLink,
    mode: yield* CliState.readCliDesiredLinkMode,
    signedIn,
    revoked: Option.isSome(yield* secrets.get(CLOUD_LINK_REVOKED)),
  });
  if (!needsApproval) return true;
  if (input.background) {
    yield* Console.log(SYNC_NOT_CONNECTED_MESSAGE);
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
        `\nTo connect ${input.computerName} to Tinkjam, open this link and press Connect:\n\n  ${url}\n`,
      ).pipe(Effect.andThen(input.openBrowser(url))),
  });
  yield* tokens.store(token);
  yield* CliState.setCliDesiredCloudLink(true, "managed");
  yield* CliState.dropRevokedCloudLink;
  yield* Console.log("Approved.");
  return true;
});

const disconnect = Effect.fn("cli.sync.disconnect")(function* () {
  yield* disconnectCloud({ clearAuthorization: true }).pipe(
    Effect.provideService(Console.Console, silentConsole),
  );
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
}).pipe(
  Command.withDescription(
    "Connect this computer's agents to Tinkjam and keep them available while this runs.",
  ),
  Command.unlisted,
  Command.withHandler(
    Effect.fn("cli.sync")(function* (flags) {
      if (!hasCloudPublicConfig) {
        return yield* new CliError.UserError({
          cause: "sync",
          userMessage: "This build cannot connect to Tinkjam: it has no sign-in configuration.",
        });
      }
      if (flags.disconnect) {
        return yield* runCloudCommand(flags, disconnect(), { quietLogs: true });
      }
      yield* Console.log("Tinkjam Sync");
      const computerName = yield* resolveServerEnvironmentLabel({ cwdBaseName: "" }).pipe(
        Effect.map((label) => (label === "T3 environment" ? FALLBACK_COMPUTER_NAME : label)),
        Effect.orElseSucceed(() => FALLBACK_COMPUTER_NAME),
        Effect.provide(ProcessRunner.layer),
      );
      const launcher = yield* ExternalLauncher.ExternalLauncher;
      const openBrowser =
        !flags.background && (yield* canOpenBrowser)
          ? (url: string) => launcher.launchBrowser(url).pipe(Effect.ignore)
          : () => Effect.void;
      const digest = yield* Digest.Digest;
      const connected = yield* runCloudCommand(
        flags,
        approveIfNeeded({ computerName, openBrowser, background: flags.background }).pipe(
          Effect.provideService(Digest.Digest, digest),
        ),
        { quietLogs: true },
      );
      if (!connected) return;
      if (flags.connectOnly) {
        return yield* Console.log("This computer is connected to your Tinkjam account.");
      }
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
    }, Effect.provide(ExternalLauncher.layer)),
  ),
);
