import * as Schema from "effect/Schema";
import { BotIcon, DownloadIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { getLocalStorageItem, setLocalStorageItem } from "~/hooks/useLocalStorage";
import { useHasComputer } from "~/state/environments";

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
  const hasComputer = useHasComputer();
  const [dismissed, setDismissed] = useState(readDismissed);
  if (hasComputer || dismissed) return null;
  return (
    <section
      className="flex flex-col gap-3 rounded-tile border border-rule bg-raised p-4 text-sm sm:flex-row sm:items-center"
      data-connect-computer-nudge
    >
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-tint text-accent-text"
        >
          <BotIcon className="size-4.5" />
        </span>
        <div className="flex min-w-0 flex-col gap-0.5">
          <h2 className="text-ui-md font-semibold text-foreground">
            Bring your AI agents onto your boards
          </h2>
          <p className="text-body">
            Get Tinkjam Sync for your computer and press Connect. Your boards can then use Claude
            Code or Codex on it.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button size="md" onClick={openConnectComputer}>
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
