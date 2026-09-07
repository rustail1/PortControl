import { normalizeRotationDeg, type ShipModel } from './ShipModel.ts';
import type { ShipRoute } from './ShipRoute.ts';
import { ShipState } from './ShipState.ts';

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
  public stepRoute(
    ship: ShipModel,
    waypointTolerance: number,
    deltaSeconds: number,
    continueAfterRouteEnd = true,
  ): void {
    if (
      ship.state !== ShipState.Entering &&
      ship.state !== ShipState.Navigating &&
      ship.state !== ShipState.ReadyToLeave &&
      ship.state !== ShipState.Leaving
    ) return;
    const route = ship.route;
    if (route !== null && ship.routeMotionHeld) return;
    if (route === null) {
      const recoveryHeading = ship.routeRecoveryHeadingDeg;
      if (recoveryHeading !== null) {
        assertFinite(deltaSeconds, 'deltaSeconds');
        if (deltaSeconds < 0) {
          throw new RangeError('deltaSeconds must be non-negative');
        }
        ship.setRotationDeg(moveAngleTowardsDeg(
          ship.rotationDeg,
          recoveryHeading,
          ship.characteristics.turnRateDeg * deltaSeconds,
        ));
        if (ship.rotationDeg === recoveryHeading) {
          ship.finishRouteRecovery();
        }
        this.#stepForward(ship, deltaSeconds);
        return;
      }
      if (
        !ship.routeMotionHeld &&
        (ship.state === ShipState.Entering ||
          ship.state === ShipState.Navigating ||
          ship.state === ShipState.Leaving)
      ) {
        this.#stepForward(ship, deltaSeconds);
      }
      return;
    }
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    assertFinite(waypointTolerance, 'waypointTolerance');
    if (waypointTolerance < 0) {
      throw new RangeError('waypointTolerance must be non-negative');
    }

    this.#advanceReachedOrPassedWaypoints(ship, route, waypointTolerance);
    if (ship.routeProgress >= route.totalLength) {
      if (continueAfterRouteEnd && (
        ship.state === ShipState.Entering ||
        ship.state === ShipState.Navigating ||
        ship.state === ShipState.Leaving
      )) {
        this.#stepForward(ship, deltaSeconds);
      }
      return;
    }

    const target = ship.currentWaypoint;
    if (target === null) return;
    const desiredAngleDeg = normalizeRotationDeg(
      Math.atan2(target.y - ship.y, target.x - ship.x) * 180 / Math.PI,
    );
    ship.setRotationDeg(moveAngleTowardsDeg(
      ship.rotationDeg,
      desiredAngleDeg,
      ship.characteristics.turnRateDeg * deltaSeconds,
    ));
    this.#stepForward(ship, deltaSeconds);

    const maximumForwardProgress =
      ship.characteristics.speed * deltaSeconds + waypointTolerance;
    ship.advanceRouteProgress(route.projectProgress(
      ship.position,
      ship.routeProgress,
      maximumForwardProgress,
    ));
    this.#advanceReachedOrPassedWaypoints(ship, route, waypointTolerance);
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

  #advanceReachedOrPassedWaypoints(
    ship: ShipModel,
    route: ShipRoute,
    waypointTolerance: number,
  ): void {
    while (ship.routeProgress < route.totalLength) {
      const cursor = ship.routeCursor;
      const target = route.at(cursor);
      const segmentStart = route.segmentStartAt(cursor);
      if (target === null || segmentStart === null) return;
      const targetDistance = Math.hypot(target.x - ship.x, target.y - ship.y);
      const segmentX = target.x - segmentStart.x;
      const segmentY = target.y - segmentStart.y;
      const segmentLengthSquared = segmentX * segmentX + segmentY * segmentY;
      const passed = segmentLengthSquared > 0 &&
        ((ship.x - segmentStart.x) * segmentX +
          (ship.y - segmentStart.y) * segmentY) >= segmentLengthSquared;
      if (targetDistance > waypointTolerance && !passed) return;
      ship.advanceRouteCursor();
    }
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
}
