import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import type { EnvironmentId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, LaptopIcon, PaletteIcon } from "lucide-react";
import type { ReactNode } from "react";

import { dispatchCommandPalette } from "~/commandPaletteStore";
import { requestConfirmDialog } from "~/confirmDialog";
import { environmentCatalog } from "~/connection/catalog";
import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { setShellMode } from "~/shellMode";
import { type EnvironmentPresentation, useEnvironments } from "~/state/environments";
import { useAtomCommand } from "~/state/use-atom-command";
import type { ThemePreferenceMode } from "~/themePalette";

import { AppRouteModalClose } from "../AppRouteModal";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { openConnectComputer } from "../ConnectComputerDialog";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingsGroup } from "./SettingsGroup";

/**
 * Settings in Simple mode: who you are, how Tinkjam looks, the computers your agents run on,
 * and the way to everything else. The full set stays one click away under Advanced settings.
 */
export function SimpleSettingsPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-simple-settings>
      <header className="flex h-12 shrink-0 items-center gap-3 border-b ps-5 pe-2">
        <h1 className="text-sm font-medium">Settings</h1>
        <div className="ms-auto flex shrink-0 items-center">
          <AppRouteModalClose />
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scrollbar-gutter-both">
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-8 px-4 py-6 pb-safe sm:px-6">
          <ProfileSection />
          <AppearanceSection />
          <ComputersSection />
          <AdvancedSection />
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-sm font-medium text-muted-foreground">{title}</h2>
      <SettingsGroup>{children}</SettingsGroup>
    </section>
  );
}

function Row({
  label,
  description,
  children,
}: {
  readonly label: ReactNode;
  readonly description?: ReactNode;
  readonly children?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        {description === undefined ? null : (
          <div className="text-xs text-muted-foreground">{description}</div>
        )}
      </div>
      {children === undefined ? null : (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>
      )}
    </div>
  );
}

function ProfileSection() {
  if (!boardAccountsEnabled()) return null;
  return (
    <Section title="Profile">
      <ProfileRow />
    </Section>
  );
}

function ProfileRow() {
  const account = useBoardAccount();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  if (account.status === "signed-in") {
    return (
      <Row label={account.name ?? "No name yet"} description="Your name, email and sign-in">
        <Button variant="outline" render={<Link to="/account" />}>
          Your account
        </Button>
      </Row>
    );
  }
  return (
    <Row label="Not signed in" description="Sign in to see your boards on every device.">
      <Button onClick={openAuthPrompt} disabled={account.status === "loading"}>
        Sign in
      </Button>
    </Row>
  );
}

const APPEARANCE: ReadonlyArray<{ readonly mode: ThemePreferenceMode; readonly label: string }> = [
  { mode: "light", label: "Light" },
  { mode: "dark", label: "Dark" },
  { mode: "system", label: "System" },
];

function AppearanceSection() {
  const { appearanceMode, setAppearanceMode } = useTheme();
  return (
    <Section title="Appearance">
      <Row label="Light or dark">
        <ToggleGroup
          aria-label="Light or dark"
          value={[appearanceMode]}
          onValueChange={(next) => {
            const mode = APPEARANCE.find((option) => option.mode === next[0])?.mode;
            if (mode !== undefined) setAppearanceMode(mode);
          }}
        >
          {APPEARANCE.map((option) => (
            <Toggle key={option.mode} value={option.mode}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>
      </Row>
      <Row label="Theme" description="Colours for the whole app">
        <Button
          variant="outline"
          onClick={() => dispatchCommandPalette({ _tag: "OpenChangeTheme" })}
        >
          <PaletteIcon />
          Choose a theme
        </Button>
      </Row>
    </Section>
  );
}

function computerStatus(environment: EnvironmentPresentation): {
  readonly label: string;
  readonly dot: string;
} {
  switch (environment.connection.phase) {
    case "connected":
      return { label: "Connected", dot: "bg-success" };
    case "connecting":
    case "reconnecting":
      return { label: "Connecting...", dot: "bg-warning" };
    default:
      return { label: "Offline", dot: "bg-muted-foreground/35" };
  }
}

function ComputersSection() {
  const { environments } = useEnvironments();
  const removeEnvironment = useAtomCommand(environmentCatalog.remove, { reportFailure: false });
  const computers = environments.filter(
    (environment) => !isGuestEnvironment(environment.environmentId),
  );
  const disconnect = async (environmentId: EnvironmentId, name: string) => {
    const confirmed =
      (await requestConfirmDialog(
        `Disconnect ${name}? Its agents leave your boards on this browser. You can connect it again later.`,
        { variant: "destructive" },
      )) ?? window.confirm(`Disconnect ${name}?`);
    if (!confirmed) return;
    const result = await removeEnvironment(environmentId);
    if (result._tag === "Failure") {
      toastManager.add({ type: "error", title: `Could not disconnect ${name}` });
    }
  };
  return (
    <Section title="Your computers">
      {computers.map((environment) => {
        const status = computerStatus(environment);
        const thisComputer = environment.entry.target._tag === "PrimaryConnectionTarget";
        return (
          <Row
            key={environment.environmentId}
            label={
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden className={cn("size-2 shrink-0 rounded-full", status.dot)} />
                <span className="truncate">{environment.label}</span>
              </span>
            }
            description={thisComputer ? `This computer · ${status.label}` : status.label}
          >
            {thisComputer ? undefined : (
              <Button
                variant="outline"
                onClick={() => void disconnect(environment.environmentId, environment.label)}
              >
                Disconnect
              </Button>
            )}
          </Row>
        );
      })}
      <Row
        label={computers.length === 0 ? "No computer connected" : "Another computer"}
        description="Use the agents on your computer, such as Claude Code or Codex, on your boards."
      >
        <Button onClick={openConnectComputer}>
          <LaptopIcon />
          Connect a computer
        </Button>
      </Row>
    </Section>
  );
}

function AdvancedSection() {
  const navigate = useNavigate();
  return (
    <Section title="Advanced">
      <Row
        label="Advanced mode"
        description="Adds chats, projects, code changes, terminals and pull requests beside your boards."
      >
        <Switch
          aria-label="Advanced mode"
          checked={false}
          onCheckedChange={(checked) => {
            if (!checked) return;
            setShellMode("advanced");
            void navigate({ to: "/settings/general", replace: true });
          }}
        />
      </Row>
      <Link
        to="/settings/general"
        className="flex min-h-12 items-center gap-2 px-4 py-3 text-sm font-medium outline-none hover:bg-accent/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        data-advanced-settings
      >
        <span className="flex-1">Advanced settings</span>
        <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
      </Link>
    </Section>
  );
}
