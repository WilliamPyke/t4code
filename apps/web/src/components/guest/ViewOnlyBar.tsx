import { CLOUD_ACCESS_MESSAGE_MAX_LENGTH } from "@t3tools/contracts";
import { EyeIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { useBoardAccount } from "~/guest/boardAccount";
import { askEditAccess, forgetAskedAccess, takeGrantedAccess, useAskedAccess } from "~/guest/inbox";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { viewingLabel } from "./CloudBoardSharing";

/**
 * What someone who can only look sees in place of the board's sharing: that it is view only, how
 * many watch with them, and the way to ask for edit access: signed in, from here; signed out,
 * after signing in.
 */
export function ViewOnlyBar({
  viewing,
  shareId,
  viewCredential,
  granted,
}: {
  readonly viewing: number;
  readonly shareId: string;
  /** The view link this page opened the board with; absent for someone on the board. */
  readonly viewCredential: string | undefined;
  /** Requests the board approved lately, as its view says. */
  readonly granted: ReadonlyArray<string> | undefined;
}) {
  const account = useBoardAccount();
  const { openAuthPrompt } = useT3ConnectAuthPrompt();
  const asked = useAskedAccess(shareId);
  const approved = asked !== null && granted?.includes(asked) === true;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- once the board says this page's request was approved, opens it as the account's new seat on the host
  useEffect(() => {
    if (!approved || viewCredential === undefined) return;
    void takeGrantedAccess(shareId).then((failed) => {
      if (failed !== null) {
        toastManager.add({
          type: "error",
          title: "Could not open the board to edit",
          description: failed,
        });
      }
    });
  }, [approved, shareId, viewCredential]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a seat that can edit again leaves this bar; its request is answered
  useEffect(() => () => forgetAskedAccess(shareId), [shareId]);
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
      ) : account.status !== "signed-in" ? (
        <span className="truncate">· Ask whoever shared it for edit access</span>
      ) : asked !== null ? (
        <span className="truncate" data-view-only-asked>
          · Asked. The answer comes to your inbox.
        </span>
      ) : (
        <AskForAccess shareId={shareId} viewCredential={viewCredential} />
      )}
    </span>
  );
}

function AskForAccess({
  shareId,
  viewCredential,
}: {
  readonly shareId: string;
  readonly viewCredential: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (sending) return;
    setSending(true);
    const problem = await askEditAccess(shareId, { message, credential: viewCredential });
    setSending(false);
    setFailed(problem);
    if (problem === null) setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button size="xs" variant="outline" data-ask-edit-access />}>
        Ask for edit access
      </PopoverTrigger>
      <PopoverPopup width="md" align="end">
        <PopoverTitle className="mb-2">Ask for edit access</PopoverTitle>
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <p className="text-xs text-muted-foreground">
            Whoever made this board gets your request in their inbox.
          </p>
          <Input
            aria-label="A short note, if you like"
            placeholder="A short note, if you like"
            maxLength={CLOUD_ACCESS_MESSAGE_MAX_LENGTH}
            value={message}
            onChange={(event) => setMessage(event.currentTarget.value)}
          />
          {failed === null ? null : (
            <p role="alert" className="text-xs text-destructive">
              {failed}
            </p>
          )}
          <Button type="submit" size="sm" disabled={sending}>
            Ask
          </Button>
        </form>
      </PopoverPopup>
    </Popover>
  );
}
