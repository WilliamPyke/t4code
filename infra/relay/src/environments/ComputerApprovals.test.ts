import { describe, expect, it } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg/PgClient";
import { PGlite } from "@electric-sql/pglite";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as Digest from "effect/crypto/Digest";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as RelayDb from "../db.ts";
import * as ComputerApprovals from "./ComputerApprovals.ts";

const MIGRATION = "20261119180000_computer_approvals";

// Just enough of @effect/sql-pg's client for drizzle to run its queries on PGlite.
const pgliteClient = (pg: PGlite) => {
  const query = (sql: string, params: ReadonlyArray<unknown>, rowMode: "array" | "object") =>
    Effect.promise(() => pg.query(sql, [...params], { rowMode }));
  return {
    unsafe: (sql: string, params: ReadonlyArray<unknown> = []) => ({
      values: Effect.map(query(sql, params, "array"), (result) => result.rows),
      withoutTransform: Effect.map(query(sql, params, "object"), (result) => result.rows),
      raw: query(sql, params, "object"),
    }),
    withTransaction: <A, E, R>(effect: Effect.Effect<A, E, R>) => effect,
  } as unknown as PgClient;
};

const setup = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const pg = yield* Effect.acquireRelease(
    Effect.promise(() => PGlite.create()),
    (client) => Effect.promise(() => client.close()),
  );
  const migration = yield* fs.readFileString(
    yield* path.fromFileUrl(
      new URL(`../../migrations/postgres/${MIGRATION}/migration.sql`, import.meta.url),
    ),
  );
  yield* Effect.promise(() => pg.exec(migration));
  const db = yield* PgDrizzle.makeWithDefaults().pipe(
    Effect.provideService(PgClient, pgliteClient(pg)),
  );
  return yield* ComputerApprovals.ComputerApprovals.pipe(
    Effect.provide(
      ComputerApprovals.layer.pipe(
        Layer.provide(Layer.succeed(RelayDb.RelayDb, db as RelayDb.RelayDb["Service"])),
      ),
    ),
  );
});

const verifier = "verifier-of-the-sign-in-the-person-approved";
const challengeOf = (value: string) =>
  Effect.flatMap(Digest.Digest, (digest) =>
    digest.digest(Digest.sha256, new TextEncoder().encode(value)),
  ).pipe(Effect.map(Base64Url.encode));

describe("ComputerApprovals", () => {
  it.effect("is redeemed once, by one key, by the account that pressed Connect", () =>
    Effect.gen(function* () {
      const approvals = yield* setup;
      const codeChallenge = yield* challengeOf(verifier);
      yield* approvals.create({ userId: "user-1", codeChallenge });

      // Without the verifier, or for another account, there is nothing to redeem.
      const redeem = (input: { userId?: string; verifier?: string; key: string }) =>
        approvals.redeem({
          userId: input.userId ?? "user-1",
          verifier: input.verifier ?? verifier,
          environmentPublicKey: input.key,
        });
      expect(yield* redeem({ verifier: "guessed", key: "key-a" })).toBeNull();
      expect(yield* redeem({ userId: "user-2", key: "key-a" })).toBeNull();

      // The first key holds it; a retry by that key still works until the link is saved.
      expect(yield* redeem({ key: "key-a" })).toBe(codeChallenge);
      expect(yield* redeem({ key: "key-b" })).toBeNull();
      expect(yield* redeem({ key: "key-a" })).toBe(codeChallenge);

      yield* approvals.finish({ userId: "user-1", codeChallenge });
      expect(yield* redeem({ key: "key-a" })).toBeNull();

      // Pressing Connect again for a spent sign-in does not make it usable again.
      yield* approvals.create({ userId: "user-1", codeChallenge });
      expect(yield* redeem({ key: "key-a" })).toBeNull();
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );

  it.effect("expires half an hour after the press", () =>
    Effect.gen(function* () {
      const approvals = yield* setup;
      yield* approvals.create({ userId: "user-1", codeChallenge: yield* challengeOf(verifier) });
      yield* TestClock.adjust("31 minutes");
      expect(
        yield* approvals.redeem({ userId: "user-1", verifier, environmentPublicKey: "key-a" }),
      ).toBeNull();
    }).pipe(Effect.provide(Layer.mergeAll(NodeServices.layer, NodeCrypto.layer))),
  );
});
