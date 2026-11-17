import {
  isRoomEmbedFrameUrl,
  type RoomEmbed,
  type RoomEmbedSource,
} from "@t3tools/shared/roomEmbed";
import {
  CircleDotIcon,
  ExternalLinkIcon,
  FigmaIcon,
  FileTextIcon,
  GithubIcon,
  GlobeIcon,
  type LucideIcon,
  ListChecksIcon,
  NotebookTextIcon,
  PresentationIcon,
  ShapesIcon,
  SheetIcon,
  SparklesIcon,
  TicketIcon,
  VideoIcon,
  YoutubeIcon,
} from "lucide-react";
import {
  type PointerEvent,
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";

import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import type { BoardSize } from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/**
 * Each source's mark: a glyph on a tile in the source's own colour, bundled here so a board never
 * asks another site for a favicon. Brand colours are the sources' own, not the board's tokens.
 */
const SOURCE_ICONS: Record<
  RoomEmbedSource,
  { readonly icon: LucideIcon; readonly tile: string; readonly ink?: string }
> = {
  figma: { icon: FigmaIcon, tile: "#1E1E1E" },
  "google-docs": { icon: FileTextIcon, tile: "#4285F4" },
  "google-sheets": { icon: SheetIcon, tile: "#0F9D58" },
  "google-slides": { icon: PresentationIcon, tile: "#F4B400", ink: "#1D1A22" },
  "claude-artifact": { icon: SparklesIcon, tile: "#D97757" },
  youtube: { icon: YoutubeIcon, tile: "#FF0033" },
  loom: { icon: VideoIcon, tile: "#625DF5" },
  vimeo: { icon: VideoIcon, tile: "#17D5FF", ink: "#1D1A22" },
  linear: { icon: CircleDotIcon, tile: "#5E6AD2" },
  github: { icon: GithubIcon, tile: "#24292F" },
  superhuman: { icon: FileTextIcon, tile: "#3B2A63" },
  coda: { icon: FileTextIcon, tile: "#EE5A29" },
  notion: { icon: NotebookTextIcon, tile: "#191919" },
  jira: { icon: TicketIcon, tile: "#0C66E4" },
  asana: { icon: ListChecksIcon, tile: "#F06A6A" },
  miro: { icon: ShapesIcon, tile: "#FFD02F", ink: "#1D1A22" },
  web: { icon: GlobeIcon, tile: "" },
};

/** The mark of the source a link card's address comes from; any other site's is a plain globe. */
export function BoardEmbedIcon({ source }: { readonly source: RoomEmbedSource }) {
  const { icon: Icon, tile, ink = "#FFFFFF" } = SOURCE_ICONS[source];
  if (tile === "") return <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />;
  return (
    <span
      aria-hidden
      className="grid size-4 shrink-0 place-items-center rounded-sm"
      style={{ backgroundColor: tile, color: ink }}
    >
      <Icon className="size-2.5" strokeWidth={2.5} />
    </span>
  );
}

/**
 * What each framed source needs. Every frame host is another site, so scripts with its own origin
 * never reach the board's; popups let its own "open" links work. YouTube refuses to play without
 * a referrer, so it alone gets the board's origin (never the path).
 */
const FRAME_SANDBOX = "allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox";
const FRAME_ALLOW = "fullscreen; clipboard-write; picture-in-picture; encrypted-media";

/** The board surface's size, which the part of the board in view is worked out from. */
export function useBoardSurfaceSize(surfaceRef: RefObject<HTMLElement | null>) {
  const [size, setSize] = useState<BoardSize | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- follows the board surface's size, which says which embeds are in view
  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return;
    const measure = () => setSize({ width: surface.clientWidth, height: surface.clientHeight });
    measure();
    return observeResize(surface, measure);
  }, [surfaceRef]);
  return size;
}

/**
 * A link card's body: who added it and Open, and for a source that allows it, the live page.
 * The page stays inert under a cover, so the board pans and drags over it, until a click on the
 * cover lets the viewer use it; a click anywhere else or Escape gives the board back.
 */
export function RoomEmbedBody({
  embed,
  url,
  live,
  active,
  onRelease,
  addedBy,
  actions,
}: {
  readonly embed: RoomEmbed;
  readonly url: string;
  /** More buttons beside Open, such as bringing it in with an agent. */
  readonly actions?: ReactNode;
  /** Who put it on the board, as the card's footer shows them. */
  readonly addedBy: ReactNode;
  /** Whether its page loads now; the board loads only a few, in view. */
  readonly live: boolean;
  /** Whether the viewer is using its page now. */
  readonly active: boolean;
  readonly onRelease: () => void;
}) {
  const frame =
    embed.embedUrl !== undefined && isRoomEmbedFrameUrl(embed.embedUrl) ? embed.embedUrl : null;
  const bodyRef = useRef<HTMLDivElement>(null);
  const release = useStableCallback(onRelease);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a press outside the page or Escape, anywhere in the window, gives the board back
  useEffect(() => {
    if (!active) return;
    const pressed = (event: globalThis.PointerEvent) => {
      if (!(event.target instanceof Node) || bodyRef.current?.contains(event.target) !== true) {
        release();
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") release();
    };
    document.addEventListener("pointerdown", pressed, true);
    document.addEventListener("keydown", key, true);
    return () => {
      document.removeEventListener("pointerdown", pressed, true);
      document.removeEventListener("keydown", key, true);
    };
  }, [active, release]);
  return (
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 text-2xs text-muted-foreground">
          {addedBy}
        </div>
        {actions}
        <Button
          size="micro"
          variant="outline"
          title={embed.address}
          onPointerDown={stopPointer}
          render={<a href={url} target="_blank" rel="noreferrer noopener" />}
        >
          <ExternalLinkIcon />
          Open
        </Button>
      </div>
      {frame === null ? null : (
        <div className="relative min-h-40 flex-1 overflow-hidden border-t border-board-hairline bg-muted/40">
          {live ? (
            <iframe
              src={frame}
              title={`${embed.name}: ${embed.title}`}
              sandbox={FRAME_SANDBOX}
              allow={FRAME_ALLOW}
              referrerPolicy={embed.source === "youtube" ? "strict-origin" : "no-referrer"}
              loading="lazy"
              className={cn(
                "absolute inset-0 size-full border-0",
                !active && "pointer-events-none",
              )}
              tabIndex={active ? 0 : -1}
            />
          ) : null}
          {active ? null : (
            // A press here is the card's: it drags the card, and a click without a drag opens
            // the page for use, which the card hears through `data-board-embed-cover`.
            <div
              data-board-embed-cover
              className="group/embed absolute inset-0 flex cursor-pointer items-end justify-center p-2"
            >
              <span
                className={cn(
                  "rounded-md border border-board-hairline bg-card px-2 py-1 text-2xs text-muted-foreground shadow-board",
                  live && "opacity-0 group-hover/embed:opacity-100",
                )}
              >
                {live ? "Click to use" : `Click to show ${embed.name}`}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
