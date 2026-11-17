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

/** "Checkout-flow_v2" as "Checkout flow v2". */
const slugTitle = (slug: string | undefined) =>
  (slug ?? "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

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

const GITHUB_KINDS: Readonly<Record<string, string>> = { pull: "Pull request", issues: "Issue" };

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
    title: slugTitle(parts[branch ? 4 : 2]) || kind.title,
    embedUrl: `https://embed.figma.com/${kind.type}/${key}?embed-host=tinkjam${at}`,
  };
}

function google(raw: ReadonlyArray<string>): Known | null {
  const kind = GOOGLE_KINDS[raw[0] ?? ""];
  if (kind === undefined || raw[1] !== "d") return null;
  const { source, name, title } = kind;
  // A copy published to the web has its own id after "e".
  if (raw[2] === "e") {
    const id = raw[3];
    if (id === undefined || !ID.test(id)) return null;
    return {
      source,
      name,
      title,
      embedUrl: `https://docs.google.com/${raw[0]}/d/e/${id}/${kind.published}`,
    };
  }
  const id = raw[2];
  if (id === undefined || !ID.test(id)) return null;
  // Shows only to someone the document is shared with, signed in to Google in this browser.
  return { source, name, title, embedUrl: `https://docs.google.com/${raw[0]}/d/${id}/preview` };
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
  if (owner === undefined || repo === undefined) return { ...known, title: "GitHub" };
  const repository = `${owner}/${repo}`;
  const kind = section === undefined ? undefined : GITHUB_KINDS[section];
  if (kind !== undefined && /^\d+$/.test(rest[0] ?? "")) {
    return { ...known, title: `${kind} ${repository}#${rest[0]}` };
  }
  if ((section === "blob" || section === "tree") && rest.length >= 2) {
    return { ...known, title: `${rest.slice(1).join("/")} in ${repository}` };
  }
  return { ...known, title: repository };
}

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
        ? { source: "claude-artifact", name: "Claude", title: "Claude artifact" }
        : null;
    case "claude.site":
      return raw.includes("artifacts")
        ? { source: "claude-artifact", name: "Claude", title: "Claude artifact" }
        : null;
    case "linear.app": {
      const issue = raw[1] === "issue" ? parts[2] : undefined;
      const title =
        issue === undefined
          ? raw[1] === "project"
            ? "Linear project"
            : raw[1] === "document"
              ? "Linear document"
              : "Linear"
          : [issue, slugTitle(parts[3])].filter(Boolean).join(" ");
      return { source: "linear", name: "Linear", title };
    }
    case "github.com":
      return github(parts);
    case "docs.superhuman.com":
      return {
        source: "superhuman",
        name: "Superhuman Docs",
        title: codaTitle(parts.at(-1)) || "Superhuman doc",
      };
    case "coda.io":
      return { source: "coda", name: "Coda", title: codaTitle(parts.at(-1)) || "Coda doc" };
    case "notion.so":
      return { source: "notion", name: "Notion", title: notionTitle(parts.at(-1)) };
    case "app.asana.com":
      return { source: "asana", name: "Asana", title: "Asana task" };
    case "miro.com":
      return { source: "miro", name: "Miro", title: "Miro board" };
  }
  if (host.endsWith(".notion.site")) {
    return { source: "notion", name: "Notion", title: notionTitle(parts.at(-1)) };
  }
  if (host.endsWith(".atlassian.net")) {
    const key = raw[0] === "browse" ? parts[1] : undefined;
    return { source: "jira", name: "Jira", title: key ?? "Jira issue" };
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
  const site: RoomEmbed = { source: "web", name: host, title: host, address };
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return site;
  }
  const found = known(host, raw, parts, url);
  return found === null ? site : { ...found, address };
}
