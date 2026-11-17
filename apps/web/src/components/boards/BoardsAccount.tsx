import { UserButton } from "@clerk/react";
import { LogInIcon } from "lucide-react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";

/**
 * Sign in, so a person's cloud boards follow them to every device; signed in, who they are and
 * the way out. Absent where this build has no sign-in or no cloud boards.
 */
export function BoardsAccount() {
  // The desktop app's sign-in is for Tinkjam Connect; its boards stay on this computer for now.
  if (!boardAccountsEnabled()) return null;
  return <ConfiguredBoardsAccount />;
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
  return (
    <span className="flex min-w-0 items-center gap-2" data-boards-account>
      {account.name === null ? null : (
        <span className="max-w-40 truncate text-sm font-medium">{account.name}</span>
      )}
      <UserButton />
    </span>
  );
}
