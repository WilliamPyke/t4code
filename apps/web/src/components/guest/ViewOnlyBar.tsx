import { CLOUD_ACCESS_MESSAGE_MAX_LENGTH } from "@t3tools/contracts";
import { CopyIcon, EyeIcon } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";

import { useBoardAccount } from "~/guest/boardAccount";
import {
  askEditAccess,
  forgetAskedAccess,
  loadAskedAccess,
  takeGrantedAccess,
  useAskedAccess,
} from "~/guest/inbox";

import { useT3ConnectAuthPrompt } from "../clerk/useT3ConnectAuthPrompt";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Popover, PopoverPopup, PopoverTitle, PopoverTrigger } from "../ui/popover";
import { toastManager } from "../ui/toast";
import { viewingLabel } from "./cloudBoardSharing.logic";

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
  copy,
}: {
  readonly viewing: number;
  readonly shareId: string;
  /** Makes the viewer's own copy, where the board's maker allows copies. */
  readonly copy?: (() => Promise<void>) | undefined;
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
  const signedIn = account.status === "signed-in";
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a request asked before this page loaded is on the board host; the bar says Asked while it is open
  useEffect(() => {
    if (signedIn) void loadAskedAccess(shareId);
  }, [signedIn, shareId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a seat that can edit again leaves this bar; its request is answered
  useEffect(() => () => forgetAskedAccess(shareId), [shareId]);
  return (
    <span className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground" data-view-only>
      <span className="flex shrink-0 items-center gap-1 font-medium text-foreground">
        <EyeIcon className="size-3.5" aria-hidden />
        View only
      </span>
      {viewing > 1 ? <span className="shrink-0">· {viewingLabel(viewing)}</span> : null}
      {copy !== undefined ? (
        <MakeACopy copy={copy} />
      ) : account.status === "signed-out" ? (
        <SignInToAsk signIn={openAuthPrompt} />
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

function MakeACopy({ copy }: { readonly copy: () => Promise<void> }) {
  const [copying, setCopying] = useState(false);
  return (
    <>
      <span className="truncate">· Make a copy to try it yourself</span>
      <Button
        size="xs"
        disabled={copying}
        onClick={() => {
          setCopying(true);
          void copy().finally(() => setCopying(false));
        }}
        data-make-copy
      >
        <CopyIcon />
        Make a copy
      </Button>
    </>
  );
}

/** Says what asking does before the sign-in it needs, which says nothing of boards. */
function SignInToAsk({ signIn }: { readonly signIn: () => void }) {
  return (
    <Popover>
      <PopoverTrigger render={<Button size="xs" variant="ghost-muted" data-view-only-sign-in />}>
        Sign in to ask for edit access
      </PopoverTrigger>
      <PopoverPopup width="md" align="end">
        <PopoverTitle className="mb-2">Ask for edit access</PopoverTitle>
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Sign in or create an account first, then press Ask for edit access. Whoever made this
            board gets your request in their inbox and can let you edit.
          </p>
          <Button size="sm" onClick={signIn} data-view-only-sign-in-continue>
            Sign in
          </Button>
        </div>
      </PopoverPopup>
    </Popover>
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
