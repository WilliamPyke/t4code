import { UserButton, useAuth } from "@clerk/react";
import { LogInIcon } from "lucide-react";

import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { isElectron } from "~/env";
import { cloudBoardsOrigin } from "~/guest/cloudBoardsHost";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";

/**
 * Sign in, so a person's cloud boards follow them to every device; signed in, who they are and
 * the way out. Absent where this build has no sign-in or no cloud boards.
 */
export function BoardsAccount() {
  // The desktop app's sign-in is for Tinkjam Connect; its boards stay on this computer for now.
  if (isElectron || !hasCloudPublicConfig() || cloudBoardsOrigin() === null) return null;
  return <ConfiguredBoardsAccount />;
}

function ConfiguredBoardsAccount() {
  const { isLoaded, isSignedIn } = useAuth();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  if (!isLoaded) return null;
  if (!isSignedIn) {
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
  return (
    <span data-boards-account>
      <UserButton showName />
    </span>
  );
}
