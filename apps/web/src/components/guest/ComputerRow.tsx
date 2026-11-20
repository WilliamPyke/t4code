import { LaptopIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";

import { Alert, AlertAction, AlertDescription, AlertTitle } from "../ui/alert";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
import type { BringAgentComputer } from "./bringAgent.logic";
import { COMPUTER_STATUS_DOT, canRetryComputer, computerStatusLine } from "./yourComputers";

/**
 * One of the person's computers, the same in every list: how it is, Try again when asking again
 * could help, Remove, and whatever the list adds in `children`, such as Bring my agent.
 */
export function ComputerRow({
  computer,
  working = null,
  thisComputer = false,
  emphasis = false,
  disabled = false,
  children,
  onRetry,
  onRemove,
  removeQuestion,
}: {
  readonly computer: BringAgentComputer;
  /** What is happening to it right now, shown instead of its status. */
  readonly working?: string | null;
  readonly thisComputer?: boolean;
  /** The row to act on first: drawn in the accent. */
  readonly emphasis?: boolean;
  /** Something else in the list is under way. */
  readonly disabled?: boolean;
  readonly children?: ReactNode;
  readonly onRetry: () => Promise<void>;
  /** Resolves to what went wrong, or null. Null for this computer's own, which cannot go. */
  readonly onRemove: (() => Promise<string | null>) | null;
  readonly removeQuestion: string;
}) {
  const [retrying, setRetrying] = useState(false);
  const [removal, setRemoval] = useState<{
    readonly phase: "confirming" | "removing";
    readonly error: string | null;
  } | null>(null);
  const remove = async () => {
    if (onRemove === null) return;
    setRemoval({ phase: "removing", error: null });
    const failed = await onRemove();
    // On success the row goes away with the computer.
    if (failed !== null) setRemoval({ phase: "confirming", error: failed });
  };
  const status = computerStatusLine(computer);
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl border px-3.5 py-3",
        emphasis
          ? "border-primary bg-accent-tint ring-1 ring-primary ring-inset"
          : computer.status === "ready" || computer.status === "online"
            ? "bg-raised"
            : "bg-panel",
      )}
      data-computer={computer.status}
    >
      <span
        aria-hidden
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-lg",
          emphasis ? "bg-raised text-accent-text" : "bg-panel text-muted-foreground",
        )}
      >
        <LaptopIcon className="size-4.5" />
      </span>
      <span className="min-w-40 flex-1">
        <span className="block text-sm font-semibold wrap-anywhere">{computer.name}</span>
        <span className="flex items-baseline gap-1.5 text-xs text-muted-foreground" role="status">
          <span
            aria-hidden
            className={cn(
              "size-1.5 shrink-0 -translate-y-px rounded-full",
              COMPUTER_STATUS_DOT[computer.status],
            )}
          />
          <span className="min-w-0 text-pretty">
            {working ?? (thisComputer ? `This computer · ${status}` : status)}
          </span>
        </span>
      </span>
      {children}
      {canRetryComputer(computer) && working === null ? (
        <Button
          size="sm"
          variant="outline"
          disabled={disabled || retrying}
          onClick={async () => {
            setRetrying(true);
            await onRetry();
            setRetrying(false);
          }}
          data-retry-computer
        >
          {retrying ? "Checking…" : "Try again"}
        </Button>
      ) : null}
      {onRemove === null ? null : (
        <Button
          size="sm"
          variant="ghost-destructive"
          disabled={working !== null || removal !== null}
          onClick={() => setRemoval({ phase: "confirming", error: null })}
          aria-label={`Remove ${computer.name}`}
          data-remove-computer
        >
          Remove
        </Button>
      )}
      {removal === null ? null : (
        <div
          className="flex basis-full flex-col gap-2 border-t border-border pt-2"
          role="group"
          aria-label={`Remove ${computer.name}?`}
        >
          <p className="text-sm">{removeQuestion}</p>
          {removal.error === null ? null : (
            <p role="alert" className="text-sm text-destructive">
              {removal.error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              size="sm"
              variant="ghost"
              // The question just opened under the button that was pressed: the caret follows it.
              autoFocus
              disabled={removal.phase === "removing"}
              onClick={() => setRemoval(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={removal.phase === "removing"}
              onClick={() => void remove()}
            >
              {removal.phase === "removing" ? "Removing…" : "Remove"}
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}

/** Stands in for the list until the account first says which computers the person has. */
export function ComputersLoading({ framed = true }: { readonly framed?: boolean }) {
  return (
    <div
      className={cn(
        "flex items-center gap-3",
        framed && "rounded-2xl border border-border px-3.5 py-3",
      )}
      role="status"
      aria-label="Looking for your computers"
    >
      <Skeleton className="size-9" />
      <div className="min-w-0 flex-1 space-y-2">
        <Skeleton shape="pill" className="h-4 w-32" />
        <Skeleton shape="pill" className="h-3 w-20" />
      </div>
      <Skeleton className="h-7 w-24" />
    </div>
  );
}

/** The account's list could not be loaded: says so where the list is, with the way to ask again. */
export function ComputersNotLoaded({ onRetry }: { readonly onRetry: () => Promise<unknown> }) {
  const [retrying, setRetrying] = useState(false);
  return (
    <Alert variant="error" role="alert" data-computers-not-loaded>
      <AlertTitle>Could not load your computers</AlertTitle>
      <AlertDescription>
        Check your internet connection. Computers this browser already knows are still listed.
      </AlertDescription>
      <AlertAction>
        <Button
          size="sm"
          variant="outline"
          disabled={retrying}
          onClick={async () => {
            setRetrying(true);
            await onRetry();
            setRetrying(false);
          }}
        >
          {retrying ? "Checking…" : "Try again"}
        </Button>
      </AlertAction>
    </Alert>
  );
}
