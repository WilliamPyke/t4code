import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg/PgClient";
import { PGlite } from "@electric-sql/pglite";
import { RELAY_GUEST_LINK_NAME_PATTERN } from "@t3tools/contracts/relay";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as RelayDb from "../db.ts";
import * as GuestLinks from "./GuestLinks.ts";
import { GUEST_LINK_WORDS } from "./words.ts";

const MIGRATION = "20261111180000_guest_links";

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

/** Each pick reads two bytes; scripted values come first, then 0, 1, 2, ... */
const scriptedRandom = (script: Array<number>) => {
  let next = 0;
  return SecureRandom.make(() => {
    const value = script.shift() ?? next++;
    return Uint8Array.of(value >> 8, value & 255);
  });
};

const setup = (script: Array<number> = []) =>
  Effect.gen(function* () {
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
    const links = yield* GuestLinks.GuestLinks.pipe(
      Effect.provide(
        GuestLinks.layer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(RelayDb.RelayDb, db as RelayDb.RelayDb["Service"]),
              Layer.succeed(SecureRandom.SecureRandom, scriptedRandom(script)),
            ),
          ),
        ),
      ),
    );
    const names = Effect.promise(() =>
      pg.query<{ name: string }>("select name from relay_guest_links order by name"),
    ).pipe(Effect.map((result) => result.rows.map((row) => row.name)));
    return { links, names };
  });

const HOUR = "1970-01-01T01:00:00.000Z";
const link = (credential: string, expiresAt = HOUR) => ({
  environmentId: "environment-1",
  host: "owner.example.org",
  credential,
  expiresAt,
});
const nameOf = (...indexes: ReadonlyArray<number>) =>
  indexes.map((index) => GUEST_LINK_WORDS[index]).join("-");

describe("GuestLinks", () => {
  it.effect("keeps a credential's name when it is registered again", () =>
    Effect.gen(function* () {
      const { links, names } = yield* setup();
      const name = yield* links.register(link("invite-1"));
      expect(yield* links.register(link("invite-1", "1970-01-01T02:00:00.000Z"))).toBe(name);
      expect(name).toMatch(RELAY_GUEST_LINK_NAME_PATTERN);
      expect(yield* names).toEqual([name]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves a name until it expires, then prunes it on the next register", () =>
    Effect.gen(function* () {
      const { links, names } = yield* setup();
      const name = yield* links.register(link("invite-1"));
      expect(yield* links.resolve(name)).toEqual({
        host: "owner.example.org",
        credential: "invite-1",
      });

      yield* TestClock.adjust("2 hours");
      expect(yield* links.resolve(name)).toBeNull();

      const later = yield* links.register(link("invite-2", "1970-01-01T03:00:00.000Z"));
      expect(yield* names).toEqual([later]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("resolves an unknown or malformed name to null", () =>
    Effect.gen(function* () {
      const { links } = yield* setup();
      yield* links.register(link("invite-1"));
      expect(yield* links.resolve(nameOf(824, 824, 824))).toBeNull();
      expect(yield* links.resolve("Not a name")).toBeNull();
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("draws another name when the first is taken", () =>
    Effect.gen(function* () {
      // 65535 is past the largest multiple of the word count, so that pick is drawn again.
      const { links } = yield* setup([0, 0, 0, 0, 0, 0, 65_535, 0, 0, 1]);
      expect(yield* links.register(link("invite-1"))).toBe(nameOf(0, 0, 0));
      expect(yield* links.register(link("invite-2"))).toBe(nameOf(0, 0, 1));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("fails after five taken names", () =>
    Effect.gen(function* () {
      // One name for the first link, then the same name on all five tries for the second.
      const { links, names } = yield* setup(Array.from({ length: 3 + 5 * 3 }, () => 0));
      yield* links.register(link("invite-1"));
      const error = yield* Effect.flip(links.register(link("invite-2")));
      expect(error).toMatchObject({ _tag: "GuestLinkPersistenceError", operation: "register" });
      expect(yield* names).toEqual([nameOf(0, 0, 0)]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it("gives every word a shape the name pattern accepts", () => {
    for (const word of GUEST_LINK_WORDS) {
      expect(`${word}-${word}-${word}`).toMatch(RELAY_GUEST_LINK_NAME_PATTERN);
    }
  });
});
