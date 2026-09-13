import type { Point } from '../camera/SquareWorldViewport.ts';
import { LandClearanceGeometry } from '../geometry/LandClearanceGeometry.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { canonicalizeRoute } from './RouteSimplifier.ts';
import type { RouteProcessingConfig } from './RouteProcessingConfig.ts';

export interface ForbiddenPolygon {
  readonly points: readonly Point[];
}

export interface NavigationValidationResult {
  readonly validPoints: readonly Point[];
  readonly rejectedPoints: readonly Point[];
}

export class NavigationValidator {
  readonly #geometry: LandClearanceGeometry;

  public constructor(land: readonly ForbiddenPolygon[]) {
    this.#geometry = new LandClearanceGeometry(land);
  }

  public validate(
    ship: ShipModel,
    points: readonly Point[],
    config: RouteProcessingConfig,
    start: Point = ship.position,
  ): NavigationValidationResult {
    const canonicalPoints = canonicalizeRoute(start, points, config);
    let previous = start;
    let index = 0;
    const clearance =
      ship.characteristics.collisionRadius + config.navigationClearanceExtra;
    for (; index < canonicalPoints.length; index += 1) {
      const current = canonicalPoints[index]!;
      if (this.#geometry.blocksSegment(previous, current, clearance)) {
        break;
      }
      previous = current;
    }
    return Object.freeze({
      validPoints: Object.freeze(
        canonicalPoints.slice(0, index).map((point) => Object.freeze({ ...point })),
      ),
      rejectedPoints: Object.freeze(
        canonicalPoints.slice(index).map((point) => Object.freeze({ ...point })),
      ),
    });
  }
}
