import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import * as Schema from "effect/Schema";
import { BotIcon, DownloadIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useEnvironments } from "~/state/environments";

import { openConnectComputer } from "../ConnectComputerDialog";
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
    <section
      className="flex flex-col gap-3 rounded-xl border border-info/32 bg-info/4 px-3.5 py-3 text-sm sm:flex-row sm:items-center"
      data-connect-computer-nudge
    >
      <div className="flex min-w-0 flex-1 gap-2.5">
        <BotIcon className="mt-0.5 size-4 shrink-0 text-info" aria-hidden />
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="font-medium">Bring your AI agents onto your boards</h2>
          <p className="text-muted-foreground">
            Get Tinkjam Sync for your computer and press Connect. Your boards can then use Claude
            Code or Codex on it.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="sm" onClick={openConnectComputer}>
          <DownloadIcon />
          Get Tinkjam Sync
        </Button>
        <Button
          size="icon-sm"
          variant="ghost"
          aria-label="Hide this"
          onClick={() => {
            setDismissed(true);
            try {
              setLocalStorageItem(DISMISSED_KEY, true, Schema.Boolean);
            } catch {}
          }}
        >
          <XIcon />
        </Button>
      </div>
    </section>
  );
}
