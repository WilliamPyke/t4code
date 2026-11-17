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
