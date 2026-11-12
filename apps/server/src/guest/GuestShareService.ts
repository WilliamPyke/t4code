import {
  type ChatAttachment,
  ChatAttachmentId,
  CommandId,
  GUEST_HANDOFF_TTL_MS,
  GUEST_NAME_MAX_LENGTH,
  GUEST_SHARE_TTL_MS,
  type GuestHandoff,
  GuestMessageId,
  GuestShareCreateError,
  type GuestShareCreateInput,
  type GuestShareCreateResult,
  type GuestShareTeam,
  TEAM_SESSION_TTL_MS,
  TEAM_SHARE_TTL_MS,
  type ThreadGuestShare,
  type GuestAccount,
  GuestId,
  guestContributorFor,
  GUEST_HOST_PARAM,
  GUEST_SHARE_PARAM,
  GUEST_SIGN_IN_CALLBACK_ROUTE,
  GUEST_SIGN_IN_PARAM,
  type GuestSignInFailure,
  type GuestPresence,
  GuestShareId,
  type GuestRedeemRequest,
  type GuestStreamEvent,
  type GuestSubmitRequest,
  type GuestTurnRequest,
  type GuestAgentActivityRequest,
  GUEST_AGENT_PROMPT_MAX_LENGTH,
  isBranchSynced,
  providerAllowsDirectGuestSend,
  repositoryGroupingKeyOf,
  type RoomAgentsEvent,
  type RoomArtifactRead,
  type RoomBoardChange,
  type RoomCodeState,
  roomCodeStateOf,
  type RoomBoardPoint,
  type RoomBoardViewport,
  type RoomCursorsEvent,
  type RoomLiveInput,
  type RoomUpdates,
  SHARED_THREAD_MAX_CHARS,
  SHARED_THREAD_MAX_MESSAGES,
  type SharedThreadCheckout,
  type SharedThreadExport,
  type SharedThreadMessage,
  type OrchestrationV2AppThread,
  type OrchestrationV2CommandOutputFrame,
  type OrchestrationV2DomainEvent,
  type OrchestrationV2GetTurnItemResult,
  type OrchestrationV2ThreadHistoryPage,
  type OrchestrationV2TurnItem,
  type ServerProvider,
  ThreadId,
  TurnItemId,
} from "@t3tools/contracts";
import { chatMarkdownImageSources } from "@t3tools/shared/markdownPipeline";
import { buildGuestLink, buildShortGuestLink } from "@t3tools/shared/guestLinks";
import { sanitizeLinkedPrompt } from "@t3tools/shared/promptLinks";
import { roomArtifactBody } from "@t3tools/shared/roomBoard";
import { htmlRenderFromToolItem } from "@t3tools/shared/toolOutput";
import * as NodeOS from "node:os";

import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

import { base64UrlDecodeUtf8, base64UrlEncode, timingSafeEqualBase64Url } from "../auth/utils.ts";
import * as PayloadSigner from "../auth/PayloadSigner.ts";
import {
  attachmentFileExtension,
  createAttachmentId,
  resolveAttachmentPath,
  resolveAttachmentPathById,
  threadHtmlRenderAttachmentIds,
} from "../attachmentStore.ts";
import * as ServerConfig from "../config.ts";
import { CloudManagedEndpointRuntime } from "../cloud/ManagedEndpointRuntime.ts";
import { configuredHostedAppUrlConfig } from "../cloud/publicConfig.ts";
import * as GitWorkflow from "../git/GitWorkflowService.ts";
import * as CommandOutputHub from "../orchestration-v2/CommandOutputHub.ts";
import { GUEST_FAILURE, hasGuest } from "../orchestration-v2/GuestShareDecider.ts";
import * as Orchestrator from "../orchestration-v2/Orchestrator.ts";
import { coalesceThreadLiveStream } from "../orchestration-v2/ThreadLiveEventCoalescer.ts";
import { buildBoundedThreadStreamSnapshot } from "../orchestration-v2/ThreadStream.ts";
import {
  projectTurnItemForDetail,
  projectTurnItemForWire,
  threadStreamEventItem,
} from "../orchestration-v2/WireProjection.ts";
import * as ProjectService from "../project/ProjectService.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import * as ProviderRegistry from "../provider/ProviderRegistry.ts";
import * as ServerSettings from "../serverSettings.ts";
import * as AnalyticsService from "../telemetry/AnalyticsService.ts";
import { type GuestRedactor, type GuestSafe, makeGuestRedactor } from "./guestRedaction.ts";
import * as GuestLinkNames from "./GuestLinkNames.ts";
import * as GuestTeamShares from "./GuestTeamShares.ts";
import * as GuestSignIn from "./GuestSignIn.ts";
import { guestShareView, guestThreadModel } from "./guestView.ts";
import * as RoomBoxes from "./RoomBoxes.ts";
import { clip, roomUpdatesOf } from "./roomUpdates.ts";
import {
  classifyGuestUploads,
  GUEST_UPLOAD_HEADER_BYTES,
  guestHostImageType,
  type GuestUpload,
  matchesImageSignature,
  shownImageHostPath,
} from "./guestAttachments.ts";

const SIGNING_SECRET_NAME = "guest-share-signing-key";
const SHARE_ID_BYTES = 16;
const HOSTED_SIGN_IN_MARK = "hosted";
const INVITE_SIGNATURE_BYTES = 16;
const SNAPSHOT_ROW_LIMIT = 600;
const SNAPSHOT_USER_TURN_LIMIT = 20;
// Shares with no open guest stream whose sent image replies are still kept.
const SHARED_THREAD_REPLIES_LIMIT = 64;
// How soon an open read notices that its link stopped working, such as Connect no longer serving
// the host. Closing or replacing the link ends the main stream at once.
const ACCESS_RECHECK_INTERVAL = Duration.seconds(30);
// Turns one guest's machine can post in a minute. An agent rarely finishes faster than this.
const GUEST_TURN_RATE_LIMIT = 6;
const GUEST_TURN_RATE_WINDOW_MS = 60_000;
// Board changes one guest can make in a minute. Each is a card dropped or a note left.
const BOARD_CHANGE_RATE_LIMIT = 120;
// Catch-ups one guest's machine can ask for in a minute. Each is a person pressing a button.
const ROOM_UPDATES_RATE_LIMIT = 20;
// Turn starts and stops one guest's machine can report in a minute.
const AGENT_ACTIVITY_RATE_LIMIT = 30;
// Pointer moves one guest can send in a second. Their page sends about 12.
const CURSOR_RATE_LIMIT = 20;
const CURSOR_RATE_WINDOW_MS = 1_000;
// A guest's machine says again that a long turn still runs well before this; one that died stops.
const AGENT_ACTIVITY_TTL_MS = 10 * 60_000;
// A pointer nobody moved for this long is taken off the board.
const CURSOR_TTL_MS = 60_000;
// A view is dropped when its board closes; this only catches a board that never said so.
const VIEW_TTL_MS = 10 * 60_000;
// How soon an open room stream drops what expired when nothing else changed.
const ROOM_LIVE_SWEEP_INTERVAL = Duration.seconds(5);
// How often a guest's stream asks git again where the owner's code is. Git keeps its answer a while.
const OWNER_CODE_INTERVAL = Duration.seconds(30);
// The owner's pointer, keyed apart from every guest id.
const OWNER_CURSOR = "";

interface Expiring {
  readonly until: number;
}
/**
 * A share's live room: running agents by guest, and pointers and board views by guest id or
 * `OWNER_CURSOR`.
 */
interface RoomLive {
  readonly agents: ReadonlyMap<
    GuestId,
    Expiring & {
      readonly id: string;
      readonly prompt: string;
      readonly taskId?: string;
      readonly artifactId?: string;
      readonly code?: RoomCodeState;
    }
  >;
  readonly cursors: ReadonlyMap<string, Expiring & RoomBoardPoint>;
  readonly views: ReadonlyMap<string, Expiring & RoomBoardViewport>;
}
const EMPTY_ROOM_LIVE: RoomLive = { agents: new Map(), cursors: new Map(), views: new Map() };
const unexpired = <K, V extends Expiring>(entries: ReadonlyMap<K, V>, now: number) =>
  new Map([...entries].filter(([, entry]) => entry.until > now));
const roomIsEmpty = (room: RoomLive) =>
  room.agents.size === 0 && room.cursors.size === 0 && room.views.size === 0;

const GUEST_ACCESS_MESSAGES = {
  ...GUEST_FAILURE,
  name_taken: GUEST_FAILURE.nameTaken,
  invalid: "This guest link is not valid.",
  stale_page: "This page is for an older guest link. Reload it to continue.",
  unavailable: "This item is not available.",
  rejected: "The owner's server rejected this request.",
  empty: "Write a message or attach a file.",
  too_many_files: "Attach up to 4 files to a message.",
  too_large: "Attached files can total up to 10 MB per message.",
  unsupported_file: "This file cannot be attached. Images must be PNG, JPEG, GIF, or WebP.",
  files_busy: GUEST_FAILURE.filesBusy,
  board_full: GUEST_FAILURE.boardFull,
  sign_in_failed: "Could not start the GitHub sign-in. Try again.",
  ended: "This room has ended, or you are no longer in it.",
  too_fast: "Too many requests at once. Try again in a minute.",
  team_member_required:
    "This thread is shared with a team. Open it from the team's page in T Code while signed in.",
  artifact_gone: GUEST_FAILURE.artifactGone,
  box_gone: GUEST_FAILURE.boxGone,
  box_not_yours: GUEST_FAILURE.boxNotYours,
} as const;

/** What a guest is told. The message comes from `reason`, never from a cause. */
export class GuestShareAccessError extends Schema.TaggedError<GuestShareAccessError>()(
  "GuestShareAccessError",
  {
    reason: Schema.Literals([
      "invalid",
      "inactive",
      "used",
      "full",
      "closed",
      "name_taken",
      "busy",
      "stale_page",
      "unavailable",
      "rejected",
      "empty",
      "too_many_files",
      "too_large",
      "unsupported_file",
      "files_busy",
      "board_full",
      "sign_in_failed",
      "ended",
      "too_fast",
      "removed",
      "team_member_required",
      "artifact_gone",
      "box_gone",
      "box_not_yours",
    ]),
  },
) {
  override get message(): string {
    return GUEST_ACCESS_MESSAGES[this.reason];
  }
}

const GUEST_FAILURE_REASONS = new Map<unknown, GuestShareAccessError["reason"]>([
  [GUEST_FAILURE.inactive, "inactive"],
  [GUEST_FAILURE.used, "used"],
  [GUEST_FAILURE.full, "full"],
  [GUEST_FAILURE.closed, "closed"],
  [GUEST_FAILURE.nameTaken, "name_taken"],
  [GUEST_FAILURE.busy, "busy"],
  [GUEST_FAILURE.filesBusy, "files_busy"],
  [GUEST_FAILURE.boardFull, "board_full"],
  [GUEST_FAILURE.removed, "removed"],
  [GUEST_FAILURE.artifactGone, "artifact_gone"],
  [GUEST_FAILURE.boxGone, "box_gone"],
  [GUEST_FAILURE.boxNotYours, "box_not_yours"],
]);
const guestFailureReason = (cause: unknown): GuestShareAccessError["reason"] =>
  GUEST_FAILURE_REASONS.get(cause) ?? "rejected";

const SessionClaims = Schema.Struct({
  // A handoff token only opens the thread's export, and only for a few minutes. A room token only
  // posts the guest's own turns and reads what the room said and its artifact cards, for as long
  // as the share lasts.
  kind: Schema.Literals(["session", "handoff", "room"]),
  threadId: ThreadId,
  shareId: GuestShareId,
  /** Absent in the session of a link made before several guests could join. */
  guestId: Schema.optional(GuestId),
  /** Epoch milliseconds. Only a handoff token expires before its share does. */
  expiresAt: Schema.optional(Schema.Number),
});
type SessionClaims = typeof SessionClaims.Type;
const decodeSessionClaims = Schema.decodeUnknownOption(Schema.fromJsonString(SessionClaims));

const inactive = new GuestShareAccessError({ reason: "inactive" });

// A member's account name lands in the agent's attribution line: one plain line, unique here.
const LINE_BREAKING = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const memberGuestName = (share: ThreadGuestShare, accountName: string) => {
  const base =
    accountName
      .replace(LINE_BREAKING, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, GUEST_NAME_MAX_LENGTH - 3) || "Member";
  const taken = new Set(share.guests?.map((guest) => guest.name.toLowerCase()) ?? []);
  let name = base;
  for (let suffix = 2; taken.has(name.toLowerCase()); suffix++) name = `${base} ${suffix}`;
  return name;
};

export class GuestShareService extends Context.Service<
  GuestShareService,
  {
    readonly create: (
      input: GuestShareCreateInput,
    ) => Effect.Effect<GuestShareCreateResult, GuestShareCreateError>;
    /** Succeeds while the invite still leads to a share. Joins no one. */
    readonly checkInvite: (credential: string) => Effect.Effect<void, GuestShareAccessError>;
    /** Joins the invite's share as a new guest and returns the session token for their cookie. */
    readonly redeem: (
      request: GuestRedeemRequest,
    ) => Effect.Effect<
      { readonly token: string; readonly shareId: GuestShareId; readonly threadId: ThreadId },
      GuestShareAccessError
    >;
    /** Succeeds while the session can still open its share. */
    readonly check: (session: string) => Effect.Effect<void, GuestShareAccessError>;
    /**
     * The share a session token was signed for, or null for anything else. It says nothing about
     * whether the share still works: a route uses it to refuse a bearer sent for another share.
     */
    readonly sessionShareId: (token: string) => Effect.Effect<GuestShareId | null>;
    /** Stores the guest's files as the thread's attachments and records the message with them. */
    readonly submit: (
      session: string,
      request: GuestSubmitRequest,
      uploads: ReadonlyArray<GuestUpload>,
    ) => Effect.Effect<void, GuestShareAccessError>;
    readonly stream: (
      session: string,
    ) => Effect.Effect<Stream.Stream<GuestSafe<GuestStreamEvent>>, GuestShareAccessError>;
    /**
     * Starts the guest's GitHub sign-in. `url` is where their browser goes on GitHub, and
     * `cookie` is what that browser must bring back for the sign-in to finish.
     */
    readonly signIn: (
      session: string,
    ) => Effect.Effect<{ readonly url: string; readonly cookie: string }, GuestShareAccessError>;
    /**
     * Starts the sign-in for a guest page on the hosted app, which posts here as a navigation.
     * Only that app's origin may: any other page could walk someone else's browser through a
     * guest's sign-in. The guest comes back to the hosted app when it ends.
     */
    readonly signInFromHostedApp: (input: {
      readonly session: string;
      readonly origin: string | null;
    }) => Effect.Effect<{ readonly url: string; readonly cookie: string }, GuestShareAccessError>;
    /**
     * Finishes the sign-in GitHub sent a browser back for, recording the account on the share
     * when everything matches. Returns where the browser goes next: the guest page on this host,
     * or on the hosted app when the sign-in began there.
     */
    readonly signInFinish: (input: {
      readonly state: string | null;
      readonly code: string | null;
      readonly cookie: string | null;
    }) => Effect.Effect<string>;
    /** The guests with a thread's shared page open, now and as that changes. */
    readonly presence: (threadId: ThreadId) => Stream.Stream<GuestPresence>;
    /** A token the guest's own T3 Code reads the thread's export with, for a few minutes. */
    readonly handoff: (session: string) => Effect.Effect<GuestHandoff, GuestShareAccessError>;
    /** The conversation and where its code is, for a handoff token. Changes nothing here. */
    readonly exportThread: (
      handoffToken: string,
    ) => Effect.Effect<GuestSafe<SharedThreadExport>, GuestShareAccessError>;
    /** Records a turn the guest ran on their own machine, for the room to see. */
    readonly postTurn: (
      roomToken: string,
      request: GuestTurnRequest,
    ) => Effect.Effect<void, GuestShareAccessError>;
    /** Shows that a guest's agent started a turn on their machine, or stopped without one. */
    readonly postActivity: (
      roomToken: string,
      request: GuestAgentActivityRequest,
    ) => Effect.Effect<void, GuestShareAccessError>;
    /** The guests' agents running now in a share's room, for the thread's owner. */
    readonly roomAgents: (input: RoomLiveInput) => Stream.Stream<RoomAgentsEvent>;
    /** Everyone's pointers on a share's board but the owner's, which shows while this is read. */
    readonly roomCursors: (input: RoomLiveInput) => Stream.Stream<RoomCursorsEvent>;
    /**
     * Moves the owner's pointer on the board while they read the room's pointers, or a guest's
     * while their page is open. Null takes it off.
     */
    readonly moveCursor: (
      by: RoomLiveInput | { readonly session: string },
      at: RoomBoardPoint | null,
      view?: RoomBoardViewport | null,
    ) => Effect.Effect<void, GuestShareAccessError>;
    /** What the room said after `after`, for the guest's own machine. Changes nothing here. */
    readonly roomUpdates: (
      roomToken: string,
      after: string | null,
    ) => Effect.Effect<GuestSafe<RoomUpdates>, GuestShareAccessError>;
    /** One artifact card of the board, for the guest's own machine. Changes nothing here. */
    readonly roomArtifact: (
      roomToken: string,
      noteId: string,
    ) => Effect.Effect<GuestSafe<RoomArtifactRead>, GuestShareAccessError>;
    /**
     * Changes one card or note on a shared thread's board: for its owner, who names the thread,
     * or for a guest, who shows their session. Everyone in the room sees the result.
     */
    readonly changeBoard: (
      by: { readonly threadId: ThreadId } | { readonly session: string },
      change: RoomBoardChange,
    ) => Effect.Effect<void, GuestShareAccessError>;
    /** The file of an HTML render in the shared thread, and its title. */
    readonly render: (
      session: string,
      itemId: string,
    ) => Effect.Effect<{ readonly path: string; readonly title: string }, GuestShareAccessError>;
    /** One item of the shared thread, as the owner's expanded row loads it, without file diffs. */
    readonly item: (
      session: string,
      itemId: string,
    ) => Effect.Effect<GuestSafe<OrchestrationV2GetTurnItemResult>, GuestShareAccessError>;
    /** Older turns of the shared thread, as the owner's client pages them. */
    readonly history: (
      session: string,
      cursor: string,
    ) => Effect.Effect<GuestSafe<OrchestrationV2ThreadHistoryPage>, GuestShareAccessError>;
    /** A command's output frames, as the owner's expanded row gets them, until the link ends. */
    readonly commandOutput: (
      session: string,
      itemId: string,
    ) => Effect.Effect<
      Stream.Stream<GuestSafe<OrchestrationV2CommandOutputFrame>>,
      GuestShareAccessError
    >;
    /** A file in the shared thread or one of the share's messages, never a dismissed one's. */
    readonly attachment: (
      session: string,
      attachmentId: string,
    ) => Effect.Effect<
      { readonly path: string; readonly attachment: ChatAttachment },
      GuestShareAccessError
    >;
    /**
     * An image on the host that an agent reply the guest sees shows, and its type. `path` is the
     * one the guest's copy of the reply names.
     */
    readonly media: (
      session: string,
      path: string,
    ) => Effect.Effect<{ readonly path: string; readonly mimeType: string }, GuestShareAccessError>;
  }
>()("t3/guest/GuestShareService") {}

/** A reply a guest's stream sent, with its image sources once a media request parsed them. */
interface SentReply {
  readonly text: string;
  sources?: ReadonlyArray<string>;
}

/** The thread record an event carries, for the share and the view. */
const threadOf = (event: OrchestrationV2DomainEvent): OrchestrationV2AppThread | null => {
  switch (event.type) {
    case "thread.guest-share-updated":
    case "thread.metadata-updated":
    case "thread.model-selection-updated":
    case "thread.provider-switched":
      return event.payload;
    default:
      return null;
  }
};

const make = Effect.gen(function* () {
  const orchestrator = yield* Orchestrator.OrchestratorV2;
  const commandOutputs = yield* CommandOutputHub.CommandOutputHub;
  const providerRegistry = yield* ProviderRegistry.ProviderRegistry;
  const projects = yield* ProjectService.ProjectService;
  const repositoryIdentities = yield* RepositoryIdentityResolver.RepositoryIdentityResolver;
  const git = yield* GitWorkflow.GitWorkflowService;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const guestSignIn = yield* GuestSignIn.GuestSignIn;
  const linkNames = yield* GuestLinkNames.GuestLinkNames;
  const teamShares = yield* GuestTeamShares.GuestTeamShares;
  const managedEndpoint = yield* CloudManagedEndpointRuntime;
  const { attachmentsDir } = yield* ServerConfig.ServerConfig;
  const fileSystem = yield* FileSystem.FileSystem;
  const random = yield* SecureRandom.SecureRandom;
  const analytics = yield* AnalyticsService.AnalyticsService;
  const roomBoxes = yield* RoomBoxes.RoomBoxes;
  const signer = yield* PayloadSigner.make(SIGNING_SECRET_NAME);
  // A value that is set but is not a usable origin counts as none: links stay on this host.
  const hostedAppUrl = yield* configuredHostedAppUrlConfig.pipe(
    Effect.map(Option.getOrNull),
    Effect.orElseSucceed(() => null),
  );
  /** A truncated HMAC keeps invite links short. 128 bits is still far beyond guessing range. */
  const inviteSignature = (shareId: string) =>
    signer.sign(`guest-invite:${shareId}`).pipe(
      Effect.orDie,
      Effect.map((signature) =>
        base64UrlEncode(Buffer.from(signature, "base64url").subarray(0, INVITE_SIGNATURE_BYTES)),
      ),
    );

  // Tokens are derived from the share id, so nothing secret is stored and replacing or closing
  // the share in the thread projection revokes every token for it. An invite is
  // `<shareId>.<signature>` and the thread is looked up by share id; a session token carries
  // signed claims.
  const signInvite = (shareId: GuestShareId) =>
    inviteSignature(shareId).pipe(Effect.map((signature) => `${shareId}.${signature}`));
  const signSession = (claims: SessionClaims) => {
    const payload = base64UrlEncode(JSON.stringify(claims));
    return signer.sign(payload).pipe(
      Effect.orDie,
      Effect.map((signature) => `${payload}.${signature}`),
    );
  };
  const splitToken = (token: string) => {
    const [payload, signature, extra] = token.split(".");
    return payload && signature && extra === undefined ? { payload, signature } : null;
  };
  const verifyInvite = Effect.fn("GuestShareService.verifyInvite")(function* (token: string) {
    const parts = splitToken(token);
    if (parts === null) return Option.none<SessionClaims>();
    const expected = yield* inviteSignature(parts.payload);
    if (!timingSafeEqualBase64Url(parts.signature, expected)) {
      return Option.none<SessionClaims>();
    }
    const shareId = GuestShareId.make(parts.payload);
    const threadId = yield* orchestrator
      .findGuestShareThreadId(shareId)
      .pipe(Effect.mapError(() => inactive));
    return threadId === null
      ? Option.none<SessionClaims>()
      : Option.some<SessionClaims>({ kind: "session", threadId, shareId });
  });
  // Untraced: runs on every guest request, like the Effect.map it replaced.
  const verifySession = Effect.fnUntraced(function* (token: string) {
    const parts = splitToken(token);
    if (parts === null) return Option.none<SessionClaims>();
    if (!(yield* signer.verify(parts.payload, parts.signature).pipe(Effect.orDie))) {
      return Option.none<SessionClaims>();
    }
    return decodeSessionClaims(base64UrlDecodeUtf8(parts.payload));
  });

  const connectHostname = managedEndpoint.inspectConnector.pipe(
    Effect.map((facts) => facts?.hostname ?? null),
  );
  // A beta: while it is off, no link opens and every guest request is refused.
  const sharingEnabled = serverSettings.getSettings.pipe(
    Effect.map((settings) => settings.guestSharingEnabled),
    Effect.orElseSucceed(() => false),
  );

  const dispatchGuestCommand = (
    command: Parameters<Orchestrator.OrchestratorV2["Service"]["dispatch"]>[0],
  ) =>
    orchestrator.dispatch(command).pipe(
      Effect.mapError(
        (error) =>
          new GuestShareAccessError({
            reason: guestFailureReason("cause" in error ? error.cause : undefined),
          }),
      ),
    );

  const commandId = (label: string) =>
    random.uuidV4().pipe(
      Effect.map((uuid) => CommandId.make(`server:guest-share:${label}:${uuid}`)),
      Effect.orDie,
    );

  /** Checks a token against the live share: same id, not expired, and Connect still serving it. */
  const authorize = Effect.fn("GuestShareService.authorize")(function* (
    token: string,
    kind: "invite" | "session" | "handoff" | "room",
  ) {
    const claims = yield* kind === "invite" ? verifyInvite(token) : verifySession(token);
    // A handoff token is not a session, and a session is not a handoff token.
    if (Option.isNone(claims) || (kind !== "invite" && claims.value.kind !== kind)) {
      return yield* new GuestShareAccessError({ reason: "invalid" });
    }
    const { thread } = yield* orchestrator
      .getThreadRecords(claims.value.threadId, [])
      .pipe(Effect.mapError(() => inactive));
    const share = thread.guestShare;
    const now = yield* DateTime.now;
    if (
      !share ||
      share.id !== claims.value.shareId ||
      thread.archivedAt !== null ||
      thread.deletedAt !== null ||
      DateTime.toEpochMillis(now) >= Date.parse(share.expiresAt) ||
      (kind !== "invite" && !hasGuest(share, claims.value.guestId))
    ) {
      // A guest's machine stops posting for good on this; what is checked below can come back.
      return yield* kind === "room" ? new GuestShareAccessError({ reason: "ended" }) : inactive;
    }
    if (
      !(yield* sharingEnabled) ||
      // A handoff token always ends early, and a team member's session ends a day after joining.
      ((kind === "handoff" || claims.value.expiresAt !== undefined) &&
        DateTime.toEpochMillis(now) >= (claims.value.expiresAt ?? 0)) ||
      (yield* connectHostname) !== share.host
    ) {
      return yield* inactive;
    }
    // A member who left the team, or was removed from it, goes as if the owner removed them.
    const guest = share.guests?.find((joined) => joined.id === claims.value.guestId);
    if (
      share.team !== undefined &&
      guest?.member !== undefined &&
      !(yield* teamShares.isMember(share.team.id, guest.member.userId))
    ) {
      yield* orchestrator
        .dispatch({
          type: "thread.guest.remove",
          commandId: yield* commandId("membership-ended"),
          threadId: thread.id,
          guestId: guest.id,
          membershipEnded: true,
        })
        .pipe(Effect.ignore);
      return yield* kind === "room" ? new GuestShareAccessError({ reason: "ended" }) : inactive;
    }
    return { thread, share, guestId: claims.value.guestId };
  });

  // Guests see paths relative to where the thread works, and `~` for the owner's home. Read per
  // request, so a project moved mid-share is hidden from the next request on.
  const homeDirectory = NodeOS.homedir();
  const redactorFor = Effect.fn("GuestShareService.redactorFor")(function* (
    thread: OrchestrationV2AppThread,
  ) {
    const project = yield* projects
      .getById(thread.projectId)
      .pipe(Effect.orElseSucceed(() => Option.none()));
    const workspaceRoot = Option.getOrNull(project)?.workspaceRoot ?? null;
    return {
      workspaceRoot,
      redactor: makeGuestRedactor({
        workspaceRoots: [thread.worktreePath, workspaceRoot],
        homeDirectory,
      }),
    };
  });

  // The readable name only resolves through the hosted app, so a server without one has none.
  const linkFor = Effect.fn("GuestShareService.linkFor")(function* (
    host: string,
    share: ThreadGuestShare,
  ) {
    const credential = yield* signInvite(share.id);
    const url = buildGuestLink({ host, credential, hostedAppUrl });
    // Members open a team share from the team's page; its bare link lets no one in.
    if (hostedAppUrl === null || share.team !== undefined) return { url, share };
    const name = yield* linkNames.register({ host, credential, expiresAt: share.expiresAt });
    return name === null
      ? { url, share }
      : { url, shortUrl: buildShortGuestLink({ name, hostedAppUrl }), share };
  });

  const create = Effect.fn("GuestShareService.create")(function* (input: GuestShareCreateInput) {
    if (!(yield* sharingEnabled)) {
      return yield* new GuestShareCreateError({ reason: "disabled" });
    }
    const host = yield* connectHostname;
    if (host === null) {
      return yield* new GuestShareCreateError({ reason: "connect_unavailable" });
    }
    const now = yield* DateTime.now;
    const currentThread = yield* orchestrator.getThreadRecords(input.threadId, []).pipe(
      Effect.map(({ thread }) => thread),
      Effect.orElseSucceed(() => null),
    );
    const current = currentThread?.guestShare ?? null;
    const listOnTeam = (teamId: string, shareId: GuestShareId, expiresAt: string) =>
      signInvite(shareId).pipe(
        Effect.flatMap((credential) =>
          teamShares.register({
            teamId,
            threadId: input.threadId,
            shareId,
            title: currentThread?.title ?? "",
            host,
            credential,
            expiresAt,
          }),
        ),
      );
    // A link is returned again only to the same audience: a guest link, or the same team.
    if (
      input.replace !== true &&
      current &&
      current.team?.id === input.teamId &&
      current.host === host &&
      current.joinsClosed !== true &&
      DateTime.toEpochMillis(now) < Date.parse(current.expiresAt)
    ) {
      // Sharing again lists it again, in case the relay dropped it.
      if (current.team !== undefined) {
        yield* listOnTeam(current.team.id, current.id, current.expiresAt);
      }
      return yield* linkFor(host, current);
    }
    const shareId = GuestShareId.make(base64UrlEncode(yield* random.randomBytes(SHARE_ID_BYTES)));
    const expiresAt = DateTime.formatIso(
      DateTime.add(now, {
        milliseconds: input.teamId === undefined ? GUEST_SHARE_TTL_MS : TEAM_SHARE_TTL_MS,
      }),
    );
    let team: GuestShareTeam | undefined;
    if (input.teamId !== undefined) {
      const teamName = yield* listOnTeam(input.teamId, shareId, expiresAt);
      if (teamName === null) {
        return yield* new GuestShareCreateError({ reason: "team_unavailable" });
      }
      team = { id: input.teamId, name: teamName };
    }
    yield* orchestrator
      .dispatch({
        type: "thread.guest-share.open",
        commandId: yield* commandId("open"),
        threadId: input.threadId,
        shareId,
        host,
        expiresAt,
        ...(team === undefined ? {} : { team }),
      })
      .pipe(
        Effect.tapError(() =>
          team === undefined ? Effect.void : teamShares.unregister(input.threadId),
        ),
        Effect.mapError(() => new GuestShareCreateError({ reason: "thread_unavailable" })),
      );
    // A team share replaced by a guest link stops being listed on the team.
    if (team === undefined && current?.team !== undefined) {
      yield* teamShares.unregister(input.threadId);
    }
    const { thread } = yield* orchestrator
      .getThreadRecords(input.threadId, [])
      .pipe(Effect.mapError(() => new GuestShareCreateError({ reason: "read_failed" })));
    if (!thread.guestShare || thread.guestShare.id !== shareId) {
      return yield* new GuestShareCreateError({ reason: "changed" });
    }
    return yield* linkFor(host, thread.guestShare);
  });

  const checkInvite = Effect.fn("GuestShareService.checkInvite")(function* (credential: string) {
    yield* authorize(credential, "invite");
  });

  /**
   * Joins a team share as the member an assertion names. The same member always gets the same
   * guest, under their account's name. The session ends a day later, or once the relay says they
   * are no longer in the team.
   */
  const redeemAsMember = Effect.fn("GuestShareService.redeemAsMember")(function* (
    threadId: ThreadId,
    share: ThreadGuestShare,
    team: GuestShareTeam,
    assertion: string | undefined,
  ) {
    const claims =
      assertion === undefined ? Option.none() : yield* teamShares.verifyMember(assertion);
    if (Option.isNone(claims) || claims.value.teamId !== team.id) {
      return yield* new GuestShareAccessError({ reason: "team_member_required" });
    }
    const { userId, avatarUrl } = claims.value;
    if (share.removedMembers?.includes(userId) === true) {
      return yield* new GuestShareAccessError({ reason: "removed" });
    }
    const joinedAs = (current: ThreadGuestShare) =>
      current.guests?.find((guest) => guest.member?.userId === userId)?.id;
    let guestId = joinedAs(share);
    if (guestId === undefined) {
      const newGuestId = GuestId.make(yield* random.uuidV4().pipe(Effect.orDie));
      guestId = yield* dispatchGuestCommand({
        type: "thread.guest-share.redeem",
        commandId: yield* commandId("redeem"),
        threadId,
        shareId: share.id,
        guestId: newGuestId,
        guestName: memberGuestName(share, claims.value.name),
        member: avatarUrl ? { userId, avatarUrl } : { userId },
      }).pipe(
        Effect.as(newGuestId),
        // Two of the member's browsers joining at once: the second gets the first one's guest.
        Effect.catch((error) =>
          orchestrator.getThreadRecords(threadId, []).pipe(
            Effect.map(({ thread }) =>
              thread.guestShare ? joinedAs(thread.guestShare) : undefined,
            ),
            Effect.orElseSucceed(() => undefined),
            Effect.filterOrFail(
              (existing): existing is GuestId => existing !== undefined,
              () => error,
            ),
          ),
        ),
      );
      yield* analytics.record("feature.used", { feature: "guest_share.join" });
    }
    const token = yield* signSession({
      kind: "session",
      threadId,
      shareId: share.id,
      guestId,
      expiresAt: DateTime.toEpochMillis(yield* DateTime.now) + TEAM_SESSION_TTL_MS,
    });
    return { token, shareId: share.id, threadId };
  });

  const redeem = Effect.fn("GuestShareService.redeem")(function* (request: GuestRedeemRequest) {
    const { thread, share } = yield* authorize(request.credential, "invite");
    if (share.team !== undefined) {
      return yield* redeemAsMember(thread.id, share, share.team, request.memberAssertion);
    }
    const guestId = GuestId.make(yield* random.uuidV4().pipe(Effect.orDie));
    yield* dispatchGuestCommand({
      type: "thread.guest-share.redeem",
      commandId: yield* commandId("redeem"),
      threadId: thread.id,
      shareId: share.id,
      guestId,
      guestName: request.name,
    });
    // Guests have no client connection, so their events carry no surface.
    yield* analytics.record("feature.used", { feature: "guest_share.join" });
    const token = yield* signSession({
      kind: "session",
      threadId: thread.id,
      shareId: share.id,
      guestId,
    });
    return { token, shareId: share.id, threadId: thread.id };
  });

  const check = Effect.fn("GuestShareService.check")(function* (session: string) {
    yield* authorize(session, "session");
  });

  const sessionShareId = (token: string) =>
    verifySession(token).pipe(
      Effect.map((claims) =>
        Option.isSome(claims) && claims.value.kind === "session" ? claims.value.shareId : null,
      ),
    );

  const startSignIn = Effect.fn("GuestShareService.signIn")(function* (
    session: string,
    hosted: boolean,
  ) {
    const { share, guestId } = yield* authorize(session, "session");
    if (guestId === undefined) return yield* new GuestShareAccessError({ reason: "unavailable" });
    const { state, url } = yield* guestSignIn
      .start({ session, redirectUri: `https://${share.host}${GUEST_SIGN_IN_CALLBACK_ROUTE}` })
      .pipe(Effect.mapError(() => new GuestShareAccessError({ reason: "sign_in_failed" })));
    // The mark only picks the guest page the browser returns to; `state` is what gets checked.
    return { url, cookie: `${share.id}.${state}${hosted ? `.${HOSTED_SIGN_IN_MARK}` : ""}` };
  });
  const signIn = (session: string) => startSignIn(session, false);
  const signInFromHostedApp = Effect.fn("GuestShareService.signInFromHostedApp")(function* (input: {
    readonly session: string;
    readonly origin: string | null;
  }) {
    if (hostedAppUrl === null || input.origin !== hostedAppUrl) {
      return yield* new GuestShareAccessError({ reason: "invalid" });
    }
    return yield* startSignIn(input.session, true);
  });

  const identify = Effect.fn("GuestShareService.identify")(function* (
    session: string,
    account: GuestAccount,
  ) {
    // The share is checked again: it can have ended while the guest was on GitHub.
    const { thread, share, guestId } = yield* authorize(session, "session");
    if (guestId === undefined) return yield* new GuestShareAccessError({ reason: "unavailable" });
    const contributors = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.guestContributors),
      Effect.orElseSucceed(() => []),
    );
    const contributor = guestContributorFor(contributors, account);
    if (contributor !== undefined && contributor.id === undefined) {
      // Pinned to the account that signed in, so the login alone stops being enough.
      yield* serverSettings
        .updateSettings({
          guestContributors: contributors.map((candidate) =>
            candidate === contributor ? { login: account.login, id: account.id } : candidate,
          ),
        })
        .pipe(Effect.ignore);
    }
    yield* dispatchGuestCommand({
      type: "thread.guest.identify",
      commandId: yield* commandId("identify"),
      threadId: thread.id,
      shareId: share.id,
      guestId,
      account,
      trusted: contributor !== undefined,
    });
    yield* analytics.record("feature.used", { feature: "guest_share.sign_in" });
  });

  const signInFinish = Effect.fn("GuestShareService.signInFinish")(function* (input: {
    readonly state: string | null;
    readonly code: string | null;
    readonly cookie: string | null;
  }) {
    // The cookie is `<share id>.<state>`, set in the browser that started this sign-in, with a
    // mark after it when that browser was on the hosted app.
    const [shareId = "", expected = "", mark = ""] = (input.cookie ?? "").split(".");
    const host =
      mark === HOSTED_SIGN_IN_MARK && hostedAppUrl !== null ? yield* connectHostname : null;
    const back = (failure?: GuestSignInFailure) => {
      const params = new URLSearchParams();
      if (host !== null) params.set(GUEST_HOST_PARAM, host);
      if (shareId !== "") params.set(GUEST_SHARE_PARAM, shareId);
      if (failure !== undefined) params.set(GUEST_SIGN_IN_PARAM, failure);
      const page = params.size === 0 ? "/guest" : `/guest?${params}`;
      return host === null ? page : `${hostedAppUrl}${page}`;
    };
    // Without this, a guest could send their GitHub link to someone else and be recorded as
    // that person's account once they approved it.
    if (
      input.state === null ||
      expected === "" ||
      !timingSafeEqualBase64Url(input.state, expected)
    ) {
      return back("failed");
    }
    const finished = yield* guestSignIn
      .finish({ state: input.state, code: input.code })
      .pipe(Effect.result);
    if (finished._tag === "Failure") {
      const { reason } = finished.failure;
      return back(reason === "unavailable" ? "failed" : reason);
    }
    const { session, account } = finished.success;
    const identified = yield* identify(session, account).pipe(Effect.result);
    return back(identified._tag === "Failure" ? "failed" : undefined);
  });

  /** Whether the provider the thread runs on takes a guest's message without the owner's Send. */
  const providerAllowsDirect = (
    thread: OrchestrationV2AppThread,
    providers: ReadonlyArray<ServerProvider>,
  ) =>
    providerAllowsDirectGuestSend(
      providers.find((provider) => provider.instanceId === thread.modelSelection.instanceId),
    );

  const uploadFailed = new GuestShareAccessError({ reason: "rejected" });
  const removeStored = (attachments: ReadonlyArray<ChatAttachment>) =>
    Effect.forEach(
      attachments,
      (attachment) => {
        const path = resolveAttachmentPath({ attachmentsDir, attachment });
        return path === null
          ? Effect.void
          : fileSystem.remove(path, { force: true }).pipe(Effect.ignore);
      },
      { discard: true },
    );

  /**
   * Checks the files and stores them as the thread's attachments, so a message can wait longer
   * than the day the pending-upload sweep allows. Send uses them as they are; dismissing the
   * message or ending the share deletes them.
   */
  const storeUploads = Effect.fn("GuestShareService.storeUploads")(function* (
    threadId: ThreadId,
    uploads: ReadonlyArray<GuestUpload>,
  ) {
    const inspected = yield* Effect.forEach(uploads, (upload) =>
      Effect.gen(function* () {
        const info = yield* fileSystem.stat(upload.path);
        const file = yield* fileSystem.open(upload.path, { flag: "r" });
        const header = Option.getOrElse(
          yield* file.readAlloc(GUEST_UPLOAD_HEADER_BYTES),
          () => new Uint8Array(),
        );
        return { ...upload, sizeBytes: Number(info.size), header };
      }).pipe(
        Effect.scoped,
        Effect.mapError(() => uploadFailed),
      ),
    );
    const classified = classifyGuestUploads(inspected);
    if (!classified.ok) return yield* new GuestShareAccessError({ reason: classified.reason });
    const stored: Array<ChatAttachment> = [];
    yield* Effect.forEach(
      classified.attachments,
      (draft, index) =>
        Effect.gen(function* () {
          const id = createAttachmentId(
            threadId,
            draft.type === "file" ? attachmentFileExtension(draft.name) : undefined,
          );
          if (id === null) return yield* uploadFailed;
          const attachment: ChatAttachment = { ...draft, id: ChatAttachmentId.make(id) };
          const path = resolveAttachmentPath({ attachmentsDir, attachment });
          if (path === null) return yield* uploadFailed;
          yield* fileSystem.makeDirectory(attachmentsDir, { recursive: true });
          yield* fileSystem.copyFile(uploads[index]!.path, path);
          stored.push(attachment);
        }).pipe(Effect.mapError(() => uploadFailed)),
      { discard: true },
    ).pipe(Effect.onError(() => removeStored(stored)));
    return stored;
  });

  const submit = Effect.fn("GuestShareService.submit")(function* (
    session: string,
    request: GuestSubmitRequest,
    uploads: ReadonlyArray<GuestUpload>,
  ) {
    const { thread, share, guestId } = yield* authorize(session, "session");
    if (request.shareId !== share.id) {
      return yield* new GuestShareAccessError({ reason: "stale_page" });
    }
    if (request.text === "" && uploads.length === 0) {
      return yield* new GuestShareAccessError({ reason: "empty" });
    }
    const attachments = yield* storeUploads(thread.id, uploads);
    // Checked on every message: the owner can stop trusting a guest, or sign in another way.
    const direct =
      share.guests?.find((guest) => guest.id === guestId)?.trusted === true &&
      providerAllowsDirect(thread, yield* providerRegistry.getProviders);
    const guestMessageId = GuestMessageId.make(yield* random.uuidV4());
    yield* dispatchGuestCommand({
      type: "thread.guest-message.submit",
      commandId: yield* commandId("submit"),
      threadId: thread.id,
      shareId: share.id,
      ...(guestId === undefined ? {} : { guestId }),
      guestMessageId,
      text: request.text,
      ...(attachments.length === 0 ? {} : { attachments }),
      ...(direct ? { direct } : {}),
      ...(request.artifactId === undefined ? {} : { artifactId: request.artifactId }),
      ...(request.boxId === undefined ? {} : { boxId: request.boxId }),
    }).pipe(Effect.onError(() => removeStored(attachments)));
    if (direct) {
      // The same send the owner's button makes. If it fails, the message waits for the owner.
      yield* roomBoxes.sendGuestMessage({ threadId: thread.id, guestMessageId }, "server").pipe(
        Effect.catch((error) =>
          Effect.logWarning("Could not send a trusted guest's message; it waits for the owner.", {
            error,
          }),
        ),
      );
    }
    yield* analytics.record("feature.used", {
      feature: direct ? "guest_message.submit_direct" : "guest_message.submit",
      variant: attachments.length === 0 ? "text_only" : "with_files",
    });
  });

  /** Completes once the session no longer opens its share, so open reads end with it. */
  const untilRevoked = (session: string) =>
    authorize(session, "session").pipe(
      Effect.repeat(Schedule.spaced(ACCESS_RECHECK_INTERVAL)),
      Effect.ignore,
    );

  // The image replies each share's guest stream has sent, in its opening snapshot or live, so an
  // image loads while the guest's page can show its reply, inherited ones included. Keyed by
  // share, so a new link on the thread starts empty. A share with an open stream keeps its
  // record; past the limit, closed ones are dropped.
  const sentImageReplies = new Map<
    GuestShareId,
    { openStreams: number; readonly replies: Map<string, SentReply> }
  >();
  const sentRecord = (shareId: GuestShareId) => {
    let record = sentImageReplies.get(shareId);
    if (record === undefined) {
      record = { openStreams: 0, replies: new Map() };
      sentImageReplies.set(shareId, record);
      for (const [id, other] of sentImageReplies) {
        if (sentImageReplies.size <= SHARED_THREAD_REPLIES_LIMIT) break;
        if (other.openStreams === 0 && id !== shareId) sentImageReplies.delete(id);
      }
    }
    return record;
  };
  const rememberSent = (shareId: GuestShareId, items: Iterable<OrchestrationV2TurnItem>) => {
    for (const item of items) {
      if (item.type !== "assistant_message") continue;
      const key = `${item.threadId}\u0000${item.id}`;
      // Only replies with image syntax can show an image. One edited to drop its images stops
      // allowing them.
      if (item.text.includes("![") || /<img/i.test(item.text)) {
        sentRecord(shareId).replies.set(key, { text: item.text });
      } else {
        sentImageReplies.get(shareId)?.replies.delete(key);
      }
    }
  };

  // Open guest pages by thread, counted per guest because one guest can have several tabs. Held
  // in memory only: it is not history, and a restart closes every stream it counts.
  const viewing = yield* SubscriptionRef.make<ReadonlyMap<ThreadId, ReadonlyMap<GuestId, number>>>(
    new Map(),
  );
  const countViewer = (threadId: ThreadId, guestId: GuestId, delta: 1 | -1) =>
    SubscriptionRef.update(viewing, (current) => {
      const guests = new Map(current.get(threadId));
      const count = (guests.get(guestId) ?? 0) + delta;
      if (count > 0) guests.set(guestId, count);
      else guests.delete(guestId);
      const next = new Map(current);
      if (guests.size > 0) next.set(threadId, guests);
      else next.delete(threadId);
      return next;
    });
  const presence = (threadId: ThreadId) =>
    SubscriptionRef.changes(viewing).pipe(
      Stream.map((current) => [...(current.get(threadId)?.keys() ?? [])].toSorted().join("\n")),
      // Other threads' guests change the map too.
      Stream.changes,
      Stream.map((ids): GuestPresence => ({
        online: ids === "" ? [] : ids.split("\n").map((id) => GuestId.make(id)),
      })),
    );
  const isViewing = (threadId: ThreadId, guestId: GuestId) =>
    Effect.map(
      SubscriptionRef.get(viewing),
      (current) => current.get(threadId)?.has(guestId) === true,
    );

  // Each share's live room, like `viewing`: in memory only, and every entry expires.
  const live = yield* SubscriptionRef.make<ReadonlyMap<GuestShareId, RoomLive>>(new Map());
  const changeRoom = (shareId: GuestShareId, change: (room: RoomLive, now: number) => RoomLive) =>
    Effect.flatMap(DateTime.now, (at) => {
      const now = DateTime.toEpochMillis(at);
      return SubscriptionRef.update(live, (current) => {
        const next = new Map<GuestShareId, RoomLive>();
        for (const [id, room] of current) {
          const kept = {
            agents: unexpired(room.agents, now),
            cursors: unexpired(room.cursors, now),
            views: unexpired(room.views, now),
          };
          if (!roomIsEmpty(kept)) next.set(id, kept);
        }
        const room = change(next.get(shareId) ?? EMPTY_ROOM_LIVE, now);
        if (roomIsEmpty(room)) next.delete(shareId);
        else next.set(shareId, room);
        return next;
      });
    });
  /** Moves someone's pointer, and their view unless `view` is absent. Null takes either away. */
  const setCursor = (
    shareId: GuestShareId,
    key: string,
    at: RoomBoardPoint | null,
    view?: RoomBoardViewport | null,
  ) =>
    changeRoom(shareId, (room, now) => {
      const cursors = new Map(room.cursors);
      if (at === null) cursors.delete(key);
      else cursors.set(key, { x: at.x, y: at.y, until: now + CURSOR_TTL_MS });
      if (view === undefined) return { ...room, cursors };
      const views = new Map(room.views);
      if (view === null) views.delete(key);
      else views.set(key, { x: view.x, y: view.y, zoom: view.zoom, until: now + VIEW_TTL_MS });
      return { ...room, cursors, views };
    });
  const clearAgent = (shareId: GuestShareId, guestId: GuestId, id: string) =>
    changeRoom(shareId, (room) => {
      if (room.agents.get(guestId)?.id !== id) return room;
      const agents = new Map(room.agents);
      agents.delete(guestId);
      return { ...room, agents };
    });
  /**
   * A share's live room as it changes, and again every few seconds so what expired drops out
   * with nothing else happening. `changesWith` keeps the ticks from repeating an event.
   */
  const roomEvents = <A>(shareId: GuestShareId, view: (room: RoomLive, now: number) => A) =>
    Stream.merge(
      SubscriptionRef.changes(live),
      Stream.tick(ROOM_LIVE_SWEEP_INTERVAL).pipe(Stream.mapEffect(() => SubscriptionRef.get(live))),
    ).pipe(
      Stream.mapEffect((current) =>
        Effect.map(DateTime.now, (at) =>
          view(current.get(shareId) ?? EMPTY_ROOM_LIVE, DateTime.toEpochMillis(at)),
        ),
      ),
      Stream.changesWith((left, right) => JSON.stringify(left) === JSON.stringify(right)),
    );
  const runningOf = (shareId: GuestShareId) =>
    roomEvents(shareId, (room, now): RoomAgentsEvent => ({
      type: "agents",
      running: [...room.agents]
        .filter(([, agent]) => agent.until > now)
        .map(([guestId, agent]) => ({
          guestId,
          prompt: agent.prompt,
          ...(agent.taskId === undefined ? {} : { taskId: agent.taskId }),
          ...(agent.artifactId === undefined ? {} : { artifactId: agent.artifactId }),
          ...(agent.code === undefined ? {} : { code: agent.code }),
        }))
        .toSorted((left, right) => left.guestId.localeCompare(right.guestId)),
    }));
  /** The room's agents and what each thread box's agent is doing, for the owner or a guest. */
  const agentsOf = (shareId: GuestShareId, reader: "owner" | "guest") =>
    Stream.zipLatestWith(
      runningOf(shareId),
      roomBoxes.progress(shareId),
      (agents, boxes): RoomAgentsEvent => ({
        ...agents,
        boxes: reader === "owner" ? boxes.owner : boxes.guests,
      }),
    );
  /** Everyone's pointers and views but the reader's own. */
  const cursorsOf = (shareId: GuestShareId, reader: string) =>
    roomEvents(shareId, (room, now): RoomCursorsEvent => {
      const others = <V extends Expiring>(entries: ReadonlyMap<string, V>) =>
        [...entries]
          .filter(([key, entry]) => key !== reader && entry.until > now)
          .toSorted(([left], [right]) => left.localeCompare(right))
          .map(([key, { until: _until, ...entry }]) =>
            key === OWNER_CURSOR ? entry : { guestId: GuestId.make(key), ...entry },
          );
      return { type: "cursors", cursors: others(room.cursors), views: others(room.views) };
    });

  /** Where the owner's code is for a shared thread, or null when git cannot say. */
  const ownerCodeOf = Effect.fn("GuestShareService.ownerCodeOf")(
    function* (threadId: ThreadId) {
      const { thread } = yield* orchestrator.getThreadRecords(threadId, []);
      const project = yield* projects.getById(thread.projectId);
      const cwd = thread.worktreePath ?? Option.getOrUndefined(project)?.workspaceRoot;
      if (cwd === undefined) return null;
      return roomCodeStateOf(yield* git.status({ cwd }), thread.branch);
    },
    Effect.orElseSucceed(() => null),
  );
  /** The room's agents as a guest sees them, with where the owner's code is once git says. */
  const agentsWithOwnerCode = (shareId: GuestShareId, threadId: ThreadId) =>
    Stream.suspend(() => {
      let agents: RoomAgentsEvent | null = null;
      let owner: RoomCodeState | null = null;
      const codes = Stream.tick(OWNER_CODE_INTERVAL).pipe(
        Stream.mapEffect(() => ownerCodeOf(threadId)),
        Stream.map((code): ReadonlyArray<RoomAgentsEvent> => {
          if (JSON.stringify(code) === JSON.stringify(owner)) return [];
          owner = code;
          return agents === null ? [] : [agents];
        }),
      );
      return Stream.merge(
        agentsOf(shareId, "guest").pipe(
          Stream.map((event): ReadonlyArray<RoomAgentsEvent> => {
            agents = event;
            return [event];
          }),
        ),
        codes,
      ).pipe(
        Stream.flattenIterable,
        Stream.map((event): RoomAgentsEvent => (owner === null ? event : { ...event, owner })),
      );
    });

  /**
   * The thread as the owner's thread subscription sends it: a bounded snapshot, then the same
   * wire events, batched the same way. Only the share's own state is added.
   */
  const stream = Effect.fn("GuestShareService.stream")(function* (session: string) {
    const { thread, share, guestId } = yield* authorize(session, "session");
    const snapshot = yield* orchestrator
      .getThreadSnapshotWindow(thread.id, {
        rowLimit: SNAPSHOT_ROW_LIMIT,
        userTurnLimit: SNAPSHOT_USER_TURN_LIMIT,
      })
      .pipe(Effect.mapError(() => inactive));
    // Still this link, and still with this guest on it: the owner can remove one guest.
    const stillIn = (current: OrchestrationV2AppThread) => {
      const currentShare = current.guestShare;
      return !!currentShare && currentShare.id === share.id && hasGuest(currentShare, guestId);
    };
    // The share can end between authorize and this read; the live tail starts after it.
    if (
      !stillIn(snapshot.projection.thread) ||
      snapshot.projection.thread.archivedAt !== null ||
      snapshot.projection.thread.deletedAt !== null
    ) {
      return yield* inactive;
    }
    // Read once; a provider or owner name set mid-share shows after the guest reconnects.
    const providers = yield* providerRegistry.getProviders;
    const ownerName = yield* serverSettings.getSettings.pipe(
      Effect.map((settings) => settings.guestOwnerName),
      Effect.orElseSucceed(() => ""),
    );
    const viewOf = (current: OrchestrationV2AppThread) =>
      guestShareView(
        current,
        guestThreadModel(current.modelSelection, providers),
        guestId,
        providerAllowsDirect(current, providers),
        guestSignIn.enabled,
        ownerName,
      );
    const initialView = viewOf(snapshot.projection.thread);
    if (initialView === null) return yield* inactive;
    const { workspaceRoot, redactor: openingRedactor } = yield* redactorFor(
      snapshot.projection.thread,
    );
    // The thread can move to another worktree while the guest watches.
    let redactor = openingRedactor;
    let worktreePath = snapshot.projection.thread.worktreePath;
    const redactorAfter = (updated: OrchestrationV2AppThread | null): GuestRedactor => {
      if (updated !== null && updated.worktreePath !== worktreePath) {
        worktreePath = updated.worktreePath;
        redactor = makeGuestRedactor({
          workspaceRoots: [worktreePath, workspaceRoot],
          homeDirectory,
        });
      }
      return redactor;
    };

    const ended = openingRedactor.redact<GuestStreamEvent>({ type: "ended" });
    const endsShare = (event: OrchestrationV2DomainEvent) => {
      if (event.type === "thread.archived" || event.type === "thread.deleted") return true;
      const updated = threadOf(event);
      return updated !== null && !stillIn(updated);
    };
    const live = orchestrator
      .streamStoredEventsFrom({ threadId: thread.id, afterSequence: snapshot.snapshotSequence })
      .pipe(
        Stream.map(threadStreamEventItem),
        // Ending the source here flushes what the coalescer holds, so `ended` is not held back.
        Stream.takeUntil((item) => endsShare(item.event)),
        coalesceThreadLiveStream,
        Stream.map((item): ReadonlyArray<GuestSafe<GuestStreamEvent>> => {
          if (item.kind !== "event") return [];
          if (endsShare(item.event)) return [ended];
          if (item.event.type === "turn-item.updated") rememberSent(share.id, [item.event.payload]);
          const updated = threadOf(item.event);
          const current = redactorAfter(
            typeof item.event.payload === "object" && "lineage" in item.event.payload
              ? item.event.payload
              : null,
          );
          const safeItem = current.streamItem(item);
          const view = updated === null ? null : viewOf(updated);
          return [
            ...(safeItem === null
              ? []
              : [current.redact<GuestStreamEvent>({ type: "thread", item: safeItem })]),
            ...(view === null ? [] : [current.redact<GuestStreamEvent>({ type: "view", view })]),
          ];
        }),
        Stream.flattenIterable,
        // A failed read closes the response without `ended`: the browser reconnects, and
        // `authorize` decides whether the link still works.
        Stream.catchCause(() => Stream.empty),
        Stream.merge(
          presence(thread.id).pipe(
            Stream.map(({ online }) =>
              openingRedactor.redact<GuestStreamEvent>({ type: "presence", online }),
            ),
          ),
          { haltStrategy: "left" },
        ),
        Stream.merge(
          agentsWithOwnerCode(share.id, thread.id).pipe(
            Stream.map((event) => openingRedactor.redact<GuestStreamEvent>(event)),
          ),
          { haltStrategy: "left" },
        ),
        Stream.merge(
          cursorsOf(share.id, guestId ?? OWNER_CURSOR).pipe(
            Stream.map((event) => openingRedactor.redact<GuestStreamEvent>(event)),
          ),
          { haltStrategy: "left" },
        ),
      );
    const untilExpiry = Effect.sleep(
      Math.max(0, Date.parse(share.expiresAt) - DateTime.toEpochMillis(yield* DateTime.now)),
    );
    const openingSnapshot = buildBoundedThreadStreamSnapshot({
      snapshotSequence: snapshot.snapshotSequence,
      projection: snapshot.projection,
    });
    const safeSnapshot = openingRedactor.streamItem(openingSnapshot);
    const opening = [
      openingRedactor.redact<GuestStreamEvent>({ type: "view", view: initialView }),
      ...(safeSnapshot === null
        ? []
        : [openingRedactor.redact<GuestStreamEvent>({ type: "thread", item: safeSnapshot })]),
    ];
    const events = Stream.fromIterable(opening).pipe(
      Stream.concat(
        Stream.merge(live, Stream.fromEffect(Effect.as(untilExpiry, ended)), {
          haltStrategy: "either",
        }),
      ),
      Stream.takeUntil((event) => event.type === "ended"),
      // Unlinking T3 Connect closes it quietly, so a tunnel that comes back on the same host
      // keeps the guest in. Turning the beta off closes it the same way. Closing and expiry end
      // it above, with `ended`.
      Stream.interruptWhen(
        Effect.all([connectHostname, sharingEnabled]).pipe(
          Effect.repeat({
            schedule: Schedule.spaced(ACCESS_RECHECK_INTERVAL),
            until: ([host, enabled]) => host !== share.host || !enabled,
          }),
        ),
      ),
    );
    // The record is opened and counted when the stream runs, paired with its release, so a
    // response whose body never runs (HEAD) touches nothing.
    return Stream.unwrap(
      Effect.acquireRelease(
        Effect.sync(() => {
          const record = sentRecord(share.id);
          record.openStreams += 1;
          rememberSent(
            share.id,
            openingSnapshot.projection.visibleTurnItems.map((row) => row.item),
          );
          return record;
        }).pipe(
          Effect.tap(() =>
            guestId === undefined ? Effect.void : countViewer(thread.id, guestId, 1),
          ),
        ),
        (record) =>
          Effect.sync(() => {
            record.openStreams -= 1;
          }).pipe(
            Effect.andThen(
              guestId === undefined
                ? Effect.void
                : countViewer(thread.id, guestId, -1).pipe(
                    // Their last page closed, so their pointer and view leave the board with it.
                    Effect.andThen(isViewing(thread.id, guestId)),
                    Effect.flatMap((still) =>
                      still ? Effect.void : setCursor(share.id, guestId, null, null),
                    ),
                  ),
            ),
          ),
      ).pipe(Effect.as(events)),
    );
  });

  const handoff = Effect.fn("GuestShareService.handoff")(function* (session: string) {
    const { thread, share, guestId } = yield* authorize(session, "session");
    const token = yield* signSession({
      kind: "handoff",
      threadId: thread.id,
      shareId: share.id,
      ...(guestId === undefined ? {} : { guestId }),
      expiresAt: DateTime.toEpochMillis(yield* DateTime.now) + GUEST_HANDOFF_TTL_MS,
    });
    yield* analytics.record("feature.used", { feature: "guest_share.handoff" });
    return { token };
  });

  /**
   * The branch the thread works on and whether its remote has all of it. Null when the thread
   * has no repository with a remote, or git cannot say: the guest then gets the conversation only.
   */
  const checkoutOf = Effect.fn("GuestShareService.checkoutOf")(
    function* (thread: OrchestrationV2AppThread) {
      const project = yield* projects.getById(thread.projectId);
      if (Option.isNone(project)) return null;
      const cwd = thread.worktreePath ?? project.value.workspaceRoot;
      const identity = yield* repositoryIdentities.resolve(cwd);
      const status = yield* git.status({ cwd });
      const branch = status.refName ?? thread.branch;
      if (identity === null || branch === null) return null;
      return {
        repositoryKey: repositoryGroupingKeyOf(identity),
        branch,
        synced: isBranchSynced(status),
      } satisfies SharedThreadCheckout;
    },
    Effect.orElseSucceed(() => null),
  );

  const exportThread = Effect.fn("GuestShareService.exportThread")(function* (token: string) {
    const { thread, share, guestId } = yield* authorize(token, "handoff");
    // What the guest's page opens with: the same window, so nothing they could not already read.
    const window = yield* orchestrator
      .getThreadSnapshotWindow(thread.id, {
        rowLimit: SNAPSHOT_ROW_LIMIT,
        userTurnLimit: SNAPSHOT_USER_TURN_LIMIT,
      })
      .pipe(Effect.mapError(() => inactive));
    const snapshot = buildBoundedThreadStreamSnapshot({
      snapshotSequence: window.snapshotSequence,
      projection: window.projection,
    });
    const spoken = snapshot.projection.visibleTurnItems.flatMap(
      ({ item }): ReadonlyArray<SharedThreadMessage> =>
        (item.type === "user_message" || (item.type === "assistant_message" && !item.streaming)) &&
        item.text.trim() !== ""
          ? [
              {
                role: item.type === "user_message" ? "user" : "assistant",
                text: item.text,
                createdAt: DateTime.formatIso(item.updatedAt),
              },
            ]
          : [],
    );
    // The newest messages that fit, and always the last one.
    const kept: Array<SharedThreadMessage> = [];
    let chars = 0;
    for (const message of spoken.toReversed()) {
      const over =
        kept.length >= SHARED_THREAD_MAX_MESSAGES ||
        chars + message.text.length > SHARED_THREAD_MAX_CHARS;
      if (over && kept.length > 0) break;
      kept.push(message);
      chars += message.text.length;
    }
    const { redactor } = yield* redactorFor(thread);
    return redactor.redact<SharedThreadExport>({
      title: thread.title,
      messages: kept.toReversed(),
      truncated: snapshot.hasMoreHistory === true || kept.length < spoken.length,
      checkout: yield* checkoutOf(thread),
      ...(guestId === undefined
        ? {}
        : {
            room: {
              token: yield* signSession({
                kind: "room",
                threadId: thread.id,
                shareId: share.id,
                guestId,
              }),
              expiresAt: share.expiresAt,
              shareId: share.id,
            },
          }),
    });
  });

  // When each guest's machine last asked, so one cannot flood the room. In memory: a restart
  // forgets at most a minute.
  const rateLimit = (limit: number, windowMs = GUEST_TURN_RATE_WINDOW_MS) => {
    const requests = new Map<string, Array<number>>();
    return (key: string, now: number) => {
      const recent = (requests.get(key) ?? []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) return false;
      for (const [other, times] of requests) {
        if (times.every((at) => now - at >= windowMs)) requests.delete(other);
      }
      requests.set(key, [...recent, now]);
      return true;
    };
  };
  const allowTurnPost = rateLimit(GUEST_TURN_RATE_LIMIT);
  const allowUpdatesRead = rateLimit(ROOM_UPDATES_RATE_LIMIT);
  const allowBoardChange = rateLimit(BOARD_CHANGE_RATE_LIMIT);
  const allowActivity = rateLimit(AGENT_ACTIVITY_RATE_LIMIT);
  const allowCursorMove = rateLimit(CURSOR_RATE_LIMIT, CURSOR_RATE_WINDOW_MS);

  const postTurn = Effect.fn("GuestShareService.postTurn")(function* (
    token: string,
    request: GuestTurnRequest,
  ) {
    const { thread, share, guestId } = yield* authorize(token, "room");
    if (guestId === undefined) return yield* new GuestShareAccessError({ reason: "ended" });
    // Characters nobody can see have no place in text the whole room reads.
    const prompt = sanitizeLinkedPrompt(request.prompt).text.trim();
    const reply = sanitizeLinkedPrompt(request.reply).text.trim();
    if (reply === "") return yield* new GuestShareAccessError({ reason: "empty" });
    if (!allowTurnPost(`${share.id}:${guestId}`, DateTime.toEpochMillis(yield* DateTime.now))) {
      return yield* new GuestShareAccessError({ reason: "too_fast" });
    }
    const { artifact: posted, ...turn } = request;
    // What fills the card is taken from the body again, as from any reply, so a guest's machine
    // can put no more in it than an agent's reply would.
    const filled =
      posted === undefined ? undefined : roomArtifactBody(sanitizeLinkedPrompt(posted.body).text);
    const artifact =
      posted === undefined || filled === undefined || filled.body === ""
        ? undefined
        : {
            noteId: posted.noteId,
            body: filled.body,
            ...(posted.truncated === true || filled.truncated ? { truncated: true } : {}),
          };
    yield* dispatchGuestCommand({
      type: "thread.guest-turn.post",
      commandId: yield* commandId("turn"),
      threadId: thread.id,
      shareId: share.id,
      guestId,
      turn: { ...turn, prompt, reply, ...(artifact === undefined ? {} : { artifact }) },
    });
    yield* clearAgent(share.id, guestId, request.id);
    yield* analytics.record("feature.used", { feature: "guest_share.turn" });
  });

  const postActivity = Effect.fn("GuestShareService.postActivity")(function* (
    token: string,
    request: GuestAgentActivityRequest,
  ) {
    const { share, guestId } = yield* authorize(token, "room");
    if (guestId === undefined) return yield* new GuestShareAccessError({ reason: "ended" });
    // The card shows the agent working only on a task that is the guest's to take.
    const task = share.board?.notes.find((note) => note.id === request.taskId);
    const taskId =
      task?.kind === "task" && (task.assignee === undefined || task.assignee.guestId === guestId)
        ? task.id
        : undefined;
    const artifactId = share.board?.notes.find(
      (note) => note.id === request.artifactId && note.kind === "artifact",
    )?.id;
    if (!allowActivity(`${share.id}:${guestId}`, DateTime.toEpochMillis(yield* DateTime.now))) {
      return yield* new GuestShareAccessError({ reason: "too_fast" });
    }
    if (request.state === "idle") return yield* clearAgent(share.id, guestId, request.id);
    const prompt = clip(
      sanitizeLinkedPrompt(request.prompt ?? "")
        .text.replace(/\s+/g, " ")
        .trim(),
      GUEST_AGENT_PROMPT_MAX_LENGTH,
    );
    yield* changeRoom(share.id, (room, now) => ({
      ...room,
      agents: new Map(room.agents).set(guestId, {
        id: request.id,
        prompt,
        ...(taskId === undefined ? {} : { taskId }),
        ...(artifactId === undefined ? {} : { artifactId }),
        ...(request.code === undefined ? {} : { code: request.code }),
        until: now + AGENT_ACTIVITY_TTL_MS,
      }),
    }));
  });

  /** Whether the owner's thread still shares this share, for a read of its live room. */
  const ownsRoom = (input: RoomLiveInput) =>
    orchestrator.getThreadRecords(input.threadId, []).pipe(
      Effect.map(({ thread }) => thread.guestShare?.id === input.shareId),
      Effect.orElseSucceed(() => false),
    );
  const roomAgents = (input: RoomLiveInput) =>
    Stream.unwrap(
      Effect.map(ownsRoom(input), (owned) =>
        owned ? agentsOf(input.shareId, "owner") : Stream.empty,
      ),
    );
  // Shares whose owner has the board open, counted per board: only then is their pointer shown.
  const ownerBoards = new Map<GuestShareId, number>();
  const roomCursors = (input: RoomLiveInput) =>
    Stream.unwrap(
      Effect.map(ownsRoom(input), (owned) =>
        owned
          ? Stream.unwrap(
              Effect.acquireRelease(
                Effect.sync(() => {
                  ownerBoards.set(input.shareId, (ownerBoards.get(input.shareId) ?? 0) + 1);
                }),
                () =>
                  Effect.suspend(() => {
                    const left = (ownerBoards.get(input.shareId) ?? 1) - 1;
                    if (left > 0) {
                      ownerBoards.set(input.shareId, left);
                      return Effect.void;
                    }
                    ownerBoards.delete(input.shareId);
                    return setCursor(input.shareId, OWNER_CURSOR, null, null);
                  }),
              ).pipe(Effect.as(cursorsOf(input.shareId, OWNER_CURSOR))),
            )
          : Stream.empty,
      ),
    );

  // Untraced: a pointer moves many times a second. Checked against the open board or page in
  // memory, not the thread record: the page's stream ends when the guest loses access.
  const moveCursor = Effect.fnUntraced(function* (
    by: RoomLiveInput | { readonly session: string },
    at: RoomBoardPoint | null,
    view?: RoomBoardViewport | null,
  ) {
    if (!("session" in by)) {
      if (!ownerBoards.has(by.shareId)) return yield* inactive;
      return yield* setCursor(by.shareId, OWNER_CURSOR, at, view);
    }
    const claims = yield* verifySession(by.session);
    if (Option.isNone(claims) || claims.value.kind !== "session") {
      return yield* new GuestShareAccessError({ reason: "invalid" });
    }
    const { threadId, shareId, guestId } = claims.value;
    if (guestId === undefined || !(yield* isViewing(threadId, guestId))) return yield* inactive;
    const now = DateTime.toEpochMillis(yield* DateTime.now);
    const moves = at !== null || (view !== undefined && view !== null);
    if (moves && !allowCursorMove(`${shareId}:${guestId}`, now)) {
      return yield* new GuestShareAccessError({ reason: "too_fast" });
    }
    yield* setCursor(shareId, guestId, at, view);
  });

  const roomUpdates = Effect.fn("GuestShareService.roomUpdates")(function* (
    token: string,
    after: string | null,
  ) {
    const { thread, share, guestId } = yield* authorize(token, "room");
    if (guestId === undefined) return yield* new GuestShareAccessError({ reason: "ended" });
    if (!allowUpdatesRead(`${share.id}:${guestId}`, DateTime.toEpochMillis(yield* DateTime.now))) {
      return yield* new GuestShareAccessError({ reason: "too_fast" });
    }
    // The window the guest's page opens with, so nothing they could not already read.
    const window = yield* orchestrator
      .getThreadSnapshotWindow(thread.id, {
        rowLimit: SNAPSHOT_ROW_LIMIT,
        userTurnLimit: SNAPSHOT_USER_TURN_LIMIT,
      })
      .pipe(Effect.mapError(() => inactive));
    const snapshot = buildBoundedThreadStreamSnapshot({
      snapshotSequence: window.snapshotSequence,
      projection: window.projection,
    });
    const { redactor } = yield* redactorFor(thread);
    return redactor.redact(
      roomUpdatesOf({
        items: snapshot.projection.visibleTurnItems.map((row) => row.item),
        runs: snapshot.projection.runs,
        hasMoreHistory: snapshot.hasMoreHistory === true,
        share,
        guestId,
        after,
      }),
    );
  });

  const roomArtifact = Effect.fn("GuestShareService.roomArtifact")(function* (
    token: string,
    noteId: string,
  ) {
    const { thread, share, guestId } = yield* authorize(token, "room");
    if (guestId === undefined) return yield* new GuestShareAccessError({ reason: "ended" });
    if (!allowUpdatesRead(`${share.id}:${guestId}`, DateTime.toEpochMillis(yield* DateTime.now))) {
      return yield* new GuestShareAccessError({ reason: "too_fast" });
    }
    const note = share.board?.notes.find(
      (candidate) => candidate.id === noteId && candidate.kind === "artifact",
    );
    if (note === undefined) return yield* new GuestShareAccessError({ reason: "artifact_gone" });
    const { redactor } = yield* redactorFor(thread);
    // The same card the guest's board shows them.
    return redactor.redact<RoomArtifactRead>({
      title: note.text,
      ...(note.artifact === undefined ? {} : { body: note.artifact.body }),
    });
  });

  const unavailable = new GuestShareAccessError({ reason: "unavailable" });

  /** Who is changing which share's board: a guest by their session, or the thread's owner. */
  const boardAuthor = Effect.fn("GuestShareService.boardAuthor")(function* (
    by: { readonly threadId: ThreadId } | { readonly session: string },
  ) {
    if ("threadId" in by) {
      const { thread } = yield* orchestrator
        .getThreadRecords(by.threadId, [])
        .pipe(Effect.mapError(() => inactive));
      if (!thread.guestShare) return yield* inactive;
      return { threadId: thread.id, shareId: thread.guestShare.id, author: null };
    }
    const { thread, share, guestId } = yield* authorize(by.session, "session");
    // The one guest of a link made before several could join has no id to sign a note with.
    if (guestId === undefined) return yield* unavailable;
    if (!allowBoardChange(`${share.id}:${guestId}`, DateTime.toEpochMillis(yield* DateTime.now))) {
      return yield* new GuestShareAccessError({ reason: "too_fast" });
    }
    return { threadId: thread.id, shareId: share.id, author: guestId };
  });

  const changeBoard = Effect.fn("GuestShareService.changeBoard")(function* (
    by: { readonly threadId: ThreadId } | { readonly session: string },
    change: RoomBoardChange,
  ) {
    const { threadId, shareId, author } = yield* boardAuthor(by);
    yield* dispatchGuestCommand({
      type: "thread.guest-board.change",
      commandId: yield* commandId("board"),
      threadId,
      shareId,
      author,
      change:
        change.type === "note.put"
          ? // Characters nobody can see have no place in text the whole room reads.
            { ...change, text: sanitizeLinkedPrompt(change.text).text }
          : change,
    });
  });

  /** An item of the shared thread, read after the session check. */
  const threadItem = Effect.fn("GuestShareService.threadItem")(function* (
    session: string,
    itemId: string,
  ) {
    const { thread } = yield* authorize(session, "session");
    const item = yield* orchestrator
      .getTurnItem({ threadId: thread.id, itemId: TurnItemId.make(itemId) })
      .pipe(Effect.mapError(() => unavailable));
    return item === null ? yield* unavailable : { thread, item };
  });

  const render = Effect.fn("GuestShareService.render")(function* (session: string, itemId: string) {
    const { thread, item } = yield* threadItem(session, itemId);
    if (item.type !== "dynamic_tool") return yield* unavailable;
    const reference = htmlRenderFromToolItem(item);
    const [attachmentId] = threadHtmlRenderAttachmentIds(thread.id, [item]);
    const path =
      attachmentId === undefined
        ? null
        : resolveAttachmentPathById({ attachmentsDir, attachmentId });
    if (reference === undefined || path === null) return yield* unavailable;
    return { path, title: reference.title };
  });

  const item = Effect.fn("GuestShareService.item")(function* (session: string, itemId: string) {
    const { thread, item } = yield* threadItem(session, itemId);
    const { redactor } = yield* redactorFor(thread);
    return redactor.redact<OrchestrationV2GetTurnItemResult>({
      item:
        item.type === "file_change" ? projectTurnItemForWire(item) : projectTurnItemForDetail(item),
    });
  });

  const history = Effect.fn("GuestShareService.history")(function* (
    session: string,
    cursor: string,
  ) {
    const { thread, share } = yield* authorize(session, "session");
    const page = yield* orchestrator
      .getThreadHistoryPage(thread.id, cursor)
      .pipe(Effect.mapError(() => unavailable));
    rememberSent(
      share.id,
      page.items.map((row) => row.item),
    );
    const { redactor } = yield* redactorFor(thread);
    return redactor.redact(page);
  });

  const commandOutput = Effect.fn("GuestShareService.commandOutput")(function* (
    session: string,
    itemId: string,
  ) {
    const { thread, item } = yield* threadItem(session, itemId);
    if (item.type !== "command_execution") return yield* unavailable;
    const { redactor } = yield* redactorFor(thread);
    return commandOutputs.subscribe({ threadId: thread.id, itemId: item.id }).pipe(
      Stream.map((frame) => redactor.redact(frame)),
      // A lost hub stream ends the output; the row reloads it when reopened.
      Stream.catchCause(() => Stream.empty),
      Stream.interruptWhen(untilRevoked(session)),
    );
  });

  const attachment = Effect.fn("GuestShareService.attachment")(function* (
    session: string,
    attachmentId: string,
  ) {
    const { thread, share } = yield* authorize(session, "session");
    // A dismissed message's files are deleted with it.
    const fromShare = share.messages
      .flatMap((message) => (message.status === "dismissed" ? [] : (message.attachments ?? [])))
      .find((candidate) => candidate.id === attachmentId);
    const found =
      fromShare ??
      (yield* orchestrator.getThreadRecords(thread.id, ["messages"]).pipe(
        Effect.map(({ messages }) =>
          messages
            .flatMap((message) => message.attachments ?? [])
            .find((candidate) => candidate.id === attachmentId),
        ),
        Effect.mapError(() => unavailable),
      )) ??
      // A fork shows its source's earlier messages, which stay in the source thread.
      (thread.forkedFrom === null
        ? undefined
        : yield* orchestrator.getTimelinePage(thread.id, { attachmentId, limit: 1 }).pipe(
            Effect.map(({ items }) =>
              items
                .flatMap(({ item }) => (item.type === "user_message" ? item.attachments : []))
                .find((candidate) => candidate.id === attachmentId),
            ),
            Effect.mapError(() => unavailable),
          ));
    const path =
      found === undefined ? null : resolveAttachmentPath({ attachmentsDir, attachment: found });
    if (found === undefined || path === null) return yield* unavailable;
    const exists = yield* fileSystem.exists(path).pipe(Effect.orElseSucceed(() => false));
    return exists ? { path, attachment: found } : yield* unavailable;
  });

  const media = Effect.fn("GuestShareService.media")(function* (session: string, shown: string) {
    const { thread, share } = yield* authorize(session, "session");
    const sent = sentImageReplies.get(share.id)?.replies.values() ?? [];
    const { redactor } = yield* redactorFor(thread);
    // Each sent reply is parsed once, on the first request that needs it. The guest names the
    // path as their copy of the reply shows it; the file is read from where it is.
    const path = shownImageHostPath(
      shown,
      [...sent],
      (reply) => (reply.sources ??= chatMarkdownImageSources(reply.text)),
      redactor.path,
    );
    const mimeType = path === null ? null : guestHostImageType(path);
    if (path === null || mimeType === null) return yield* unavailable;
    // The bytes must be the image the name says, as for a guest's own upload.
    const header = yield* fileSystem.open(path, { flag: "r" }).pipe(
      Effect.flatMap((file) => file.readAlloc(GUEST_UPLOAD_HEADER_BYTES)),
      Effect.scoped,
      Effect.mapError(() => unavailable),
    );
    if (Option.isNone(header) || !matchesImageSignature(mimeType, header.value)) {
      return yield* unavailable;
    }
    return { path, mimeType };
  });

  return GuestShareService.of({
    create,
    checkInvite,
    redeem,
    check,
    sessionShareId,
    submit,
    signIn,
    signInFromHostedApp,
    signInFinish,
    stream,
    presence,
    handoff,
    exportThread,
    postTurn,
    postActivity,
    roomAgents,
    roomCursors,
    moveCursor,
    roomUpdates,
    roomArtifact,
    changeBoard,
    render,
    item,
    history,
    commandOutput,
    attachment,
    media,
  });
});

export const layer = Layer.effect(GuestShareService, make);
