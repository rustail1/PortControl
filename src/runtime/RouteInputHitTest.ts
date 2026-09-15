import type { Point } from '../shared/geometry/Point.ts';
import { isRouteInputState } from '../routes/RouteInputController.ts';
import type { ShipModel } from '../ships/ShipModel.ts';

export const ROUTE_SELECTION_MIN_CSS_RADIUS = 32;

export interface RouteSelectableShip {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
}

export function selectRouteInputShip(
  candidates: readonly RouteSelectableShip[],
  worldPoint: Point,
  effectiveWorldToCssPixelScale: number,
): ShipModel | null {
  if (
    !Number.isFinite(effectiveWorldToCssPixelScale) ||
    effectiveWorldToCssPixelScale <= 0
  ) {
    throw new RangeError('effectiveWorldToCssPixelScale must be positive and finite');
  }
  let winner: RouteSelectableShip | null = null;
  let winnerDistanceSquared = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    if (!isRouteInputState(candidate.ship.state)) continue;
    const selectionRadius = Math.max(
      candidate.ship.characteristics.collisionRadius,
      ROUTE_SELECTION_MIN_CSS_RADIUS / effectiveWorldToCssPixelScale,
    );
    const dx = worldPoint.x - candidate.ship.x;
    const dy = worldPoint.y - candidate.ship.y;
    const distanceSquared = dx * dx + dy * dy;
    if (distanceSquared > selectionRadius * selectionRadius) continue;
    if (
      winner === null ||
      distanceSquared < winnerDistanceSquared ||
      (distanceSquared === winnerDistanceSquared &&
        candidate.spawnSequence < winner.spawnSequence)
    ) {
      winner = candidate;
      winnerDistanceSquared = distanceSquared;
    }
  }
  return winner?.ship ?? null;
}
