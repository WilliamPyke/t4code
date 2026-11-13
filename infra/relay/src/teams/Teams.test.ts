import { describe, expect, it } from "@effect/vitest";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { PgClient } from "@effect/sql-pg/PgClient";
import { PGlite } from "@electric-sql/pglite";
import {
  RELAY_GUEST_LINK_NAME_PATTERN,
  RELAY_TEAM_MAX_MEMBERS,
  RELAY_TEAM_MAX_PER_USER,
  teamBoardThreadCard,
} from "@t3tools/contracts/relay";
import {
  GuestId,
  ROOM_BOARD_MAX_NOTES,
  ThreadId,
  roomBoardGuestCard,
  type RoomBoardChange,
} from "@t3tools/contracts";
import * as PgDrizzle from "drizzle-orm/effect-postgres";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as TestClock from "effect/testing/TestClock";

import * as RelayDb from "../db.ts";
import * as Teams from "./Teams.ts";

const MIGRATIONS = [
  "20261112120000_teams",
  "20261112180000_team_boards",
  "20261112200000_team_board_names",
];

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
  for (const name of MIGRATIONS) {
    const migration = yield* fs.readFileString(
      yield* path.fromFileUrl(
        new URL(`../../migrations/postgres/${name}/migration.sql`, import.meta.url),
      ),
    );
    yield* Effect.promise(() => pg.exec(migration));
  }
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

type NotePut = Extract<RoomBoardChange, { type: "note.put" }>;
const note = (noteId: string, fields: Partial<NotePut> = {}): RoomBoardChange => ({
  type: "note.put",
  noteId,
  text: "Hi",
  x: 0,
  y: 0,
  ...fields,
});
const move = (cardId: string): RoomBoardChange => ({ type: "card.move", cardId, x: 10, y: 20 });

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

  it.effect(
    "renames a listed thread, hides a machine's threads while guest links are off, and drops them when it is unlinked",
    () =>
      Effect.gen(function* () {
        const { teams, team } = yield* withTeam;
        const register = (userId: string, threadId: string) =>
          teams.registerThread({
            environmentId: "env-shared",
            linkedUserIds: [userId],
            request: share(team.id, threadId),
          });
        yield* register("ann", "a");
        yield* register("ben", "b");
        const listed = Effect.map(teams.get({ userId: "ann", teamId: team.id }), (read) =>
          read.threads.map((thread) => `${thread.threadId}: ${thread.title}`).toSorted(),
        );
        yield* teams.renameThread({ environmentId: "env-shared", threadId: "a", title: "Ship it" });
        expect(yield* listed).toEqual(["a: Ship it", "b: Fix the build"]);
        yield* teams.setThreadsListed({ environmentId: "env-shared", listed: false });
        expect(yield* listed).toEqual([]);
        yield* teams.setThreadsListed({ environmentId: "env-shared", listed: true });
        expect(yield* listed).toHaveLength(2);
        yield* teams.unlistEnvironment({ userId: "ann", environmentId: "env-shared" });
        expect(yield* listed).toEqual(["b: Fix the build"]);
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps one board for members, answers not modified, and lands concurrent changes", () =>
    Effect.gen(function* () {
      const { teams, team } = yield* withTeam;
      expect(yield* teams.board({ userId: "ann", teamId: team.id, since: undefined })).toEqual({
        version: 0,
        board: { positions: {}, notes: [] },
        names: {},
      });
      expect(
        yield* Effect.flip(teams.board({ userId: "eve", teamId: team.id, since: undefined })),
      ).toMatchObject(refusal("not_found"));
      expect(
        yield* Effect.flip(
          teams.changeBoard({ userId: "eve", teamId: team.id, change: note("x") }),
        ),
      ).toMatchObject(refusal("not_found"));

      yield* Effect.all(
        [
          teams.changeBoard({ userId: "ann", teamId: team.id, change: note("from-ann") }),
          teams.changeBoard({ userId: "ben", teamId: team.id, change: note("from-ben") }),
        ],
        { concurrency: "unbounded" },
      );
      const read = yield* teams.board({ userId: "ben", teamId: team.id, since: 0 });
      expect(read.version).toBe(2);
      expect(
        read.board?.notes.map((added) => `${added.id} by ${added.guestId}`).toSorted(),
      ).toEqual(["from-ann by ann", "from-ben by ben"]);
      expect(yield* teams.board({ userId: "ben", teamId: team.id, since: 2 })).toEqual({
        version: 2,
        board: null,
      });
      // A change that changes nothing is not a new version.
      expect(
        (yield* teams.changeBoard({
          userId: "ann",
          teamId: team.id,
          change: { type: "note.remove", noteId: "gone" },
        })).version,
      ).toBe(2);
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("keeps a note's author's name on the board after they leave the team", () =>
    Effect.gen(function* () {
      const { teams, team, invite } = yield* withTeam;
      yield* teams.acceptInvite({ userId: "cat", name: invite.name, profile: profile("Cat") });
      yield* teams.changeBoard({ userId: "ben", teamId: team.id, change: note("from-ben") });
      yield* teams.changeBoard({
        userId: "ann",
        teamId: team.id,
        change: note("for-cat", { kind: "task", assignee: { guestId: GuestId.make("cat") } }),
      });
      yield* teams.leave({ userId: "ben", teamId: team.id });
      yield* teams.removeMember({ userId: "ann", teamId: team.id, memberUserId: "cat" });
      const changed = yield* teams.changeBoard({
        userId: "ann",
        teamId: team.id,
        change: note("from-ann"),
      });
      const expected = { ann: "Ann", ben: "Ben", cat: "Cat" };
      expect(changed.names).toEqual(expected);
      expect((yield* teams.board({ userId: "ann", teamId: team.id, since: 0 })).names).toEqual(
        expected,
      );
      // A name goes once no note names that person.
      yield* teams.changeBoard({
        userId: "ann",
        teamId: team.id,
        change: { type: "note.remove", noteId: "from-ben" },
      });
      expect((yield* teams.board({ userId: "ann", teamId: team.id, since: 0 })).names).toEqual({
        ann: "Ann",
        cat: "Cat",
      });
    }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect(
    "tells a machine who is in a team only while it lists a live thread there as a member",
    () =>
      Effect.gen(function* () {
        const { teams, team } = yield* withTeam;
        const memberIds = (environmentId: string, linkedUserIds: ReadonlyArray<string>) =>
          teams.memberIdsForEnvironment({ environmentId, teamId: team.id, linkedUserIds });
        expect(yield* Effect.flip(memberIds("env-ben", ["ben"]))).toMatchObject(
          refusal("not_found"),
        );
        yield* teams.registerThread({
          environmentId: "env-ben",
          linkedUserIds: ["ben"],
          request: share(team.id),
        });
        expect((yield* memberIds("env-ben", ["eve", "ben"])).toSorted()).toEqual(["ann", "ben"]);
        // Another machine, or this one as an account that did not list the thread.
        for (const [environmentId, linked] of [
          ["env-eve", ["ben"]],
          ["env-ben", ["ann"]],
          ["env-ben", []],
        ] as const) {
          expect(yield* Effect.flip(memberIds(environmentId, linked))).toMatchObject(
            refusal("not_found"),
          );
        }
        yield* TestClock.adjust("2 hours");
        expect(yield* Effect.flip(memberIds("env-ben", ["ben"]))).toMatchObject(
          refusal("not_found"),
        );
      }).pipe(Effect.provide(NodeServices.layer)),
  );

  it.effect("takes only the team's cards and members on its board, and caps its notes", () =>
    Effect.gen(function* () {
      const { teams, team } = yield* withTeam;
      const change = (userId: string, boardChange: RoomBoardChange) =>
        teams.changeBoard({ userId, teamId: team.id, change: boardChange });
      const refused = (userId: string, boardChange: RoomBoardChange) =>
        Effect.flip(change(userId, boardChange));
      const threadCard = teamBoardThreadCard("env-ben", "thread-1");

      yield* change("ann", move(roomBoardGuestCard("ben")));
      expect(yield* refused("ann", move(roomBoardGuestCard("eve")))).toMatchObject(
        refusal("board_rejected"),
      );
      expect(yield* refused("ann", move(threadCard))).toMatchObject(refusal("board_rejected"));
      yield* teams.registerThread({
        environmentId: "env-ben",
        linkedUserIds: ["ben"],
        request: share(team.id),
      });
      yield* change("ann", move(threadCard));

      yield* change(
        "ann",
        note("task", { kind: "task", assignee: { guestId: GuestId.make("ben") } }),
      );
      for (const assignee of [{ guestId: GuestId.make("eve") }, {}]) {
        expect(yield* refused("ann", note("other", { kind: "task", assignee }))).toMatchObject(
          refusal("board_rejected"),
        );
      }
      for (const fields of [
        { pinnedTo: "message-1" },
        { kind: "artifact" as const },
        { kind: "thread" as const },
        { kind: "comment" as const },
      ]) {
        expect(yield* refused("ann", note("other", fields))).toMatchObject(
          refusal("board_rejected"),
        );
      }
      expect(yield* refused("ann", { type: "artifact.restore", noteId: "task" })).toMatchObject(
        refusal("board_rejected"),
      );
      // Cards and notes take sizes here as on a room's board.
      const sized = yield* change("ann", {
        type: "card.resize",
        cardId: roomBoardGuestCard("ben"),
        w: 320,
        h: 240,
      });
      expect(sized.board?.sizes).toEqual({ [roomBoardGuestCard("ben")]: { w: 320, h: 240 } });
      yield* change("ann", note("task", { size: { w: 200, h: 160 } }));

      for (let index = 1; index < ROOM_BOARD_MAX_NOTES; index++) {
        yield* change("ben", note(`note-${index}`));
      }
      expect(yield* refused("ben", note("one-more"))).toMatchObject(refusal("board_full"));
    }).pipe(Effect.provide(NodeServices.layer)),
  );
});
