import * as Schema from "effect/Schema";

import { GuestId, GuestShareId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import {
  CloudBoardLinkSharing,
  RoomAgentsEvent,
  RoomBoard,
  RoomCursorsEvent,
  ThreadGuest,
  ThreadGuestMessage,
  ThreadGuestTurn,
} from "./guestShare.ts";
import { OrchestrationV2ThreadStreamItem } from "./orchestrationV2.ts";
import { ProviderDriverKind } from "./providerInstance.ts";

// This lives apart from guestShare.ts because orchestrationV2.ts imports that file.

/**
 * What the composer's model label shows; nothing else from the owner's provider settings. The
 * driver is null when the thread's provider is no longer configured.
 */
export const GuestThreadModel = Schema.Struct({
  driver: Schema.NullOr(ProviderDriverKind),
  name: TrimmedNonEmptyString,
  shortName: Schema.optional(TrimmedNonEmptyString),
  subProvider: Schema.optional(TrimmedNonEmptyString),
});
export type GuestThreadModel = typeof GuestThreadModel.Type;

export const GuestShareView = Schema.Struct({
  shareId: GuestShareId,
  title: Schema.String,
  /** Who shared the thread, when the owner chose a name to show. Absent from an older server. */
  ownerName: Schema.optional(TrimmedNonEmptyString),
  /** The guest this view is for. */
  guestName: TrimmedNonEmptyString,
  /** Absent for the one guest of a link made before several could join. */
  guestId: Schema.optional(GuestId),
  /** Everyone on the link, this guest included. */
  guests: Schema.Array(ThreadGuest),
  /** This guest's messages reach the agent as they are sent, with no wait for the owner. */
  direct: Schema.Boolean,
  /** The owner's server can sign a guest in with GitHub. Absent from an older server. */
  signIn: Schema.optional(Schema.Boolean),
  expiresAt: IsoDateTime,
  /** Every guest's messages, so the guests see what each other asked. */
  messages: Schema.Array(ThreadGuestMessage),
  /** Turns guests ran on their own machines. Absent from an older server. */
  turns: Schema.optional(Schema.Array(ThreadGuestTurn)),
  /** The room's board. Absent while nothing is arranged on it, and from an older server. */
  board: Schema.optional(RoomBoard),
  /**
   * The room lives on the cloud board host, on nobody's machine: it has no owner, and no thread
   * or agent of its own. Absent for a room an owner's machine serves.
   */
  cloud: Schema.optional(Schema.Boolean),
  /**
   * With `cloud`: people can bring their own machine's agent to the board (handoff, export and
   * the room routes), as on a room an owner's machine serves. Absent from an older cloud host.
   */
  machines: Schema.optional(Schema.Literal(true)),
  /**
   * With `cloud`: the person who made the board, the same for everyone; compare with `guestId`.
   * Only they can delete it or remove others. Absent on a board made before it was kept, or once
   * its maker left.
   */
  maker: Schema.optional(GuestId),
  /**
   * With `cloud`: this person can only look, from the view link (no `guestId`) or because the
   * board's maker made them a viewer. The host refuses every change from them.
   */
  viewOnly: Schema.optional(Schema.Literal(true)),
  /** With `cloud`: the people on the board who can only look. */
  viewers: Schema.optional(Schema.Array(GuestId)),
  /** With `cloud`: this person turns the board's links on and off and says who can edit. */
  manage: Schema.optional(Schema.Literal(true)),
  /**
   * With `cloud`: the board's links this person may hand on, as credentials. `edit` is null while
   * it is off, and absent where the host does not know it (a board from before it kept it) or for
   * someone who can only look. `view` is absent while it is off.
   */
  links: Schema.optional(
    Schema.Struct({
      edit: Schema.optional(Schema.NullOr(TrimmedNonEmptyString)),
      view: Schema.optional(TrimmedNonEmptyString),
    }),
  ),
  /**
   * With `cloud`, for someone on the board: its link sharing. `links` holds only the links
   * that let people in now. Absent from an older host.
   */
  sharing: Schema.optional(CloudBoardLinkSharing),
  model: GuestThreadModel,
  /**
   * With `cloud`: when this board last put something in this person's account inbox, so their
   * open page reads its inbox again at once.
   */
  inboxAt: Schema.optional(IsoDateTime),
  /**
   * With `cloud`, for someone looking on from the view link: the edit access requests approved in
   * the last few minutes. The page that asked finds its own and opens the board as its account.
   */
  granted: Schema.optional(Schema.Array(TrimmedNonEmptyString)),
  /** With `cloud`: anyone who can see the board may make their own copy of it. */
  copies: Schema.optional(Schema.Literal(true)),
});
export type GuestShareView = typeof GuestShareView.Type;

/**
 * The shared thread as the owner's client gets it: `thread` carries the same stream items the
 * owner's thread subscription sends, starting with a snapshot on every (re)connect. `view` is the
 * share itself, sent first and again when it changes.
 */
export const GuestStreamEvent = Schema.Union([
  Schema.Struct({ type: Schema.Literal("view"), view: GuestShareView }),
  Schema.Struct({ type: Schema.Literal("thread"), item: OrchestrationV2ThreadStreamItem }),
  /** The guests with the page open, sent when the stream opens and whenever that changes. */
  Schema.Struct({
    type: Schema.Literal("presence"),
    online: Schema.Array(GuestId),
    /** On a cloud board: how many look on from its view link now, never among `online`. */
    viewing: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
  }),
  // A client decodes each event on its own and skips one it does not know, so an older one
  // ignores these.
  RoomAgentsEvent,
  RoomCursorsEvent,
  Schema.Struct({
    type: Schema.Literal("ended"),
    /** Why it ended, where the host can name it; absent from an older host or a lost session. */
    detail: Schema.optional(Schema.String),
  }),
]);
export type GuestStreamEvent = typeof GuestStreamEvent.Type;
