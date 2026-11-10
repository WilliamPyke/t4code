import { parseJoinLink } from "@t3tools/shared/promptLinks";
import { createFileRoute, useLocation } from "@tanstack/react-router";
import { JoinSharedThreadView } from "../components/promptLinks/JoinSharedThreadView";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../components/ui/empty";
import { SidebarInset } from "../components/ui/sidebar";

// The query is read raw, as on /new: the router's search parsing would retype the token.
function JoinSharedThreadRoute() {
  const search = useLocation({ select: (location) => location.searchStr });
  const parsed = parseJoinLink(search);
  if (!parsed.ok) {
    return (
      <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
        <Empty className="flex-1">
          <EmptyHeader className="max-w-md">
            <EmptyTitle>Could not open the link</EmptyTitle>
            <EmptyDescription>{parsed.error}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      </SidebarInset>
    );
  }
  return <JoinSharedThreadView key={search} link={parsed.value} />;
}

export const Route = createFileRoute("/_chat/join")({
  component: JoinSharedThreadRoute,
});
