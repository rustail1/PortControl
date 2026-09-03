import type { ShipPosition } from './ShipModel.ts';

export interface ShipRouteSnapshot { readonly points: readonly ShipPosition[]; }

export class ShipRoute {
  readonly #points: readonly ShipPosition[];
  public constructor(points: readonly ShipPosition[]) {
    if (points.length === 0) throw new RangeError('route must contain a point');
    this.#points = Object.freeze(points.map((point) => Object.freeze({ ...point })));
  }
  public get length(): number { return this.#points.length; }
  public at(index: number): ShipPosition | null { return this.#points[index] ?? null; }
  public toSnapshot(): ShipRouteSnapshot { return Object.freeze({ points: this.#points }); }
  public static restore(snapshot: ShipRouteSnapshot): ShipRoute { return new ShipRoute(snapshot.points); }
}
