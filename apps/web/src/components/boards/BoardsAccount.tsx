import { UserButton, useUser } from "@clerk/react";
import { GUEST_NAME_MAX_LENGTH } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";
import * as Schema from "effect/Schema";
import { LogInIcon, UserRoundIcon, XIcon } from "lucide-react";
import { type FormEvent, useState } from "react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { accountNameParts } from "~/guest/boardAccount.logic";
import { rememberBoardName, useRememberedBoardName } from "~/guest/cloudBoards";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { toastManager } from "../ui/toast";

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
      <Button
        variant="outline"
        onClick={openAuthPrompt}
        title="Sign in to see your boards on every device"
        data-boards-sign-in
      >
        <LogInIcon />
        Sign in
      </Button>
    );
  }
  if (account.status !== "signed-in") return null;
  return <AccountMenu name={account.name} />;
}

/** The person's name and avatar; the avatar opens Clerk's menu with their account page in it. */
function AccountMenu({ name }: { readonly name: string | null }) {
  const navigate = useNavigate();
  return (
    <span className="flex min-w-0 items-center gap-2" data-boards-account>
      {name === null ? null : <span className="max-w-40 truncate text-sm font-medium">{name}</span>}
      <UserButton>
        <UserButton.MenuItems>
          <UserButton.Action
            label="Your account"
            labelIcon={<UserRoundIcon className="size-4" />}
            onClick={() => void navigate({ to: "/account" })}
          />
          <UserButton.Action label="manageAccount" />
          <UserButton.Action label="signOut" />
        </UserButton.MenuItems>
      </UserButton>
    </span>
  );
}

// Per browser: the accounts already asked for a name, so each is asked once.
const NAME_ASKED_KEY = "t3code:account-name-asked:v1";
const NameAsked = Schema.Array(Schema.String);

const readNameAsked = (): ReadonlyArray<string> => {
  try {
    return getLocalStorageItem(NAME_ASKED_KEY, NameAsked) ?? [];
  } catch {
    return [];
  }
};

const rememberNameAsked = (userId: string) => {
  try {
    setLocalStorageItem(NAME_ASKED_KEY, [...readNameAsked(), userId].slice(-20), NameAsked);
  } catch {
    // Blocked storage only means asking again next time.
  }
};

/**
 * Once per account, when it has no name of its own (signed up with only an email): what everyone
 * should call them, kept on the account so it follows them. Until then the name this browser
 * already joined boards under stands in, never anything from their email.
 */
export function AccountNameAsk() {
  if (!boardAccountsEnabled()) return null;
  return <ConfiguredAccountNameAsk />;
}

function ConfiguredAccountNameAsk() {
  const account = useBoardAccount();
  const { user } = useUser();
  const browserName = useRememberedBoardName();
  const [asked, setAsked] = useState(readNameAsked);
  const [typed, setTyped] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  if (account.status !== "signed-in" || account.realName || user == null) return null;
  if (asked.includes(user.id)) return null;
  const name = typed ?? browserName ?? "";
  const done = () => {
    rememberNameAsked(user.id);
    setAsked((before) => [...before, user.id]);
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = name.trim().slice(0, GUEST_NAME_MAX_LENGTH).trim();
    if (trimmed === "" || saving) return;
    setSaving(true);
    rememberBoardName(trimmed);
    // Kept on the account when its sign-in settings allow a name; on this browser regardless.
    const saved = await user.update(accountNameParts(trimmed)).then(
      () => true,
      () => false,
    );
    setSaving(false);
    if (!saved) {
      toastManager.add({
        type: "info",
        title: "Saved on this browser",
        description: "Your account could not keep the name, so other devices may ask again.",
      });
    }
    done();
  };
  return (
    <form
      className="flex flex-wrap items-center gap-2 rounded-board border border-board-hairline bg-card px-3 py-2 text-card-foreground shadow-paint"
      onSubmit={save}
      data-account-name-ask
    >
      <label htmlFor="account-name-ask" className="text-sm font-medium">
        What should we call you?
      </label>
      <div className="w-48">
        <Input
          id="account-name-ask"
          size="sm"
          autoComplete="name"
          maxLength={GUEST_NAME_MAX_LENGTH}
          placeholder="Your name"
          value={name}
          onChange={(event) => setTyped(event.currentTarget.value)}
        />
      </div>
      <Button type="submit" size="sm" disabled={saving || name.trim() === ""}>
        Save
      </Button>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label="Not now"
        title="Not now"
        onClick={done}
      >
        <XIcon />
      </Button>
      <span className="basis-full text-xs text-muted-foreground">
        Everyone on your boards sees it.
      </span>
    </form>
  );
}
