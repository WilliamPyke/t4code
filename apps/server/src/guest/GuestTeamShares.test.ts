import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no generateKeyPairSync.
import * as NodeCrypto from "node:crypto";
import {
  EnvironmentId,
  EventId,
  GuestShareId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationV2AppThread,
  type OrchestrationV2DomainEvent,
} from "@t3tools/contracts";
import { RELAY_TEAM_MEMBER_TYP, signRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import {
  CLOUD_MINT_PUBLIC_KEY,
  RELAY_ENVIRONMENT_CREDENTIAL_SECRET,
  RELAY_ISSUER_SECRET,
  RELAY_URL_SECRET,
} from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as GuestTeamShares from "./GuestTeamShares.ts";

const environmentId = EnvironmentId.make("env-owner");
const relayIssuer = "https://relay.example.test";
const keyPair = () =>
  NodeCrypto.generateKeyPairSync("ed25519", {
    privateKeyEncoding: { format: "pem", type: "pkcs8" },
    publicKeyEncoding: { format: "pem", type: "spki" },
  });
const mintKeys = keyPair();
const secrets: ReadonlyMap<string, string> = new Map([
  [CLOUD_MINT_PUBLIC_KEY, mintKeys.publicKey],
  [RELAY_ISSUER_SECRET, relayIssuer],
  [RELAY_URL_SECRET, relayIssuer],
  [RELAY_ENVIRONMENT_CREDENTIAL_SECRET, "environment-credential"],
]);

/** The relay as the owner's server reaches it, and the events and settings changes it sees. */
class Relay extends Context.Service<
  Relay,
  {
    /** Each request the relay got, as `<method> <path> <body>`. */
    readonly requests: Queue.Queue<string>;
    readonly events: Queue.Queue<OrchestrationV2DomainEvent>;
    readonly sharingEnabled: Queue.Queue<boolean>;
    /** Who the relay says is in the team; null when it fails. */
    readonly teamMembers: Ref.Ref<ReadonlyArray<string> | null>;
  }
>()("t3/guest/GuestTeamShares.test/Relay") {}

const layerRelay = Layer.effect(
  Relay,
  Effect.gen(function* () {
    return {
      requests: yield* Queue.unbounded<string>(),
      events: yield* Queue.unbounded<OrchestrationV2DomainEvent>(),
      sharingEnabled: yield* Queue.unbounded<boolean>(),
      teamMembers: yield* Ref.make<ReadonlyArray<string> | null>(["user-ann"]),
    };
  }),
);

const layerFetch = Layer.effect(
  FetchHttpClient.Fetch,
  Effect.gen(function* () {
    const relay = yield* Relay;
    return async (input: string | URL | Request, init?: RequestInit) => {
      const request = new Request(input, init);
      const { pathname } = new URL(request.url);
      const body = await request.text();
      Queue.offerUnsafe(relay.requests, `${request.method} ${pathname} ${body}`.trim());
      if (!pathname.endsWith("/member-ids")) return Response.json({ ok: true });
      const userIds = Ref.getUnsafe(relay.teamMembers);
      return userIds === null ? new Response("down", { status: 502 }) : Response.json({ userIds });
    };
  }),
);

const layerOrchestrator = Layer.unwrap(
  Effect.gen(function* () {
    const relay = yield* Relay;
    return Layer.mock(Orchestrator.OrchestratorV2)({
      streamDomainEvents: Stream.fromQueue(relay.events),
    });
  }),
);

const layerSettings = Layer.effect(
  ServerSettings.ServerSettingsService,
  Effect.gen(function* () {
    const relay = yield* Relay;
    const settings = yield* ServerSettings.ServerSettingsService;
    return {
      ...settings,
      subscribeChanges: Effect.succeed(
        Stream.fromQueue(relay.sharingEnabled).pipe(
          Stream.mapEffect((guestSharingEnabled) =>
            settings.getSettings.pipe(
              Effect.orDie,
              Effect.map((current) => ({ ...current, guestSharingEnabled })),
            ),
          ),
        ),
      ),
    };
  }),
).pipe(
  Layer.provide(ServerSettings.ServerSettingsService.layerTest({ guestSharingEnabled: true })),
);

const layerTest = GuestTeamShares.layer.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(ServerSecretStore.ServerSecretStore)({
        get: (name) =>
          Effect.succeed(
            Option.map(Option.fromUndefinedOr(secrets.get(name)), (value) =>
              new TextEncoder().encode(value),
            ),
          ),
      }),
      Layer.mock(ServerEnvironment.ServerEnvironment)({
        getEnvironmentId: Effect.succeed(environmentId),
      }),
      layerOrchestrator,
      layerSettings,
      PlatformNodeCrypto.layerSignature,
    ),
  ),
  Layer.provideMerge(layerFetch),
  Layer.provideMerge(layerRelay),
);

const assertion = Effect.fn("assertion")(function* (
  overrides: { readonly aud?: string; readonly sub?: string; readonly privateKey?: string } = {},
) {
  const now = Math.floor((yield* Clock.currentTimeMillis) / 1_000);
  return yield* signRelayJwt({
    privateKey: overrides.privateKey ?? mintKeys.privateKey,
    typ: RELAY_TEAM_MEMBER_TYP,
    payload: {
      iss: relayIssuer,
      aud: overrides.aud ?? `t3-env:${environmentId}`,
      sub: overrides.sub ?? "user-ann",
      jti: "assertion-1",
      iat: now,
      exp: now + 300,
      teamId: "team-core",
      userId: "user-ann",
      name: "Ann Lee",
      avatarUrl: null,
    },
  }).pipe(Effect.provide(PlatformNodeCrypto.layerSignature));
});

const threadId = ThreadId.make("thread-1");
/** A domain event for a thread shared with the team "Core". */
const teamThreadEvent = Effect.fn("teamThreadEvent")(function* (
  type: "thread.metadata-updated" | "thread.archived",
  title: string,
) {
  const now = yield* DateTime.now;
  const payload: OrchestrationV2AppThread = {
    createdBy: "user",
    creationSource: "web",
    id: threadId,
    projectId: ProjectId.make("project-1"),
    title,
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.1-codex" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { parentThreadId: null, relationshipToParent: null, rootThreadId: threadId },
    forkedFrom: null,
    createdAt: now,
    updatedAt: now,
    archivedAt: type === "thread.archived" ? now : null,
    settledOverride: null,
    settledAt: null,
    lastVisitedAt: null,
    deletedAt: null,
    guestShare: {
      id: GuestShareId.make("share-1"),
      host: "owner.example.org",
      createdAt: DateTime.formatIso(now),
      expiresAt: DateTime.formatIso(DateTime.add(now, { days: 1 })),
      guestName: null,
      guests: [],
      messages: [],
      team: { id: "team-core", name: "Core" },
    },
  };
  return {
    id: EventId.make(`${type}:${title}`),
    type,
    threadId,
    occurredAt: now,
    payload,
  } satisfies OrchestrationV2DomainEvent;
});

const teamThreadPath = `/v1/environments/${environmentId}/team-threads`;

it.effect("trusts a member assertion only from this machine's relay key, for this machine", () =>
  Effect.gen(function* () {
    const teamShares = yield* GuestTeamShares.GuestTeamShares;
    const verified = yield* teamShares.verifyMember(yield* assertion());
    assert.deepInclude(Option.getOrThrow(verified), {
      teamId: "team-core",
      userId: "user-ann",
      name: "Ann Lee",
    });

    const refused = [
      yield* assertion({ privateKey: keyPair().privateKey }),
      yield* assertion({ aud: "t3-env:someone-else" }),
      yield* assertion({ sub: "user-eve" }),
      "not a token",
    ];
    for (const token of refused) {
      assert.isTrue(Option.isNone(yield* teamShares.verifyMember(token)));
    }

    const stale = yield* assertion();
    yield* TestClock.adjust("10 minutes");
    assert.isTrue(Option.isNone(yield* teamShares.verifyMember(stale)));
  }).pipe(Effect.provide(layerTest)),
);

it.effect("renames a team thread on the relay once per new title, and unlists it archived", () =>
  Effect.gen(function* () {
    yield* GuestTeamShares.GuestTeamShares;
    const relay = yield* Relay;
    yield* Queue.offer(relay.events, yield* teamThreadEvent("thread.metadata-updated", "Ship it"));
    yield* Queue.offer(relay.events, yield* teamThreadEvent("thread.metadata-updated", "Ship it"));
    yield* Queue.offer(relay.events, yield* teamThreadEvent("thread.archived", "Ship it"));
    assert.equal(
      yield* Queue.take(relay.requests),
      `POST ${teamThreadPath}/${threadId}/title {"title":"Ship it"}`,
    );
    // The same title again sends nothing, so the next request is the archive's.
    assert.equal(yield* Queue.take(relay.requests), `DELETE ${teamThreadPath}/${threadId}`);
  }).pipe(Effect.provide(layerTest)),
);

it.effect("hides this machine's team threads while guest links are off, and shows them again", () =>
  Effect.gen(function* () {
    yield* GuestTeamShares.GuestTeamShares;
    const relay = yield* Relay;
    yield* Queue.offer(relay.sharingEnabled, false);
    yield* Queue.offer(relay.sharingEnabled, true);
    assert.equal(
      yield* Queue.take(relay.requests),
      `POST ${teamThreadPath}/listed {"listed":false}`,
    );
    assert.equal(
      yield* Queue.take(relay.requests),
      `POST ${teamThreadPath}/listed {"listed":true}`,
    );
  }).pipe(Effect.provide(layerTest)),
);

it.effect(
  "asks the relay who is in a team at most once a minute, and trusts it when it fails",
  () =>
    Effect.gen(function* () {
      const teamShares = yield* GuestTeamShares.GuestTeamShares;
      const relay = yield* Relay;
      const asked = `GET /v1/environments/${environmentId}/teams/team-core/member-ids`;
      assert.isTrue(yield* teamShares.isMember("team-core", "user-ann"));
      assert.isFalse(yield* teamShares.isMember("team-core", "user-ben"));
      assert.deepEqual(yield* Queue.takeAll(relay.requests), [asked]);

      // Ann leaves: her machine's owner hears it once the last answer is a minute old.
      yield* Ref.set(relay.teamMembers, []);
      assert.isTrue(yield* teamShares.isMember("team-core", "user-ann"));
      yield* TestClock.adjust("1 minute");
      assert.isFalse(yield* teamShares.isMember("team-core", "user-ann"));

      // Back in the team, a fresh assertion from her is heard at once.
      yield* Ref.set(relay.teamMembers, ["user-ann"]);
      assert.isTrue(Option.isSome(yield* teamShares.verifyMember(yield* assertion())));
      assert.isTrue(yield* teamShares.isMember("team-core", "user-ann"));

      // A relay that cannot answer ends no one's session.
      yield* Ref.set(relay.teamMembers, null);
      yield* TestClock.adjust("1 minute");
      assert.isTrue(yield* teamShares.isMember("team-core", "user-ben"));
      assert.deepEqual(yield* Queue.takeAll(relay.requests), [asked, asked, asked]);
    }).pipe(Effect.provide(layerTest)),
);
