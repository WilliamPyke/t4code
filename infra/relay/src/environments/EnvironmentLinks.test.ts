import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { PgDialect } from "drizzle-orm/pg-core";

import * as RelayDb from "../db.ts";
import { relayEnvironmentLinks } from "../persistence/schema.ts";
import * as EnvironmentLinks from "./EnvironmentLinks.ts";

describe("EnvironmentLinks", () => {
  it.effect("carries the webhook-hold opt-in over only from links with the same key", () => {
    const inserted: Array<Record<string, unknown>> = [];
    const updated: Array<Record<string, unknown>> = [];
    const fakeDb = {
      insert: () => ({
        values: (values: Record<string, unknown>) => {
          inserted.push(values);
          return {
            onConflictDoUpdate: (conflict: { set: Record<string, unknown> }) => {
              updated.push(conflict.set);
              return Effect.void;
            },
          };
        },
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      yield* links.upsert({
        userId: "user-1",
        request: {
          notificationsEnabled: false,
          liveActivitiesEnabled: false,
          managedTunnelsEnabled: true,
        } as never,
        proof: {
          environmentId: "env-1",
          environmentPublicKey: "public-key-1",
          descriptor: { label: "Laptop" },
        } as never,
        endpoint: { httpBaseUrl: "https://a.example", wsBaseUrl: "wss://a.example" } as never,
      });
      const query = new PgDialect().sqlToQuery(inserted[0]?.holdWebhooksWhileOffline as never);
      expect(query.sql).toContain("environment_public_key");
      expect(query.params).toEqual(["env-1", "public-key-1"]);
      // A server too old to name its computer must not erase the id an earlier link recorded.
      expect(inserted[0]?.machineId).toBeNull();
      expect(updated[0]).not.toHaveProperty("machineId");

      yield* links.upsert({
        userId: "user-1",
        request: {} as never,
        proof: {
          environmentId: "env-1",
          environmentPublicKey: "public-key-1",
          descriptor: { label: "Laptop" },
          machineId: "machine-1",
        } as never,
        endpoint: {} as never,
      });
      expect(inserted[1]?.machineId).toBe("machine-1");
      expect(updated[1]?.machineId).toBe("machine-1");
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("finds a computer's earlier links only on the same account and still active", () => {
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      select: () => ({
        from: () => ({
          where: (condition: unknown) => {
            whereConditions.push(condition);
            return Effect.succeed([{ environmentId: "env-old" }]);
          },
        }),
      }),
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      expect(
        yield* links.listOtherEnvironmentsForMachine({
          userId: "user-1",
          environmentId: "env-new",
          machineId: "machine-1",
        }),
      ).toEqual(["env-old"]);
      const query = new PgDialect().sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."machine_id" = $2');
      expect(query.sql).toContain('"relay_environment_links"."environment_id" <> $3');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.params).toEqual(["user-1", "machine-1", "env-new"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });

  it.effect("revokes only the active link owned by the requesting user", () => {
    const updateValues: Array<Record<string, unknown>> = [];
    const whereConditions: Array<unknown> = [];
    const fakeDb = {
      update: (table: unknown) => {
        expect(table).toBe(relayEnvironmentLinks);
        return {
          set: (values: Record<string, unknown>) => {
            updateValues.push(values);
            return {
              where: (condition: unknown) => {
                whereConditions.push(condition);
                return {
                  returning: () => {
                    return Effect.succeed([{ environmentId: "env-1" }]);
                  },
                };
              },
            };
          },
        };
      },
    } as unknown as RelayDb.RelayDb["Service"];

    return Effect.gen(function* () {
      const links = yield* EnvironmentLinks.EnvironmentLinks;
      const revoked = yield* links.revokeForUser({
        userId: "user-1",
        environmentId: "env-1",
      });

      expect(revoked).toBe(true);
      expect(updateValues).toHaveLength(1);
      expect(updateValues[0]?.revokedAt).toEqual(updateValues[0]?.updatedAt);
      expect(typeof updateValues[0]?.revokedAt).toBe("string");
      expect(whereConditions).toHaveLength(1);

      const dialect = new PgDialect();
      const query = dialect.sqlToQuery(whereConditions[0] as never);
      expect(query.sql).toContain('"relay_environment_links"."user_id" = $1');
      expect(query.sql).toContain('"relay_environment_links"."environment_id" = $2');
      expect(query.sql).toContain('"relay_environment_links"."revoked_at" is null');
      expect(query.params).toEqual(["user-1", "env-1"]);
    }).pipe(
      Effect.provide(
        EnvironmentLinks.layer.pipe(Layer.provide(Layer.succeed(RelayDb.RelayDb, fakeDb))),
      ),
    );
  });
});
