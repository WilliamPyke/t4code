import { CheckIcon, CopyIcon, DownloadIcon } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { cn } from "~/lib/utils";
import { SYNC_INSTALLS, SYNC_OS_NAMES, SYNC_OSES, type SyncOs } from "~/syncDownloads";

import { splitLinkClassName } from "../brand/SplitScreen";
import { Button } from "../ui/button";

/**
 * Tinkjam Sync for the chosen computer as the one button: its download, or its install command to
 * copy where a download would not open. The other systems are links that switch to them.
 */
export function SyncInstallAction({
  os,
  onChoose,
  size = "pill",
}: {
  readonly os: SyncOs;
  readonly onChoose: (os: SyncOs) => void;
  /** `pill` is the full-page call to action; `default` sits inside a dialog's steps. */
  readonly size?: "pill" | "default";
}) {
  const install = SYNC_INSTALLS[os];
  const { copyToClipboard, isCopied } = useCopyToClipboard({ timeout: 2000, target: "command" });
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-y-3",
        size === "pill" ? "gap-x-4.5" : "gap-x-3.5 text-sm",
      )}
      data-sync-downloads
    >
      {install.method === "file" ? (
        install.files.map((file, index) =>
          index === 0 ? (
            <Button
              key={file.href}
              size={size}
              render={<a href={file.href} download />}
              data-sync-download
            >
              <DownloadIcon aria-hidden />
              Download for {SYNC_OS_NAMES[os]}
            </Button>
          ) : (
            <a key={file.href} href={file.href} download className={splitLinkClassName}>
              {file.kind}
            </a>
          ),
        )
      ) : (
        <Button
          size={size}
          onClick={() => copyToClipboard(install.command, undefined)}
          data-sync-copy-command
        >
          {isCopied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
          {/* Both labels share one cell, so the button keeps its width when it says Copied. */}
          <span className="grid">
            <span className={cn("col-start-1 row-start-1", isCopied && "invisible")}>
              Copy install command
            </span>
            <span className={cn("col-start-1 row-start-1", !isCopied && "invisible")}>Copied</span>
          </span>
        </Button>
      )}
      {SYNC_OSES.filter((other) => other !== os).map((other) => (
        <button
          key={other}
          type="button"
          className={splitLinkClassName}
          onClick={() => onChoose(other)}
        >
          Get it for {SYNC_OS_NAMES[other]}
        </button>
      ))}
    </div>
  );
}

const PASTE_STEP: Readonly<Record<SyncOs, string>> = {
  mac: "Paste it into Terminal and press Return",
  windows: "Paste it into a terminal and press Enter",
  linux: "Paste it into a terminal and press Enter",
};

/** The three steps for the chosen computer, the first marked as where to start. */
export function SyncSteps({ os }: { readonly os: SyncOs }) {
  const install = SYNC_INSTALLS[os];
  const steps = [
    install.method === "file" ? "Install Tinkjam Sync" : PASTE_STEP[os],
    "Open it and press Connect",
    "Approve the computer",
  ];
  return (
    <ol className="flex flex-col border-b border-border">
      {steps.map((step, index) => (
        <li key={step} className="flex gap-3.5 border-t border-border py-4 text-foreground">
          <span
            aria-hidden
            className={cn(
              "inline-flex size-6.5 shrink-0 items-center justify-center rounded-full text-ui-sm font-semibold",
              index === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
            )}
          >
            {index + 1}
          </span>
          <span className="flex min-w-0 flex-col gap-1.5 pt-0.5">
            <span className="font-semibold">{step}</span>
            {index === 0 && install.method === "command" ? (
              <code
                className="font-mono text-ui-sm wrap-anywhere text-muted-foreground select-all"
                data-sync-command
              >
                {install.command}
              </code>
            ) : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * The page is looking for the computer, so nobody reloads it after pressing Connect. The dot is
 * the app's stepped status pulse, and it holds still under reduced motion.
 */
export function WaitingForSync() {
  return (
    <p
      role="status"
      className="flex items-center gap-2.5 text-sm text-muted-foreground"
      data-waiting-for-computer
    >
      <span
        aria-hidden
        className="size-2 shrink-0 rounded-full bg-primary motion-safe:animate-status-pulse"
      />
      Waiting for Tinkjam Sync on this computer
    </p>
  );
}
