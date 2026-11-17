import { type PointerEvent, memo, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

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
  /** Whether a press on it selects it, for whoever may edit the board. */
  readonly selectable: boolean;
  /** Stable across renders: a line given a new one would draw again. */
  readonly onSelect: (id: string) => void;
  /** The layer above the cards. */
  readonly over: SVGGElement | null;
}

/**
 * One line between two cards. Each reads where anyone drags its own two ends from the live store,
 * so a drag redraws only the lines on the card that moves, never the board. It also draws
 * a faint copy of itself into `over`, above the cards, so it can be followed behind one. Its ends
 * compare by value, so the board's other changes leave it alone.
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
  const { path, middle } = boardConnector(start, end, undefined, { sides, slots });
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
    <g ref={group}>
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
    } else if (before[key] !== after[key]) return false;
  }
  return true;
}
