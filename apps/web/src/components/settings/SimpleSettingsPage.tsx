import type { ClientSettings, EnvironmentId } from "@t3tools/contracts";
import { EMBER_THEME, GROVE_THEME, IRIS_THEME, OCEAN_THEME } from "@t3tools/shared/themePalettes";
import { Link, useNavigate } from "@tanstack/react-router";
import {
  CheckIcon,
  ChevronRightIcon,
  LaptopIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SlidersHorizontalIcon,
  SunIcon,
  UserRoundIcon,
  type LucideIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";

import { requestConfirmDialog } from "~/confirmDialog";
import {
  boardAccountsEnabled,
  readBoardAccountProfile,
  useBoardAccount,
} from "~/guest/boardAccount";
import { useCustomThemes } from "~/hooks/useCustomThemes";
import { useEnvironmentThemeDefinitions } from "~/hooks/useEnvironmentTheme";
import { updateClientSettings, useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { cn } from "~/lib/utils";
import { setShellMode } from "~/shellMode";
import {
  getThemeDefinition,
  getThemeModes,
  type ThemeAppearance,
  type ThemeDefinition,
  type ThemePreferenceMode,
} from "~/themePalette";

import { AppRouteModalClose } from "../AppRouteModal";
import { notifyThemeSaveFailure } from "../CommandPaletteThemeItems";
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
import { TEXT_SIZE_OPTIONS, TEXT_SIZE_PRESETS, textSizePresetOf } from "./SettingsPanels.logic";
import { useThemeEditorStore } from "./themeEditorStore";
import {
  STANDARD_THEME_CARDS,
  type ThemeCardDefinition,
  type ThemeCardPreviewColors,
  getThemeCardDefinition,
  previewColorsOf,
} from "./ThemePreviewCircles";
import { ThemeWireframe } from "./ThemeWireframe";

type SectionId = "appearance" | "computers" | "account" | "advanced";

const NAV: ReadonlyArray<{ readonly id: SectionId; readonly label: string; icon: LucideIcon }> = [
  { id: "appearance", label: "Appearance", icon: SunIcon },
  { id: "computers", label: "Your computers", icon: LaptopIcon },
  { id: "account", label: "Account", icon: UserRoundIcon },
  { id: "advanced", label: "Advanced", icon: SlidersHorizontalIcon },
];

const sectionDomId = (id: SectionId) => `simple-settings-${id}`;

/**
 * Settings in Simple mode: how Tinkjam looks, the computers your agents run on, who you are,
 * and the way to everything else. The full set stays one click away under Advanced settings.
 */
export function SimpleSettingsPage() {
  const accounts = boardAccountsEnabled();
  const [current, setCurrent] = useState<SectionId>("appearance");
  const nav = NAV.filter((item) => accounts || item.id !== "account");
  const jump = (id: SectionId) => {
    setCurrent(id);
    document
      .getElementById(sectionDomId(id))
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="flex min-h-0 flex-1" data-simple-settings>
      <aside className="hidden w-60 shrink-0 flex-col gap-6 border-e bg-panel px-3 pt-7 pb-4 md:flex">
        <h1 className="px-2 font-heading text-wordmark font-semibold tracking-brand">Settings</h1>
        <nav aria-label="Settings sections" className="flex flex-col gap-0.5">
          {nav.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={current === item.id ? "true" : undefined}
              onClick={() => jump(item.id)}
              className={cn(
                "flex h-9 items-center gap-2.5 rounded-lg border border-transparent px-2.5 text-start text-sm font-medium text-foreground outline-none hover:bg-sidebar-row-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                current === item.id && "border-border bg-card",
              )}
            >
              <item.icon
                aria-hidden
                className={cn(
                  "size-4.5 shrink-0",
                  current === item.id ? "text-accent-text" : "text-muted-foreground",
                )}
              />
              {item.label}
            </button>
          ))}
        </nav>
      </aside>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-3 ps-5 pe-2 max-md:border-b md:absolute md:end-2 md:top-2 md:z-10 md:h-auto md:p-0">
          <h1 className="font-heading text-lg font-semibold md:hidden">Settings</h1>
          <div className="ms-auto flex shrink-0 items-center">
            <AppRouteModalClose />
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain scrollbar-gutter-both">
          <div className="mx-auto grid w-full max-w-6xl items-start gap-5 px-4 py-5 pb-safe sm:px-6 md:py-9 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:px-10">
            <div className="flex min-w-0 flex-col gap-5">
              <AppearanceSection />
            </div>
            <div className="flex min-w-0 flex-col gap-5">
              <ComputersSection />
              {accounts ? <AccountSection /> : null}
              <AdvancedSection />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Card({
  id,
  title,
  action,
  children,
}: {
  readonly id: SectionId;
  readonly title: string;
  readonly action?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <section
      id={sectionDomId(id)}
      aria-labelledby={`${sectionDomId(id)}-title`}
      className="flex scroll-mt-6 flex-col gap-5 rounded-dialog border bg-raised p-5 text-card-foreground sm:p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id={`${sectionDomId(id)}-title`}
          className="font-heading text-xl leading-tight font-semibold tracking-brand"
        >
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function FieldLabel({ children }: { readonly children: ReactNode }) {
  return <h3 className="text-sm font-semibold">{children}</h3>;
}

const APPEARANCE: ReadonlyArray<{
  readonly mode: ThemePreferenceMode;
  readonly label: string;
  readonly icon: LucideIcon;
}> = [
  { mode: "light", label: "Light", icon: SunIcon },
  { mode: "dark", label: "Dark", icon: MoonIcon },
  { mode: "system", label: "System", icon: MonitorIcon },
];

// The product's own themes, in the order the design shows them.
const TINKJAM_THEMES: ReadonlyArray<ThemeDefinition> = [
  GROVE_THEME,
  OCEAN_THEME,
  EMBER_THEME,
  IRIS_THEME,
];

/** One theme card per id, the standard one first, then built-in, published, and your own. */
function useThemeChoices() {
  const customThemes = useCustomThemes();
  const environmentThemes = useEnvironmentThemeDefinitions();
  const seen = new Set<string>();
  const choices: Array<{ readonly id: string | null; readonly card: ThemeCardDefinition }> =
    STANDARD_THEME_CARDS.map((card) => ({ id: null, card }));
  for (const definition of [...TINKJAM_THEMES, ...environmentThemes, ...customThemes]) {
    if (seen.has(definition.id)) continue;
    seen.add(definition.id);
    choices.push({ id: definition.id, card: getThemeCardDefinition(definition) });
  }
  return choices;
}

function AppearanceSection() {
  const {
    theme,
    themeHalves,
    resolvedTheme,
    appearanceMode,
    setAppearanceMode,
    setTheme,
    setThemeHalf,
  } = useTheme();
  const openThemeEditor = useThemeEditorStore((store) => store.openThemeEditor);
  const choices = useThemeChoices();
  const baseId = getThemeDefinition(theme)?.id ?? null;
  const ownerOf = (appearance: ThemeAppearance) => themeHalves?.[appearance] ?? baseId;
  const colorsFor = (appearance: ThemeAppearance): ThemeCardPreviewColors => {
    const owner = ownerOf(appearance);
    const card = choices.find((choice) => choice.id === owner)?.card ?? STANDARD_THEME_CARDS[0]!;
    return previewColorsOf(card, appearance) ?? card.previews[0]!.colors;
  };
  const current = ownerOf(resolvedTheme);

  const pick = (id: string | null) => {
    if (id === null) {
      if (!setTheme(appearanceMode)) notifyThemeSaveFailure();
      return;
    }
    const definition = getThemeDefinition(id);
    const modes = definition === null ? [] : getThemeModes(definition);
    const saved = modes.length === 1 ? setThemeHalf(modes[0]!, id) : setTheme(id);
    if (!saved) notifyThemeSaveFailure();
  };

  return (
    <Card id="appearance" title="Appearance">
      <div className="flex flex-col gap-3">
        <FieldLabel>Light or dark</FieldLabel>
        <div role="group" aria-label="Light or dark" className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {APPEARANCE.map((option) => {
            const active = appearanceMode === option.mode;
            return (
              <button
                key={option.mode}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  if (!setAppearanceMode(option.mode)) notifyThemeSaveFailure();
                }}
                className="group flex cursor-pointer flex-col gap-2 rounded-xl text-start outline-none"
              >
                <span
                  className={cn(
                    "block rounded-xl p-0.5 transition-colors group-focus-visible:outline-2 group-focus-visible:outline-ring group-focus-visible:-outline-offset-2",
                    active ? "bg-primary" : "bg-transparent group-hover:bg-border",
                  )}
                >
                  <ThemeWireframe
                    className="h-16 rounded-board sm:h-20"
                    panes={
                      option.mode === "system"
                        ? [
                            { clip: "left", colors: colorsFor("light") },
                            { clip: "right", colors: colorsFor("dark") },
                          ]
                        : [{ colors: colorsFor(option.mode) }]
                    }
                  />
                </span>
                <span className="flex items-center gap-1.5 text-sm font-semibold">
                  <option.icon aria-hidden className="size-4 text-muted-foreground" />
                  {option.label}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <FieldLabel>Theme</FieldLabel>
        <div
          role="radiogroup"
          aria-label="Theme"
          className="grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-2.5"
          data-simple-theme-picker
        >
          {choices.map(({ id, card }) => {
            const active = current === id;
            const colors = previewColorsOf(card, resolvedTheme) ?? card.previews[0]!.colors;
            const only = card.previews.length === 1 ? card.previews[0]!.mode : null;
            return (
              <button
                key={id ?? "standard"}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => pick(id)}
                className={cn(
                  "flex min-h-13 min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border bg-raised px-3 py-2 text-start outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  active && "border-primary ring-1 ring-primary ring-inset",
                )}
              >
                <ThemeSwatch colors={colors} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold">{card.label}</span>
                  {only === null ? null : (
                    <span className="text-xs text-muted-foreground">
                      {only === "light" ? "Light only" : "Dark only"}
                    </span>
                  )}
                </span>
                {active ? (
                  <CheckIcon aria-hidden className="size-4 shrink-0 text-accent-text" />
                ) : null}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() =>
              openThemeEditor({
                editingThemeId: null,
                seedThemeId: current,
                seedName: null,
                initialAppearance: resolvedTheme,
              })
            }
            className="flex min-h-13 min-w-0 cursor-pointer items-center gap-2.5 rounded-xl border bg-raised px-3 py-2 text-start text-sm font-semibold outline-none transition-colors hover:bg-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            data-simple-theme-create
          >
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-lg bg-panel text-muted-foreground"
            >
              <PlusIcon className="size-4" />
            </span>
            <span className="min-w-0">Make your own</span>
          </button>
        </div>
        <div>
          <Button
            size="sm"
            variant="ghost-muted"
            render={<Link to="/settings/appearance" />}
            data-simple-theme-more
          >
            All theme options
            <ChevronRightIcon aria-hidden />
          </Button>
        </div>
      </div>

      <TextSizeRow />
    </Card>
  );
}

/** A theme as the design shows it: its accent, with a corner of its page colour. */
function ThemeSwatch({ colors }: { readonly colors: ThemeCardPreviewColors }) {
  return (
    <span
      aria-hidden
      className="relative block size-7 shrink-0 overflow-hidden rounded-lg"
      style={{ backgroundColor: colors.accent }}
    >
      <span
        className="absolute end-0.5 bottom-0.5 size-3 rounded-sm"
        style={{
          backgroundColor: colors.messageSurface,
          boxShadow: `0 0 0 1.5px ${colors.accent}`,
        }}
      />
    </span>
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
    <div className="flex flex-col gap-3">
      <FieldLabel>Text size</FieldLabel>
      <div>
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
      </div>
      {preset === null ? (
        <p className="text-xs text-pretty text-muted-foreground">
          Using custom sizes from Advanced settings. Pick one to replace them.
        </p>
      ) : null}
    </div>
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
  const empty = list.computers.length === 0 && !list.loading && !list.failed;
  return (
    <Card
      id="computers"
      title="Your computers"
      action={
        <Button size="sm" variant="outline" onClick={openConnectComputer}>
          Connect a computer
        </Button>
      }
    >
      {list.computers.length > 0 ? (
        <ul className="-mt-1 flex flex-col">
          {list.computers.map((computer) => {
            const thisComputer = list.primaryIds.has(computer.environmentId);
            const status = computerStatusLine(computer);
            return (
              <li
                key={computer.environmentId}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 border-t py-3"
                data-computer={computer.status}
              >
                <span
                  aria-hidden
                  className="grid size-9 shrink-0 place-items-center rounded-lg bg-panel text-muted-foreground"
                >
                  <LaptopIcon className="size-4.5" />
                </span>
                <span className="min-w-40 flex-1">
                  <span className="block text-sm font-semibold wrap-anywhere">{computer.name}</span>
                  <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 -translate-y-px rounded-full",
                        COMPUTER_STATUS_DOT[computer.status],
                      )}
                    />
                    <span className="min-w-0 text-pretty">
                      {thisComputer ? `This computer · ${status}` : status}
                    </span>
                  </span>
                </span>
                <span className="ms-auto flex shrink-0 items-center gap-1.5">
                  {canRetryComputer(computer) ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={retrying !== null}
                      onClick={() => void retry(computer)}
                      data-retry-computer
                    >
                      {retrying === computer.environmentId ? "Checking…" : "Try again"}
                    </Button>
                  ) : null}
                  {thisComputer ? null : (
                    <Button
                      size="sm"
                      variant="destructive-outline"
                      disabled={removing !== null}
                      onClick={() => void remove(computer)}
                      aria-label={`Remove ${computer.name}`}
                      data-remove-computer
                    >
                      {removing === computer.environmentId ? "Removing…" : "Remove"}
                    </Button>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {list.loading && list.computers.length === 0 ? <ComputersLoading /> : null}
      {list.failed ? <ComputersNotLoaded onRetry={list.refresh} /> : null}
      {empty ? (
        <p className="text-sm text-pretty text-muted-foreground" data-no-computers>
          No computer connected yet. Connect one to use its agents, such as Claude Code or Codex, on
          your boards.
        </p>
      ) : null}
    </Card>
  );
}

function AccountSection() {
  const account = useBoardAccount();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const signedIn = account.status === "signed-in";
  const name = signedIn ? (account.name ?? "No name yet") : "Not signed in";
  const imageUrl = signedIn ? readBoardAccountProfile()?.imageUrl : undefined;
  return (
    <Card id="account" title="Account">
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-primary text-base font-semibold text-primary-foreground"
        >
          {imageUrl ? (
            <img src={imageUrl} alt="" className="size-full object-cover" />
          ) : signedIn ? (
            initialOf(name)
          ) : (
            <UserRoundIcon className="size-5" />
          )}
        </span>
        <span className="min-w-40 flex-1">
          <span className="block text-ui-md font-semibold wrap-anywhere">{name}</span>
          <span className="block text-xs text-muted-foreground">
            {signedIn
              ? "Your name, picture and sign-in"
              : "Sign in to see your boards on every device."}
          </span>
        </span>
        {signedIn ? (
          <Button size="sm" variant="outline" render={<Link to="/account" />}>
            Your account
          </Button>
        ) : (
          <Button size="sm" onClick={openAuthPrompt} disabled={account.status === "loading"}>
            Sign in
          </Button>
        )}
      </div>
    </Card>
  );
}

const initialOf = (name: string) => Array.from(name.trim())[0]?.toUpperCase() ?? "?";

function AdvancedSection() {
  const navigate = useNavigate();
  return (
    <Card id="advanced" title="Advanced">
      <label className="-mt-1 flex items-center gap-4">
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold">Advanced mode</span>
          <span className="text-xs text-pretty text-muted-foreground">
            For developers. Adds chats, projects and code changes beside your boards. You can switch
            back from Settings or the menu with your name.
          </span>
        </span>
        <Switch
          aria-label="Advanced mode"
          checked={false}
          onCheckedChange={(checked) => {
            if (!checked) return;
            setShellMode("advanced");
            void navigate({ to: "/settings/general", replace: true });
          }}
        />
      </label>
      <Link
        to="/settings/general"
        className="-mx-2 -mb-2 flex min-h-12 items-center gap-2 rounded-lg border-t px-2 pt-3 pb-2 text-sm font-semibold outline-none hover:text-accent-text focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
    </Card>
  );
}
