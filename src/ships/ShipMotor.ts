import { normalizeRotationDeg, type ShipModel } from './ShipModel.ts';
import { ShipState } from './ShipState.ts';

const ROUTE_LOOKAHEAD_TURN_RADIUS_FRACTION = 0.5;

export interface SteeringTarget {
  readonly x: number;
  readonly y: number;
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

export function moveAngleTowardsDeg(
  rotationDeg: number,
  desiredAngleDeg: number,
  maximumDeltaDeg: number,
): number {
  assertFinite(maximumDeltaDeg, 'maximumDeltaDeg');
  if (maximumDeltaDeg < 0) {
    throw new RangeError('maximumDeltaDeg must be non-negative');
  }

  const current = normalizeRotationDeg(rotationDeg);
  const desired = normalizeRotationDeg(desiredAngleDeg);
  const shortestDelta = ((desired - current + 540) % 360) - 180;
  if (Math.abs(shortestDelta) <= maximumDeltaDeg) {
    return desired;
  }
  return normalizeRotationDeg(
    current + Math.sign(shortestDelta) * maximumDeltaDeg,
  );
}

export class ShipMotor {
  public stepRoute(ship: ShipModel, waypointTolerance: number, deltaSeconds: number): void {
    if (
      ship.state !== ShipState.Entering &&
      ship.state !== ShipState.Navigating &&
      ship.state !== ShipState.ReadyToLeave &&
      ship.state !== ShipState.Leaving
    ) return;
    const route = ship.route;
    if (route === null || ship.routeProgress >= route.totalLength) {
      if (
        ship.state === ShipState.Entering ||
        ship.state === ShipState.Navigating ||
        ship.state === ShipState.Leaving
      ) {
        this.#stepForward(ship, deltaSeconds);
      }
      return;
    }
    const turnRateRadians = ship.characteristics.turnRateDeg * Math.PI / 180;
    const turnRadius = ship.characteristics.speed / turnRateRadians;
    const lookAheadDistance = Math.max(
      waypointTolerance,
      turnRadius * ROUTE_LOOKAHEAD_TURN_RADIUS_FRACTION,
    );
    ship.advanceRouteProgress(
      route.projectProgress(ship.position, ship.routeProgress, lookAheadDistance),
    );
    while (this.#advanceEndpointInsideTolerance(ship, waypointTolerance)) {
      // Consume close points without inserting a stopped simulation step.
    }
    if (ship.routeProgress >= route.totalLength) {
      if (ship.state !== ShipState.ReadyToLeave) this.#stepForward(ship, deltaSeconds);
      return;
    }
    const target = route.pointAtDistance(
      Math.min(ship.routeProgress + lookAheadDistance, route.totalLength),
    );
    this.step(ship, target, deltaSeconds);
    ship.advanceRouteProgress(
      route.projectProgress(ship.position, ship.routeProgress, lookAheadDistance),
    );
    while (this.#advanceEndpointInsideTolerance(ship, waypointTolerance)) {
      // Progress stays monotonic even when several simplified points are close.
    }
  }
  public step(ship: ShipModel, target: SteeringTarget, deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    assertFinite(target.x, 'target.x');
    assertFinite(target.y, 'target.y');
    if (ship.state === ShipState.Destroyed) {
      return;
    }

    const desiredAngleDeg = normalizeRotationDeg(
      (Math.atan2(target.y - ship.y, target.x - ship.x) * 180) /
        Math.PI,
    );
    const rotationDeg = moveAngleTowardsDeg(
      ship.rotationDeg,
      desiredAngleDeg,
      ship.characteristics.turnRateDeg * deltaSeconds,
    );
    const rotationRadians = (rotationDeg * Math.PI) / 180;

    ship.setRotationDeg(rotationDeg);
    ship.setPositionXY(
      ship.x + Math.cos(rotationRadians) * ship.characteristics.speed * deltaSeconds,
      ship.y + Math.sin(rotationRadians) * ship.characteristics.speed * deltaSeconds,
    );
  }

  #stepForward(ship: ShipModel, deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    const rotationRadians = (ship.rotationDeg * Math.PI) / 180;
    ship.setPositionXY(
      ship.x + Math.cos(rotationRadians) * ship.characteristics.speed * deltaSeconds,
      ship.y + Math.sin(rotationRadians) * ship.characteristics.speed * deltaSeconds,
    );
  }

  #advanceEndpointInsideTolerance(ship: ShipModel, waypointTolerance: number): boolean {
    const route = ship.route;
    if (route === null) return false;
    const cursor = route.cursorAtDistance(ship.routeProgress);
    const endpoint = route.at(cursor);
    if (
      endpoint === null ||
      Math.hypot(endpoint.x - ship.x, endpoint.y - ship.y) > waypointTolerance
    ) return false;
    ship.advanceRouteProgress(route.distanceAtCursor(cursor + 1));
    return true;
  }
}
