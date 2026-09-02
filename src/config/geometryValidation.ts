type Point = readonly [number, number];

const EPSILON = 1e-9;

function signedArea(points: readonly Point[]): number {
  return (
    points.reduce((area, point, index) => {
      const next = points[(index + 1) % points.length];
      if (next === undefined) {
        return area;
      }
      return area + point[0] * next[1] - next[0] * point[1];
    }, 0) / 2
  );
}

function orientation(a: Point, b: Point, c: Point): number {
  const value =
    (b[0] - a[0]) * (c[1] - a[1]) -
    (b[1] - a[1]) * (c[0] - a[0]);
  return Math.abs(value) < EPSILON ? 0 : Math.sign(value);
}

function pointOnSegment(a: Point, b: Point, c: Point): boolean {
  return (
    Math.min(a[0], c[0]) - EPSILON <= b[0] &&
    b[0] <= Math.max(a[0], c[0]) + EPSILON &&
    Math.min(a[1], c[1]) - EPSILON <= b[1] &&
    b[1] <= Math.max(a[1], c[1]) + EPSILON
  );
}

function segmentsIntersect(a: Point, b: Point, c: Point, d: Point): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) {
    return true;
  }

  return (
    (o1 === 0 && pointOnSegment(a, c, b)) ||
    (o2 === 0 && pointOnSegment(a, d, b)) ||
    (o3 === 0 && pointOnSegment(c, a, d)) ||
    (o4 === 0 && pointOnSegment(c, b, d))
  );
}

function selfIntersects(points: readonly Point[]): boolean {
  for (let first = 0; first < points.length; first += 1) {
    const a = points[first];
    const b = points[(first + 1) % points.length];
    if (a === undefined || b === undefined) {
      continue;
    }

    for (let second = first + 1; second < points.length; second += 1) {
      if (
        second === first ||
        second === (first + 1) % points.length ||
        (second + 1) % points.length === first ||
        (first === 0 && (second + 1) % points.length === 0)
      ) {
        continue;
      }

      const c = points[second];
      const d = points[(second + 1) % points.length];
      if (c !== undefined && d !== undefined && segmentsIntersect(a, b, c, d)) {
        return true;
      }
    }
  }

  return false;
}

export function validatePolygon(
  label: string,
  x: number,
  y: number,
  points: readonly Point[],
): string[] {
  const issues: string[] = [];
  const uniquePoints = new Set(points.map((point) => `${point[0]}\u0000${point[1]}`));

  if (uniquePoints.size !== points.length) {
    issues.push(`${label}: duplicate polygon vertex`);
  }
  if (signedArea(points) <= 0) {
    issues.push(`${label}: polygon must be visual-clockwise`);
  }
  if (selfIntersects(points)) {
    issues.push(`${label}: self-intersecting polygon`);
  }

  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const centerX = (Math.min(...xs) + Math.max(...xs)) / 2;
  const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
  if (Math.abs(x - centerX) > 1e-6 || Math.abs(y - centerY) > 1e-6) {
    issues.push(`${label}: polygon x/y != bbox center`);
  }

  return issues;
}

export function validateRectangleExtents(
  label: string,
  x: number,
  y: number,
  width: number,
  height: number,
  worldWidth: number,
  worldHeight: number,
): string[] {
  const halfWidth = width / 2;
  const halfHeight = height / 2;
  if (
    x - halfWidth < 0 ||
    x + halfWidth > worldWidth ||
    y - halfHeight < 0 ||
    y + halfHeight > worldHeight
  ) {
    return [`${label}: rect extents outside world`];
  }
  return [];
}
