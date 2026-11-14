import type { PgClient } from "@effect/sql-pg/PgClient";
import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Drizzle from "@alchemy.run/drizzle";
import * as Planetscale from "@alchemy.run/planetscale";
import * as Alchemy from "alchemy";
import * as RemovalPolicy from "alchemy/RemovalPolicy";
import type { EffectPgDatabase } from "drizzle-orm/effect-postgres";
import * as Config from "effect/Config";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

import { relayDatabaseMode } from "./dbConfig.ts";

export class RelayDb extends Context.Service<
  RelayDb,
  EffectPgDatabase & {
    readonly $client: PgClient;
  }
>()("t3code-relay/db/RelayDb") {}

export class RelayTransactions extends Context.Service<
  RelayTransactions,
  {
    readonly withTransaction: RelayDb["Service"]["$client"]["withTransaction"];
  }
>()("t3code-relay/db/RelayTransactions") {
  static readonly layer = Layer.effect(
    RelayTransactions,
    Effect.gen(function* () {
      const db = yield* RelayDb;
      return RelayTransactions.of({
        withTransaction: db.$client.withTransaction,
      });
    }),
  );
}

export const PlanetscaleDatabase = Effect.gen(function* () {
  const { stage } = yield* Alchemy.Stack;
  const schema = yield* Drizzle.Schema("RelaySchema", {
    schema: "./src/persistence/schema.ts",
    out: "./migrations/postgres",
    dialect: "postgres",
  });

  const mode = relayDatabaseMode(stage);
  const database =
    mode === "shared-database"
      ? yield* Planetscale.PostgresDatabase("RelayPostgresDatabase", {
          name: "t3coderelay",
          region: { slug: "us-west" },
          clusterSize: "PS_80",
          migrations: { dir: schema.out, table: "relay_migrations" },
          replicas: 2,
        }).pipe(RemovalPolicy.retain())
      : yield* Planetscale.PostgresDatabase.ref("RelayPostgresDatabase", {
          stage: "prod",
        });
  const branch =
    mode === "stage-branch"
      ? yield* Planetscale.PostgresBranch("RelayPostgresBranch", {
          database,
          migrations: { dir: schema.out, table: "relay_migrations" },
        })
      : undefined;

  const runtimeRole = yield* Planetscale.PostgresRole("RelayPostgresRuntimeRole", {
    database,
    ...(branch ? { branch } : {}),
    inheritedRoles: ["pg_read_all_data", "pg_write_all_data"],
  });

  return { branch, database, runtimeRole };
});

/**
 * A Postgres the operator runs themselves (Neon, Supabase, their own server), named by
 * `RELAY_DATABASE_URL`. Set, it replaces PlanetScale: nothing is provisioned, and migrations are
 * applied with `scripts/migrate-external-db.ts` before a deploy.
 */
export const ExternalDatabaseUrl = Config.Redacted("RELAY_DATABASE_URL").pipe(Config.option);

/** The Hyperdrive origin for a Postgres URL, or null when the URL does not name one. */
export function hyperdriveOriginFromUrl(url: string) {
  const parsed = URL.parse(url);
  if (parsed === null || !/^postgres(ql)?:$/u.test(parsed.protocol)) return null;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
  const user = decodeURIComponent(parsed.username);
  if (parsed.hostname === "" || database === "" || user === "") return null;
  return {
    scheme: "postgres" as const,
    host: parsed.hostname,
    ...(parsed.port === "" ? {} : { port: Number(parsed.port) }),
    database,
    user,
    password: Redacted.make(decodeURIComponent(parsed.password)),
  };
}

/** What the deploy reports about the database it used. */
export const RelayDatabaseSummary = Effect.gen(function* () {
  if (Option.isSome(yield* ExternalDatabaseUrl)) {
    return { databaseName: "external", databaseBranchName: "external" };
  }
  const db = yield* PlanetscaleDatabase;
  return { databaseName: db.database.name, databaseBranchName: db.branch?.name ?? "main" };
});

const relayDatabaseOrigin = Effect.gen(function* () {
  const external = yield* ExternalDatabaseUrl;
  if (Option.isNone(external)) return (yield* PlanetscaleDatabase).runtimeRole.origin;
  const origin = hyperdriveOriginFromUrl(Redacted.value(external.value));
  if (origin === null) {
    return yield* Effect.die(new Error("RELAY_DATABASE_URL is not a postgres:// address."));
  }
  return origin;
});

export const RelayHyperdrive = Effect.gen(function* () {
  const origin = yield* relayDatabaseOrigin;
  return yield* Cloudflare.Hyperdrive.Connection("RelayHyperdrive", {
    origin,
    caching: {
      disabled: true,
    },
    originConnectionLimit: 40,
  });
});
