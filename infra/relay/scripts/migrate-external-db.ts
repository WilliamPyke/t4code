// Applies migrations/postgres to the Postgres named by RELAY_DATABASE_URL. Only for a relay that
// runs on its own Postgres; a PlanetScale relay is migrated by the deploy itself.
// Run from infra/relay: node --env-file=.env scripts/migrate-external-db.ts
import * as NodeRuntime from "@effect/platform-node/NodeRuntime";
import * as NodeServices from "@effect/platform-node/NodeServices";
import * as PgClient from "@effect/sql-pg/PgClient";
import * as Config from "effect/Config";
import * as Console from "effect/Console";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";

const MIGRATIONS_DIR = "migrations/postgres";

const program = Effect.gen(function* () {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const sql = yield* PgClient.PgClient;
  // Its own table: Alchemy never manages this database, so its bookkeeping is not involved.
  yield* sql`CREATE TABLE IF NOT EXISTS relay_external_migrations (
    name text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`;
  const applied = new Set(
    (yield* sql<{ readonly name: string }>`SELECT name FROM relay_external_migrations`).map(
      (row) => row.name,
    ),
  );
  const names = (yield* fileSystem.readDirectory(MIGRATIONS_DIR)).toSorted();
  for (const name of names) {
    if (applied.has(name)) continue;
    const script = yield* fileSystem.readFileString(
      path.join(MIGRATIONS_DIR, name, "migration.sql"),
    );
    yield* sql.withTransaction(
      Effect.gen(function* () {
        for (const statement of script.split("--> statement-breakpoint")) {
          if (statement.trim() !== "") yield* sql.unsafe(statement);
        }
        yield* sql`INSERT INTO relay_external_migrations (name) VALUES (${name})`;
      }),
    );
    yield* Console.log(`applied ${name}`);
  }
  yield* Console.log(`${names.length} migrations, ${names.length - applied.size} applied now`);
});

program.pipe(
  Effect.provide(
    Layer.merge(
      PgClient.layerConfig({ url: Config.Redacted("RELAY_DATABASE_URL") }),
      NodeServices.layer,
    ),
  ),
  NodeRuntime.runMain,
);
