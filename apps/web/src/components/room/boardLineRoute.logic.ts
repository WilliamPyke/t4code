import {
  type BoardBox,
  type BoardLineEnds,
  type BoardPoint,
  boardConnector,
  boardLineEnds,
} from "./roomBoard.logic";

// How far an elbow line runs square to its side before it may turn.
const ELBOW_STUB = 24;
const ELBOW_RADIUS = 8;
// Room an elbow line keeps from the cards it passes.
const ROUTE_CLEAR = 16;
// What one more corner costs, in pixels of length: a longer way with fewer corners wins.
const ROUTE_BEND = 48;
// Cards further than this from both ends' boxes are never in a line's way.
const ROUTE_REACH = 96;
// The most cards one line goes around; the search grows with the square of them.
const ROUTE_MAX_OBSTACLES = 16;

const DIRS: ReadonlyArray<BoardPoint> = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];
const dirOf = (way: BoardPoint) => DIRS.findIndex((dir) => dir.x === way.x && dir.y === way.y);
const round = (value: number) => Math.round(value * 10) / 10;
const grow = (box: BoardBox, by: number): BoardBox => ({
  x: box.x - by,
  y: box.y - by,
  width: box.width + by * 2,
  height: box.height + by * 2,
});
const holds = (box: BoardBox, point: BoardPoint) =>
  point.x > box.x && point.x < box.x + box.width && point.y > box.y && point.y < box.y + box.height;
const crosses = (box: BoardBox, a: BoardPoint, b: BoardPoint) =>
  Math.max(a.x, b.x) > box.x &&
  Math.min(a.x, b.x) < box.x + box.width &&
  Math.max(a.y, b.y) > box.y &&
  Math.min(a.y, b.y) < box.y + box.height;
const sorted = (values: ReadonlyArray<number>) =>
  [...new Set(values.map(round))].sort((a, b) => a - b);
const span = (a: BoardPoint, b: BoardPoint) => Math.abs(b.x - a.x) + Math.abs(b.y - a.y);

type Heap = Array<readonly [cost: number, state: number]>;

function heapPush(heap: Heap, cost: number, state: number) {
  let at = heap.length;
  heap.push([cost, state]);
  while (at > 0) {
    const up = (at - 1) >> 1;
    const above = heap[up]!;
    if (above[0] <= cost) break;
    heap[up] = heap[at]!;
    heap[at] = above;
    at = up;
  }
}

function heapPop(heap: Heap) {
  const top = heap[0];
  const last = heap.pop();
  if (last === undefined || heap.length === 0) return top;
  heap[0] = last;
  let at = 0;
  for (;;) {
    const left = at * 2 + 1;
    const right = left + 1;
    let least = at;
    if (left < heap.length && heap[left]![0] < heap[least]![0]) least = left;
    if (right < heap.length && heap[right]![0] < heap[least]![0]) least = right;
    if (least === at) break;
    const moved = heap[least]!;
    heap[least] = heap[at]!;
    heap[at] = moved;
    at = least;
  }
  return top;
}

/**
 * The corners of the cheapest right-angled way from `a`, leaving the way `out` points, to `b`,
 * arriving against `into`, that crosses none of `blocks`, or null when there is none. It runs
 * only along lines through the two points, halfway between them, and just outside each block.
 */
function orthogonalRoute(
  a: BoardPoint,
  out: BoardPoint,
  b: BoardPoint,
  into: BoardPoint,
  blocks: ReadonlyArray<BoardBox>,
): Array<BoardPoint> | null {
  const mid = { x: round((a.x + b.x) / 2), y: round((a.y + b.y) / 2) };
  const xs = sorted([
    a.x,
    b.x,
    mid.x,
    ...blocks.flatMap((box) => [box.x - 1, box.x + box.width + 1]),
  ]);
  const ys = sorted([
    a.y,
    b.y,
    mid.y,
    ...blocks.flatMap((box) => [box.y - 1, box.y + box.height + 1]),
  ]);
  const nx = xs.length;
  const at = (node: number): BoardPoint => ({
    x: xs[node % nx] ?? 0,
    y: ys[Math.floor(node / nx)] ?? 0,
  });
  const nodeOf = (point: BoardPoint) =>
    ys.indexOf(round(point.y)) * nx + xs.indexOf(round(point.x));
  const goal = nodeOf(b);
  const arrive = dirOf({ x: -into.x, y: -into.y });
  // A state is a grid point and the way the line reached it; `done` is the end, arrived square.
  const done = nx * ys.length * 4;
  const cost = new Float64Array(done + 1).fill(Infinity);
  const came = new Int32Array(done + 1).fill(-1);
  const heap: Heap = [];
  const first = nodeOf(a) * 4 + dirOf(out);
  cost[first] = 0;
  heapPush(heap, 0, first);
  for (let next = heapPop(heap); next !== undefined; next = heapPop(heap)) {
    const [spent, state] = next;
    if (spent > cost[state]!) continue;
    if (state === done) break;
    const node = state >> 2;
    const dir = state & 3;
    const here = at(node);
    const reach = (to: number, total: number) => {
      if (total >= cost[to]!) return;
      cost[to] = total;
      came[to] = state;
      heapPush(heap, total, to);
    };
    if (node === goal && dir !== (arrive + 2) % 4) {
      reach(done, spent + (dir === arrive ? 0 : ROUTE_BEND));
    }
    for (const [turn, way] of DIRS.entries()) {
      if (turn === (dir + 2) % 4) continue;
      const column = (node % nx) + way.x;
      const row = Math.floor(node / nx) + way.y;
      if (column < 0 || row < 0 || column >= nx || row >= ys.length) continue;
      const there = at(row * nx + column);
      if (blocks.some((box) => crosses(box, here, there))) continue;
      // Of equal ways, the one that turns halfway between the ends.
      const central = way.y === 0 ? here.y === mid.y : here.x === mid.x;
      reach(
        (row * nx + column) * 4 + turn,
        spent + span(here, there) * (central ? 0.98 : 1) + (turn === dir ? 0 : ROUTE_BEND),
      );
    }
  }
  if (cost[done] === Infinity) return null;
  const points: Array<BoardPoint> = [];
  for (let state = came[done]!; state !== -1; state = came[state]!) points.unshift(at(state >> 2));
  return points;
}

/** `points` without the ones that repeat or lie on a straight run. */
function corners(points: ReadonlyArray<BoardPoint>): Array<BoardPoint> {
  const kept: Array<BoardPoint> = [];
  for (const point of points) {
    const last = kept.at(-1);
    if (last !== undefined && last.x === point.x && last.y === point.y) continue;
    const before = kept.at(-2);
    const straight =
      before !== undefined &&
      last !== undefined &&
      ((before.x === last.x && last.x === point.x) || (before.y === last.y && last.y === point.y));
    if (straight) kept.pop();
    kept.push(point);
  }
  return kept;
}

function roundedPath(points: ReadonlyArray<BoardPoint>): string {
  const at = (point: BoardPoint) => `${round(point.x)} ${round(point.y)}`;
  return points
    .map((corner, index) => {
      const before = points[index - 1];
      const after = points[index + 1];
      if (before === undefined) return `M${at(corner)}`;
      if (after === undefined) return `L${at(corner)}`;
      const into = span(before, corner);
      const away = span(corner, after);
      const radius = Math.min(ELBOW_RADIUS, into / 2, away / 2);
      const enter = {
        x: corner.x - ((corner.x - before.x) / into) * radius,
        y: corner.y - ((corner.y - before.y) / into) * radius,
      };
      const leave = {
        x: corner.x + ((after.x - corner.x) / away) * radius,
        y: corner.y + ((after.y - corner.y) / away) * radius,
      };
      return `L${at(enter)} Q${at(corner)} ${at(leave)}`;
    })
    .join(" ");
}

function halfway(points: ReadonlyArray<BoardPoint>): BoardPoint {
  let left = points.reduce((sum, point, index) => sum + span(points[index - 1] ?? point, point), 0);
  left /= 2;
  for (const [index, point] of points.entries()) {
    const before = points[index - 1];
    if (before === undefined) continue;
    const length = span(before, point);
    if (length > 0 && left <= length) {
      const t = left / length;
      return { x: before.x + (point.x - before.x) * t, y: before.y + (point.y - before.y) * t };
    }
    left -= length;
  }
  return points[0] ?? { x: 0, y: 0 };
}

/** The cards near enough to a line between two boxes to be in its way, in the order given. */
export function boardLineObstaclesNear<Box extends BoardBox>(
  from: BoardBox,
  to: BoardBox,
  obstacles: ReadonlyArray<Box>,
): Array<Box> {
  const left = Math.min(from.x, to.x) - ROUTE_REACH;
  const top = Math.min(from.y, to.y) - ROUTE_REACH;
  const right = Math.max(from.x + from.width, to.x + to.width) + ROUTE_REACH;
  const bottom = Math.max(from.y + from.height, to.y + to.height) + ROUTE_REACH;
  return obstacles.filter(
    (box) =>
      box.x < right && box.x + box.width > left && box.y < bottom && box.y + box.height > top,
  );
}

/**
 * A line of straight runs and rounded corners from one box's side to another's, leaving and
 * arriving square to them, and the point halfway along it. It keeps clear of its own two boxes,
 * and where that way would cross one of `obstacles` (the other cards, never its own ends) it goes
 * around them: the nearest few when there are many, and the plain way when there is no way round.
 */
function boardElbow(
  from: BoardBox,
  to: BoardBox,
  ends?: BoardLineEnds,
  obstacles: ReadonlyArray<BoardBox> = [],
): { readonly path: string; readonly middle: BoardPoint } {
  const { start, end, out, into } = boardLineEnds(from, to, ends);
  // Each end runs square to its side first: less far when the other end is closer than that.
  const stub = (way: BoardPoint, sign: number) => {
    const ahead = ((end.x - start.x) * way.x + (end.y - start.y) * way.y) * sign;
    return ahead > 0 ? Math.min(ELBOW_STUB, ahead / 2) : ELBOW_STUB;
  };
  const leave = stub(out, 1);
  const arrive = stub(into, -1);
  const a = { x: round(start.x + out.x * leave), y: round(start.y + out.y * leave) };
  const b = { x: round(end.x + into.x * arrive), y: round(end.y + into.y * arrive) };
  // Its own boxes with room around them, unless they sit too close together for that.
  const own = [from, to].map((box) => {
    const roomy = grow(box, ROUTE_CLEAR - 1);
    return holds(roomy, a) || holds(roomy, b) ? grow(box, -1) : roomy;
  });
  const whole = (route: ReadonlyArray<BoardPoint>) => corners([start, ...route, end]);
  const plain = whole(
    orthogonalRoute(a, out, b, into, own) ?? [
      a,
      out.x === 0 ? { x: a.x, y: b.y } : { x: b.x, y: a.y },
      b,
    ],
  );
  const near = boardLineObstaclesNear(from, to, obstacles)
    .map((box) => grow(box, ROUTE_CLEAR - 1))
    .filter((box) => !holds(box, a) && !holds(box, b));
  const hit = (box: BoardBox) =>
    plain.some((point, index) => index > 0 && crosses(box, plain[index - 1] ?? point, point));
  const inWay = near.filter(hit);
  let points = plain;
  if (inWay.length > 0) {
    const centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const away = (box: BoardBox) =>
      span({ x: box.x + box.width / 2, y: box.y + box.height / 2 }, centre);
    const rest = near
      .filter((box) => !inWay.includes(box))
      .sort((one, other) => away(one) - away(other));
    const blocks = [...inWay, ...rest].slice(0, ROUTE_MAX_OBSTACLES);
    const around = orthogonalRoute(a, out, b, into, [...own, ...blocks]);
    if (around !== null) points = whole(around);
  }
  return { path: roundedPath(points), middle: halfway(points) };
}

/** A line's shape as an edge keeps it: absent is a curve. */
export type BoardLineShape = "curve" | "elbow";

/** A line drawn as its shape asks. Only an elbow minds the `obstacles`. */
export function boardLine(
  shape: BoardLineShape,
  from: BoardBox,
  to: BoardBox,
  ends?: BoardLineEnds,
  obstacles?: ReadonlyArray<BoardBox>,
) {
  return shape === "elbow"
    ? boardElbow(from, to, ends, obstacles)
    : boardConnector(from, to, undefined, ends);
}
