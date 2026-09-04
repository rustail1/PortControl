import type { ShipPosition } from './ShipModel.ts';

export interface ShipRouteSnapshot {
  readonly points: readonly ShipPosition[];
  readonly start?: ShipPosition;
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
