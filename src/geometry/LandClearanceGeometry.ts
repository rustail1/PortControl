import type { Point } from '../camera/SquareWorldViewport.ts';

export interface LandClearancePolygon {
  readonly points: readonly Point[];
}

interface ShorePolygonBlock {
  readonly blockType: 'shore_polygon';
  readonly enabled: boolean;
  readonly props: {
    readonly collision: boolean;
    readonly points: readonly (readonly [number, number])[];
  };
}

function isShorePolygonBlock(value: unknown): value is ShorePolygonBlock {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { readonly blockType?: unknown }).blockType === 'shore_polygon'
  );
}

function cross(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a: Point, b: Point, point: Point): boolean {
  return (
    Math.min(a.x, b.x) <= point.x &&
    point.x <= Math.max(a.x, b.x) &&
    Math.min(a.y, b.y) <= point.y &&
    point.y <= Math.max(a.y, b.y)
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const x1 = cross(a, b, c);
  const x2 = cross(a, b, d);
  const x3 = cross(c, d, a);
  const x4 = cross(c, d, b);
  return (
    (x1 === 0 && onSegment(a, b, c)) ||
    (x2 === 0 && onSegment(a, b, d)) ||
    (x3 === 0 && onSegment(c, d, a)) ||
    (x4 === 0 && onSegment(c, d, b)) ||
    ((x1 > 0) !== (x2 > 0) && (x3 > 0) !== (x4 > 0))
  );
}

function pointSegmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const denominator = dx * dx + dy * dy || 1;
  const t = Math.max(
    0,
    Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / denominator),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function pointInsidePolygon(point: Point, polygon: readonly Point[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const currentPoint = polygon[index];
    const previousPoint = polygon[previous];
    if (
      (currentPoint.y > point.y) !== (previousPoint.y > point.y) &&
      point.x <
        ((previousPoint.x - currentPoint.x) * (point.y - currentPoint.y)) /
          (previousPoint.y - currentPoint.y) +
          currentPoint.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function freezePolygon(polygon: LandClearancePolygon): LandClearancePolygon {
  return Object.freeze({
    points: Object.freeze(polygon.points.map((point) => Object.freeze({ ...point }))),
  });
}

export class LandClearanceGeometry {
  public readonly polygons: readonly LandClearancePolygon[];

  public constructor(polygons: readonly LandClearancePolygon[]) {
    this.polygons = Object.freeze(polygons.map(freezePolygon));
  }

  public blocksSegment(a: Point, b: Point, clearance: number): boolean {
    if (!Number.isFinite(clearance) || clearance < 0) {
      throw new RangeError('clearance must be a non-negative finite number');
    }
    return this.polygons.some(({ points }) => {
      if (pointInsidePolygon(a, points) || pointInsidePolygon(b, points)) {
        return true;
      }
      for (let index = 0; index < points.length; index += 1) {
        const c = points[index];
        const d = points[(index + 1) % points.length];
        if (
          segmentsIntersect(a, b, c, d) ||
          pointSegmentDistance(c, a, b) <= clearance ||
          pointSegmentDistance(d, a, b) <= clearance ||
          pointSegmentDistance(a, c, d) <= clearance ||
          pointSegmentDistance(b, c, d) <= clearance
        ) {
          return true;
        }
      }
      return false;
    });
  }
}

export function createLandClearanceGeometryFromLevel(
  level: Record<string, unknown>,
): LandClearanceGeometry {
  const layout = level['layout'] as { readonly blocks?: readonly unknown[] } | undefined;
  const blocks = Array.isArray(layout?.blocks) ? layout.blocks : [];
  const polygons = blocks
    .filter(isShorePolygonBlock)
    .filter((block) => block.enabled === true && block.props.collision === true)
    .map((block) => ({
      points: block.props.points.map(([x, y]) => ({ x, y })),
    }));
  return new LandClearanceGeometry(polygons);
}
