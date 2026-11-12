import { useAtomValue } from "@effect/atom-react";
import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  AuthOrchestrationOperateScope,
  type ChatAttachment,
  GUEST_SHARE_MAX_GUESTS,
  guestContributorFor,
  guestMessageAuthorName,
  type GuestId,
  type GuestMessageId,
  guestShareStatusLabel,
  type ModelSelection,
  providerAllowsDirectGuestSend,
  ROOM_BOARD_ROOM_BOX,
  type ScopedThreadRef,
  type SharedThreadCatchUpResult,
  type ThreadGuest,
  type ThreadGuestShare,
} from "@t3tools/contracts";
import {
  roomCatchUpFailureMessage,
  roomCatchUpOutcome,
  roomSummaryOutcome,
} from "@t3tools/client-runtime/room-catch-up";
import { useNavigate } from "@tanstack/react-router";
import { CheckIcon, CopyIcon, RadioIcon, UserIcon } from "lucide-react";
import { useState } from "react";

import { useComposerDraftStore } from "~/composerDraftStore";
import { useComposerHandleContext } from "~/composerHandleContext";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { ensureLocalApi } from "~/localApi";
import { useNowMinute } from "~/hooks/useNowMinute";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { useQuietThreadProjection } from "~/state/entities";
import { useEnvironmentSettings, useUpdateEnvironmentSettings } from "~/hooks/useSettings";
import { useEnvironmentProviders } from "~/state/environments";
import { serverEnvironment } from "~/state/server";
import { useEnvironmentQuery } from "~/state/query";
import { useEnvironmentScope } from "~/state/session";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { cn } from "~/lib/utils";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { useTeams } from "~/teams/teams";
import { MemberAvatar } from "../teams/MemberAvatar";
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
import { GuestTurnList } from "./GuestTurnList";
import { guestShareDialogThreadAtom } from "./guestShareDialogState";
import { guestMessageArtifactTitle, guestMessageBoxTitle } from "./roomBoardPrompt";

function useThreadGuestShare(threadRef: ScopedThreadRef | null): ThreadGuestShare | null {
  return useQuietThreadProjection(threadRef)?.projection.thread.guestShare ?? null;
}

/** Ending a link nobody joined loses nothing, so only a joined one asks first. */
async function confirmEndingLink(share: ThreadGuestShare | null, message: string) {
  const joined = share?.guests?.length ?? (share?.guestName ? 1 : 0);
  if (joined === 0) return true;
  return ensureLocalApi().dialogs.confirm(message, { variant: "destructive" });
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
  | { readonly status: "shared"; readonly teamName: string }
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

  const nowMinute = useNowMinute();
  const live = activeShare !== null && activeShare.expiresAt.slice(0, 16) > nowMinute;
  const sharedTeam = live ? (activeShare.team ?? null) : null;
  const joinable = live && sharedTeam === null && activeShare.joinsClosed !== true;
  const { teams } = useTeams();

  const create = async (
    replace: boolean,
    team?: { readonly id: string; readonly name: string },
  ) => {
    // Moving between a guest link and a team ends what the thread had.
    const ending = replace || (team === undefined ? sharedTeam !== null : live);
    if (
      ending &&
      !(await confirmEndingLink(
        activeShare,
        team !== undefined
          ? [
              `Share with ${team.name} instead?`,
              "Everyone in the thread now loses access at once. Members of the team join from its page.",
            ].join("\n")
          : [
              sharedTeam !== null ? "Make a guest link instead?" : "Replace the guest link?",
              "Everyone on the current link loses access at once. A new link is made, and you need to send it again to everyone you want in the thread.",
            ].join("\n"),
      ))
    ) {
      return;
    }
    setState({ status: "creating" });
    const result = await createGuestShare({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        replace: replace || ending,
        ...(team === undefined ? {} : { teamId: team.id }),
      },
    });
    if (result._tag === "Success") {
      const shared = result.value.share.team;
      setState(
        shared !== undefined
          ? { status: "shared", teamName: shared.name }
          : { status: "created", url: result.value.shortUrl ?? result.value.url },
      );
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
            reasoning, and can copy the conversation to their own T Code. Each message they send
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
          ) : state.status === "shared" || sharedTeam !== null ? (
            <p className="text-muted-foreground text-sm">
              Shared with{" "}
              {state.status === "shared" ? state.teamName : (sharedTeam?.name ?? "the team")}. Its
              members open it from the team&apos;s page as their own accounts, for 90 days.
            </p>
          ) : (
            <p className="text-muted-foreground text-sm">
              {joinable
                ? "This thread already has a link. Show it to invite more people, or replace it to end it for everyone who has it."
                : activeShare !== null
                  ? "No one new can join with the current link. A new link ends it."
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
          {state.status === "created" || state.status === "shared" ? (
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
              {teams !== null && teams.length > 0 ? (
                <Menu>
                  <MenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!canCreate || state.status === "creating"}
                      />
                    }
                  >
                    {sharedTeam === null ? "Share with a team" : "Share with another team"}
                  </MenuTrigger>
                  <MenuPopup align="end">
                    {teams
                      .filter((team) => team.id !== sharedTeam?.id)
                      .map((team) => (
                        <MenuItem key={team.id} onClick={() => void create(false, team)}>
                          {team.name}
                        </MenuItem>
                      ))}
                  </MenuPopup>
                </Menu>
              ) : null}
              {joinable ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void create(true)}
                  disabled={!canCreate || state.status === "creating"}
                >
                  Replace link
                </Button>
              ) : null}
              <Button
                size="sm"
                onClick={() => void create(false)}
                disabled={!canCreate || state.status === "creating"}
              >
                {state.status === "creating"
                  ? "Working..."
                  : joinable
                    ? "Show link"
                    : sharedTeam !== null
                      ? "Make a guest link"
                      : "Create link"}
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
  const navigate = useNavigate();
  if (share === null) return null;
  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
      <UserIcon aria-hidden className="size-3.5" />
      <GuestShareStatus share={share} threadRef={threadRef} />
      <Button
        size="xs"
        variant="ghost-muted"
        onClick={() =>
          void navigate({
            to: "/board/$roomEnvironmentId/$roomThreadId",
            params: {
              roomEnvironmentId: threadRef.environmentId,
              roomThreadId: threadRef.threadId,
            },
            // Side by side: the thread opens beside the board.
            search: { chat: ROOM_BOARD_ROOM_BOX },
          })
        }
      >
        Board
      </Button>
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={closing}
        onClick={async () => {
          const confirmed = await confirmEndingLink(
            share,
            [
              "Stop sharing this thread?",
              share.team === undefined
                ? "Everyone on the guest link loses access at once, and the link stops working."
                : `Everyone in it loses access at once, and ${share.team.name} no longer lists it.`,
            ].join("\n"),
          );
          if (!confirmed) return;
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
  const label =
    share.team === undefined
      ? guestShareStatusLabel(share)
      : (share.guests ?? []).length === 0
        ? `Shared with ${share.team.name}`
        : `${share.team.name}: ${guestShareStatusLabel(share)}`;
  // Only a server that lists guests can remove one or say who is viewing.
  const guests = share.guests ?? [];
  if (guests.length === 0) return <span>{label}</span>;
  return (
    <Menu>
      <MenuTrigger render={<Button size="xs" variant="ghost-muted" />}>{label}</MenuTrigger>
      <MenuPopup align="end" width="content">
        <GuestList
          guests={guests}
          joinsClosed={share.joinsClosed === true}
          team={share.team !== undefined}
          threadRef={threadRef}
        />
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
  team,
  threadRef,
}: {
  readonly guests: ReadonlyArray<ThreadGuest>;
  readonly joinsClosed: boolean;
  readonly team: boolean;
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
  const contributors = useEnvironmentSettings(
    threadRef.environmentId,
    (settings) => settings.guestContributors,
  );
  const updateSettings = useUpdateEnvironmentSettings(threadRef.environmentId);
  const target = (guestId: GuestId) => ({ threadId: threadRef.threadId, guestId });
  const setApproved = (guest: ThreadGuest, approved: boolean) => {
    const { account } = guest;
    if (account === undefined) return;
    const saved = guestContributorFor(contributors, account);
    updateSettings({
      guestContributors: approved
        ? [...contributors.filter((contributor) => contributor !== saved), account]
        : contributors.filter((contributor) => contributor !== saved),
    });
    // Approving someone who is already here should not wait for their next link.
    if (approved && guest.trusted !== true) {
      void setGuestTrust({
        environmentId: threadRef.environmentId,
        input: { ...target(guest.id), trusted: true },
      });
    }
  };
  return (
    <>
      {guests.map((guest) => (
        <MenuGroup key={guest.id}>
          <MenuGroupLabel>
            <span className="flex items-center gap-1.5">
              {guest.member === undefined ? null : (
                <MemberAvatar name={guest.name} avatarUrl={guest.member.avatarUrl} />
              )}
              {guest.account === undefined ? guest.name : `${guest.name} (@${guest.account.login})`}
              {presence?.online.includes(guest.id) ? " · viewing now" : ""}
            </span>
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
          {guest.account === undefined ? null : (
            <MenuCheckboxItem
              checked={guestContributorFor(contributors, guest.account) !== undefined}
              disabled={!canOperate}
              closeOnClick={false}
              aria-label={`Approve ${guest.account.login} on every link`}
              onCheckedChange={(approved) => setApproved(guest, approved)}
            >
              Approved contributor
            </MenuCheckboxItem>
          )}
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
        {team
          ? "A removed member cannot open this thread again."
          : joinsClosed
            ? "No one new can join with this link."
            : "Removing a guest also stops new people joining."}{" "}
        A guest who signs in with GitHub can be approved for every link.
      </p>
    </>
  );
}

/** The turns guests ran on their own machines, at the end of the owner's timeline. */
export function GuestTurns({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const share = useThreadGuestShare(threadRef);
  return share === null ? null : <GuestTurnList roster={share} turns={share.turns ?? []} />;
}

/**
 * On a thread joined from someone's room: says its turns are shown there, with the way to read
 * what the room said since and the way to stop.
 */
export function RoomLinkIndicator({ threadRef }: { readonly threadRef: ScopedThreadRef }) {
  const roomLink = useQuietThreadProjection(threadRef)?.projection.thread.roomLink ?? null;
  const canLeave = useAtomValue(
    serverEnvironment.leaveSharedRoom.permissionAtom(threadRef.environmentId),
  );
  const leaveSharedRoom = useAtomCommand(serverEnvironment.leaveSharedRoom, "leave room");
  const canCatchUp = useAtomValue(
    serverEnvironment.catchUpSharedRoom.permissionAtom(threadRef.environmentId),
  );
  const catchUpSharedRoom = useAtomCommand(serverEnvironment.catchUpSharedRoom, "catch up");
  const composerRef = useComposerHandleContext();
  const nowMinute = useNowMinute();
  const [leaving, setLeaving] = useState(false);
  const [catchUp, setCatchUp] = useState<"idle" | "working" | string>("idle");
  // The server clears an ended link when it next posts a turn or catches up.
  if (roomLink === null || roomLink.expiresAt.slice(0, 16) <= nowMinute) return null;
  // Both buttons catch up and share one status line; `use` returns what it says.
  const catchUpThen = async (use: (result: SharedThreadCatchUpResult) => string) => {
    setCatchUp("working");
    const result = await catchUpSharedRoom({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId },
    });
    if (result._tag === "Failure") {
      setCatchUp(
        isAtomCommandInterrupted(result)
          ? "idle"
          : roomCatchUpFailureMessage(squashAtomCommandFailure(result)),
      );
      return;
    }
    setCatchUp(use(result.value));
  };
  return (
    <div className="flex shrink-0 items-center gap-1 text-muted-foreground text-xs">
      <RadioIcon aria-hidden className="size-3.5" />
      <span>Your turns show in the room</span>
      {catchUp === "idle" || catchUp === "working" ? null : <span role="status">· {catchUp}</span>}
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={!canCatchUp || catchUp === "working"}
        onClick={() =>
          void catchUpThen((value) => {
            const { record, status } = roomCatchUpOutcome(value);
            // Only attached: the user reads the chip and sends the message themselves.
            if (record !== null) {
              useComposerDraftStore.getState().addRoomUpdatesContexts(threadRef, [record]);
            }
            return status;
          })
        }
      >
        Catch up
      </Button>
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={!canCatchUp || catchUp === "working"}
        onClick={() =>
          void catchUpThen((value) => {
            // Only a draft: the user reads, edits and sends the request to their own agent.
            const store = useComposerDraftStore.getState();
            const outcome = roomSummaryOutcome(
              value,
              store.getComposerDraft(threadRef)?.prompt ?? "",
            );
            if (outcome.record !== null && outcome.prompt !== null) {
              store.setPrompt(threadRef, outcome.prompt);
              // Appended after the request, which refers to it as attached.
              store.addRoomUpdatesContexts(threadRef, [outcome.record], { insertAtCaret: false });
              // After the editor has taken the new prompt, so the caret lands at its end.
              window.requestAnimationFrame(() => composerRef?.current?.focusAtEnd());
            }
            return outcome.status;
          })
        }
      >
        Summarize what I missed
      </Button>
      <Button
        size="xs"
        variant="ghost-muted"
        disabled={!canLeave || leaving}
        onClick={async () => {
          setLeaving(true);
          await leaveSharedRoom({
            environmentId: threadRef.environmentId,
            input: { threadId: threadRef.threadId },
          });
          setLeaving(false);
        }}
      >
        Leave room
      </Button>
    </div>
  );
}

/**
 * Sends or dismisses a guest's waiting message, as the timeline and the board's thread boxes both
 * offer it, and which ones are on their way.
 */
export function useGuestMessageResolver(threadRef: ScopedThreadRef) {
  const canOperate = useEnvironmentScope(threadRef.environmentId, AuthOrchestrationOperateScope);
  const resolveGuestMessage = useOrchestrationCommand(threadEnvironment.resolveGuestMessage, {
    label: "resolve guest message",
  });
  const [busyIds, setBusyIds] = useState<ReadonlySet<GuestMessageId>>(new Set());
  const resolve = async (
    guestMessageId: GuestMessageId,
    decision: "send" | "dismiss",
    modelSelection: ModelSelection | undefined,
  ) => {
    setBusyIds((ids) => new Set(ids).add(guestMessageId));
    await resolveGuestMessage({
      environmentId: threadRef.environmentId,
      input: {
        threadId: threadRef.threadId,
        guestMessageId,
        decision,
        ...(modelSelection === undefined ? {} : { modelSelection }),
      },
    });
    setBusyIds((ids) => {
      const next = new Set(ids);
      next.delete(guestMessageId);
      return next;
    });
  };
  return { canOperate, busyIds, resolve };
}

/**
 * A guest's messages wait at the end of the timeline until the owner sends or dismisses each one.
 * Sent ones then show in the timeline as normal user messages with the guest's name.
 */
export function GuestPendingMessages({
  threadRef,
  modelSelection,
  onImageExpand,
  onFileOpen,
}: {
  readonly threadRef: ScopedThreadRef;
  /** The composer's model, when the owner picked one that differs from the thread's. */
  readonly modelSelection: ModelSelection | undefined;
  readonly onImageExpand: (preview: ExpandedImagePreview) => void;
  readonly onFileOpen: (attachment: ChatFileAttachment) => void;
}) {
  const share = useThreadGuestShare(threadRef);
  const { canOperate, busyIds, resolve: resolveMessage } = useGuestMessageResolver(threadRef);
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

  const resolve = (guestMessageId: GuestMessageId, decision: "send" | "dismiss") =>
    resolveMessage(guestMessageId, decision, modelSelection);

  return (
    <ol
      className="chat-content-lane flex flex-col gap-4 pb-4"
      aria-label={`${pending.length} guest message${pending.length === 1 ? "" : "s"} waiting`}
      aria-live="polite"
    >
      {pending.map((message) => {
        const busy = busyIds.has(message.id);
        const guestName = guestMessageAuthorName(share, message);
        const artifactTitle = guestMessageArtifactTitle(share.board, message);
        const boxTitle = guestMessageBoxTitle(share.board, message);
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
            {boxTitle === null ? null : (
              <p className="me-1 max-w-[80%] text-xs text-muted-foreground">
                {`Asked from ${boxTitle} on the board. Sending this runs it in that box's own conversation.`}
              </p>
            )}
            {artifactTitle === null ? null : (
              <p className="me-1 max-w-[80%] text-xs text-muted-foreground">
                {`Sending this gives your agent the artifact "${artifactTitle}", and its reply replaces it on the board.`}
              </p>
            )}
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
