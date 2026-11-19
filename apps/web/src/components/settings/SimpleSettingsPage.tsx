import type { ClientSettings, EnvironmentId } from "@t3tools/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { ChevronRightIcon, LaptopIcon, PaletteIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { dispatchCommandPalette } from "~/commandPaletteStore";
import { requestConfirmDialog } from "~/confirmDialog";
import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { setShellMode } from "~/shellMode";
import type { ThemePreferenceMode } from "~/themePalette";

import { AppRouteModalClose } from "../AppRouteModal";
import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { openConnectComputer } from "../ConnectComputerDialog";
import type { BringAgentComputer } from "../guest/bringAgent.logic";
import { ComputersLoading, ComputersNotLoaded } from "../guest/ComputerRow";
import {
  COMPUTER_STATUS_DOT,
  canRetryComputer,
  computerStatusLine,
  useRemoveComputer,
  useYourComputers,
} from "../guest/yourComputers";
import { Button } from "../ui/button";
import { Switch } from "../ui/switch";
import { toastManager } from "../ui/toast";
import { Toggle, ToggleGroup } from "../ui/toggle-group";
import { SettingsGroup } from "./SettingsGroup";
import { TEXT_SIZE_OPTIONS, TEXT_SIZE_PRESETS, textSizePresetOf } from "./SettingsPanels.logic";

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
      <div className="min-w-40 flex-1">
        <div className="text-sm font-medium wrap-anywhere">{label}</div>
        {description === undefined ? null : (
          <div className="text-xs text-pretty text-muted-foreground">{description}</div>
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
      <Row label={account.name ?? "No name yet"} description="Your name, picture and sign-in">
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
      <Row label="Light or dark" description="System follows your device's setting.">
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
      <TextSizeRow />
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

const selectFontSizes = (settings: ClientSettings) => ({
  fontSizeInterface: settings.fontSizeInterface,
  fontSizePrompt: settings.fontSizePrompt,
  fontSizeCode: settings.fontSizeCode,
  fontSizeTerminal: settings.fontSizeTerminal,
});

function TextSizeRow() {
  const preset = textSizePresetOf(useClientSettings(selectFontSizes));
  return (
    <Row
      label="Text size"
      description={
        preset === null
          ? "Using custom sizes from Advanced settings. Pick one to replace them."
          : "Makes the words bigger or smaller everywhere. Medium is the standard size."
      }
    >
      <ToggleGroup
        aria-label="Text size"
        value={preset === null ? [] : [preset]}
        onValueChange={(next) => {
          const picked = TEXT_SIZE_OPTIONS.find((option) => option.preset === next[0]);
          if (picked !== undefined) void updateClientSettings(TEXT_SIZE_PRESETS[picked.preset]);
        }}
      >
        {TEXT_SIZE_OPTIONS.map((option) => (
          <Toggle key={option.preset} value={option.preset}>
            {option.label}
          </Toggle>
        ))}
      </ToggleGroup>
    </Row>
  );
}

function ComputersSection() {
  // The account's computers too, so one this browser never opened can still be removed.
  const list = useYourComputers({ active: true, pollEveryMs: null });
  const removeComputer = useRemoveComputer();
  const [removing, setRemoving] = useState<EnvironmentId | null>(null);
  const [retrying, setRetrying] = useState<EnvironmentId | null>(null);
  const remove = async (computer: BringAgentComputer) => {
    const question = removeComputer.question(computer.name);
    const confirmed =
      (await requestConfirmDialog(question, { variant: "destructive" })) ??
      window.confirm(question);
    if (!confirmed) return;
    setRemoving(computer.environmentId);
    const failed = await removeComputer.remove(computer);
    setRemoving(null);
    if (failed !== null) {
      toastManager.add({
        type: "error",
        title: `Could not remove ${computer.name}`,
        description: failed,
      });
    }
  };
  const retry = async (computer: BringAgentComputer) => {
    setRetrying(computer.environmentId);
    await list.retry(computer);
    setRetrying(null);
  };
  return (
    <Section title="Your computers">
      {list.computers.map((computer) => {
        const thisComputer = list.primaryIds.has(computer.environmentId);
        const status = computerStatusLine(computer);
        return (
          <Row
            key={computer.environmentId}
            label={
              <span className="flex min-w-0 items-baseline gap-2">
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 -translate-y-px rounded-full",
                    COMPUTER_STATUS_DOT[computer.status],
                  )}
                />
                <span className="min-w-0">{computer.name}</span>
              </span>
            }
            description={thisComputer ? `This computer · ${status}` : status}
          >
            {canRetryComputer(computer) ? (
              <Button
                variant="outline"
                disabled={retrying !== null}
                onClick={() => void retry(computer)}
                data-retry-computer
              >
                {retrying === computer.environmentId ? "Checking…" : "Try again"}
              </Button>
            ) : null}
            {thisComputer ? null : (
              <Button
                variant="outline"
                disabled={removing !== null}
                onClick={() => void remove(computer)}
                aria-label={`Remove ${computer.name}`}
                data-remove-computer
              >
                {removing === computer.environmentId ? "Removing…" : "Remove"}
              </Button>
            )}
          </Row>
        );
      })}
      {list.loading && list.computers.length === 0 ? (
        <div className="px-4 py-3">
          <ComputersLoading framed={false} />
        </div>
      ) : null}
      {list.failed ? (
        <div className="px-4 py-3">
          <ComputersNotLoaded onRetry={list.refresh} />
        </div>
      ) : null}
      <Row
        label={
          list.computers.length > 0
            ? "Another computer"
            : list.loading || list.failed
              ? "Your own agents"
              : "No computer connected yet"
        }
        description="Optional. Connect a computer to use the agents on it, such as Claude Code or Codex, on your boards."
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
        description="For developers. Adds chats, projects and code changes beside your boards. You can switch back from Settings or the menu with your name."
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
        <span className="flex flex-1 flex-col">
          Advanced settings
          <span className="text-xs font-normal text-muted-foreground">
            Every setting, without switching modes
          </span>
        </span>
        <ChevronRightIcon aria-hidden className="size-4 text-muted-foreground" />
      </Link>
    </Section>
  );
}
