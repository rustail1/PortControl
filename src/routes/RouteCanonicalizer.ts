import type { Point } from '../camera/SquareWorldViewport.ts';
import type { SimplifyConfig } from './RouteSimplifier.ts';

const CORNER_MIN_TURN_RAD = Math.PI / 18;
const HAIRPIN_TURN_RAD = (5 * Math.PI) / 6;
const CORNER_TRIM_FRACTION = 0.32;
const MAX_CORNER_TRIM = 24;
const HAIRPIN_WIDTH_FRACTION = 0.6;
const POINT_EPSILON = 1e-9;

function stableControls(
  start: Point,
  points: readonly Point[],
): readonly Point[] {
  const controls: Point[] = [{ ...start }];
  for (const point of points) {
    const previous = controls.at(-1)!;
    if (Math.hypot(point.x - previous.x, point.y - previous.y) <= POINT_EPSILON) continue;
    controls.push({ ...point });
  }
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
 * Canonicalization never performs route simplification: authored/sample anchors are preserved
 * so validation can still return the exact safe prefix. Only duplicate points are removed.
 * Ordinary corners stay inside their local convex hull; near-reversals use a deterministic
 * compact hairpin instead of a raw cusp.
 */
export function canonicalizeRoute(
  start: Point,
  points: readonly Point[],
  config: SimplifyConfig,
): readonly Point[] {
  const controls = stableControls(start, points);
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

export class RouteCanonicalizer {
  readonly #config: SimplifyConfig;

  public constructor(config: SimplifyConfig) {
    this.#config = Object.freeze({ ...config });
  }

  public canonicalize(start: Point, points: readonly Point[]): readonly Point[] {
    return canonicalizeRoute(start, points, this.#config);
  }
}
