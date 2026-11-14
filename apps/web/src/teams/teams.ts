import { useAtomValue } from "@effect/atom-react";
import { managedRelaySessionAtom } from "@t3tools/client-runtime/relay";
import type { RoomBoardChange } from "@t3tools/contracts";
import {
  RelayListTeamsResponse,
  RelayOkResponse,
  RelayTeam,
  RelayTeamAssertionResponse,
  RelayTeamBoardChangeResponse,
  RelayTeamBoardResponse,
  RelayTeamInviteAcceptResponse,
  RelayTeamInviteResponse,
  RelayTeamRequestError,
  RelayTeamSummary,
  type RelayTeamThread,
} from "@t3tools/contracts/relay";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as FetchHttpClient from "effect/http/FetchHttpClient";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as Option from "effect/Option";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import { AsyncResult, Atom } from "effect/reactivity";

import { hasCloudPublicConfig, resolveCloudPublicConfig } from "../cloud/publicConfig";
import { guestLinkHost, type JoinedGuestShare, rememberGuestShare } from "../guest/guestShares";
import { redeemInvite } from "../guest/redeemInvite";
import { configuredHostedAppUrl } from "../hostedPairing";
import { appAtomRegistry } from "../rpc/atomRegistry";

/** A team request that failed, in words the person can act on. */
export class TeamsRequestError extends Schema.TaggedError<TeamsRequestError>()(
  "TeamsRequestError",
  { message: Schema.String },
) {}

const decodeRefusal = Schema.decodeUnknownOption(RelayTeamRequestError);

const failWith = (message: string) => new TeamsRequestError({ message });

/** Calls the relay's team routes as the signed-in account. */
const teamsRequest = Effect.fn("teams.request")(function* <A>(
  success: Schema.ConstraintDecoder<A>,
  path: string,
  init: { readonly method?: "GET" | "POST" | "DELETE"; readonly body?: unknown } = {},
) {
  const { relayUrl } = resolveCloudPublicConfig();
  const session = appAtomRegistry.get(managedRelaySessionAtom);
  if (relayUrl === null || session === null) {
    return yield* failWith("Sign in to T Connect to use teams.");
  }
  const token = yield* session
    .readClerkToken()
    .pipe(Effect.mapError(() => failWith("Could not read your T Connect sign-in.")));
  if (!token) return yield* failWith("Sign in to T Connect to use teams.");
  const request = HttpClientRequest.make(init.method ?? "GET")(new URL(path, relayUrl)).pipe(
    HttpClientRequest.bearerToken(token),
  );
  const client = yield* HttpClient.HttpClient;
  const response = yield* client
    .execute(
      init.body === undefined ? request : HttpClientRequest.bodyJsonUnsafe(request, init.body),
    )
    .pipe(Effect.mapError(() => failWith("Could not reach T Connect.")));
  const json = yield* response.json.pipe(Effect.orElseSucceed(() => null));
  if (response.status >= 400) {
    if (response.status === 429) return yield* failWith("Too many tries. Wait a minute.");
    if (response.status === 401) return yield* failWith("Sign in to T Connect again.");
    return yield* failWith(
      Option.match(decodeRefusal(json), {
        onNone: () => "T Connect could not do that. Try again.",
        onSome: (refusal) => refusal.message,
      }),
    );
  }
  return yield* Schema.decodeEffect(success)(json).pipe(
    Effect.mapError(() => failWith("T Connect answered with something this app cannot read.")),
  );
}, Effect.provide(FetchHttpClient.layer));

const teamPath = (teamId: string) => `/v1/teams/${encodeURIComponent(teamId)}`;

const teamsAtom = Atom.family((accountId: string) =>
  Atom.make(
    teamsRequest(RelayListTeamsResponse, "/v1/teams").pipe(Effect.map(({ teams }) => teams)),
  ).pipe(Atom.setIdleTTL(5 * 60_000), Atom.withLabel(`teams:${accountId}`)),
);

const teamAtom = Atom.family((key: string) => {
  const teamId = key.slice(key.indexOf("\u0000") + 1);
  return Atom.make(teamsRequest(RelayTeam, teamPath(teamId))).pipe(
    Atom.setIdleTTL(5 * 60_000),
    Atom.withLabel(`team:${teamId}`),
  );
});

const NO_TEAMS_ATOM = Atom.make(AsyncResult.success<ReadonlyArray<RelayTeamSummary>>([])).pipe(
  Atom.keepAlive,
  Atom.withLabel("teams:signed-out"),
);
const NO_TEAM_ATOM = Atom.make(AsyncResult.initial<RelayTeam, TeamsRequestError>()).pipe(
  Atom.keepAlive,
  Atom.withLabel("team:signed-out"),
);

function failureMessage(result: AsyncResult.AsyncResult<unknown, TeamsRequestError>) {
  return result._tag === "Failure" && !result.waiting
    ? Option.match(Cause.findErrorOption(result.cause), {
        onNone: () => "Could not load teams.",
        onSome: (error) => error.message,
      })
    : null;
}

/** Whether teams can show: this build has T Connect and someone is signed in to it. */
export function useTeamsAccount(): string | null {
  const session = useAtomValue(managedRelaySessionAtom);
  return hasCloudPublicConfig() ? (session?.accountId ?? null) : null;
}

export function useTeams() {
  const accountId = useTeamsAccount();
  const result = useAtomValue(accountId === null ? NO_TEAMS_ATOM : teamsAtom(accountId));
  return {
    accountId,
    teams: AsyncResult.getOrElse(result, () => null),
    error: failureMessage(result),
  };
}

export function useTeam(teamId: string) {
  const accountId = useTeamsAccount();
  const result = useAtomValue(
    accountId === null ? NO_TEAM_ATOM : teamAtom(`${accountId}\u0000${teamId}`),
  );
  return {
    accountId,
    team: AsyncResult.getOrElse(result, () => null),
    loading: result.waiting,
    error: failureMessage(result),
  };
}

/** Reloads what the sidebar and the team page show after a change. */
export function refreshTeams(teamId?: string) {
  const accountId = appAtomRegistry.get(managedRelaySessionAtom)?.accountId;
  if (accountId === undefined) return;
  appAtomRegistry.refresh(teamsAtom(accountId));
  if (teamId !== undefined) appAtomRegistry.refresh(teamAtom(`${accountId}\u0000${teamId}`));
}

export type TeamsOutcome<A> =
  | { readonly ok: true; readonly value: A }
  | { readonly ok: false; readonly message: string };

const run = async <A>(
  effect: Effect.Effect<A, TeamsRequestError>,
  refresh?: { readonly teamId?: string },
): Promise<TeamsOutcome<A>> => {
  const result = await Effect.runPromise(Effect.result(effect));
  if (refresh !== undefined) refreshTeams(refresh.teamId);
  return Result.isSuccess(result)
    ? { ok: true, value: result.success }
    : { ok: false, message: result.failure.message };
};

export const createTeam = (name: string) =>
  run(teamsRequest(RelayTeamSummary, "/v1/teams", { method: "POST", body: { name } }), {});

export const renameTeam = (teamId: string, name: string) =>
  run(
    teamsRequest(RelayOkResponse, `${teamPath(teamId)}/name`, { method: "POST", body: { name } }),
    { teamId },
  );

export const deleteTeam = (teamId: string) =>
  run(teamsRequest(RelayOkResponse, teamPath(teamId), { method: "DELETE" }), {});

export const leaveTeam = (teamId: string) =>
  run(teamsRequest(RelayOkResponse, `${teamPath(teamId)}/leave`, { method: "POST" }), {});

export const removeTeamMember = (teamId: string, userId: string) =>
  run(
    teamsRequest(RelayOkResponse, `${teamPath(teamId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
    { teamId },
  );

/** The team's invite as a link people open in the hosted app. */
export const createTeamInvite = (teamId: string) =>
  run(
    teamsRequest(RelayTeamInviteResponse, `${teamPath(teamId)}/invites`, { method: "POST" }).pipe(
      Effect.map((invite) => ({
        ...invite,
        url: new URL(`/t/${invite.name}`, configuredHostedAppUrl()).toString(),
      })),
    ),
  );

export const acceptTeamInvite = (name: string) =>
  run(
    teamsRequest(
      RelayTeamInviteAcceptResponse,
      `/v1/team-invites/${encodeURIComponent(name)}/accept`,
      { method: "POST" },
    ),
    {},
  );

/** The team's board, or null for it when it has not changed since version `since`. */
export const readTeamBoard = (teamId: string, since: number | null) =>
  run(
    teamsRequest(
      RelayTeamBoardResponse,
      `${teamPath(teamId)}/board${since === null ? "" : `?since=${since}`}`,
    ),
  );

export const changeTeamBoard = (teamId: string, change: RoomBoardChange) =>
  run(
    teamsRequest(RelayTeamBoardChangeResponse, `${teamPath(teamId)}/board/changes`, {
      method: "POST",
      body: { change },
    }),
  );

/**
 * Joins a thread shared to the team: T Connect signs who this member is for the owner's machine,
 * which lets them in under their account. Joining again is how a member comes back.
 */
export async function joinTeamThread(
  teamId: string,
  thread: Pick<RelayTeamThread, "environmentId" | "host" | "credential" | "title">,
): Promise<TeamsOutcome<JoinedGuestShare>> {
  const host = guestLinkHost(thread.host);
  if (host === null) {
    return { ok: false, message: "This thread's machine is outside this app's T Connect domain." };
  }
  const assertion = await run(
    teamsRequest(RelayTeamAssertionResponse, `${teamPath(teamId)}/assertions`, {
      method: "POST",
      body: { environmentId: thread.environmentId },
    }),
  );
  if (!assertion.ok) return assertion;
  const joined = await redeemInvite({
    credential: thread.credential,
    host,
    name: "Member",
    memberAssertion: assertion.value.token,
  });
  if (typeof joined === "string") return { ok: false, message: joined };
  const share = {
    ...joined,
    title: thread.title || joined.title,
    team: { id: teamId, environmentId: thread.environmentId, credential: thread.credential },
  };
  rememberGuestShare(share);
  return { ok: true, value: share };
}
