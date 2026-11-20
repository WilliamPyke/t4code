import {
  isRoomEmbedFrameUrl,
  type RoomEmbed,
  type RoomEmbedSource,
} from "@t3tools/shared/roomEmbed";
import {
  AppWindowIcon,
  CircleDotIcon,
  ExternalLinkIcon,
  EyeOffIcon,
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
import { toastManager } from "../ui/toast";
import { boardCanFramePage } from "./boardEmbed.logic";
import { boardFrameVerdict, boardOwnHosts, useBoardFrameCheck } from "./boardFrameCheck";
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
      className="grid size-5.5 shrink-0 place-items-center rounded-md"
      style={{ backgroundColor: tile, color: ink }}
    >
      <Icon className="size-3.5" strokeWidth={2.25} />
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
// A page someone chose to show is any site: its forms work, and it never navigates the board.
const PAGE_SANDBOX = `${FRAME_SANDBOX} allow-forms`;
const PAGE_ALLOW = "fullscreen";
const REFUSED = "This site does not allow being shown inside other pages.";

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
 * While a card's page is in use (`active`), a press outside the element this returns the ref of,
 * or Escape, anywhere in the window, gives the board back.
 */
export function useBoardPageRelease(active: boolean, onRelease: () => void) {
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
  return bodyRef;
}

/**
 * What lies over a card's page or scrolling content until the viewer clicks it. A press here is
 * the card's: it drags the card, the wheel over it moves the board, and a click without a drag
 * opens what is under it for use, which the card hears through `data-board-embed-cover`.
 */
export function BoardPageCover({
  label,
  quiet,
}: {
  readonly label: string;
  /** Whether the label shows only under the pointer. */
  readonly quiet: boolean;
}) {
  return (
    <div
      data-board-embed-cover
      className="group/embed absolute inset-0 flex cursor-pointer items-end justify-center p-2"
    >
      <span
        className={cn(
          "rounded-md border border-board-hairline bg-card px-2 py-1 text-2xs text-muted-foreground shadow-board",
          quiet && "opacity-0 group-hover/embed:opacity-100",
        )}
      >
        {label}
      </span>
    </div>
  );
}

/**
 * A link card's body: who added it and Open, and for a source that allows it, the live page.
 * The page stays inert under a cover, so the board pans and drags over it, until a click on the
 * cover lets the viewer use it; a click anywhere else or Escape gives the board back. Any other
 * site's page shows once someone chose to (`framed`), and loads only for a viewer who asked.
 */
export function RoomEmbedBody({
  embed,
  url,
  live,
  active,
  zoomedOut = false,
  onRelease,
  addedBy,
  actions,
  framed = false,
  onFrame,
}: {
  readonly embed: RoomEmbed;
  readonly url: string;
  /** Whether someone chose to show this address's own page in the card. */
  readonly framed?: boolean;
  /** Shows or hides the page for everyone. Absent where the viewer may not change the card. */
  readonly onFrame?: ((framed: boolean) => void) | undefined;
  /** More buttons beside Open, such as bringing it in with an agent. */
  readonly actions?: ReactNode;
  /** Who put it on the board, as the card's footer shows them. */
  readonly addedBy: ReactNode;
  /** Whether its page loads now; the board loads only a few, in view. */
  readonly live: boolean;
  /** Whether the viewer is using its page now. */
  readonly active: boolean;
  /** The board is too far out for a framed page to load; a click zooms in to the card. */
  readonly zoomedOut?: boolean;
  readonly onRelease: () => void;
}) {
  const sourceFrame =
    embed.embedUrl !== undefined && isRoomEmbedFrameUrl(embed.embedUrl) ? embed.embedUrl : null;
  const canFramePage = boardCanFramePage(url, boardOwnHosts());
  const page = canFramePage && framed ? url : null;
  const frame = sourceFrame ?? page;
  // Null while the board host is asked: the page waits, so a site that refuses never flashes.
  const check = useBoardFrameCheck(page);
  // The check reads the site as a signed-out visitor from a data centre, and is kept for an hour:
  // the viewer's own browser can get another answer, so they may try the page all the same.
  const [tried, setTried] = useState<string | null>(null);
  const refused = page !== null && check === "refused" && tried !== url;
  const loads = live && (page === null || (check !== null && !refused));
  // A click on "Show page here" asks first, so a card whose site refuses stays a link card.
  const [asking, setAsking] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const stays = !framed && blocked === url;
  const frameIt = useStableCallback((next: boolean) => onFrame?.(next));
  const showPage = () => {
    setAsking(true);
    void boardFrameVerdict(url).then((verdict) => {
      setAsking(false);
      if (verdict === "refused") {
        setBlocked(url);
        toastManager.add({
          type: "info",
          title: "This page can't be shown here",
          description: REFUSED,
        });
      } else frameIt(true);
    });
  };
  const tryAnyway = () => {
    setTried(url);
    if (!framed) frameIt(true);
  };
  const bodyRef = useBoardPageRelease(active, onRelease);
  return (
    <div ref={bodyRef} className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-2 px-3 pb-2">
        {/* Its own width, up to a whole row: the buttons wrap under it rather than squeeze it. */}
        <div className="flex min-w-0 max-w-full shrink-0 items-center gap-1.5 text-2xs text-muted-foreground">
          {addedBy}
        </div>
        {actions}
        {onFrame === undefined || !canFramePage ? null : (
          <Button
            size="micro"
            variant="outline"
            onPointerDown={stopPointer}
            disabled={asking}
            onClick={() => (framed ? onFrame(false) : stays ? tryAnyway() : showPage())}
          >
            {framed ? <EyeOffIcon /> : <AppWindowIcon />}
            {framed ? "Hide page" : asking ? "Checking" : stays ? "Try anyway" : "Show page here"}
          </Button>
        )}
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
      {frame === null ? null : refused ? (
        <div className="flex min-h-40 flex-1 flex-col items-center justify-center gap-2 border-t border-board-hairline bg-muted/40 p-4 text-center text-xs text-muted-foreground">
          <p>{REFUSED}</p>
          <div className="flex flex-wrap justify-center gap-2">
            {onFrame === undefined ? null : (
              <Button
                size="micro"
                variant="outline"
                onPointerDown={stopPointer}
                onClick={() => onFrame(false)}
              >
                Back to a link card
              </Button>
            )}
            <Button size="micro" variant="outline" onPointerDown={stopPointer} onClick={tryAnyway}>
              Try anyway
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative min-h-40 flex-1 overflow-hidden border-t border-board-hairline bg-muted/40">
          {loads ? (
            <iframe
              src={frame}
              title={`${embed.name}: ${embed.title}`}
              sandbox={page === null ? FRAME_SANDBOX : PAGE_SANDBOX}
              allow={page === null ? FRAME_ALLOW : PAGE_ALLOW}
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
            <BoardPageCover
              label={
                loads
                  ? "Click to interact"
                  : zoomedOut
                    ? `Zoom in to show ${embed.name}`
                    : `Click to show ${embed.name}`
              }
              quiet={loads}
            />
          )}
        </div>
      )}
    </div>
  );
}
