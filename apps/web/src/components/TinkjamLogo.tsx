import type { HTMLAttributes, ImgHTMLAttributes } from "react";

import { cn } from "~/lib/utils";

/** Tinkjam's mark, drawn from `public/tinkjam-mark.svg`, the one place it is defined. */
export function TinkjamMark(props: Omit<ImgHTMLAttributes<HTMLImageElement>, "src" | "alt">) {
  return <img src="/tinkjam-mark.svg" alt="" draggable={false} {...props} />;
}

/**
 * The lowercase "tinkjam" word, set in Outfit in the text colour. Size it with a text size; it is
 * the logo, so a person's own interface font does not replace it.
 */
export function TinkjamWord({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn(
        "font-brand leading-none font-semibold tracking-brand whitespace-nowrap",
        className,
      )}
      {...props}
    >
      tinkjam
    </span>
  );
}

/** Mark and word together, as the product's name wherever a person sees it. */
export function TinkjamWordmark({
  className,
  markClassName,
  wordClassName,
}: {
  readonly className?: string;
  readonly markClassName?: string;
  readonly wordClassName?: string;
}) {
  return (
    <span role="img" aria-label="Tinkjam" className={className ?? "inline-flex items-center gap-2"}>
      <TinkjamMark aria-hidden className={markClassName ?? "size-6 shrink-0"} />
      <TinkjamWord aria-hidden className={wordClassName ?? "text-xl"} />
    </span>
  );
}
