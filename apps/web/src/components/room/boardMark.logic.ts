import {
  ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH,
  ROOM_BOARD_MARK_TEXT_MAX_LENGTH,
  isRoomBoardUrl,
  roomBoardNoteRef,
  type RoomBoard,
  type RoomBoardMark,
} from "@t3tools/contracts";
import { ROOM_MARK_NOUNS, roomArtifactSource } from "@t3tools/shared/roomBoard";

/** What tells the messages between a board and its artifact pages from a page's own. */
export const BOARD_MARK_MESSAGE = "tinkjam-mark";

/** A mark as its artifact's page numbers it. */
export interface BoardMarkPin {
  readonly number: number;
  readonly selector: string;
}

/** What someone pointed at in a page, and where it is drawn in the page's frame. */
export interface BoardMarkPick {
  readonly mark: RoomBoardMark;
  readonly rect: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
}

/** A link someone pressed in a page, as its frame said it: untrusted text, checked and capped. */
export interface BoardPageLinkSaid {
  /** The address as the page wrote it, such as `#pricing` or `menu.html`. */
  readonly href: string;
  /** The same address as the frame's browser resolved it, or empty. */
  readonly url: string;
  readonly text: string;
  /** Where the pointer was, in the frame's own pixels. */
  readonly x: number;
  readonly y: number;
  /** Whether it was a plain click, which the page lost, and not a right-click. */
  readonly click: boolean;
}

type BoardMarkMessage =
  | { readonly type: "ready" }
  | { readonly type: "escape" }
  | { readonly type: "link"; readonly link: BoardPageLinkSaid }
  | { readonly type: "pick"; readonly pick: BoardMarkPick };

const FRAME_REACH = 20_000;
const LINK_MAX_LENGTH = 2_048;
const LINK_NAME_MAX_LENGTH = 80;
/**
 * An address that names the page it is on: nothing, `/` or `index.html` before any `#spot`. Kept
 * as text because our script in the page reads the same rule.
 */
const SAME_PAGE = "^(?:\\.?/)?(?:index\\.html?)?(?:\\?[^#]*)?(?:#|$)";

const linkAddress = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const address = value.trim();
  return address.length > LINK_MAX_LENGTH || /\p{Cc}/u.test(address) ? null : address;
};

const pageText = (value: unknown): string =>
  typeof value === "string"
    ? value
        .replace(/[\p{Cc}\s]+/gu, " ")
        .trim()
        .slice(0, ROOM_BOARD_MARK_TEXT_MAX_LENGTH)
    : "";

const frameLength = (value: unknown, least: number): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.min(FRAME_REACH, Math.max(least, Math.round(value)))
    : null;

/**
 * What an artifact's page posted, read as untrusted text from an untrusted page: every field is
 * checked and capped, nothing is evaluated, and anything else is null.
 */
export function boardMarkMessage(data: unknown): BoardMarkMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const said: Readonly<Record<string, unknown>> = { ...data };
  if (said.source !== BOARD_MARK_MESSAGE) return null;
  if (said.type === "ready" || said.type === "escape") return { type: said.type };
  if (said.type === "link") {
    const href = linkAddress(said.href);
    const at = { x: frameLength(said.x, 0), y: frameLength(said.y, 0) };
    if (href === null || href === "" || at.x === null || at.y === null) return null;
    return {
      type: "link",
      link: {
        href,
        url: linkAddress(said.url) ?? "",
        text: pageText(said.text),
        x: at.x,
        y: at.y,
        click: said.click === true,
      },
    };
  }
  if (said.type !== "pick" || typeof said.selector !== "string") return null;
  const selector = said.selector.trim();
  if (
    selector === "" ||
    selector.length > ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH ||
    /[\p{Cc}`]/u.test(selector)
  ) {
    return null;
  }
  const frame: Readonly<Record<string, unknown>> =
    typeof said.rect === "object" && said.rect !== null ? { ...said.rect } : {};
  const x = frameLength(frame.x, -FRAME_REACH);
  const y = frameLength(frame.y, -FRAME_REACH);
  const width = frameLength(frame.width, 0);
  const height = frameLength(frame.height, 0);
  if (x === null || y === null || width === null || height === null) return null;
  const tag =
    typeof said.tag === "string" && /^[a-z][a-z0-9-]{0,31}$/.test(said.tag) ? said.tag : "";
  const text = pageText(said.text);
  const quote = pageText(said.quote);
  return {
    type: "pick",
    pick: {
      mark: {
        selector,
        ...(tag === "" ? {} : { tag }),
        ...(text === "" ? {} : { text }),
        ...(quote === "" ? {} : { quote }),
      },
      rect: { x, y, width, height },
    },
  };
}

/**
 * What a link in an artifact's page can open, and the text Copy link copies. An artifact is one
 * page, so an address on it that is not a spot on that page names a page nobody has made.
 */
export type BoardPageLink =
  /** Another site: a link card beside the artifact, or a new tab. */
  | { readonly kind: "site"; readonly url: string; readonly copy: string }
  /** An address only a new tab opens: our own hosts, or one a link card cannot hold. */
  | { readonly kind: "tab"; readonly url: string; readonly copy: string }
  /** A spot on the same page; an empty `id` is its top. */
  | { readonly kind: "spot"; readonly id: string; readonly copy: string }
  /** A page that does not exist, named after the link's text. */
  | { readonly kind: "page"; readonly name: string; readonly copy: string }
  /** Anything else, such as `mailto:` and `tel:`: only copied. */
  | { readonly kind: "other"; readonly copy: string };

const siteOf = (host: string) =>
  host.toLowerCase().replace(/\.$/, "").split(".").slice(-2).join(".");

const pageName = (text: string, href: string): string => {
  const file = (href.split(/[?#]/)[0] ?? "").split("/").findLast((part) => part !== "") ?? "";
  const words = file
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[-_+]+|%20/g, " ")
    .trim();
  const name = text !== "" ? text : words.charAt(0).toUpperCase() + words.slice(1);
  return name.slice(0, LINK_NAME_MAX_LENGTH).trim() || "New page";
};

/**
 * Reads a link a page reported. A frame resolves its page's addresses against the board's own, so
 * `ownHosts` (the app's and the board host's) tell a page's own addresses from another site's.
 * Null for what is never offered: an address that runs script or holds data.
 */
export function boardPageLinkOf(
  said: Pick<BoardPageLinkSaid, "href" | "url" | "text">,
  ownHosts: ReadonlyArray<string>,
): BoardPageLink | null {
  const { href } = said;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href)?.[1]?.toLowerCase();
  if (scheme !== undefined && scheme !== "http" && scheme !== "https") {
    return /^(?:mailto|tel|sms)$/.test(scheme) ? { kind: "other", copy: href } : null;
  }
  const absolute = scheme !== undefined || href.startsWith("//");
  if (!absolute && new RegExp(SAME_PAGE, "i").test(href)) {
    const hash = href.includes("#") ? href.slice(href.indexOf("#") + 1) : "";
    let id = hash;
    try {
      id = decodeURIComponent(hash);
    } catch {
      id = hash;
    }
    return { kind: "spot", id: id.slice(0, ROOM_BOARD_MARK_TEXT_MAX_LENGTH), copy: href };
  }
  let url: URL | null = null;
  try {
    url = new URL(absolute && scheme !== undefined ? href : said.url);
  } catch {
    url = null;
  }
  const host = url?.hostname ?? "";
  const own = host === "" || ownHosts.some((ownHost) => siteOf(ownHost) === siteOf(host));
  if (!absolute && own) return { kind: "page", name: pageName(said.text, href), copy: href };
  if (url === null || !isRoomBoardUrl(url.href) || url.href.length > LINK_MAX_LENGTH) return null;
  return {
    kind: own || url.username !== "" || url.password !== "" ? "tab" : "site",
    url: url.href,
    copy: url.href,
  };
}

/**
 * The marks on a board: each marked note with a line into an artifact, numbered per artifact in
 * the board's order. A line into a live view counts for the artifact it shows.
 */
export function boardMarks(board: RoomBoard): {
  /** By artifact id. */
  readonly pins: ReadonlyMap<string, ReadonlyArray<BoardMarkPin>>;
  /** By the marked note's id. */
  readonly numbers: ReadonlyMap<string, number>;
} {
  const pins = new Map<string, Array<BoardMarkPin>>();
  const numbers = new Map<string, number>();
  for (const note of board.notes) {
    if (note.mark === undefined) continue;
    const from = roomBoardNoteRef(note.id);
    const artifact = (board.edges ?? [])
      .filter((edge) => edge.from === from)
      .flatMap((edge) => {
        const to = board.notes.find((other) => roomBoardNoteRef(other.id) === edge.to);
        return to?.kind === "artifact" ? (roomArtifactSource(board, to.id) ?? []) : [];
      })[0];
    if (artifact === undefined) continue;
    const marks = pins.get(artifact.id) ?? [];
    pins.set(artifact.id, marks);
    marks.push({ number: marks.length + 1, selector: note.mark.selector });
    numbers.set(note.id, marks.length);
  }
  return { pins, numbers };
}

/**
 * A short CSS selector that finds `element` in its page: its id when it has one of its own, else
 * tags with a class or two, counted among their siblings only where they must be. It runs inside
 * the artifact's page as text (`boardPageWithMarks`), so it uses nothing outside itself.
 */
export function boardMarkSelectorOf(element: Element): string {
  const doc = element.ownerDocument;
  const only = (selector: string) => {
    try {
      return doc.querySelectorAll(selector).length === 1;
    } catch {
      return false;
    }
  };
  const parts: Array<string> = [];
  let node: Element | null = element;
  while (node !== null && node !== doc.documentElement && node !== doc.body) {
    const id = node.getAttribute("id");
    if (id !== null && id !== "" && only("#" + CSS.escape(id))) {
      parts.unshift("#" + CSS.escape(id));
      return parts.join(" > ");
    }
    let part = node.tagName.toLowerCase();
    let named = 0;
    for (let index = 0; index < node.classList.length && named < 2; index++) {
      const name = node.classList.item(index);
      if (name !== null && /^[a-zA-Z][\w-]{0,31}$/.test(name)) {
        part += "." + name;
        named += 1;
      }
    }
    const parent: Element | null = node.parentElement;
    if (parent !== null) {
      let nth = 0;
      let sameTag = 0;
      let alike = 0;
      for (let index = 0; index < parent.children.length; index++) {
        const child = parent.children.item(index);
        if (child === null) continue;
        if (child.tagName === node.tagName) sameTag += 1;
        if (child === node) nth = sameTag;
        try {
          if (child.matches(part)) alike += 1;
        } catch {
          alike += 2;
        }
      }
      if (alike > 1) part += ":nth-of-type(" + nth + ")";
    }
    parts.unshift(part);
    const whole = parts.join(" > ");
    if (only(whole) || whole.length > 200) return whole;
    node = parent;
  }
  return parts.length === 0 ? "body" : parts.join(" > ");
}

/**
 * Our script inside an artifact's page, as text: on the board's word it outlines and names what
 * is under the pointer, posts a click as a pick instead of letting the page have it, and draws
 * numbered pins. It also posts Escape, which a page with the focus would keep from the board.
 */
function boardMarkPage(
  selectorOf: (element: Element) => string,
  config: {
    readonly source: string;
    readonly textMax: number;
    readonly linkMax: number;
    readonly samePage: string;
    readonly nouns: Readonly<Record<string, string>>;
  },
): void {
  let pointing = false;
  let start: string | null = null;
  let held: Element | null = null;
  let over: Element | null = null;
  let pins: ReadonlyArray<unknown> = [];
  let color = "Highlight";
  let ink = "HighlightText";
  const host = document.createElement("div");
  host.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:2147483647;overflow:hidden";
  // Closed, so the page's own styles do not reach the outline, the label or the pins.
  const root = host.attachShadow({ mode: "closed" });
  const say = (message: Record<string, unknown>) =>
    window.parent.postMessage(Object.assign({ source: config.source }, message), "*");
  const textOf = (element: Element) => {
    const own = element instanceof HTMLElement ? element.innerText : element.textContent;
    const text =
      own ||
      element.getAttribute("alt") ||
      element.getAttribute("aria-label") ||
      element.getAttribute("placeholder") ||
      "";
    return text.replace(/\s+/g, " ").trim().slice(0, config.textMax);
  };
  const nameOf = (element: Element) => {
    const noun = config.nouns[element.tagName.toLowerCase()];
    const text = textOf(element).slice(0, 40);
    if (text === "") return noun === undefined ? "Part of the page" : noun;
    return '"' + text + '"' + (noun === undefined ? "" : " " + noun);
  };
  const tagAt = (left: number, top: number, text: string, round: boolean) => {
    const tag = document.createElement("div");
    tag.textContent = text;
    tag.style.cssText =
      "position:fixed;box-sizing:border-box;height:18px;min-width:18px;max-width:240px;padding:0 5px;font:600 11px/18px system-ui,sans-serif;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis";
    tag.style.left = Math.max(0, left) + "px";
    tag.style.top = Math.max(0, top) + "px";
    tag.style.borderRadius = round ? "9px" : "3px";
    tag.style.background = color;
    tag.style.color = ink;
    root.appendChild(tag);
  };
  const draw = () => {
    root.textContent = "";
    if (!pointing) return;
    for (const pin of pins) {
      const { number, selector } = (pin ?? {}) as { number?: unknown; selector?: unknown };
      if (typeof number !== "number" || typeof selector !== "string") continue;
      let marked: Element | null = null;
      try {
        marked = document.querySelector(selector);
      } catch {
        marked = null;
      }
      if (marked === null) continue;
      const at = marked.getBoundingClientRect();
      tagAt(at.left - 6, at.top - 6, String(number), true);
    }
    const shown = held ?? over;
    if (shown === null || !shown.isConnected) return;
    const rect = shown.getBoundingClientRect();
    const outline = document.createElement("div");
    outline.style.cssText =
      "position:fixed;box-sizing:border-box;border:2px solid;border-radius:3px";
    outline.style.borderColor = color;
    outline.style.left = rect.left + "px";
    outline.style.top = rect.top + "px";
    outline.style.width = rect.width + "px";
    outline.style.height = rect.height + "px";
    root.appendChild(outline);
    tagAt(rect.left, rect.top - 20, nameOf(shown), false);
  };
  const pick = (target: EventTarget | null) => {
    const selection = window.getSelection();
    const quote =
      selection === null
        ? ""
        : selection.toString().replace(/\s+/g, " ").trim().slice(0, config.textMax);
    let element = target instanceof Element ? target : null;
    if (quote !== "" && selection !== null && selection.rangeCount > 0) {
      const within = selection.getRangeAt(0).commonAncestorContainer;
      element = within instanceof Element ? within : within.parentElement;
    }
    if (element === null || element === document.documentElement) return;
    held = element;
    const rect = element.getBoundingClientRect();
    say({
      type: "pick",
      selector: selectorOf(element),
      tag: element.tagName.toLowerCase(),
      text: textOf(element),
      quote,
      rect: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    });
    draw();
  };
  // A press keeps its default so text can still be selected; the click is what the page loses.
  const take = (event: Event) => {
    if (!pointing) return;
    event.stopImmediatePropagation();
    if (event.type === "mousedown" || event.type === "pointerdown") return;
    event.preventDefault();
    if (event.type === "click") pick(event.target);
  };
  for (const type of ["click", "dblclick", "auxclick", "mousedown", "pointerdown", "submit"]) {
    window.addEventListener(type, take, true);
  }
  window.addEventListener(
    "mousemove",
    (event) => {
      if (!pointing || held !== null) return;
      const target = event.target instanceof Element ? event.target : null;
      const next = target === document.documentElement ? null : target;
      if (next === over) return;
      over = next;
      draw();
    },
    true,
  );
  const redraw = () => {
    if (pointing) draw();
  };
  const scrollToSpot = (id: string) => {
    const spot =
      id === "" ? null : document.getElementById(id) || document.getElementsByName(id)[0];
    if (spot) spot.scrollIntoView();
    else if (id === "" || id === "top") window.scrollTo(0, 0);
  };
  // Heard last and never while marking up: a page that handles its own link keeps it. A sandboxed
  // frame cannot go anywhere a link leads, so a click that would try is reported instead.
  const link = (event: MouseEvent, click: boolean) => {
    if (pointing || event.defaultPrevented) return;
    const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (anchor === null) return;
    const href = (anchor.getAttribute("href") || "").trim();
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(href);
    if (
      href === "" ||
      (scheme !== null && /^(javascript|data|blob|vbscript)$/i.test(scheme[1] || ""))
    )
      return;
    if (click) {
      if (anchor.hasAttribute("download")) return;
      // A srcdoc page's address is its parent's, so its own "#spot" link would load the app here.
      if (href.charAt(0) === "#") {
        event.preventDefault();
        let spot = href.slice(1);
        try {
          spot = decodeURIComponent(spot);
        } catch {
          spot = "";
        }
        scrollToSpot(spot);
        return;
      }
      if (scheme !== null && !/^https?$/i.test(scheme[1] || "")) return;
      if (
        scheme === null &&
        href.slice(0, 2) !== "//" &&
        new RegExp(config.samePage, "i").test(href)
      ) {
        event.preventDefault();
        let id = href.indexOf("#") < 0 ? "" : href.slice(href.indexOf("#") + 1);
        try {
          id = decodeURIComponent(id);
        } catch {
          id = "";
        }
        scrollToSpot(id);
        return;
      }
    }
    event.preventDefault();
    say({
      type: "link",
      click,
      href: href.slice(0, config.linkMax),
      url: anchor instanceof HTMLAnchorElement ? anchor.href.slice(0, config.linkMax) : "",
      text: textOf(anchor),
      x: event.clientX,
      y: event.clientY,
    });
  };
  window.addEventListener("contextmenu", (event) => link(event, false));
  window.addEventListener("click", (event) => link(event, true));
  window.addEventListener("auxclick", (event) => {
    if (event.button === 1) link(event, true);
  });
  window.addEventListener("load", () => {
    if (start !== null) scrollToSpot(start);
  });
  window.addEventListener("scroll", redraw, true);
  window.addEventListener("resize", redraw);
  window.addEventListener("message", (event) => {
    const data = event.data as {
      readonly source?: unknown;
      readonly type?: unknown;
      readonly on?: unknown;
      readonly color?: unknown;
      readonly ink?: unknown;
      readonly pins?: unknown;
      readonly id?: unknown;
    } | null;
    if (event.source !== window.parent || typeof data !== "object" || data === null) return;
    if (data.source !== config.source) return;
    if (data.type === "mode") {
      pointing = data.on === true;
      held = null;
      over = null;
      if (typeof data.color === "string" && data.color !== "") color = data.color;
      if (typeof data.ink === "string" && data.ink !== "") ink = data.ink;
      document.documentElement.style.cursor = pointing ? "crosshair" : "";
    }
    if (data.type === "scroll" && typeof data.id === "string") {
      start = data.id;
      scrollToSpot(start);
    }
    if (data.type === "pins" && typeof data.pins === "string") {
      try {
        const marked: unknown = JSON.parse(data.pins);
        if (Array.isArray(marked)) pins = marked;
      } catch {
        pins = [];
      }
    }
    draw();
  });
  window.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") say({ type: "escape" });
    },
    true,
  );
  document.documentElement.appendChild(host);
  say({ type: "ready" });
}

const BOARD_MARK_SCRIPT = `<script>try{(${boardMarkPage.toString()})(${boardMarkSelectorOf.toString()},${JSON.stringify(
  {
    source: BOARD_MARK_MESSAGE,
    textMax: ROOM_BOARD_MARK_TEXT_MAX_LENGTH,
    linkMax: LINK_MAX_LENGTH,
    samePage: SAME_PAGE,
    nouns: ROOM_MARK_NOUNS,
  },
)})}catch(error){}</script>`;

/** An artifact's page as its frame shows it, with our script after it; never what is stored. */
export const boardPageWithMarks = (body: string): string => `${body}\n${BOARD_MARK_SCRIPT}`;
