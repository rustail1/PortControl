import type { ShipPosition } from './ShipModel.ts';

export interface ShipRouteSnapshot {
  readonly points: readonly ShipPosition[];
  readonly start?: ShipPosition;
}

export class ShipRoute {
  readonly #points: readonly ShipPosition[];
  readonly #start: ShipPosition;
  public constructor(points: readonly ShipPosition[], start?: ShipPosition) {
    if (points.length === 0) throw new RangeError('route must contain a point');
    this.#points = Object.freeze(points.map((point) => Object.freeze({ ...point })));
    this.#start = Object.freeze({ ...(start ?? points[0]) });
  }
  public get length(): number { return this.#points.length; }
  public at(index: number): ShipPosition | null { return this.#points[index] ?? null; }
  public segmentStartAt(index: number): ShipPosition | null {
    if (index < 0 || index >= this.#points.length) return null;
    return index === 0 ? this.#start : this.#points[index - 1] ?? null;
  }
  public withStart(start: ShipPosition): ShipRoute { return new ShipRoute(this.#points, start); }
  public toSnapshot(): ShipRouteSnapshot {
    return Object.freeze({ points: this.#points, start: this.#start });
  }
  public static restore(snapshot: ShipRouteSnapshot, fallbackStart?: ShipPosition): ShipRoute {
    return new ShipRoute(snapshot.points, snapshot.start ?? fallbackStart);
  }
}
