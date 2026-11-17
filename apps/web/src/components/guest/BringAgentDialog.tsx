import { isGuestEnvironment } from "@t3tools/client-runtime/environment";
import { Link } from "@tanstack/react-router";
import { ChevronRightIcon, DownloadIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { DESKTOP_DOWNLOAD_URL } from "~/branding";
import { hasCloudPublicConfig } from "~/cloud/publicConfig";
import { boardAccountsEnabled, useBoardAccount } from "~/guest/boardAccount";
import { useProjects } from "~/state/entities";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { CloudEnvironmentConnectRows } from "../cloud/CloudEnvironmentConnectList";
import { InstallT3Commands } from "../InstallT3Commands";
import { Button } from "../ui/button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "../ui/collapsible";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../ui/dialog";

/**
 * How a person brings their own agent to a cloud board, which has none of its own. With Tinkjam
 * on their computer connected here, it is one button; without, three short steps get it there.
 */
export function BringAgentDialog({
  open,
  onOpenChange,
  onContinue,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  /** Opens this board on the person's own machine. Resolves to what went wrong, or null. */
  readonly onContinue: () => Promise<string | null>;
}) {
  // Their own machines are the ones with projects; a joined board's page has none.
  const hasMachine = useProjects().some((project) => !isGuestEnvironment(project.environmentId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const start = async () => {
    setBusy(true);
    const failed = await onContinue();
    setBusy(false);
    setError(failed);
    if (failed === null) onOpenChange(false);
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Bring your agent to this board</DialogTitle>
          <DialogDescription>
            Your agent runs on your own computer, with your own Claude, Codex or other AI account.
            Only you can start it. Others see what it makes.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {hasMachine ? (
            <p className="text-sm text-muted-foreground">
              Tinkjam on your computer opens this board in a new tab and joins it. Your agent's
              boxes then show here for everyone.
            </p>
          ) : (
            <SetupSteps />
          )}
          {error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="outline" />}>Not now</DialogClose>
          <Button
            disabled={busy || !hasMachine}
            title={hasMachine ? undefined : "Connect your computer first"}
            onClick={() => void start()}
            data-bring-agent
          >
            Bring my agent
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}

/** Getting Tinkjam on this person's computer and connected to this browser. */
function SetupSteps() {
  const account = useBoardAccount();
  // Signed in on both, the computer finds this browser by itself; otherwise it is paired by hand.
  const withAccount = boardAccountsEnabled() && hasCloudPublicConfig();
  return (
    <ol className="flex flex-col gap-4 text-sm" data-bring-agent-steps>
      <Step number={1} title="Get Tinkjam on your computer">
        <Button
          size="sm"
          variant="outline"
          render={<a href={DESKTOP_DOWNLOAD_URL} target="_blank" rel="noreferrer noopener" />}
        >
          <DownloadIcon />
          Download the app
        </Button>
        <Collapsible>
          <CollapsibleTrigger className="mt-2 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground data-panel-open:[&_svg]:rotate-90">
            <ChevronRightIcon aria-hidden className="size-3.5" />
            Using a terminal instead?
          </CollapsibleTrigger>
          <CollapsiblePanel>
            <InstallT3Commands command={withAccount ? "t3 connect" : "t3 pair"} className="mt-2" />
          </CollapsiblePanel>
        </Collapsible>
      </Step>
      {withAccount ? (
        <>
          <Step number={2} title="Sign in there with the same account">
            {account.status === "signed-in" ? (
              <p className="text-muted-foreground">
                Open the app and sign in, then turn on Tinkjam Connect when it asks.
              </p>
            ) : (
              <SignInHere />
            )}
          </Step>
          <Step number={3} title="Pick your computer">
            {account.status === "signed-in" ? (
              <CloudEnvironmentConnectRows
                primaryEnvironmentId={null}
                savedEnvironments={[]}
                refreshWhileEmpty
                empty={
                  <p className="text-xs text-muted-foreground">
                    Waiting for your computer. It shows here once the app is signed in.
                  </p>
                }
              />
            ) : (
              <p className="text-muted-foreground">It shows here once you are signed in.</p>
            )}
          </Step>
        </>
      ) : (
        <Step number={2} title="Connect it to this browser">
          <p className="mb-2 text-muted-foreground">
            The app gives you a link to pair. Add it here.
          </p>
          <Button size="sm" variant="outline" render={<Link to="/settings/connections" />}>
            Add my computer
          </Button>
        </Step>
      )}
    </ol>
  );
}

function SignInHere() {
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  return (
    <>
      <p className="mb-2 text-muted-foreground">Sign in here too, so this board can find it.</p>
      <Button size="sm" variant="outline" onClick={openAuthPrompt}>
        Sign in
      </Button>
    </>
  );
}

function Step({
  number,
  title,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold"
      >
        {number}
      </span>
      <div className="flex min-w-0 flex-1 flex-col items-start">
        <p className="mb-1.5 font-medium">{title}</p>
        {children}
      </div>
    </li>
  );
}
