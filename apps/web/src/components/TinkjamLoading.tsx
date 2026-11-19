import { TinkjamMark } from "./TinkjamLogo";

/**
 * A wait before a page can show. The mark sits at the centre of the window, the size and place
 * the boot splash in `index.html` draws it, so the two read as one still screen.
 */
export function TinkjamLoading({ label }: { readonly label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className="pointer-events-none fixed inset-0 grid place-items-center"
      data-tinkjam-loading
    >
      <TinkjamMark className="size-14" />
    </div>
  );
}
