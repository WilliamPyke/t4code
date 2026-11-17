import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { BotIcon, DownloadIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useEnvironments } from "~/state/environments";

import { openConnectComputer } from "../ConnectComputerDialog";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";

// Per browser: the person said no thanks; the sidebar still offers it.
const DISMISSED_KEY = "t3code:connect-computer-nudge-dismissed:v1";

const readDismissed = () => {
  try {
    return getLocalStorageItem(DISMISSED_KEY, Schema.Boolean) === true;
  } catch {
    return false;
  }
};

/** On the boards home until a computer is connected: the way to Tinkjam Sync, one click away. */
export function ConnectComputerNudge() {
  const hasComputer = useEnvironments().environments.some(
    (environment) => !isGuestEnvironment(environment.environmentId),
  );
  const [dismissed, setDismissed] = useState(readDismissed);
  if (hasComputer || dismissed) return null;
  return (
    <Alert variant="info" data-connect-computer-nudge>
      <BotIcon />
      <AlertTitle>Bring your AI agents onto your boards</AlertTitle>
      <AlertDescription>
        Get Tinkjam Sync for your computer: download it, open it, press Connect. It then lives in
        your menu bar and your boards can use Claude Code or Codex on it.
      </AlertDescription>
      <AlertAction>
        <Button size="sm" onClick={openConnectComputer}>
          <DownloadIcon />
          Get Tinkjam Sync
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Not now"
          onClick={() => {
            setDismissed(true);
            try {
              setLocalStorageItem(DISMISSED_KEY, true, Schema.Boolean);
            } catch {}
          }}
        >
          <XIcon />
        </Button>
      </AlertAction>
    </Alert>
  );
}
