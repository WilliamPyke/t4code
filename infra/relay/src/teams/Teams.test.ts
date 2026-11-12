import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg/PgClient";
import { PGlite } from "@electric-sql/pglite";
import {
  RELAY_GUEST_LINK_NAME_PATTERN,
  RELAY_TEAM_MAX_MEMBERS,
  RELAY_TEAM_MAX_PER_USER,
} from "@t3tools/contracts/relay";
import { ThreadId } from "@t3tools/contracts";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as RelayDb from "../db.ts";
import * as Teams from "./Teams.ts";

const MIGRATION = "20261112120000_teams";

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
  // Each draw starts with its own count, so ids and names never repeat.
  let draws = 0;
  const draw = (size: number) => {
    const count = draws++;
    return Uint8Array.from({ length: size }, (_, index) => (count >> (8 * index)) & 255);
  };
  return yield* Teams.Teams.pipe(
    Effect.provide(
      Teams.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(RelayDb.RelayDb, db as RelayDb.RelayDb["Service"]),
            Layer.succeed(SecureRandom.SecureRandom, SecureRandom.make(draw)),
          ),
        ),
      ),
    ),
  );
});

const profile = (name: string) => ({ name, avatarUrl: `https://img.example/${name}.png` });
const HOUR = "1970-01-01T01:00:00.000Z";
const share = (teamId: string, threadId = "thread-1", expiresAt = HOUR) => ({
  teamId,
  threadId: ThreadId.make(threadId),
  shareId: `share-${threadId}`,
  title: "Fix the build",
  host: "owner.example.org",
  credential: `invite-${threadId}`,
  expiresAt,
});

/** Ann owns a team that Ben joined through an invite. */
const withTeam = Effect.gen(function* () {
  const teams = yield* setup;
  const team = yield* teams.create({ userId: "ann", name: "Core", profile: profile("Ann") });
  const invite = yield* teams.createInvite({ userId: "ann", teamId: team.id });
  yield* teams.acceptInvite({ userId: "ben", name: invite.name, profile: profile("Ben") });
  return { teams, team, invite };
});

const refusal = (reason: Teams.TeamRequestError["reason"]) => ({
  _tag: "TeamRequestError",
  reason,
});

describe("Teams", () => {
  it.effect("lets an invited user join and see members with their account's name", () =>
    Effect.gen(function* () {
      const { teams, team, invite } = yield* withTeam;
      expect(invite.name).toMatch(RELAY_GUEST_LINK_NAME_PATTERN);
      const read = yield* teams.get({ userId: "ben", teamId: team.id });
      expect(read.role).toBe("member");
      expect(read.members).toEqual([
        { userId: "ann", name: "Ann", avatarUrl: "https://img.example/Ann.png", role: "owner" },
        { userId: "ben", name: "Ben", avatarUrl: "https://img.example/Ben.png", role: "member" },
      ]);
      expect(yield* teams.list("ben")).toEqual([
        { id: team.id, name: "Core", role: "member", memberCount: 2 },
      ]);
      // Accepting again changes nothing.
      yield* teams.acceptInvite({ userId: "ben", name: invite.name, profile: profile("Ben") });
      expect((yield* teams.get({ userId: "ann", teamId: team.id })).members).toHaveLength(2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("refuses an expired or unknown invite and hands out a live one again", () =>
    Effect.gen(function* () {
      const { teams, team, invite } = yield* withTeam;
      expect(yield* teams.createInvite({ userId: "ben", teamId: team.id })).toEqual(invite);
      yield* TestClock.adjust("7 days");
      expect(
        yield* Effect.flip(
          teams.acceptInvite({ userId: "cat", name: invite.name, profile: profile("Cat") }),
        ),
      ).toMatchObject(refusal("invite_invalid"));
      expect(
        yield* Effect.flip(
          teams.acceptInvite({ userId: "cat", name: "Not a name", profile: profile("Cat") }),
        ),
      ).toMatchObject(refusal("invite_invalid"));
      expect((yield* teams.createInvite({ userId: "ann", teamId: team.id })).name).not.toBe(
        invite.name,
      );
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("hides a team from non-members and keeps owner actions to the owner", () =>
    Effect.gen(function* () {
      const { teams, team } = yield* withTeam;
      expect(yield* Effect.flip(teams.get({ userId: "eve", teamId: team.id }))).toMatchObject(
        refusal("not_found"),
      );
      expect(
        yield* Effect.flip(teams.createInvite({ userId: "eve", teamId: team.id })),
      ).toMatchObject(refusal("not_found"));
      expect(
        yield* Effect.flip(teams.rename({ userId: "ben", teamId: team.id, name: "Mine" })),
      ).toMatchObject(refusal("not_owner"));
      expect(
        yield* Effect.flip(
          teams.removeMember({ userId: "ben", teamId: team.id, memberUserId: "ann" }),
        ),
      ).toMatchObject(refusal("not_owner"));
      expect(yield* Effect.flip(teams.leave({ userId: "ann", teamId: team.id }))).toMatchObject(
        refusal("owner_cannot_leave"),
      );
      yield* teams.rename({ userId: "ann", teamId: team.id, name: "Platform" });
      expect((yield* teams.get({ userId: "ben", teamId: team.id })).name).toBe("Platform");
      yield* teams.remove({ userId: "ann", teamId: team.id });
      expect(yield* teams.list("ben")).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("lists a thread only from a machine linked to a member, until it expires", () =>
    Effect.gen(function* () {
      const { teams, team } = yield* withTeam;
      expect(
        yield* Effect.flip(
          teams.registerThread({
            environmentId: "env-eve",
            linkedUserIds: ["eve"],
            request: share(team.id),
          }),
        ),
      ).toMatchObject(refusal("not_found"));
      expect(
        yield* teams.registerThread({
          environmentId: "env-ben",
          linkedUserIds: ["eve", "ben"],
          request: share(team.id),
        }),
      ).toEqual({ teamName: "Core" });
      const [thread] = (yield* teams.get({ userId: "ann", teamId: team.id })).threads;
      expect(thread).toMatchObject({
        environmentId: "env-ben",
        ownerUserId: "ben",
        title: "Fix the build",
      });

      expect(
        yield* teams.memberForAssertion({
          userId: "ann",
          teamId: team.id,
          environmentId: "env-ben",
          profile: { name: "Ann Lee", avatarUrl: null },
        }),
      ).toEqual({ name: "Ann Lee", avatarUrl: null });
      expect(
        yield* Effect.flip(
          teams.memberForAssertion({
            userId: "eve",
            teamId: team.id,
            environmentId: "env-ben",
            profile: null,
          }),
        ),
      ).toMatchObject(refusal("not_found"));

      yield* TestClock.adjust("2 hours");
      expect((yield* teams.get({ userId: "ann", teamId: team.id })).threads).toEqual([]);
      expect(
        yield* Effect.flip(
          teams.memberForAssertion({
            userId: "ann",
            teamId: team.id,
            environmentId: "env-ben",
            profile: null,
          }),
        ),
      ).toMatchObject(refusal("not_shared"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("drops a member's threads when they leave or are removed, and on unregister", () =>
    Effect.gen(function* () {
      const { teams, team, invite } = yield* withTeam;
      const register = (userId: string, threadId: string) =>
        teams.registerThread({
          environmentId: `env-${userId}`,
          linkedUserIds: [userId],
          request: share(team.id, threadId),
        });
      yield* teams.acceptInvite({ userId: "cat", name: invite.name, profile: profile("Cat") });
      yield* register("ann", "a");
      yield* register("ben", "b");
      yield* register("cat", "c");
      const threadIds = Effect.map(teams.get({ userId: "ann", teamId: team.id }), (read) =>
        read.threads.map((thread) => thread.threadId).toSorted(),
      );
      expect(yield* threadIds).toEqual(["a", "b", "c"]);
      yield* teams.leave({ userId: "ben", teamId: team.id });
      yield* teams.removeMember({ userId: "ann", teamId: team.id, memberUserId: "cat" });
      expect(yield* threadIds).toEqual(["a"]);
      expect(yield* Effect.flip(teams.get({ userId: "cat", teamId: team.id }))).toMatchObject(
        refusal("not_found"),
      );
      yield* teams.unregisterThread({ environmentId: "env-ann", threadId: "a" });
      expect(yield* threadIds).toEqual([]);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("caps members per team and teams per user", () =>
    Effect.gen(function* () {
      const teams = yield* setup;
      const team = yield* teams.create({ userId: "u0", name: "Big", profile: profile("U0") });
      const invite = yield* teams.createInvite({ userId: "u0", teamId: team.id });
      for (let index = 1; index < RELAY_TEAM_MAX_MEMBERS; index++) {
        yield* teams.acceptInvite({
          userId: `u${index}`,
          name: invite.name,
          profile: profile("U"),
        });
      }
      expect(
        yield* Effect.flip(
          teams.acceptInvite({ userId: "late", name: invite.name, profile: profile("L") }),
        ),
      ).toMatchObject(refusal("team_full"));

      for (let index = 1; index < RELAY_TEAM_MAX_PER_USER; index++) {
        yield* teams.create({ userId: "u0", name: `Team ${index}`, profile: profile("U0") });
      }
      expect(
        yield* Effect.flip(
          teams.create({ userId: "u0", name: "One more", profile: profile("U0") }),
        ),
      ).toMatchObject(refusal("too_many_teams"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
