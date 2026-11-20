import { type ServerLifecycleWelcomePayload } from "@t3tools/contracts";
import { scopedProjectKey, scopeProjectRef } from "@t3tools/client-runtime/environment";
import {
  Outlet,
  Link,
  redirect,
  createRootRoute,
  type ErrorComponentProps,
  useLocation,
  useMatches,
  useRouter,
} from "@tanstack/react-router";
import { Check, Copy } from "lucide";
import { useEffect, useEffectEvent, useState } from "react";

import { APP_DISPLAY_NAME, APP_VERSION } from "../branding";
import { AppSidebarLayout } from "../components/AppSidebarLayout";
import { CommandPalette } from "../components/CommandPalette";
import { CustomSnoozeDialogHost } from "../components/CustomSnoozeDialog";
import { GuestShareDialogHost } from "../components/chat/GuestShareControls";
import { UseInAnotherAppDialogHost } from "../components/mcp/UseInAnotherAppDialog";
import { NewTeamDialogHost } from "../components/teams/NewTeamDialog";
import { useHomeFocus } from "../components/boards/homeFocus";
import { NewBoardDialogHost } from "../components/boards/newBoard";
import { AddProjectToMachineDialogHost } from "../components/AddProjectToMachineDialog";
import { ConfirmDialogHost } from "../components/ConfirmDialogHost";
import { ConnectComputerDialogHost } from "../components/ConnectComputerDialog";
import { isSignInPath } from "../components/sidebar/mainAppLocation";
import { AdvancedOnlyPage } from "../components/shell/AdvancedOnlyPage";
import { DocumentTitleSync } from "../components/shell/DocumentTitleSync";
import { OfflineNote } from "../components/shell/OfflineNote";
import { DevReplayHost } from "../components/DevReplayHost";
import { FirstRunGate } from "../components/onboarding/FirstRunGate";
import { ConnectOnboardingDialog } from "../components/cloud/ConnectOnboardingDialog";
import { RelayClientInstallDialog } from "../components/cloud/RelayClientInstallDialog";
import { SshPasswordPromptDialog } from "../components/desktop/SshPasswordPromptDialog";
import { SnapShotCoordinator } from "../components/desktop/SnapShotCoordinator";
import { DesktopAppActivationCoordinator } from "../components/desktop/DesktopAppActivationCoordinator";
import { DesktopWebLinkCoordinator } from "../components/desktop/DesktopWebLinkCoordinator";
import { RunningThreadKeepAlive } from "../components/desktop/RunningThreadKeepAlive";
import { ReopenClosedViewShortcut } from "../components/ReopenClosedViewShortcut";
import { ProjectCloneToastCoordinator } from "../components/ProjectCloneToastCoordinator";
import { ChatGptWelcomeCoordinator } from "../components/settings/ChatGptWelcomeCoordinator";
import { ThemeEditorHost } from "../components/settings/ThemeEditorHost";
import { useCopyToClipboard } from "../hooks/useCopyToClipboard";
import { Button } from "../components/ui/button";
import { MorphIcon } from "~/components/MorphIcon";
import { TinkjamMark } from "../components/TinkjamLogo";
import { StandalonePage, StandalonePageHeader } from "../components/ui/standalone-page";
import { AnchoredToastProvider, ToastProvider } from "../components/ui/toast";
import { isElectron } from "../env";
import { cn } from "../lib/utils";
import { useClientSettings } from "../hooks/useSettings";
import {
  deriveLogicalProjectKeyFromSettings,
  derivePhysicalProjectKeyFromPath,
  selectProjectGroupingSettings,
} from "@t3tools/client-runtime/state/project-grouping";
import { useUiStateStore } from "../uiStateStore";
import { configureClientTracing } from "../observability/clientTracing";
import { resolveInitialServerAuthGateState } from "../environments/primary";
import { hasGuestShares } from "../guest/guestShares";
import { isGuestEntryPath, setGuestOnlySession } from "../guestPage";
import { hostedPairingRequestOn, isHostedStaticApp } from "../hostedPairing";
import { useHostedPromptLinkLanding } from "../components/promptLinks/HostedPromptLinkLanding";
import { isLocalEnvironmentDisabled } from "../localEnvironment";
import { useAtomValue } from "@effect/atom-react";
import { primaryServerConfigAtom, primaryServerWelcomeAtom } from "../state/server";
import { readProject } from "../state/entities";
import { useShellMode } from "../shellMode";
import { advancedOnlyPageName } from "../shellMode.logic";
import { useHasComputer } from "../state/environments";
import { ComputerReconnectCoordinator } from "../components/guest/ComputerReconnectCoordinator";

import { getDesktopSnapShotBridge } from "../lib/desktopSnapShot";
import { shouldResumeSnapShotSetupOnStartup } from "../lib/snapShotSetupResume";

export const Route = createRootRoute({
  beforeLoad: async ({ location }) => {
    // A guest link asks for a name before anything connects, and must not trigger pairing.
    if (isGuestEntryPath(location.pathname)) {
      return {
        authGateState: {
          status: "guest",
        } as const,
      };
    }

    if (hostedPairingRequestOn(location.pathname) !== null) {
      return {
        authGateState: {
          status: "hosted-pairing",
        } as const,
      };
    }

    if (isLocalEnvironmentDisabled() || isHostedStaticApp(new URL(window.location.href))) {
      setGuestOnlySession(false);
      return {
        authGateState: {
          status: "hosted-static",
        } as const,
      };
    }

    const authGateState = await resolveInitialServerAuthGateState();
    // No session on this host, but threads shared from it or elsewhere: the app opens with
    // those and nothing of this host's own.
    const guestOnly = authGateState.status !== "authenticated" && hasGuestShares();
    setGuestOnlySession(guestOnly);
    if (guestOnly) {
      return {
        authGateState: {
          status: "guest",
        } as const,
      };
    }
    if (authGateState.status === "authenticated") {
      // Idempotent, so every navigation can ask for it.
      void configureClientTracing();
    }
    if (
      authGateState.status === "authenticated" &&
      getDesktopSnapShotBridge() &&
      shouldResumeSnapShotSetupOnStartup() &&
      location.pathname !== "/settings/snap-shot"
    ) {
      throw redirect({ to: "/settings/snap-shot", replace: true });
    }
    return {
      authGateState,
    };
  },
  component: RootRouteView,
  errorComponent: RootRouteErrorView,
  notFoundComponent: RootRouteNotFoundView,
  head: () => ({
    meta: [{ name: "title", content: APP_DISPLAY_NAME }],
  }),
});

function RootRouteNotFoundView() {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-6">
      <div className="flex max-w-sm flex-col items-center gap-4 text-center">
        <TinkjamMark aria-hidden className="size-10" />
        <h1 className="text-lg font-medium text-foreground">Nothing here</h1>
        <p className="text-sm text-muted-foreground">
          This link does not lead to anything in Tinkjam. The board may have been deleted, or the
          link may be cut short.
        </p>
        <Button render={<Link to="/" replace />}>Go to your boards</Button>
      </div>
    </main>
  );
}

function RootRouteView() {
  // Above every branch: app services raise toasts for the whole page, so the surface they write to
  // must not unmount when the root switches branches (for example /welcome to the app shell).
  return (
    <ToastProvider>
      <AnchoredToastProvider>
        {/* Boards and the app shell alike wait on the person's computers. */}
        <ComputerReconnectCoordinator />
        <RootRouteBranch />
      </AnchoredToastProvider>
    </ToastProvider>
  );
}

function RootRouteBranch() {
  const pathname = useLocation({ select: (location) => location.pathname });
  // The location moves when a navigation starts; the page drawn stays until the next has loaded.
  const drawnPathname = useMatches({ select: (matches) => matches.at(-1)?.pathname ?? pathname });
  const homeFocused = useHomeFocus(drawnPathname);
  const { authGateState } = Route.useRouteContext();
  const primaryEnvironmentAuthenticated = authGateState.status === "authenticated";
  // A sync IPC read; the setting only changes across a relaunch.
  const [localEnvironmentDisabled] = useState(isLocalEnvironmentDisabled);
  const hostedPromptLinkLanding = useHostedPromptLinkLanding(
    authGateState.status === "hosted-static",
  );
  const shellMode = useShellMode();
  const hasComputer = useHasComputer();
  const advancedOnlyPage =
    shellMode === "simple" ? advancedOnlyPageName(pathname, hasComputer) : null;

  // By the page drawn: a guest's page keeps the window, and its cover, until the board has loaded.
  if (isGuestEntryPath(drawnPathname)) return <Outlet />;

  if (
    pathname === "/pair" ||
    pathname === "/connect" ||
    pathname === "/connect-agent" ||
    isSignInPath(pathname)
  ) {
    return <Outlet />;
  }

  // Handle links before onboarding redirects lose them.
  if (hostedPromptLinkLanding !== null) {
    return hostedPromptLinkLanding;
  }

  const isWelcome = pathname === "/welcome";
  // A guest gets the same shell a hosted app with no machine of its own gets.
  const withoutLocalEnvironment =
    authGateState.status === "hosted-static" || authGateState.status === "guest";
  if (authGateState.status !== "authenticated" && !withoutLocalEnvironment) {
    return <Outlet />;
  }

  // Settings can reopen /welcome mid-session, so it mounts everything the app does except the
  // first-run gate and the event router, whose first navigation would leave the page.
  const appHosts = (
    <>
      {primaryEnvironmentAuthenticated ? <DesktopAppActivationCoordinator /> : null}
      {primaryEnvironmentAuthenticated || localEnvironmentDisabled ? (
        <DesktopWebLinkCoordinator />
      ) : null}
      {isElectron ? <RunningThreadKeepAlive /> : null}
      <RelayClientInstallDialog />
      <ConnectOnboardingDialog />
      <SshPasswordPromptDialog />
      <SnapShotCoordinator />
      <ReopenClosedViewShortcut />
      <ConfirmDialogHost />
      <CustomSnoozeDialogHost />
      <GuestShareDialogHost />
      <ProjectCloneToastCoordinator />
      <AddProjectToMachineDialogHost />
      <UseInAnotherAppDialogHost />
      <NewTeamDialogHost />
      <NewBoardDialogHost />
      <ConnectComputerDialogHost />
      <DocumentTitleSync />
      <OfflineNote />
      {import.meta.env.DEV && primaryEnvironmentAuthenticated ? <DevReplayHost /> : null}
    </>
  );
  const appShell = (
    <CommandPalette>
      {/* Setup starts with an empty workspace, so the Welcome page has no thread list. Nor has the
          boards home before a first board. */}
      <AppSidebarLayout showSidebar={!isWelcome && !homeFocused}>
        {advancedOnlyPage === null ? <Outlet /> : <AdvancedOnlyPage name={advancedOnlyPage} />}
      </AppSidebarLayout>
    </CommandPalette>
  );

  return (
    <>
      <ChatGptWelcomeCoordinator />
      {isWelcome ? (
        <>
          {appHosts}
          {appShell}
        </>
      ) : (
        <FirstRunGate
          enabled={primaryEnvironmentAuthenticated}
          hostedStatic={withoutLocalEnvironment}
        >
          {appHosts}
          {primaryEnvironmentAuthenticated ? <EventRouter /> : null}
          {appShell}
        </FirstRunGate>
      )}
      {/* Above both shells and the router, so drafts survive navigation, including to /welcome. */}
      <ThemeEditorHost />
    </>
  );
}

function RootRouteErrorView({ error }: ErrorComponentProps) {
  const router = useRouter();
  const message = errorMessage(error);
  // Router pathname rather than window.location: desktop uses hash history, where the window path is always "/".
  const pathname = useLocation({ select: (location) => location.pathname });
  const report = errorReport(error, pathname);

  return (
    <StandalonePage>
      <TinkjamMark aria-hidden className="mb-4 size-10" />
      <StandalonePageHeader
        title="Something went wrong"
        description="Tinkjam could not show this page. Your boards are safe. Try again, or go back to your boards."
      />

      <div className="mt-5 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => void router.invalidate()}>
          Try again
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void router.navigate({ to: "/" }).then(() => router.invalidate())}
        >
          Go to your boards
        </Button>
        <Button size="sm" variant="outline" onClick={() => window.location.reload()}>
          Reload the page
        </Button>
      </div>

      <details className="mt-6 text-sm">
        <summary className="cursor-pointer text-muted-foreground">Technical details</summary>
        <p className="mt-2 text-muted-foreground">{message}</p>
        <div className="mt-2">
          <CopyErrorButton report={report} />
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-border/70 bg-background/55">
          <pre className="max-h-64 overflow-auto bg-background/80 px-3 py-2 text-xs whitespace-pre-wrap text-foreground/85">
            {report}
          </pre>
        </div>
      </details>
    </StandalonePage>
  );
}

function CopyErrorButton({ report }: { report: string }) {
  const { copyToClipboard, isCopied } = useCopyToClipboard({ target: "error-report" });

  return (
    <Button size="sm" variant="outline" onClick={() => copyToClipboard(report)}>
      <MorphIcon className={cn(isCopied && "text-success")} icon={isCopied ? Check : Copy} />
      {isCopied ? "Copied" : "Copy error"}
    </Button>
  );
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return error;
  }

  return "The page stopped without saying why.";
}

function errorDetails(error: unknown): string {
  if (error instanceof Error) {
    return error.stack ?? error.message;
  }

  if (typeof error === "string") {
    return error;
  }

  try {
    return JSON.stringify(error, null, 2);
  } catch {
    return "No additional error details are available.";
  }
}

const MAX_ERROR_CAUSE_DEPTH = 5;

// Use only pathname to keep query tokens off the clipboard.
function errorReport(error: unknown, pathname: string): string {
  const lines = [
    `${APP_DISPLAY_NAME} ${APP_VERSION}`,
    `Path: ${pathname}`,
    `Time: ${new Date().toISOString()}`,
    "",
    errorDetails(error),
  ];
  let cause = error instanceof Error ? error.cause : undefined;
  for (let depth = 0; cause !== undefined && depth < MAX_ERROR_CAUSE_DEPTH; depth += 1) {
    lines.push("", "Caused by:", errorDetails(cause));
    cause = cause instanceof Error ? cause.cause : undefined;
  }
  return lines.join("\n");
}

// The home is the boards list, so a server's bootstrap thread only expands its project in the
// sidebar; it never takes "/" away from the boards.
function EventRouter() {
  const projectGroupingSettings = useClientSettings(selectProjectGroupingSettings);
  const serverConfig = useAtomValue(primaryServerConfigAtom);
  const serverWelcome = useAtomValue(primaryServerWelcomeAtom);

  const handleWelcome = useEffectEvent((payload: ServerLifecycleWelcomePayload | null) => {
    if (!payload?.bootstrapProjectId || !payload.bootstrapThreadId) return;
    const bootstrapProject = readProject(
      scopeProjectRef(payload.environment.environmentId, payload.bootstrapProjectId),
    );
    const bootstrapProjectKey =
      (bootstrapProject
        ? deriveLogicalProjectKeyFromSettings(bootstrapProject, projectGroupingSettings)
        : null) ??
      (serverConfig?.cwd
        ? derivePhysicalProjectKeyFromPath(payload.environment.environmentId, serverConfig.cwd)
        : null) ??
      scopedProjectKey(
        scopeProjectRef(payload.environment.environmentId, payload.bootstrapProjectId),
      );
    useUiStateStore.getState().setProjectExpanded(bootstrapProjectKey, true);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- expands the bootstrap project in the UI store on a server welcome
  useEffect(() => {
    handleWelcome(serverWelcome);
  }, [serverWelcome]);

  return null;
}
