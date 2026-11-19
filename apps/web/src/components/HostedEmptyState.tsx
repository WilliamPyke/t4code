import { Link } from "@tanstack/react-router";

import { APP_DISPLAY_NAME } from "~/branding";
import { isElectron } from "../env";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { ConnectComputerSteps } from "./ConnectComputerDialog";
import { Button } from "./ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "./ui/empty";
import { SidebarInset } from "./ui/sidebar";
import { WorkspacePageHeader } from "./WorkspacePageHeader";

/** Home screen for the hosted app before any computer is added. */
export function HostedEmptyState() {
  const localEnvironmentOff = isLocalEnvironmentDisabled();

  return (
    <SidebarInset className="h-dvh min-h-0 overflow-hidden overscroll-y-none">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden bg-background">
        <WorkspacePageHeader electron={isElectron} className="border-b border-border">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-foreground md:text-muted-foreground/60">
              {APP_DISPLAY_NAME}
            </span>
          </div>
        </WorkspacePageHeader>

        <Empty className="flex-1">
          <EmptyHeader>
            <EmptyTitle>
              {localEnvironmentOff ? "This computer is off" : "No computer connected"}
            </EmptyTitle>
            <EmptyDescription>
              {localEnvironmentOff
                ? "Turn it back on, or connect a different computer."
                : "Your agents, such as Claude Code or Codex, run on your own computer. Connect it to use them here."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="max-w-xl">
            {localEnvironmentOff ? (
              <Button render={<Link to="/settings/connections" />} size="sm">
                Your computers
              </Button>
            ) : (
              <div className="w-full text-left">
                <ConnectComputerSteps />
              </div>
            )}
          </EmptyContent>
        </Empty>
      </div>
    </SidebarInset>
  );
}
