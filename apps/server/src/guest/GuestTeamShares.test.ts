import * as PlatformNodeCrypto from "@effect/platform-node/NodeCrypto";
import { assert, it } from "@effect/vitest";
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Effect's Crypto has no generateKeyPairSync.
import * as NodeCrypto from "node:crypto";
import { EnvironmentId } from "@t3tools/contracts";
import { RELAY_TEAM_MEMBER_TYP, signRelayJwt } from "@t3tools/shared/relayJwt";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as ServerSecretStore from "../auth/ServerSecretStore.ts";
import { CLOUD_MINT_PUBLIC_KEY, RELAY_ISSUER_SECRET } from "../cloud/config.ts";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
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
]);

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
      Layer.mock(Orchestrator.OrchestratorV2)({ streamDomainEvents: Stream.empty }),
      PlatformNodeCrypto.layerSignature,
    ),
  ),
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
