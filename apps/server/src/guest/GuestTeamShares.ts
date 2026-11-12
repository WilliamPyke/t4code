import type { OrchestrationV2DomainEvent, ThreadId } from "@t3tools/contracts";
import {
  RelayTeamMemberAssertionPayload,
  type RelayTeamThreadRegistrationRequest,
} from "@t3tools/contracts/relay";
import {
  normalizeRelayIssuer,
  RELAY_TEAM_MEMBER_TYP,
  verifyRelayJwt,
} from "@t3tools/shared/relayJwt";
import * as Context from "effect/Context";
import * as Signature from "effect/crypto/Signature";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  CLOUD_MINT_PUBLIC_KEY,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
  readRelayConnection,
} from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { makeRelayEnvironmentClient } from "../relay/relayEnvironmentClient.ts";
import { forkParked } from "../serverActivation.ts";
import * as ServerSettings from "../serverSettings.ts";

const RELAY_TIMEOUT = "5 seconds";

/**
 * Threads shared to a team: listed on the relay this server is linked to, so members find them,
 * and joined only with a member assertion that relay signed for this machine.
 */
export class GuestTeamShares extends Context.Service<
  GuestTeamShares,
  {
    /**
     * Lists the thread on the team and returns the team's name, or null when there is no relay or
     * it refused, such as when no account this machine is linked to is in the team.
     */
    readonly register: (input: RelayTeamThreadRegistrationRequest) => Effect.Effect<string | null>;
    readonly unregister: (threadId: ThreadId) => Effect.Effect<void>;
    /** The member an assertion names, when this server's relay signed it for this machine. */
    readonly verifyMember: (
      token: string,
    ) => Effect.Effect<Option.Option<RelayTeamMemberAssertionPayload>>;
  }
>()("t3/guest/GuestTeamShares") {}

const text = (bytes: Option.Option<Uint8Array>) =>
  Option.map(bytes, (value) => new TextDecoder().decode(value));

const make = Effect.gen(function* () {
  const secrets = yield* ServerSecretStore.ServerSecretStore;
  const environment = yield* ServerEnvironment.ServerEnvironment;
  const signature = yield* Signature.Signature;
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  // The title each team thread was last listed under, so only a rename reaches the relay.
  const listedTitles = new Map<ThreadId, string>();

  const relayClient = readRelayConnection.pipe(
    Effect.flatMap((connection) =>
      connection === null
        ? Effect.succeed(null)
        : Effect.map(makeRelayEnvironmentClient(connection), (client) => client.server),
    ),
    Effect.provideService(ServerSecretStore.ServerSecretStore, secrets),
  );

  const register: GuestTeamShares["Service"]["register"] = Effect.fn("GuestTeamShares.register")(
    function* (payload) {
      const client = yield* relayClient;
      if (client === null) return null;
      const { teamName } = yield* client.registerTeamThread({
        params: { environmentId: yield* environment.getEnvironmentId },
        payload,
      });
      listedTitles.set(payload.threadId, payload.title);
      return teamName;
    },
    Effect.timeout(RELAY_TIMEOUT),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not share a thread with a team", { cause }).pipe(Effect.as(null)),
    ),
  );

  const unregister: GuestTeamShares["Service"]["unregister"] = Effect.fn(
    "GuestTeamShares.unregister",
  )(
    function* (threadId) {
      listedTitles.delete(threadId);
      const client = yield* relayClient;
      if (client === null) return;
      yield* client.unregisterTeamThread({
        params: { environmentId: yield* environment.getEnvironmentId, threadId },
      });
    },
    Effect.timeout(RELAY_TIMEOUT),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not stop listing a thread on its team", { cause }),
    ),
  );

  const verifyMember: GuestTeamShares["Service"]["verifyMember"] = Effect.fn(
    "GuestTeamShares.verifyMember",
  )(
    function* (token) {
      const publicKey = text(yield* secrets.get(CLOUD_MINT_PUBLIC_KEY));
      const issuer = text(yield* secrets.get(RELAY_ISSUER_SECRET));
      const relayIssuer = Option.isSome(issuer)
        ? issuer
        : text(yield* secrets.get(RELAY_URL_SECRET));
      if (Option.isNone(publicKey) || Option.isNone(relayIssuer)) return Option.none();
      const environmentId = yield* environment.getEnvironmentId;
      const payload = yield* verifyRelayJwt(RelayTeamMemberAssertionPayload, {
        publicKey: publicKey.value,
        token,
        typ: RELAY_TEAM_MEMBER_TYP,
        issuer: normalizeRelayIssuer(relayIssuer.value),
        audience: `t3-env:${environmentId}`,
      }).pipe(Effect.provideService(Signature.Signature, signature), Effect.option);
      return Option.filter(payload, (claims) => claims.sub === claims.userId);
    },
    Effect.orElseSucceed(() => Option.none()),
  );

  const rename = Effect.fn("GuestTeamShares.rename")(
    function* (threadId: ThreadId, title: string) {
      const client = yield* relayClient;
      if (client === null) return;
      yield* client.renameTeamThread({
        params: { environmentId: yield* environment.getEnvironmentId, threadId },
        payload: { title },
      });
      listedTitles.set(threadId, title);
    },
    Effect.timeout(RELAY_TIMEOUT),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not rename a thread on its team", { cause }),
    ),
  );

  // Ending the share ends its listing, and a rename renames it. Untraced: it sees every domain
  // event of every thread.
  const onEvent = Effect.fnUntraced(function* (event: OrchestrationV2DomainEvent) {
    if (
      (event.type === "thread.guest-share-updated" && event.payload.guestShare === null) ||
      (event.type === "thread.archived" && event.payload.guestShare?.team !== undefined)
    ) {
      yield* unregister(event.threadId);
    } else if (
      event.type === "thread.metadata-updated" &&
      event.payload.guestShare?.team !== undefined &&
      event.payload.archivedAt === null &&
      listedTitles.get(event.threadId) !== event.payload.title
    ) {
      yield* rename(event.threadId, event.payload.title);
    }
  });
  yield* forkParked(Stream.runForEach(orchestrator.streamDomainEvents, onEvent));

  // With guest links off no team thread opens, so the team stops listing them until they are on.
  const setListed = Effect.fn("GuestTeamShares.setListed")(
    function* (listed: boolean) {
      const client = yield* relayClient;
      if (client === null) return;
      yield* client.setTeamThreadsListed({
        params: { environmentId: yield* environment.getEnvironmentId },
        payload: { listed },
      });
    },
    Effect.timeout(RELAY_TIMEOUT),
    Effect.catchCause((cause) =>
      Effect.logWarning("Could not list this machine's threads on its teams", { cause }),
    ),
  );
  const settingsChanges = yield* serverSettings.subscribeChanges;
  let sharingEnabled = yield* serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.guestSharingEnabled),
    Effect.orElseSucceed(() => false),
  );
  yield* forkParked(
    Stream.runForEach(settingsChanges, (settings) => {
      if (settings.guestSharingEnabled === sharingEnabled) return Effect.void;
      sharingEnabled = settings.guestSharingEnabled;
      return setListed(sharingEnabled);
    }),
  );

  return GuestTeamShares.of({ register, unregister, verifyMember });
});

export const layer = Layer.effect(GuestTeamShares, make);
