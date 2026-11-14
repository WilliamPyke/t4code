import { type GuestShareEndpoint, guestShareRequest } from "@t3tools/client-runtime/rpc";
import { GUEST_RENDER_ROUTE } from "@t3tools/contracts";
import {
  type HtmlRenderReference,
  HTML_RENDER_COLUMN_WIDTH,
  htmlRenderFrameHeight,
  htmlRenderResult,
  htmlRenderThemeFragment,
  htmlRenderThemeMessage,
  readHtmlRenderContentHeight,
  readHtmlRenderLinkRequest,
} from "@t3tools/shared/htmlRender";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { useHtmlRenderTheme } from "~/hooks/useHtmlRenderTheme";
import { observeResize } from "~/lib/observeResize";

/**
 * A visual the agent published, as the guest sees it. The page is fetched with the guest's
 * token and shown from a blob URL, which belongs to this app's origin: the frame's sandbox (no
 * `allow-same-origin`) is what gives the page an opaque origin, so it must stay. The page can
 * size itself and ask to open a web link; it cannot reach the guest's token or this app.
 */
export function GuestHtmlRender({
  itemId,
  reference,
  endpoint,
}: {
  readonly itemId: string;
  readonly reference: HtmlRenderReference;
  readonly endpoint: GuestShareEndpoint;
}) {
  const theme = useHtmlRenderTheme();
  const boxRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const [width, setWidth] = useState(HTML_RENDER_COLUMN_WIDTH);
  const [contentHeight, setContentHeight] = useState<number>();
  // The theme rides in the fragment for the first paint; later changes are posted.
  const [fragment] = useState(() => htmlRenderThemeFragment(theme));
  const [page, setPage] = useState<string | null>(null);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- fetches the render with the guest's token and revokes its blob URL on cleanup
  useEffect(() => {
    let url: string | null = null;
    let live = true;
    void guestShareRequest(endpoint, GUEST_RENDER_ROUTE, { params: { item: itemId } })
      .then((response) => (response.ok ? response.text() : null))
      .then((html) => {
        if (!live || html === null) return;
        url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
        setPage(url);
      })
      .catch(() => {});
    return () => {
      live = false;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [endpoint, itemId]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- measures the frame box and follows its width with a ResizeObserver before paint
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    setWidth(box.clientWidth);
    return observeResize(box, ([entry]) => {
      if (entry) setWidth(entry.contentRect.width);
    });
  }, []);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- posts theme changes to the iframe's window
  useEffect(() => {
    frameRef.current?.contentWindow?.postMessage(htmlRenderThemeMessage(theme), "*");
  }, [theme]);
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- window message listener for the iframe's height reports and link requests
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      const height = readHtmlRenderContentHeight(event.data);
      if (height !== undefined) {
        setContentHeight(height);
        return;
      }
      // Only while the reader is using this frame, so a page cannot open links on its own.
      const link = readHtmlRenderLinkRequest(event.data);
      if (
        link === undefined ||
        document.activeElement !== frame ||
        navigator.userActivation?.isActive === false
      ) {
        return;
      }
      window.open(link.url, "_blank", "noopener,noreferrer");
      frame.contentWindow?.postMessage(htmlRenderResult(link.id), "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  return (
    <div
      ref={boxRef}
      style={{
        height: htmlRenderFrameHeight(reference, width, contentHeight),
      }}
    >
      <iframe
        ref={frameRef}
        src={page === null ? "about:blank" : `${page}${fragment}`}
        title={reference.title}
        sandbox="allow-scripts allow-forms allow-popups allow-downloads"
        className="block size-full rounded-lg border border-border"
      />
    </div>
  );
}
