import * as Schema from "effect/Schema";

import { GuestId, GuestShareId, IsoDateTime, TrimmedNonEmptyString } from "./baseSchemas.ts";
import { RoomBoard, ThreadGuest, ThreadGuestMessage, ThreadGuestTurn } from "./guestShare.ts";
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
  model: GuestThreadModel,
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
  Schema.Struct({ type: Schema.Literal("presence"), online: Schema.Array(GuestId) }),
  Schema.Struct({ type: Schema.Literal("ended") }),
]);
export type GuestStreamEvent = typeof GuestStreamEvent.Type;
