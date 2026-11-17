import { type PointerEvent, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";

import { type BoardBox, boardConnector } from "./roomBoard.logic";
import { type BoardLiveDrag, useBoardLiveDrag } from "./roomBoardLive";

const stopPointer = (event: PointerEvent) => event.stopPropagation();

/** A line's end where someone else is dragging its card now, or where the card is stored. */
const liveEnd = (box: BoardBox, live: BoardLiveDrag | undefined): BoardBox =>
  live === undefined
    ? box
    : { ...box, x: live.x ?? box.x, y: live.y ?? box.y, width: live.w ?? box.width };

// An underdamped spring: a line's belly trails its cards, swings past and settles in under a second.
const STIFFNESS = 170;
const DAMPING = 11;
/** How much of its cards' movement a line's belly is left behind by. */
const LAG = 0.9;
const MAX_SWAY = 70;
const SETTLED = 0.25;

const limit = (value: number) => Math.max(-MAX_SWAY, Math.min(MAX_SWAY, value));

interface Sway {
  x: number;
  y: number;
  vx: number;
  vy: number;
  from: BoardBox;
  to: BoardBox;
  middle: { readonly x: number; readonly y: number };
  frame: number;
  at: number;
}

/**
 * One line between two cards. Each reads where someone else drags its own two ends from the live
 * store, so a drag redraws only the lines on the card that moves, never the board. It also draws
 * a faint copy of itself into `over`, above the cards, so it can be followed behind one.
 */
export function BoardEdgeLine({
  id,
  fromRef,
  toRef,
  from,
  to,
  color,
  width,
  marker,
  dashed = false,
  selectable,
  onSelect,
  over,
}: {
  readonly id: string;
  readonly fromRef: string;
  readonly toRef: string;
  readonly from: BoardBox;
  readonly to: BoardBox;
  readonly color: string;
  readonly width: number;
  readonly marker: string;
  readonly dashed?: boolean;
  /** Whether a press on it selects it, for whoever may edit the board. */
  readonly selectable: boolean;
  readonly onSelect: () => void;
  /** The layer above the cards. */
  readonly over: SVGGElement | null;
}) {
  const start = liveEnd(from, useBoardLiveDrag(fromRef));
  const end = liveEnd(to, useBoardLiveDrag(toRef));
  const { path, middle } = boardConnector(start, end);
  const group = useRef<SVGGElement>(null);
  const ghost = useRef<SVGPathElement>(null);
  const sway = useRef<Sway | null>(null);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- the spring writes paths to the DOM between renders, and stops once settled
  useLayoutEffect(() => {
    const state = (sway.current ??= {
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      from: start,
      to: end,
      middle,
      frame: 0,
      at: 0,
    });
    const dx = middle.x - state.middle.x;
    const dy = middle.y - state.middle.y;
    state.from = start;
    state.to = end;
    state.middle = middle;
    const draw = (rest: boolean) => {
      const d = rest
        ? boardConnector(state.from, state.to).path
        : boardConnector(state.from, state.to, state).path;
      for (const line of group.current?.querySelectorAll("path") ?? []) line.setAttribute("d", d);
      ghost.current?.setAttribute("d", d);
    };
    const step = (now: number) => {
      const seconds = Math.min(0.032, (now - state.at) / 1000);
      state.at = now;
      state.vx += (-STIFFNESS * state.x - DAMPING * state.vx) * seconds;
      state.vy += (-STIFFNESS * state.y - DAMPING * state.vy) * seconds;
      state.x += state.vx * seconds;
      state.y += state.vy * seconds;
      const settled =
        Math.abs(state.x) + Math.abs(state.y) < SETTLED &&
        Math.abs(state.vx) + Math.abs(state.vy) < SETTLED * 20;
      if (settled) {
        state.x = state.y = state.vx = state.vy = 0;
        state.frame = 0;
        draw(true);
        return;
      }
      draw(false);
      state.frame = requestAnimationFrame(step);
    };
    if (dx !== 0 || dy !== 0) {
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false) return;
      state.x = limit(state.x - dx * LAG);
      state.y = limit(state.y - dy * LAG);
    }
    if (state.x === 0 && state.y === 0 && state.frame === 0) return;
    // React just wrote the resting path; put the swaying one back before paint.
    draw(false);
    if (state.frame === 0) {
      state.at = performance.now();
      state.frame = requestAnimationFrame(step);
    }
  });
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- a frame still pending must not outlive the line
  useLayoutEffect(
    () => () => {
      if (sway.current !== null) cancelAnimationFrame(sway.current.frame);
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
          strokeWidth="16"
          pointerEvents="stroke"
          data-board-edge={id}
          className="cursor-pointer"
          onPointerDown={stopPointer}
          onClick={onSelect}
        />
      ) : null}
      <path
        d={path}
        fill="none"
        stroke="var(--color-background)"
        strokeWidth={width + 3}
        strokeLinecap="round"
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={width}
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
              strokeWidth={width}
              strokeLinecap="round"
              strokeDasharray="2 7"
            />,
            over,
          )}
    </g>
  );
}
