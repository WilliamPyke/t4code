import { useAtomValue } from "@effect/atom-react";
import { guestEnvironmentId } from "@t3tools/client-runtime/environment";
import { Link, useParams } from "@tanstack/react-router";
import { UsersIcon } from "lucide-react";

import { guestSharesAtom, type JoinedGuestShare } from "~/guest/guestShares";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "../ui/sidebar";

/** The joined shares under the host that shared them, hosts and threads in the order joined. */
function groupSharesByHost(shares: ReadonlyArray<JoinedGuestShare>): ReadonlyArray<{
  readonly host: string;
  readonly owner: string | null;
  readonly shares: ReadonlyArray<JoinedGuestShare>;
}> {
  const byHost = new Map<string, Array<JoinedGuestShare>>();
  for (const share of shares) {
    const group = byHost.get(share.host);
    if (group === undefined) byHost.set(share.host, [share]);
    else group.push(share);
  }
  return [...byHost].map(([host, group]) => ({
    host,
    owner: group.find((share) => share.owner !== undefined)?.owner ?? null,
    shares: group,
  }));
}

/**
 * The threads other people shared with this browser, those from one host kept together under the
 * name its owner chose to show. A tunnel's host name means nothing to a guest, so a host whose
 * owner chose none has no label. They are not this client's threads: each opens the guest's view
 * of it, and none has a menu of its own. Nothing renders while there are none.
 */
export function SharedWithMeSection() {
  const shares = useAtomValue(guestSharesAtom);
  const activeEnvironmentId = useParams({
    strict: false,
    select: (params) => params.environmentId ?? null,
  });
  if (shares.length === 0) return null;
  return (
    <SidebarGroup aria-label="Shared with me">
      <p className="flex items-center gap-1.5 px-2 pb-1 text-xs font-medium text-muted-foreground">
        <UsersIcon aria-hidden className="size-3.5" />
        Shared with me
      </p>
      {groupSharesByHost(shares).map((group) => (
        <div key={group.host} className="pb-1">
          {group.owner === null ? null : (
            <p className="truncate px-2 pt-1 pb-0.5 text-xs text-muted-foreground/80">
              {group.owner}
            </p>
          )}
          <SidebarMenu>
            {group.shares.map((share) => {
              const environmentId = guestEnvironmentId(share.shareId);
              return (
                <SidebarMenuItem key={share.shareId}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={environmentId === activeEnvironmentId}
                    render={
                      <Link
                        to="/$environmentId/$threadId"
                        params={{ environmentId, threadId: share.threadId }}
                      />
                    }
                  >
                    <span className="min-w-0 truncate">{share.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </div>
      ))}
    </SidebarGroup>
  );
}
