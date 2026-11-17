import { EyeIcon } from "lucide-react";

import { useBoardAccount } from "~/guest/boardAccount";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { viewingLabel } from "./CloudBoardSharing";

/**
 * What someone who can only look sees in place of the board's sharing: that it is view only, how
 * many watch with them, and, signed out, the way to sign in before asking for edit access.
 */
export function ViewOnlyBar({ viewing }: { readonly viewing: number }) {
  const account = useBoardAccount();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" data-view-only>
      <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
        <EyeIcon className="size-3.5" aria-hidden />
        View only
      </span>
      {viewing > 1 ? <span className="shrink-0">· {viewingLabel(viewing)}</span> : null}
      {account.status === "signed-out" ? (
        <Button size="xs" variant="ghost-muted" onClick={openAuthPrompt} data-view-only-sign-in>
          Sign in to ask for edit access
        </Button>
      ) : (
        <span className="truncate">· Ask whoever shared it for edit access</span>
      )}
    </span>
  );
}
