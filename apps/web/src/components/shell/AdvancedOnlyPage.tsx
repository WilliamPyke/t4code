import { Link } from "@tanstack/react-router";

import { setShellMode } from "~/shellMode";

import { Button } from "../ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { SidebarInset } from "../ui/sidebar";

/** Where a developer page would be in Simple mode: what it is, and the switch that shows it. */
export function AdvancedOnlyPage({ name }: { readonly name: string }) {
  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none" role="main">
      <Empty className="flex-1">
        <EmptyHeader className="max-w-md">
          <EmptyTitle>{name} is in Advanced mode</EmptyTitle>
          <EmptyDescription>
            Advanced mode adds chats, projects, code changes and other developer tools beside your
            boards. You can switch back any time.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => setShellMode("advanced")}>Switch to Advanced</Button>
            <Button variant="outline" render={<Link to="/" />}>
              Go to boards
            </Button>
          </div>
        </EmptyContent>
      </Empty>
    </SidebarInset>
  );
}
