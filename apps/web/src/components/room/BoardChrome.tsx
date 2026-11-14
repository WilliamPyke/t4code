import type { ComponentProps, ReactNode } from "react";

import { cn } from "~/lib/utils";

/**
 * The board's shared looks. Chrome is quiet (the theme's card, a hairline, a soft shadow) so the
 * colour on a board comes from its content: paints, people and states.
 */

/** A window on the board: an agent box, an artifact, a code or pull request window. */
export const BOARD_WINDOW_CLASS =
  "rounded-board border border-board-hairline bg-card text-card-foreground shadow-board";

/** A window's title bar: a leading mark, a semibold title, muted meta on the right. */
export const BOARD_TITLE_BAR_CLASS =
  "flex h-9 shrink-0 items-center gap-2 border-b border-board-hairline px-3 text-xs";

/**
 * Chrome on a card that shows only while it is hovered, focused or has a menu open: its action
 * row and resize grips. Faded, not removed, so it keeps its hit area and keyboard reach; touch
 * screens, which cannot hover, always show it.
 */
export const BOARD_HOVER_CHROME_CLASS =
  "transition-opacity [@media(hover:hover)]:opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100 has-[[data-popup-open]]:opacity-100";

/** On a selected card or section: its resize grips show without a hover. */
export const BOARD_SELECTED_CHROME_CLASS = "[&_[data-board-grip]]:opacity-100";

/** A small icon button in a card's header; it takes the card's text colour, paint or window. */
export const BOARD_ICON_BUTTON_CLASS =
  "grid size-6 shrink-0 place-items-center rounded-md opacity-60 transition-[opacity,background-color] hover:bg-current/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none";

/** Floating chrome over the canvas: the header pills, the toolbar, the zoom pill. */
export function BoardFloat({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center rounded-board border border-board-hairline bg-card text-card-foreground shadow-board",
        className,
      )}
      {...props}
    />
  );
}

export type BoardChipTone = "primary" | "success" | "warning" | "error" | "info" | "neutral";

const CHIP_TONES: Readonly<Record<BoardChipTone, string>> = {
  primary:
    "bg-primary/12 text-primary dark:bg-primary/20 dark:text-[color-mix(in_srgb,var(--color-primary)_60%,var(--color-foreground))]",
  success: "bg-success/12 text-success-foreground dark:bg-success/18",
  warning: "bg-warning/14 text-warning-foreground dark:bg-warning/18",
  error: "bg-error/12 text-error-foreground dark:bg-error/18",
  info: "bg-info/12 text-info-foreground dark:bg-info/18",
  neutral: "bg-foreground/6 text-muted-foreground",
};

/**
 * A small state label: a tinted rectangle with text in the deeper tone. The words carry the state,
 * so it never rests on colour alone. `dashed` is the quiet outline for something already done.
 */
export function BoardChip({
  tone = "neutral",
  dashed = false,
  className,
  children,
  ...props
}: Omit<ComponentProps<"span">, "children"> & {
  readonly tone?: BoardChipTone;
  readonly dashed?: boolean;
  readonly children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full shrink-0 items-center gap-1 truncate rounded-md px-1.5 py-0.5 text-2xs leading-4 font-medium",
        dashed
          ? "border border-dashed border-foreground/20 text-muted-foreground"
          : CHIP_TONES[tone],
        className,
      )}
      {...props}
    >
      {children}
    </span>
  );
}

/** A round mark in someone's person colour: their dot on an agent's title bar, or an avatar. */
export function PersonDot({
  color,
  className,
  children,
  ...props
}: ComponentProps<"span"> & { readonly color: string }) {
  return (
    <span
      aria-hidden
      className={cn("inline-grid shrink-0 place-items-center rounded-full text-white", className)}
      style={{ backgroundColor: color }}
      {...props}
    >
      {children}
    </span>
  );
}

/** The board's canvas as a still backdrop, for pages around a board: the join page, notices. */
export function BoardBackdrop({ className, style, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-board-canvas", className)}
      style={{
        backgroundImage: "radial-gradient(var(--color-board-dot) 1px, transparent 1px)",
        backgroundSize: "24px 24px",
        ...style,
      }}
      {...props}
    />
  );
}
