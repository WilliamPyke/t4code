import {
  GUEST_MESSAGE_MAX_ATTACHMENT_BYTES,
  GUEST_MESSAGE_MAX_ATTACHMENTS,
  isCloudBoardViewCredential,
  isProviderSendTurnSupportedImageMimeType,
  type GuestMessageId,
  type GuestShareView,
  type OrchestrationV2ProjectedTurnItem,
  type OrchestrationV2TurnItem,
  type ThreadGuestMessage,
} from "@t3tools/contracts";

const guestMessageIdOf = (item: OrchestrationV2TurnItem) =>
  item.type === "user_message" ? item.context?.guest?.guestMessageId : undefined;

/**
 * The messages this page saw waiting that have no transcript row yet: the view's pending ones
 * join, and one leaves once its row arrives, so a later bounded snapshot cannot bring it back.
 * Returns the same set when nothing changed.
 */
export function nextAwaitingRowIds(
  awaiting: ReadonlySet<GuestMessageId>,
  view: GuestShareView | null,
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
): ReadonlySet<GuestMessageId> {
  const pending = (view?.messages ?? []).filter((message) => message.status === "pending");
  const placed = new Set(items.flatMap((row) => guestMessageIdOf(row.item) ?? []));
  const next = new Set(awaiting);
  for (const message of pending) next.add(message.id);
  for (const id of placed) next.delete(id);
  return next.size === awaiting.size && [...next].every((id) => awaiting.has(id)) ? awaiting : next;
}

/**
 * The guest's messages to show after the transcript, oldest first. Pending ones always show. A
 * sent or dismissed one shows only while it awaits a row (see `nextAwaitingRowIds`): a queued
 * send, or a dismissal to report. The transcript is a bounded window, so any other resolved
 * message is old history, not something to place at the end.
 */
export function unplacedGuestMessages(
  messages: ReadonlyArray<ThreadGuestMessage>,
  items: ReadonlyArray<OrchestrationV2ProjectedTurnItem>,
  awaitingRowIds: ReadonlySet<GuestMessageId>,
): ReadonlyArray<ThreadGuestMessage> {
  const placed = new Set(items.flatMap((row) => guestMessageIdOf(row.item) ?? []));
  return messages
    .filter(
      (message) =>
        !placed.has(message.id) && (message.status === "pending" || awaitingRowIds.has(message.id)),
    )
    .toSorted((a, b) => a.submittedAt.localeCompare(b.submittedAt));
}

/**
 * The share an invite (`<shareId>.<signature>`) opens. Only used to find this browser's session
 * for it; the server checks the signature.
 */
export function inviteShareId(credential: string): string | null {
  const [shareId, signature] = credential.split(".");
  return shareId && signature ? shareId : null;
}

/**
 * What opening a guest link does. A share this browser already joined opens with its stored
 * session, so the same person does not join twice under a new name; with an invite in hand that
 * session is checked first, and the invite joins again only if the host refuses it. A board only
 * looked at from its view link is joined when an edit link for it comes.
 */
export function guestEntryStep<
  Share extends { readonly shareId: string; readonly viewOnly?: boolean | undefined },
>(
  joined: ReadonlyArray<Share>,
  entry: { readonly credential: string | null; readonly shareId: string | null },
):
  | { readonly step: "open" | "check"; readonly share: Share }
  | { readonly step: "join" | "invalid" } {
  const shareId = entry.credential === null ? entry.shareId : inviteShareId(entry.credential);
  const share = shareId === null ? undefined : joined.find((one) => one.shareId === shareId);
  const editsNow =
    share?.viewOnly === true &&
    entry.credential !== null &&
    !isCloudBoardViewCredential(entry.credential);
  if (share !== undefined && !editsNow) {
    return { step: entry.credential === null ? "open" : "check", share };
  }
  return { step: shareId !== null && entry.credential !== null ? "join" : "invalid" };
}

/**
 * What a board's plain address (no invite in it) shows on a browser with no session for it: the
 * board once a session is here; for a cloud board, the signed-in account opening it as its own
 * seat or workspace access, which bookmarks and pasted links need on a new device; and only when
 * that is not possible or the host refused, that the board ended or the link is not valid.
 */
export function guestBoardOpenStep(input: {
  readonly hasSession: boolean;
  readonly reopening: boolean;
  readonly cloud: boolean;
  readonly account: "off" | "loading" | "signed-out" | "signed-in";
  /** The account already asked the host, and it refused. */
  readonly accountRefused: boolean;
}): "board" | "opening" | "account" | "invalid" {
  if (input.hasSession) return "board";
  if (input.reopening) return "opening";
  if (!input.cloud || input.accountRefused) return "invalid";
  if (input.account === "loading") return "opening";
  return input.account === "signed-in" ? "account" : "invalid";
}

/**
 * How an edit link's invite is joined. A signed-in account with a name joins a cloud board under
 * it at once; anyone else is asked, an account with no name included, and what it answers becomes
 * its name. Nobody joins under a name they did not choose.
 */
export function inviteJoinStep(input: {
  readonly cloud: boolean;
  readonly account:
    | { readonly status: "off" | "loading" | "signed-out" }
    | { readonly status: "signed-in"; readonly name: string | null };
  /** Joining as the account was refused; the form says why and asks instead. */
  readonly failed: boolean;
}): { readonly step: "ask" | "wait" } | { readonly step: "join"; readonly name: string } {
  const { account } = input;
  if (!input.cloud || input.failed) return { step: "ask" };
  if (account.status === "loading") return { step: "wait" };
  if (account.status !== "signed-in") return { step: "ask" };
  const name = account.name?.trim() ?? "";
  return name === "" ? { step: "ask" } : { step: "join", name };
}

const GUEST_ENVIRONMENT_PREFIX = "guest-share-";

/** The share a board's address names by its environment, or null for any other address. */
export const guestShareIdOfEnvironment = (environmentId: string): string | null =>
  environmentId.startsWith(GUEST_ENVIRONMENT_PREFIX)
    ? environmentId.slice(GUEST_ENVIRONMENT_PREFIX.length) || null
    : null;

/**
 * Why these files cannot go with one message, or null. The server checks the same limits; this
 * only says so before the upload.
 */
export function guestFilesProblem(
  files: ReadonlyArray<Pick<File, "type" | "size">>,
): string | null {
  if (files.length > GUEST_MESSAGE_MAX_ATTACHMENTS) {
    return `Attach up to ${GUEST_MESSAGE_MAX_ATTACHMENTS} files to a message.`;
  }
  if (files.reduce((total, file) => total + file.size, 0) > GUEST_MESSAGE_MAX_ATTACHMENT_BYTES) {
    return "Attached files can total up to 10 MB per message.";
  }
  const unsupported = files.some(
    (file) =>
      file.size === 0 ||
      (file.type.toLowerCase().startsWith("image/") &&
        !isProviderSendTurnSupportedImageMimeType(file.type)),
  );
  return unsupported
    ? "This file cannot be attached. Images must be PNG, JPEG, GIF, or WebP."
    : null;
}
