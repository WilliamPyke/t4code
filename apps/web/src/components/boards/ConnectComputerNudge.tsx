import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { BotIcon, CheckIcon, CopyIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { TINKJAM_AGENT_PROMPT } from "~/branding";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
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

/** On the boards home until a computer is connected: the prompt that connects one, one click away. */
export function ConnectComputerNudge() {
  const hasComputer = useEnvironments().environments.some(
    (environment) => !isGuestEnvironment(environment.environmentId),
  );
  const [dismissed, setDismissed] = useState(readDismissed);
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 2500, target: "prompt" });
  if (hasComputer || dismissed) return null;
  return (
    <Alert variant="info" data-connect-computer-nudge>
      <BotIcon />
      <AlertTitle>Bring your AI agents onto your boards</AlertTitle>
      <AlertDescription>
        Copy the prompt, paste it into Claude Code or Codex on your computer, and press Connect on
        the link it gives you. That is all.
      </AlertDescription>
      <AlertAction>
        <Button size="sm" onClick={() => copyToClipboard(TINKJAM_AGENT_PROMPT, undefined)}>
          {isCopied ? <CheckIcon /> : <CopyIcon />}
          {isCopied ? "Copied. Paste it to your agent" : "Copy prompt"}
        </Button>
        <Button size="sm" variant="outline" onClick={openConnectComputer}>
          Other ways
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
