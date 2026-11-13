import {
  RELAY_GUEST_LINK_NAME_PATTERN,
  RELAY_TEAM_INVITE_TTL_MS,
  RELAY_TEAM_MAX_MEMBERS,
  RELAY_TEAM_MAX_PER_USER,
  RELAY_TEAM_MAX_THREADS,
  RelayTeamRequestErrorReason,
  teamBoardThreadCard,
  type RelayTeam,
  type RelayTeamBoardChangeResponse,
  type RelayTeamBoardResponse,
  type RelayTeamInviteResponse,
  type RelayTeamSummary,
  type RelayTeamThread,
  type RelayTeamThreadRegistrationRequest,
} from "@t3tools/contracts/relay";
import {
  EnvironmentId,
  GuestId,
  ThreadId,
  roomBoardGuestCard,
  type RoomBoard,
  type RoomBoardChange,
} from "@t3tools/contracts";
import {
  EMPTY_ROOM_BOARD,
  ROOM_BOARD_FULL,
  applyRoomBoardChange,
  roomBoardWithCards,
  type RoomBoardScope,
} from "@t3tools/shared/roomBoard";
import { and, asc, desc, eq, gt, inArray, lt, ne, or, sql } from "drizzle-orm";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Base64Url from "effect/encoding/Base64Url";
import * as Layer from "effect/Layer";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import * as RelayDb from "../db.ts";
import { threeWordName } from "../guestLinks/GuestLinks.ts";
import {
  relayTeamBoards,
  relayTeamInvites,
  relayTeamMembers,
  relayTeams,
  relayTeamThreads,
} from "../persistence/schema.ts";

/** Per signed-in user: creating teams, making invites, and guessing invite names are counted. */
export const TEAM_RATE_LIMIT = { limit: 20, periodSeconds: 60 } as const;
/** Per signed-in user: changes to team boards. A drag or an edit sends one when it ends. */
export const TEAM_BOARD_RATE_LIMIT = { limit: 120, periodSeconds: 60 } as const;
/** Per signed-in user: board reads. An open board reads 30 a minute; this allows several tabs. */
export const TEAM_BOARD_READ_RATE_LIMIT = { limit: 300, periodSeconds: 60 } as const;

const NAME_ATTEMPTS = 5;
const TEAM_ID_BYTES = 16;
const PROFILE_NAME_MAX_LENGTH = 120;
// Each attempt reads the newest board, so this many writers can land on it at once.
const BOARD_WRITE_ATTEMPTS = 8;
// An invite with less than this left is replaced rather than handed out again.
const INVITE_REUSE_MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

export interface TeamProfile {
  readonly name: string;
  readonly avatarUrl: string | null;
}

/** A request the caller may not make, said in words they can act on. */
export class TeamRequestError extends Schema.TaggedError<TeamRequestError>()("TeamRequestError", {
  reason: RelayTeamRequestErrorReason,
}) {
  override get message(): string {
    return `Team request refused: ${this.reason}`;
  }
}

export class TeamPersistenceError extends Schema.TaggedError<TeamPersistenceError>()(
  "TeamPersistenceError",
  { operation: Schema.String, cause: Schema.Defect() },
) {
  override get message(): string {
    return `Failed to ${this.operation} a team`;
  }
}

const isTeamRequestError = Schema.is(TeamRequestError);

type TeamError = TeamRequestError | TeamPersistenceError;

/** Per signed-in user. */
export class TeamRateLimiter extends Context.Service<
  TeamRateLimiter,
  { readonly allow: (key: string) => Effect.Effect<boolean> }
>()("t3code-relay/teams/Teams/TeamRateLimiter") {}

/** Per signed-in user. */
export class TeamBoardRateLimiter extends Context.Service<
  TeamBoardRateLimiter,
  { readonly allow: (key: string) => Effect.Effect<boolean> }
>()("t3code-relay/teams/Teams/TeamBoardRateLimiter") {}

/** Per signed-in user. */
export class TeamBoardReadRateLimiter extends Context.Service<
  TeamBoardReadRateLimiter,
  { readonly allow: (key: string) => Effect.Effect<boolean> }
>()("t3code-relay/teams/Teams/TeamBoardReadRateLimiter") {}

export class Teams extends Context.Service<
  Teams,
  {
    readonly list: (
      userId: string,
    ) => Effect.Effect<ReadonlyArray<RelayTeamSummary>, TeamPersistenceError>;
    readonly create: (input: {
      readonly userId: string;
      readonly name: string;
      readonly profile: TeamProfile;
    }) => Effect.Effect<RelayTeamSummary, TeamError>;
    /** Members only: anyone else is told the team does not exist. */
    readonly get: (input: {
      readonly userId: string;
      readonly teamId: string;
    }) => Effect.Effect<RelayTeam, TeamError>;
    readonly rename: (input: {
      readonly userId: string;
      readonly teamId: string;
      readonly name: string;
    }) => Effect.Effect<void, TeamError>;
    readonly remove: (input: {
      readonly userId: string;
      readonly teamId: string;
    }) => Effect.Effect<void, TeamError>;
    /** Also stops listing the threads the member shared to the team. */
    readonly leave: (input: {
      readonly userId: string;
      readonly teamId: string;
    }) => Effect.Effect<void, TeamError>;
    readonly removeMember: (input: {
      readonly userId: string;
      readonly teamId: string;
      readonly memberUserId: string;
    }) => Effect.Effect<void, TeamError>;
    /** Hands out the team's current invite while it has a day left, else makes one. */
    readonly createInvite: (input: {
      readonly userId: string;
      readonly teamId: string;
    }) => Effect.Effect<RelayTeamInviteResponse, TeamError>;
    readonly acceptInvite: (input: {
      readonly userId: string;
      readonly name: string;
      readonly profile: TeamProfile;
    }) => Effect.Effect<string, TeamError>;
    /**
     * Who the member is, for an assertion to a machine that shares a live thread to the team.
     * A fresh profile replaces the stored one first.
     */
    readonly memberForAssertion: (input: {
      readonly userId: string;
      readonly teamId: string;
      readonly environmentId: string;
      readonly profile: TeamProfile | null;
    }) => Effect.Effect<TeamProfile, TeamError>;
    /**
     * Lists a machine's thread on a team. `linkedUserIds` are the accounts the machine is linked
     * to; one of them must be in the team, and is recorded as the thread's owner.
     */
    readonly registerThread: (input: {
      readonly environmentId: string;
      readonly linkedUserIds: ReadonlyArray<string>;
      readonly request: RelayTeamThreadRegistrationRequest;
    }) => Effect.Effect<{ readonly teamName: string }, TeamError>;
    readonly unregisterThread: (input: {
      readonly environmentId: string;
      readonly threadId: string;
    }) => Effect.Effect<void, TeamPersistenceError>;
    readonly renameThread: (input: {
      readonly environmentId: string;
      readonly threadId: string;
      readonly title: string;
    }) => Effect.Effect<void, TeamPersistenceError>;
    /** Hides every thread a machine lists while it has guest links off, and shows them again. */
    readonly setThreadsListed: (input: {
      readonly environmentId: string;
      readonly listed: boolean;
    }) => Effect.Effect<void, TeamPersistenceError>;
    /**
     * Who is in the team now, for a machine that lists a live thread on it as one of the accounts
     * it is linked to, who is still a member. Anyone else is told the team does not exist.
     */
    readonly memberIdsForEnvironment: (input: {
      readonly environmentId: string;
      readonly teamId: string;
      readonly linkedUserIds: ReadonlyArray<string>;
    }) => Effect.Effect<ReadonlyArray<string>, TeamError>;
    /** The account unlinked the machine, so the threads it listed as that account are gone. */
    readonly unlistEnvironment: (input: {
      readonly userId: string;
      readonly environmentId: string;
    }) => Effect.Effect<void, TeamPersistenceError>;
    /** Members only. The board is null when it has not changed since `since`. */
    readonly board: (input: {
      readonly userId: string;
      readonly teamId: string;
      readonly since: number | undefined;
    }) => Effect.Effect<RelayTeamBoardResponse, TeamError>;
    /** Members only. A change that crosses another member's lands after it. */
    readonly changeBoard: (input: {
      readonly userId: string;
      readonly teamId: string;
      readonly change: RoomBoardChange;
    }) => Effect.Effect<RelayTeamBoardChangeResponse, TeamError>;
  }
>()("t3code-relay/teams/Teams") {}

const make = Effect.gen(function* () {
  const db = yield* RelayDb.RelayDb;
  const random = yield* SecureRandom.SecureRandom;

  const nowIso = Effect.map(DateTime.now, DateTime.formatIso);
  const refuse = (reason: TeamRequestError["reason"]) => new TeamRequestError({ reason });
  const persistence = (operation: string) =>
    Effect.mapError((cause: unknown): TeamError =>
      isTeamRequestError(cause) ? cause : new TeamPersistenceError({ operation, cause }),
    );

  const membership = (teamId: string, userId: string) =>
    db
      .select({ id: relayTeams.id, name: relayTeams.name, ownerUserId: relayTeams.ownerUserId })
      .from(relayTeams)
      .innerJoin(relayTeamMembers, eq(relayTeamMembers.teamId, relayTeams.id))
      .where(and(eq(relayTeams.id, teamId), eq(relayTeamMembers.userId, userId)))
      .limit(1)
      .pipe(Effect.map(([row]) => row ?? null));

  const requireMember = Effect.fnUntraced(function* (teamId: string, userId: string) {
    const team = yield* membership(teamId, userId);
    if (team === null) return yield* refuse("not_found");
    return team;
  });
  const requireOwner = Effect.fnUntraced(function* (teamId: string, userId: string) {
    const team = yield* requireMember(teamId, userId);
    if (team.ownerUserId !== userId) return yield* refuse("not_owner");
    return team;
  });

  const countTeamsOf = (userId: string) =>
    db
      .select({ count: sql<number>`count(*)` })
      .from(relayTeamMembers)
      .where(eq(relayTeamMembers.userId, userId))
      .pipe(Effect.map(([row]) => Number(row?.count ?? 0)));
  const countMembersOf = (teamId: string) =>
    db
      .select({ count: sql<number>`count(*)` })
      .from(relayTeamMembers)
      .where(eq(relayTeamMembers.teamId, teamId))
      .pipe(Effect.map(([row]) => Number(row?.count ?? 0)));

  const storedProfile = (profile: TeamProfile) => ({
    name: profile.name.slice(0, PROFILE_NAME_MAX_LENGTH),
    avatarUrl: profile.avatarUrl,
  });
  const refreshProfile = (userId: string, profile: TeamProfile) =>
    db
      .update(relayTeamMembers)
      .set(storedProfile(profile))
      .where(eq(relayTeamMembers.userId, userId));

  const list: Teams["Service"]["list"] = Effect.fn("relay.teams.list")(
    function* (userId) {
      const teams = yield* db
        .select({ id: relayTeams.id, name: relayTeams.name, ownerUserId: relayTeams.ownerUserId })
        .from(relayTeams)
        .innerJoin(relayTeamMembers, eq(relayTeamMembers.teamId, relayTeams.id))
        .where(eq(relayTeamMembers.userId, userId))
        .orderBy(asc(relayTeams.name));
      if (teams.length === 0) return [];
      const counts = yield* db
        .select({ teamId: relayTeamMembers.teamId, count: sql<number>`count(*)` })
        .from(relayTeamMembers)
        .where(
          inArray(
            relayTeamMembers.teamId,
            teams.map((team) => team.id),
          ),
        )
        .groupBy(relayTeamMembers.teamId);
      const countOf = new Map(counts.map((row) => [row.teamId, Number(row.count)]));
      return teams.map((team): RelayTeamSummary => ({
        id: team.id,
        name: team.name,
        role: team.ownerUserId === userId ? "owner" : "member",
        memberCount: countOf.get(team.id) ?? 0,
      }));
    },
    Effect.mapError((cause) => new TeamPersistenceError({ operation: "list", cause })),
  );

  const create: Teams["Service"]["create"] = Effect.fn("relay.teams.create")(function* (input) {
    if ((yield* countTeamsOf(input.userId)) >= RELAY_TEAM_MAX_PER_USER) {
      return yield* refuse("too_many_teams");
    }
    const id = Base64Url.encode(yield* random.randomBytes(TEAM_ID_BYTES));
    const now = yield* nowIso;
    yield* db
      .insert(relayTeams)
      .values({ id, name: input.name, ownerUserId: input.userId, createdAt: now });
    yield* db.insert(relayTeamMembers).values({
      teamId: id,
      userId: input.userId,
      ...storedProfile(input.profile),
      joinedAt: now,
    });
    return { id, name: input.name, role: "owner" as const, memberCount: 1 };
  }, persistence("create"));

  const get: Teams["Service"]["get"] = Effect.fn("relay.teams.get")(function* (input) {
    const team = yield* requireMember(input.teamId, input.userId);
    const members = yield* db
      .select({
        userId: relayTeamMembers.userId,
        name: relayTeamMembers.name,
        avatarUrl: relayTeamMembers.avatarUrl,
      })
      .from(relayTeamMembers)
      .where(eq(relayTeamMembers.teamId, team.id))
      .orderBy(asc(relayTeamMembers.joinedAt));
    const threads = yield* db
      .select({
        environmentId: relayTeamThreads.environmentId,
        threadId: relayTeamThreads.threadId,
        shareId: relayTeamThreads.shareId,
        title: relayTeamThreads.title,
        host: relayTeamThreads.host,
        credential: relayTeamThreads.credential,
        ownerUserId: relayTeamThreads.ownerUserId,
        expiresAt: relayTeamThreads.expiresAt,
      })
      .from(relayTeamThreads)
      .where(
        and(
          eq(relayTeamThreads.teamId, team.id),
          gt(relayTeamThreads.expiresAt, yield* nowIso),
          eq(relayTeamThreads.hidden, false),
        ),
      )
      .orderBy(desc(relayTeamThreads.updatedAt));
    return {
      id: team.id,
      name: team.name,
      role: team.ownerUserId === input.userId ? ("owner" as const) : ("member" as const),
      memberCount: members.length,
      members: members.map((member) => ({
        ...member,
        role: member.userId === team.ownerUserId ? ("owner" as const) : ("member" as const),
      })),
      threads: threads.map((thread): RelayTeamThread => ({
        ...thread,
        environmentId: EnvironmentId.make(thread.environmentId),
        threadId: ThreadId.make(thread.threadId),
      })),
    };
  }, persistence("read"));

  const rename: Teams["Service"]["rename"] = Effect.fn("relay.teams.rename")(function* (input) {
    yield* requireOwner(input.teamId, input.userId);
    yield* db.update(relayTeams).set({ name: input.name }).where(eq(relayTeams.id, input.teamId));
  }, persistence("rename"));

  const remove: Teams["Service"]["remove"] = Effect.fn("relay.teams.remove")(function* (input) {
    yield* requireOwner(input.teamId, input.userId);
    yield* db.delete(relayTeams).where(eq(relayTeams.id, input.teamId));
  }, persistence("delete"));

  const dropMember = (teamId: string, userId: string) =>
    Effect.all([
      db
        .delete(relayTeamMembers)
        .where(and(eq(relayTeamMembers.teamId, teamId), eq(relayTeamMembers.userId, userId)))
        .returning({ userId: relayTeamMembers.userId }),
      db
        .delete(relayTeamThreads)
        .where(and(eq(relayTeamThreads.teamId, teamId), eq(relayTeamThreads.ownerUserId, userId))),
    ]).pipe(Effect.map(([removed]) => removed.length > 0));

  const leave: Teams["Service"]["leave"] = Effect.fn("relay.teams.leave")(function* (input) {
    const team = yield* requireMember(input.teamId, input.userId);
    if (team.ownerUserId === input.userId) return yield* refuse("owner_cannot_leave");
    yield* dropMember(team.id, input.userId);
  }, persistence("leave"));

  const removeMember: Teams["Service"]["removeMember"] = Effect.fn("relay.teams.remove_member")(
    function* (input) {
      const team = yield* requireOwner(input.teamId, input.userId);
      if (input.memberUserId === input.userId) return yield* refuse("owner_cannot_leave");
      if (!(yield* dropMember(team.id, input.memberUserId))) return yield* refuse("not_found");
    },
    persistence("remove a member of"),
  );

  const createInvite: Teams["Service"]["createInvite"] = Effect.fn("relay.teams.create_invite")(
    function* (input) {
      const team = yield* requireMember(input.teamId, input.userId);
      const now = yield* DateTime.now;
      yield* db
        .delete(relayTeamInvites)
        .where(lt(relayTeamInvites.expiresAt, DateTime.formatIso(now)));
      const reusableAfter = DateTime.formatIso(
        DateTime.add(now, { milliseconds: INVITE_REUSE_MIN_REMAINING_MS }),
      );
      const [current] = yield* db
        .select({ name: relayTeamInvites.name, expiresAt: relayTeamInvites.expiresAt })
        .from(relayTeamInvites)
        .where(
          and(eq(relayTeamInvites.teamId, team.id), gt(relayTeamInvites.expiresAt, reusableAfter)),
        )
        .orderBy(desc(relayTeamInvites.expiresAt))
        .limit(1);
      if (current) return current;
      const expiresAt = DateTime.formatIso(
        DateTime.add(now, { milliseconds: RELAY_TEAM_INVITE_TTL_MS }),
      );
      for (let attempt = 0; attempt < NAME_ATTEMPTS; attempt++) {
        const [inserted] = yield* db
          .insert(relayTeamInvites)
          .values({
            name: yield* threeWordName(random),
            teamId: team.id,
            createdByUserId: input.userId,
            expiresAt,
            createdAt: DateTime.formatIso(now),
          })
          .onConflictDoNothing()
          .returning({ name: relayTeamInvites.name });
        if (inserted) return { name: inserted.name, expiresAt };
      }
      return yield* new TeamPersistenceError({
        operation: "invite to",
        cause: "no free invite name",
      });
    },
    persistence("invite to"),
  );

  const acceptInvite: Teams["Service"]["acceptInvite"] = Effect.fn("relay.teams.accept_invite")(
    function* (input) {
      if (!RELAY_GUEST_LINK_NAME_PATTERN.test(input.name)) return yield* refuse("invite_invalid");
      const now = yield* nowIso;
      const [invite] = yield* db
        .select({ teamId: relayTeamInvites.teamId })
        .from(relayTeamInvites)
        .where(and(eq(relayTeamInvites.name, input.name), gt(relayTeamInvites.expiresAt, now)))
        .limit(1);
      if (!invite) return yield* refuse("invite_invalid");
      if ((yield* membership(invite.teamId, input.userId)) !== null) {
        yield* refreshProfile(input.userId, input.profile);
        return invite.teamId;
      }
      if ((yield* countMembersOf(invite.teamId)) >= RELAY_TEAM_MAX_MEMBERS) {
        return yield* refuse("team_full");
      }
      if ((yield* countTeamsOf(input.userId)) >= RELAY_TEAM_MAX_PER_USER) {
        return yield* refuse("too_many_teams");
      }
      yield* db
        .insert(relayTeamMembers)
        .values({
          teamId: invite.teamId,
          userId: input.userId,
          ...storedProfile(input.profile),
          joinedAt: now,
        })
        .onConflictDoNothing();
      return invite.teamId;
    },
    persistence("join"),
  );

  const memberForAssertion: Teams["Service"]["memberForAssertion"] = Effect.fn(
    "relay.teams.member_for_assertion",
  )(function* (input) {
    yield* requireMember(input.teamId, input.userId);
    const [shared] = yield* db
      .select({ threadId: relayTeamThreads.threadId })
      .from(relayTeamThreads)
      .where(
        and(
          eq(relayTeamThreads.teamId, input.teamId),
          eq(relayTeamThreads.environmentId, input.environmentId),
          gt(relayTeamThreads.expiresAt, yield* nowIso),
        ),
      )
      .limit(1);
    if (!shared) return yield* refuse("not_shared");
    if (input.profile !== null) yield* refreshProfile(input.userId, input.profile);
    const [member] = yield* db
      .select({ name: relayTeamMembers.name, avatarUrl: relayTeamMembers.avatarUrl })
      .from(relayTeamMembers)
      .where(
        and(eq(relayTeamMembers.teamId, input.teamId), eq(relayTeamMembers.userId, input.userId)),
      )
      .limit(1);
    if (!member) return yield* refuse("not_found");
    return member;
  }, persistence("assert a member of"));

  const registerThread: Teams["Service"]["registerThread"] = Effect.fn(
    "relay.teams.register_thread",
  )(function* (input) {
    const { request } = input;
    const now = yield* nowIso;
    yield* db.delete(relayTeamThreads).where(lt(relayTeamThreads.expiresAt, now));
    if (input.linkedUserIds.length === 0) return yield* refuse("not_found");
    const [owner] = yield* db
      .select({ userId: relayTeamMembers.userId, teamName: relayTeams.name })
      .from(relayTeamMembers)
      .innerJoin(relayTeams, eq(relayTeams.id, relayTeamMembers.teamId))
      .where(
        and(
          eq(relayTeamMembers.teamId, request.teamId),
          inArray(relayTeamMembers.userId, [...input.linkedUserIds]),
        ),
      )
      .orderBy(asc(relayTeamMembers.joinedAt))
      .limit(1);
    if (!owner) return yield* refuse("not_found");
    const [others] = yield* db
      .select({ count: sql<number>`count(*)` })
      .from(relayTeamThreads)
      .where(
        and(
          eq(relayTeamThreads.teamId, request.teamId),
          or(
            ne(relayTeamThreads.environmentId, input.environmentId),
            ne(relayTeamThreads.threadId, request.threadId),
          ),
        ),
      );
    if (Number(others?.count ?? 0) >= RELAY_TEAM_MAX_THREADS) {
      return yield* refuse("too_many_threads");
    }
    const row = {
      teamId: request.teamId,
      shareId: request.shareId,
      title: request.title,
      host: request.host,
      credential: request.credential,
      ownerUserId: owner.userId,
      expiresAt: request.expiresAt,
      updatedAt: now,
      hidden: false,
    };
    yield* db
      .insert(relayTeamThreads)
      .values({ environmentId: input.environmentId, threadId: request.threadId, ...row })
      .onConflictDoUpdate({
        target: [relayTeamThreads.environmentId, relayTeamThreads.threadId],
        set: row,
      });
    return { teamName: owner.teamName };
  }, persistence("share a thread with"));

  const unregisterThread: Teams["Service"]["unregisterThread"] = Effect.fn(
    "relay.teams.unregister_thread",
  )(
    function* (input) {
      yield* db
        .delete(relayTeamThreads)
        .where(
          and(
            eq(relayTeamThreads.environmentId, input.environmentId),
            eq(relayTeamThreads.threadId, input.threadId),
          ),
        );
    },
    Effect.mapError(
      (cause) => new TeamPersistenceError({ operation: "unshare a thread with", cause }),
    ),
  );

  const renameThread: Teams["Service"]["renameThread"] = Effect.fn("relay.teams.rename_thread")(
    function* (input) {
      yield* db
        .update(relayTeamThreads)
        .set({ title: input.title })
        .where(
          and(
            eq(relayTeamThreads.environmentId, input.environmentId),
            eq(relayTeamThreads.threadId, input.threadId),
          ),
        );
    },
    Effect.mapError(
      (cause) => new TeamPersistenceError({ operation: "rename a thread on", cause }),
    ),
  );

  const setThreadsListed: Teams["Service"]["setThreadsListed"] = Effect.fn(
    "relay.teams.set_threads_listed",
  )(
    function* (input) {
      yield* db
        .update(relayTeamThreads)
        .set({ hidden: !input.listed })
        .where(eq(relayTeamThreads.environmentId, input.environmentId));
    },
    Effect.mapError((cause) => new TeamPersistenceError({ operation: "list threads on", cause })),
  );

  const memberIdsForEnvironment: Teams["Service"]["memberIdsForEnvironment"] = Effect.fn(
    "relay.teams.member_ids_for_environment",
  )(function* (input) {
    if (input.linkedUserIds.length === 0) return yield* refuse("not_found");
    const [listed] = yield* db
      .select({ threadId: relayTeamThreads.threadId })
      .from(relayTeamThreads)
      .innerJoin(
        relayTeamMembers,
        and(
          eq(relayTeamMembers.teamId, relayTeamThreads.teamId),
          eq(relayTeamMembers.userId, relayTeamThreads.ownerUserId),
        ),
      )
      .where(
        and(
          eq(relayTeamThreads.teamId, input.teamId),
          eq(relayTeamThreads.environmentId, input.environmentId),
          inArray(relayTeamThreads.ownerUserId, [...input.linkedUserIds]),
          gt(relayTeamThreads.expiresAt, yield* nowIso),
        ),
      )
      .limit(1);
    if (!listed) return yield* refuse("not_found");
    const members = yield* db
      .select({ userId: relayTeamMembers.userId })
      .from(relayTeamMembers)
      .where(eq(relayTeamMembers.teamId, input.teamId));
    return members.map((member) => member.userId);
  }, persistence("list the members of"));

  const unlistEnvironment: Teams["Service"]["unlistEnvironment"] = Effect.fn(
    "relay.teams.unlist_environment",
  )(
    function* (input) {
      yield* db
        .delete(relayTeamThreads)
        .where(
          and(
            eq(relayTeamThreads.environmentId, input.environmentId),
            eq(relayTeamThreads.ownerUserId, input.userId),
          ),
        );
    },
    Effect.mapError((cause) => new TeamPersistenceError({ operation: "unlist threads on", cause })),
  );

  const readBoard = (teamId: string) =>
    db
      .select({
        board: relayTeamBoards.board,
        names: relayTeamBoards.names,
        version: relayTeamBoards.version,
      })
      .from(relayTeamBoards)
      .where(eq(relayTeamBoards.teamId, teamId))
      .limit(1)
      .pipe(Effect.map(([row]) => row ?? null));

  const board: Teams["Service"]["board"] = Effect.fn("relay.teams.board")(function* (input) {
    // One query: an open board asks every few seconds.
    const [row] = yield* db
      .select({
        board: relayTeamBoards.board,
        names: relayTeamBoards.names,
        version: relayTeamBoards.version,
      })
      .from(relayTeamMembers)
      .leftJoin(relayTeamBoards, eq(relayTeamBoards.teamId, relayTeamMembers.teamId))
      .where(
        and(eq(relayTeamMembers.teamId, input.teamId), eq(relayTeamMembers.userId, input.userId)),
      )
      .limit(1);
    if (row === undefined) return yield* refuse("not_found");
    const version = row.version ?? 0;
    if (input.since !== undefined && input.since >= version) return { version, board: null };
    return { version, board: row.board ?? EMPTY_ROOM_BOARD, names: row.names ?? {} };
  }, persistence("read the board of"));

  /** The team's cards: one per member, and one per thread listed on it now. */
  const boardScope = Effect.fnUntraced(function* (teamId: string) {
    const members = yield* db
      .select({ userId: relayTeamMembers.userId, name: relayTeamMembers.name })
      .from(relayTeamMembers)
      .where(eq(relayTeamMembers.teamId, teamId));
    const threads = yield* db
      .select({
        environmentId: relayTeamThreads.environmentId,
        threadId: relayTeamThreads.threadId,
      })
      .from(relayTeamThreads)
      .where(
        and(
          eq(relayTeamThreads.teamId, teamId),
          gt(relayTeamThreads.expiresAt, yield* nowIso),
          eq(relayTeamThreads.hidden, false),
        ),
      );
    const memberNames = new Map(members.map((member) => [member.userId, member.name]));
    const cards = new Set([
      ...members.map((member) => roomBoardGuestCard(member.userId)),
      ...threads.map((thread) => teamBoardThreadCard(thread.environmentId, thread.threadId)),
    ]);
    const scope: RoomBoardScope = {
      hasCard: (cardId) => cards.has(cardId),
      hasPerson: (guestId) => memberNames.has(guestId),
    };
    return { scope, memberNames };
  });

  /** Each person the notes name, under their name now, or the last one known once they left. */
  const boardNames = (
    board: RoomBoard,
    memberNames: ReadonlyMap<string, string>,
    known: Readonly<Record<string, string>>,
  ) => {
    const names: Record<string, string> = {};
    for (const note of board.notes) {
      for (const person of [note.guestId, note.assignee?.guestId, note.answer?.guestId]) {
        if (person === undefined) continue;
        const name = memberNames.get(person) ?? known[person];
        if (name !== undefined) names[person] = name;
      }
    }
    return names;
  };

  const changeBoard: Teams["Service"]["changeBoard"] = Effect.fn("relay.teams.change_board")(
    function* (input) {
      const { change } = input;
      yield* requireMember(input.teamId, input.userId);
      // Comments pin to one thread's replies or sit in a room with an owner to resolve them, no
      // agent runs a thread box or fills an artifact here, and a task here is always for a named
      // member.
      if (
        change.type === "artifact.restore" ||
        (change.type === "note.put" &&
          (change.pinnedTo !== undefined ||
            change.kind === "artifact" ||
            change.kind === "thread" ||
            change.kind === "comment" ||
            (change.assignee !== undefined &&
              change.assignee !== null &&
              change.assignee.guestId === undefined)))
      ) {
        return yield* refuse("board_rejected");
      }
      const { scope, memberNames } = yield* boardScope(input.teamId);
      const author = GuestId.make(input.userId);
      for (let attempt = 0; attempt < BOARD_WRITE_ATTEMPTS; attempt++) {
        const stored = yield* readBoard(input.teamId);
        const version = stored?.version ?? 0;
        const current = roomBoardWithCards(stored?.board ?? EMPTY_ROOM_BOARD, scope.hasCard);
        const applied = applyRoomBoardChange(current, scope, author, change, yield* nowIso);
        if (Result.isFailure(applied)) {
          return yield* refuse(
            applied.failure === ROOM_BOARD_FULL ? "board_full" : "board_rejected",
          );
        }
        const next = applied.success;
        if (next === current) return { version, board: current, names: stored?.names ?? {} };
        const names = boardNames(next, memberNames, stored?.names ?? {});
        const updatedAt = yield* nowIso;
        // Written only over the version it was read at; otherwise read again and apply again.
        const [written] =
          stored === null
            ? yield* db
                .insert(relayTeamBoards)
                .values({ teamId: input.teamId, board: next, names, version: 1, updatedAt })
                .onConflictDoNothing()
                .returning({ version: relayTeamBoards.version })
            : yield* db
                .update(relayTeamBoards)
                .set({ board: next, names, version: version + 1, updatedAt })
                .where(
                  and(
                    eq(relayTeamBoards.teamId, input.teamId),
                    eq(relayTeamBoards.version, version),
                  ),
                )
                .returning({ version: relayTeamBoards.version });
        if (written !== undefined) return { version: written.version, board: next, names };
      }
      return yield* refuse("board_busy");
    },
    persistence("change the board of"),
  );

  return Teams.of({
    list,
    create,
    get,
    rename,
    remove,
    leave,
    removeMember,
    createInvite,
    acceptInvite,
    memberForAssertion,
    registerThread,
    unregisterThread,
    renameThread,
    setThreadsListed,
    memberIdsForEnvironment,
    unlistEnvironment,
    board,
    changeBoard,
  });
});

export const layer = Layer.effect(Teams, make);
