import type { Point } from '../camera/SquareWorldViewport.ts';

const POINT_EPSILON = 1e-9;

/**
 * Produces the canonical route geometry used by validation, rendering and movement.
 *
 * Authored geometry is immutable: canonicalization must never smooth, round, offset,
 * interpolate or replace a committed corner. The only normalization performed here
 * is removing consecutive duplicate samples so zero-length segments do not enter the
 * navigation pipeline.
 */
export function canonicalizeRoute(
  start: Point,
  points: readonly Point[],
): readonly Point[] {
  const output: Point[] = [];
  let previous = start;

  for (const point of points) {
    if (Math.hypot(point.x - previous.x, point.y - previous.y) <= POINT_EPSILON) continue;
    const canonical = Object.freeze({ x: point.x, y: point.y });
    output.push(canonical);
    previous = point;
  }

  return Object.freeze(output);
}

export class RouteCanonicalizer {
  public canonicalize(start: Point, points: readonly Point[]): readonly Point[] {
    return canonicalizeRoute(start, points);
  }
}
