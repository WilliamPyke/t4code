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
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";

import { observeResize } from "~/lib/observeResize";
import { useStableCallback } from "~/hooks/useStableCallback";
import { cn } from "~/lib/utils";

import { Button } from "../ui/button";
import type { BoardSize } from "./roomBoard.logic";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

const SOURCE_ICONS: Record<RoomEmbedSource, LucideIcon> = {
  figma: FigmaIcon,
  "google-docs": FileTextIcon,
  "google-sheets": SheetIcon,
  "google-slides": PresentationIcon,
  "claude-artifact": SparklesIcon,
  youtube: YoutubeIcon,
  loom: VideoIcon,
  vimeo: VideoIcon,
  linear: CircleDotIcon,
  github: GithubIcon,
  superhuman: FileTextIcon,
  coda: FileTextIcon,
  notion: NotebookTextIcon,
  jira: TicketIcon,
  asana: ListChecksIcon,
  miro: ShapesIcon,
  web: GlobeIcon,
};

/** The mark of the source a link card's address comes from. */
export function BoardEmbedIcon({ source }: { readonly source: RoomEmbedSource }) {
  const Icon = SOURCE_ICONS[source];
  return <Icon aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />;
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
 * A link card's body: its address and Open, and for a source that allows it, the live page.
 * The page stays inert under a cover, so the board pans and drags over it, until a click on the
 * cover lets the viewer use it; a click anywhere else or Escape gives the board back.
 */
export function RoomEmbedBody({
  embed,
  url,
  live,
  active,
  onRelease,
}: {
  readonly embed: RoomEmbed;
  readonly url: string;
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
      <div className="flex shrink-0 items-center gap-2 px-3 pb-2">
        <p className="min-w-0 flex-1 truncate text-2xs text-muted-foreground">{embed.address}</p>
        <Button
          size="micro"
          variant="outline"
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
