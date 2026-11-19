import { useClerk, useUser } from "@clerk/react";
import { useNavigate } from "@tanstack/react-router";
import { LogInIcon, LogOutIcon, SettingsIcon, UserRoundIcon, WrenchIcon } from "lucide-react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { setShellMode, useShellMode } from "~/shellMode";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from "../ui/menu";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * Sign in, so a person's cloud boards follow them to every device; signed in, who they are and
 * the way out. Absent where this build has no sign-in or no cloud boards.
 */
export function BoardsAccount() {
  // The desktop app's sign-in is for Tinkjam Connect; its boards stay on this computer for now.
  if (!boardAccountsEnabled()) return null;
  return <ConfiguredBoardsAccount />;
}

/**
 * The account menu in a corner of a screen before any board (the welcome, the join pages), so a
 * signed-in person can always see who they are and sign out. Nothing while signed out.
 */
export function AccountCorner() {
  if (!boardAccountsEnabled()) return null;
  return <ConfiguredAccountCorner />;
}

function ConfiguredAccountCorner() {
  const account = useBoardAccount();
  if (account.status !== "signed-in") return null;
  return (
    <div className="absolute end-4 top-4 z-10 flex items-center" data-account-corner>
      <AccountMenu name={account.name} />
    </div>
  );
}

function ConfiguredBoardsAccount() {
  const account = useBoardAccount();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  if (account.status === "signed-out") {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="outline" onClick={openAuthPrompt} data-boards-sign-in />}
        >
          <LogInIcon />
          Sign in
        </TooltipTrigger>
        <TooltipPopup>Sign in or create an account to see your boards on every device</TooltipPopup>
      </Tooltip>
    );
  }
  if (account.status !== "signed-in") return null;
  return <AccountMenu name={account.name} />;
}

/**
 * The person's name and avatar, opening a menu that says who they are (their name first, their
 * email under it, which only they see), their account page, and the way out.
 */
function AccountMenu({ name }: { readonly name: string | null }) {
  const navigate = useNavigate();
  const clerk = useClerk();
  const { user } = useUser();
  const email = user?.primaryEmailAddress?.emailAddress ?? null;
  const shellMode = useShellMode();
  const initial = Array.from((name ?? email ?? "?").trim())[0]?.toUpperCase() ?? "?";
  return (
    <Menu>
      <MenuTrigger
        render={<Button variant="ghost" aria-label="Your account" data-boards-account />}
      >
        {name === null ? null : <span className="max-w-40 truncate">{name}</span>}
        {user?.hasImage === true ? (
          <img
            src={user.imageUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="size-6 shrink-0 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden
            className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-2xs font-semibold"
          >
            {initial}
          </span>
        )}
      </MenuTrigger>
      <MenuPopup align="end">
        <div className="flex max-w-64 flex-col px-2 py-1.5" data-account-identity>
          <span className="text-sm font-medium wrap-anywhere">{name ?? "No name yet"}</span>
          {email === null ? null : (
            <span className="text-xs text-muted-foreground wrap-anywhere">{email}</span>
          )}
        </div>
        <MenuSeparator />
        <MenuItem onClick={() => void navigate({ to: "/account" })}>
          <UserRoundIcon />
          Your account
        </MenuItem>
        <MenuItem onClick={() => clerk.openUserProfile()}>
          <SettingsIcon />
          Sign-in and security
        </MenuItem>
        <MenuItem
          onClick={() => setShellMode(shellMode === "simple" ? "advanced" : "simple")}
          data-account-shell-mode
        >
          <WrenchIcon />
          <span className="flex max-w-56 flex-col">
            {shellMode === "simple" ? "Switch to Advanced" : "Switch to Simple"}
            <span className="text-xs text-pretty text-muted-foreground">
              {shellMode === "simple"
                ? "Adds tools for developers beside your boards. Switch back here any time."
                : "Shows only your boards. Switch back here any time."}
            </span>
          </span>
        </MenuItem>
        <MenuSeparator />
        <MenuItem onClick={() => void clerk.signOut()}>
          <LogOutIcon />
          Sign out
        </MenuItem>
      </MenuPopup>
    </Menu>
  );
}
