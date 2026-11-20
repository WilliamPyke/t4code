import { OWN_DOMAINS } from "./ownDomains.ts";

/** Where a link card's address comes from: a source the board knows, or any other site. */
export type RoomEmbedSource =
  | "figma"
  | "google-docs"
  | "google-sheets"
  | "google-slides"
  | "claude-artifact"
  | "youtube"
  | "loom"
  | "vimeo"
  | "linear"
  | "github"
  | "superhuman"
  | "coda"
  | "notion"
  | "jira"
  | "asana"
  | "miro"
  | "web";

/** A link card's address as the board shows it and a prompt names it. */
export interface RoomEmbed {
  readonly source: RoomEmbedSource;
  /** The source's name, such as "Figma" or "Google Sheets"; any other site's host. */
  readonly name: string;
  /** A title read from the address, for a card nobody named. */
  readonly title: string;
  /** What it is, as a card's subtitle says: "GitHub issue", "Figma design", or a site's host. */
  readonly kind: string;
  /** The address as people read it: host and path, without the scheme. */
  readonly address: string;
  /**
   * The page the source documents for framing the same document, on one of
   * `ROOM_EMBED_FRAME_HOSTS`. Absent for every source that refuses frames, and for any address
   * that is not plain https on the source's own host.
   */
  readonly embedUrl?: string;
}

/** The only hosts a board ever puts in a frame. */
const ROOM_EMBED_FRAME_HOSTS: ReadonlyArray<string> = [
  "embed.figma.com",
  "docs.google.com",
  "www.youtube-nocookie.com",
  "www.loom.com",
  "player.vimeo.com",
];

/** Whether a board may frame this address: https on one of `ROOM_EMBED_FRAME_HOSTS`. */
export function isRoomEmbedFrameUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      url.port === "" &&
      ROOM_EMBED_FRAME_HOSTS.includes(url.hostname)
    );
  } catch {
    return false;
  }
}

const hostOf = (hostname: string) => hostname.toLowerCase().replace(/\.$/, "");
// Without a public suffix list: broader than a registrable site, never narrower.
const siteOf = (host: string) => host.split(".").slice(-2).join(".");
const PRIVATE_HOST = /(?:^|\.)(?:localhost|local|internal)$/;
const IPV4_HOST = /^\d+(?:\.\d+){3}$/;

/**
 * Whether a person may choose to show this address inside a link card: plain https on a public
 * host name, and not on the same site as any of `ownHosts` (the app's and the board host's), since
 * a page of ours framed with its own origin could reach the signed-in session.
 */
export function isRoomEmbedPersonFrameUrl(
  value: string,
  ownHosts: ReadonlyArray<string> = [],
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return false;
  }
  const host = hostOf(url.hostname);
  if (!host.includes(".") || host.startsWith("[") || IPV4_HOST.test(host)) return false;
  if (PRIVATE_HOST.test(host)) return false;
  // Both of our domains are ours whatever the caller names: a page on either could reach a session.
  return ![...OWN_DOMAINS, ...ownHosts].some((own) => siteOf(hostOf(own)) === siteOf(host));
}

/** Whether a site lets other pages frame it: what `roomEmbedFrameVerdict` reads from its headers. */
export type RoomEmbedFrameVerdict = "ok" | "refused" | "unknown";

const ancestorAllows = (source: string, page: URL | null) => {
  // A source of `http` also takes the same thing over https.
  if (source === "*" || source === "https:" || source === "http:") return true;
  if (page === null) return false;
  const match = /^(?:(https?):\/\/)?(?:(\*)|(\*\.)?([^/:*]+))(?::(\d+|\*))?(?:\/.*)?$/.exec(source);
  if (match === null) return false;
  const [, scheme, any, wild, host, port] = match;
  if (scheme !== undefined && `${scheme}:` !== page.protocol && scheme !== "http") return false;
  const pagePort = page.port === "" ? (page.protocol === "https:" ? "443" : "80") : page.port;
  if (port !== undefined && port !== "*" && port !== pagePort) return false;
  if (port === undefined && page.port !== "") return false;
  if (any !== undefined) return true;
  const pageHost = hostOf(page.hostname);
  return wild === undefined ? pageHost === host : pageHost.endsWith(`.${host}`);
};

/**
 * What a page's answer headers say about being framed by `pageOrigin`: `frame-ancestors` in any
 * of its policies decides, and only without one does `X-Frame-Options` (`DENY`, `SAMEORIGIN`).
 */
export function roomEmbedFrameVerdict(
  headers: { readonly frameOptions: string | null; readonly contentSecurityPolicy: string | null },
  pageOrigin: string | null,
): Exclude<RoomEmbedFrameVerdict, "unknown"> {
  const page = pageOrigin !== null && URL.canParse(pageOrigin) ? new URL(pageOrigin) : null;
  // Each policy's first `frame-ancestors` counts; a browser ignores a repeat in the same policy.
  const ancestors = (headers.contentSecurityPolicy ?? "").split(",").flatMap((policy) => {
    const first = policy
      .split(";")
      .map((directive) => directive.trim().toLowerCase().split(/\s+/))
      .find(([name]) => name === "frame-ancestors");
    return first === undefined ? [] : [first.slice(1)];
  });
  if (ancestors.length > 0) {
    return ancestors.every((sources) => sources.some((source) => ancestorAllows(source, page)))
      ? "ok"
      : "refused";
  }
  const options = (headers.frameOptions ?? "").toLowerCase().split(",");
  return options.some((option) => ["deny", "sameorigin"].includes(option.trim()))
    ? "refused"
    : "ok";
}

const ID = /^[A-Za-z0-9_-]+$/;
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const HEX_ID = /^[0-9a-f]+$/;

const decodeSegment = (segment: string) => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** "checkout-flow_v2" as "Checkout flow v2": a slug all in lower case starts with a capital. */
const slugTitle = (slug: string | undefined) => {
  const words = (slug ?? "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return words === words.toLowerCase() ? words.charAt(0).toUpperCase() + words.slice(1) : words;
};

/** A path segment that is an id, not a name: digits, a long hex run, or a UUID. */
const ID_SEGMENT =
  /^(?:\d+|[0-9a-f]{12,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const PAGE_FILE = /\.(?:html?|php|aspx?|md)$/i;

/** Any other site's page as its address names it: its last segment that is a name, else none. */
function webTitle(parts: ReadonlyArray<string>): string {
  for (const part of [...parts].reverse()) {
    const name = part.replace(PAGE_FILE, "");
    if (name === "" || name === "index" || ID_SEGMENT.test(name)) continue;
    return slugTitle(name);
  }
  return "";
}

const FIGMA_KINDS: Readonly<Record<string, { readonly type: string; readonly title: string }>> = {
  file: { type: "design", title: "Figma design" },
  design: { type: "design", title: "Figma design" },
  proto: { type: "proto", title: "Figma prototype" },
  board: { type: "board", title: "FigJam board" },
  slides: { type: "slides", title: "Figma Slides" },
  deck: { type: "deck", title: "Figma deck" },
};

const GOOGLE_KINDS: Readonly<
  Record<
    string,
    {
      readonly source: RoomEmbedSource;
      readonly name: string;
      readonly title: string;
      readonly published: string;
    }
  >
> = {
  document: {
    source: "google-docs",
    name: "Google Docs",
    title: "Google Doc",
    published: "pub?embedded=true",
  },
  spreadsheets: {
    source: "google-sheets",
    name: "Google Sheets",
    title: "Google Sheet",
    published: "pubhtml?widget=true&headers=false",
  },
  presentation: {
    source: "google-slides",
    name: "Google Slides",
    title: "Google Slides presentation",
    published: "embed",
  },
};

const GITHUB_KINDS: Readonly<Record<string, string>> = {
  pull: "GitHub pull request",
  issues: "GitHub issue",
  discussions: "GitHub discussion",
};

type Known = Omit<RoomEmbed, "address">;

function figma(raw: ReadonlyArray<string>, parts: ReadonlyArray<string>, url: URL): Known | null {
  const kind = FIGMA_KINDS[raw[0] ?? ""];
  // A branch's address names its own file after the main one's.
  const branch = raw[2] === "branch";
  const key = branch ? raw[3] : raw[1];
  if (kind === undefined || key === undefined || !ID.test(key)) return null;
  const node = url.searchParams.get("node-id");
  const at = node !== null && /^[0-9A-Za-z:-]{1,64}$/.test(node) ? `&node-id=${node}` : "";
  return {
    source: "figma",
    name: kind.type === "board" ? "FigJam" : "Figma",
    kind: kind.title,
    title: slugTitle(parts[branch ? 4 : 2]) || kind.title,
    embedUrl: `https://embed.figma.com/${kind.type}/${key}?embed-host=tinkjam${at}`,
  };
}

function google(raw: ReadonlyArray<string>): Known | null {
  const kind = GOOGLE_KINDS[raw[0] ?? ""];
  if (kind === undefined || raw[1] !== "d") return null;
  const { source, name, title } = kind;
  const known = { source, name, title, kind: title };
  // A copy published to the web has its own id after "e".
  if (raw[2] === "e") {
    const id = raw[3];
    if (id === undefined || !ID.test(id)) return null;
    return { ...known, embedUrl: `https://docs.google.com/${raw[0]}/d/e/${id}/${kind.published}` };
  }
  const id = raw[2];
  if (id === undefined || !ID.test(id)) return null;
  // Shows only to someone the document is shared with, signed in to Google in this browser.
  return { ...known, embedUrl: `https://docs.google.com/${raw[0]}/d/${id}/preview` };
}

function youtube(host: string, raw: ReadonlyArray<string>, url: URL): Known | null {
  const id =
    host === "youtu.be"
      ? raw[0]
      : raw[0] === "watch"
        ? (url.searchParams.get("v") ?? undefined)
        : raw[0] === "shorts" || raw[0] === "live" || raw[0] === "embed"
          ? raw[1]
          : undefined;
  if (id === undefined || !YOUTUBE_ID.test(id)) return null;
  const start = /^(\d{1,6})s?$/.exec(
    url.searchParams.get("t") ?? url.searchParams.get("start") ?? "",
  );
  return {
    source: "youtube",
    name: "YouTube",
    title: "YouTube video",
    kind: "YouTube video",
    embedUrl: `https://www.youtube-nocookie.com/embed/${id}${start === null ? "" : `?start=${start[1]}`}`,
  };
}

function loom(raw: ReadonlyArray<string>): Known | null {
  if (raw[0] !== "share" && raw[0] !== "embed") return null;
  const match = /^(?:(.*)-)?([0-9a-f]{32})$/.exec(raw[1] ?? "");
  if (match === null) return null;
  return {
    source: "loom",
    name: "Loom",
    kind: "Loom video",
    title: slugTitle(decodeSegment(match[1] ?? "")) || "Loom video",
    embedUrl: `https://www.loom.com/embed/${match[2]}`,
  };
}

function vimeo(host: string, raw: ReadonlyArray<string>, url: URL): Known | null {
  const player = host === "player.vimeo.com";
  const id = player ? (raw[0] === "video" ? raw[1] : undefined) : raw[0];
  if (id === undefined || !/^\d{1,12}$/.test(id)) return null;
  // An unlisted video's address carries the hash that lets it play.
  const hash = (player ? undefined : raw[1]) ?? url.searchParams.get("h") ?? undefined;
  const keep = hash !== undefined && HEX_ID.test(hash) && hash.length <= 32 ? `?h=${hash}` : "";
  return {
    source: "vimeo",
    name: "Vimeo",
    title: "Vimeo video",
    kind: "Vimeo video",
    embedUrl: `https://player.vimeo.com/video/${id}${keep}`,
  };
}

/** A Notion page's name, without the id after it. */
const notionTitle = (segment: string | undefined) =>
  slugTitle((segment ?? "").replace(/(?:^|-)[0-9a-f]{32}$/, "")) || "Notion page";

/** A Coda or Superhuman doc's page name, without the id after it. */
const codaTitle = (segment: string | undefined) =>
  slugTitle((segment ?? "").replace(/_(?:d|su)[A-Za-z0-9-]+$/, ""));

function github(parts: ReadonlyArray<string>): Known {
  const [owner, repo, section, ...rest] = parts;
  const known = { source: "github", name: "GitHub" } as const;
  if (owner === undefined || repo === undefined) {
    return { ...known, title: owner ?? "GitHub", kind: "GitHub" };
  }
  const repository = `${owner}/${repo}`;
  const kind = section === undefined ? undefined : GITHUB_KINDS[section];
  if (kind !== undefined && /^\d+$/.test(rest[0] ?? "")) {
    return { ...known, title: `${repository} #${rest[0]}`, kind };
  }
  if ((section === "blob" || section === "tree") && rest.length >= 2) {
    return {
      ...known,
      title: rest.slice(1).join("/"),
      kind: `${section === "blob" ? "File" : "Folder"} in ${repository}`,
    };
  }
  if (section === "commit" && /^[0-9a-f]{7,40}$/.test(rest[0] ?? "")) {
    return { ...known, title: `${repository} @ ${rest[0]!.slice(0, 7)}`, kind: "GitHub commit" };
  }
  return { ...known, title: repository, kind: "GitHub repository" };
}

/** A Linear issue as "ENG-123 · Fix login"; a project or document by its name, without its id. */
function linear(raw: ReadonlyArray<string>, parts: ReadonlyArray<string>): Known {
  const known = { source: "linear", name: "Linear" } as const;
  const name = slugTitle((parts[3] ?? "").replace(/-[0-9a-f]{8,}$/i, ""));
  if (raw[1] === "issue" && parts[2] !== undefined) {
    return {
      ...known,
      title: [parts[2].toUpperCase(), name].filter(Boolean).join(" · "),
      kind: "Linear issue",
    };
  }
  const page = slugTitle((parts[2] ?? "").replace(/-[0-9a-f]{8,}$/i, ""));
  if (raw[1] === "project") {
    return { ...known, title: page || "Linear project", kind: "Linear project" };
  }
  if (raw[1] === "document") {
    return { ...known, title: page || "Linear document", kind: "Linear document" };
  }
  return { ...known, title: "Linear", kind: "Linear" };
}

const CLAUDE_ARTIFACT: Known = {
  source: "claude-artifact",
  name: "Claude",
  title: "Claude artifact",
  kind: "Claude artifact",
};

const NOTION = (parts: ReadonlyArray<string>): Known => ({
  source: "notion",
  name: "Notion",
  title: notionTitle(parts.at(-1)),
  kind: "Notion page",
});

function known(
  host: string,
  raw: ReadonlyArray<string>,
  parts: ReadonlyArray<string>,
  url: URL,
): Known | null {
  switch (host) {
    case "figma.com":
      return figma(raw, parts, url);
    case "docs.google.com":
      return google(raw);
    case "youtube.com":
    case "m.youtube.com":
    case "youtu.be":
      return youtube(host, raw, url);
    case "loom.com":
      return loom(raw);
    case "vimeo.com":
    case "player.vimeo.com":
      return vimeo(host, raw, url);
    case "claude.ai":
      return raw[0] === "public" && raw[1] === "artifacts" && ID.test(raw[2] ?? "")
        ? CLAUDE_ARTIFACT
        : null;
    case "claude.site":
      return raw.includes("artifacts") ? CLAUDE_ARTIFACT : null;
    case "linear.app":
      return linear(raw, parts);
    case "github.com":
      return github(parts);
    case "docs.superhuman.com":
      return {
        source: "superhuman",
        name: "Superhuman Docs",
        title: codaTitle(parts.at(-1)) || "Superhuman doc",
        kind: "Superhuman doc",
      };
    case "coda.io":
      return {
        source: "coda",
        name: "Coda",
        title: codaTitle(parts.at(-1)) || "Coda doc",
        kind: "Coda doc",
      };
    case "notion.so":
      return NOTION(parts);
    case "app.asana.com":
      return { source: "asana", name: "Asana", title: "Asana task", kind: "Asana task" };
    case "miro.com":
      return { source: "miro", name: "Miro", title: "Miro board", kind: "Miro board" };
  }
  if (host.endsWith(".notion.site")) return NOTION(parts);
  if (host.endsWith(".atlassian.net")) {
    const key = raw[0] === "browse" ? parts[1] : undefined;
    return { source: "jira", name: "Jira", title: key ?? "Jira issue", kind: "Jira issue" };
  }
  return null;
}

/**
 * What a link card shows for an address: the source it comes from, a title, and, where the source
 * documents framing, the page to frame. Null for anything but an http or https address. Only
 * plain https on the source's own host counts as the source: any other address, a look-alike
 * host or one with a name, password or port in it, is a plain site that is never framed.
 */
export function roomEmbedOf(value: string): RoomEmbed | null {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.hostname === "") return null;
  const host = url.hostname.replace(/^www\./, "");
  const raw = url.pathname.split("/").filter((part) => part !== "");
  const parts = raw.map(decodeSegment);
  const address = `${host}${parts.length === 0 ? "" : `/${parts.join("/")}`}${url.search}`;
  const site: RoomEmbed = {
    source: "web",
    name: host,
    title: webTitle(parts) || host,
    kind: host,
    address,
  };
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return site;
  }
  const found = known(host, raw, parts, url);
  return found === null ? site : { ...found, address };
}

const TRACKED_ITEM =
  "its status, assignee, priority and description, and the latest comments with who wrote them";
const DOCUMENT = "its outline, and the full text if it is short";

/**
 * What a snapshot of a link should hold, for its source: what the person reading it on the board
 * would look for first. Each only asks the agent to read; none asks it to change the source.
 */
export function roomEmbedReadHint(embed: Pick<RoomEmbed, "source" | "kind">): string {
  switch (embed.source) {
    case "linear":
      return embed.kind === "Linear issue"
        ? TRACKED_ITEM
        : embed.kind === "Linear document"
          ? DOCUMENT
          : "its title, status and description, and what it lists";
    case "jira":
    case "asana":
      return TRACKED_ITEM;
    case "github":
      return embed.kind === "GitHub pull request"
        ? "its state, description, a summary of the changed files, and its review status"
        : embed.kind === "GitHub issue" || embed.kind === "GitHub discussion"
          ? "its state, labels, assignees and description, and the latest comments"
          : "what it is and its main content";
    case "google-sheets":
      return "its sheet names, each sheet's headers, its first rows as a Markdown table, and totals where they are obvious";
    case "figma":
    case "miro":
      return "its page and frame names, and what each frame shows";
    case "google-slides":
      return "each slide's title and text, in order";
    case "google-docs":
    case "superhuman":
    case "coda":
    case "notion":
    case "claude-artifact":
      return DOCUMENT;
    case "youtube":
    case "loom":
    case "vimeo":
      return "its title, who made it and how long it is, and a summary or transcript if your tools can read one";
    case "web":
      return "its title and main content";
  }
}

/**
 * The prompt that asks a person's own agent to bring a link onto the board: open it with the
 * tools the agent has, and reply with a faithful snapshot, which fills an artifact card.
 */
export function roomEmbedBringInPrompt(url: string): string {
  const embed = roomEmbedOf(url);
  const what = embed === null || embed.source === "web" ? "page" : embed.kind;
  const hint = embed === null ? "its title and main content" : roomEmbedReadHint(embed);
  return [
    "Open this link with the tools you have connected and write a faithful snapshot of it: title, key fields, the full body where reasonable, and the date you read it. If you cannot open it, say exactly what access is missing.",
    url,
    `For this ${what}, include ${hint}.`,
    "Only read it: change nothing in the source. Your reply becomes the snapshot on the board, in Markdown, starting with the document's title as a heading.",
  ].join("\n\n");
}
