import { CloudIcon, XIcon } from "lucide-react";
import * as Schema from "effect/Schema";
import { useState } from "react";

import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

// Per browser: the person said no thanks, so it does not ask again.
const DISMISSED_KEY = "t3code:sign-in-nudge-dismissed:v1";

const readDismissed = () => {
  try {
    return getLocalStorageItem(DISMISSED_KEY, Schema.Boolean) === true;
  } catch {
    return false;
  }
};

/**
 * Once someone signed out has a cloud board, a quiet offer to sign in so their boards follow them
 * to other devices. Dismissed once, it stays away.
 */
export function SignInNudge({ cloudBoards }: { readonly cloudBoards: boolean }) {
  const account = useBoardAccount();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (!cloudBoards || dismissed || account.status !== "signed-out" || !boardAccountsEnabled()) {
    return null;
  }
  return (
    <SignInOffer
      onDismiss={() => {
        setDismissed(true);
        try {
          setLocalStorageItem(DISMISSED_KEY, true, Schema.Boolean);
        } catch {}
      }}
    />
  );
}

function SignInOffer({ onDismiss }: { readonly onDismiss: () => void }) {
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <Alert variant="info" data-sign-in-nudge>
      <CloudIcon />
      <AlertTitle>Keep your boards on every device</AlertTitle>
      <AlertDescription>
        Your boards are saved in this browser. Sign in to open them anywhere, and never lose them.
      </AlertDescription>
      <AlertAction>
        <Button size="sm" onClick={openAuthPrompt} data-sign-in-nudge-sign-in>
          Sign in
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Not now"
          title="Not now"
          onClick={onDismiss}
        >
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
