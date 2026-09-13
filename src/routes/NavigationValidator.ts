import type { Point } from '../camera/SquareWorldViewport.ts';
import { LandClearanceGeometry } from '../geometry/LandClearanceGeometry.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import type { RouteProcessingConfig } from './RouteProcessingConfig.ts';
import { simplifyRouteDraft } from './RouteSimplifier.ts';

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
    const processedPoints = simplifyRouteDraft({ start, points }, config);
    let previous = start;
    let index = 0;
    const clearance =
      ship.characteristics.collisionRadius + config.navigationClearanceExtra;
    for (; index < processedPoints.length; index += 1) {
      const current = processedPoints[index];
      if (this.#geometry.blocksSegment(previous, current, clearance)) {
        break;
      }
      previous = current;
    }
    return Object.freeze({
      validPoints: Object.freeze(
        processedPoints.slice(0, index).map((point) => Object.freeze({ ...point })),
      ),
      rejectedPoints: Object.freeze(
        processedPoints.slice(index).map((point) => Object.freeze({ ...point })),
      ),
    });
  }
}
