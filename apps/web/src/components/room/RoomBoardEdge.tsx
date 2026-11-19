import { type PointerEvent, memo, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useStableCallback } from "~/hooks/useStableCallback";

import { type BoardLineShape, boardLine, boardLineObstaclesNear } from "./boardLineRoute.logic";
import {
  type BoardBox,
  type BoardLineSlots,
  type BoardSide,
  boardConnector,
  boardConnectorSides,
} from "./roomBoard.logic";
import { type BoardLiveDrag, useBoardLineEnd } from "./roomBoardLive";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** A line's end where someone, this person too, is dragging its card now, or where it is stored. */
const liveEnd = (box: BoardBox, live: BoardLiveDrag | undefined): BoardBox =>
  live === undefined
    ? box
    : {
        x: live.x ?? box.x,
        y: live.y ?? box.y,
        width: live.w ?? box.width,
        height: live.h ?? box.height,
      };

/** A stroke width in board pixels, thickened as the board zooms out; see `boardLineScale`. */
export const boardStroke = (width: number) => `calc(${width}px * var(--board-line-scale, 1))`;

const sameBox = (a: BoardBox, b: BoardBox) =>
  a === b || (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

/** A card an elbow line goes around, named as a line names its ends. */
export interface BoardLineObstacle extends BoardBox {
  readonly ref: string;
}

// The shape this person last gave a line on each board, which their next line there takes.
// Kept for the tab, so a reload does not forget it.
const lastShapes = new Map<string, BoardLineShape>();
const shapeKey = (board: string) => `tinkjam:board-line-shape:v1:${board}`;
export const lastBoardLineShape = (board: string): BoardLineShape => {
  const held = lastShapes.get(board);
  if (held !== undefined) return held;
  let stored: string | null = null;
  try {
    stored = sessionStorage.getItem(shapeKey(board));
  } catch {}
  const shape = stored === "elbow" ? "elbow" : "curve";
  lastShapes.set(board, shape);
  return shape;
};
export const rememberBoardLineShape = (board: string, shape: BoardLineShape) => {
  lastShapes.set(board, shape);
  try {
    sessionStorage.setItem(shapeKey(board), shape);
  } catch {}
};

// An underdamped spring: a line's belly trails its cards, swings past once and settles in about
// 600 ms.
const STIFFNESS = 320;
const DAMPING = 21;
/** How much of its cards' movement a line's belly is left behind by. */
const LAG = 0.9;
const MAX_SWAY = 70;
/** Half a pixel: closer to rest than this, a line stops drawing. */
const SETTLED = 0.5;
// More lines than this springing at once (a big selection dragged) just follow their cards.
const MAX_SWAYING = 30;
let swaying = 0;

const limit = (value: number) => Math.max(-MAX_SWAY, Math.min(MAX_SWAY, value));

interface Sway {
  x: number;
  y: number;
  vx: number;
  vy: number;
  from: BoardBox;
  to: BoardBox;
  ends: { readonly sides: readonly [BoardSide, BoardSide]; readonly slots: BoardLineSlots };
  middle: { readonly x: number; readonly y: number };
  frame: number;
  at: number;
  /** The path last written, so a frame that changes nothing writes nothing. */
  drawn: string;
}

interface BoardEdgeLineProps {
  readonly id: string;
  readonly fromRef: string;
  readonly toRef: string;
  readonly from: BoardBox;
  readonly to: BoardBox;
  /** Where along each end's side it attaches; see `boardLineSlots`. */
  readonly fromSlot: number;
  readonly toSlot: number;
  readonly color: string;
  readonly width: number;
  readonly marker: string;
  readonly dashed?: boolean;
  readonly shape: BoardLineShape;
  /** For an elbow line: every card it might go around. It minds only those near it. */
  readonly obstacles?: ReadonlyArray<BoardLineObstacle> | undefined;
  /** Whether a press on it selects it, for whoever may edit the board. */
  readonly selectable: boolean;
  /** Stable across renders: a line given a new one would draw again. */
  readonly onSelect: (id: string) => void;
  /** The layer above the cards. */
  readonly over: SVGGElement | null;
}

/**
 * Brings forward the lines on the cards `refs` names and the lines `edgeIds` names, each with its
 * faint copy above the cards, and dims the rest. With none of them, every line shows as it is and
 * no copy shows. Set on the page, not in state, so hovering a card re-renders nothing.
 */
function focusBoardLines(
  layer: HTMLElement | null,
  refs: ReadonlySet<string>,
  edgeIds: ReadonlySet<string>,
) {
  if (layer === null) return;
  let any = false;
  for (const line of layer.querySelectorAll<SVGElement>("[data-line-id]")) {
    const on =
      edgeIds.has(line.dataset.lineId ?? "") ||
      refs.has(line.dataset.lineFrom ?? "") ||
      refs.has(line.dataset.lineTo ?? "");
    any ||= on;
    line.toggleAttribute("data-line-focus", on);
  }
  layer.toggleAttribute("data-lines-focused", any);
}

/**
 * Which lines stand out: those on the cards selected or under the pointer (as one being dragged
 * is), and the line selected or under it. Put `ref` and the handlers on the element holding every
 * line, which takes the `group/lines` class.
 */
export function useBoardLineFocus(
  selected: ReadonlySet<string>,
  selectedEdge: string | null,
  lineCount: number,
) {
  const layer = useRef<HTMLDivElement | null>(null);
  const hovered = useRef<{ item: string | null; edge: string | null }>({ item: null, edge: null });
  const shown = useRef({ key: "", edge: null as string | null, lines: 0 });
  const focus = useStableCallback((key: string, edge: string | null, lines: number) => {
    shown.current = { key, edge, lines };
    const over = hovered.current;
    const refs = new Set(key === "" ? [] : key.split(" "));
    if (over.item !== null) refs.add(over.item);
    const edgeIds = new Set([edge, over.edge].filter((id) => id !== null));
    focusBoardLines(layer.current, lines === 0 ? new Set<string>() : refs, edgeIds);
  });
  const selectedKey = [...selected].join(" ");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- marks the selection's lines on the page, as hovering does, so no line re-renders for it
  useLayoutEffect(
    () => focus(selectedKey, selectedEdge, lineCount),
    [focus, selectedKey, selectedEdge, lineCount],
  );
  const hover = (item: string | null, edge: string | null) => {
    if (hovered.current.item === item && hovered.current.edge === edge) return;
    hovered.current = { item, edge };
    focus(shown.current.key, shown.current.edge, shown.current.lines);
  };
  return {
    ref: layer,
    onPointerOver: (event: PointerEvent<HTMLElement>) => {
      const target = event.target instanceof Element ? event.target : null;
      const edge = target?.closest("[data-board-edge]")?.getAttribute("data-board-edge") ?? null;
      const item =
        edge === null
          ? (target?.closest<HTMLElement>("[data-board-item]")?.dataset.boardItem ?? null)
          : null;
      hover(item, edge);
    },
    onPointerOut: (event: PointerEvent<HTMLElement>) => {
      const next = event.relatedTarget;
      if (!(next instanceof Node) || !event.currentTarget.contains(next)) hover(null, null);
    },
  };
}

/**
 * One line between two cards. It reads its ends' live drags itself, so a drag redraws only the
 * lines on the moving card. Its faint copy in `over`, above the cards, shows only while
 * `focusBoardLines` brings it forward, so most lines never cross cards. Ends compare by value.
 */
export const BoardEdgeLine = memo(function BoardEdgeLine({
  id,
  fromRef,
  toRef,
  from,
  to,
  fromSlot,
  toSlot,
  color,
  width,
  marker,
  dashed = false,
  shape,
  obstacles,
  selectable,
  onSelect,
  over,
}: BoardEdgeLineProps) {
  const start = liveEnd(from, useBoardLineEnd(fromRef));
  const end = liveEnd(to, useBoardLineEnd(toRef));
  // The sides it attaches by change only once the other pair is clearly better.
  const [held, setHeld] = useState(() => boardConnectorSides(start, end));
  const sides = boardConnectorSides(start, end, held);
  if (sides !== held) setHeld(sides);
  const slots = { from: fromSlot, to: toSlot };
  const elbow = shape === "elbow";
  const around = elbow
    ? obstacles?.filter((other) => other.ref !== fromRef && other.ref !== toRef)
    : undefined;
  const { path, middle } = boardLine(shape, start, end, { sides, slots }, around);
  const group = useRef<SVGGElement>(null);
  const ghost = useRef<SVGPathElement>(null);
  const sway = useRef<Sway | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the spring writes paths to the DOM between renders, and stops once settled
  useLayoutEffect(() => {
    if (sway.current === null) {
      sway.current = {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        from: start,
        to: end,
        ends: { sides, slots },
        middle,
        frame: 0,
        at: 0,
        drawn: "",
      };
    }
    const state = sway.current;
    const dx = middle.x - state.middle.x;
    const dy = middle.y - state.middle.y;
    state.from = start;
    state.to = end;
    state.ends = { sides, slots };
    state.middle = middle;
    const draw = (rest: boolean) => {
      const d = boardConnector(state.from, state.to, rest ? undefined : state, state.ends).path;
      if (d === state.drawn) return;
      state.drawn = d;
      for (const line of group.current?.querySelectorAll("path") ?? []) line.setAttribute("d", d);
      ghost.current?.setAttribute("d", d);
    };
    const stop = () => {
      if (state.frame !== 0) {
        cancelAnimationFrame(state.frame);
        swaying -= 1;
      }
      state.x = state.y = state.vx = state.vy = 0;
      state.frame = 0;
    };
    const step = (now: number) => {
      const seconds = Math.min(0.032, (now - state.at) / 1000);
      state.at = now;
      state.vx += (-STIFFNESS * state.x - DAMPING * state.vx) * seconds;
      state.vy += (-STIFFNESS * state.y - DAMPING * state.vy) * seconds;
      state.x += state.vx * seconds;
      state.y += state.vy * seconds;
      // Under half a pixel this frame and from rest: nothing more worth drawing.
      const settled =
        Math.abs(state.x) < SETTLED &&
        Math.abs(state.y) < SETTLED &&
        (Math.abs(state.vx) + Math.abs(state.vy)) * seconds < SETTLED;
      if (settled) {
        stop();
        draw(true);
        return;
      }
      draw(false);
      state.frame = requestAnimationFrame(step);
    };
    state.drawn = path;
    // An elbow line keeps its corners square: it follows its cards and never springs.
    if (elbow) return stop();
    if (dx !== 0 || dy !== 0) {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false) return;
      // A line longer than the screen, or one of a great many moving at once, just follows.
      const scale = state.frame === 0 ? (group.current?.getScreenCTM()?.a ?? 1) : 1;
      const long =
        Math.hypot(end.x - start.x, end.y - start.y) * scale >
        Math.max(window.innerWidth, window.innerHeight);
      if (state.frame === 0 && (long || swaying >= MAX_SWAYING)) return;
      state.x = limit(state.x - dx * LAG);
      state.y = limit(state.y - dy * LAG);
    }
    if (state.x === 0 && state.y === 0 && state.frame === 0) return;
    // React just wrote the resting path; put the swaying one back before paint.
    draw(false);
    if (state.frame === 0) {
      swaying += 1;
      state.at = performance.now();
      state.frame = requestAnimationFrame(step);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a frame still pending must not outlive the line
  useLayoutEffect(
    () => () => {
      const state = sway.current;
      if (state === null || state.frame === 0) return;
      cancelAnimationFrame(state.frame);
      state.frame = 0;
      swaying -= 1;
    },
    [],
  );

  return (
    <g
      ref={group}
      data-line-id={id}
      data-line-from={fromRef}
      data-line-to={toRef}
      className="group-data-[lines-focused]/lines:opacity-30 data-[line-focus]:opacity-100!"
    >
      {selectable ? (
        <path
          d={path}
          fill="none"
          stroke="transparent"
          style={{ strokeWidth: boardStroke(16) }}
          pointerEvents="stroke"
          data-board-edge={id}
          className="cursor-pointer"
          onPointerDown={stopPointer}
          onClick={() => onSelect(id)}
        />
      ) : null}
      <path
        d={path}
        fill="none"
        stroke="var(--color-background)"
        style={{ strokeWidth: boardStroke(width + 3) }}
        strokeLinecap="round"
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        style={{ strokeWidth: boardStroke(width) }}
        strokeLinecap="round"
        strokeDasharray={dashed ? "7 6" : undefined}
        markerEnd={marker}
      />
      {over === null
        ? null
        : createPortal(
            <path
              ref={ghost}
              data-line-id={id}
              data-line-from={fromRef}
              data-line-to={toRef}
              className="hidden data-[line-focus]:inline"
              d={path}
              fill="none"
              stroke={color}
              strokeOpacity={0.35}
              style={{ strokeWidth: boardStroke(width) }}
              strokeLinecap="round"
              strokeDasharray="2 7"
            />,
            over,
          )}
    </g>
  );
}, sameEdgeProps);

function sameEdgeProps(before: BoardEdgeLineProps, after: BoardEdgeLineProps): boolean {
  for (const key of Object.keys(after) as Array<keyof BoardEdgeLineProps>) {
    if (key === "from" || key === "to") {
      if (!sameBox(before[key], after[key])) return false;
    } else if (key === "obstacles") {
      if (!sameObstacles(before.obstacles, after.obstacles, after)) return false;
    } else if (before[key] !== after[key]) return false;
  }
  return true;
}

// A card moved far from an elbow line is no reason to draw the line again.
function sameObstacles(
  before: BoardEdgeLineProps["obstacles"],
  after: BoardEdgeLineProps["obstacles"],
  line: BoardEdgeLineProps,
): boolean {
  if (before === after) return true;
  if (before === undefined || after === undefined) return false;
  const was = boardLineObstaclesNear(line.from, line.to, before);
  const now = boardLineObstaclesNear(line.from, line.to, after);
  return (
    was.length === now.length &&
    was.every((box, index) => {
      const other = now[index];
      return other !== undefined && box.ref === other.ref && sameBox(box, other);
    })
  );
}
