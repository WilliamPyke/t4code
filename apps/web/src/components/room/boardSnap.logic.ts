import { SECTION_INSET } from "./boardPlan.logic";
import type { BoardRect } from "./roomBoard.logic";

/** How near an edge or middle must come to another's to snap to it, in screen pixels. */
export const BOARD_SNAP_SCREEN_PX = 6;
/** The most cards one drag snaps to: the nearest to where it began. */
const BOARD_SNAP_MAX_TARGETS = 64;

/** What a drag may snap to, gathered once as it starts. */
export interface BoardSnapTargets {
  readonly rects: ReadonlyArray<BoardRect>;
  /** Sections among them: a card whose middle is over one also snaps to its inner padding. */
  readonly sections: ReadonlyArray<BoardRect>;
}

/** A line through matched edges: on axis `x` it is upright at x = `at`, from y `from` to `to`. */
export interface BoardSnapGuide {
  readonly axis: "x" | "y";
  readonly at: number;
  readonly from: number;
  readonly to: number;
}

/**
 * A short measure across an equal gap, or along an equal size: on axis `x` it runs from x `from`
 * to `to` at y = `at`.
 */
export interface BoardSnapMark {
  readonly axis: "x" | "y";
  readonly from: number;
  readonly to: number;
  readonly at: number;
}

export interface BoardSnapDrawn {
  readonly guides: ReadonlyArray<BoardSnapGuide>;
  readonly marks: ReadonlyArray<BoardSnapMark>;
}

export const NO_SNAP_DRAWN: BoardSnapDrawn = { guides: [], marks: [] };

type Axis = "x" | "y";

const lo = (rect: BoardRect, axis: Axis) => (axis === "x" ? rect.x : rect.y);
const len = (rect: BoardRect, axis: Axis) => (axis === "x" ? rect.width : rect.height);
const hi = (rect: BoardRect, axis: Axis) => lo(rect, axis) + len(rect, axis);
const mid = (rect: BoardRect, axis: Axis) => lo(rect, axis) + len(rect, axis) / 2;
const across = (axis: Axis): Axis => (axis === "x" ? "y" : "x");
const lines = (rect: BoardRect, axis: Axis) => [lo(rect, axis), mid(rect, axis), hi(rect, axis)];
const shifted = (rect: BoardRect, axis: Axis, by: number): BoardRect =>
  axis === "x" ? { ...rect, x: rect.x + by } : { ...rect, y: rect.y + by };
/** Lines closer than this are drawn as one: snapped edges meet exactly, rounding aside. */
const SAME = 0.5;
/** The smallest gap equal spacing keeps: cards touching are aligned edges instead. */
const MIN_GAP = 1;

const overlapsAcross = (a: BoardRect, b: BoardRect, axis: Axis) => {
  const other = across(axis);
  return lo(a, other) < hi(b, other) && hi(a, other) > lo(b, other);
};
const contains = (outer: BoardRect, x: number, y: number) =>
  x >= outer.x && x <= outer.x + outer.width && y >= outer.y && y <= outer.y + outer.height;
/** The sections `box`'s middle is over, whose padding it snaps to. */
const sectionsUnder = (box: BoardRect, sections: ReadonlyArray<BoardRect>) =>
  sections.filter((section) => contains(section, mid(box, "x"), mid(box, "y")));
/** A section's inner padding on an axis: where its first card starts and its last ends. */
const insetOf = (section: BoardRect, axis: Axis) => ({
  start: lo(section, axis) + (axis === "x" ? SECTION_INSET.x : SECTION_INSET.y),
  end: hi(section, axis) - SECTION_INSET.x,
});

/**
 * The cards a drag starting from `box` snaps to: those in sight (`visible`), nearest first, at
 * most `max`. Whoever calls leaves out what is dragged and what others drag now.
 */
export function boardSnapTargets(
  items: ReadonlyArray<{ readonly rect: BoardRect; readonly section: boolean }>,
  box: BoardRect,
  visible: BoardRect,
  max = BOARD_SNAP_MAX_TARGETS,
): BoardSnapTargets {
  const distance = (rect: BoardRect) =>
    Math.hypot(mid(rect, "x") - mid(box, "x"), mid(rect, "y") - mid(box, "y"));
  const near = items
    .filter(
      ({ rect }) =>
        rect.x < visible.x + visible.width &&
        rect.x + rect.width > visible.x &&
        rect.y < visible.y + visible.height &&
        rect.y + rect.height > visible.y,
    )
    .map((item) => ({ ...item, distance: distance(item.rect) }))
    .toSorted((a, b) => a.distance - b.distance)
    .slice(0, max);
  return {
    rects: near.map(({ rect }) => rect),
    sections: near.flatMap(({ rect, section }) => (section ? [rect] : [])),
  };
}

/** The bounding box of several rects, or null for none. */
export function boardRectsBounds(rects: ReadonlyArray<BoardRect>): BoardRect | null {
  if (rects.length === 0) return null;
  const x = Math.min(...rects.map((rect) => rect.x));
  const y = Math.min(...rects.map((rect) => rect.y));
  return {
    x,
    y,
    width: Math.max(...rects.map((rect) => rect.x + rect.width)) - x,
    height: Math.max(...rects.map((rect) => rect.y + rect.height)) - y,
  };
}

/** The nearest card before and after `box` on an axis among those level with it, and the next ones out. */
function neighbours(box: BoardRect, rects: ReadonlyArray<BoardRect>, axis: Axis) {
  const row = rects.filter((rect) => overlapsAcross(rect, box, axis));
  const nearestBefore = (edge: number) =>
    row
      .filter((rect) => hi(rect, axis) <= edge)
      .reduce<BoardRect | null>(
        (best, rect) => (best === null || hi(rect, axis) > hi(best, axis) ? rect : best),
        null,
      );
  const nearestAfter = (edge: number) =>
    row
      .filter((rect) => lo(rect, axis) >= edge)
      .reduce<BoardRect | null>(
        (best, rect) => (best === null || lo(rect, axis) < lo(best, axis) ? rect : best),
        null,
      );
  const before = nearestBefore(lo(box, axis));
  const after = nearestAfter(hi(box, axis));
  return {
    before,
    after,
    beforeThat: before === null ? null : nearestBefore(lo(before, axis)),
    afterThat: after === null ? null : nearestAfter(hi(after, axis)),
  };
}

/** How far `box` moves on an axis to snap, or null when nothing is within `threshold`. */
function snapAxis(
  box: BoardRect,
  targets: BoardSnapTargets,
  axis: Axis,
  threshold: number,
): number | null {
  let best: number | null = null;
  const consider = (shift: number) => {
    if (Math.abs(shift) <= threshold && (best === null || Math.abs(shift) < Math.abs(best))) {
      best = shift;
    }
  };
  const own = lines(box, axis);
  for (const rect of targets.rects) {
    for (const line of lines(rect, axis)) for (const edge of own) consider(line - edge);
  }
  for (const section of sectionsUnder(box, targets.sections)) {
    const inset = insetOf(section, axis);
    consider(inset.start - lo(box, axis));
    consider(inset.end - hi(box, axis));
  }
  const { before, after, beforeThat, afterThat } = neighbours(box, targets.rects, axis);
  const size = len(box, axis);
  if (before !== null && after !== null) {
    const gap = (lo(after, axis) - hi(before, axis) - size) / 2;
    if (gap >= MIN_GAP) consider(hi(before, axis) + gap - lo(box, axis));
  }
  if (before !== null && beforeThat !== null) {
    const gap = lo(before, axis) - hi(beforeThat, axis);
    if (gap >= MIN_GAP) consider(hi(before, axis) + gap - lo(box, axis));
  }
  if (after !== null && afterThat !== null) {
    const gap = lo(afterThat, axis) - hi(after, axis);
    if (gap >= MIN_GAP) consider(lo(after, axis) - gap - hi(box, axis));
  }
  return best;
}

/** Guides through every edge or middle of `box` that lies on one of the targets'. */
function guidesFor(
  box: BoardRect,
  targets: BoardSnapTargets,
  axis: Axis,
  only?: ReadonlyArray<number>,
): Array<BoardSnapGuide> {
  const other = across(axis);
  const byLine = new Map<number, BoardSnapGuide>();
  const extend = (at: number, rect: BoardRect) => {
    const known = byLine.get(at);
    byLine.set(at, {
      axis,
      at,
      from: Math.min(known?.from ?? lo(box, other), lo(rect, other)),
      to: Math.max(known?.to ?? hi(box, other), hi(rect, other)),
    });
  };
  const own = only ?? lines(box, axis);
  for (const rect of targets.rects) {
    for (const line of lines(rect, axis)) {
      for (const edge of own) if (Math.abs(line - edge) < SAME) extend(edge, rect);
    }
  }
  for (const section of sectionsUnder(box, targets.sections)) {
    const inset = insetOf(section, axis);
    for (const [line, edge] of [
      [inset.start, lo(box, axis)],
      [inset.end, hi(box, axis)],
    ] as const) {
      if (own.includes(edge) && Math.abs(line - edge) < SAME) extend(edge, section);
    }
  }
  return [...byLine.values()];
}

/** A mark across the gap between two rects on an axis, level with where both are. */
const gapMark = (first: BoardRect, second: BoardRect, axis: Axis): BoardSnapMark => {
  const other = across(axis);
  const top = Math.max(lo(first, other), lo(second, other));
  const bottom = Math.min(hi(first, other), hi(second, other));
  return {
    axis,
    from: hi(first, axis),
    to: lo(second, axis),
    at: bottom > top ? (top + bottom) / 2 : (mid(first, other) + mid(second, other)) / 2,
  };
};

/** Marks on the gaps beside `box` that equal each other, as equal spacing shows them. */
function gapMarksFor(box: BoardRect, targets: BoardSnapTargets, axis: Axis): Array<BoardSnapMark> {
  const { before, after, beforeThat, afterThat } = neighbours(box, targets.rects, axis);
  const gap = (first: BoardRect, second: BoardRect) => lo(second, axis) - hi(first, axis);
  const equal = (a: number, b: number) => a >= MIN_GAP && Math.abs(a - b) < SAME;
  const marks: Array<BoardSnapMark> = [];
  const add = (first: BoardRect, second: BoardRect) => {
    if (!marks.some((mark) => mark.from === hi(first, axis) && mark.to === lo(second, axis))) {
      marks.push(gapMark(first, second, axis));
    }
  };
  if (before !== null && after !== null && equal(gap(before, box), gap(box, after))) {
    add(before, box);
    add(box, after);
  }
  if (before !== null && beforeThat !== null && equal(gap(before, box), gap(beforeThat, before))) {
    add(beforeThat, before);
    add(before, box);
  }
  if (after !== null && afterThat !== null && equal(gap(box, after), gap(after, afterThat))) {
    add(box, after);
    add(after, afterThat);
  }
  return marks;
}

/**
 * Where a dragged card or selection (`box`, where the pointer would put it) snaps: the shift on
 * each axis to the nearest edge, middle, section padding or equal gap within `threshold` board
 * pixels, and the guides and marks that show it.
 */
export function boardSnapMove(
  box: BoardRect,
  targets: BoardSnapTargets,
  threshold: number,
): BoardSnapDrawn & { readonly dx: number; readonly dy: number } {
  if (targets.rects.length === 0) return { dx: 0, dy: 0, ...NO_SNAP_DRAWN };
  const dx = snapAxis(box, targets, "x", threshold) ?? 0;
  const dy = snapAxis(box, targets, "y", threshold) ?? 0;
  const snapped = shifted(shifted(box, "x", dx), "y", dy);
  return {
    dx,
    dy,
    guides: [...guidesFor(snapped, targets, "x"), ...guidesFor(snapped, targets, "y")],
    marks: [...gapMarksFor(snapped, targets, "x"), ...gapMarksFor(snapped, targets, "y")],
  };
}

/** Which edge of a rect a resize moves on each axis, if any. */
export interface BoardSnapEdges {
  readonly x?: "start" | "end";
  readonly y?: "start" | "end";
}

/**
 * A card being resized (`rect`, where the pointer would make it) with its moving edges snapped to
 * the nearest edge, middle or section padding, or to the same width or height as a card near it,
 * within `threshold` board pixels; and the guides and marks that show it.
 */
export function boardSnapResize(
  rect: BoardRect,
  edges: BoardSnapEdges,
  targets: BoardSnapTargets,
  threshold: number,
): BoardSnapDrawn & { readonly rect: BoardRect } {
  let next = rect;
  const guides: Array<BoardSnapGuide> = [];
  const marks: Array<BoardSnapMark> = [];
  for (const axis of ["x", "y"] as const) {
    const side = edges[axis];
    if (side === undefined) continue;
    const edge = side === "start" ? lo(next, axis) : hi(next, axis);
    let best: number | null = null;
    const consider = (shift: number) => {
      if (Math.abs(shift) <= threshold && (best === null || Math.abs(shift) < Math.abs(best))) {
        best = shift;
      }
    };
    for (const target of targets.rects) {
      for (const line of lines(target, axis)) consider(line - edge);
      // The same size: the moving edge goes as far as makes it so.
      const grow = len(target, axis) - len(next, axis);
      consider(side === "start" ? -grow : grow);
    }
    for (const section of sectionsUnder(next, targets.sections)) {
      const inset = insetOf(section, axis);
      consider((side === "start" ? inset.start : inset.end) - edge);
    }
    const shift: number = best ?? 0;
    next =
      side === "start"
        ? axis === "x"
          ? { ...next, x: next.x + shift, width: next.width - shift }
          : { ...next, y: next.y + shift, height: next.height - shift }
        : axis === "x"
          ? { ...next, width: next.width + shift }
          : { ...next, height: next.height + shift };
  }
  for (const axis of ["x", "y"] as const) {
    const side = edges[axis];
    if (side === undefined) continue;
    guides.push(
      ...guidesFor(next, targets, axis, [side === "start" ? lo(next, axis) : hi(next, axis)]),
    );
    // One card the same size, the nearest, marked beside both.
    const other = across(axis);
    const same = targets.rects
      .filter((target) => Math.abs(len(target, axis) - len(next, axis)) < SAME)
      .reduce<BoardRect | null>(
        (best, target) =>
          best === null ||
          Math.hypot(mid(target, "x") - mid(next, "x"), mid(target, "y") - mid(next, "y")) <
            Math.hypot(mid(best, "x") - mid(next, "x"), mid(best, "y") - mid(next, "y"))
            ? target
            : best,
        null,
      );
    if (same === null) continue;
    for (const sized of [next, same]) {
      marks.push({
        axis,
        from: lo(sized, axis),
        to: hi(sized, axis),
        at: hi(sized, other) + threshold,
      });
    }
  }
  return { rect: next, guides, marks };
}

const sameGuide = (a: BoardSnapGuide, b: BoardSnapGuide) =>
  a.axis === b.axis && a.at === b.at && a.from === b.from && a.to === b.to;
const sameMark = (a: BoardSnapMark, b: BoardSnapMark) =>
  a.axis === b.axis && a.at === b.at && a.from === b.from && a.to === b.to;

/** Whether two sets of guides draw the same, so a drag that keeps its snap draws nothing again. */
export const sameSnapDrawn = (a: BoardSnapDrawn, b: BoardSnapDrawn) =>
  a.guides.length === b.guides.length &&
  a.marks.length === b.marks.length &&
  a.guides.every((guide, index) => sameGuide(guide, b.guides[index]!)) &&
  a.marks.every((mark, index) => sameMark(mark, b.marks[index]!));
