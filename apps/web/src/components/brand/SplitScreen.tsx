import type { ReactNode } from "react";

import { cn } from "~/lib/utils";

import { TinkjamWordmark } from "../TinkjamLogo";

/**
 * A full page in two halves: the task on the left, in the person's theme, and the cobalt art on
 * the right. Below 900px the halves stack, the task first.
 */
export function SplitScreen({
  art,
  corner,
  footer,
  children,
}: {
  readonly art: ReactNode;
  /** Top right of the task half, such as a way to close it. */
  readonly corner?: ReactNode;
  readonly footer?: ReactNode;
  readonly children: ReactNode;
}) {
  return (
    <div className="grid min-h-dvh grid-cols-1 bg-background text-foreground min-[900px]:h-dvh min-[900px]:grid-cols-2">
      <main className="flex min-w-0 flex-col px-4 pt-6 pb-6 sm:px-10 sm:pt-8 min-[900px]:min-h-0 min-[900px]:overflow-y-auto">
        <div className="flex items-center justify-between gap-3">
          <TinkjamWordmark
            className="inline-flex items-center gap-2.5"
            markClassName="size-8 shrink-0"
            wordClassName="text-wordmark"
          />
          {corner}
        </div>
        <div className="flex flex-1 items-center justify-center py-10 min-[900px]:py-12">
          <div className="w-full max-w-105">{children}</div>
        </div>
        {footer ? (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-ui-sm text-muted-foreground">
            {footer}
          </div>
        ) : null}
      </main>
      {art}
    </div>
  );
}

// Read once: a page open over New Year keeps the year it opened with.
const YEAR = new Date().getFullYear();

export const Copyright = () => <span>© {YEAR} Tinkjam</span>;

/** The page's heading, in the heading face at the designs' size. */
export function SplitHeading({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <h1
      className={cn(
        "font-heading text-4xl font-semibold tracking-brand text-balance text-foreground sm:text-display",
        className,
      )}
    >
      {children}
    </h1>
  );
}

/** A link styled as the designs' underlined accent text. */
export const splitLinkClassName =
  "rounded-sm font-medium text-update-foreground underline underline-offset-3 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset";
