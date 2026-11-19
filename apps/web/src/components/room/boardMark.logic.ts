import {
  ROOM_BOARD_MARK_SELECTOR_MAX_LENGTH,
  ROOM_BOARD_MARK_TEXT_MAX_LENGTH,
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

type BoardMarkMessage =
  | { readonly type: "ready" }
  | { readonly type: "escape" }
  | { readonly type: "pick"; readonly pick: BoardMarkPick };

const FRAME_REACH = 20_000;

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
    readonly nouns: Readonly<Record<string, string>>;
  },
): void {
  let pointing = false;
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
    nouns: ROOM_MARK_NOUNS,
  },
)})}catch(error){}</script>`;

/** An artifact's page as its frame shows it, with our script after it; never what is stored. */
export const boardPageWithMarks = (body: string): string => `${body}\n${BOARD_MARK_SCRIPT}`;
