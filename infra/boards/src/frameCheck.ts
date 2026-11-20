import {
  isRoomEmbedPersonFrameUrl,
  roomEmbedFrameVerdict,
  type RoomEmbedFrameVerdict,
} from "@t3tools/shared/roomEmbed";

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 4_000;
// Sites answer a request with no browser-like headers with 403 or 406, which says nothing.
const ASK_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "user-agent": "Mozilla/5.0 (compatible; TinkjamFrameCheck/1.0)",
};
/** Headers a bot wall puts on its own page, whose framing rules are not the site's. */
const CHALLENGE_HEADERS = ["cf-mitigated", "x-amzn-waf-action"];

/**
 * Whether the page at `address` lets `pageOrigin` frame it, from its answer's headers alone: the
 * body is never read. Every hop of a redirect has to pass the same rule as the address itself, so
 * no address leads this host to one it would not ask for directly.
 */
export async function frameCheck(input: {
  readonly address: string;
  readonly pageOrigin: string | null;
  readonly ownHosts: ReadonlyArray<string>;
  readonly fetcher?: typeof fetch;
}): Promise<RoomEmbedFrameVerdict> {
  const fetcher = input.fetcher ?? fetch;
  let address = input.address;
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      if (!isRoomEmbedPersonFrameUrl(address, input.ownHosts)) return "unknown";
      const response = await fetcher(address, {
        method: "GET",
        redirect: "manual",
        signal,
        headers: ASK_HEADERS,
      });
      void response.body?.cancel();
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location !== null) {
        if (!URL.canParse(location, address)) return "unknown";
        address = new URL(location, address).href;
        continue;
      }
      // An error or challenge page's headers say nothing sure about the page a browser would get.
      if (response.status !== 200) return "unknown";
      if (CHALLENGE_HEADERS.some((name) => response.headers.has(name))) return "unknown";
      return roomEmbedFrameVerdict(
        {
          frameOptions: response.headers.get("x-frame-options"),
          contentSecurityPolicy: response.headers.get("content-security-policy"),
        },
        input.pageOrigin,
      );
    }
    return "unknown";
  } catch {
    return "unknown";
  }
}
