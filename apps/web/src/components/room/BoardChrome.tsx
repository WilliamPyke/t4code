import { ArrowDownIcon } from "lucide-react";
import { type ComponentProps, type ReactNode, useState } from "react";

import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

/**
 * The board's shared looks. Chrome is quiet (the theme's card, a hairline, a soft shadow) so the
 * colour on a board comes from its content: paints, people and states. Every colour and radius is
 * a theme token, so a custom theme restyles the board with the rest of the app.
 */

/** A window on the board: an agent box, an artifact, a code or pull request window. */
export const BOARD_WINDOW_CLASS =
  "rounded-2xl border border-board-hairline bg-card text-card-foreground shadow-board";

/** A window's title bar: a leading mark, a semibold title, muted meta on the right. */
export const BOARD_TITLE_BAR_CLASS =
  "flex min-h-11 shrink-0 items-center gap-2 border-b border-board-hairline px-3 py-1.5 text-ui-sm";

/**
 * Chrome on a card that shows only while it is hovered, focused or has a menu open: its action
 * row and resize grips. Faded, not removed, so it keeps its hit area and keyboard reach; touch
 * screens, which cannot hover, always show it.
 */
export const BOARD_HOVER_CHROME_CLASS =
  "transition-opacity [@media(hover:hover)]:opacity-0 group-hover/item:opacity-100 group-focus-within/item:opacity-100 has-[[data-popup-open]]:opacity-100";

/** On a selected card or section: its resize and line grips show, and work, without a hover. */
export const BOARD_SELECTED_CHROME_CLASS =
  "[&_[data-board-grip]]:opacity-100 [&_[data-board-link]]:pointer-events-auto";

/**
 * A small icon button in a card's header; it takes the card's text colour, paint or window. A
 * finger gets a taller target, kept narrow so it never takes a tap meant for its neighbour.
 */
export const BOARD_ICON_BUTTON_CLASS =
  "relative grid size-6 shrink-0 place-items-center rounded-md opacity-60 pointer-coarse:after:absolute pointer-coarse:after:-inset-x-0.5 pointer-coarse:after:-inset-y-1.5 transition-[opacity,background-color] hover:bg-current/10 hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset focus-visible:outline-none";

/** Floating chrome over the canvas: the tool rail, the zoom pill, passing notices. */
export function BoardFloat({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex items-center rounded-xl border border-board-hairline bg-card text-card-foreground shadow-board",
        className,
      )}
      {...props}
    />
  );
}

/**
 * The chrome drawn along one edge of the board, inside `root`: the header at the top; the zoom
 * corner and, while it lies along the bottom of a narrow board, the tool rail at the bottom. Beside
 * the board, upright, the rail covers neither edge.
 */
export function boardChromeAt(root: ParentNode, edge: "top" | "bottom"): Array<HTMLElement> {
  return [
    ...root.querySelectorAll<HTMLElement>(
      `[data-board-chrome="${edge}"], [data-board-chrome="rail"]`,
    ),
  ].filter(
    (chrome) =>
      chrome.dataset.boardChrome !== "rail" ||
      (edge === "bottom" && chrome.offsetWidth > chrome.offsetHeight),
  );
}

/** How far the tool rail, upright beside a wide board, reaches in from `left` (screen pixels). */
export function boardRailReach(root: ParentNode, left: number): number {
  return Math.max(
    0,
    ...[...root.querySelectorAll<HTMLElement>('[data-board-chrome="rail"]')]
      .filter((rail) => rail.offsetHeight > rail.offsetWidth)
      .map((rail) => rail.getBoundingClientRect().right - left),
  );
}

/**
 * A card's body that scrolls on its own and stays at its newest text while it grows, so a
 * streaming reply never stretches the card. `column-reverse` anchors the scroll to the bottom;
 * `mb-auto` keeps short content at the top of a card taller than it.
 */
export function BoardScrollTail({ className, children }: ComponentProps<"div">) {
  const [away, setAway] = useState(false);
  return (
    <div
      data-board-scroll
      className={cn("flex min-h-0 flex-col-reverse overflow-y-auto overscroll-contain", className)}
      // `column-reverse` counts scrollTop down from 0 at the bottom.
      onScroll={(event) => setAway(event.currentTarget.scrollTop < -24)}
    >
      {away ? (
        <div className="sticky bottom-1.5 z-10 flex h-0 shrink-0 items-end justify-center">
          <Button
            size="micro"
            variant="outline"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              const scroller = event.currentTarget.closest("[data-board-scroll]");
              scroller?.scrollTo({ top: 0 });
            }}
          >
            <ArrowDownIcon />
            Latest
          </Button>
        </div>
      ) : null}
      <div className="mb-auto flex flex-col gap-2">{children}</div>
    </div>
  );
}

export type BoardChipTone =
  | "primary"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "neutral"
  | "live";

const CHIP_TONES: Readonly<Record<BoardChipTone, string>> = {
  // Accent as text: the theme's primary, lifted toward the text colour in dark for contrast.
  primary:
    "bg-primary/12 text-primary dark:bg-primary/22 dark:text-[color-mix(in_srgb,var(--color-primary)_60%,var(--color-foreground))]",
  success: "bg-success/12 text-success-foreground dark:bg-success/18",
  warning: "bg-warning/16 text-warning-foreground dark:bg-warning/20",
  error: "bg-error/12 text-error-foreground dark:bg-error/18",
  info: "bg-info/12 text-info-foreground dark:bg-info/18",
  neutral: "bg-foreground/6 text-muted-foreground",
  // A page that follows its agent: the brand's forest fill, the same in every theme.
  live: "bg-brand-forest text-white",
};

/**
 * A small state label: a tinted pill with text in the deeper tone. The words carry the state, so
 * it never rests on colour alone. `dashed` is the quiet outline for something already done.
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
        "inline-flex max-w-full shrink-0 items-center gap-1 truncate rounded-full px-2 py-0.5 text-2xs leading-4 font-semibold",
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

/**
 * Who put a card on the board: their initial in their colour, named on hover, or beside it in a
 * card's footer (`named`).
 */
export function AddedBy({
  name,
  color,
  named = false,
}: {
  readonly name: string;
  readonly color: string;
  readonly named?: boolean;
}) {
  const dot = (
    <PersonDot color={color} className="size-4 text-3xs leading-none font-semibold">
      {name.trim().charAt(0).toUpperCase()}
    </PersonDot>
  );
  if (named) {
    return (
      <span className="flex min-w-0 items-center gap-1.5">
        {dot}
        <span className="truncate">Added by {name}</span>
      </span>
    );
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span aria-label={`Added by ${name}`} className="flex shrink-0" />}>
        {dot}
      </TooltipTrigger>
      <TooltipPopup side="top">Added by {name}</TooltipPopup>
    </Tooltip>
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
