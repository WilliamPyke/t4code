import { cn } from "~/lib/utils";

import { TinkjamMark } from "./TinkjamLogo";

/**
 * A wait before a page can show. The mark sits at the centre of the window, the size and place
 * the boot splash in `index.html` draws it, so the two read as one still screen. `cover` hides
 * whatever is already drawn (the sidebar, a corner menu), so the page arrives in one step.
 */
export function TinkjamLoading({
  label,
  cover = false,
}: {
  readonly label: string;
  readonly cover?: boolean;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(
        "fixed inset-0 grid place-items-center",
        cover ? "z-30 bg-background" : "pointer-events-none",
      )}
      data-tinkjam-loading
    >
      <TinkjamMark className="size-14" />
    </div>
  );
}
