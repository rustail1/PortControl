import type { Point } from '../camera/SquareWorldViewport.ts';

export interface SimplifyConfig {
  readonly simplifyEpsilon: number;
  readonly maxSimplifiedPoints: number;
}

const CORNER_MIN_TURN_RAD = Math.PI / 18;
const HAIRPIN_TURN_RAD = (5 * Math.PI) / 6;
const CORNER_TRIM_FRACTION = 0.32;
const MAX_CORNER_TRIM = 24;
const HAIRPIN_WIDTH_FRACTION = 0.6;
const POINT_EPSILON = 1e-9;

function distance(point: Point, start: Point, end: Point): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy),
  ));
  return Math.hypot(point.x - start.x - dx * t, point.y - start.y - dy * t);
}

function rdp(points: readonly Point[], epsilon: number): readonly Point[] {
  if (points.length <= 2) return points;
  const start = points[0]!;
  const end = points.at(-1)!;
  let index = 0;
  let max = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const value = distance(points[i]!, start, end);
    if (value > max) {
      max = value;
      index = i;
    }
  }
  if (max <= epsilon) return [start, end];
  return [
    ...rdp(points.slice(0, index + 1), epsilon),
    ...rdp(points.slice(index), epsilon).slice(1),
  ];
}

function nextUp(value: number): number {
  if (!Number.isFinite(value)) return value;
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value);
  let bits = view.getBigUint64(0);
  bits += value >= 0 ? 1n : -1n;
  view.setBigUint64(0, bits);
  return view.getFloat64(0);
}

export function simplifyRoute(
  points: readonly Point[],
  config: SimplifyConfig,
): readonly Point[] {
  if (points.length <= 1) {
    return Object.freeze(points.map((point) => Object.freeze({ ...point })));
  }
  const base = rdp(points, config.simplifyEpsilon);
  if (base.length <= config.maxSimplifiedPoints) {
    return Object.freeze(base.map((point) => Object.freeze({ ...point })));
  }
  let high = 0;
  for (const left of points) {
    for (const right of points) {
      high = Math.max(high, Math.hypot(left.x - right.x, left.y - right.y));
    }
  }
  let low = config.simplifyEpsilon;
  high = Math.max(high, low);
  while (nextUp(low) < high) {
    const middle = low + (high - low) / 2;
    if (rdp(points, middle).length <= config.maxSimplifiedPoints) high = middle;
    else low = middle;
  }
  return Object.freeze(rdp(points, high).map((point) => Object.freeze({ ...point })));
}

export function simplifyRouteDraft(
  draft: { readonly points: readonly Point[]; readonly start?: Point; readonly tip?: Point },
  config: SimplifyConfig,
): readonly Point[] {
  if (draft.start === undefined) return simplifyRoute(draft.points, config);
  const points = draft.points;
  if (points.length === 0) {
    return Object.freeze(draft.tip === undefined ? [] : [Object.freeze({ ...draft.tip })]);
  }
  // Forward-only simplification: extending the live tail cannot relocate fixed bends.
  // The origin participates so a straight swipe never gains a false first corner.
  const fixed: Point[] = [];
  let anchor = draft.start;
  let pendingStart = 0;
  for (let end = 1; end < points.length; end += 1) {
    if (fixed.length >= config.maxSimplifiedPoints - 1) break;
    for (let index = pendingStart; index < end; index += 1) {
      if (distance(points[index]!, anchor, points[end]!) > config.simplifyEpsilon) {
        anchor = points[end - 1]!;
        fixed.push(anchor);
        pendingStart = end;
        break;
      }
    }
  }
  // At the point cap only the endpoint changes; preview and commit validate this connector.
  return Object.freeze([...fixed, draft.tip ?? points.at(-1)!]
    .map((point) => Object.freeze({ ...point })));
}

function stableControls(
  start: Point,
  points: readonly Point[],
  epsilon: number,
): readonly Point[] {
  if (points.length === 0) return [start];
  const raw = [start, ...points];
  if (raw.length <= 2) return raw;
  const controls: Point[] = [start];
  for (let index = 1; index < raw.length - 1; index += 1) {
    const previous = controls.at(-1)!;
    const current = raw[index]!;
    const next = raw[index + 1]!;
    const incoming = { x: current.x - previous.x, y: current.y - previous.y };
    const outgoing = { x: next.x - current.x, y: next.y - current.y };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (incomingLength <= POINT_EPSILON || outgoingLength <= POINT_EPSILON) continue;
    const dot = incoming.x * outgoing.x + incoming.y * outgoing.y;
    if (dot >= 0 && distance(current, previous, next) <= epsilon) continue;
    controls.push(current);
  }
  controls.push(raw.at(-1)!);
  return controls;
}

function pushDistinct(target: Point[], point: Point): void {
  const previous = target.at(-1);
  if (previous !== undefined &&
      Math.hypot(point.x - previous.x, point.y - previous.y) <= POINT_EPSILON) return;
  target.push({ x: point.x, y: point.y });
}

function quadratic(a: Point, control: Point, b: Point, t: number): Point {
  const oneMinus = 1 - t;
  return {
    x: oneMinus * oneMinus * a.x + 2 * oneMinus * t * control.x + t * t * b.x,
    y: oneMinus * oneMinus * a.y + 2 * oneMinus * t * control.y + t * t * b.y,
  };
}

function cubic(a: Point, c1: Point, c2: Point, b: Point, t: number): Point {
  const oneMinus = 1 - t;
  return {
    x: oneMinus ** 3 * a.x + 3 * oneMinus ** 2 * t * c1.x +
      3 * oneMinus * t * t * c2.x + t ** 3 * b.x,
    y: oneMinus ** 3 * a.y + 3 * oneMinus ** 2 * t * c1.y +
      3 * oneMinus * t * t * c2.y + t ** 3 * b.y,
  };
}

/**
 * Produces the single canonical route geometry used by validation, rendering and movement.
 * Decisions for a sealed corner depend only on its immediate neighbours, so extending the
 * live tail cannot make an earlier corner breathe. Ordinary corners stay inside their local
 * convex hull; near-reversals use a deterministic compact hairpin instead of a raw cusp.
 */
export function canonicalizeRoute(
  start: Point,
  points: readonly Point[],
  config: SimplifyConfig,
): readonly Point[] {
  const controls = stableControls(start, points, config.simplifyEpsilon);
  if (controls.length <= 1) return Object.freeze([]);
  if (controls.length === 2) {
    return Object.freeze([Object.freeze({ ...controls[1]! })]);
  }

  const output: Point[] = [];
  for (let index = 1; index < controls.length - 1; index += 1) {
    const previous = controls[index - 1]!;
    const corner = controls[index]!;
    const next = controls[index + 1]!;
    const incoming = { x: corner.x - previous.x, y: corner.y - previous.y };
    const outgoing = { x: next.x - corner.x, y: next.y - corner.y };
    const incomingLength = Math.hypot(incoming.x, incoming.y);
    const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
    if (incomingLength <= POINT_EPSILON || outgoingLength <= POINT_EPSILON) {
      pushDistinct(output, corner);
      continue;
    }

    const incomingUnit = { x: incoming.x / incomingLength, y: incoming.y / incomingLength };
    const outgoingUnit = { x: outgoing.x / outgoingLength, y: outgoing.y / outgoingLength };
    const dot = Math.max(-1, Math.min(1,
      incomingUnit.x * outgoingUnit.x + incomingUnit.y * outgoingUnit.y,
    ));
    const turn = Math.acos(dot);
    if (turn < CORNER_MIN_TURN_RAD) {
      pushDistinct(output, corner);
      continue;
    }

    const trim = Math.min(
      MAX_CORNER_TRIM,
      incomingLength * CORNER_TRIM_FRACTION,
      outgoingLength * CORNER_TRIM_FRACTION,
    );
    const entry = {
      x: corner.x - incomingUnit.x * trim,
      y: corner.y - incomingUnit.y * trim,
    };
    pushDistinct(output, entry);

    if (turn < HAIRPIN_TURN_RAD) {
      const exit = {
        x: corner.x + outgoingUnit.x * trim,
        y: corner.y + outgoingUnit.y * trim,
      };
      for (const t of [0.25, 0.5, 0.75, 1]) {
        pushDistinct(output, quadratic(entry, corner, exit, t));
      }
      continue;
    }

    const cross = incomingUnit.x * outgoingUnit.y - incomingUnit.y * outgoingUnit.x;
    const side = cross < 0 ? -1 : 1;
    const normal = { x: -incomingUnit.y * side, y: incomingUnit.x * side };
    const width = trim * HAIRPIN_WIDTH_FRACTION;
    const exitBase = {
      x: corner.x + outgoingUnit.x * trim,
      y: corner.y + outgoingUnit.y * trim,
    };
    const exitOffset = {
      x: exitBase.x + normal.x * width,
      y: exitBase.y + normal.y * width,
    };
    const turnControl = {
      x: corner.x + normal.x * width,
      y: corner.y + normal.y * width,
    };
    for (const t of [0.25, 0.5, 0.75, 1]) {
      pushDistinct(output, cubic(entry, corner, turnControl, exitOffset, t));
    }

    const mergeDistance = Math.min(outgoingLength * 0.66, trim * 2);
    const merge = {
      x: corner.x + outgoingUnit.x * mergeDistance,
      y: corner.y + outgoingUnit.y * mergeDistance,
    };
    const mergeControlDistance = Math.min(trim * 0.5, mergeDistance * 0.25);
    const mergeControl1 = {
      x: exitOffset.x + outgoingUnit.x * mergeControlDistance,
      y: exitOffset.y + outgoingUnit.y * mergeControlDistance,
    };
    const mergeControl2 = {
      x: merge.x - outgoingUnit.x * mergeControlDistance,
      y: merge.y - outgoingUnit.y * mergeControlDistance,
    };
    for (const t of [1 / 3, 2 / 3, 1]) {
      pushDistinct(output, cubic(exitOffset, mergeControl1, mergeControl2, merge, t));
    }
  }

  pushDistinct(output, controls.at(-1)!);
  return Object.freeze(output.map((point) => Object.freeze({ ...point })));
}
