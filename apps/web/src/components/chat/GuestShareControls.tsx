import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ChatAttachment,
  GUEST_SHARE_MAX_GUESTS,
  guestMessageAuthorName,
  type GuestId,
  type GuestMessageId,
  guestShareStatusLabel,
  providerAllowsDirectGuestSend,
  type ScopedThreadRef,
  type ThreadGuest,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import { CheckIcon, CopyIcon, UserIcon } from "lucide-react";
import { useState } from "react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useNowMinute } from "~/hooks/useNowMinute";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useQuietThreadProjection } from "~/state/entities";
import { useEnvironmentProviders } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";
import { Input } from "../ui/input";
import {
  Menu,
  MenuCheckboxItem,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
} from "../ui/menu";
import { useAssetUrls } from "~/assets/assetUrls";
import { type ChatFileAttachment, isImageAttachment } from "../../types";
import { buildExpandedImagePreview, type ExpandedImagePreview } from "./ExpandedImagePreview";
import { GuestMessageAttachments } from "./GuestMessageAttachments";
import { GuestMessageName, guestBubbleClassName } from "./guestMessageStyle";
import { guestShareDialogThreadAtom } from "./guestShareDialogState";

function useThreadGuestShare(threadRef: ScopedThreadRef | null): ThreadGuestShare | null {
  return useQuietThreadProjection(threadRef)?.projection.thread.guestShare ?? null;
}

export function GuestShareDialogHost() {
  const threadRef = useAtomValue(guestShareDialogThreadAtom);
  if (threadRef === null) return null;
  return (
    <GuestShareDialog
      key={`${threadRef.environmentId}:${threadRef.threadId}`}
      threadRef={threadRef}
      onClose={() => appAtomRegistry.set(guestShareDialogThreadAtom, null)}
    />
  );
}

type CreateState =
  | { readonly status: "idle" }
  | { readonly status: "creating" }
  | { readonly status: "created"; readonly url: string }
  | { readonly status: "failed"; readonly message: string };

function GuestShareDialog({
  threadRef,
  onClose,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onClose: () => void;
}) {
  const activeShare = useThreadGuestShare(threadRef);
  const canCreate = useAtomValue(
    serverEnvironment.createGuestShare.permissionAtom(threadRef.environmentId),
  );
  const createGuestShare = useAtomCommand(serverEnvironment.createGuestShare, {
    reportFailure: false,
  });
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "guest link" });
  const [state, setState] = useState<CreateState>({ status: "idle" });

  const create = async () => {
    setState({ status: "creating" });
    const result = await createGuestShare({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (result._tag === "Success") {
      setState({ status: "created", url: result.value.url });
      return;
    }
    if (isAtomCommandInterrupted(result)) {
      setState({ status: "idle" });
      return;
    }
    const error = squashAtomCommandFailure(result);
    setState({
      status: "failed",
      message: error instanceof Error ? error.message : "Could not create a guest link.",
    });
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && state.status !== "creating") onClose();
      }}
    >
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Share with guests</DialogTitle>
          <DialogDescription>
            Guests see the thread as you do, including command output and the agent&apos;s
            reasoning, and can copy the conversation to their own T3 Code. Each message they send
            waits for you.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {state.status === "created" ? (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                aria-label="Guest link"
                value={state.url}
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button size="sm" variant="outline" onClick={() => copyToClipboard(state.url)}>
                {isCopied ? <CheckIcon /> : <CopyIcon />}
                {isCopied ? "Copied" : "Copy"}
              </Button>
            </div>
          ) : (
            <p className="text-muted-foreground text-sm">
              {activeShare !== null
                ? "A new link ends the current one."
                : `Up to ${GUEST_SHARE_MAX_GUESTS} people can join with the link. It expires in 24 hours.`}
            </p>
          )}
          {state.status === "failed" ? (
            <p role="alert" className="text-destructive text-xs">
              {state.message}
            </p>
          ) : null}
        </DialogPanel>
        <DialogFooter>
          {state.status === "created" ? (
            <Button size="sm" onClick={onClose}>
              Done
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={state.status === "creating"}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={() => void create()}
                disabled={!canCreate || state.status === "creating"}
              >
                {state.status === "creating" ? "Creating..." : "Create link"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Header status for a shared thread, with the way to end the share. */
export function GuestShareIndicator({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const share = useThreadGuestShare(threadRef);
  const closeGuestShare = useOrchestrationCommand(threadEnvironment.closeGuestShare, {
    label: "stop guest share",
  });
  const [closing, setClosing] = useState(false);
  if (share === null) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
      <UserIcon aria-hidden className="size-3.5" />
      <GuestShareStatus share={share} threadRef={threadRef} />
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={closing}
        onClick={async () => {
          setClosing(true);
          await closeGuestShare({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          });
          setClosing(false);
        }}
      >
        Stop sharing
      </Button>
    </div>
  );
}

function GuestShareStatus({
  share,
  threadRef,
}: {
  readonly share: ThreadGuestShare;
  readonly threadRef: ScopedThreadRef;
}) {
  const nowMinute = useNowMinute();
  // The share stays on the thread after it expires, until the owner clears it.
  if (share.expiresAt.slice(0, 16) <= nowMinute) return <span>Guest link expired</span>;
  const label = guestShareStatusLabel(share);
  // Only a server that lists guests can remove one or say who is viewing.
  const guests = share.guests ?? [];
  if (guests.length === 0) return <span>{label}</span>;
  return (
    <Menu>
      <MenuTrigger render={<Button size="xs" variant="ghost-muted" />}>{label}</MenuTrigger>
      <MenuPopup align="end" width="content">
        <GuestList guests={guests} joinsClosed={share.joinsClosed === true} threadRef={threadRef} />
      </MenuPopup>
    </Menu>
  );
}

/**
 * Who joined and who has the thread open now. For each guest: whether their messages go to the
 * agent without a Send from the owner, and the way to remove them.
 */
function GuestList({
  guests,
  joinsClosed,
  threadRef,
}: {
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly joinsClosed: boolean;
  readonly threadRef: ScopedThreadRef;
}) {
  // Subscribed only while the list is open, so an idle shared thread streams nothing extra.
  const { data: presence } = useEnvironmentQuery(
    serverEnvironment.guestPresence({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    }),
  );
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const removeGuest = useOrchestrationCommand(threadEnvironment.removeGuest, {
    label: "remove guest",
  });
  const setGuestTrust = useOrchestrationCommand(threadEnvironment.setGuestTrust, {
    label: "change guest sending",
  });
  // The server decides this again on every guest message; here it only explains the switch.
  const instanceId =
    useQuietThreadProjection(threadRef)?.projection.thread.modelSelection.instanceId;
  const directAllowed = providerAllowsDirectGuestSend(
    useEnvironmentProviders()
      .get(threadRef.environmentId)
      ?.find((provider) => provider.instanceId === instanceId),
  );
  const target = (guestId: GuestId) => ({ threadId: threadRef.threadId, guestId });
  return (
    <>
      {guests.map((guest) => (
        <MenuGroup key={guest.id}>
          <MenuGroupLabel>
            {presence?.online.includes(guest.id) ? `${guest.name} · viewing now` : guest.name}
          </MenuGroupLabel>
          <MenuCheckboxItem
            checked={guest.trusted === true}
            // Turning it off always works; turning it on needs a provider that allows it.
            disabled={!canOperate || (!directAllowed && guest.trusted !== true)}
            closeOnClick={false}
            aria-label={`Send ${guest.name}'s messages without asking`}
            onCheckedChange={(trusted) =>
              void setGuestTrust({
                environmentId: threadRef.environmentId,
                input: { ...target(guest.id), trusted },
              })
            }
          >
            Send without asking
          </MenuCheckboxItem>
          <MenuItem
            variant="destructive"
            disabled={!canOperate}
            aria-label={`Remove ${guest.name}`}
            onClick={() =>
              void removeGuest({
                environmentId: threadRef.environmentId,
                input: target(guest.id),
              })
            }
          >
            Remove
          </MenuItem>
          <MenuSeparator />
        </MenuGroup>
      ))}
      <p className="max-w-64 px-2 py-1.5 text-muted-foreground text-xs">
        {directAllowed
          ? "Send without asking runs a guest's messages with this thread's permissions before you read them."
          : "Send without asking needs Claude or Codex signed in with an API key. A plan covers only your own prompts."}{" "}
        {joinsClosed
          ? "No one new can join with this link."
          : "Removing a guest also stops new people joining."}
      </p>
    </>
  );
}

/**
 * A guest's messages wait at the end of the timeline until the owner sends or dismisses each one.
 * Sent ones then show in the timeline as normal user messages with the guest's name.
 */
export function GuestPendingMessages({
  threadRef,
  onImageExpand,
  onFileOpen,
}: {
  readonly threadRef: ScopedThreadRef;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
  readonly onFileOpen: (attachment: ChatFileAttachment) => void;
}) {
  const share = useThreadGuestShare(threadRef);
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const resolveGuestMessage = useOrchestrationCommand(threadEnvironment.resolveGuestMessage, {
    label: "resolve guest message",
  });
  const [busyIds, setBusyIds] = useState<ReadonlySet<GuestMessageId>>(new Set());
  const pending = share?.messages.filter((message) => message.status === "pending") ?? [];
  // The files are the thread's attachments, which the owner's environment serves like any other.
  const images = pending.flatMap((message) => message.attachments ?? []).filter(isImageAttachment);
  const imageUrls = useAssetUrls(
    threadRef.environmentId,
    images.map((image) => ({ _tag: "attachment" as const, attachmentId: image.id })),
  );
  const imageUrlById = new Map(
    images.flatMap((image, index) => {
      const url = imageUrls[index];
      return url ? [[image.id, url] as const] : [];
    }),
  );
  if (share === null || pending.length === 0) return null;
  const openImage = (attachment: ChatAttachment) => {
    const preview = buildExpandedImagePreview(
      images.map((image) => ({ ...image, previewUrl: imageUrlById.get(image.id) ?? "" })),
      attachment.id,
    );
    if (preview) onImageExpand(preview);
  };

  const resolve = async (guestMessageId: GuestMessageId, decision: "send" | "dismiss") => {
    setBusyIds((ids) => new Set(ids).add(guestMessageId));
    await resolveGuestMessage({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, guestMessageId, decision },
    });
    setBusyIds((ids) => {
      const next = new Set(ids);
      next.delete(guestMessageId);
      return next;
    });
  };

  return (
    <ol
      className="chat-content-lane flex flex-col gap-4 pb-4"
      aria-label={`${pending.length} guest message${pending.length === 1 ? "" : "s"} waiting`}
      aria-live="polite"
    >
      {pending.map((message) => {
        const busy = busyIds.has(message.id);
        const guestName = guestMessageAuthorName(share, message);
        return (
          <li key={message.id} className="flex flex-col items-end gap-1">
            <GuestMessageName name={guestName} />
            <div
              className={cn(
                "flex min-w-0 max-w-[80%] flex-col gap-2 rounded-2xl p-3 text-foreground",
                guestBubbleClassName(true),
              )}
            >
              <GuestMessageAttachments
                attachments={message.attachments ?? []}
                imageUrl={(attachment) => imageUrlById.get(attachment.id)}
                onOpenImage={openImage}
                onOpenFile={onFileOpen}
              />
              {message.text ? (
                <p className="text-sm leading-relaxed whitespace-pre-wrap [overflow-wrap:anywhere]">
                  {message.text}
                </p>
              ) : null}
            </div>
            {canOperate ? (
              <div className="flex items-center gap-1 pe-1">
                <Button
                  size="xs"
                  variant="ghost-muted"
                  disabled={busy}
                  aria-label={`Dismiss message from ${guestName}`}
                  onClick={() => void resolve(message.id, "dismiss")}
                >
                  Dismiss
                </Button>
                <Button
                  size="xs"
                  disabled={busy}
                  aria-label={`Send message from ${guestName}`}
                  onClick={() => void resolve(message.id, "send")}
                >
                  Send
                </Button>
              </div>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
