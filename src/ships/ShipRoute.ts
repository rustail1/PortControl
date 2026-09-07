import type { ShipPosition } from './ShipModel.ts';

export interface ShipRouteSnapshot {
  readonly points: readonly ShipPosition[];
  readonly start?: ShipPosition;
}

export interface CurvatureLimitedRouteOptions {
  readonly start: ShipPosition;
  readonly headingDeg: number;
  readonly speed: number;
  readonly turnRateDeg: number;
}

interface PointTurnCandidate {
  readonly sign: 1 | -1;
  readonly center: ShipPosition;
  readonly startRadiusAngle: number;
  readonly arcAngle: number;
  readonly tangent: ShipPosition;
  readonly tangentHeading: number;
  readonly lineLength: number;
  readonly totalLength: number;
}

const FULL_TURN_RADIANS = Math.PI * 2;
const MAX_ARC_SAMPLE_RADIANS = Math.PI / 180;
const ROUTE_GEOMETRY_EPSILON = 1e-9;

function normalizeRadians(angle: number): number {
  return ((angle % FULL_TURN_RADIANS) + FULL_TURN_RADIANS) % FULL_TURN_RADIANS;
}

function pointTurnCandidate(
  start: ShipPosition,
  heading: number,
  target: ShipPosition,
  radius: number,
  sign: 1 | -1,
): PointTurnCandidate | null {
  const center = {
    x: start.x - Math.sin(heading) * radius * sign,
    y: start.y + Math.cos(heading) * radius * sign,
  };
  const targetX = target.x - center.x;
  const targetY = target.y - center.y;
  const centerDistance = Math.hypot(targetX, targetY);
  if (centerDistance < radius - ROUTE_GEOMETRY_EPSILON) return null;
  const targetAngle = Math.atan2(targetY, targetX);
  const tangentOffset = Math.acos(Math.min(1, radius / centerDistance));
  const startRadiusAngle = heading - sign * Math.PI / 2;
  let best: PointTurnCandidate | null = null;
  for (const offsetSign of [1, -1]) {
    const tangentRadiusAngle = targetAngle + offsetSign * tangentOffset;
    const tangent = {
      x: center.x + Math.cos(tangentRadiusAngle) * radius,
      y: center.y + Math.sin(tangentRadiusAngle) * radius,
    };
    const tangentHeading = tangentRadiusAngle + sign * Math.PI / 2;
    const lineX = target.x - tangent.x;
    const lineY = target.y - tangent.y;
    const lineLength = Math.hypot(lineX, lineY);
    if (
      lineLength > ROUTE_GEOMETRY_EPSILON &&
      Math.cos(tangentHeading) * lineX + Math.sin(tangentHeading) * lineY <= 0
    ) continue;
    const arcAngle = sign > 0
      ? normalizeRadians(tangentRadiusAngle - startRadiusAngle)
      : normalizeRadians(startRadiusAngle - tangentRadiusAngle);
    const candidate = {
      sign,
      center,
      startRadiusAngle,
      arcAngle,
      tangent,
      tangentHeading,
      lineLength,
      totalLength: radius * arcAngle + lineLength,
    } as const;
    if (best === null || candidate.totalLength < best.totalLength) best = candidate;
  }
  return best;
}

export function createCurvatureLimitedRoute(
  points: readonly ShipPosition[],
  options: CurvatureLimitedRouteOptions,
): ShipRoute {
  if (points.length === 0) throw new RangeError('route must contain a point');
  if (![options.start.x, options.start.y, options.headingDeg, options.speed, options.turnRateDeg].every(Number.isFinite)) {
    throw new RangeError('curvature-limited route inputs must be finite');
  }
  if (options.speed <= 0 || options.turnRateDeg <= 0) {
    throw new RangeError('curvature-limited route speed and turn rate must be positive');
  }
  const radius = options.speed / (options.turnRateDeg * Math.PI / 180);
  const effectivePoints: ShipPosition[] = [];
  let position = { ...options.start };
  let heading = options.headingDeg * Math.PI / 180;
  for (const target of points) {
    if (Math.hypot(target.x - position.x, target.y - position.y) <= ROUTE_GEOMETRY_EPSILON) continue;
    const candidates = ([1, -1] as const)
      .map((sign) => pointTurnCandidate(position, heading, target, radius, sign))
      .filter((candidate): candidate is PointTurnCandidate => candidate !== null)
      .sort((left, right) => left.totalLength - right.totalLength || right.sign - left.sign);
    const chosen = candidates[0];
    if (chosen === undefined) throw new Error('curvature-limited route has no forward solution');
    const sampleCount = Math.ceil(chosen.arcAngle / MAX_ARC_SAMPLE_RADIANS);
    for (let sample = 1; sample <= sampleCount; sample += 1) {
      const angle = chosen.startRadiusAngle +
        chosen.sign * chosen.arcAngle * sample / sampleCount;
      effectivePoints.push({
        x: chosen.center.x + Math.cos(angle) * radius,
        y: chosen.center.y + Math.sin(angle) * radius,
      });
    }
    if (chosen.lineLength > ROUTE_GEOMETRY_EPSILON) {
      effectivePoints.push({ ...target });
      heading = Math.atan2(target.y - chosen.tangent.y, target.x - chosen.tangent.x);
    } else {
      heading = chosen.tangentHeading;
    }
    position = { ...target };
  }
  if (effectivePoints.length === 0) effectivePoints.push({ ...points[points.length - 1]! });
  return new ShipRoute(effectivePoints, options.start);
}

export class ShipRoute {
  readonly #points: readonly ShipPosition[];
  readonly #start: ShipPosition;
  readonly #cumulativeLengths: readonly number[];
  public constructor(points: readonly ShipPosition[], start?: ShipPosition) {
    if (points.length === 0) throw new RangeError('route must contain a point');
    this.#points = Object.freeze(points.map((point) => Object.freeze({ ...point })));
    this.#start = Object.freeze({ ...(start ?? points[0]) });
    const cumulativeLengths = [0];
    let previous = this.#start;
    for (const point of this.#points) {
      cumulativeLengths.push(
        cumulativeLengths[cumulativeLengths.length - 1]! +
          Math.hypot(point.x - previous.x, point.y - previous.y),
      );
      previous = point;
    }
    this.#cumulativeLengths = Object.freeze(cumulativeLengths);
  }
  public get length(): number { return this.#points.length; }
  public get totalLength(): number { return this.#cumulativeLengths.at(-1) ?? 0; }
  public at(index: number): ShipPosition | null { return this.#points[index] ?? null; }
  public segmentStartAt(index: number): ShipPosition | null {
    if (index < 0 || index >= this.#points.length) return null;
    return index === 0 ? this.#start : this.#points[index - 1] ?? null;
  }
  public distanceAtCursor(cursor: number): number {
    const index = Math.min(Math.max(Math.trunc(cursor), 0), this.#points.length);
    return this.#cumulativeLengths[index] ?? this.totalLength;
  }
  public cursorAtDistance(distance: number): number {
    const progress = this.#clampDistance(distance);
    let cursor = 0;
    while (
      cursor < this.#points.length &&
      (this.#cumulativeLengths[cursor + 1] ?? Number.POSITIVE_INFINITY) <= progress
    ) cursor += 1;
    return cursor;
  }
  public pointAtDistance(distance: number): ShipPosition {
    const progress = this.#clampDistance(distance);
    if (this.totalLength === 0) return { ...this.#points[this.#points.length - 1]! };
    let start = this.#start;
    for (let index = 0; index < this.#points.length; index += 1) {
      const end = this.#points[index]!;
      const segmentStart = this.#cumulativeLengths[index]!;
      const segmentEnd = this.#cumulativeLengths[index + 1]!;
      const segmentLength = segmentEnd - segmentStart;
      if (segmentLength > 0 && progress <= segmentEnd) {
        const t = (progress - segmentStart) / segmentLength;
        return {
          x: start.x + (end.x - start.x) * t,
          y: start.y + (end.y - start.y) * t,
        };
      }
      start = end;
    }
    return { ...this.#points[this.#points.length - 1]! };
  }
  public tangentAtDistance(distance: number): ShipPosition | null {
    const progress = this.#clampDistance(distance);
    let start = this.#start;
    for (let index = 0; index < this.#points.length; index += 1) {
      const end = this.#points[index]!;
      const segmentEnd = this.#cumulativeLengths[index + 1]!;
      const length = this.#cumulativeLengths[index + 1]! - this.#cumulativeLengths[index]!;
      if (length > 0 && segmentEnd > progress) {
        return { x: (end.x - start.x) / length, y: (end.y - start.y) / length };
      }
      start = end;
    }
    for (let index = this.#points.length - 1; index >= 0; index -= 1) {
      const end = this.#points[index]!;
      const segmentStart = index === 0 ? this.#start : this.#points[index - 1]!;
      const length = this.#cumulativeLengths[index + 1]! - this.#cumulativeLengths[index]!;
      if (length > 0) {
        return {
          x: (end.x - segmentStart.x) / length,
          y: (end.y - segmentStart.y) / length,
        };
      }
    }
    return null;
  }
  public projectProgress(
    position: ShipPosition,
    currentProgress: number,
    maximumForwardDistance = Number.POSITIVE_INFINITY,
  ): number {
    const progress = this.#clampDistance(currentProgress);
    if (maximumForwardDistance < 0 || Number.isNaN(maximumForwardDistance)) {
      throw new RangeError('maximumForwardDistance must be non-negative');
    }
    const maximumProgress = Math.min(
      progress + maximumForwardDistance,
      this.totalLength,
    );
    let bestProgress = progress;
    const currentPoint = this.pointAtDistance(progress);
    let bestDistanceSquared =
      (position.x - currentPoint.x) ** 2 + (position.y - currentPoint.y) ** 2;
    let start = this.#start;
    for (let index = 0; index < this.#points.length; index += 1) {
      const end = this.#points[index]!;
      const segmentStart = this.#cumulativeLengths[index]!;
      const segmentEnd = this.#cumulativeLengths[index + 1]!;
      const segmentLength = segmentEnd - segmentStart;
      if (segmentEnd < progress || segmentStart > maximumProgress) {
        start = end;
        continue;
      }
      if (segmentLength === 0) {
        start = end;
        continue;
      }
      const segmentX = end.x - start.x;
      const segmentY = end.y - start.y;
      const rawProjection =
        ((position.x - start.x) * segmentX + (position.y - start.y) * segmentY) /
        (segmentLength * segmentLength);
      const minimumT = Math.max((progress - segmentStart) / segmentLength, 0);
      const maximumT = Math.min((maximumProgress - segmentStart) / segmentLength, 1);
      const t = Math.min(Math.max(rawProjection, minimumT), maximumT);
      const projectedX = start.x + segmentX * t;
      const projectedY = start.y + segmentY * t;
      const distanceSquared =
        (position.x - projectedX) ** 2 + (position.y - projectedY) ** 2;
      const candidateProgress = segmentStart + segmentLength * t;
      if (
        distanceSquared < bestDistanceSquared - 1e-9 ||
        Math.abs(distanceSquared - bestDistanceSquared) <= 1e-9 &&
          candidateProgress > bestProgress
      ) {
        bestDistanceSquared = distanceSquared;
        bestProgress = candidateProgress;
      }
      start = end;
    }
    return bestProgress;
  }
  public remainingPolyline(distance: number): readonly ShipPosition[] {
    const progress = this.#clampDistance(distance);
    const cursor = this.cursorAtDistance(progress);
    if (cursor >= this.#points.length) return Object.freeze([]);
    return Object.freeze([
      Object.freeze(this.pointAtDistance(progress)),
      ...this.#points.slice(cursor),
    ]);
  }
  public withStart(start: ShipPosition): ShipRoute { return new ShipRoute(this.#points, start); }
  public toSnapshot(): ShipRouteSnapshot {
    return Object.freeze({ points: this.#points, start: this.#start });
  }
  public static restore(snapshot: ShipRouteSnapshot, fallbackStart?: ShipPosition): ShipRoute {
    return new ShipRoute(snapshot.points, snapshot.start ?? fallbackStart);
  }

  #clampDistance(distance: number): number {
    if (!Number.isFinite(distance)) throw new RangeError('route progress must be finite');
    return Math.min(Math.max(distance, 0), this.totalLength);
  }
}
