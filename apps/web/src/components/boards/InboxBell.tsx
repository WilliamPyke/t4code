import type { CloudInboxItem } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import { BellIcon } from "lucide-react";
import { useEffect, useState } from "react";

import { useBoardAccount } from "~/guest/boardAccount";
import {
  answerEditAccess,
  loadInbox,
  markInboxRead,
  openInboxBoard,
  refreshInboxCount,
  useInbox,
  useInboxCount,
  watchInbox,
} from "~/guest/inbox";
import { setWorkspaceScope } from "~/guest/workspaces";
import { useNowMinute } from "~/hooks/useNowMinute";
import { cn } from "~/lib/utils";

import { formatRecentTimestamp } from "../../timestampFormat";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";
import { toastManager } from "../ui/toast";

/** What an item says happened, in a few words. */
function inboxItemHeadline(item: CloudInboxItem): string {
  switch (item.kind) {
    case "mention":
      return `${item.by} mentioned you`;
    case "assign":
      return `${item.by} gave you a task`;
    case "reply":
      return `${item.by} replied to your comment`;
    case "access-request":
      return `${item.by} asked to edit`;
    case "access-answer":
      return item.approved === true
        ? `${item.by} let you edit`
        : `${item.by} said no to editing, for now`;
    case "access-changed":
      return item.role === "edit"
        ? `${item.by} let you edit`
        : item.role === "view"
          ? `${item.by} made you a viewer`
          : item.role === "owner"
            ? `${item.by} made you an owner`
            : `${item.by} made you a member`;
  }
}

const requestStatus = (item: CloudInboxItem) =>
  item.request?.status === "approved"
    ? "Approved"
    : item.request?.status === "declined"
      ? "Declined"
      : null;

/**
 * The signed-in person's inbox: a bell with how many are unread, and the list. `nudge` changes
 * when the open board put something in it, which reads the count again at once.
 */
export function InboxBell({
  nudge,
  presentation = "icon",
}: {
  readonly nudge?: string | undefined;
  /** A bell icon, or a row of the sidebar's boards navigation. */
  readonly presentation?: "icon" | "sidebar";
}) {
  const account = useBoardAccount();
  if (account.status !== "signed-in") return null;
  return <SignedInBell nudge={nudge} presentation={presentation} />;
}

function SignedInBell({
  nudge,
  presentation,
}: {
  readonly nudge: string | undefined;
  readonly presentation: "icon" | "sidebar";
}) {
  const sidebar = presentation === "sidebar";
  const count = useInboxCount();
  const inbox = useInbox();
  const [open, setOpen] = useState(false);
  const [answering, setAnswering] = useState<string | null>(null);
  const navigate = useNavigate();
  const nowMs = Date.parse(`${useNowMinute()}:00.000Z`);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- reads the inbox count on focus and once a minute while the page shows
  useEffect(() => watchInbox(), []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the open board said the inbox changed; the count lives on the board host
  useEffect(() => {
    if (nudge !== undefined) void refreshInboxCount(true);
  }, [nudge]);
  const unread = count?.unread ?? 0;
  const openItem = async (item: CloudInboxItem) => {
    setOpen(false);
    if (item.read !== true) void markInboxRead([item.id]);
    if (item.shareId === undefined) {
      if (item.workspaceId !== undefined) setWorkspaceScope(item.workspaceId);
      void navigate({ to: "/" });
      return;
    }
    const target = await openInboxBoard({
      shareId: item.shareId,
      workspaceId: item.workspaceId,
      noteId: item.noteId,
      task: item.task === true,
    });
    if (typeof target === "string") {
      toastManager.add({ type: "error", title: "Could not open the board", description: target });
      return;
    }
    void navigate(target);
  };
  const answer = async (item: CloudInboxItem, approve: boolean) => {
    setAnswering(item.id);
    const failed = await answerEditAccess(item, approve);
    setAnswering(null);
    if (failed !== null) {
      toastManager.add({ type: "error", title: "Could not answer", description: failed });
    }
  };
  const popover = (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void loadInbox();
      }}
    >
      <PopoverTrigger
        render={
          sidebar ? (
            <SidebarMenuButton size="nav" variant="nav" data-inbox-bell />
          ) : (
            <Button size="icon-sm" variant="ghost-muted" data-inbox-bell />
          )
        }
        aria-label={unread === 0 ? "Inbox" : `Inbox, ${unread} unread`}
      >
        {sidebar ? (
          <>
            <BellIcon />
            <span className="min-w-0 flex-1 truncate">Inbox</span>
            {unread === 0 ? null : (
              <span
                aria-hidden
                className="ms-auto grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-xs leading-none font-semibold text-primary-foreground tabular-nums"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </>
        ) : (
          <span className="relative">
            <BellIcon />
            {unread === 0 ? null : (
              <span
                aria-hidden
                className="absolute -top-1.5 -right-2 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-primary px-1 text-3xs leading-none font-semibold text-primary-foreground tabular-nums"
              >
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </span>
        )}
      </PopoverTrigger>
      <PopoverPopup
        width="md"
        side={sidebar ? "right" : "bottom"}
        align={sidebar ? "start" : "end"}
        padding="compact"
      >
        <div className="mb-2 flex items-center gap-2">
          <PopoverTitle className="flex-1">Inbox</PopoverTitle>
          {unread === 0 ? null : (
            <Button size="xs" variant="ghost-muted" onClick={() => void markInboxRead("all")}>
              Mark all read
            </Button>
          )}
        </div>
        {inbox === null ? (
          <p className="py-6 text-center text-xs text-muted-foreground">Loading...</p>
        ) : inbox.items.length === 0 ? (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Nothing yet. When someone mentions you, gives you a task or replies to you, it shows
            here.
          </p>
        ) : (
          <ul className="-mx-1 flex max-h-96 flex-col overflow-y-auto" data-inbox-list>
            {inbox.items.map((item) => (
              <li key={item.id} className="relative border-b border-rule last:border-b-0">
                <button
                  type="button"
                  className="flex w-full flex-col gap-0.5 rounded-lg px-2 py-2.5 text-start hover:bg-hover focus-visible:bg-hover focus-visible:outline-none"
                  onClick={() => void openItem(item)}
                >
                  <span className="flex items-center gap-1.5 text-sm">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.75 shrink-0 rounded-full",
                        item.read === true ? "bg-transparent" : "bg-primary",
                      )}
                    />
                    <span
                      className={cn(
                        "min-w-0 truncate text-foreground",
                        item.read !== true && "font-semibold",
                      )}
                    >
                      {inboxItemHeadline(item)}
                    </span>
                    <time dateTime={item.at} className="ms-auto shrink-0 text-2xs text-quiet">
                      {formatRecentTimestamp(item.at, "locale", nowMs)}
                    </time>
                  </span>
                  <span className="truncate ps-3.25 text-xs text-quiet">
                    {item.shareId === undefined ? "in" : "on"} {item.title}
                  </span>
                  {item.excerpt === undefined ? null : (
                    <span className="line-clamp-2 ps-3.25 text-xs text-body">{item.excerpt}</span>
                  )}
                </button>
                {item.kind !== "access-request" ? null : requestStatus(item) === null ? (
                  <span className="flex gap-1.5 ps-5 pb-2">
                    <Button
                      size="xs"
                      disabled={answering === item.id}
                      onClick={() => void answer(item, true)}
                    >
                      Approve
                    </Button>
                    <Button
                      size="xs"
                      variant="outline"
                      disabled={answering === item.id}
                      onClick={() => void answer(item, false)}
                    >
                      Decline
                    </Button>
                  </span>
                ) : (
                  <span className="block ps-5 pb-2 text-2xs text-muted-foreground">
                    {requestStatus(item)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </PopoverPopup>
    </Popover>
  );
  return sidebar ? <SidebarMenuItem>{popover}</SidebarMenuItem> : popover;
}
